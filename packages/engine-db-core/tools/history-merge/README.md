# History-Merge-Exporter

CLI das aus einer oder mehreren Engine-DJ-Datenbanken die History-Sessions
extrahiert, Tracks dedupliziert mergt und in M3U8, JSON und CSV exportiert.

**Strikt read-only** auf den Quell-DBs. Alle Schreib-Operationen gehen
ausschließlich in den `--out`-Zielordner.

## Voraussetzungen

- Python 3.11+ (Standard-Library reicht — kein `pip install`)
- Engine-DJ `Database2`-Ordner als Quelle. Darin müssen `m.db` und `hm.db`
  liegen.

## Schnell-Start

```bash
# Eine Quelle, alle Formate, Default 200 Tracks/Playlist
python3 tools/history-merge/export.py \
  --source "/Volumes/USB/Engine Library/Database2" \
  --out ~/Desktop/history-export-$(date +%Y%m%d)

# Mehrere Quellen mergen
python3 tools/history-merge/export.py \
  --source "/Volumes/USB1/Engine Library/Database2" \
  --source "/Volumes/USB2/Engine Library/Database2" \
  --out ~/Desktop/history-merge

# Dry-Run zur Vorschau
python3 tools/history-merge/export.py \
  --source "/path/Database2" --out /tmp/x --dry-run

# Nur CSV, kleinere Playlisten
python3 tools/history-merge/export.py \
  --source "/path/Database2" --out /tmp/out \
  --formats csv --max-per-playlist 100
```

## Flags

| Flag | Pflicht | Default | Bedeutung |
|---|---|---|---|
| `--source <pfad>` | ja (mind. 1×) | — | Pfad zum `Database2`-Ordner. Mehrfach. |
| `--out <pfad>` | ja | — | Zielordner. Wird angelegt. |
| `--formats <liste>` | nein | `m3u8,json,csv` | Untermenge. |
| `--max-per-playlist <n>` | nein | `200` | `0` = kein Split. |
| `--dry-run` | nein | aus | Nur anzeigen, nichts schreiben. |
| `--verbose` | nein | aus | Detailliertes Logging. |
| `--all-registered` | nein | aus | (MVP-2 — noch nicht aktiv) |

## Identitäts- und Merge-Regeln

Tracks aus mehreren Quell-DBs werden über folgende Hierarchie identifiziert:

1. **Beatport-ID** — extrahiert aus `Track.uri` (`streaming://Beatport%20LINK/Track/12345678`)
2. **Origin** — Kombination aus `originDatabaseUuid` + `originTrackId`
3. **Metadaten-Fallback** — `artist + title + length` (lowercased, getrimmt)

Pro eindeutigem Track werden gesammelt:

- `play_count` — Anzahl HistorylistEntity-Einträge über alle Quellen
- `first_played` / `last_played` — frühestes / spätestes `startTime`
- `sessions` — eindeutige Session-Titel-Liste

## Sortierung

1. **Primär:** `first_played` aufsteigend (älteste zuerst)
2. **Sekundär:** Tracks mit Beatport-ID vor Tracks ohne (innerhalb gleichem Datum)

Tracks ohne Datum landen am Ende.

## Output-Struktur

```
<--out>/
├── History-Merged-01_2024-08.m3u8        Datums-Suffix automatisch
├── History-Merged-01_2024-08.json
├── History-Merged-01_2024-08.csv
├── History-Merged-02_2024-09-bis-2024-12.m3u8
├── ...
├── _summary.md            Report: Quellen, Track-/Playlist-Anzahl, Formate
└── _missing-files.csv     Tracks deren `file_path` nicht mehr existiert
```

## Formate

### M3U8

```
#EXTM3U
#EXTINF:420,Artist - Title
#EXTBEATPORTID:12345678
/path/to/track.flac
```

### JSON (pro Playlist)

```json
{
  "playlist_name": "History-Merged-01_2024-08",
  "generated_at": "2026-04-25T...",
  "source_databases": ["/path/m.db"],
  "track_count": 200,
  "tracks": [
    {
      "position": 1,
      "title": "...", "artist": "...", "album": "...", "genre": "...",
      "bpm": 122.5,
      "key_camelot": "8A", "key_classic": "Am",
      "length_ms": 420000,
      "file_path": "...", "file_exists": true,
      "beatport_id": 12345678,
      "energy": null, "rating": 4,
      "play_count": 3,
      "first_played": "2024-08-15T22:14:00Z",
      "last_played": "2025-03-02T03:47:00Z",
      "sessions": ["Session A", "Session B"]
    }
  ]
}
```

### CSV

UTF-8, Komma-separiert, RFC-4180. Header:

```
position,title,artist,album,genre,bpm,key_camelot,key_classic,length_ms,
file_path,file_exists,beatport_id,energy,rating,play_count,first_played,
last_played,session_count
```

## Sicherheits-Regeln

- Alle Quell-DBs werden **read-only** geöffnet (`?mode=ro`).
- Das Tool schreibt **niemals** in m.db, hm.db oder Engine-Library-Ordner.
- Schreibzugriffe gehen ausschließlich in den `--out`-Ordner.
- Bei fehlender `m.db` oder `hm.db` bricht das Tool sauber mit Exit-Code 3 ab.

## Exit-Codes

| Code | Bedeutung |
|---|---|
| 0 | Erfolg |
| 2 | Ungültige CLI-Argumente |
| 3 | Quell-DB nicht gefunden / nicht lesbar |
