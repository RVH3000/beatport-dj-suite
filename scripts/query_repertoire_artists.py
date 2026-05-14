#!/usr/bin/env python3
"""
Read-only Query für bp_repertoire_artists (Scanner-Repertoire-Aggregat).

Subcommands:
  list    — Liste mit Filter + Sort + Pagination
  stats   — Aggregat-Statistiken über alle Artists
  filters — verfuegbare Filter-Optionen (Genres, Labels, Year-Range)

Safety: oeffnet DB mit PRAGMA query_only = ON.
Defensiv: fehlende Tabelle → {ok:true, missing_table:true, ...}
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


def cmd_stats(conn: sqlite3.Connection) -> dict:
    if not table_exists(conn, "bp_repertoire_artists"):
        return {
            "ok": True,
            "total_artists": 0,
            "total_tracks": 0,
            "total_plays": 0,
            "year_range": [None, None],
            "missing_table": True,
        }

    total_artists = conn.execute("SELECT COUNT(*) FROM bp_repertoire_artists").fetchone()[0]
    total_tracks = conn.execute(
        "SELECT COUNT(*) FROM bp_repertoire_tracks"
    ).fetchone()[0] if table_exists(conn, "bp_repertoire_tracks") else 0
    total_plays = conn.execute(
        "SELECT SUM(plays_total) FROM bp_repertoire_artists"
    ).fetchone()[0] or 0
    year_row = conn.execute(
        "SELECT MIN(year_min), MAX(year_max) FROM bp_repertoire_artists "
        "WHERE year_min IS NOT NULL"
    ).fetchone()
    last_synced = conn.execute(
        "SELECT MAX(last_synced_at) FROM bp_repertoire_artists"
    ).fetchone()[0]

    return {
        "ok": True,
        "total_artists": total_artists,
        "total_tracks": total_tracks,
        "total_plays": int(total_plays),
        "year_range": [year_row[0], year_row[1]] if year_row else [None, None],
        "last_synced_at": last_synced,
    }


def cmd_list(conn: sqlite3.Connection, order: str, limit: int, offset: int,
             q: str, year_min: int | None, year_max: int | None,
             min_track_count: int | None) -> dict:
    if not table_exists(conn, "bp_repertoire_artists"):
        return {"ok": True, "count": 0, "artists": [], "missing_table": True}

    order_sql = {
        "track_count":  "track_count DESC, name COLLATE NOCASE ASC",
        "plays_total":  "plays_total DESC, track_count DESC",
        "name":         "name COLLATE NOCASE ASC",
        "year_max":     "year_max DESC NULLS LAST, track_count DESC",
        "year_min":     "year_min ASC NULLS LAST, track_count DESC",
    }.get(order, "track_count DESC, name COLLATE NOCASE ASC")

    where_clauses = []
    params: list = []
    if q:
        where_clauses.append("name LIKE ? COLLATE NOCASE")
        params.append(f"%{q}%")
    if year_min is not None:
        where_clauses.append("(year_max IS NULL OR year_max >= ?)")
        params.append(year_min)
    if year_max is not None:
        where_clauses.append("(year_min IS NULL OR year_min <= ?)")
        params.append(year_max)
    if min_track_count is not None:
        where_clauses.append("track_count >= ?")
        params.append(min_track_count)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # Gesamtanzahl nach Filter (vor Pagination)
    total_filtered = conn.execute(
        f"SELECT COUNT(*) FROM bp_repertoire_artists {where_sql}",
        params,
    ).fetchone()[0]

    sql = f"""
        SELECT id, name, track_count, plays_total, genres, labels,
               year_min, year_max, bpm_min, bpm_max,
               last_synced_at, first_seen_at
        FROM bp_repertoire_artists
        {where_sql}
        ORDER BY {order_sql}
        LIMIT ? OFFSET ?
    """
    rows = []
    for r in conn.execute(sql, params + [limit, offset]).fetchall():
        d = dict(r)
        # Genres + Labels als parsed Arrays zurueckgeben
        try:
            d["genres"] = json.loads(d.get("genres") or "[]")
        except json.JSONDecodeError:
            d["genres"] = []
        try:
            d["labels"] = json.loads(d.get("labels") or "[]")
        except json.JSONDecodeError:
            d["labels"] = []
        rows.append(d)
    return {
        "ok": True,
        "count": len(rows),
        "total_filtered": total_filtered,
        "artists": rows,
    }


def cmd_filters(conn: sqlite3.Connection) -> dict:
    """Sammelt verfuegbare Filter-Optionen aus den Daten."""
    if not table_exists(conn, "bp_repertoire_artists"):
        return {"ok": True, "missing_table": True}

    # Genres aus allen Artists sammeln (JSON-Arrays)
    genre_counter: dict[str, int] = {}
    label_counter: dict[str, int] = {}
    for row in conn.execute("SELECT genres, labels FROM bp_repertoire_artists"):
        try:
            for g in json.loads(row[0] or "[]"):
                genre_counter[g] = genre_counter.get(g, 0) + 1
        except json.JSONDecodeError:
            pass
        try:
            for l in json.loads(row[1] or "[]"):
                label_counter[l] = label_counter.get(l, 0) + 1
        except json.JSONDecodeError:
            pass

    top_genres = sorted(genre_counter.items(), key=lambda kv: -kv[1])[:50]
    top_labels = sorted(label_counter.items(), key=lambda kv: -kv[1])[:100]

    year_row = conn.execute(
        "SELECT MIN(year_min), MAX(year_max) FROM bp_repertoire_artists "
        "WHERE year_min IS NOT NULL"
    ).fetchone()

    return {
        "ok": True,
        "year_min": year_row[0],
        "year_max": year_row[1],
        "top_genres": [{"name": g, "count": c} for g, c in top_genres],
        "top_labels": [{"name": l, "count": c} for l, c in top_labels],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list")
    p_list.add_argument("--order", default="track_count",
                        choices=["track_count", "plays_total", "name", "year_max", "year_min"])
    p_list.add_argument("--limit", type=int, default=200)
    p_list.add_argument("--offset", type=int, default=0)
    p_list.add_argument("--q", default="", help="Filter-Text (Name)")
    p_list.add_argument("--year-min", type=int, default=None)
    p_list.add_argument("--year-max", type=int, default=None)
    p_list.add_argument("--min-tracks", type=int, default=None)

    sub.add_parser("stats")
    sub.add_parser("filters")

    args = parser.parse_args()
    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        emit({"ok": False, "error": f"DB nicht gefunden: {db_path}"})
        return 1

    conn = connect_readonly(db_path)
    try:
        if args.cmd == "list":
            emit(cmd_list(
                conn,
                args.order,
                args.limit,
                args.offset,
                args.q,
                args.year_min,
                args.year_max,
                args.min_tracks,
            ))
        elif args.cmd == "stats":
            emit(cmd_stats(conn))
        elif args.cmd == "filters":
            emit(cmd_filters(conn))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
