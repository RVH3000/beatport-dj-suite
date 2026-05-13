#!/usr/bin/env python3
"""Bridge PoC Schritt 5 — synthetische History-Eintraege in der Sandbox.

Schreibt ausschliesslich in die Sandbox-DB, erzwungen per Substring-Assertion
auf den Datenbank-Pfad (muss 'SANDBOX' enthalten). Details: README.md.
"""
from __future__ import annotations

import argparse
import os
import secrets
import sqlite3
import subprocess
import sys
import time
import uuid
from typing import Optional


SANDBOX_MARKER = "SANDBOX"
DEFAULT_DB_DIR = "/Users/roberth./Music/Engine Library SANDBOX-claude/Database2"
PRODUCTION_DB_DIR = "/Users/roberth./Music/Engine Library/Database2"
DEFAULT_TIMEZONE = "Europe/Vienna"
TRACK_OFFSET_SECONDS = 420

EXIT_OK = 0
EXIT_PATH_UNSAFE = 1
EXIT_ENGINE_RUNNING = 2
EXIT_TRACK_MISSING = 3
EXIT_DB_ERROR = 4
EXIT_USAGE = 5

SQL_INSERT_HISTORYLIST = """
INSERT INTO Historylist
    (sessionId, title, startTime, timezone,
     originDriveName, originDatabaseUuid, originListId, isDeleted)
VALUES (?, NULL, ?, ?, NULL, ?, ?, 0)
"""

SQL_INSERT_HISTORYLIST_ENTITY = """
INSERT INTO HistorylistEntity (listId, trackId, startTime)
VALUES (?, ?, ?)
"""

SQL_UPDATE_TRACK = """
UPDATE Track
SET isPlayed = 1,
    playedIndicator = ?,
    timeLastPlayed = ?
WHERE id = ?
"""

SQL_NEXT_ORIGIN_LIST_ID = (
    "SELECT MAX(originListId) FROM Historylist WHERE originDatabaseUuid = ?"
)


def resolve_paths() -> tuple[str, str]:
    db_dir = os.environ.get("BRIDGE_DB_DIR", DEFAULT_DB_DIR)
    if SANDBOX_MARKER not in db_dir:
        print(
            f"ABBRUCH: Pfad enthaelt nicht '{SANDBOX_MARKER}'. "
            f"Schreibzugriff auf Produktiv-DB ist blockiert.\n"
            f"Aktueller Pfad: {db_dir}",
            file=sys.stderr,
        )
        sys.exit(EXIT_PATH_UNSAFE)
    m_db = os.path.join(db_dir, "m.db")
    hm_db = os.path.join(db_dir, "hm.db")
    for path in (m_db, hm_db):
        if not os.path.exists(path):
            print(f"ABBRUCH: DB nicht gefunden: {path}", file=sys.stderr)
            sys.exit(EXIT_PATH_UNSAFE)
    return m_db, hm_db


def assert_engine_dj_not_running() -> None:
    result = subprocess.run(
        ["pgrep", "-f", "Engine DJ"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        pids = result.stdout.strip().splitlines()
        print(
            f"ABBRUCH: Engine DJ laeuft (PIDs: {', '.join(pids)}).\n"
            f"Beende Engine DJ manuell vor dem Bridge-Lauf.",
            file=sys.stderr,
        )
        sys.exit(EXIT_ENGINE_RUNNING)


def parse_track_ids(raw: str) -> list[int]:
    ids: list[int] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            ids.append(int(chunk))
        except ValueError:
            print(f"ABBRUCH: Ungueltige Track-ID: {chunk!r}", file=sys.stderr)
            sys.exit(EXIT_USAGE)
    if not ids:
        print("ABBRUCH: Keine Track-IDs uebergeben.", file=sys.stderr)
        sys.exit(EXIT_USAGE)
    return ids


def validate_track_ids(m_db_path: str, track_ids: list[int]) -> None:
    conn = sqlite3.connect(m_db_path)
    try:
        unique = list(dict.fromkeys(track_ids))
        placeholders = ",".join(["?"] * len(unique))
        rows = conn.execute(
            f"SELECT id FROM Track WHERE id IN ({placeholders})",
            unique,
        ).fetchall()
        found = {row[0] for row in rows}
        missing = [tid for tid in unique if tid not in found]
        if missing:
            print(
                "ABBRUCH: Track-IDs nicht in m.db.Track gefunden: "
                + ", ".join(str(m) for m in missing),
                file=sys.stderr,
            )
            sys.exit(EXIT_TRACK_MISSING)
    finally:
        conn.close()


def _random_signed_int64() -> int:
    value = secrets.randbits(64)
    if value >= 2**63:
        value -= 2**64
    return value


def _random_positive_int32() -> int:
    return secrets.randbits(31)


def get_next_origin_list_id(hm_db: sqlite3.Connection, uuid_str: str) -> int:
    row = hm_db.execute(SQL_NEXT_ORIGIN_LIST_ID, (uuid_str,)).fetchone()
    return 1 if row[0] is None else row[0] + 1


def run_bridge(
    m_db_path: str,
    hm_db_path: str,
    track_ids: list[int],
    timezone: str,
    dry_run: bool,
) -> dict:
    now = int(time.time())
    fresh_uuid = str(uuid.uuid4())
    played_indicator = _random_signed_int64()
    session_id = _random_positive_int32()

    entity_plan = [
        (idx, tid, now + idx * TRACK_OFFSET_SECONDS)
        for idx, tid in enumerate(track_ids)
    ]

    print("=" * 60)
    print(f"Bridge-Plan ({'DRY-RUN' if dry_run else 'LIVE'}):")
    print(f"  m_db            : {m_db_path}")
    print(f"  hm_db           : {hm_db_path}")
    print(f"  tracks          : {len(track_ids)} -> {track_ids}")
    print(f"  timezone        : {timezone}")
    print(f"  session_id      : {session_id}")
    print(f"  origin_uuid     : {fresh_uuid}")
    print(f"  played_indicator: {played_indicator}")
    print(f"  startTime       : {now}")

    m_db = sqlite3.connect(m_db_path)
    hm_db = sqlite3.connect(hm_db_path)
    try:
        origin_list_id = get_next_origin_list_id(hm_db, fresh_uuid)
        print(f"  origin_list_id  : {origin_list_id}")
        print("=" * 60)

        historylist_params = (
            session_id, now, timezone, fresh_uuid, origin_list_id,
        )
        print("\n[1/3] INSERT Historylist")
        print(f"  params={historylist_params}")
        if dry_run:
            list_id: Optional[int] = None
        else:
            cur = hm_db.execute(SQL_INSERT_HISTORYLIST, historylist_params)
            list_id = cur.lastrowid

        print(f"\n[2/3] INSERT HistorylistEntity (x{len(track_ids)})")
        print(f"[3/3] UPDATE Track (x{len(track_ids)})")
        for idx, track_id, track_time in entity_plan:
            if not dry_run:
                hm_db.execute(
                    SQL_INSERT_HISTORYLIST_ENTITY,
                    (list_id, track_id, track_time),
                )
                m_db.execute(
                    SQL_UPDATE_TRACK,
                    (played_indicator, track_time, track_id),
                )
            print(
                f"  [{idx}] track_id={track_id} "
                f"startTime={track_time} (delta={idx * TRACK_OFFSET_SECONDS}s)"
            )

        if dry_run:
            print("\nDRY-RUN: keine DB-Aenderungen, kein Commit.")
        else:
            m_db.commit()
            print("\n[commit] m.db OK")
            hm_db.commit()
            print("[commit] hm.db OK")

        return {
            "mode": "dry-run" if dry_run else "live",
            "list_id": list_id,
            "session_id": session_id,
            "origin_database_uuid": fresh_uuid,
            "origin_list_id": origin_list_id,
            "played_indicator": played_indicator,
            "track_count": len(track_ids),
            "start_time": now,
        }

    except Exception as exc:
        print(f"\nFEHLER: {exc}", file=sys.stderr)
        try:
            m_db.rollback()
        except sqlite3.Error:
            pass
        try:
            hm_db.rollback()
        except sqlite3.Error:
            pass
        sys.exit(EXIT_DB_ERROR)
    finally:
        m_db.close()
        hm_db.close()


def run_verify(
    m_db_path: str,
    hm_db_path: str,
    list_id: Optional[int],
    track_ids: Optional[list[int]],
) -> None:
    print("=" * 60)
    print("Verify-Mode")
    print(f"  m_db : {m_db_path}")
    print(f"  hm_db: {hm_db_path}")
    print("=" * 60)

    hm = sqlite3.connect(hm_db_path)
    m = sqlite3.connect(m_db_path)
    try:
        if list_id is None:
            row = hm.execute(
                "SELECT id FROM Historylist ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row is None:
                print("Keine Historylist-Eintraege gefunden.")
                return
            list_id = row[0]

        print(f"\n[Check 3] Historylist id={list_id}")
        meta = hm.execute(
            "SELECT id, sessionId, startTime, timezone, "
            "originDatabaseUuid, originListId, isDeleted "
            "FROM Historylist WHERE id = ?",
            (list_id,),
        ).fetchone()
        if meta is None:
            print(f"  KEINE Historylist mit id={list_id}")
            return
        (hid, sid, start, tz, uuid_str, olid, is_del) = meta
        print(
            f"  sessionId={sid} startTime={start} timezone={tz}\n"
            f"  originDatabaseUuid={uuid_str} originListId={olid} "
            f"isDeleted={is_del}"
        )

        print(f"\n[Check 4] HistorylistEntity WHERE listId={list_id}")
        entities = hm.execute(
            "SELECT id, trackId, startTime FROM HistorylistEntity "
            "WHERE listId = ? ORDER BY id",
            (list_id,),
        ).fetchall()
        for r in entities:
            print(f"  entity_id={r[0]} trackId={r[1]} startTime={r[2]}")
        print(f"  Total: {len(entities)} Zeile(n)")
        entity_track_ids = [r[1] for r in entities]

        tracks_to_check = track_ids if track_ids else entity_track_ids
        if not tracks_to_check:
            print("\n[Check 2/Bonus] keine Track-IDs zu pruefen.")
            return

        print(f"\n[Check 2] m.db.Track fuer {tracks_to_check}")
        placeholders = ",".join(["?"] * len(tracks_to_check))
        sandbox_rows = m.execute(
            f"SELECT id, title, isPlayed, playedIndicator, timeLastPlayed "
            f"FROM Track WHERE id IN ({placeholders}) ORDER BY id",
            tracks_to_check,
        ).fetchall()
        for r in sandbox_rows:
            print(
                f"  id={r[0]} isPlayed={r[2]} playedIndicator={r[3]} "
                f"timeLastPlayed={r[4]} title={r[1]!r}"
            )

        prod_m_db = os.path.join(PRODUCTION_DB_DIR, "m.db")
        print(f"\n[Bonus] Produktiv-m.db (Read-Only): {prod_m_db}")
        if not os.path.exists(prod_m_db):
            print("  Produktiv-DB nicht gefunden — Bonus-Check uebersprungen.")
            return
        prod = sqlite3.connect(f"file:{prod_m_db}?mode=ro", uri=True)
        try:
            prod_rows = prod.execute(
                f"SELECT id, isPlayed, playedIndicator, timeLastPlayed "
                f"FROM Track WHERE id IN ({placeholders}) ORDER BY id",
                tracks_to_check,
            ).fetchall()
            for r in prod_rows:
                print(
                    f"  id={r[0]} isPlayed={r[1]} playedIndicator={r[2]} "
                    f"timeLastPlayed={r[3]}"
                )
        finally:
            prod.close()
    finally:
        hm.close()
        m.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Bridge PoC Schritt 5: synthetische History-Eintraege in der "
            "Engine DJ Sandbox-DB erzeugen."
        ),
    )
    p.add_argument(
        "--track-ids",
        help="Komma-separierte Track-IDs, z.B. 9837,9839,9840",
    )
    p.add_argument(
        "--timezone",
        default=DEFAULT_TIMEZONE,
        help=f"Timezone fuer Historylist (default: {DEFAULT_TIMEZONE})",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan loggen, nichts committen.",
    )
    p.add_argument(
        "--verify",
        action="store_true",
        help="Verify-Mode: letzte Historylist + Track-Zustand + Bonus-Check.",
    )
    p.add_argument(
        "--list-id",
        type=int,
        default=None,
        help="(Verify) spezifische Historylist-ID. Default: zuletzt eingefuegte.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    m_db_path, hm_db_path = resolve_paths()
    print(f"[engine-paths] m.db : {m_db_path}")
    print(f"[engine-paths] hm.db: {hm_db_path}")

    if args.verify:
        track_ids = parse_track_ids(args.track_ids) if args.track_ids else None
        run_verify(m_db_path, hm_db_path, args.list_id, track_ids)
        return EXIT_OK

    if not args.track_ids:
        print(
            "ABBRUCH: --track-ids fehlt (ausser im --verify-Modus).",
            file=sys.stderr,
        )
        return EXIT_USAGE

    track_ids = parse_track_ids(args.track_ids)
    assert_engine_dj_not_running()
    validate_track_ids(m_db_path, track_ids)

    result = run_bridge(
        m_db_path, hm_db_path, track_ids, args.timezone, args.dry_run,
    )
    print("\n" + "=" * 60)
    print("Ergebnis:")
    for key, value in result.items():
        print(f"  {key}: {value}")
    print("=" * 60)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
