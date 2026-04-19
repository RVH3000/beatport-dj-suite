# Pre-v4.1.0 Historie

⚠️ Diese Datei enthält die Entwicklungshistorie VOR Einführung des formalen Release-Workflows (commit-and-tag-version ab v4.1.0).

Zwei Abschnitte:

- **Kuratierte Highlights** — handgeschriebene Einträge, verlässlich
- **Rekonstruiert aus Git-Commits** — automatisch extrahiert, chronologische Reihenfolge nicht garantiert

Für die exakte Git-Historie: `git log`.
Ab v4.1.0 wird die offizielle Historie in [CHANGELOG.md](./CHANGELOG.md) geführt.

---

## Teil 1 — Kuratierte Highlights

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

---

## Teil 2 — Rekonstruiert aus Git-Commits (Pre-v4.1.0)

⚠️ Automatisch extrahiert über `commit-and-tag-version --dry-run`.
Versionen und Reihenfolge nicht garantiert.
Die Überschrift `## 4.1.0 (2026-04-19)` ist vom Tool generiert — inhaltlich handelt es sich um Commits, die **vor** v4.1.0 liegen (alles, was zwischen Repo-Start und dem Setup-Commit der Version-Pipeline gemacht wurde).

## 4.1.0 (2026-04-19)


### ✨ Features

* **analysis:** Fuzzy-Duplikat-Finder (Lese-Modus) ([d35ddf8](https://github.com/RVH3000/beatport-dj-suite/commit/d35ddf8de72d2e2dbe8264d5d4927f30e27cd84c))
* Beatport DJ Suite 3.0 — Sync-Pipeline Orchestrator ([#3](https://github.com/RVH3000/beatport-dj-suite/issues/3)) ([b7fb2c4](https://github.com/RVH3000/beatport-dj-suite/commit/b7fb2c4cddb1ed2b8ab40df5de8e589e19c3e2a4))
* Beatport DJ Suite v3.6.0 — 5-Gruppen-UI, Engine-Import, Recommendations, Groof, DJPL-Diff, Prime 4+ ([c6f0e84](https://github.com/RVH3000/beatport-dj-suite/commit/c6f0e847d78b6718917d3ec4468cc44c4d9b9581))
* beatport-dj-suite v2.0.0 — Restructure from beatport-scanner v1.5.1 ([187f833](https://github.com/RVH3000/beatport-dj-suite/commit/187f833ad7dc0da822fc91c575953632545f61fe))
* beatport-dj-suite v2.1.0 — Analysis, Export, Playlist-Wiz Tabs ([f4bc5cf](https://github.com/RVH3000/beatport-dj-suite/commit/f4bc5cf361573e0f7d0847c36a14a4f6c182efff))
* **builder:** Dramaturgie-Score Badges im Playlist-Builder ([6382167](https://github.com/RVH3000/beatport-dj-suite/commit/63821673a042dc78cdf9ebb2f023c4bc36c0b64b))
* DJPL.fm Login-Fenster statt Cookie-Kopieren ([8efcd12](https://github.com/RVH3000/beatport-dj-suite/commit/8efcd12681fb88ed7e4a76ce078d4eee83a1f085))
* Engine DJ Collection Export — Streaming-Tracks direkt in m.db schreiben ([804aead](https://github.com/RVH3000/beatport-dj-suite/commit/804aeadf9e1faf8d84629bf79c17f5f0d83e33db))
* **engine-analyze:** Camelot-Darstellung, History-Spielzeit, Analyse-Verlauf ([00132b4](https://github.com/RVH3000/beatport-dj-suite/commit/00132b41f333d822dded356f365228c889bf0d00))
* **engine-analyze:** Engine-DJ-Playlisten laden, matchen und klassifizieren ([93b5492](https://github.com/RVH3000/beatport-dj-suite/commit/93b5492612c6c24c200cd270c76f12cffc4ec069))
* **engine-analyze:** History-Track-Enrichment, Cross-Tab Search-Laden, CSV-Camelot ([29ab204](https://github.com/RVH3000/beatport-dj-suite/commit/29ab204c5e1091dd01ffc5ed776e09654abde8ef))
* **engine-analyze:** Pfad-Persistenz, History-Sessions, Workflow-UI ([1a57924](https://github.com/RVH3000/beatport-dj-suite/commit/1a57924326cfcb6ef7274422fe0edd550637ed51))
* **engine-analyze:** Sortierbare Ergebnis-Tabelle + Selection-Highlighting ([858fa08](https://github.com/RVH3000/beatport-dj-suite/commit/858fa0828f90b564402e152dbb1cf688570e3550))
* **engine:** Multi-DB Diff + Unified History Merge ([4253880](https://github.com/RVH3000/beatport-dj-suite/commit/42538806d31f667d12db3cacbc4392082ad8bdd8))
* **engine:** rbm.db aktivieren + PerformanceData BLOB-Decoder ([a712115](https://github.com/RVH3000/beatport-dj-suite/commit/a7121150082a97b8a266e8277df9e44172df90f6))
* **engine:** SmartList-Abfrage + isPersisted in list_playlists() ([c00bc8e](https://github.com/RVH3000/beatport-dj-suite/commit/c00bc8ed0d39aaa96f5db9049b2e9a711fcc7073))
* Playlist-Export-Modal + Responsive + Hot-Reload + Handoff ([f6287f3](https://github.com/RVH3000/beatport-dj-suite/commit/f6287f3427c854dcebe03c3567a60b9239dc4250))
* **sync:** optional Soundiiz monitoring and trigger integration ([b8a815a](https://github.com/RVH3000/beatport-dj-suite/commit/b8a815ac92766591f9c3f797445f388f23d9cfec))
* **ui:** Scanner-Tab GUI-Optimierung — Accordions, Progress-Bar, Workflow-Modal ([82e02ce](https://github.com/RVH3000/beatport-dj-suite/commit/82e02ce97ddb02c42b1519d39abe2bdeea0b9d8a))
* Unified App Build + Comprehensive Test Suite (557 Tests) ([c82fb13](https://github.com/RVH3000/beatport-dj-suite/commit/c82fb13eb9acf3d53a4e5beb72e42e889dbfeadf))
* v2.2.0 — Lexicon/DJPlaylists.fm sync pipeline, Engine DJ export ([570f550](https://github.com/RVH3000/beatport-dj-suite/commit/570f5507802e63d16f0df3014f79e1e7ea4ca6c2))
* v2.2.2 — DJPlaylists.fm → Lexicon Batch-Automation ([6fbf239](https://github.com/RVH3000/beatport-dj-suite/commit/6fbf239d850556ede5d7fab3b08aa4f175a90a39))
* v2.2.2 — DJPlaylists.fm → Lexicon Batch-Automation (Hidden BrowserWindow) ([5f024e1](https://github.com/RVH3000/beatport-dj-suite/commit/5f024e1c4b2b634e821f7ca731e86f346c2fbd3c))
* v2.3.0 — Dark Professional Theme + Search & Filter Tab (PL WIZ v5) ([2ff66c8](https://github.com/RVH3000/beatport-dj-suite/commit/2ff66c8b7adc4791cdcffb39cacaefad0c62f1bc))
* v3.6.5 — Rating/Plays in Suche, Builder-Filter, Analyse-Doku, Build-Info ([2f63026](https://github.com/RVH3000/beatport-dj-suite/commit/2f63026bd0dc43f8c03cb700a7904566c1c3d79a))
* v3.6.6 — Rating/Plays als Suchfilter, Architektur-Diagramm ([4e6d6c2](https://github.com/RVH3000/beatport-dj-suite/commit/4e6d6c250b7778b268d2dfcb8ad581abb7adbfd0))
* v3.6.7 — Genre-Indikator, Pipeline-Registry, Lexicon-Refs, WIZ-Builder-Link, Analyse-Fallback, Labels-Tab ([f231b55](https://github.com/RVH3000/beatport-dj-suite/commit/f231b55aa4ebfd98e451bdbb6cb95455ae3c7421))
* v3.8.0 — Diff-Cache, Batch-Import mit Auswahl, DJPL-Login ([095f609](https://github.com/RVH3000/beatport-dj-suite/commit/095f6099570cb3d5816c15f360b389170340192f))
* WIP — engine-analyze Ausbau, OBS now-playing, Plugin-Scaffold ([e20fa27](https://github.com/RVH3000/beatport-dj-suite/commit/e20fa27ecd2c010673ecd0af00ecd0f81d5a8725))


### 🐛 Bugfixes

* **ci:** test-Script auf find umstellen statt Glob ([f02cf13](https://github.com/RVH3000/beatport-dj-suite/commit/f02cf13188bb498e14aec588cf1bb397f97dd71d))
* DJPL.fm Import via Browser-Navigation statt REST ([4ccbba3](https://github.com/RVH3000/beatport-dj-suite/commit/4ccbba336954f8afe3ef4b312f0e448d5e69a15c))
* DJPL.fm Import via BrowserWindow + Diff-Guard bei 0 Playlists ([7bd25e0](https://github.com/RVH3000/beatport-dj-suite/commit/7bd25e0bf70adf6189f8648650e8273e2b3ebeaa))
* DJPL.fm Import via DOM-Automation (Submit Playlist Formular) ([acf2a44](https://github.com/RVH3000/beatport-dj-suite/commit/acf2a44d30b69b4a356cc475149d5d8588d724ca))
* Engine DJ AUTOINCREMENT + Trigger-Kompatibilitaet ([69a9a0d](https://github.com/RVH3000/beatport-dj-suite/commit/69a9a0d8ea99c462a65a4785b9ebf34847d2c9b2))
* **engine-analyze:** enrichedResult nicht definiert im History-Pfad ([d7e6453](https://github.com/RVH3000/beatport-dj-suite/commit/d7e64535336bfffe6466008f0377de3110d5b63b))
* **engine-analyze:** History-Tracks laden — eigener Pfad via history-tracks ([155d432](https://github.com/RVH3000/beatport-dj-suite/commit/155d4320848d4873cf6bcbb658a0ed37274f0fc2))
* **engine-analyze:** Laden-Button reagiert sofort auf Pfad-Eingabe ([44935fa](https://github.com/RVH3000/beatport-dj-suite/commit/44935fae0189aa693ab2c1e564c0eb1089fa5404))
* **engine-analyze:** Playlist/History-Picker als kompakte Tabelle ([e4cc865](https://github.com/RVH3000/beatport-dj-suite/commit/e4cc865a25ef2d8398cefb2eb0782616b950637a))
* **engine-analyze:** Timestamps formatieren + History-Picker sortierbar ([b9e0a1b](https://github.com/RVH3000/beatport-dj-suite/commit/b9e0a1b6e558dff5faf28a5b6637a6f76c0a7fb6))
* Engine-DB findet Backup/Kopie + DJPL.fm Auth-State beim Start laden ([d14df4d](https://github.com/RVH3000/beatport-dj-suite/commit/d14df4ddae669ac63e91440cdb5696c06176e0b8))
* **engine:** Smartlist-Query absichern — dynamisch id/rowid + Error-Handling ([b36faba](https://github.com/RVH3000/beatport-dj-suite/commit/b36faba38dbbc844ce7ca7f625b5b85c08be724d))
* **ux:** Duplikate klickbar, Pool Label-Filter, M3U-Export ([f7f43d6](https://github.com/RVH3000/beatport-dj-suite/commit/f7f43d6bf29dc92644904775d15e515cd4fbdd2d))
* **ux:** Reco oben, Engine-Import erklaerbar, DJPL.fm ehrlich ([41b8e37](https://github.com/RVH3000/beatport-dj-suite/commit/41b8e3744ed4e8e8ee4846b99a1b0706cce047ad))
* **ux:** v3.6.3 — Analyse-Leerzustand, Scanner-Tooltips, Settings-Tooltips ([4ac118a](https://github.com/RVH3000/beatport-dj-suite/commit/4ac118a64a2dbe17b97c382822133b4da5efff2c))
* v2.2.1 — Lexicon API Port 48624 + /v1/ Endpoints (Korrektur nach API-Discovery) ([fb844e4](https://github.com/RVH3000/beatport-dj-suite/commit/fb844e4372264fc88fd4e73a1f5288a2c80a0930))
* v3.6.4 — M3U-Backend, USB-Dropdown, Audit-Korrekturen ([0c4b154](https://github.com/RVH3000/beatport-dj-suite/commit/0c4b1547249b61b25875ffe7c7e90052f8a7a7a4)), closes [#EXTM3](https://github.com/RVH3000/beatport-dj-suite/issues/EXTM3)
* v3.6.7 — DJPL.fm Auth-Check, Engine-DB Pfad durchreichen, Status-Meldungen ([9502f00](https://github.com/RVH3000/beatport-dj-suite/commit/9502f00c046deb67794dca0efdc266fb3f256063))


### ♻️ Refactoring

* **engine:** Legacy-Code Cleanup — BLOB-Dekodierung + optional DBs ([7c51adb](https://github.com/RVH3000/beatport-dj-suite/commit/7c51adb8db612abec4c56a985dcfaa6b9ac6fa55))
