#!/usr/bin/env python3
"""
History-Merge-Exporter für Engine DJ.

Liest read-only aus einer oder mehreren Engine-DJ-Datenbanken (m.db + hm.db),
führt Tracks zusammen mit Duplikat-Check, sortiert nach first_played und exportiert
in M3U8, JSON und CSV. Splittet in Playlisten zu max N Tracks.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---- Camelot- und Tonart-Konvertierung ---------------------------------

CAMELOT_MAJOR = {
    1: "8B", 2: "3B", 3: "10B", 4: "5B", 5: "12B", 6: "7B",
    7: "2B", 8: "9B", 9: "4B", 10: "11B", 11: "6B", 12: "1B",
}
CAMELOT_MINOR = {
    1: "5A", 2: "12A", 3: "7A", 4: "2A", 5: "9A", 6: "4A",
    7: "11A", 8: "6A", 9: "1A", 10: "8A", 11: "3A", 12: "10A",
}
NOTES = ["", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def engine_key_to_camelot(k: Any) -> str:
    if k is None:
        return ""
    try:
        k = int(k)
    except (TypeError, ValueError):
        return ""
    if 1 <= k <= 12:
        return CAMELOT_MAJOR.get(k, "")
    if 13 <= k <= 24:
        return CAMELOT_MINOR.get(k - 12, "")
    return ""


def engine_key_to_classic(k: Any) -> str:
    if k is None:
        return ""
    try:
        k = int(k)
    except (TypeError, ValueError):
        return ""
    if 1 <= k <= 12:
        return NOTES[k]
    if 13 <= k <= 24:
        return NOTES[k - 12] + "m"
    return ""


# ---- Identitäts-/ID-Helpers --------------------------------------------

BEATPORT_URI_RE = re.compile(r"Beatport.*?Track/(\d+)", re.IGNORECASE)


def parse_beatport_id(uri: str | None) -> int | None:
    if not uri:
        return None
    m = BEATPORT_URI_RE.search(uri)
    return int(m.group(1)) if m else None


def parse_iso(unix_sec: int | None) -> str | None:
    if not unix_sec:
        return None
    try:
        return (
            datetime.fromtimestamp(int(unix_sec), tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
    except (OSError, ValueError, OverflowError):
        return None


def track_identity(trk: dict) -> tuple:
    """Identität: beatport_id > originUuid+originTrackId > artist+title+length."""
    bp = parse_beatport_id(trk.get("uri"))
    if bp:
        return ("bp", bp)
    origin_uuid = trk.get("originDatabaseUuid")
    origin_id = trk.get("originTrackId")
    if origin_uuid and origin_id:
        try:
            return ("origin", origin_uuid, int(origin_id))
        except (TypeError, ValueError):
            pass
    artist = (trk.get("artist") or "").strip().lower()
    title = (trk.get("title") or "").strip().lower()
    length = int(trk.get("length") or 0)
    return ("meta", artist, title, length)


# ---- Engine-DJ-Quelle --------------------------------------------------

class EngineSource:
    def __init__(self, db_dir: str):
        self.db_dir = Path(db_dir).expanduser().resolve()
        self.m_db_path = self.db_dir / "m.db"
        self.hm_db_path = self.db_dir / "hm.db"
        if not self.m_db_path.exists():
            raise FileNotFoundError(f"m.db nicht gefunden in {db_dir}")
        if not self.hm_db_path.exists():
            raise FileNotFoundError(f"hm.db nicht gefunden in {db_dir}")

    def _open_ro(self, path: Path) -> sqlite3.Connection:
        uri = f"file:{path}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def fetch_history_entries(self) -> tuple[list[dict], str]:
        """
        Liefert eine Liste von Records: jedes Record = ein einzelner Play
        (HistorylistEntity), enriched mit den Track-Metadaten aus m.db.
        Auch tuple zurück: source-m.db-Pfad als string.
        """
        m = self._open_ro(self.m_db_path)
        hm = self._open_ro(self.hm_db_path)
        try:
            sessions = {}
            for row in hm.execute(
                "SELECT id, title, startTime FROM Historylist "
                "WHERE isDeleted IS NULL OR isDeleted = 0"
            ):
                sessions[row["id"]] = {
                    "id": row["id"],
                    "title": row["title"] or "",
                    "startTime": row["startTime"],
                }

            entries = list(
                hm.execute(
                    "SELECT listId, trackId, startTime FROM HistorylistEntity"
                )
            )

            track_columns = (
                "id, title, artist, album, genre, bpm, key, length, "
                "path, uri, rating, year, comment, label, "
                "originDatabaseUuid, originTrackId, "
                "timeLastPlayed, streamingSource"
            )
            tracks = {}
            for row in m.execute(f"SELECT {track_columns} FROM Track"):
                tracks[row["id"]] = dict(row)

            records = []
            missing_track = 0
            for ent in entries:
                trk = tracks.get(ent["trackId"])
                if not trk:
                    missing_track += 1
                    continue
                sess = sessions.get(ent["listId"])
                if not sess:
                    continue
                records.append({
                    "track": trk,
                    "session_id": sess["id"],
                    "session_title": sess["title"],
                    "played_at": ent["startTime"],
                })
            if missing_track:
                print(
                    f"  ⚠ {missing_track} HistorylistEntity-Einträge ohne passenden "
                    f"Track in m.db (DB: {self.m_db_path.parent.name})",
                    file=sys.stderr,
                )
            return records, str(self.m_db_path)
        finally:
            m.close()
            hm.close()


# ---- Merge-Logik -------------------------------------------------------

def merge_records(
    records_per_source: list[tuple[list[dict], str]],
    verbose: bool = False,
) -> list[dict]:
    merged: dict[tuple, dict] = {}
    for records, source_path in records_per_source:
        for r in records:
            trk = r["track"]
            ident = track_identity(trk)
            entry = merged.get(ident)
            if entry is None:
                entry = {
                    "identity": ident,
                    "track": trk,
                    "sources": set(),
                    "play_count": 0,
                    "first_played": None,
                    "last_played": None,
                    "session_titles": set(),
                }
                merged[ident] = entry
            entry["sources"].add(source_path)
            entry["play_count"] += 1
            ts = r["played_at"]
            if ts is not None:
                if entry["first_played"] is None or ts < entry["first_played"]:
                    entry["first_played"] = ts
                if entry["last_played"] is None or ts > entry["last_played"]:
                    entry["last_played"] = ts
            if r["session_title"]:
                entry["session_titles"].add(r["session_title"])
            # Bei Konflikt: Track mit Beatport-URI bevorzugen
            existing_bp = parse_beatport_id(entry["track"].get("uri"))
            new_bp = parse_beatport_id(trk.get("uri"))
            if not existing_bp and new_bp:
                entry["track"] = trk
    if verbose:
        print(f"  → {len(merged)} eindeutige Tracks nach Merge", file=sys.stderr)
    return list(merged.values())


def sort_merged(merged: list[dict]) -> list[dict]:
    NEVER = 9_999_999_999

    def key(e):
        first = e["first_played"] if e["first_played"] is not None else NEVER
        has_bp = 0 if parse_beatport_id(e["track"].get("uri")) else 1
        return (first, has_bp)

    return sorted(merged, key=key)


def split_into_playlists(items: list[dict], max_per: int) -> list[list[dict]]:
    if max_per <= 0:
        return [items]
    return [items[i: i + max_per] for i in range(0, len(items), max_per)]


# ---- Track-Dict-Builder ------------------------------------------------

def build_track_dict(entry: dict, position: int) -> dict:
    trk = entry["track"]
    bp_id = parse_beatport_id(trk.get("uri"))
    length_sec = int(trk.get("length") or 0)
    file_path = trk.get("path") or trk.get("uri") or ""
    file_exists = False
    if file_path and not file_path.startswith(("streaming://", "http://", "https://")):
        try:
            file_exists = os.path.exists(file_path)
        except OSError:
            file_exists = False
    rating_raw = trk.get("rating")
    rating_stars = (
        round((rating_raw or 0) / 10) if isinstance(rating_raw, (int, float)) else None
    )
    return {
        "position": position,
        "title": trk.get("title") or "",
        "artist": trk.get("artist") or "",
        "album": trk.get("album") or "",
        "genre": trk.get("genre") or "",
        "bpm": float(trk.get("bpm")) if trk.get("bpm") else None,
        "key_camelot": engine_key_to_camelot(trk.get("key")),
        "key_classic": engine_key_to_classic(trk.get("key")),
        "length_ms": length_sec * 1000,
        "file_path": file_path,
        "file_exists": file_exists,
        "beatport_id": int(bp_id) if bp_id else None,
        "energy": None,  # Engine speichert kein einheitliches Energy-Feld pro Track
        "rating": rating_stars if rating_stars is not None and rating_stars > 0 else None,
        "play_count": entry["play_count"],
        "first_played": parse_iso(entry["first_played"]),
        "last_played": parse_iso(entry["last_played"]),
        "sessions": sorted(entry["session_titles"]),
    }


# ---- Output-Writer -----------------------------------------------------

def write_m3u8(tracks: list[dict], path: Path) -> None:
    lines = ["#EXTM3U"]
    for t in tracks:
        artist = t["artist"]
        title = t["title"]
        length_sec = (t["length_ms"] or 0) // 1000
        lines.append(f"#EXTINF:{length_sec},{artist} - {title}")
        if t["beatport_id"]:
            lines.append(f"#EXTBEATPORTID:{t['beatport_id']}")
        lines.append(t["file_path"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_json(playlist_name: str, tracks: list[dict], sources: list[str], path: Path) -> None:
    payload = {
        "playlist_name": playlist_name,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_databases": sources,
        "track_count": len(tracks),
        "tracks": tracks,
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


CSV_HEADERS = [
    "position", "title", "artist", "album", "genre", "bpm",
    "key_camelot", "key_classic", "length_ms", "file_path", "file_exists",
    "beatport_id", "energy", "rating", "play_count", "first_played",
    "last_played", "session_count",
]


def write_csv(tracks: list[dict], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(CSV_HEADERS)
        for t in tracks:
            w.writerow([
                t["position"],
                t["title"],
                t["artist"],
                t["album"],
                t["genre"],
                t["bpm"] if t["bpm"] is not None else "",
                t["key_camelot"],
                t["key_classic"],
                t["length_ms"],
                t["file_path"],
                "true" if t["file_exists"] else "false",
                t["beatport_id"] if t["beatport_id"] is not None else "",
                t["energy"] if t["energy"] is not None else "",
                t["rating"] if t["rating"] is not None else "",
                t["play_count"],
                t["first_played"] or "",
                t["last_played"] or "",
                len(t["sessions"]),
            ])


# ---- Hauptlogik --------------------------------------------------------

def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Engine-DJ-History-Merge-Exporter (read-only).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Beispiele:\n"
            "  export.py --source /path/Database2 --out /tmp/out\n"
            "  export.py --source A/Database2 --source B/Database2 --out /tmp/out --formats m3u8,csv\n"
            "  export.py --source /path/Database2 --out /tmp/out --max-per-playlist 100 --dry-run\n"
        ),
    )
    ap.add_argument("--source", action="append", default=[],
                    help="Pfad zum Database2-Ordner einer Engine-DB. Mehrfach verwendbar.")
    ap.add_argument("--out", required=True,
                    help="Zielordner für Exporte. Wird angelegt falls nicht vorhanden.")
    ap.add_argument("--formats", default="m3u8,json,csv",
                    help="Komma-Liste aus m3u8,json,csv. Default: alle drei.")
    ap.add_argument("--max-per-playlist", type=int, default=200,
                    help="Max Tracks pro Playlist-Datei (0 = kein Split). Default: 200.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Nur anzeigen was passieren würde, nichts schreiben.")
    ap.add_argument("--verbose", action="store_true",
                    help="Detailliertes Logging.")
    ap.add_argument("--all-registered", action="store_true",
                    help="(MVP-2, noch nicht aktiv) Alle registrierten DBs aus "
                         "~/.engine-dj-manager/registry.db nutzen.")
    args = ap.parse_args()

    if args.all_registered:
        print("Hinweis: --all-registered ist im MVP noch nicht implementiert.", file=sys.stderr)
        sys.exit(2)
    if not args.source:
        ap.error("mindestens ein --source erforderlich (oder --all-registered in MVP-2)")
    return args


def main() -> int:
    args = parse_args()
    formats = {f.strip().lower() for f in args.formats.split(",") if f.strip()}
    invalid = formats - {"m3u8", "json", "csv"}
    if invalid:
        print(f"Ungültige Formate: {invalid}", file=sys.stderr)
        return 2

    records_per_source: list[tuple[list[dict], str]] = []
    for src in args.source:
        try:
            es = EngineSource(src)
        except FileNotFoundError as exc:
            print(f"FEHLER: {exc}", file=sys.stderr)
            return 3
        recs, src_path = es.fetch_history_entries()
        records_per_source.append((recs, src_path))
        if args.verbose:
            print(f"  {src}: {len(recs)} History-Einträge", file=sys.stderr)

    if args.verbose:
        total = sum(len(r) for r, _ in records_per_source)
        print(f"\nGesamt {total} History-Einträge aus {len(records_per_source)} DB(s)", file=sys.stderr)

    merged = merge_records(records_per_source, verbose=args.verbose)
    sorted_merged = sort_merged(merged)
    chunks = split_into_playlists(sorted_merged, args.max_per_playlist)

    playlists = []
    for idx, chunk in enumerate(chunks, 1):
        first_ts = chunk[0]["first_played"]
        last_ts = chunk[-1]["first_played"]
        suffix = ""
        if first_ts and last_ts:
            d1 = datetime.fromtimestamp(first_ts, tz=timezone.utc).strftime("%Y-%m")
            d2 = datetime.fromtimestamp(last_ts, tz=timezone.utc).strftime("%Y-%m")
            suffix = f"_{d1}-bis-{d2}" if d1 != d2 else f"_{d1}"
        name = f"History-Merged-{idx:02d}{suffix}"
        track_dicts = [build_track_dict(e, i + 1) for i, e in enumerate(chunk)]
        playlists.append({"name": name, "tracks": track_dicts})

    total_tracks = sum(len(p["tracks"]) for p in playlists)

    if args.dry_run:
        print(f"DRY-RUN: würde {len(playlists)} Playlist(s) mit insgesamt "
              f"{total_tracks} Tracks schreiben in {args.out}")
        for p in playlists:
            print(f"  {p['name']} ({len(p['tracks'])} Tracks)")
        return 0

    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    sources_list = [s for _, s in records_per_source]
    missing_rows: list[tuple[str, str, str, str]] = []

    for p in playlists:
        for t in p["tracks"]:
            if (
                not t["file_exists"]
                and t["file_path"]
                and not t["file_path"].startswith(("streaming://", "http://", "https://"))
            ):
                missing_rows.append((p["name"], t["title"], t["artist"], t["file_path"]))
        if "m3u8" in formats:
            write_m3u8(p["tracks"], out_dir / f"{p['name']}.m3u8")
        if "json" in formats:
            write_json(p["name"], p["tracks"], sources_list, out_dir / f"{p['name']}.json")
        if "csv" in formats:
            write_csv(p["tracks"], out_dir / f"{p['name']}.csv")

    summary_lines = [
        f"# History-Merge-Export — {datetime.now().astimezone().isoformat(timespec='seconds')}",
        "",
        f"**Quell-Datenbanken ({len(sources_list)}):**",
    ]
    summary_lines += [f"- `{s}`" for s in sources_list]
    summary_lines += [
        "",
        f"**Tracks insgesamt:** {total_tracks}",
        f"**Playlisten:** {len(playlists)}",
        f"**Tracks mit fehlender Datei:** {len(missing_rows)}",
        f"**Formate:** {', '.join(sorted(formats))}",
        f"**Max Tracks/Playlist:** {args.max_per_playlist}",
        "",
        "## Playlisten",
    ]
    summary_lines += [
        f"- `{p['name']}` — {len(p['tracks'])} Tracks" for p in playlists
    ]
    (out_dir / "_summary.md").write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    if missing_rows:
        with (out_dir / "_missing-files.csv").open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["playlist", "title", "artist", "file_path"])
            for row in missing_rows:
                w.writerow(row)

    print(f"✓ {len(playlists)} Playlist(s), {total_tracks} Tracks geschrieben in {out_dir}")
    if missing_rows:
        print(f"  ⚠ {len(missing_rows)} fehlende Dateien — siehe _missing-files.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
