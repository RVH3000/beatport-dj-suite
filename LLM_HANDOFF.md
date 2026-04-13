# LLM Handoff — Beatport DJ Suite: Engine-Analyse Tab Weiterentwicklung

Erstellt: 2026-04-13
Von: Claude Code CLI (Opus 4.6, 1M Kontext)
Nach: Claude Code CLI / Dispatch

## Aktueller Stand

- **Branch:** `main` (feat/gui-umbau-optimierung wurde gemerged)
- **Letzter Commit:** `d8a0d7e config: scoring-merge-preview aktualisiert`
- **Was gerade läuft:** Engine-Analyse Tab funktioniert für Playlists + History. Mehrere Bugs gefixt, UI iteriert. Nächste Schritte: Feinschliff + fehlende Features.

## Was in dieser Session gebaut wurde

### Engine DJ Read-Layer (6 Schritte, branch feature/groof-integration)
1. ✅ rbm.db (Rekordbox-Import) in DATABASE_FILES aktiviert
2. ✅ PerformanceData BLOB-Decoder (trackData, quickCues, loops)
3. ✅ SmartList-Abfrage + isPersisted in list_playlists()
4. ✅ Multi-DB Diff-Funktion (diff_databases)
5. ✅ Unified History Merge (unify_history)
6. ✅ Legacy-Code Cleanup (_sanitize_for_json BLOB-Dekodierung)

### GUI-Optimierung (branch feat/gui-umbau-optimierung, gemerged)
- ✅ Scanner-Tab: Accordions (Run-History, Pfade & Details)
- ✅ Progress-Bar (pulsierend bei Delta-Sync)
- ✅ Workflow-Modal (Button oben rechts)
- ✅ Empty-States mit CTA-Buttons

### Engine-Analyse Tab (NEU, Explore-Gruppe)
- ✅ Python: dump_playlist_tracks_enriched() + CLI-Subcommand
- ✅ Matching-Modul: engine-analyze-matcher.mjs (3-stufig: Beatport-ID, Title/Artist, Fuzzy Dice)
- ✅ IPC: 3 Handler (discover, list-playlists, load-playlist-tracks)
- ✅ UI: DB-Auswahl mit Pfad-Persistenz, Playlist/History-Toggle, Multi-Select
- ✅ Ergebnis-Tabelle: Sortierbar, Camelot-Darstellung (lila), Match-Badges
- ✅ History: Timestamps formatiert, Datum-Sortierung im Picker
- ✅ Analyse-Verlauf: Mehrere Ergebnisse als Tabs (Playlist 🎵 / History 📊)

## Offene TODOs

### Engine-Analyse Tab — Feinschliff
- [x] History-Analyse: Cross-Join hm.db → m.db implementiert (dump_history_tracks_enriched + history-tracks-enriched CLI + IPC-Handler)
- [x] "In Suche laden" Button: EventListener in app.js verdrahtet → wechselt zum Search-Tab und lädt Tracks via loadExternalTracks()
- [ ] Scoring-Data-Pfad: Aktuell hardcoded leer ("") — aus Settings laden oder Dateiauswahl-Dialog
- [x] CSV-Export: Camelot-Spalte im Export ergänzt
- [ ] Fuzzy-Matching testen: Prefix-Bucket-Optimierung validieren mit echten Daten
- [ ] `renderTable()` aus app.js ist nicht exportiert — Engine-Analyse baut eigene Tabellen. Langfristig: renderTable exportieren oder als shared Modul

### UI-Konsistenz (Memory gespeichert)
- [ ] Neue Features müssen bestehende Patterns nutzen (renderTable, data-table CSS, is-selected)
- [ ] Search-Tab Sortier-Pattern (Lock-System) als Vorlage für alle sortierbaren Tabellen

### Weitere Features (noch nicht angefangen)
- [ ] Engine-Analyse: Vergleichsansicht Playlist vs. History nebeneinander
- [ ] Engine-Analyse: Drag & Drop von Ergebnis-Tracks in den Playlist Builder
- [ ] Scanner-Tab: Progress-Bar mit echtem Fortschritt (braucht Event-Streaming vom Scan-Prozess)

## Wichtige Dateipfade

```
electron-app/integrations/python/engine_tools.py   ← Backend (HAUPTDATEI, ~1570 Zeilen)
electron-app/integrations/engine-analyze-matcher.mjs ← Matching-Modul (NEU, ~180 Zeilen)
electron-app/main.mjs                               ← IPC-Handler (~1570 Zeilen)
electron-app/preload.mjs                             ← Bridge (engineAnalyzeApi ab Zeile 164)
electron-app/renderer/tabs/engine-analyze.js         ← UI (NEU, ~620 Zeilen)
electron-app/renderer/tabs/search.js                 ← Search-Tab (Referenz für Patterns)
electron-app/renderer/tabs/automation.js             ← Automation-Tab (Referenz für Patterns)
electron-app/renderer/app.js                         ← Tab-Routing, renderTable(), Bootstrap
electron-app/renderer/index.html                     ← HTML-Struktur aller Tabs
electron-app/renderer/styles.css                     ← CSS (match-badges, ea-pick-table etc.)
```

## Architektur-Pattern

```
UI (engine-analyze.js) → IPC (preload.mjs) → main.mjs → engine_tools.py → JSON
                                                └→ engine-analyze-matcher.mjs (Matching)
                                                └→ performance-classifier.mjs (Scoring)
```

## Geschützte Dateien (NIEMALS umbenennen/löschen)

- `*.als`, `*.maxpat`, `*.vstpreset` — Ableton/Max/MSP Assets
- `electron-app/data/sync-presets.json` — User-Presets
- `config/scoring-merge-preview.json` — Merge-Preview Daten

## Constraints

- **Read-Only**: `PRAGMA query_only = ON` für alle Engine-DB-Zugriffe
- **Vanilla JS**: Kein React/Tailwind/shadcn — plain HTML/CSS/JS
- **Bestehende Patterns nutzen**: `renderTable()`, `data-table`, `cockpit-acc`, `is-selected`
- **Conventional Commits** pro Feature/Fix

## Startbefehl

```bash
cd ~/Projects/_local/beatport-dj-suite
npm run desktop:dev
# Dann: Explore → Engine-Analyse Tab
```
