# LLM Handoff — beatport-dj-suite
Erstellt: 2026-03-29, zuletzt aktualisiert: 2026-04-08
Von: Claude Code CLI (Opus 4.6 1M, v3.5 Worktree-Session)
Nach: beliebige Ziel-Umgebung

---

## 🎯 Aktueller Stand (Session 2026-04-08)

### Worktree
- **Pfad:** `~/Projects/_local/beatport-dj-suite/.claude/worktrees/beatport-dj-suite-3.5/`
- **Branch:** `beatport-dj-suite-3.5`
- **Version (package.json):** `3.5.5`
- **Electron-Start-Port:** `--remote-debugging-port=9223` (9222 war besetzt)

### Was in dieser Session erledigt wurde (v3.5.0 → v3.5.5)

**v3.5.0 — Setup (vom vorigen Agent):**
- Worktree aus main, Tests 555/555 grün, PR #4 Draft

**v3.5.1 — Scanner Cockpit-Refit:**
- Status-Bar (1 Zeile) + 2-Spalten-Grid (Action/Run) + 3 Accordions
- Neue CSS-Klassen: `.cockpit-grid`, `.cockpit-action`, `.cockpit-run`, `.accordion-panel`, `.cockpit-acc`
- Alle IDs unverändert → `app.js` unberührt
- `styles.css:1413`: `.srch-subtabs`→`.sub-tabs` Alias generalisiert

**v3.5.2 — Library Sub-Tabs + Search Multi-Chips:**
- Library-Gruppe hat jetzt Sub-Tabs: `Scanner · Arbeitsbestand · Ergebnis · Löschen` (später + `Engine-Import`)
- Sub-Tab-Routing via `.library-subnav` + `.sub-content[data-libsub]` in `app.js` (neuer IIFE)
- **HANDOFF-Bruch: `tabs/search.js`** (siehe Block unten) — Multi-Select-Chips für Genre + kaskadierende Sub-Genre-Chips
- `sub_genre`-Felder sind in scoring-data.json **gar nicht befüllt** (`t.sg` fehlt in der Quelle) — Datenproblem, kein Code-Bug

**v3.5.3 — Status-Bar + Session-Actions vereint:**
- 4 Auth-Buttons (`openBeatportWindowBtn`, `authTestBtn`, `authReconnectBtn`, `authExportContextBtn`) aus der Accordion **in die Status-Bar** gezogen
- Fehler + Fix-Aktionen jetzt in 1 Zeile (`Reconnect` als `.primary-soft`)

**v3.5.4 — Engine-Import Sub-Tab (GROSSES Feature):**
- Neuer Sub-Tab `Engine-Import` unter Library
- **Read-only Merge** von Engine DJ DB (`m.db` + `hm.db`) in `scoring-data.json`
- Neue Dateien:
  - `config/scoring-merge-rules.json` — Feldregeln (`keep_old`/`fill_missing`/`overwrite_newer`/`ask`)
  - `config/scoring-merge-preview.json` — letzter Preview-Output
  - `config/scoring-backups/` — Backup-Ordner (wird beim ersten Apply erstellt)
  - `config/scoring-merge-log.jsonl` — Audit-Log (wird beim ersten Apply erstellt)
  - `electron-app/integrations/python/merge_engine_scoring.py` — Merge-Logik
- Erweitert:
  - `engine_tools.py`: neue Funktion `dump_tracks_with_history()` + CLI-Subcommand `dump-tracks-with-history`
  - `main.mjs`: IPC-Handler `scoring:merge-engine-preview`, `scoring:merge-engine-read-preview`, `scoring:merge-engine-apply`; `os` Import hinzugefügt
  - `preload.mjs`: `scoringMergeApi` (preview/readPreview/apply)
  - `app.js`: IIFE `initEngineImport` am Dateiende — Preview/Apply UI, Konflikt-Radio-Resolution, Bulk-Buttons
  - `styles.css`: `.eng-stats`, `.eng-stat`, `.eng-row`, `.eng-val`, `.eng-resolve`
- **Erster Testlauf (reale Daten):**
  - 99.411 Scoring-Tracks vs 11.945 Engine-Tracks
  - **2.577 Matches** per Beatport-ID (aus Streaming-URI extrahiert)
  - **5.052 Anreicherungen** möglich (plays_total 2577, last_played 1918, **rating 396 ⭐**, comment 93, file_path 65, length_ms 3)
  - **73 echte Konflikte** (69 BPM >1 Abweichung, 4 Label)
  - 8.794 lokale Engine-Tracks (kein BP-ID)
- **Wichtige Detail-Entscheidungen:**
  - Rating: Engine 0-100 in 20er-Schritten → **0-5 Sterne**, `rating=0` wird als "unbewertet" nicht geschrieben
  - Last-Played: Primär `HistorylistEntity.startTime` (echte Sessions), Fallback `Track.timeLastPlayed`
  - `key` bewusst aus `ENRICHMENT_FIELDS` entfernt (Engine Integer-Code vs scoring Text inkompatibel)
  - BPM-Toleranz ±1 (wegen Float-Drift Beatport-Rundung vs Engine-Analyse)
  - scoring-data.json verwendet **Kurz-Keys** (`i`, `t`, `m`, `a`, `g`, `b`, `k`, `c`, `y`, `l`, `ms`, `r`) — `sget()` in merge_engine_scoring.py und `LONG_TO_SHORT`-Mapping im Apply-Handler

**v3.5.5 — Tooltips-System (CODE FERTIG, ABER NOCH NICHT GESTARTET):**
- CSS: `.help-icon` (kleines `?`-Circle) + CSS-only Popup via `::after` mit `data-tip`
- Native `title=`-Attribute auf allen Top-Nav-Buttons, Library-Sub-Tabs, Scanner-Action-Buttons, Status-Bar-Auth-Buttons, Engine-Import-Buttons
- Rich Help-Icons an Sektions-Headern: Scanner, Aktiver Run, Engine-Import (mehrzeilige Workflow-Erklärungen)
- Hintergrund-Tint verschoben (`#121521`)
- Badge auf `v3.5.5`
- ⛔ **Launch blockiert durch Home-Git-Guard** — siehe nächster Abschnitt

---

## 🚨 BLOCKER am Session-Ende

**Home-Git-Guard hat v3.5.5-Launch blockiert.**

Laut globaler CLAUDE.md: "Das versehentliche Git-Repo im Home wurde am 2026-04-02 entfernt. Home ist KEIN Repository mehr. Falls ein `.git/` dort wieder auftaucht: sofort melden und löschen."

Der Hook `PreToolUse:Bash` blockierte jeden Bash-Call aus dem Home-Arbeitsverzeichnis. Wahrscheinliche Ursache: `~/.git/` ist wieder aufgetaucht.

**Sofort-Check beim Übernehmen:**
```bash
ls -la ~/.git 2>/dev/null
# Falls vorhanden und nicht absichtlich: rm -rf ~/.git
```

**Danach Electron v3.5.5 starten:**
```bash
WT=/Users/roberth./Projects/_local/beatport-dj-suite/.claude/worktrees/beatport-dj-suite-3.5
/opt/homebrew/bin/node "$WT/node_modules/electron/cli.js" "$WT" --remote-debugging-port=9223
```

---

## 📋 Offene TODOs (nach Session-Ende)

**Unmittelbar:**
- [ ] Home-Git-Guard-Ursache beseitigen (`~/.git/` Check)
- [ ] Electron v3.5.5 launchen und Tooltips visuell verifizieren
- [ ] User soll im Engine-Import Sub-Tab auf "Preview laden" → "Änderungen anwenden" klicken um die 396 Ratings + 2577 Play-Counts in scoring-data.json zu schreiben

**Geplant (vom User bestätigt mit "1 2 3"):**
- [ ] **v3.5.6 — USB Prime 4+ Detection (read-only)**
  - Detect mounted USB/SSD mit Engine-DB-Struktur (nicht `~/Music/Engine Library`, sondern externe Volumes unter `/Volumes/`)
  - Schema lesen, zusätzliche DB-Quelle im Engine-Import anbieten
  - Merge-Logik erweitern: mehrere DB-Quellen kombinieren
  - UI: Dropdown "Engine-DB-Quelle: Local / USB: PRIME4/ / USB: BACKUP/"
- [ ] **v3.5.7 — DJPlaylists.fm Diff-Import**
  - Check: existiert `djplaylists_api_tool.mjs` API-Endpoint für "list my playlists"?
  - Logik: Beatport-Playlist-IDs vs DJPL.fm-Playlist-IDs diffen
  - UI: neuer Sub-Tab in Pipeline oder eigene Aktion im Sync-Tab
  - Upload nur der fehlenden Playlists (nicht bereits vorhandene überschreiben)

**Von v3.5.0 HANDOFF noch offen (Phase 1):**
- [ ] Module extrahieren in `electron-app/renderer/lib/`:
  - `bpm-utils.mjs` (`normBpm`, `dramaScore`, `camelotCompat`)
  - `filter-builder.mjs` (Genre/Key/Label-Dropdowns, 3× dupliziert)
  - `csv-export.mjs` (3× dupliziert)
- [ ] Sub-Tab-Wrapper in `electron-app/renderer/tabs/`: `explore.js`, `build.js`, `pipeline.js` (library.js entfällt — wir haben die Sub-Tab-Nav direkt in `#tab-scanner` umgesetzt)
- [ ] Redundante CSV-Export-Buttons entfernen
- [ ] CLAUDE.md Update (neue Tab-Struktur)
- [ ] `npm test` — Tests sollen weiter 555+/555+ sein (wurden in der Session nicht gelaufen, weil Home-Git-Guard)

**User-Wunsch, noch nicht angefangen:**
- [ ] Beatport-Label-Metadaten aus `dj.beatport.com/my-beatport/labels` — User wollte JSON-Response via F12/Network liefern, hat aber nicht geschickt. Claude-in-Chrome-Extension konnte sich nicht mit Claude Code CLI pairen (MCP-Server `claude-in-chrome` zeigt `connected`, aber die Extension selbst reagiert nicht auf `switch_browser`-Broadcasts).

**User-Brainstorm (7 Ideen für später, nicht priorisiert):**
1. Datenstrom-Graph im Pipeline-Tab (Beatport → scoring → Engine → Prime 4+)
2. Smart-Enrichment-Loop nach Engine-Import
3. Rating-Propagation rückwärts (396 Sterne → Beatport-Favoriten-Playlist)
4. History-Smart-Playlists ("Oft gespielt", "Nie gespielt obwohl gekauft", "5-Sterne noch nicht im Set")
5. Dead-Track-Detection (scoring-Tracks mit `beatport_id` die offline sind)
6. Cross-DB Duplikate (Engine local + Prime 4+ USB + Beatport-Stream)
7. Hotkey-Quick-Actions (`⌘1-5` Gruppen-Wechsel, `⌘P` Preview)

---

## 🔑 Wichtige Dateipfade (Session-Kontext)

| Datei | Zweck in v3.5 |
|---|---|
| `electron-app/renderer/index.html` | Group-Bar, Library-Sub-Tabs, Scanner-Cockpit, Engine-Import-Panel, Help-Icons |
| `electron-app/renderer/styles.css` | Dark-Pro Design-System, `.cockpit-*`, `.eng-*`, `.help-icon`, Hintergrund-Tint pro Version |
| `electron-app/renderer/app.js` | `initGroups`, `initLibrarySubTabs`, `initEngineImport` (IIFE-Block am Ende) |
| `electron-app/renderer/tabs/search.js` | ⚠️ Modifiziert trotz HANDOFF-Regel: Multi-Chip-System für Genre/Sub-Genre |
| `electron-app/main.mjs` | IPC-Handler `scoring:merge-engine-*` ab Zeile ~520; `os`-Import oben |
| `electron-app/preload.mjs` | `scoringMergeApi` Context-Bridge |
| `electron-app/integrations/python/engine_tools.py` | `dump_tracks_with_history()` read-only |
| `electron-app/integrations/python/merge_engine_scoring.py` | Merge-Logik mit `sget()`, `values_equal(field=...)`, Konfliktregeln |
| `config/scoring-merge-rules.json` | Feldregeln + Pfade |
| `config/scoring-merge-preview.json` | Letzter Preview-Output (nicht committen) |
| `~/Documents/Claude/Projects/Beatport PL WIZ/scoring-data.json` | **Ziel**-Datenbank (Kurz-Keys `i/t/a/g/b/k/c/y/l/ms/r`, 23 MB) |
| `~/Music/Engine Library/Database2/m.db` + `hm.db` | **Quelle**-Datenbanken (read-only) |

---

## 🛡️ Geschützt / Nicht anfassen

- `electron-app/api/sync_orchestrator.mjs` (PR #3)
- `electron-app/api/djplaylists_api_tool.mjs`
- `electron-app/api/lexicon_api_tool.mjs`
- `scoring-data.json` im Beatport PL WIZ Ordner — nur via Backup+Merge-Apply schreiben
- `m.db`, `hm.db`, `stm.db`, `sm.db` im Engine Library — nur READ-ONLY

---

## 🚀 Startbefehle

```bash
# Electron starten (v3.5.5)
WT=/Users/roberth./Projects/_local/beatport-dj-suite/.claude/worktrees/beatport-dj-suite-3.5
/opt/homebrew/bin/node "$WT/node_modules/electron/cli.js" "$WT" --remote-debugging-port=9223

# Merge-Preview manuell testen (Python)
python3 "$WT/electron-app/integrations/python/merge_engine_scoring.py" \
  --config "$WT/config/scoring-merge-rules.json" \
  --out "$WT/config/scoring-merge-preview.json" \
  --repo-root "$WT"

# Engine-DB-Dump manuell testen
python3 "$WT/electron-app/integrations/python/engine_tools.py" dump-tracks-with-history --limit 5

# Tests (aus Worktree-Root)
cd "$WT" && npm test
```

---

## 📝 Kontext für den nächsten Agent

Du übernimmst eine laufende v3.5-Session. Die App ist im Worktree `beatport-dj-suite-3.5` und hat in dieser Session massive UI-Refits bekommen (Sub-Tabs, Cockpit, Chips, Engine-Import). Das Grosse Feature ist der **Engine-Import Sub-Tab**, der read-only aus der Engine-DJ-Datenbank Ratings, Play-Counts und Last-Played extrahiert und in scoring-data.json merged. Der Code ist fertig, der Testlauf zeigt 396 Ratings + 2577 Play-Counts bereit zum Apply.

**Der User hatte 3 Sachen als nächstes auf der Liste (bestätigt mit "1 2 3"):**
1. v3.5.5 Tooltips — CODE FERTIG, aber nicht gelauncht (Home-Git-Guard)
2. v3.5.6 Prime 4+ USB-Detection (read-only, Option A)
3. v3.5.7 DJPlaylists.fm Diff-Import

**Kommunikationsstil des Users:**
- Direkt, oft kurze Sätze, will konkrete Aktionen nicht endlose Rückfragen
- Deutsch
- Schätzt Versionsbumps bei sichtbaren Änderungen (Badge + Hintergrund-Tint leicht verschoben pro Patch-Version)
- Braucht Visual-Feedback — Electron wird nach jedem Feature automatisch gestartet
- Hat User-Memory dass ich "alte Electron-Instanzen via `TaskStop` beenden" soll statt `pkill -9`

**Wichtige Regeln aus globaler CLAUDE.md (`~/.claude/CLAUDE.md`):**
- Nie Dateien löschen ohne grep + pytest
- DB-Sicherheit: niemals direkt auf Engine-DB schreiben, Sandbox-Protokoll
- Home (`~/`) ist KEIN Git-Repo — falls `.git/` dort: löschen und melden
- Zeitzone CET/CEST — Lokalzeit statt UTC anzeigen

---

## ⚠️ HANDOFF-Regel-Verletzung — `electron-app/renderer/tabs/search.js`

**Datum:** 2026-04-08
**Version:** v3.5.2
**Kontext:** In `.claude/HANDOFF.md` ist `tabs/search.js` als **Referenz-Tab** markiert und war geschützt ("funktioniert, nicht anfassen"). Der User hat in der v3.5-Session explizit Änderungen verlangt — Regel wurde auf seinen direkten Wunsch gebrochen.

**Konkrete Änderungen in search.js (v3.5.2):**
- Zeile 272-273: `<select id="srchGenre">` / `<select id="srchSubGenre">` → ersetzt durch `<div class="srch-chips">` Container, Selects `hidden` beibehalten für Kompat
- Neuer Block **"Multi-Select Chips für Genre / Sub-Genre"** mit `selectedGenres` / `selectedSubGenres` Sets und Render-Funktionen (`renderGenreChips`, `renderSubGenreChips`, `initChipFilters`)
- `initChipFilters()` wird beim Load zusammen mit `initFilters()` / `initSubGenreFilter()` aufgerufen
- `doSearch()`-Filter-Logik erweitert: verwendet Sets wenn `selectedGenres.size > 0`, sonst Fallback auf Single-Select-Value
- `clearFilters()` leert zusätzlich die Sets und re-rendert Chips
- Sub-Genre-Chips **kaskadieren**: nur Sub-Genres aus aktuell gewählten Parent-Genres werden angezeigt

**Warum:** User wollte mehrere Genres gleichzeitig markieren und bemerkte, dass Sub-Genres gar nicht befüllt werden (eigentlich ein Daten-Problem — `t.sg` fehlt in der Scoring-Quelle, nicht ein Code-Bug).

**Risiko für Phase-1-Konsolidierung:** Wenn die Referenz-Sub-Tab-Mechanik von anderen Tabs aus search.js kopiert werden soll, sind die Chip-Erweiterungen zu berücksichtigen oder bewusst auszunehmen.

---


## Aktueller Stand
- Branch: main
- Letzter Commit: e4512aa (Phase 7a + Phase 9 Repo-Hygiene)
- 7 Dateien mit insgesamt 685+ Zeilen uncommitted changes

## Kernproblem: Beatport Playlist-Erstellung scheitert (Auth 401)

### Was passiert
Im "Suche & Filter"-Tab gibt es einen neuen Button "Als Playlist speichern".
Wenn der User eine Playlist auf Beatport erstellen will, kommt immer:
```
Auth-Fehler 401 fuer https://api.beatport.com/v4/my/playlists/
Token vermutlich abgelaufen
```

### Was bereits versucht wurde (alles gescheitert)
1. **api-context.json aus Datei lesen** — Token war beim Lesen schon abgelaufen
2. **Token-Export-Button** — Pfad-Mismatch: app.getPath("userData") schreibt nach "Beatport DJ Suite" (Leerzeichen), USER_DATA_PATHS sucht in "beatport-dj-suite" (Bindestrich). Gefixt, half aber nicht.
3. **sessionManager.resolveBeatportApiContext(forceRefresh:true)** — Navigiert zu dj.beatport.com und faengt Token per Network-Capture ab, aber das loest offenbar ein Logout bei Beatport aus (Sicherheitsmechanismus)
4. **InPageBeatportClient (executeJavaScript + fetch mit credentials:include)** — "Failed to fetch" weil Beatport-API nicht ueber Cookies authentifiziert sondern ueber Bearer-Token im Authorization-Header
5. **extractLiveBearerToken (localStorage/sessionStorage durchsuchen + fetch monkey-patch)** — Aktueller Stand im Code, User meldet weiterhin Fehler

### Wie die funktionierende Auth im Scanner funktioniert
- SessionManager in electron-app/auth/session-manager.mjs
- Nutzt withNetworkCapture() -> extractApiContextFromRequests(): Navigiert zu dj.beatport.com, attached Chrome Debugger Protocol, faengt Requests zu api.beatport.com/v4/my/playlists ab, extrahiert den Authorization-Header
- Das funktioniert fuer den Scanner, weil dort ein voller Scan laeuft
- Problem: Bei Playlist-Erstellung scheint die erneute Navigation den Token zu invalidieren

### Loesungsansaetze die noch NICHT versucht wurden
- **Electron net.fetch mit Session-Partition**: Electron 32.3.3 hat net.fetch() das mit der gleichen Session-Partition arbeiten kann. Sendet automatisch richtige Cookies/Auth ohne Token-Extraktion.
- **session.fetch()**: Alternative zu net.fetch, direkt ueber die Session des BrowserWindow
- **webRequest.onBeforeSendHeaders**: Listener auf der Beatport-Partition, der den Authorization-Header aus dem naechsten regulaeren API-Call abfaengt OHNE neue Navigation
- **React-State/NEXT_DATA**: Die Beatport SPA speichert den OAuth-Token irgendwo im JS-Heap

## Was funktioniert (neue Features, nur nicht committiert)

### 1. Playlist-Modal erweitert (search.js)
- Neues Ziel-Dropdown: Beatport / M3U / JSON / CSV
- Lokale Formate funktionieren ueber export:save-playlist-local IPC-Handler
- Nativer Speicherdialog via export:choose-save-path

### 2. Responsive Verbesserungen (styles.css)
- minWidth 768px, minHeight 600px
- Neuer Breakpoint @media (max-width:1080px)

### 3. Hot-Reload (main.mjs)
- electron-reload fuer automatischen Renderer-Refresh

### 4. App-Icon
- icon.png/icns/svg in assets/
- BrowserWindow icon + dock.setIcon() + favicon konfiguriert
- Icon funktioniert im Dev-Modus immer noch nicht

## Wichtige Dateipfade
- electron-app/main.mjs — Hauptprozess, createXhrClient() ist das Auth-Problem (ab Zeile ~437)
- electron-app/auth/session-manager.mjs — SessionManager mit withNetworkCapture, probe, executeJavaScript
- electron-app/scanner/xhr-scanner.mjs — BeatportXhrClient (funktioniert mit gueltigem Token), USER_DATA_PATHS
- electron-app/renderer/tabs/search.js — Playlist-Modal, savePlaylist(), saveToBeatport(), saveToLocalFile()
- electron-app/preload.mjs — window.playlistApi + window.exportApi (inkl. savePlaylistLocal)

## Geschuetzte Dateien (NIEMALS umbenennen/loeschen)
- assets/icon.png, assets/icon.icns, assets/icon.svg
- electron-app/auth/session-manager.mjs
- electron-app/scanner/xhr-scanner.mjs

## Startbefehl
```bash
cd ~/Projects/_local/beatport-dj-suite
npm run desktop:dev
```

## Kontext fuer den naechsten Agent
PRIORITAET 1: Beatport-Auth fuer Playlist-Erstellung fixen. Der Schluessel ist, den Bearer-Token zu nutzen OHNE eine neue Navigation auszuloesen die Beatports Sicherheitsmechanismus triggert. Electron 32.3.3 bietet net.fetch() und session.fetch() als moegliche Loesung.

PRIORITAET 2: Lokale Export-Formate (M3U/JSON/CSV) testen — sollten funktionieren.

PRIORITAET 3: Icon im Dev-Modus fixen.

Tests: npm run test:unit — 123/125 bestanden (2 vorbekannte SQLite-Cache-Fehler).
