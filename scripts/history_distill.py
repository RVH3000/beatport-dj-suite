#!/usr/bin/env python3
"""History Distill — Engine-DJ-History zu Master-Playlist destillieren.

Phase 0 (scan): Liest hm.db + m.db read-only, zeigt Statistik —
Sessions, Tracks, Duplikate, Streaming-Anteil, Verteilungen.

Phase 1 (distill): Generiert Master-Playlist als JSON.       [TODO]
Phase 2 (split):   Aus Master Sub-Playlists ableiten.        [TODO]
Phase 3 (export):  In M3U/Beatport/Engine/Lexicon/Rekordbox. [TODO]

Sicherheit:
- Reine SELECT-Pipeline. Verbindung wird im read-only-Modus geoeffnet
  (sqlite3 URI 'mode=ro'). Es gibt KEINE INSERT/UPDATE/DELETE-Statements.
- Original-Library wird nicht modifiziert. Output geht in --output-Pfade.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXIT_OK = 0
EXIT_USAGE = 1
EXIT_PATH_INVALID = 2
EXIT_DB_ERROR = 3


# ── Engine-DJ Pfad-Auflösung ──────────────────────────────────────────────

def resolve_db_paths(library_path: Path) -> tuple[Path, Path]:
    """Aus einem Engine-Library-Pfad m.db und hm.db ableiten."""
    if library_path.name == "Database2":
        db_dir = library_path
    elif (library_path / "Database2").is_dir():
        db_dir = library_path / "Database2"
    else:
        db_dir = library_path
    m_db = db_dir / "m.db"
    hm_db = db_dir / "hm.db"
    if not m_db.is_file():
        raise FileNotFoundError(f"m.db nicht gefunden: {m_db}")
    if not hm_db.is_file():
        raise FileNotFoundError(f"hm.db nicht gefunden: {hm_db}")
    return m_db, hm_db


def open_readonly(db_path: Path) -> sqlite3.Connection:
    """SQLite-Verbindung im read-only-Modus oeffnen (URI mode=ro)."""
    uri = f"file:{db_path}?mode=ro"
    return sqlite3.connect(uri, uri=True)


# ── Phase 0: scan ─────────────────────────────────────────────────────────

@dataclass
class ScanReport:
    library_path: str
    m_db_path: str
    hm_db_path: str
    generated_at: str

    # Sessions
    sessions_total: int = 0
    sessions_active: int = 0          # nicht isDeleted
    sessions_deleted: int = 0
    sessions_with_tracks: int = 0
    sessions_empty: int = 0           # keine HistorylistEntity-Eintraege
    earliest_session: str | None = None
    latest_session: str | None = None

    # Plays
    plays_total: int = 0              # Anzahl HistorylistEntity-Eintraege
    plays_avg_per_session: float = 0.0
    unique_tracks_played: int = 0     # Anzahl distinct trackId mit ≥1 Play
    plays_orphan: int = 0             # trackId hat keine Track-Zeile in m.db

    # Track-Universum (m.db)
    tracks_total: int = 0
    tracks_with_at_least_one_play: int = 0
    tracks_never_played: int = 0

    # Quellen / streamingSource
    source_distribution: dict[str, int] = field(default_factory=dict)

    # Metadaten-Vollstaendigkeit (auf Tracks mit ≥1 Play)
    missing_genre: int = 0
    missing_label: int = 0
    missing_key: int = 0
    missing_bpm: int = 0

    # Top-Listen
    top_tracks_by_plays: list[dict[str, Any]] = field(default_factory=list)
    top_genres: list[dict[str, Any]] = field(default_factory=list)
    top_labels: list[dict[str, Any]] = field(default_factory=list)
    bpm_histogram: dict[str, int] = field(default_factory=dict)
    key_distribution: dict[str, int] = field(default_factory=dict)

    # Duplikate (gleicher Title+Artist, aber andere id) — Merge-Kandidaten
    title_artist_duplicates: int = 0
    sample_duplicates: list[dict[str, Any]] = field(default_factory=list)


def _ts_to_iso(ts: int | None) -> str | None:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (ValueError, OSError):
        return None


def _bpm_bucket(bpm: float | None) -> str:
    if bpm is None or bpm <= 0:
        return "unbekannt"
    b = int(bpm)
    if b < 80:
        return "<80"
    if b < 100:
        return "80-99"
    if b < 120:
        return "100-119"
    if b < 130:
        return "120-129"
    if b < 140:
        return "130-139"
    if b < 150:
        return "140-149"
    if b < 175:
        return "150-174"
    return "≥175"


def _key_label(key: int | None) -> str:
    if key is None:
        return "unbekannt"
    # Engine-DJ key ist 0-23 (Open Key 1A-12B). Roh-Wert reicht fuer Verteilung.
    return f"key_{key:02d}"


def scan_library(library_path: Path, top_n: int = 30) -> ScanReport:
    m_db_path, hm_db_path = resolve_db_paths(library_path)
    report = ScanReport(
        library_path=str(library_path),
        m_db_path=str(m_db_path),
        hm_db_path=str(hm_db_path),
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )

    # ── hm.db: Sessions + Plays ───────────────────────────────────────────
    with open_readonly(hm_db_path) as hm_conn:
        hm_conn.row_factory = sqlite3.Row
        hm = hm_conn.cursor()

        hm.execute("SELECT COUNT(*) FROM Historylist")
        report.sessions_total = hm.fetchone()[0]

        hm.execute("SELECT COUNT(*) FROM Historylist WHERE isDeleted = 0")
        report.sessions_active = hm.fetchone()[0]
        report.sessions_deleted = report.sessions_total - report.sessions_active

        hm.execute("""
            SELECT COUNT(DISTINCT hl.id)
            FROM Historylist hl
            JOIN HistorylistEntity hle ON hle.listId = hl.id
            WHERE hl.isDeleted = 0
        """)
        report.sessions_with_tracks = hm.fetchone()[0]
        report.sessions_empty = report.sessions_active - report.sessions_with_tracks

        hm.execute("SELECT MIN(startTime), MAX(startTime) FROM Historylist WHERE isDeleted = 0 AND startTime > 0")
        row = hm.fetchone()
        report.earliest_session = _ts_to_iso(row[0])
        report.latest_session = _ts_to_iso(row[1])

        hm.execute("""
            SELECT COUNT(*)
            FROM HistorylistEntity hle
            JOIN Historylist hl ON hl.id = hle.listId
            WHERE hl.isDeleted = 0
        """)
        report.plays_total = hm.fetchone()[0]
        report.plays_avg_per_session = (
            round(report.plays_total / report.sessions_with_tracks, 1)
            if report.sessions_with_tracks else 0.0
        )

        hm.execute("""
            SELECT COUNT(DISTINCT hle.trackId)
            FROM HistorylistEntity hle
            JOIN Historylist hl ON hl.id = hle.listId
            WHERE hl.isDeleted = 0
        """)
        report.unique_tracks_played = hm.fetchone()[0]

        # Plays pro trackId aggregieren — fuer Top-Tracks und Orphan-Detection
        hm.execute("""
            SELECT hle.trackId, COUNT(*) AS plays, MAX(hle.startTime) AS last_played
            FROM HistorylistEntity hle
            JOIN Historylist hl ON hl.id = hle.listId
            WHERE hl.isDeleted = 0
            GROUP BY hle.trackId
        """)
        plays_by_track: dict[int, dict[str, Any]] = {
            row["trackId"]: {"plays": row["plays"], "last_played": row["last_played"]}
            for row in hm.fetchall()
        }

    # ── m.db: Tracks-Universum ────────────────────────────────────────────
    with open_readonly(m_db_path) as m_conn:
        m_conn.row_factory = sqlite3.Row
        m = m_conn.cursor()

        m.execute("SELECT COUNT(*) FROM Track")
        report.tracks_total = m.fetchone()[0]

        # Quellen-Verteilung
        m.execute("SELECT IFNULL(NULLIF(streamingSource, ''), 'lokal') AS src, COUNT(*) FROM Track GROUP BY src")
        report.source_distribution = {row[0]: row[1] for row in m.fetchall()}

        # Track-Metadaten fuer alle gespielten Tracks holen (in Chunks, falls viele)
        played_track_ids = list(plays_by_track.keys())
        track_meta: dict[int, dict[str, Any]] = {}
        if played_track_ids:
            CHUNK = 500
            for i in range(0, len(played_track_ids), CHUNK):
                chunk = played_track_ids[i:i + CHUNK]
                placeholders = ",".join("?" * len(chunk))
                m.execute(
                    f"""SELECT id, title, artist, genre, label, key, bpm, rating,
                               streamingSource
                        FROM Track WHERE id IN ({placeholders})""",
                    chunk,
                )
                for row in m.fetchall():
                    track_meta[row["id"]] = dict(row)

        # Orphans: trackIds in History, die keine m.db.Track-Zeile haben
        report.plays_orphan = sum(
            1 for tid in played_track_ids if tid not in track_meta
        )
        report.tracks_with_at_least_one_play = len(track_meta)
        report.tracks_never_played = report.tracks_total - report.tracks_with_at_least_one_play

        # Metadaten-Vollstaendigkeit (auf gespielten Tracks)
        for tid, meta in track_meta.items():
            if not meta.get("genre"):
                report.missing_genre += 1
            if not meta.get("label"):
                report.missing_label += 1
            if meta.get("key") in (None, 0):
                report.missing_key += 1
            bpm = meta.get("bpm")
            if bpm is None or bpm <= 0:
                report.missing_bpm += 1

        # Top-Tracks nach Plays
        sorted_plays = sorted(
            plays_by_track.items(),
            key=lambda kv: kv[1]["plays"],
            reverse=True,
        )[:top_n]
        for tid, info in sorted_plays:
            meta = track_meta.get(tid, {})
            report.top_tracks_by_plays.append({
                "track_id": tid,
                "plays": info["plays"],
                "last_played": _ts_to_iso(info["last_played"]),
                "title": meta.get("title"),
                "artist": meta.get("artist"),
                "genre": meta.get("genre"),
                "label": meta.get("label"),
                "bpm": meta.get("bpm"),
                "rating": meta.get("rating"),
                "streaming_source": meta.get("streamingSource") or "lokal",
            })

        # Verteilungen
        genre_counter: Counter[str] = Counter()
        label_counter: Counter[str] = Counter()
        bpm_counter: Counter[str] = Counter()
        key_counter: Counter[str] = Counter()
        for meta in track_meta.values():
            g = meta.get("genre") or "(leer)"
            la = meta.get("label") or "(leer)"
            genre_counter[g] += 1
            label_counter[la] += 1
            bpm_counter[_bpm_bucket(meta.get("bpm"))] += 1
            key_counter[_key_label(meta.get("key"))] += 1

        report.top_genres = [
            {"genre": k, "tracks": v} for k, v in genre_counter.most_common(top_n)
        ]
        report.top_labels = [
            {"label": k, "tracks": v} for k, v in label_counter.most_common(top_n)
        ]
        report.bpm_histogram = dict(bpm_counter.most_common())
        report.key_distribution = dict(key_counter.most_common())

        # Duplikate: Title+Artist Kombination, aber unterschiedliche IDs
        m.execute("""
            SELECT LOWER(TRIM(title)) AS t, LOWER(TRIM(artist)) AS a, COUNT(*) AS n
            FROM Track
            WHERE title IS NOT NULL AND title != '' AND artist IS NOT NULL AND artist != ''
            GROUP BY t, a
            HAVING COUNT(*) > 1
            ORDER BY n DESC
            LIMIT ?
        """, (top_n,))
        dup_rows = m.fetchall()
        report.title_artist_duplicates = sum(row["n"] for row in dup_rows)
        report.sample_duplicates = [
            {"title": row["t"], "artist": row["a"], "copies": row["n"]}
            for row in dup_rows
        ]

    return report


# ── Output-Formatter ──────────────────────────────────────────────────────

def _fmt_int(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def _percent(part: int, total: int) -> str:
    if total == 0:
        return "—"
    return f"{round(100 * part / total, 1)}%"


def render_console(report: ScanReport) -> str:
    lines: list[str] = []
    lines.append("=" * 72)
    lines.append("HISTORY DISTILL — SCAN")
    lines.append("=" * 72)
    lines.append(f"Library  : {report.library_path}")
    lines.append(f"m.db     : {report.m_db_path}")
    lines.append(f"hm.db    : {report.hm_db_path}")
    lines.append(f"Erzeugt  : {report.generated_at}")
    lines.append("")
    lines.append("── SESSIONS ──")
    lines.append(f"  Total              : {_fmt_int(report.sessions_total)}")
    lines.append(f"  Aktiv              : {_fmt_int(report.sessions_active)}")
    lines.append(f"  Geloescht          : {_fmt_int(report.sessions_deleted)}")
    lines.append(f"  Mit Tracks         : {_fmt_int(report.sessions_with_tracks)}")
    lines.append(f"  Leer (kein Track)  : {_fmt_int(report.sessions_empty)}")
    lines.append(f"  Erste Session      : {report.earliest_session or '—'}")
    lines.append(f"  Letzte Session     : {report.latest_session or '—'}")
    lines.append("")
    lines.append("── PLAYS ──")
    lines.append(f"  Total Plays        : {_fmt_int(report.plays_total)}")
    lines.append(f"  Avg pro Session    : {report.plays_avg_per_session}")
    lines.append(f"  Unique Tracks      : {_fmt_int(report.unique_tracks_played)}")
    lines.append(f"  Orphan-Plays       : {_fmt_int(report.plays_orphan)} (Track nicht mehr in m.db)")
    lines.append("")
    lines.append("── TRACK-UNIVERSUM (m.db) ──")
    lines.append(f"  Tracks total       : {_fmt_int(report.tracks_total)}")
    lines.append(f"  Mit Plays          : {_fmt_int(report.tracks_with_at_least_one_play)} "
                 f"({_percent(report.tracks_with_at_least_one_play, report.tracks_total)})")
    lines.append(f"  Nie gespielt       : {_fmt_int(report.tracks_never_played)} "
                 f"({_percent(report.tracks_never_played, report.tracks_total)})")
    lines.append("")
    lines.append("── QUELLEN (alle Tracks) ──")
    for src, n in sorted(report.source_distribution.items(), key=lambda kv: kv[1], reverse=True):
        lines.append(f"  {src:<20} : {_fmt_int(n):>10} ({_percent(n, report.tracks_total)})")
    lines.append("")
    played = report.tracks_with_at_least_one_play
    lines.append("── METADATA-LUECKEN (auf gespielten Tracks) ──")
    lines.append(f"  Ohne Genre         : {_fmt_int(report.missing_genre)} ({_percent(report.missing_genre, played)})")
    lines.append(f"  Ohne Label         : {_fmt_int(report.missing_label)} ({_percent(report.missing_label, played)})")
    lines.append(f"  Ohne Key           : {_fmt_int(report.missing_key)} ({_percent(report.missing_key, played)})")
    lines.append(f"  Ohne BPM           : {_fmt_int(report.missing_bpm)} ({_percent(report.missing_bpm, played)})")
    lines.append("")
    lines.append("── TOP-15 TRACKS NACH PLAYS ──")
    for i, t in enumerate(report.top_tracks_by_plays[:15], 1):
        title = (t.get("title") or "?")[:40]
        artist = (t.get("artist") or "?")[:25]
        lines.append(
            f"  {i:>2}. [{t['plays']:>3}x] {title:<40} — {artist:<25} "
            f"[{(t.get('genre') or '—')[:18]}] [{t.get('streaming_source')}]"
        )
    lines.append("")
    lines.append("── TOP-10 GENRES ──")
    for g in report.top_genres[:10]:
        lines.append(f"  {g['genre'][:40]:<40} : {_fmt_int(g['tracks'])}")
    lines.append("")
    lines.append("── BPM-HISTOGRAMM (gespielte Tracks) ──")
    bpm_order = ["<80", "80-99", "100-119", "120-129", "130-139", "140-149", "150-174", "≥175", "unbekannt"]
    for bucket in bpm_order:
        n = report.bpm_histogram.get(bucket, 0)
        if n:
            bar = "█" * min(40, max(1, n // max(1, played // 40))) if played else ""
            lines.append(f"  {bucket:<10} : {_fmt_int(n):>6} {bar}")
    lines.append("")
    lines.append("── DUPLIKATE (gleicher Title+Artist, andere ID) ──")
    lines.append(f"  Sample-Treffer     : {_fmt_int(report.title_artist_duplicates)}")
    for d in report.sample_duplicates[:8]:
        lines.append(f"   • {d['copies']}× {d['title'][:40]:<40} — {d['artist'][:25]}")
    lines.append("")
    lines.append("=" * 72)
    return "\n".join(lines)


# ── CLI ───────────────────────────────────────────────────────────────────

def cmd_scan(args: argparse.Namespace) -> int:
    library = Path(args.library).expanduser().resolve()
    if not library.exists():
        print(f"FEHLER: Library-Pfad existiert nicht: {library}", file=sys.stderr)
        return EXIT_PATH_INVALID
    try:
        report = scan_library(library, top_n=args.top_n)
    except FileNotFoundError as e:
        print(f"FEHLER: {e}", file=sys.stderr)
        return EXIT_PATH_INVALID
    except sqlite3.DatabaseError as e:
        print(f"FEHLER: SQLite: {e}", file=sys.stderr)
        return EXIT_DB_ERROR

    print(render_console(report))

    if args.output:
        out = Path(args.output).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(asdict(report), indent=2, ensure_ascii=False))
        print(f"\nJSON-Report : {out}")
    return EXIT_OK


def cmd_distill(_args: argparse.Namespace) -> int:
    print("TODO: distill — Master-Playlist generieren (JSON).", file=sys.stderr)
    return EXIT_USAGE


def cmd_split(_args: argparse.Namespace) -> int:
    print("TODO: split — Sub-Playlists aus Master ableiten.", file=sys.stderr)
    return EXIT_USAGE


def cmd_export(_args: argparse.Namespace) -> int:
    print("TODO: export — In Zielformate konvertieren.", file=sys.stderr)
    return EXIT_USAGE


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="history_distill",
        description="Engine-DJ-History zu Master-Playlist destillieren (read-only).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_scan = sub.add_parser("scan", help="Statistik-Scan (Phase 0).")
    p_scan.add_argument("--library", required=True,
                        help="Engine-Library-Pfad (Ordner mit Database2/m.db + hm.db).")
    p_scan.add_argument("--output", help="Optional: JSON-Report nach diesem Pfad schreiben.")
    p_scan.add_argument("--top-n", type=int, default=30,
                        help="Wieviele Top-Eintraege pro Liste (Default 30).")
    p_scan.set_defaults(func=cmd_scan)

    p_distill = sub.add_parser("distill", help="[TODO] Master-Playlist generieren.")
    p_distill.add_argument("--library", required=True)
    p_distill.add_argument("--output", required=True)
    p_distill.set_defaults(func=cmd_distill)

    p_split = sub.add_parser("split", help="[TODO] Sub-Playlists ableiten.")
    p_split.add_argument("master_json")
    p_split.add_argument("--by", choices=("genre", "key", "bpm", "rating", "year"))
    p_split.add_argument("--output-dir", required=True)
    p_split.set_defaults(func=cmd_split)

    p_export = sub.add_parser("export", help="[TODO] In Zielformate konvertieren.")
    p_export.add_argument("master_json")
    p_export.add_argument("--format", required=True,
                          help="Komma-separiert: m3u,beatport,engine,lexicon,rekordbox")
    p_export.add_argument("--output-dir", required=True)
    p_export.set_defaults(func=cmd_export)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
