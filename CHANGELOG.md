# Changelog

Alle nennenswerten Änderungen am Projekt werden in dieser Datei dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

## [2.0.0] — 2026-03-29

### Highlights

Vollständige Neustrukturierung von `beatport-scanner v1.5.1` zur `beatport-dj-suite`.
8-Tab-Desktop-App mit XHR-First-Scanning, Analyse, Export und Automation.
557 Tests, davon 465 bestanden (vor Release-Cleanup).

### Neu

- **Unified Electron App** mit 8 Tabs: Scanner, Suche & Filter, Analyse, Playlist Wiz, Sync-Pipeline, Automation, Export, Einstellungen
- **XHR-First Discovery** — Playlists werden per `api.beatport.com/v4` geladen; CDP/DOM nur als Fallback
- **SQLite-Cache** — lokaler Arbeitsbestand für sofortige Playlist-Ansicht ohne Netzwerk
- **Delta-Sync** statt Vollanalyse beim Start
- **Duplikaterkennung** mit `buildTrackFingerprint` und `buildDuplicateEntries`
- **DJPlaylists.fm API-Client** mit Playlist-Import/-Export und Slug-Extraktion
- **Lexicon Sync-Pipeline** — Batch-Automation zwischen Beatport und Lexicon/DJPlaylists.fm
- **Comprehensive Test Suite** — 557 Tests über 12 Module (Node.js native test runner)
- **cdp-scanner Pure Tests** — 52 Tests für interne Funktionen mittels Source-Extraction
- **CI-Pipeline** mit `npm test` und `npm run check`
- **Smoke-Tests** gegen Live-Beatport-API
- **Coverage-Scripts** für gezielte Testabdeckungs-Analyse
- **Electron Build** — macOS DMG/ZIP via `electron-builder` (arm64)
- **ZIP-Export** kompletter Runs
- **Datenquellen-Anzeige** pro Run und Playlist (`xhr`, `route`, `dom`)

### Geändert

- **Projekt umbenannt** von `beatport-playlist-scanner` zu `beatport-dj-suite`
- **csvEscape zentralisiert** — eine Implementation in `utils/common.mjs`, re-exportiert von `xhr-scanner` und `run-store`
- **extractPlaylistId Bug-Fix** — Regex erkennt jetzt `/p/`-URLs neben `/playlist/` und `/playlists/`
- **Session-Modell** — persistentes Electron-Profil, kein Passwort im Storage
- **Run-Archiv** — automatische Legacy-Migration von `1.0.x` nach Schema `v2`

### Entfernt

- Alte `.gitkeep`-Dateien in Verzeichnissen mit echten Dateien
- Lose Skill-Dateien (`finder-open.skill`, `terminal-reader-skill/`) aus dem Repo
- `.claude/worktrees/` — versehentlich committete Session-Kopien (66.591 Zeilen)

### Infrastruktur

- `.gitignore` erweitert um Worktrees, Skill-Dateien und Build-Artefakte
- `package.json` Version 2.0.0, `appId: com.roberth.beatport.djsuite`

## [1.5.1] — 2026-03-12

Letzter Stand als `beatport-playlist-scanner`. Basis für die Suite-Migration.

## [1.0.x] — 2026-02 bis 2026-03

Initiale CDP-basierte Scanner-Versionen mit manueller Playlist-Auswahl.
