# LLM Handoff — Beatport DJ Suite 3.5

**Erstellt:** 2026-04-08
**Von:** Claude Code (alte Session in `zen-snyder` Worktree)
**Nach:** Claude Code (neue Session in `beatport-dj-suite-3.5` Worktree)

---

## Aktueller Stand

- **Worktree:** `/Users/roberth./Projects/_local/beatport-dj-suite/.claude/worktrees/beatport-dj-suite-3.5/`
- **Branch:** `beatport-dj-suite-3.5`
- **Letzter Commit:** `f02cf13 fix(ci): test-Script auf find umstellen statt Glob`
- **Version:** `3.5.0`
- **PR #4 (Draft):** https://github.com/RVH3000/beatport-dj-suite/pull/4
- **CI Status:** ✅ SUCCESS auf Node 20 + Node 22
- **Tests lokal:** 555/555 grün

## Was bereits erledigt ist

1. ✅ PR #3 (Sync-Pipeline 3.0) gemerged in `main`
2. ✅ Neue Worktree `beatport-dj-suite-3.5` von `main` erstellt
3. ✅ Neuer Branch `beatport-dj-suite-3.5` angelegt
4. ✅ `npm install` (432 packages)
5. ✅ `launch.json` mit absoluten Pfaden auf neue Worktree (Electron + npm)
6. ✅ `package.json` test-Script via `find` (Node 20 + 22 kompatibel)
7. ✅ Version-Bump `3.0.0` → `3.5.0`
8. ✅ Test-Fixes (IPC-Channel-Test scannt jetzt `electron-app/api/`, session-manager BrowserWindow-Check als Regex)
9. ✅ Draft-PR #4 erstellt mit Roadmap im Body
10. ✅ Electron-App startet sauber aus neuer Worktree (verifiziert: `syncApi: 22 keys, runFullPipeline ✓`)

---

## Aufgabe — UI-Workflow-Konsolidierung Phase 1

**Ziel:** 8 Top-Level-Tabs → 5 Workflow-Gruppen, jeder mit Sub-Tabs nach dem Search&Filter-Pattern.

### Ziel-Struktur

```
📚 LIBRARY        — Datenquellen & Caches
  ├ Scanner       (aktuell tab-scanner, inline in index.html)
  ├ Data          (scoring-data.json Management aus search.js)
  └ Duplicates    (Duplikat-Erkennung)

🔍 EXPLORE        — Verstehen der Library
  ├ Search        (Search & Filter — UNVERÄNDERT, REFERENZ)
  ├ Dashboard     (Genre/BPM/Key-Charts aus search.js)
  └ Analyze       (Playlist-Overlap-Matrix aus analysis.js)

🛠 BUILD          — Playlists erstellen
  ├ Filter+Build  (Search Results → Playlist Builder)
  ├ Wiz           (Live Beatport, ehemals playlist-wiz.js)
  └ Quick Action  (Templates)

🚀 PIPELINE       — Transfer & Export
  ├ Sync          (DJPlaylists.fm → Lexicon → Engine, aus sync.js)
  ├ Export        (Rekordbox/Traktor/JSON/M3U, aus export.js)
  └ Automation    (OSC-Bridge, Python-Tools, aus automation.js)

⚙️ SETTINGS       — Konfiguration
  ├ Auth          (Beatport Login, DJPlaylists API Key)
  ├ Paths         (Scan-Roots, Engine Folder, Python)
  └ Presets       (Sync-Presets, Export-Presets)
```

### Implementation Roadmap (Phase 1 — ca. 1 Tag)

- [ ] **Sub-Tab-CSS generalisieren:** `.srch-subtabs` → `.sub-tabs` (beide behalten als Alias) in `electron-app/renderer/styles.css`
- [ ] **Tab-Definition umbauen:** `electron-app/renderer/app.js` + `electron-app/renderer/index.html` — neue 5er Top-Nav
- [ ] **Module extrahieren:** Redundanz-Hotspots in `electron-app/renderer/lib/`:
  - `lib/bpm-utils.mjs` — `normBpm()`, `dramaScore()`, `camelotCompat()`
  - `lib/filter-builder.mjs` — Genre/Key/Label-Dropdowns (aktuell 3× dupliziert)
  - `lib/csv-export.mjs` — CSV-Generierung (aktuell in 3 Tabs)
- [ ] **Sub-Tab-Wrappers** pro Workflow-Gruppe in `electron-app/renderer/tabs/`:
  - `library.js` (mountet scanner + data + duplicates als Sub-Tabs)
  - `explore.js` (mountet search + dashboard + analyze)
  - `build.js` (mountet builder + wiz)
  - `pipeline.js` (mountet sync + export + automation)
- [ ] **Redundante CSV-Export-Buttons** entfernen (nur noch in Pipeline)
- [ ] **CLAUDE.md Update** (neue Tab-Struktur dokumentieren)
- [ ] **Tests grün halten:** `npm test` muss 555+/555+ zeigen
- [ ] **Manuell verifizieren:** App starten, alle 5 Tabs durchklicken, Sub-Tab-Wechsel testen

### Wichtige Regel

**Search & Filter (`tabs/search.js`) ist die Referenz und darf NICHT verändert werden** — sie funktioniert bereits perfekt mit dem Sub-Tab-Pattern. Wir kopieren das Pattern auf andere Tabs, ohne den Original-Tab anzufassen.

---

## Wichtige Dateipfade

| Datei | Zweck |
|---|---|
| `electron-app/renderer/app.js` | Tab-Definitionen + Lazy-Loading |
| `electron-app/renderer/index.html` | Tab-Navigation HTML + Scanner-Tab inline |
| `electron-app/renderer/tabs/search.js` | **REFERENZ** — Sub-Tab-System (Daten/Dashboard/Suche/Duplikate/Builder) |
| `electron-app/renderer/styles.css` | `.srch-subtabs`, `.panel`, `.field-grid` Patterns |
| `electron-app/renderer/tabs/analysis.js` | Canvas-Charts (BPM/Key/Genre/Overlap) |
| `electron-app/renderer/tabs/playlist-wiz.js` | Live-Beatport-Manager (XHR-API) |
| `electron-app/renderer/tabs/sync.js` | Pipeline-Visualisierung + Sync-Steuerung |
| `electron-app/renderer/tabs/automation.js` | OSC-Bridge + Python-Tools |
| `electron-app/renderer/tabs/export.js` | Rekordbox/Traktor/JSON/M3U-Export |
| `electron-app/renderer/tabs/settings.js` + `unified-settings.js` | Globale Config |

## Geschützte Dateien (NICHT anfassen)

- `electron-app/renderer/tabs/search.js` — Funktioniert, Referenz
- `electron-app/api/sync_orchestrator.mjs` — gerade in PR #3 gemerged
- `electron-app/api/djplaylists_api_tool.mjs`
- `electron-app/api/lexicon_api_tool.mjs`

## Startbefehl

```bash
# Tests laufen lassen
npm test

# Electron starten (manuell, ohne Preview)
/opt/homebrew/bin/node node_modules/electron/cli.js . --remote-debugging-port=9222
```

Oder über Claude Preview:
```bash
# In neuer Session (nach Restart in dieser Worktree)
# Preview Tool: preview_start "Beatport DJ Suite (Electron)"
```

---

## Kontext für den nächsten Agent

Lies zuerst die **Ultra-Think-Analyse** aus dem Chat-Verlauf der alten Session (oder im PR #4 Body verlinkt). Sie enthält:
- Warum 5 Workflow-Gruppen statt 8 Tabs
- Warum Sub-Tab-Pattern aus Search & Filter die richtige Referenz ist
- Adversarial-Testing für jede Option
- Cross-Domain-Insight (Ableton Live: Session vs. Arrangement View)

**Erste Schritte in der neuen Session:**
1. `git log --oneline -5` → bestätigen dass `f02cf13` das Top-Commit ist
2. `npm test` → bestätigen dass 555/555 grün sind
3. `gh pr view 4` → Roadmap-Checkliste im PR-Body lesen
4. Dann: Sub-Tab-CSS generalisieren als ersten Code-Change

**Was NICHT machen:**
- Kein zweiter Worktree erstellen (3.5 ist final)
- Kein PR #4 mergen bevor Phase 1 fertig ist (bleibt Draft)
- Search & Filter Tab nicht anfassen
- Keine neuen API-Module in `electron-app/api/` erstellen (das war PR #3)

**Status der alten Session:**
- Worktree `zen-snyder` existiert noch
- Branch `feature/beatport-dj-suite-3.0` lokal noch da (kann gelöscht werden mit `git branch -D feature/beatport-dj-suite-3.0` aus dem Hauptordner)
- PR #3 ist gemerged → kein Handlungsbedarf
