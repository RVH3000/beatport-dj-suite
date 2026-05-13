#!/usr/bin/env python3
"""
Read-only Query für bp_artists. Emittiert JSON für die UI.

Unterstützt:
  list            → sortierte Liste aller Artists (default nach release_count DESC)
  stats           → Gesamt-Zahlen (count, synced_at, etc.)

Safety: öffnet DB mit PRAGMA query_only = ON.
Defensiv: fehlende Tabelle bp_artists → {ok:true, missing_table:true, ...}
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def cmd_list(conn: sqlite3.Connection, order: str, limit: int, only_followed: bool) -> dict:
    if not table_exists(conn, "bp_artists"):
        return {"ok": True, "count": 0, "artists": [], "missing_table": True}

    order_sql = {
        "name":          "name COLLATE NOCASE ASC",
        "release_count": "release_count DESC",
        "track_count":   "track_count DESC",
        "recent":        "first_seen_at DESC",
        "id":            "id ASC",
    }.get(order, "release_count DESC")

    where = "WHERE is_followed = 1" if only_followed else ""
    sql = f"""
        SELECT id, name, slug, release_count, track_count, image_id, image_uri, image_dynamic,
               is_followed, last_synced_at, first_seen_at
        FROM bp_artists
        {where}
        ORDER BY {order_sql}
        LIMIT ?
    """
    rows = [dict(r) for r in conn.execute(sql, (limit,)).fetchall()]
    return {"ok": True, "count": len(rows), "artists": rows}


def cmd_stats(conn: sqlite3.Connection) -> dict:
    if not table_exists(conn, "bp_artists"):
        return {
            "ok": True,
            "total": 0,
            "followed": 0,
            "with_images": 0,
            "total_releases": 0,
            "total_tracks": 0,
            "last_synced_at": None,
            "missing_table": True,
        }

    total = conn.execute("SELECT COUNT(*) FROM bp_artists").fetchone()[0]
    followed = conn.execute("SELECT COUNT(*) FROM bp_artists WHERE is_followed = 1").fetchone()[0]
    with_images = conn.execute(
        "SELECT COUNT(*) FROM bp_artists WHERE image_uri IS NOT NULL"
    ).fetchone()[0]
    totals_row = conn.execute(
        "SELECT SUM(release_count) AS releases, SUM(track_count) AS tracks FROM bp_artists WHERE is_followed = 1"
    ).fetchone()
    last_sync = conn.execute(
        "SELECT MAX(last_synced_at) FROM bp_artists"
    ).fetchone()[0]
    return {
        "ok": True,
        "total": total,
        "followed": followed,
        "with_images": with_images,
        "total_releases": int(totals_row["releases"] or 0),
        "total_tracks": int(totals_row["tracks"] or 0),
        "last_synced_at": last_sync,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list")
    p_list.add_argument("--order", default="release_count",
                        choices=["name", "release_count", "track_count", "recent", "id"])
    p_list.add_argument("--limit", type=int, default=5000)
    p_list.add_argument("--all", action="store_true",
                        help="auch entfollowte Artists einschliessen (Default: nur is_followed=1)")

    sub.add_parser("stats")

    args = parser.parse_args()
    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        emit({"ok": False, "error": f"DB nicht gefunden: {db_path}"})
        return 1

    conn = connect_readonly(db_path)
    try:
        if args.cmd == "list":
            emit(cmd_list(conn, args.order, args.limit, only_followed=not args.all))
        elif args.cmd == "stats":
            emit(cmd_stats(conn))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
