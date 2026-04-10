# Beatport DJ Suite v3.6 — Architektur & Interaktionsdiagramm

## Datenquellen & Speicher

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNE DATENQUELLEN                        │
├─────────────┬──────────────┬────────────┬──────────┬───────────┤
│  Beatport   │ DJPlaylists  │  Lexicon   │ Engine   │  Groof    │
│  API (v4)   │ .fm          │  DJ (API)  │ DJ (DB)  │  .app     │
│  ─────────  │ ──────────── │ ────────── │ ──────── │ ───────── │
│  Bearer via │ Session-     │ localhost  │ m.db     │ CORS-Proxy│
│  CDP/XHR    │ Cookie       │ :48624     │ hm.db    │ localhost │
│  Session    │ (kein offi-  │ REST API   │ stm.db   │ api.groof │
│  Manager    │ zielles API) │            │ sm.db    │ .music    │
└──────┬──────┴──────┬───────┴─────┬──────┴────┬─────┴─────┬─────┘
       │             │             │           │           │
       ▼             ▼             ▼           ▼           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LOKALER SPEICHER                            │
├──────────────────┬──────────────────┬───────────────────────────┤
│ scoring-data.json│ data/suite.db    │ config/                   │
│ (23 MB, 99k     │ (SQLite, 511     │ scoring-merge-rules.json  │
│  Tracks, Kurz-  │  Beatport        │ scoring-merge-preview.json│
│  Keys i/t/a/g/  │  Labels)         │ scoring-merge-log.jsonl   │
│  b/k/c/y/l/ms)  │                  │ scoring-backups/          │
│ + nach Import:  │                  │ sync-presets.json          │
│   rating (0-5)  │                  │                           │
│   plays_total   │                  │                           │
│   last_played   │                  │                           │
│   file_path     │                  │                           │
└──────────────────┴──────────────────┴───────────────────────────┘
```

## UI-Gruppen → Funktionen → Datenquellen

```
┌─────────────────────────────────────────────────────────────────┐
│ 📚 LIBRARY                                                      │
│ Scanner: Delta-Sync, Cache, Diagnose (Auto/XHR/Route/DOM)      │
│ Arbeitsbestand: Playlist-Selektion, Filter                     │
│ Ergebnis: Duplikate (klickbar), Tiefenanalyse, Playlist-Inhalt │
│ Engine-Import: DB-Quellen (Local/USB), Preview→Apply, Ratings  │
│ Loeschen: Batch mit Bestaetigungstext                          │
├─────────────────────────────────────────────────────────────────┤
│ 🔍 EXPLORE                                                      │
│ Suche & Filter: Wildcard, Genre-Chips, BPM, Key, Jahr, Label, │
│   Rating, Plays, Flags → Recommendations (Beatport + Groof)   │
│ Dashboard: Genre-Bars, BPM-Cluster, Tonarten, Timeline         │
│ Analyse: BPM-Histogramm, Camelot-Wheel, Genre, Overlap        │
│ Builder: Track-Pool (alle Filter) → Playlist (Camelot/BPM)    │
├─────────────────────────────────────────────────────────────────┤
│ 🛠 BUILD: Playlist WIZ (Live Beatport CRUD)                    │
├─────────────────────────────────────────────────────────────────┤
│ 🚀 PIPELINE                                                     │
│ Sync: BP→DJPL (Diff) → Lexicon (Batch) → Engine → USB         │
│ Export: Rekordbox XML, Traktor NML, JSON, JSONL, M3U           │
│ Automation: OSC-Bridge, Python-Tools                           │
├─────────────────────────────────────────────────────────────────┤
│ ⚙️ SETTINGS: Pfade, OSC, Handbuch                              │
└─────────────────────────────────────────────────────────────────┘
```

## Datenfluss End-to-End

```
1. SCAN:      Beatport (CDP/XHR) ──→ scoring-data.json (99k Tracks)
2. ENRICH:    Engine m.db+hm.db ──→ scoring-data.json (+rating,plays,paths)
3. SEARCH:    scoring-data ──→ Filter (Genre/BPM/Key/Rating/Plays) ──→ Ergebnis
4. BUILD:     Ergebnis ──→ Builder (Camelot/BPM-Flow) ──→ Save
5. SYNC:      Beatport ──→ DJPL.fm ──→ Lexicon ──→ Engine ──→ USB
6. EXPORT:    Cache ──→ Rekordbox/Traktor/JSON/JSONL/M3U
```

## IPC-Kanaele (Renderer ↔ Main)

```
scannerApi          → scanner:*, cache:*, auth:*
playlistApi         → playlist:list/tracks/create/rename/delete/add-tracks/remove-tracks
exportApi           → export:choose-save-path/generate/save-playlist-local
engineApi           → engine:discover-databases/discover-all-databases/import-streaming
scoringMergeApi     → scoring:merge-engine-preview/read-preview/apply
recommendationsApi  → recommendations:for-track/via-groof/groof-status
labelsApi           → labels:list/stats
syncApi             → sync:import-to-djplaylists/scrape-djplaylists/djplaylists-to-lexicon-all
analysisApi         → analysis:get-track-data/get-overlap-matrix
authApi             → auth:get-status/test-session/reauthenticate
```

---

## Alte Architektur-Referenz (v3.0)

## Komponenten

- `electron-app/auth/*`
  - interner Beatport-Session-Kontext
  - persistente Electron-Partition
  - Session-Probe und Login-Öffnung ohne Passwortspeicherung
- `electron-app/scanner/cdp-scanner.mjs`
  - interner Client oder externer CDP-Fallback
  - XHR-First Discovery und Analyse über Beatport-API
  - lokaler SQLite-Arbeitsbestand als Primärquelle für UI und CSV
  - Request-Context-Resolver für Authorization/Header aus dem internen Session-Kontext
  - Route-/DOM-Fallback, wenn XHR nicht auflösbar ist
  - RunStore
  - Legacy-Erkennung, Migration, ZIP-Export
  - bevorzugter kompatibler Run und Delta-Baseline für neue Discovery-Läufe
- `tools/beatport_cdp_tool.mjs`
  - kompatibler CLI-Entrypoint auf den Scanner-Kern
- `tools/bpx.mjs`
  - XHR-/Playlist-CLI für API-Kontext, CRUD und Cache-Export
- `electron-app/main.mjs`
  - IPC-Grenze zwischen UI und Tool
- `electron-app/renderer/*`
  - Archivansicht
  - Discovery-/Analyse-Workflow
  - Analysis-, Export- und Playlist-Wiz-Tabs
  - Legacy-Migration und ZIP-Export

## Run-Schema v2

Pflichtfelder:
- `schemaVersion: 2`
- `origin.kind`
- `migration`
- `counts`
- `selection`
- `analysisPlan`

## Persistenzmodell

- SQLite ist der operative Arbeitsbestand für Playlistlisten, Trackdetails, Fingerprints und Exportstände
- JSONL ist der technische Primärbestand
- CSV/JSON sind abgeleitete Exportformate
- jede Änderung wird gespiegelt in:
  - Archivordner
  - sichtbaren Exportordner
- Beatport-Login lebt getrennt davon ausschließlich im persistenten Electron-Profil
- Run-Artefakte enthalten keine Passwörter, Tokens oder Cookies
- der Cache wird bei Bedarf aus vorhandenen Runs wiederaufgebaut
- Delta-Sync aktualisiert den Cache aus Beatport-Summaries, ohne automatisch eine Vollanalyse anzustoßen
- Playlist- und Trackdaten enthalten die effektive Datenquelle `xhr`, `route` oder `dom`
- Duplikate werden zuerst als Kandidaten über `Name + Trackzahl` und danach serverseitig über einen Track-Fingerprint bestätigt

## Statusmodell

- `running`
- `ready_for_analysis`
- `paused`
- `completed`
- `incomplete`
