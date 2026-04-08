#!/usr/bin/env python3
"""
Beatport Label-Import: /v4/my/beatport/labels/ JSON → SQLite (bp_labels).

UPSERT by id. Setzt is_followed=1, last_synced_at=now.
first_seen_at wird nur beim ersten INSERT gesetzt (per Trigger geschützt).

Nutzung:
  python3 scripts/import_beatport_labels.py \
      --db    data/suite.db \
      --input ~/_handoff/bp_labels_response.json
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
    backup = db_path.with_suffix(f".backup-pre-labels-{ts}.db")
    shutil.copy2(str(db_path), str(backup))
    return backup


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Idempotent — legt Tabelle+Indices+Trigger an falls fehlt."""
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS bp_labels (
        id              INTEGER PRIMARY KEY,
        name            TEXT NOT NULL,
        release_count   INTEGER DEFAULT 0,
        image_id        INTEGER,
        image_uri       TEXT,
        image_dynamic   TEXT,
        is_followed     INTEGER DEFAULT 1,
        last_synced_at  TEXT NOT NULL,
        first_seen_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bp_labels_name     ON bp_labels(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_bp_labels_followed ON bp_labels(is_followed);
      CREATE INDEX IF NOT EXISTS idx_bp_labels_count    ON bp_labels(release_count DESC);
      CREATE TRIGGER IF NOT EXISTS bp_labels_first_seen_lock
      BEFORE UPDATE OF first_seen_at ON bp_labels
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    """)


def load_labels(input_path: Path) -> list[dict]:
    raw = json.loads(input_path.read_text("utf8"))
    # Response kann direkt eine Liste sein oder {"results": [...]} (Beatport-API-Standard)
    if isinstance(raw, dict) and "results" in raw:
        return raw["results"]
    if isinstance(raw, list):
        return raw
    raise ValueError("Unerwartete Response-Struktur: weder Liste noch {results:[]}")


def upsert_labels(conn: sqlite3.Connection, labels: list[dict]) -> dict:
    stats = {"inserted": 0, "updated": 0, "unchanged": 0, "skipped": 0}
    now = iso_utc_now()

    # Current rows für Vergleich (um "updated" vs "unchanged" zu unterscheiden)
    existing = {
        row["id"]: row
        for row in conn.execute(
            "SELECT id, name, release_count, image_id, image_uri, image_dynamic FROM bp_labels"
        ).fetchall()
    }
    conn.row_factory = sqlite3.Row

    for label in labels:
        lid = label.get("id")
        name = label.get("name")
        if not isinstance(lid, int) or not name:
            stats["skipped"] += 1
            continue

        count = int(label.get("count") or 0)
        img = label.get("image") or {}
        image_id = img.get("id")
        image_uri = img.get("uri")
        image_dynamic = img.get("dynamic_uri")

        if lid in existing:
            old = existing[lid]
            same = (
                old["name"] == name
                and (old["release_count"] or 0) == count
                and (old["image_id"] or None) == image_id
                and (old["image_uri"] or None) == image_uri
                and (old["image_dynamic"] or None) == image_dynamic
            )
            conn.execute(
                """
                UPDATE bp_labels SET
                    name = ?,
                    release_count = ?,
                    image_id = ?,
                    image_uri = ?,
                    image_dynamic = ?,
                    is_followed = 1,
                    last_synced_at = ?
                WHERE id = ?
                """,
                (name, count, image_id, image_uri, image_dynamic, now, lid),
            )
            stats["unchanged" if same else "updated"] += 1
        else:
            conn.execute(
                """
                INSERT INTO bp_labels
                    (id, name, release_count, image_id, image_uri, image_dynamic,
                     is_followed, last_synced_at, first_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (lid, name, count, image_id, image_uri, image_dynamic, now, now),
            )
            stats["inserted"] += 1

    conn.commit()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Pfad zur SQLite-DB")
    parser.add_argument("--input", required=True, help="Pfad zur Labels-JSON-Datei")
    parser.add_argument("--no-backup", action="store_true", help="Backup überspringen (nur für Sandbox)")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    input_path = Path(args.input).expanduser().resolve()

    if not input_path.exists():
        print(json.dumps({"ok": False, "error": f"Input nicht gefunden: {input_path}"}))
        return 1

    try:
        labels = load_labels(input_path)
    except ValueError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1

    backup_path = None
    if not args.no_backup:
        backup_path = backup_db(db_path)

    conn = sqlite3.connect(str(db_path))
    try:
        ensure_schema(conn)
        stats = upsert_labels(conn, labels)
        total = conn.execute("SELECT COUNT(*) FROM bp_labels").fetchone()[0]
    finally:
        conn.close()

    print(json.dumps({
        "ok": True,
        "db": str(db_path),
        "input": str(input_path),
        "input_count": len(labels),
        "db_total_after": total,
        "stats": stats,
        "backup": str(backup_path) if backup_path else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
