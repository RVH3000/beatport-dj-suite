#!/usr/bin/env python3
"""
Read-only Query für bp_labels. Emittiert JSON für die UI.

Unterstützt:
  list            → sortierte Liste aller Labels (default nach release_count DESC)
  stats           → Gesamt-Zahlen (count, synced_at, top-genres wenn später joinbar)

Safety: öffnet DB mit PRAGMA query_only = ON.
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


def cmd_list(conn: sqlite3.Connection, order: str, limit: int) -> dict:
    order_sql = {
        "name":  "name COLLATE NOCASE ASC",
        "count": "release_count DESC",
        "recent": "first_seen_at DESC",
        "id":    "id ASC",
    }.get(order, "release_count DESC")

    sql = f"""
        SELECT id, name, release_count, image_id, image_uri, image_dynamic,
               is_followed, last_synced_at, first_seen_at
        FROM bp_labels
        ORDER BY {order_sql}
        LIMIT ?
    """
    rows = [dict(r) for r in conn.execute(sql, (limit,)).fetchall()]
    return {"ok": True, "count": len(rows), "labels": rows}


def cmd_stats(conn: sqlite3.Connection) -> dict:
    total = conn.execute("SELECT COUNT(*) FROM bp_labels").fetchone()[0]
    followed = conn.execute("SELECT COUNT(*) FROM bp_labels WHERE is_followed = 1").fetchone()[0]
    with_images = conn.execute(
        "SELECT COUNT(*) FROM bp_labels WHERE image_uri IS NOT NULL"
    ).fetchone()[0]
    zero_count = conn.execute("SELECT COUNT(*) FROM bp_labels WHERE release_count = 0").fetchone()[0]
    totals_row = conn.execute("SELECT SUM(release_count) AS s FROM bp_labels").fetchone()
    last_sync = conn.execute(
        "SELECT MAX(last_synced_at) FROM bp_labels"
    ).fetchone()[0]
    return {
        "ok": True,
        "total": total,
        "followed": followed,
        "with_images": with_images,
        "zero_release_count": zero_count,
        "total_releases": int(totals_row["s"] or 0),
        "last_synced_at": last_sync,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list")
    p_list.add_argument("--order", default="count", choices=["name", "count", "recent", "id"])
    p_list.add_argument("--limit", type=int, default=1000)

    sub.add_parser("stats")

    args = parser.parse_args()
    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        emit({"ok": False, "error": f"DB nicht gefunden: {db_path}"})
        return 1

    conn = connect_readonly(db_path)
    try:
        if args.cmd == "list":
            emit(cmd_list(conn, args.order, args.limit))
        elif args.cmd == "stats":
            emit(cmd_stats(conn))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
