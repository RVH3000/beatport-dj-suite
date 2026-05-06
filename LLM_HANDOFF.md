# LLM Handoff — Beatport DJ Suite

**Stand:** 2026-05-06
**Erstellt von:** Claude Code CLI (Opus 4.7, 1M Kontext)
**Vorherige Session:** 2026-04-19 (Versions-Workflow + Dynamic Badge im Working Tree)
**Nach:** Claude Code CLI / Dispatch / weitere Session

---

## Aktueller Stand

- **Branch (Worktree):** `feat/v4.1` (HEAD = `61d3f9b`, Cherry-pick von `233a8ce` aus `v4` — Versions-Workflow + dyn. Badge)
- **Branch (führend):** `v4` — noch auf `4.0.0`, hat Versions-Workflow committed (`233a8ce`), aber separat von `feat/v4.1`-Featurelinie (Fuzzy-Dupes, Drama-Score)
- **Version (feat/v4.1):** `4.1.0` (in `package.json`)
- **Tests:** 592/592 grün (8.25 s, Stand 2026-05-06)
- **Build:** `dist-electron/mac-arm64/Beatport DJ Suite.app` v4.1.0, gerade frisch gebaut
- **Installiert:** `/Applications/Beatport DJ Suite 4.1.0.app` (mit dynamischem Versions-Badge)
- **Remote:** `github.com/RVH3000/beatport-dj-suite` (privat) — `feat/v4.1` lokal-only, ungepusht

### Weitere aktive Branches
- `main` — veralteter Stand, nicht mehr führend
- `release/v2.3-stable` — Backport-Referenz
- `feat/label-import-2026-04-08` — offener Feature-Branch
- `merge-analysis` — siehe unten

### Worktree merge-analysis
Laufende Konsolidierung der drei Beatport-Tools (`beatport-scanner` v1.5.1, `Beatport PL WIZ` v5, aktuelle Suite). Arbeitsverzeichnis:
```
~/Projects/_local/beatport-dj-suite.worktrees/merge-analysis/
```
Dokumente in `.agents/merge-analysis/`:
- `architect-strategy.md` (270 Zeilen, 6-Phasen-Plan — bewusst zu ambitioniert)
- `simplifier-critique.md` (130 Zeilen, reduziert auf 3 Schritte — **verbindlich**)
- `explorer-reports/` (drei Repo-Analysen)

### Backup-Tags (heute gesetzt)
- `backup-vor-projekt-setup-20260419-0320` (lokal + remote)
- `backup-vor-version-workflow-20260419-0420` (lokal + remote)

### Startpunkt-Tag
- `v4.0.0` auf Commit `30dbd41` — markiert den Zustand „Historie ausgelagert, Release-Workflow vorbereitet". Ab hier zählt `commit-and-tag-version` nur neue Commits für den nächsten Release.

---

## Neu in dieser Session (2026-05-06)

### Cherry-pick: dynamischer Versions-Badge in feat/v4.1

- Commit `233a8ce` (`feat: add automatic version workflow`) aus Branch `v4` in `feat/v4.1` cherry-picked → neuer lokaler Commit `61d3f9b`.
- Konflikt nur in `package-lock.json` — mit `--ours` aufgelöst (eigene 4.1.0-Lock behalten, `commit-and-tag-version` als DevDep nicht zwingend für Build nötig).
- `package.json`: `"version": "4.1.0"` blieb erhalten (Auto-merge).
- Ergebnis: Header zeigt jetzt zur Laufzeit `v4.1.0` (gefüllt durch `app.js:635-636`).

### v4.1.0-Build erzeugt + installiert

- `npm run desktop:dir:mac` → `dist-electron/mac-arm64/Beatport DJ Suite.app` (Version 4.1.0, frische `app.asar` mit Hash `81f0f7…`).
- Nach `/Applications/Beatport DJ Suite 4.1.0.app` kopiert (mit Versionsnummer im Namen, neue Konvention — siehe Repo-CLAUDE.md), Quarantine entfernt, gestartet.
- Vorherige `/Applications/Beatport DJ Suite.app` (v2.0.0 vom 2026-03-29) wanderte in `~/.Trash/`.

### CLAUDE.md-Updates

- **Global** (`~/.claude/CLAUDE.md`): Pauschal-Regel „_local/ = kein Backup" präzisiert auf „erst `git remote -v` prüfen".
- **Repo-CLAUDE.md** (Branch `v4`): App-Installations-Konvention ergänzt (Versionsnummer im Namen).

---

## Vorherige Session (2026-04-19)

### Versions-Workflow eingeführt

- `commit-and-tag-version@12.7.1` als DevDependency installiert (Fork von archiviertem `standard-version`).
- `.versionrc.json` im Root konfiguriert: 4 sichtbare Commit-Sections (✨ Features, 🐛 Bugfixes, ⚡ Performance, ♻️ Refactoring), 4 versteckte (`chore`, `docs`, `style`, `test`), GitHub-URLs korrekt.
- Vier npm-Scripts in `package.json`:
  - `npm run release` — auto-detect Bump
  - `npm run release:patch` / `:minor` / `:major` — erzwungene Bumps
- `CHANGELOG.md` auf schlanken Starter reduziert (9 Zeilen, nur Header + Verweise).
- `CHANGELOG-HISTORY.md` angelegt (138 Zeilen): Teil 1 = kuratierte Pre-v4.1.0-Highlights (`[2.0.0]`/`[1.5.1]`/`[1.0.x]`), Teil 2 = automatisch extrahierter Commit-Dump.
- `docs/RELEASE-WORKFLOW.md` angelegt (184 Zeilen): deutsche Einsteiger-Doku mit Conventional-Commits-Tabelle, Alltagsablauf, Rollback-Szenarien.

### Dynamic-Version-Badge im UI

- Titelleiste (`electron-app/renderer/index.html:15`) liest Version jetzt zur Laufzeit aus `package.json` via bestehende `scannerApi.getAppInfo()`-Route.
- Zwei Zeilen in `electron-app/renderer/app.js`: `els.appVersionBadge`-Referenz + Befüllung in `renderAppInfo()`.
- Kein neuer IPC-Handler, kein neuer Preload-Eintrag.

### Noch nicht committed (Stand HEAD = `30dbd41`)

Folgende Dateien sind vorbereitet, aber liegen uncommitted im Working Tree — **nächste Session sollte sie in einem `feat:`-Commit bündeln**, damit sie den ersten automatischen Release v4.1.0 auslösen:

- `electron-app/renderer/app.js` (modified) — Dynamic-Version-Badge
- `electron-app/renderer/index.html` (modified) — Badge-ID ergänzt
- `package.json` (modified) — Release-Scripts + DevDep
- `package-lock.json` (modified) — commit-and-tag-version synchronisiert
- `.versionrc.json` (untracked) — Config für commit-and-tag-version

---

## Offene TODOs

### Release-Pfad v4.1.0 (priorisiert, „endlich fertig bauen")

1. [ ] **`git push origin feat/v4.1`** — Cherry-pick-Commit `61d3f9b` ist nur lokal. Backup auf Remote, sonst bei Branch-Wechsel weg.
2. [ ] **`feat/v4.1` → `v4` mergen** (im Hauptrepo, oder PR via `gh pr create --base v4`).
3. [ ] **Trockenlauf:** `npx commit-and-tag-version --dry-run` — sehen was Release erzeugen würde.
4. [ ] **Scharf:** `npm run release` — zieht 4.0.0 → 4.1.0 hoch, generiert CHANGELOG, taggt, pusht. (Hook-Fix von 2026-04-19 vorher prüfen.)
5. [ ] **DMG/ZIP-Build** für Verteilung: `npm run desktop:dist:mac` (statt `:dir`).
6. [ ] **Branch-Triage** (5 min): `git log v4..merge-analysis` und `…feat/label-import-2026-04-08` durchgehen — rein, weg oder warten?

### Versions-Workflow — Restposten
- [ ] Hook-Fix nach Schritt 9 (vom User angekündigt, Details folgen)

### Engine-Analyse Tab — Feinschliff
- [ ] **Scoring-Data-Pfad:** Aktuell hardcoded leer (`""`) — aus Settings laden oder Dateiauswahl-Dialog
- [ ] **Fuzzy-Matching testen:** Prefix-Bucket-Optimierung validieren mit echten Daten
- [ ] **`renderTable()` aus app.js nicht exportiert** — Engine-Analyse baut eigene Tabellen. Langfristig: renderTable exportieren oder als shared Modul

### UI-Konsistenz (gespeichertes Memory)
- [ ] Neue Features müssen bestehende Patterns nutzen (`renderTable`, `data-table` CSS, `is-selected`)
- [ ] Search-Tab Sortier-Pattern (Lock-System) als Vorlage für alle sortierbaren Tabellen

### Weitere Features (noch nicht angefangen)
- [ ] Engine-Analyse: Vergleichsansicht Playlist vs. History nebeneinander
- [ ] Engine-Analyse: Drag & Drop von Ergebnis-Tracks in den Playlist Builder
- [ ] Scanner-Tab: Progress-Bar mit echtem Fortschritt (braucht Event-Streaming vom Scan-Prozess)

---

## Wichtige Dateipfade

```
electron-app/integrations/python/engine_tools.py   ← Backend (~1570 Zeilen)
electron-app/integrations/engine-analyze-matcher.mjs ← Matching-Modul (~180 Zeilen)
electron-app/main.mjs                               ← IPC-Handler (~1570 Zeilen)
electron-app/preload.mjs                            ← contextBridge (scannerApi.getAppInfo bereits exposed)
electron-app/renderer/tabs/engine-analyze.js        ← Engine-Analyse UI (~620 Zeilen)
electron-app/renderer/tabs/search.js                ← Search-Tab (Referenz-Pattern)
electron-app/renderer/tabs/automation.js            ← Automation-Tab (Referenz-Pattern)
electron-app/renderer/app.js                        ← Tab-Routing, renderTable(), renderAppInfo()
electron-app/renderer/index.html                    ← HTML aller Tabs, version-badge in h1
electron-app/renderer/styles.css                    ← CSS (match-badges, ea-pick-table, version-badge)
.versionrc.json                                     ← NEU: commit-and-tag-version Config
CHANGELOG.md                                        ← NEU: leerer Starter, ab v4.1.0 auto-gepflegt
CHANGELOG-HISTORY.md                                ← NEU: Pre-v4.1.0-Historie (friert ein)
docs/RELEASE-WORKFLOW.md                            ← NEU: Release-Doku
docs/RELEASE_CHECKLIST.md                           ← bestehend: QA-Checkliste
```

---

## Architektur-Pattern

```
UI (engine-analyze.js) → IPC (preload.mjs) → main.mjs → engine_tools.py → JSON
                                                └→ engine-analyze-matcher.mjs (Matching)
                                                └→ performance-classifier.mjs (Scoring)
```

---

## Geschützte Dateien (NIEMALS umbenennen/löschen)

- `*.als`, `*.maxpat`, `*.vstpreset` — Ableton/Max/MSP Assets
- `electron-app/data/sync-presets.json` — User-Presets
- `config/scoring-merge-preview.json` — Merge-Preview Daten

---

## Constraints

- **Read-Only DB:** `PRAGMA query_only = ON` für alle Engine-DB-Zugriffe
- **Vanilla JS:** Kein React/Tailwind/shadcn — plain HTML/CSS/JS
- **Bestehende Patterns nutzen:** `renderTable()`, `data-table`, `cockpit-acc`, `is-selected`
- **Conventional Commits** pro Feature/Fix (siehe `docs/RELEASE-WORKFLOW.md`)
- **Ab v4.0.0 automatischer Release-Workflow** — manuelles Hochzählen in `package.json` vermeiden

---

## Startbefehl

```bash
cd ~/Projects/_local/beatport-dj-suite
npm run desktop:dev
```

## Release-Ablauf (neu)

```bash
# Nach einer Coding-Session:
git add <dateien>
git commit -m "feat: neue Funktion X"   # oder fix: / perf: / refactor:
npm run release                          # zieht Version hoch, schreibt CHANGELOG, pusht Tag
```

Trockenlauf vor erstem echten Release:
```bash
npx commit-and-tag-version --dry-run
```

Vollständige Doku: [`docs/RELEASE-WORKFLOW.md`](./docs/RELEASE-WORKFLOW.md)
