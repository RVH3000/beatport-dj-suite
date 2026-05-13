#!/usr/bin/env python3
"""
Beatport Artist-Import: /v4/my/beatport/artists/ JSON → SQLite (bp_artists).

UPSERT by id. Setzt is_followed=1, last_synced_at=now.
first_seen_at wird nur beim ersten INSERT gesetzt (per Trigger geschützt).

Optionale Drift-Detection: --diff setzt is_followed=0 für Artists die im
Input NICHT auftauchen aber vorher in der DB waren (entfollow'te Artists).

Nutzung:
  python3 scripts/import_beatport_artists.py \
      --db    data/suite.db \
      --input ~/_handoff/bp_artists_response.json
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
    backup = db_path.with_suffix(f".backup-pre-artists-{ts}.db")
    shutil.copy2(str(db_path), str(backup))
    return backup


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Idempotent — legt Tabelle+Indices+Trigger an falls fehlt."""
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS bp_artists (
        id              INTEGER PRIMARY KEY,
        name            TEXT NOT NULL,
        slug            TEXT,
        release_count   INTEGER DEFAULT 0,
        track_count     INTEGER DEFAULT 0,
        image_id        INTEGER,
        image_uri       TEXT,
        image_dynamic   TEXT,
        is_followed     INTEGER DEFAULT 1,
        last_synced_at  TEXT NOT NULL,
        first_seen_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bp_artists_name     ON bp_artists(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_bp_artists_followed ON bp_artists(is_followed);
      CREATE INDEX IF NOT EXISTS idx_bp_artists_release_count ON bp_artists(release_count DESC);
      CREATE INDEX IF NOT EXISTS idx_bp_artists_track_count   ON bp_artists(track_count DESC);
      CREATE TRIGGER IF NOT EXISTS bp_artists_first_seen_lock
      BEFORE UPDATE OF first_seen_at ON bp_artists
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    """)


def load_artists(input_path: Path) -> list[dict]:
    raw = json.loads(input_path.read_text("utf8"))
    if isinstance(raw, dict) and "results" in raw:
        return raw["results"]
    if isinstance(raw, list):
        return raw
    raise ValueError("Unerwartete Response-Struktur: weder Liste noch {results:[]}")


def upsert_artists(conn: sqlite3.Connection, artists: list[dict], drift_detect: bool) -> dict:
    stats = {"inserted": 0, "updated": 0, "unchanged": 0, "skipped": 0, "unfollowed": 0}
    now = iso_utc_now()

    conn.row_factory = sqlite3.Row
    existing = {
        row["id"]: row
        for row in conn.execute(
            "SELECT id, name, slug, release_count, track_count, image_id, image_uri, image_dynamic, is_followed FROM bp_artists"
        ).fetchall()
    }

    seen_ids: set[int] = set()
    for artist in artists:
        aid = artist.get("id")
        name = artist.get("name")
        if not isinstance(aid, int) or not name:
            stats["skipped"] += 1
            continue

        slug = artist.get("slug")
        # Beatport-API liefert je nach Endpoint unterschiedliche Felder.
        # release_count + track_count beide nullable.
        release_count = int(artist.get("release_count") or artist.get("count") or 0)
        track_count = int(artist.get("track_count") or 0)
        img = artist.get("image") or {}
        image_id = img.get("id")
        image_uri = img.get("uri")
        image_dynamic = img.get("dynamic_uri")

        seen_ids.add(aid)

        if aid in existing:
            old = existing[aid]
            same = (
                old["name"] == name
                and (old["slug"] or None) == slug
                and (old["release_count"] or 0) == release_count
                and (old["track_count"] or 0) == track_count
                and (old["image_id"] or None) == image_id
                and (old["image_uri"] or None) == image_uri
                and (old["image_dynamic"] or None) == image_dynamic
                and (old["is_followed"] or 0) == 1
            )
            conn.execute(
                """
                UPDATE bp_artists SET
                    name = ?,
                    slug = ?,
                    release_count = ?,
                    track_count = ?,
                    image_id = ?,
                    image_uri = ?,
                    image_dynamic = ?,
                    is_followed = 1,
                    last_synced_at = ?
                WHERE id = ?
                """,
                (name, slug, release_count, track_count, image_id, image_uri, image_dynamic, now, aid),
            )
            stats["unchanged" if same else "updated"] += 1
        else:
            conn.execute(
                """
                INSERT INTO bp_artists
                    (id, name, slug, release_count, track_count, image_id, image_uri, image_dynamic,
                     is_followed, last_synced_at, first_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (aid, name, slug, release_count, track_count, image_id, image_uri, image_dynamic, now, now),
            )
            stats["inserted"] += 1

    # Drift-Detection: Artists die in der DB sind aber NICHT im Input
    if drift_detect:
        for old_id, old in existing.items():
            if old_id not in seen_ids and (old["is_followed"] or 0) == 1:
                conn.execute(
                    "UPDATE bp_artists SET is_followed = 0, last_synced_at = ? WHERE id = ?",
                    (now, old_id),
                )
                stats["unfollowed"] += 1

    conn.commit()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Pfad zur SQLite-DB")
    parser.add_argument("--input", required=True, help="Pfad zur Artists-JSON-Datei")
    parser.add_argument("--no-backup", action="store_true", help="Backup überspringen (nur für Sandbox)")
    parser.add_argument("--diff", action="store_true",
                        help="Drift-Detection: Artists die nicht im Input sind, werden is_followed=0 gesetzt")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    input_path = Path(args.input).expanduser().resolve()

    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"Input nicht gefunden: {input_path}"}))
        return 1

    try:
        artists = load_artists(input_path)
    except ValueError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1

    backup_path = None
    if not args.no_backup:
        backup_path = backup_db(db_path)

    conn = sqlite3.connect(str(db_path))
    try:
        ensure_schema(conn)
        stats = upsert_artists(conn, artists, drift_detect=args.diff)
        total = conn.execute("SELECT COUNT(*) FROM bp_artists").fetchone()[0]
        followed = conn.execute("SELECT COUNT(*) FROM bp_artists WHERE is_followed = 1").fetchone()[0]
    finally:
        conn.close()

    print(json.dumps({
        "ok": True,
        "db": str(db_path),
        "input": str(input_path),
        "input_count": len(artists),
        "db_total_after": total,
        "db_followed_after": followed,
        "stats": stats,
        "backup": str(backup_path) if backup_path else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
