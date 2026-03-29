#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DATABASE_FILES = {
    "main": "m.db",
    "history": "hm.db",
    "statistics": "stm.db",
    "settings": "sm.db",
}


def _sanitize_for_json(obj):
    """Wandelt nicht-serialisierbare Typen (bytes/memoryview) in lesbare Strings um."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, (bytes, bytearray, memoryview)):
        raw = bytes(obj) if isinstance(obj, memoryview) else obj
        return f"<BLOB {len(raw)} bytes>"
    return obj


def emit(payload: dict) -> None:
    print(json.dumps(_sanitize_for_json(payload), ensure_ascii=False))


def resolve_database_folder(raw_folder: str | None) -> Path | None:
    if raw_folder:
        folder = Path(raw_folder).expanduser()
        if folder.name == "Database2" and folder.exists():
            return folder
        if (folder / "Database2").is_dir():
            return folder / "Database2"
        if folder.exists() and any((folder / value).exists() for value in DATABASE_FILES.values()):
            return folder

    home = Path.home()
    candidates = [
        home / "Music" / "Engine Library" / "Database2",
        home / "Music" / "Engine Library",
        home / "Documents" / "Engine Library" / "Database2",
        home / "Documents" / "Engine Library",
        home / "Engine Library" / "Database2",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            if candidate.name == "Database2":
                return candidate
            if (candidate / "Database2").is_dir():
                return candidate / "Database2"
    return None


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def inspect_schema(database_folder: Path) -> dict:
    """Gibt das komplette Schema aller Tabellen in m.db zurueck inkl. Beispieldaten."""
    db_path = database_folder / DATABASE_FILES["main"]
    if not db_path.exists():
        return {"ok": False, "error": f"m.db nicht gefunden: {db_path}"}
    result = {"ok": True, "tables": {}}
    with connect_readonly(db_path) as conn:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for row in tables:
            tname = row["name"]
            cols = conn.execute(f"PRAGMA table_info([{tname}])").fetchall()
            col_info = [
                {"name": c["name"], "type": c["type"], "pk": c["pk"]}
                for c in cols
            ]
            sample = conn.execute(f"SELECT * FROM [{tname}] LIMIT 1").fetchone()
            result["tables"][tname] = {
                "columns": col_info,
                "rowCount": conn.execute(f"SELECT COUNT(*) FROM [{tname}]").fetchone()[0],
                "sample": dict(sample) if sample else None,
            }
    return result


def build_summary(database_folder: Path) -> dict:
    databases = []
    playlist_count = 0
    history_count = 0

    for key, file_name in DATABASE_FILES.items():
      db_path = database_folder / file_name
      entry = {
          "id": key,
          "name": file_name,
          "path": str(db_path),
          "exists": db_path.exists(),
      }
      if not db_path.exists():
          databases.append(entry)
          continue

      with connect_readonly(db_path) as connection:
          table_count = connection.execute(
              """
              SELECT COUNT(*)
              FROM sqlite_master
              WHERE type='table' AND name NOT LIKE 'sqlite_%'
              """
          ).fetchone()[0]
          entry["tableCount"] = table_count

          if key == "main":
              playlist_count = connection.execute(
                  "SELECT COUNT(*) FROM Playlist"
              ).fetchone()[0]
              entry["playlistCount"] = playlist_count
          if key == "history":
              history_count = connection.execute(
                  "SELECT COUNT(*) FROM Historylist WHERE isDeleted = 0"
              ).fetchone()[0]
              entry["historySessionCount"] = history_count

      databases.append(entry)

    return {
        "ok": True,
        "databaseFolder": str(database_folder),
        "playlistCount": playlist_count,
        "historySessionCount": history_count,
        "databases": databases,
    }


def list_playlists(database_folder: Path, limit: int) -> dict:
    db_path = database_folder / DATABASE_FILES["main"]
    with connect_readonly(db_path) as connection:
        rows = connection.execute(
            """
            SELECT p.id, p.title, p.parentListId, COUNT(pe.id) AS trackCount
            FROM Playlist p
            LEFT JOIN PlaylistEntity pe ON p.id = pe.listId
            GROUP BY p.id, p.title, p.parentListId
            ORDER BY p.title COLLATE NOCASE
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return {
        "ok": True,
        "playlists": [dict(row) for row in rows],
    }


def list_playlist_tracks(database_folder: Path, playlist_id: int, limit: int) -> dict:
    db_path = database_folder / DATABASE_FILES["main"]
    with connect_readonly(db_path) as connection:
        rows = connection.execute(
            """
            SELECT
              t.id,
              t.title,
              t.artist,
              t.album,
              t.genre,
              t.bpm,
              t.key,
              t.filename,
              t.label,
              t.comment
            FROM PlaylistEntity pe
            JOIN Track t ON t.id = pe.trackId
            WHERE pe.listId = ?
            ORDER BY pe.id
            LIMIT ?
            """,
            (playlist_id, limit),
        ).fetchall()

    return {
        "ok": True,
        "playlistId": playlist_id,
        "tracks": [dict(row) for row in rows],
    }


def list_history_sessions(database_folder: Path, limit: int) -> dict:
    db_path = database_folder / DATABASE_FILES["history"]
    with connect_readonly(db_path) as connection:
        rows = connection.execute(
            """
            SELECT id, title, datetime(startTime, 'unixepoch') AS startTime
            FROM Historylist
            WHERE isDeleted = 0
            ORDER BY startTime DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return {
        "ok": True,
        "sessions": [dict(row) for row in rows],
    }


def list_history_tracks(database_folder: Path, session_id: int, limit: int) -> dict:
    db_path = database_folder / DATABASE_FILES["history"]
    with connect_readonly(db_path) as connection:
        rows = connection.execute(
            """
            SELECT
              he.id,
              he.trackId,
              t.title,
              t.artist,
              t.bpm,
              t.key,
              t.filename,
              datetime(he.startTime, 'unixepoch') AS startTime
            FROM HistorylistEntity he
            LEFT JOIN Track t ON t.id = he.trackId
            WHERE he.listId = ?
            ORDER BY he.startTime ASC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()

    return {
        "ok": True,
        "sessionId": session_id,
        "tracks": [dict(row) for row in rows],
    }


# ─── Write-Operationen ──────────────────────────────────────────────────────


def backup_database(database_folder: Path) -> str:
    """Erstellt ein Backup der m.db vor jeder Schreib-Operation."""
    db_path = database_folder / DATABASE_FILES["main"]
    if not db_path.exists():
        raise FileNotFoundError(f"Datenbank nicht gefunden: {db_path}")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = database_folder / "backups"
    backup_dir.mkdir(exist_ok=True)
    backup_path = backup_dir / f"m.db.backup_{timestamp}"
    shutil.copy2(str(db_path), str(backup_path))
    return str(backup_path)


def connect_readwrite(db_path: Path) -> sqlite3.Connection:
    """Verbindung mit Schreibzugriff — NUR fuer create/update Operationen."""
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def _get_db_uuid(conn: sqlite3.Connection) -> str:
    """Liest die databaseUuid aus der Information-Tabelle."""
    row = conn.execute("SELECT uuid FROM Information LIMIT 1").fetchone()
    return row["uuid"] if row else ""


def _build_streaming_uri(beatport_track_id: str | int) -> str:
    """Erzeugt die Engine-DJ-konforme Streaming-URI fuer Beatport LINK."""
    return f"streaming://Beatport%20LINK/Track/{beatport_track_id}"


def _next_id(conn: sqlite3.Connection, table: str) -> int:
    """Naechste freie ID fuer eine Tabelle.

    Engine DJ nutzt sqlite_sequence (AUTOINCREMENT) und prueft per Trigger,
    dass neue IDs strikt groesser als der bisherige Hoechststand sind.
    Daher sqlite_sequence lesen falls vorhanden, sonst MAX(id).
    """
    seq_row = conn.execute(
        "SELECT seq FROM sqlite_sequence WHERE name = ?", (table,)
    ).fetchone()
    if seq_row and seq_row[0] is not None:
        return seq_row[0] + 1
    row = conn.execute(f"SELECT MAX(id) FROM [{table}]").fetchone()
    return (row[0] or 0) + 1


def _find_existing_streaming_track(conn, beatport_id: str) -> dict | None:
    """Prueft ob ein Beatport-Streaming-Track schon in der DB existiert."""
    uri = _build_streaming_uri(beatport_id)
    row = conn.execute(
        "SELECT id, title, artist FROM Track WHERE uri = ? LIMIT 1", (uri,)
    ).fetchone()
    return dict(row) if row else None


def import_streaming_tracks(
    database_folder: Path,
    tracks_json: list[dict],
    playlist_title: str | None = None,
    parent_list_id: int = 0,
) -> dict:
    """
    Importiert Beatport-Streaming-Tracks in die Engine DJ Datenbank (m.db).

    Jeder Track wird als virtueller Streaming-Track angelegt mit:
    - streamingSource = 'Beatport LINK'
    - uri = 'streaming://Beatport%20LINK/Track/{beatport_id}'
    - streamingFlags = 1

    Bereits existierende Tracks (gleiche URI) werden uebersprungen aber
    trotzdem der Playlist zugeordnet.

    tracks_json: Liste von Dicts mit scoring-data.json Feldern (expandiert):
      track_id, title, mix_name, artists, genre, sub_genre, bpm,
      key, camelot, year, label, release, length_ms
    """
    db_path = database_folder / DATABASE_FILES["main"]
    if not db_path.exists():
        raise FileNotFoundError(f"Engine m.db nicht gefunden: {db_path}")

    if not tracks_json:
        return {"ok": False, "error": "Keine Tracks uebergeben."}

    # Sicherheits-Backup vor dem Schreiben
    backup_path = backup_database(database_folder)
    now_ts = int(datetime.now().timestamp())
    now_dt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    stats = {
        "tracksCreated": 0,
        "tracksExisted": 0,
        "tracksSkipped": 0,
        "playlistCreated": False,
        "playlistId": None,
        "entityCount": 0,
    }

    with connect_readwrite(db_path) as conn:
        db_uuid = _get_db_uuid(conn)
        track_ids_for_playlist = []

        # Verwaiste PerformanceData-Eintraege bereinigen (koennen durch
        # Engine-DJ-Sync entstehen: Track geloescht, PerformanceData bleibt).
        # Der DB-Trigger "trigger_after_insert_Track_insert_performance_data"
        # macht bei jedem Track-INSERT automatisch ein INSERT in PerformanceData.
        # Das kracht wenn dort schon ein Eintrag mit der gleichen trackId existiert.
        conn.execute(
            """DELETE FROM PerformanceData
               WHERE trackId NOT IN (SELECT id FROM Track)"""
        )

        # --- Phase 1: Tracks anlegen oder existierende finden ---
        # Engine DJ nutzt AUTOINCREMENT mit Triggern, die verhindern, dass
        # geloeschte IDs wiederverwendet werden (sqlite_sequence).
        # Daher: kein explizites 'id' setzen, sondern NULL/weglassen,
        # damit SQLite die naechste AUTOINCREMENT-ID vergibt.
        # Die Trigger "trigger_after_insert_Track_fix_origin" setzen
        # originTrackId + originDatabaseUuid automatisch.
        for t in tracks_json:
            bp_id = str(t.get("track_id") or t.get("i") or "").strip()
            if not bp_id:
                stats["tracksSkipped"] += 1
                continue

            existing = _find_existing_streaming_track(conn, bp_id)
            if existing:
                track_ids_for_playlist.append(existing["id"])
                stats["tracksExisted"] += 1
                continue

            # Titel zusammenbauen: "Title (Mix Name)" wie bei Beatport ueblich
            title = str(t.get("title") or t.get("t") or "Untitled")
            mix = str(t.get("mix_name") or t.get("m") or "").strip()
            full_title = f"{title} ({mix})" if mix else title

            artist = str(t.get("artists") or t.get("a") or "")
            genre = str(t.get("genre") or t.get("g") or "")
            sub_genre = str(t.get("sub_genre") or t.get("sg") or "")
            full_genre = f"{genre} / {sub_genre}" if sub_genre else genre

            bpm_raw = t.get("bpm") or t.get("b") or 0
            bpm = int(float(bpm_raw)) if bpm_raw else 0

            year = int(t.get("year") or t.get("y") or 0)
            label = str(t.get("label") or t.get("l") or "")
            album = str(t.get("release") or t.get("r") or "")

            length_ms = t.get("length_ms") or t.get("ms") or 0
            length_sec = int(float(length_ms) / 1000) if length_ms else 0

            cursor = conn.execute(
                """INSERT INTO Track (
                    playOrder, length, bpm, year, path, filename, bitrate,
                    bpmAnalyzed, albumArtId, fileBytes, title, artist, album,
                    genre, comment, label, composer, remixer, key, rating,
                    albumArt, timeLastPlayed, isPlayed, fileType, isAnalyzed,
                    dateCreated, dateAdded, isAvailable,
                    isMetadataOfPackedTrackChanged,
                    isPerfomanceDataOfPackedTrackChanged,
                    playedIndicator, isMetadataImported, pdbImportKey,
                    streamingSource, uri, isBeatGridLocked,
                    streamingFlags, lastEditTime
                ) VALUES (
                    0, ?, ?, ?, NULL, NULL, NULL,
                    ?, 0, 0, ?, ?, ?,
                    ?, NULL, ?, NULL, NULL, 0, 0,
                    'image://planck/0', NULL, NULL, NULL, 0,
                    ?, ?, 1,
                    0, 0, 0, 0, 0,
                    'Beatport LINK', ?, 0,
                    1, ?
                )""",
                (
                    length_sec,          # length
                    bpm,                 # bpm
                    year,                # year
                    float(bpm),          # bpmAnalyzed
                    full_title,          # title
                    artist,              # artist
                    album,               # album
                    full_genre,          # genre
                    label,               # label
                    now_ts,              # dateCreated
                    now_ts,              # dateAdded
                    _build_streaming_uri(bp_id),  # uri
                    now_dt,              # lastEditTime
                ),
            )
            new_track_id = cursor.lastrowid

            track_ids_for_playlist.append(new_track_id)
            stats["tracksCreated"] += 1

        # --- Phase 2: Playlist anlegen (optional) ---
        if playlist_title and track_ids_for_playlist:
            # Pruefen ob Playlist schon existiert
            existing_pl = conn.execute(
                "SELECT id FROM Playlist WHERE title = ?", (playlist_title,)
            ).fetchone()

            if existing_pl:
                playlist_id = existing_pl["id"]
                stats["playlistId"] = playlist_id
                # Existierende Track-IDs in dieser Playlist ermitteln
                existing_track_ids = set(
                    r["trackId"]
                    for r in conn.execute(
                        "SELECT trackId FROM PlaylistEntity WHERE listId = ?",
                        (playlist_id,),
                    ).fetchall()
                )
            else:
                playlist_id = _next_id(conn, "Playlist")
                conn.execute(
                    """INSERT INTO Playlist
                       (id, title, parentListId, isPersisted, nextListId,
                        lastEditTime, isExplicitlyExported)
                       VALUES (?, ?, ?, 1, 0, ?, 0)""",
                    (playlist_id, playlist_title, parent_list_id, now_dt),
                )
                stats["playlistCreated"] = True
                stats["playlistId"] = playlist_id
                existing_track_ids = set()

            # PlaylistEntity-Eintraege anlegen
            next_entity_id = _next_id(conn, "PlaylistEntity")
            entity_ids = []

            for track_id in track_ids_for_playlist:
                if track_id in existing_track_ids:
                    continue  # Track schon in dieser Playlist
                conn.execute(
                    """INSERT INTO PlaylistEntity
                       (id, listId, trackId, databaseUuid, nextEntityId,
                        membershipReference)
                       VALUES (?, ?, ?, ?, 0, 0)""",
                    (next_entity_id, playlist_id, track_id, db_uuid),
                )
                entity_ids.append(next_entity_id)
                next_entity_id += 1
                stats["entityCount"] += 1

            # Linked-List: nextEntityId verketten
            for i in range(len(entity_ids) - 1):
                conn.execute(
                    "UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?",
                    (entity_ids[i + 1], entity_ids[i]),
                )

        conn.commit()

    stats["backupPath"] = backup_path
    stats["ok"] = True
    return stats


def create_playlist(
    database_folder: Path,
    title: str,
    track_titles: list[str] | None = None,
    parent_list_id: int = 0,
) -> dict:
    """Legacy-Funktion: Erstellt Playlist per Titel-Matching (fuer lokale Tracks)."""
    db_path = database_folder / DATABASE_FILES["main"]
    if not db_path.exists():
        raise FileNotFoundError(f"Engine m.db nicht gefunden: {db_path}")

    backup_path = backup_database(database_folder)

    with connect_readwrite(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM Playlist WHERE title = ?", (title,)
        ).fetchone()
        if existing:
            return {
                "ok": False,
                "error": f"Playlist '{title}' existiert bereits (ID: {existing['id']})",
                "existingId": existing["id"],
                "backupPath": backup_path,
            }

        new_playlist_id = _next_id(conn, "Playlist")
        now_dt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            """INSERT INTO Playlist
               (id, title, parentListId, isPersisted, nextListId,
                lastEditTime, isExplicitlyExported)
               VALUES (?, ?, ?, 1, 0, ?, 0)""",
            (new_playlist_id, title, parent_list_id, now_dt),
        )

        matched_tracks = []
        unmatched_titles = []

        if track_titles:
            for track_title in track_titles:
                row = conn.execute(
                    "SELECT id, title, artist FROM Track WHERE title = ? LIMIT 1",
                    (track_title,),
                ).fetchone()
                if not row:
                    row = conn.execute(
                        "SELECT id, title, artist FROM Track WHERE title LIKE ? LIMIT 1",
                        (f"%{track_title}%",),
                    ).fetchone()
                if row:
                    matched_tracks.append(dict(row))
                else:
                    unmatched_titles.append(track_title)

            db_uuid = _get_db_uuid(conn)
            next_entity_id = _next_id(conn, "PlaylistEntity")
            entity_ids = []
            for track in matched_tracks:
                conn.execute(
                    """INSERT INTO PlaylistEntity
                       (id, listId, trackId, databaseUuid, nextEntityId,
                        membershipReference)
                       VALUES (?, ?, ?, ?, 0, 0)""",
                    (next_entity_id, new_playlist_id, track["id"], db_uuid),
                )
                entity_ids.append(next_entity_id)
                next_entity_id += 1

            for i in range(len(entity_ids) - 1):
                conn.execute(
                    "UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?",
                    (entity_ids[i + 1], entity_ids[i]),
                )

        conn.commit()

    return {
        "ok": True,
        "playlistId": new_playlist_id,
        "title": title,
        "matchedCount": len(matched_tracks),
        "unmatchedCount": len(unmatched_titles),
        "unmatchedTitles": unmatched_titles[:20],
        "backupPath": backup_path,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Engine DJ / Denon History Helpers")
    parser.add_argument("--database-folder", default="", help="Pfad zu Engine Library oder Database2")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("summary")
    sub.add_parser("inspect-schema")

    playlists = sub.add_parser("playlists")
    playlists.add_argument("--limit", type=int, default=100)

    playlist_tracks = sub.add_parser("playlist-tracks")
    playlist_tracks.add_argument("--playlist-id", type=int, required=True)
    playlist_tracks.add_argument("--limit", type=int, default=500)

    history_sessions = sub.add_parser("history-sessions")
    history_sessions.add_argument("--limit", type=int, default=25)

    history_tracks = sub.add_parser("history-tracks")
    history_tracks.add_argument("--session-id", type=int, required=True)
    history_tracks.add_argument("--limit", type=int, default=500)

    create_pl = sub.add_parser("create-playlist")
    create_pl.add_argument("--title", required=True, help="Name der neuen Playlist")
    create_pl.add_argument(
        "--track-titles-json",
        default="",
        help="JSON-Array mit Track-Titeln zum Matching",
    )
    create_pl.add_argument("--parent-list-id", type=int, default=0)

    import_st = sub.add_parser("import-streaming")
    import_st.add_argument(
        "--tracks-json-file",
        required=True,
        help="Pfad zur JSON-Datei mit Track-Array (scoring-data Format)",
    )
    import_st.add_argument(
        "--playlist-title",
        default="",
        help="Playlist-Name (leer = nur Tracks anlegen, keine Playlist)",
    )
    import_st.add_argument("--parent-list-id", type=int, default=0)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    database_folder = resolve_database_folder(args.database_folder)
    if not database_folder:
        emit({"ok": False, "error": "Engine Database2 Ordner wurde nicht gefunden."})
        return 1

    if args.command == "inspect-schema":
        emit(inspect_schema(database_folder))
        return 0
    if args.command == "summary":
        emit(build_summary(database_folder))
        return 0
    if args.command == "playlists":
        emit(list_playlists(database_folder, args.limit))
        return 0
    if args.command == "playlist-tracks":
        emit(list_playlist_tracks(database_folder, args.playlist_id, args.limit))
        return 0
    if args.command == "history-sessions":
        emit(list_history_sessions(database_folder, args.limit))
        return 0
    if args.command == "history-tracks":
        emit(list_history_tracks(database_folder, args.session_id, args.limit))
        return 0
    if args.command == "create-playlist":
        track_titles = []
        if args.track_titles_json:
            try:
                track_titles = json.loads(args.track_titles_json)
            except json.JSONDecodeError as e:
                emit({"ok": False, "error": f"Ungueltiges JSON fuer Track-Titel: {e}"})
                return 1
        emit(
            create_playlist(
                database_folder,
                title=args.title,
                track_titles=track_titles,
                parent_list_id=args.parent_list_id,
            )
        )
        return 0

    if args.command == "import-streaming":
        tracks_file = Path(args.tracks_json_file).expanduser()
        if not tracks_file.exists():
            emit({"ok": False, "error": f"Datei nicht gefunden: {tracks_file}"})
            return 1
        try:
            raw = json.loads(tracks_file.read_text("utf8"))
            # scoring-data.json hat { all_tracks: [...] } oder direkt ein Array
            if isinstance(raw, dict) and "all_tracks" in raw:
                tracks_list = raw["all_tracks"]
            elif isinstance(raw, list):
                tracks_list = raw
            else:
                emit({"ok": False, "error": "JSON muss ein Array oder {all_tracks:[...]} sein."})
                return 1
        except json.JSONDecodeError as e:
            emit({"ok": False, "error": f"JSON-Parse-Fehler: {e}"})
            return 1

        emit(
            import_streaming_tracks(
                database_folder,
                tracks_json=tracks_list,
                playlist_title=args.playlist_title or None,
                parent_list_id=args.parent_list_id,
            )
        )
        return 0

    emit({"ok": False, "error": f"Unbekannter Befehl: {args.command}"})
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
