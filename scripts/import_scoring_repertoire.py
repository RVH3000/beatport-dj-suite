#!/usr/bin/env python3
"""
Repertoire-Import: scoring-data.json (Scanner-Universum) → SQLite (bp_repertoire_tracks).

Aggregiert Artists on-demand via SQL-View — keine separate Tabelle noetig.
Schema-Trennung von bp_artists (Beatport-API followed) und bp_repertoire_*
(Scanner-Repertoire) ist bewusst: zwei verschiedene semantische Konzepte.

Nutzung:
  python3 scripts/import_scoring_repertoire.py \
      --db    "$HOME/Library/Application Support/beatport-dj-suite/suite.db" \
      --input ~/Documents/Claude/Projects/Beatport\\ PL\\ WIZ/scoring-data.json
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def backup_db(db_path: Path) -> Path | None:
    if not db_path.exists():
        return None
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_suffix(f".backup-pre-repertoire-{ts}.db")
    shutil.copy2(str(db_path), str(backup))
    return backup


def ensure_schema(conn: sqlite3.Connection) -> None:
    """
    Schema fuer Scanner-Repertoire. Tracks sind die Basis (99k+ Eintraege),
    Artists werden via View aggregiert. Trigger schuetzt first_seen_at.
    """
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS bp_repertoire_tracks (
        id              INTEGER PRIMARY KEY,
        title           TEXT NOT NULL,
        mix_name        TEXT,
        artists_str     TEXT,           -- 'Stefano Noferini, Alann M'
        artist_ids      TEXT,           -- JSON-Array '[16027, 834140]'
        genre           TEXT,
        bpm             REAL,
        key             TEXT,           -- 'F Major'
        camelot         TEXT,           -- '7B'
        year            INTEGER,
        label           TEXT,
        release_name    TEXT,
        length_ms       INTEGER,
        playlist_ids    TEXT,           -- JSON-Array
        plays_total     INTEGER DEFAULT 0,
        last_played     TEXT,
        rating          INTEGER,
        comment         TEXT,
        file_path       TEXT,
        last_synced_at  TEXT NOT NULL,
        first_seen_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bp_rep_tracks_title  ON bp_repertoire_tracks(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_tracks_bpm    ON bp_repertoire_tracks(bpm);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_tracks_genre  ON bp_repertoire_tracks(genre);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_tracks_year   ON bp_repertoire_tracks(year DESC);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_tracks_camelot ON bp_repertoire_tracks(camelot);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_tracks_label  ON bp_repertoire_tracks(label);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_tracks_plays  ON bp_repertoire_tracks(plays_total DESC);
      CREATE TRIGGER IF NOT EXISTS bp_rep_tracks_first_seen_lock
      BEFORE UPDATE OF first_seen_at ON bp_repertoire_tracks
      BEGIN
        SELECT RAISE(IGNORE);
      END;

      -- Artist-Aggregat-Tabelle wird beim Import gefuellt (statt View — bessere
      -- Performance bei 25k+ Artists + Sortier-/Filter-Queries).
      CREATE TABLE IF NOT EXISTS bp_repertoire_artists (
        id              INTEGER PRIMARY KEY,    -- Beatport Artist-ID
        name            TEXT NOT NULL,
        track_count     INTEGER DEFAULT 0,
        plays_total     INTEGER DEFAULT 0,
        genres          TEXT,                    -- JSON-Array
        labels          TEXT,                    -- JSON-Array (Top-10)
        year_min        INTEGER,
        year_max        INTEGER,
        bpm_min         INTEGER,
        bpm_max         INTEGER,
        last_synced_at  TEXT NOT NULL,
        first_seen_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bp_rep_artists_name ON bp_repertoire_artists(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_artists_track_count ON bp_repertoire_artists(track_count DESC);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_artists_plays_total ON bp_repertoire_artists(plays_total DESC);
      CREATE INDEX IF NOT EXISTS idx_bp_rep_artists_year_max ON bp_repertoire_artists(year_max DESC);
      CREATE TRIGGER IF NOT EXISTS bp_rep_artists_first_seen_lock
      BEFORE UPDATE OF first_seen_at ON bp_repertoire_artists
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    """)


def load_scoring(input_path: Path) -> dict:
    raw = json.loads(input_path.read_text("utf8"))
    if not isinstance(raw, dict) or "all_tracks" not in raw:
        raise ValueError("Unerwartete Struktur: erwarte dict mit 'all_tracks'-Key")
    return raw


def upsert_tracks(conn: sqlite3.Connection, tracks: list[dict], now: str) -> dict:
    stats = {"inserted": 0, "updated": 0, "skipped": 0}

    existing_ids = {
        row[0] for row in conn.execute("SELECT id FROM bp_repertoire_tracks").fetchall()
    }

    for t in tracks:
        tid = t.get("i")
        title = t.get("t")
        if not isinstance(tid, int) or not title:
            stats["skipped"] += 1
            continue

        row = (
            tid,
            title,
            t.get("m") or None,
            t.get("a") or None,
            json.dumps(t.get("ai") or []),
            t.get("g") or None,
            float(t.get("b")) if t.get("b") not in (None, "") else None,
            t.get("k") or None,
            t.get("c") or None,
            int(t.get("y")) if isinstance(t.get("y"), (int, float)) else None,
            t.get("l") or None,
            t.get("r") or None,
            int(t.get("ms")) if isinstance(t.get("ms"), (int, float)) else None,
            json.dumps(t.get("p") or []),
            int(t.get("plays_total") or 0),
            t.get("last_played") or None,
            int(t.get("rating")) if isinstance(t.get("rating"), (int, float)) else None,
            t.get("comment") or None,
            t.get("file_path") or None,
            now,
            now,
        )

        if tid in existing_ids:
            conn.execute("""
                UPDATE bp_repertoire_tracks SET
                  title=?, mix_name=?, artists_str=?, artist_ids=?, genre=?,
                  bpm=?, key=?, camelot=?, year=?, label=?, release_name=?,
                  length_ms=?, playlist_ids=?, plays_total=?, last_played=?,
                  rating=?, comment=?, file_path=?, last_synced_at=?
                WHERE id=?
            """, row[1:20] + (tid,))
            stats["updated"] += 1
        else:
            conn.execute("""
                INSERT INTO bp_repertoire_tracks
                  (id, title, mix_name, artists_str, artist_ids, genre, bpm,
                   key, camelot, year, label, release_name, length_ms,
                   playlist_ids, plays_total, last_played, rating, comment,
                   file_path, last_synced_at, first_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, row)
            stats["inserted"] += 1

    conn.commit()
    return stats


def aggregate_artists(conn: sqlite3.Connection, now: str) -> dict:
    """
    Aggregiert Artists aus bp_repertoire_tracks. Liest die JSON-Arrays
    artist_ids und korreliert mit artists_str (komma-separierte Namen).
    Schreibt nach bp_repertoire_artists (komplett neu, kein Upsert — bei
    Re-Import wird's konsistent neu aufgebaut).
    """
    conn.row_factory = sqlite3.Row

    # Sammle pro Artist-ID: name, genres, labels, year_range, bpm_range,
    # track_count, plays_total
    agg: dict[int, dict] = {}

    for row in conn.execute(
        "SELECT artist_ids, artists_str, genre, label, year, bpm, plays_total "
        "FROM bp_repertoire_tracks"
    ):
        try:
            ai = json.loads(row["artist_ids"] or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(ai, list) or not ai:
            continue

        names = (row["artists_str"] or "").split(", ")

        genre = row["genre"]
        label = row["label"]
        year = row["year"]
        bpm = row["bpm"]
        plays = int(row["plays_total"] or 0)

        for idx, aid in enumerate(ai):
            if not isinstance(aid, int):
                continue
            name = names[idx] if idx < len(names) else f"Artist #{aid}"

            if aid not in agg:
                agg[aid] = {
                    "name": name,
                    "track_count": 0,
                    "plays_total": 0,
                    "genres": set(),
                    "labels": [],   # Liste mit Counter fuer Top-10
                    "label_counter": {},
                    "year_min": None,
                    "year_max": None,
                    "bpm_min": None,
                    "bpm_max": None,
                }
            rec = agg[aid]
            rec["track_count"] += 1
            rec["plays_total"] += plays
            if genre:
                rec["genres"].add(genre)
            if label:
                rec["label_counter"][label] = rec["label_counter"].get(label, 0) + 1
            if year:
                rec["year_min"] = year if rec["year_min"] is None else min(rec["year_min"], year)
                rec["year_max"] = year if rec["year_max"] is None else max(rec["year_max"], year)
            if bpm:
                bi = int(bpm)
                rec["bpm_min"] = bi if rec["bpm_min"] is None else min(rec["bpm_min"], bi)
                rec["bpm_max"] = bi if rec["bpm_max"] is None else max(rec["bpm_max"], bi)
            # Falls bei mehreren Tracks ein anderer Name auftaucht: behalte den
            # ersten — String-Diffs koennten von Beatport-Spelling-Varianten
            # kommen (z.B. "Daft Punk" vs "Daft Punk presents Thomas Bangalter").

    # Komplette Neu-Beschreibung von bp_repertoire_artists
    conn.execute("DELETE FROM bp_repertoire_artists")
    for aid, rec in agg.items():
        top_labels = sorted(rec["label_counter"].items(), key=lambda kv: -kv[1])[:10]
        conn.execute("""
            INSERT INTO bp_repertoire_artists
              (id, name, track_count, plays_total, genres, labels,
               year_min, year_max, bpm_min, bpm_max,
               last_synced_at, first_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            aid,
            rec["name"],
            rec["track_count"],
            rec["plays_total"],
            json.dumps(sorted(rec["genres"])),
            json.dumps([lbl for lbl, _ in top_labels]),
            rec["year_min"],
            rec["year_max"],
            rec["bpm_min"],
            rec["bpm_max"],
            now,
            now,
        ))

    conn.commit()
    return {"artists": len(agg)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Pfad zur SQLite-DB")
    parser.add_argument("--input", required=True,
                        help="Pfad zu scoring-data.json")
    parser.add_argument("--no-backup", action="store_true")
    parser.add_argument("--tracks-only", action="store_true",
                        help="nur Tracks importieren, keine Artist-Aggregation")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    input_path = Path(args.input).expanduser().resolve()

    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"Input nicht gefunden: {input_path}"}))
        return 1

    try:
        data = load_scoring(input_path)
    except (ValueError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1

    tracks = data.get("all_tracks", [])

    backup_path = None
    if not args.no_backup:
        backup_path = backup_db(db_path)

    conn = sqlite3.connect(str(db_path))
    now = iso_utc_now()
    try:
        ensure_schema(conn)
        track_stats = upsert_tracks(conn, tracks, now)
        artist_stats = {} if args.tracks_only else aggregate_artists(conn, now)
        total_tracks = conn.execute("SELECT COUNT(*) FROM bp_repertoire_tracks").fetchone()[0]
        total_artists = conn.execute("SELECT COUNT(*) FROM bp_repertoire_artists").fetchone()[0]
    finally:
        conn.close()

    print(json.dumps({
        "ok": True,
        "db": str(db_path),
        "input": str(input_path),
        "input_track_count": len(tracks),
        "db_total_tracks": total_tracks,
        "db_total_artists": total_artists,
        "track_stats": track_stats,
        "artist_stats": artist_stats,
        "backup": str(backup_path) if backup_path else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
