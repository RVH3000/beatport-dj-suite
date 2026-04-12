#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import struct
import sys
import zlib
from datetime import datetime
from pathlib import Path

DATABASE_FILES = {
    "main": "m.db",
    "history": "hm.db",
    "statistics": "stm.db",
    "settings": "sm.db",
    "rekordbox": "rbm.db",
}

# Leere/unwichtige DBs — in Summary als optional markiert
OPTIONAL_DATABASES = {"statistics", "settings"}


def _sanitize_for_json(obj, _key: str | None = None):
    """Wandelt nicht-serialisierbare Typen in JSON-kompatible Werte um.

    BLOBs werden nach Möglichkeit dekodiert (trackData, quickCues, loops).
    Unbekannte BLOBs erhalten ein kompaktes Zusammenfassungs-Dict.
    """
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v, _key=k) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, (bytes, bytearray, memoryview)):
        raw = bytes(obj) if isinstance(obj, memoryview) else obj
        # Versuche bekannte PerformanceData-BLOBs zu dekodieren
        if _key == "trackData":
            decoded = parse_trackdata_blob(raw)
            if decoded:
                return decoded
        elif _key == "quickCues":
            decoded = parse_quickcues_blob(raw)
            if decoded is not None:
                return decoded
        elif _key == "loops":
            decoded = parse_loops_blob(raw)
            if decoded is not None:
                return decoded
        return {"_blob_bytes": len(raw)}
    return obj


def parse_trackdata_blob(blob: bytes) -> dict | None:
    """Dekodiert den TrackData-BLOB aus PerformanceData (sample_rate, total_samples, duration)."""
    try:
        payload = zlib.decompress(blob[4:])
        if len(payload) < 28:
            return None
        sample_rate = struct.unpack_from(">d", payload, 0)[0]
        total_samples = struct.unpack_from(">q", payload, 8)[0]
        if sample_rate <= 0:
            return None
        return {
            "sample_rate": sample_rate,
            "total_samples": total_samples,
            "duration_sec": round(total_samples / sample_rate, 3),
        }
    except Exception:
        return None


def parse_quickcues_blob(blob: bytes) -> list[dict] | None:
    """Dekodiert den QuickCues-BLOB aus PerformanceData."""
    try:
        payload = zlib.decompress(blob[4:])
        offset = 4  # 4 bytes unknown
        max_cues = struct.unpack_from(">I", payload, offset)[0]
        offset += 4
        cues: list[dict] = []
        for _ in range(max_cues):
            name_len = payload[offset]
            offset += 1
            name = payload[offset:offset + name_len].decode("ascii", errors="replace")
            offset += name_len
            position = struct.unpack_from(">d", payload, offset)[0]
            offset += 8
            a, r, g, b = struct.unpack_from("BBBB", payload, offset)
            offset += 4
            if position == -1.0:
                continue
            cues.append({
                "name": name,
                "position_samples": position,
                "position_seconds": round(position / 44100, 3),
                "color_hex": f"#{r:02x}{g:02x}{b:02x}",
            })
        return cues
    except Exception:
        return None


def parse_loops_blob(blob: bytes) -> list[dict] | None:
    """Dekodiert den Loops-BLOB aus PerformanceData."""
    try:
        payload = zlib.decompress(blob[4:])
        offset = 4  # 4 bytes unknown
        max_loops = struct.unpack_from(">I", payload, offset)[0]
        offset += 4
        loops: list[dict] = []
        for _ in range(max_loops):
            name_len = payload[offset]
            offset += 1
            name = payload[offset:offset + name_len].decode("ascii", errors="replace")
            offset += name_len
            start_pos = struct.unpack_from(">d", payload, offset)[0]
            offset += 8
            a, r, g, b = struct.unpack_from("BBBB", payload, offset)
            offset += 4
            end_pos = struct.unpack_from(">d", payload, offset)[0]
            offset += 8
            if start_pos == -1.0:
                continue
            loops.append({
                "name": name,
                "start_samples": start_pos,
                "start_seconds": round(start_pos / 44100, 3),
                "end_samples": end_pos,
                "end_seconds": round(end_pos / 44100, 3),
                "color_hex": f"#{r:02x}{g:02x}{b:02x}",
            })
        return loops
    except Exception:
        return None


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


def discover_all_engine_databases() -> list[dict]:
    """Findet alle Engine-DJ-Datenbanken: lokal + USB-Volumes.

    Gibt eine Liste von Dicts zurueck:
      { source: "local"|"usb", volume: str, path: str, databases: [...] }
    """
    results: list[dict] = []

    # 1. Lokale Kandidaten (inkl. "Engine Library Backup", "Engine Library Kopie" etc.)
    home = Path.home()
    local_candidates = [
        home / "Music" / "Engine Library" / "Database2",
        home / "Music" / "Engine Library",
        home / "Documents" / "Engine Library" / "Database2",
        home / "Documents" / "Engine Library",
        home / "Engine Library" / "Database2",
    ]
    # Zusätzlich: alle Ordner die mit "Engine Library" beginnen in ~/Music/
    music_dir = home / "Music"
    if music_dir.is_dir():
        for entry in sorted(music_dir.iterdir()):
            if entry.is_dir() and entry.name.startswith("Engine Library") and entry.name != "Engine Library":
                local_candidates.append(entry / "Database2")
                local_candidates.append(entry)

    for candidate in local_candidates:
        folder = _resolve_candidate(candidate)
        if folder and not any(r["path"] == str(folder) for r in results):
            volume_name = folder.parent.name if folder.name == "Database2" else folder.name
            results.append(_describe_db(folder, "local", volume_name))

    # 2. USB/externe Volumes unter /Volumes/
    volumes_root = Path("/Volumes")
    if volumes_root.is_dir():
        for vol in sorted(volumes_root.iterdir()):
            if not vol.is_dir() or vol.name.startswith("."):
                continue
            usb_candidates = [
                vol / "Engine Library" / "Database2",
                vol / "Engine Library",
            ]
            for candidate in usb_candidates:
                folder = _resolve_candidate(candidate)
                if folder and not any(r["path"] == str(folder) for r in results):
                    results.append(_describe_db(folder, "usb", vol.name))

    return results


def _resolve_candidate(candidate: Path) -> Path | None:
    if not candidate.exists():
        return None
    if candidate.name == "Database2" and candidate.is_dir():
        return candidate
    if (candidate / "Database2").is_dir():
        return candidate / "Database2"
    if any((candidate / v).exists() for v in DATABASE_FILES.values()):
        return candidate
    return None


def _describe_db(folder: Path, source: str, volume: str) -> dict:
    dbs = []
    for key, fname in DATABASE_FILES.items():
        p = folder / fname
        dbs.append({"id": key, "name": fname, "exists": p.exists()})
    return {
        "source": source,
        "volume": volume,
        "path": str(folder),
        "databases": dbs,
    }


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
    rekordbox_track_count = 0

    for key, file_name in DATABASE_FILES.items():
      db_path = database_folder / file_name
      entry = {
          "id": key,
          "name": file_name,
          "path": str(db_path),
          "optional": key in OPTIONAL_DATABASES,
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
              # PerformanceData-Stats (Cues, TrackData)
              try:
                  track_count_main = connection.execute("SELECT COUNT(*) FROM Track").fetchone()[0]
                  perf_total = connection.execute("SELECT COUNT(*) FROM PerformanceData WHERE trackData IS NOT NULL").fetchone()[0]
                  cue_total = connection.execute(
                      "SELECT COUNT(*) FROM PerformanceData WHERE quickCues IS NOT NULL AND length(quickCues) > 20"
                  ).fetchone()[0]
                  entry["trackCount"] = track_count_main
                  entry["withTrackdata"] = perf_total
                  entry["withCues"] = cue_total
              except sqlite3.Error:
                  pass
          if key == "history":
              history_count = connection.execute(
                  "SELECT COUNT(*) FROM Historylist WHERE isDeleted = 0"
              ).fetchone()[0]
              entry["historySessionCount"] = history_count
          if key == "rekordbox":
              rekordbox_track_count = connection.execute(
                  "SELECT COUNT(*) FROM Track"
              ).fetchone()[0]
              entry["rekordboxTrackCount"] = rekordbox_track_count

      databases.append(entry)

    return {
        "ok": True,
        "databaseFolder": str(database_folder),
        "playlistCount": playlist_count,
        "historySessionCount": history_count,
        "rekordboxTrackCount": rekordbox_track_count,
        "databases": databases,
    }


def list_playlists(database_folder: Path, limit: int) -> dict:
    db_path = database_folder / DATABASE_FILES["main"]
    with connect_readonly(db_path) as connection:
        # isPersisted: ob die Playlist auf dem Gerät materialisiert ist
        pl_cols = _columns_of(connection, "Playlist")
        persisted_col = "p.isPersisted" if "isPersisted" in pl_cols else "1 AS isPersisted"

        rows = connection.execute(
            f"""
            SELECT p.id, p.title, p.parentListId, {persisted_col},
                   COUNT(pe.id) AS trackCount
            FROM Playlist p
            LEFT JOIN PlaylistEntity pe ON p.id = pe.listId
            GROUP BY p.id, p.title, p.parentListId
            ORDER BY p.title COLLATE NOCASE
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        # Smartlists als eigene Kategorie
        smartlists = []
        tables = {r["name"] for r in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if "Smartlist" in tables:
            smartlists = [
                dict(row) for row in connection.execute(
                    "SELECT id, title FROM Smartlist ORDER BY title COLLATE NOCASE"
                ).fetchall()
            ]

    return {
        "ok": True,
        "playlists": [dict(row) for row in rows],
        "smartlists": smartlists,
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


# ─── Dump für scoring-data Merge (read-only) ────────────────────────────────


_BEATPORT_URI_PREFIX = "streaming://Beatport%20LINK/Track/"


def _extract_beatport_id(uri: str | None) -> int | None:
    if not uri or not uri.startswith(_BEATPORT_URI_PREFIX):
        return None
    tail = uri[len(_BEATPORT_URI_PREFIX):].split("/", 1)[0].split("?", 1)[0]
    try:
        return int(tail)
    except ValueError:
        return None


def _columns_of(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info([{table}])").fetchall()}


def dump_tracks_with_history(database_folder: Path, limit: int | None = None) -> dict:
    """Liefert alle Tracks aus m.db inkl. aggregierter Historie aus hm.db.

    Ausschließlich Lesezugriff (PRAGMA query_only = ON). Keine Schreib-Operationen
    werden angefasst. Gibt eine Liste von Dicts zurück, die direkt mit den
    Feldern aus scoring-data.json verglichen werden können.

    Jeder Eintrag enthält:
      - engine_track_id:  Interne Track.id in m.db
      - beatport_id:      Aus uri extrahiert (int oder null für Nicht-Streaming)
      - title, artists, album, genre, bpm, key, camelot, year, label,
        comment, file_path, length_ms, rating, date_added
      - plays_total:      Anzahl Abspielungen in hm.db
      - last_played:      Unix-Timestamp der letzten Abspielung
    """
    main_db = database_folder / DATABASE_FILES["main"]
    if not main_db.exists():
        return {"ok": False, "error": f"m.db nicht gefunden: {main_db}"}
    history_db = database_folder / DATABASE_FILES["history"]

    tracks: list[dict] = []
    with connect_readonly(main_db) as conn:
        track_cols = _columns_of(conn, "Track")

        # Dynamisch SELECT aufbauen, weil Engine-Versionen unterschiedliche Spalten haben
        def col_or_null(name: str, alias: str | None = None) -> str:
            alias = alias or name
            return f"t.{name} AS {alias}" if name in track_cols else f"NULL AS {alias}"

        select_parts = [
            "t.id AS engine_track_id",
            col_or_null("title"),
            col_or_null("artist", "artists"),
            col_or_null("album"),
            col_or_null("genre"),
            col_or_null("bpm"),
            col_or_null("key"),
            col_or_null("year"),
            col_or_null("label"),
            col_or_null("comment"),
            col_or_null("path", "file_path_full"),
            col_or_null("filename", "file_name"),
            col_or_null("length", "length_raw"),
            col_or_null("rating", "rating_raw"),
            col_or_null("dateAdded", "date_added"),
            col_or_null("timeLastPlayed", "last_played_track"),
            col_or_null("isPlayed", "is_played"),
            col_or_null("uri"),
        ]
        sql = "SELECT " + ",\n".join(select_parts) + " FROM Track t"
        if limit:
            sql += f" LIMIT {int(limit)}"

        for row in conn.execute(sql).fetchall():
            d = dict(row)
            d["beatport_id"] = _extract_beatport_id(d.pop("uri", None))

            # length: m.db speichert Sekunden, scoring-data.json nutzt ms
            length_raw = d.pop("length_raw", None)
            if length_raw is not None:
                try:
                    val = float(length_raw)
                    d["length_ms"] = int(val * 1000) if val < 10000 else int(val)
                except (TypeError, ValueError):
                    d["length_ms"] = None
            else:
                d["length_ms"] = None

            # Rating: Engine 0-100 in 20er-Schritten → 0-5 Sterne
            rating_raw = d.pop("rating_raw", None)
            if rating_raw is None or rating_raw == 0:
                d["rating"] = None  # 0 = nicht bewertet, NICHT als 0-Sterne speichern
            else:
                try:
                    stars = round(float(rating_raw) / 20)
                    d["rating"] = max(0, min(5, int(stars)))
                except (TypeError, ValueError):
                    d["rating"] = None

            # file_path: path (komplett) bevorzugt, sonst filename (nur Dateiname)
            full = d.pop("file_path_full", None)
            name = d.pop("file_name", None)
            d["file_path"] = full or name

            # last_played: Track.timeLastPlayed direkt (primär); history-Merge unten als Fallback
            tlp = d.pop("last_played_track", None)
            d["_last_played_track"] = int(tlp) if tlp else None

            # camelot wird nicht direkt gespeichert
            d["camelot"] = None
            tracks.append(d)

    # PerformanceData pro Track lesen (Cues, TrackData)
    perf_by_track: dict[int, dict] = {}
    try:
        with connect_readonly(main_db) as conn:
            for row in conn.execute(
                "SELECT trackId, trackData, quickCues, loops FROM PerformanceData"
            ).fetchall():
                tid = row["trackId"]
                td = parse_trackdata_blob(row["trackData"]) if row["trackData"] else None
                cues = parse_quickcues_blob(row["quickCues"]) if row["quickCues"] else None
                lps = parse_loops_blob(row["loops"]) if row["loops"] else None
                perf_by_track[tid] = {
                    "has_trackdata": td is not None,
                    "trackdata": td,
                    "has_cues": cues is not None and len(cues) > 0,
                    "cue_count": len(cues) if cues else 0,
                    "cues": cues or [],
                    "has_loops": lps is not None and len(lps) > 0,
                    "loop_count": len(lps) if lps else 0,
                    "loops": lps or [],
                }
    except sqlite3.Error:
        pass

    for t in tracks:
        t["performance"] = perf_by_track.get(t["engine_track_id"], {
            "has_trackdata": False, "trackdata": None,
            "has_cues": False, "cue_count": 0, "cues": [],
            "has_loops": False, "loop_count": 0, "loops": [],
        })

    # History aggregieren aus hm.db (Join per trackId)
    plays_by_id: dict[int, dict] = {}
    if history_db.exists():
        try:
            with connect_readonly(history_db) as hconn:
                he_cols = _columns_of(hconn, "HistorylistEntity")
                if "trackId" in he_cols and "startTime" in he_cols:
                    for row in hconn.execute(
                        """
                        SELECT trackId, COUNT(*) AS plays_total, MAX(startTime) AS last_played
                        FROM HistorylistEntity
                        WHERE trackId IS NOT NULL
                        GROUP BY trackId
                        """
                    ).fetchall():
                        tid = row["trackId"]
                        if tid is None:
                            continue
                        plays_by_id[int(tid)] = {
                            "plays_total": int(row["plays_total"] or 0),
                            "last_played": int(row["last_played"] or 0) or None,
                        }
        except sqlite3.Error as exc:
            # History-DB nicht lesbar → weiter ohne
            plays_by_id = {"_error": str(exc)}  # type: ignore[assignment]

    # History an Tracks mergen
    history_error = None
    if isinstance(plays_by_id, dict) and "_error" in plays_by_id:
        history_error = plays_by_id["_error"]
        plays_by_id = {}

    for t in tracks:
        hist = plays_by_id.get(t["engine_track_id"]) if isinstance(plays_by_id, dict) else None
        t["plays_total"] = hist["plays_total"] if hist else 0
        # last_played: History hat Priorität (tatsächlich in einer DJ-Session abgespielt),
        # Fallback ist Track.timeLastPlayed (auch Preview-Plays)
        hist_last = hist["last_played"] if hist else None
        track_last = t.pop("_last_played_track", None)
        t["last_played"] = hist_last or track_last

    rated_count = sum(1 for t in tracks if t.get("rating"))
    played_count = sum(1 for t in tracks if (t.get("plays_total") or 0) > 0 or t.get("last_played"))

    return {
        "ok": True,
        "database_folder": str(database_folder),
        "track_count": len(tracks),
        "with_beatport_id": sum(1 for t in tracks if t.get("beatport_id") is not None),
        "rated_count": rated_count,
        "played_count": played_count,
        "with_trackdata": sum(1 for t in tracks if t.get("performance", {}).get("has_trackdata")),
        "with_cues": sum(1 for t in tracks if t.get("performance", {}).get("has_cues")),
        "with_loops": sum(1 for t in tracks if t.get("performance", {}).get("has_loops")),
        "history_available": history_db.exists() and history_error is None,
        "history_error": history_error,
        "tracks": tracks,
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


def diff_databases(db_folder_a: Path, db_folder_b: Path) -> dict:
    """Vergleicht Tracks aus zwei Engine DJ Datenbank-Ordnern.

    Matching-Logik:
    - Streaming-Tracks: Match über uri
    - Lokale Tracks: Match über filename (case-insensitive)
    """
    try:
        db_a = db_folder_a / DATABASE_FILES["main"]
        db_b = db_folder_b / DATABASE_FILES["main"]
        if not db_a.exists():
            return {"ok": False, "error": f"m.db nicht gefunden in A: {db_a}"}
        if not db_b.exists():
            return {"ok": False, "error": f"m.db nicht gefunden in B: {db_b}"}

        def load_tracks(db_path: Path) -> list[dict]:
            with connect_readonly(db_path) as conn:
                cols = _columns_of(conn, "Track")
                sel = []
                for c in ("id", "title", "artist", "bpm", "filename", "uri"):
                    sel.append(f"t.{c}" if c in cols else f"NULL AS {c}")
                rows = conn.execute(
                    "SELECT " + ", ".join(sel) + " FROM Track t"
                ).fetchall()
                return [dict(r) for r in rows]

        tracks_a = load_tracks(db_a)
        tracks_b = load_tracks(db_b)

        def make_key(track: dict) -> str:
            uri = track.get("uri")
            if uri and str(uri).strip():
                return str(uri)
            fn = track.get("filename") or ""
            return fn.lower()

        index_a: dict[str, dict] = {}
        for t in tracks_a:
            k = make_key(t)
            if k:
                index_a[k] = t

        index_b: dict[str, dict] = {}
        for t in tracks_b:
            k = make_key(t)
            if k:
                index_b[k] = t

        keys_a = set(index_a.keys())
        keys_b = set(index_b.keys())

        only_a_keys = keys_a - keys_b
        only_b_keys = keys_b - keys_a
        both_keys = keys_a & keys_b

        only_in_a = [
            {"id": index_a[k]["id"], "title": index_a[k].get("title"), "artist": index_a[k].get("artist")}
            for k in sorted(only_a_keys)
        ][:50]

        only_in_b = [
            {"id": index_b[k]["id"], "title": index_b[k].get("title"), "artist": index_b[k].get("artist")}
            for k in sorted(only_b_keys)
        ][:50]

        metadata_differs = []
        for k in sorted(both_keys):
            ta = index_a[k]
            tb = index_b[k]
            diff = {}
            if ta.get("bpm") != tb.get("bpm"):
                diff["bpm"] = [ta.get("bpm"), tb.get("bpm")]
            if ta.get("artist") != tb.get("artist"):
                diff["artist"] = [ta.get("artist"), tb.get("artist")]
            if diff:
                metadata_differs.append({
                    "title": ta.get("title"),
                    "key": k,
                    "diff": diff,
                })
                if len(metadata_differs) >= 50:
                    break

        return {
            "ok": True,
            "db_a": str(db_folder_a),
            "db_b": str(db_folder_b),
            "total_a": len(tracks_a),
            "total_b": len(tracks_b),
            "only_in_a": only_in_a,
            "only_in_b": only_in_b,
            "in_both_count": len(both_keys),
            "metadata_differs": metadata_differs,
        }
    except Exception as exc:
        return {"ok": False, "error": f"Diff fehlgeschlagen: {exc}"}


def unify_history(source_folders: list[Path]) -> dict:
    """Merged History-Sessions aus mehreren hm.db Quellen.

    Session-Matching ueber startTime + originDriveName (wenn vorhanden).
    Deduplizierung: gleiche Session (gleicher startTime) wird nur einmal gezaehlt.
    Output: chronologische Timeline aller Sessions mit aggregierten Plays.
    """
    # key -> merged session info
    merged: dict[tuple, dict] = {}
    total_plays = 0
    duplicates_merged = 0

    for folder in source_folders:
        db_path = folder / DATABASE_FILES["history"]
        if not db_path.exists():
            continue

        try:
            conn = connect_readonly(db_path)
        except Exception:
            continue

        try:
            cols = _columns_of(conn, "Historylist")
            has_origin = "originDriveName" in cols

            if has_origin:
                sessions = conn.execute(
                    "SELECT id, title, startTime, originDriveName "
                    "FROM Historylist WHERE isDeleted = 0"
                ).fetchall()
            else:
                sessions = conn.execute(
                    "SELECT id, title, startTime "
                    "FROM Historylist WHERE isDeleted = 0"
                ).fetchall()

            for sess in sessions:
                sess_dict = dict(sess)
                origin = sess_dict.get("originDriveName")
                start_time = sess_dict["startTime"]
                title = sess_dict["title"]

                if has_origin and origin:
                    match_key = (start_time, origin)
                else:
                    match_key = (start_time, title)

                # Count plays for this session
                plays = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM HistorylistEntity WHERE listId = ?",
                    (sess_dict["id"],),
                ).fetchone()
                play_count = plays["cnt"] if plays else 0
                total_plays += play_count

                if match_key in merged:
                    existing = merged[match_key]
                    if str(folder) not in existing["source_folders"]:
                        existing["source_folders"].append(str(folder))
                        duplicates_merged += 1
                    # Keep the higher play count (may differ across sources)
                    if play_count > existing["play_count"]:
                        existing["play_count"] = play_count
                else:
                    merged[match_key] = {
                        "title": title,
                        "startTime": start_time,
                        "originDriveName": origin if has_origin else None,
                        "play_count": play_count,
                        "source_folders": [str(folder)],
                    }
        except Exception as exc:
            # Skip broken databases gracefully
            continue
        finally:
            conn.close()

    # Sort chronologically by startTime
    sorted_sessions = sorted(merged.values(), key=lambda s: s["startTime"])

    return {
        "ok": True,
        "sources": [str(f) for f in source_folders],
        "source_count": len(source_folders),
        "total_sessions": sum(len(s["source_folders"]) for s in sorted_sessions),
        "total_plays": total_plays,
        "unique_sessions": len(sorted_sessions),
        "duplicates_merged": duplicates_merged,
        "sessions": sorted_sessions[:200],
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

    dump_th = sub.add_parser("dump-tracks-with-history")
    dump_th.add_argument("--limit", type=int, default=0, help="0 = kein Limit")

    sub.add_parser("discover-all-databases")

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

    diff_cmd = sub.add_parser("diff")
    diff_cmd.add_argument("--db-a", required=True, help="Pfad zu Database2 Ordner A")
    diff_cmd.add_argument("--db-b", required=True, help="Pfad zu Database2 Ordner B")

    unify_hist = sub.add_parser("unify-history")
    unify_hist.add_argument("--sources", nargs="+", required=True, help="Pfade zu Database2 Ordnern")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "unify-history":
        folders = []
        for src in args.sources:
            f = resolve_database_folder(src)
            if not f:
                emit({"ok": False, "error": f"Ordner nicht gefunden: {src}"})
                return 1
            folders.append(f)
        emit(unify_history(folders))
        return 0

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
    if args.command == "dump-tracks-with-history":
        emit(dump_tracks_with_history(database_folder, args.limit or None))
        return 0
    if args.command == "discover-all-databases":
        emit({"ok": True, "databases": discover_all_engine_databases()})
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

    if args.command == "diff":
        folder_a = resolve_database_folder(args.db_a)
        folder_b = resolve_database_folder(args.db_b)
        if not folder_a:
            emit({"ok": False, "error": f"DB-Ordner A nicht gefunden: {args.db_a}"})
            return 1
        if not folder_b:
            emit({"ok": False, "error": f"DB-Ordner B nicht gefunden: {args.db_b}"})
            return 1
        emit(diff_databases(folder_a, folder_b))
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
