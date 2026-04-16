# Explorer Report: beatport-dj-suite v4.0.0 (Haupttool)

**Pfad:** `/Users/roberth./Projects/_local/beatport-dj-suite/`
**Version:** 4.0.0, Branch `v4`, Electron-App

## 1. Zweck & Kernfunktion

Native-Electron-Desktop-App für DJs und Musikproduzenten, die Beatport-Playlisten automatisiert scannt, analysiert und mit DJ-Software (Engine DJ, Rekordbox, Traktor) synchronisiert. Ersetzt die Legacy-CLI `beatport-scanner v1.5.1` durch eine modulare, multi-Tab-UI für Discovery, Analyse, Playlist-Management und Export — alles lokal ohne Cloud-Dependency.

## 2. Tech-Stack

| Layer | Technologie |
|-------|-------------|
| Desktop Framework | Electron 32.2.0 (Node 20+, ESM) |
| Backend | Node.js + Python 3 (subprocess via spawnSync) |
| Frontend | Vanilla JS/CSS (no React), modular Tabs |
| Session | Electron BrowserWindow partition (persistent, no password cache) |
| Data | SQLite (`suite.db`), JSON/JSONL (`scoring-data.json` ~23 MB) |
| APIs | Beatport v4 (XHR Bearer + CDP), DJPlaylists.fm, Lexicon DJ (localhost:48624), Engine DJ m.db/hm.db, Groof.music |
| Build | electron-builder (DMG/ZIP, darwin-arm64) |

## 3. Haupt-Features (Tabs)

- **📚 Library**: Scanner (CDP/XHR Delta-Sync), Arbeitsbestand, Duplikat-Tiefenanalyse, Engine-Import, Batch-Löschen
- **🔍 Explore**: Wildcard-Suche + Multi-Filter (Genre/Label/BPM/Key/Rating/Plays/Year/Flags), Labels (511), Analyse-Dashboards, Engine-Analyse
- **🛠 Build**: Playlist WIZ (Live Beatport CRUD), Playlist Builder (Drag&Drop + Camelot-Check)
- **🚀 Pipeline**: Beatport→DJPL→Lexicon→Engine→USB Sync; Rekordbox/Traktor/M3U/JSON Export; OSC-Bridge (OBS Now-Playing); Python Automation
- **⚙️ Settings**: Unified Config (Pfade, Auth-Mode, CDP Host, Analysis-Method, Recovery-Policy)

## 4. Daten-Flows

```
Beatport (CDP/XHR, Session-Cookie)
  → Run-Store (JSONL + Mirror)
  → SQLite-Cache (UI)
  → Duplikat-Fingerprinting (Name+Count → Fingerprint-Bestätigung)

Engine DJ (m.db/hm.db, read-only)
  → Python engine_tools.py
  → merge_engine_scoring.py
  → scoring-data.json (99k Tracks, zentrale DB, non-destructive)

Selektion:
  scoring-data → Filter → Playlist Builder (Camelot-Check) → Export

Pfade:
  Runs:    ~/Library/Application Support/Beatport Playlist Scanner/archive/{runId}/
  Cache:   ~/Library/.../suite.db
  Scoring: {exportsRootDir}/scoring-data.json
```

## 5. Architektur-Struktur (23.6k LoC)

```
electron-app/
├── main.mjs                     (1915 LoC, IPC-Dispatcher, 20+ Handler)
├── preload.mjs                  (298 LoC, Context Bridge)
├── renderer/
│   ├── index.html               (634 LoC, 10 Tabs)
│   ├── app.js                   (2979 LoC, Router, renderTable, Events)
│   ├── styles.css               (~1500 LoC)
│   ├── components/playlist-builder.js
│   └── tabs/                    (6572 LoC: automation, analysis, engine-analyze, playlist-wiz, search, sync, export, labels, settings)
├── scanner/                     (8503 LoC: cdp-scanner 4929 LoC, run-store, xhr-scanner, legacy-migrator)
├── cache/sqlite-cache.mjs       (714 LoC)
├── auth/                        (session-manager 518 LoC, session-probe)
├── api/                         (2036 LoC: djplaylists, lexicon, soundiiz, groof, sync_orchestrator)
├── integrations/                (engine-analyze-matcher, performance-classifier, project-discovery, m3u-exporter, osc-bridge)
│   └── python/
│       ├── engine_tools.py      (77 KB, 11 CLI-Subcommands, m.db/hm.db/rbm.db reader)
│       └── merge_engine_scoring.py (12 KB)
├── data/                        (export-formats, sync-presets)
└── utils/common.mjs
```

## 6. Auffälligkeiten & Bedenken

### A. Tote Pfade / Placeholder
- `tabs/automation.js`, `tabs/export.js`, `tabs/settings.js`: Placeholder-Panels, Logik in Integrations/data-Modulen
- `plugins/.mcp.json`: leerer Placeholder (`{"mcpServers": {}}`), nicht verdrahtet
- `plugins/browser-devtools-automation`: Observation-only, nicht integriert mit Main-App

### B. Doppelte Logik
- Track-Matching in `engine-analyze-matcher.mjs` + `merge_engine_scoring.py`
- Playlist-Normalisierung in `xhr-scanner.mjs` + Python-Seite `engine_tools.py`
- CSV-Export in `run-store.mjs` + `export-formats.mjs` mit verschiedenen Spalten

### C. Python-Integration als Risk
- `runPythonJson()` in main.mjs:121-149 spawnt `python3` blocking
- PerformanceData BLOB-Decoder (Engine DJ) ist Python-only
- Opportunity: Node.js native SQLite migration langfristig

### D. UI-Inkonsistenz
- `engine-analyze.js` nutzt **nicht** shared `renderTable()` aus app.js → Duplikat-Code
- Sortier-Lock-System (search.js) nur dort implementiert, andere Tabs nutzen plain `.sort()`
- **Blocker:** Refactor von `renderTable()` + Sort-Locks als shared Module

### E. Plugin-Scaffold unfertig
- `.agents/plugins/marketplace.json` leer
- `plugins/browser-devtools-automation`: separate Electron-App, observer-only
- **Design-Intent:** Sidecar-Plugins als isolierte Electron-Windows mit `.mcp.json` + `.app.json`
- **Opportunity** für Merge-Strategie: Scanner/Dedupe/PL WIZ als Plugins

## 7. Kritische Dateien (mit Zeilen)

| Datei | Zeilen | Zweck |
|-------|--------|-------|
| `main.mjs` | 1-1915 | Bootstrap, IPC, Lifecycle |
| `scanner/cdp-scanner.mjs` | 1-4929 | Discovery, Deep-Analyze, Run-State |
| `renderer/app.js` | 1-2979 | DOM init, routing, renderTable, search/filter |
| `integrations/python/engine_tools.py` | 1-2351 | Engine-DB-Reader, 11 CLI-Subcommands |

## 8. Empfehlungen für Merge-Strategie

**Größte Gewinne:**
- `beatport-dedupe` direkt integrierbar → `integrations/duplicate-analyzer.mjs`
- `beatport-scanner v1.x` Tests adaptieren (Code weitgehend portiert)
- `Beatport PL WIZ v5` Frontend-Port als neuer Tab (Camelot-Lib bleibt vanilla JS)

**Größte Risiken:**
- Python-Dependency-Growth → Node-Migration langfristig nötig
- UI-Konsistenz (Tab-Patterns) blockiert neue Features
- Plugin-Scaffold nicht finalisiert

**Empfohlene Reihenfolge:**
1. Consolidate duplicate-matching (scanner + dedupe) → shared module
2. Stabilize UI helpers (renderTable, sort-locks) → export from app.js
3. Port WIZ v5 als neuer Tab
4. Plan Python→Node migration (optional)
5. Finalize plugin-scaffold (.mcp.json, .app.json)
