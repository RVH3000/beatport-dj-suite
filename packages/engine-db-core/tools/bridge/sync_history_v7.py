#!/usr/bin/env python3
"""Bridge Schritt 7 — synthetische History-Eintraege mit korrekter Library-Bindung.

Unterschied zu sync_history.py (Schritt 5):
- originDatabaseUuid wird aus m.db.Information.uuid der Sandbox-Library gelesen
  (statt einer frischen uuid4). Engine DJ kann die Session damit der aktiven
  Library zuordnen.
- originDriveName per CLI ueberschreibbar (--drive-name). Default: NULL fuer
  interne Drive. Fuer externe Drives Volume-Label setzen (z.B. MOVESPEED).
- originListId-Counter beruecksichtigt die LOKALE UUID (statt der frischen).

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
EXIT_UUID_MISSING = 6

SQL_INSERT_HISTORYLIST = """
INSERT INTO Historylist
    (sessionId, title, startTime, timezone,
     originDriveName, originDatabaseUuid, originListId, isDeleted)
VALUES (?, NULL, ?, ?, ?, ?, ?, 0)
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

SQL_LIBRARY_UUID = "SELECT uuid FROM Information ORDER BY id LIMIT 1"


def resolve_paths(db_dir_override: Optional[str]) -> tuple[str, str]:
    db_dir = db_dir_override or os.environ.get("BRIDGE_DB_DIR", DEFAULT_DB_DIR)
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


def read_library_uuid(m_db_path: str) -> str:
    conn = sqlite3.connect(f"file:{m_db_path}?mode=ro", uri=True)
    try:
        row = conn.execute(SQL_LIBRARY_UUID).fetchone()
        if row is None or not row[0]:
            print(
                "ABBRUCH: Keine Information.uuid in m.db gefunden.",
                file=sys.stderr,
            )
            sys.exit(EXIT_UUID_MISSING)
        return row[0]
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
    drive_name: Optional[str],
    dry_run: bool,
) -> dict:
    now = int(time.time())
    library_uuid = read_library_uuid(m_db_path)
    played_indicator = _random_signed_int64()
    session_id = _random_positive_int32()

    entity_plan = [
        (idx, tid, now + idx * TRACK_OFFSET_SECONDS)
        for idx, tid in enumerate(track_ids)
    ]

    print("=" * 60)
    print(f"Bridge-Plan v7 ({'DRY-RUN' if dry_run else 'LIVE'}):")
    print(f"  m_db            : {m_db_path}")
    print(f"  hm_db           : {hm_db_path}")
    print(f"  tracks          : {len(track_ids)} -> {track_ids}")
    print(f"  timezone        : {timezone}")
    print(f"  session_id      : {session_id}")
    print(f"  origin_uuid     : {library_uuid}   (aus m.db.Information)")
    print(f"  origin_drive    : {drive_name!r}   (NULL = interne Drive)")
    print(f"  played_indicator: {played_indicator}")
    print(f"  startTime       : {now}")

    m_db = sqlite3.connect(m_db_path)
    hm_db = sqlite3.connect(hm_db_path)
    try:
        origin_list_id = get_next_origin_list_id(hm_db, library_uuid)
        print(f"  origin_list_id  : {origin_list_id}")
        print("=" * 60)

        historylist_params = (
            session_id,
            now,
            timezone,
            drive_name,
            library_uuid,
            origin_list_id,
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
            "origin_database_uuid": library_uuid,
            "origin_drive_name": drive_name,
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


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Bridge Schritt 7: synthetische History-Eintraege mit korrekter "
            "Library-Bindung (UUID aus m.db.Information, optional Drive-Name)."
        ),
    )
    p.add_argument(
        "--db-dir",
        default=None,
        help=f"Database2-Pfad (muss SANDBOX-Marker enthalten). Default: {DEFAULT_DB_DIR}",
    )
    p.add_argument(
        "--track-ids",
        help="Komma-separierte Track-IDs, z.B. 26888,26966,26976,27069,27114",
    )
    p.add_argument(
        "--timezone",
        default=DEFAULT_TIMEZONE,
        help=f"Timezone fuer Historylist (default: {DEFAULT_TIMEZONE})",
    )
    p.add_argument(
        "--drive-name",
        default=None,
        help=(
            "originDriveName-Wert. Default: NULL (interne Drive). "
            "Fuer externe Drive Volume-Label setzen (z.B. MOVESPEED)."
        ),
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan loggen, nichts committen.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    m_db_path, hm_db_path = resolve_paths(args.db_dir)
    print(f"[engine-paths] m.db : {m_db_path}")
    print(f"[engine-paths] hm.db: {hm_db_path}")

    if not args.track_ids:
        print("ABBRUCH: --track-ids fehlt.", file=sys.stderr)
        return EXIT_USAGE

    track_ids = parse_track_ids(args.track_ids)
    assert_engine_dj_not_running()
    validate_track_ids(m_db_path, track_ids)

    result = run_bridge(
        m_db_path,
        hm_db_path,
        track_ids,
        args.timezone,
        args.drive_name,
        args.dry_run,
    )
    print("\n" + "=" * 60)
    print("Ergebnis:")
    for key, value in result.items():
        print(f"  {key}: {value}")
    print("=" * 60)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
