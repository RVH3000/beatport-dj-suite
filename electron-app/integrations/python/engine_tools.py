#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DATABASE_FILES = {
    "main": "m.db",
    "history": "hm.db",
    "statistics": "stm.db",
    "settings": "sm.db",
}


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Engine DJ / Denon History Helpers")
    parser.add_argument("--database-folder", default="", help="Pfad zu Engine Library oder Database2")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("summary")

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

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    database_folder = resolve_database_folder(args.database_folder)
    if not database_folder:
        emit({"ok": False, "error": "Engine Database2 Ordner wurde nicht gefunden."})
        return 1

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

    emit({"ok": False, "error": f"Unbekannter Befehl: {args.command}"})
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
