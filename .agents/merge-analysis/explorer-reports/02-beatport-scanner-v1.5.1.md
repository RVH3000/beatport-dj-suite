# Explorer Report: beatport-scanner v1.5.1 (Legacy)

**Pfad:** `/Users/roberth./Projects/_github/beatport-scanner/`
**Version:** 1.5.1, stable, Electron Legacy-App

## 1. Zweck & Kernfunktion

Electron-Desktop-App für macOS zum Scannen persönlicher Beatport-Playlisten ohne Passwortspeicherung. Nutzt CDP und XHR-First Discovery über Beatport v4 API. Lokale SQLite-Erfassung, Delta-Sync, Duplikat-Erkennung. Vorgänger der beatport-dj-suite v4.

## 2. Tech-Stack

- Electron 32.2.0, electron-builder 25.1.8
- Node.js ESM (`.mjs`), WebSocket (ws 8.18.3)
- macOS-only (DMG/ZIP, hardenedRuntime=false)

**Unterschiede zum Haupttool:**
- Standalone Electron ohne Web-basierte Architektur
- XHR-First ohne SDK
- Persistentes Electron-Profil statt modernem Auth
- SQLite via `sqlite3` CLI (nicht embedded)

## 3. Haupt-Features

1. **Interne Beatport-Session** — persistenter Electron-Kontext (auth/session-manager.mjs, session-probe.mjs)
2. **XHR-First Discovery** — `/v4/my/playlists`, `/v4/my/playlists/{id}`, `/v4/my/playlists/{id}/tracks` (100er-Pagination)
3. **Delta-Sync** — nur geänderte Playlists seit letztem Run
4. **Duplikat-Erkennung** — Name+Count Kandidaten → Track-Fingerprint Bestätigung
5. **SQLite-Cache-Arbeitsbestand** — UI-Renders, Filterung, CSV-Export
6. **Tiefenanalyse** — pausierbar, selektive Playlists, optional per Genre/Label/Jahr
7. **Legacy-Migration** — v1.0.x → v2 Schema automatisch beim Start
8. **ZIP-Export** — komplette Run-Archive für Backup/Sharing
9. **Datenquellen-Tracking** — `source: xhr | route | dom`-Metadaten pro Datenpunkt
10. **Recovery-Modus** — Session-Recovery ohne App-Neustart

## 4. API-Zugriffe (konkret)

- `GET https://api.beatport.com/v4/my/playlists?per_page=100&page={n}`
- `GET https://api.beatport.com/v4/my/playlists/{id}`
- `GET https://api.beatport.com/v4/my/playlists/{id}/tracks?per_page=100&page={n}`

**Extrahiert:** Playlist-Namen, Track-Counts, IDs (server-authoritative), Track-Details (Artist, Title, BPM, Key, Genre, Label, Year).

**Ausgabeformate:**
- JSONL: `playlists.jsonl`, `duplicates.jsonl`, `track-analysis.jsonl`
- CSV: `duplicates_backup.csv`
- JSON: `manifest.json`, `summary.json`, `track-analysis.json`
- ZIP: kompletter Run-Export

## 5. Datenmodell

**Entities:**
- `Playlist` (ID, Name, serverTrackCount, userTrackCount, source)
- `Track` (ID, Name, Artist, BPM, Key, Genre, Label, ReleaseYear, Source)
- `PlaylistSummary` (Counts nach Genre/Label/Jahr)
- `Duplicate` (Kandidaten-Gruppen, Fingerprint, Status: Kandidat/Bestätigt/Ignoriert)
- `Run` (runId, schemaVersion: 2, status, phase, startedAt, finishedAt, config, app)

**Persistierung:**
- SQLite-Cache (sqlite-cache.mjs)
- Archive: `~/Library/Application Support/Beatport Playlist Scanner/runs/{runId}/`
- Exports: `~/Downloads/Beatport-Scanner-Exports/{runId}/`

## 6. Unique Features (Kandidaten für Übernahme)

1. **Track-Fingerprint Duplikat-Logik** — zweistufig (Name+Count → Fingerprint-Bestätigung), komplexer als im Haupttool
2. **Delta-Discovery mit Run-Baseline** — `resolveDiscoveryBaseline()` merkt sich letzten kompatiblen Run → echtes inkrementelles Scanning
3. **Pausierbare Analyse-Workflows** — `requestRunPause()`, `RUN_CONTROLS`-Map
4. **XHR-Tool (beatport_xhr_tool.mjs)** — standalone Node-CLI für API-Playlist-Verwaltung (add/remove/rename/export) ohne GUI
5. **Session-Recovery ohne Restart** — `InternalBeatportClient.evaluate()` für ephemerale JS-Evaluierungen
6. **Datenquellen-Provenance** — `source: "xhr|route|dom"` pro Datenpunkt

## 7. Legacy-Zeug (sollte zurückbleiben)

1. **v1.0.x Run-Schema-Migration** — komplex, nur historische Daten
2. **External Fallback CDP-Mode** — Notfall-CDP auf `dj.beatport.com` via Chromium/Helium
3. **DOM-Scraping Fallback** — `MutationObserver` nur wenn XHR/Route fehlschlug
4. **Legacy `beatport_duplicates_state.json`** — alte State-Datei
5. **Electron-Profil-Management** — `partition: "persist:beatport-auth-v1"`, Keychain-Integration (moderneres Auth geplant)
6. **CSV-Namen "beatport_duplicates_backup.csv"** — Legacy-Naming

## 8. Schnittstellen zu Engine DJ, OBS, externen Tools

- **Engine DJ:** Keine. (Im Haupttool vorhanden, hier Null)
- **OBS/Stream:** Keine. (MutationObserver ist intern für Duplikat-Markierung)
- **External:** `beatport_xhr_tool.mjs` als standalone CLI, ZIP-Export, CSV

## 9. Dateien relevant für Merge

| Path | Zweck | Übernahme? |
|------|-------|-----------|
| `tools/beatport_cdp_tool.mjs` (6642 L.) | Kern-Scanner-Engine | Ja, selektiv (Discovery, Analyze, Dedupe) |
| `tools/beatport_xhr_tool.mjs` | Standalone XHR-CLI | Ja (API-Ops, aber modernes SDK) |
| `electron-app/cache/sqlite-cache.mjs` | SQLite-Wrapper | Nein (Haupttool: embedded DB) |
| `electron-app/auth/session-manager.mjs` | Session-Kontext | Nein (modern: OAuth/SSO) |
| `tests/beatport-scanner.test.mjs` | Fixture-Tests | Ja (Pattern + Legacy-Migration Fixtures) |

## 10. Fazit

Die meisten Features sind im Haupttool bereits vorhanden oder modernisiert umgesetzt. **Übernahmewürdig:**
- Track-Fingerprint-Logik (falls im Haupttool nicht so ausgereift)
- Delta-Discovery Pattern mit Run-Baseline
- Pausierbare Run-Controls
- Datenquellen-Provenance (`source: xhr|route|dom`)

**Tests sollten portiert werden** (Fixtures für Legacy-Migration).

Das Repo kann danach archiviert werden — alle modernen Features sind ins Haupttool gewandert.
