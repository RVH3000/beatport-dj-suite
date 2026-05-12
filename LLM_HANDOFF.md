# LLM Handoff — Beatport DJ Suite v4.2
**Erstellt:** 2026-05-08
**Von:** Claude Code CLI (Opus 4.7, deutscher Mode)
**Nach:** beliebige LLM-Umgebung — Standard: Claude Code CLI

---

## Aktueller Stand

- **Worktree:** `~/Projects/_local/beatport-dj-suite.worktrees/v4.2`
- **Branch:** `feat/v4.2`
- **Letzter Commit:** `9e0c5ff fix(v4.2.11): Build-Konfig — scripts/data/config korrekt im Bundle`
- **Tags auf origin:** `v4.2.0` bis `v4.2.11`
- **PRs:**
  - #9 (open) — `feat/v4.2 → v4` — Monorepo-Refactor
  - #8 (draft) — `claude/elegant-allen-e08439 → v4` — `.claude/launch.json` fix

## Was läuft / wo wir stehen

**13/13 @bpdjs/ Pakete sind komplett befüllt + getestet:**

| # | Paket | Inhalt |
|---|---|---|
| 1 | `@bpdjs/core` | errors, logger (4 Levels + Tags + FileSink), eventbus, config (ConfigStore) |
| 2 | `@bpdjs/ipc-router` | createIpcRouter (ersetzt v4.1-`ipcHandle`), sendProgress, bridgeEventToIpc |
| 3 | `@bpdjs/settings` | SettingsStore mit IPC-Handlern + Persistenz |
| 4 | `@bpdjs/file-manager` | Paths (Electron-Wrapper), atomic write/read, Disk-Helper |
| 5 | `@bpdjs/engine-db` | sqlite-cli (read-only), Sandbox-Helper, EngineLibrary |
| 6 | `@bpdjs/playlist-manager` | Camelot-Wheel, Playlist-Modell, validateMixOrder + suggestNextTracks |
| 7 | `@bpdjs/beatport-connection` v1.0.0 | Constants + Lazy-Import-Wrapper (heiliger Code bleibt in v4.1) |
| 8 | `@bpdjs/mode-layer` | STANDARD/DEVELOPER, FeatureFlags, LicenseStub |
| 9 | `@bpdjs/ui-components` | escapeHtml, Toast, SandboxBanner, Table (DOM-frei testbar) |
| 10 | `@bpdjs/ui-shell` | TabRouter mit Mode-Filter, BootSequence (5 Phasen) |
| 11 | `@bpdjs/audio-analyzer` | scoring (Performance-Score), analysis (Datenmodell + merge) |
| 12 | `@bpdjs/dev-tools` | smoke-runner + diagnostics |
| 13 | `@bpdjs/updater` | version + channels + check |

**Tests:** zuletzt verifiziert 848/848 grün (Stand v4.2.6, vor Phase 12+13). Re-Verify mit `npm test` empfohlen.

## Bridge-Track Status (2026-05-13)

Schritt 6 Live-Verifikation durchgeführt — **partial pass + Doku-Fehler**.
- Session erscheint in Engine DJ, aber Tracks darin nicht zugeordnet (`originDriveName = NULL` + falsche `originDatabaseUuid` als wahrscheinliche Ursache).
- Test-Anweisung „Playlist Techno id 35" war irreführend (Tracks gehörten nicht zu Playlist 35).
- Voller Befund: `docs/bridge/06-engine-live-validation.md`.
- **Schritt 7** (Schema-Verfeinerung) folgt als parallel laufender Paket-Track zur Monorepo-Verschmelzung mit `engine-dj-manager`.
- **Konsequenz:** `@bpdjs/engine-bridge` kommt NICHT als M1; stattdessen Plain-Copy-Merge von `engine-dj-manager/src/lib/*` nach `packages/engine-db-core/` als nächster Schritt nach v4.2.12.

## Offene TODOs

- [ ] **Monorepo-Merge (M2):** `engine-dj-manager/src/lib/*` + `tools/*` als Plain-Copy nach `packages/engine-db-core/` + `packages/engine-manager-app/`. Reihenfolge nach Live-Test-Befund festgelegt (Merge zuerst, M5 danach).
- [ ] **Bridge Schritt 7:** Schema-Verfeinerung (originDriveName, originDatabaseUuid an aktive Library binden, sinnvollen Visual-Test wählen). Sandbox bleibt unter `~/Music/Engine Library SANDBOX-claude/` erhalten.
- [ ] **M5 (FINAL):** `electron-app/main.mjs` (1946 Zeilen) Stück für Stück auf alle Pakete (13 + neue aus Merge) migrieren
  - Mapping-Bericht liegt in `.agents/v4.2-phase1-2-map.md`
  - Empfohlener Agent: `feature-dev:code-explorer` → Migrations-Plan, dann `feature-dev:code-architect` für Schritt-Plan
- [ ] PR #9 Body ggf. nochmal aktualisieren (sagt jetzt „Phase 0-11", muss „13/13" sagen)
- [ ] Tests nach M5 erneut grün stellen
- [ ] `desktop:dist:mac` Build verifizieren

## Wichtige Dateipfade

- `packages/*/` — alle 13 `@bpdjs/`-Pakete
- `electron-app/main.mjs` — Hauptziel von M5 (heilig bis dahin)
- `electron-app/scanner/xhr-scanner.mjs` — heiliger Beatport-Code (NIEMALS ändern)
- `electron-app/auth/session-manager.mjs` — heiliger Auth-Code
- `.agents/v4.2-phase1-2-map.md` — Mapping v4.1 → v4.2 für Phase 1+2
- `BACKLOG-v4.3.md` — was später kommt

## Geschützte Dateien (NIEMALS umbenennen / löschen)

- `electron-app/scanner/xhr-scanner.mjs` (Beatport-API)
- `electron-app/auth/session-manager.mjs` (Beatport-Auth)
- `*.db` in `Engine Library/` (Engine DJ — Sandbox-First!)
- `.als`, `.maxpat`, `.vstpreset` (Ableton/Max-Assets)

## Startbefehle

```bash
cd ~/Projects/_local/beatport-dj-suite.worktrees/v4.2
npm install                    # Workspaces synchronisieren
npm test                       # Full Suite (v4.1 Bestand + Phase 1-13)
npm run test:packages          # Nur die @bpdjs/* Pakete
npm run desktop:dev            # Electron-App starten
git status                     # Uncommitted-Lage prüfen
```

## Heilige Regeln (aus CLAUDE.md)

1. **v4.1-Branch unangetastet** — feat/v4.1 und Hauptpfad nicht ändern. Im v4.2-Worktree DARF main.mjs umgebaut werden (das ist v4.2-Working-Copy)
2. **Sandbox-First** für alle Engine-DB-Schreibzugriffe (ganzen Library-Ordner kopieren, nicht einzelne .db)
3. **Patch-Version-Bumps** nach jedem Paket-Schritt
4. **Deutsch** für Doku + Kommentare
5. **Bypass-Mode-Memory:** Nicht ständig fragen, durchziehen — `feedback_bypass_mode_no_questions.md`
6. **3-Strike-Memory:** Bei Trigger-Phrasen ("hooks weg" etc.) sofort Hook-Diagnose anbieten

## Kontext für den nächsten Agent

Du übernimmst eine fertige Foundation: 13 sauber strukturierte npm-Workspace-Pakete mit insgesamt ~250 grünen Tests. Die ECHTE Arbeit beginnt jetzt: **`electron-app/main.mjs` (1946 Zeilen)** muss Stück für Stück die neuen `@bpdjs/*`-Pakete importieren statt der bisherigen relativen Pfade.

**Erste Schritte für Migration (M5):**
1. Mapping-Bericht lesen: `cat .agents/v4.2-phase1-2-map.md`
2. `feature-dev:code-explorer` Agent starten mit Auftrag: „Liste alle Stellen in `electron-app/main.mjs` die durch `@bpdjs/*`-Imports ersetzt werden können — mit Datei:Zeile + Ziel-Paket"
3. Pro Migrations-Block: backup → ändern → `npm test` → committen → Patch-Tag bumpen
4. Beatport-Code (xhr-scanner, session-manager) wird via `@bpdjs/beatport-connection` lazy importiert — NICHT direkt ersetzen!

**Risiko:** main.mjs hat 95 IPC-Handler. Davon sind 34 mit `ipcHandle`-Wrapper (sauber abgekapselt → kann generisch über `@bpdjs/ipc-router` laufen). 61 sind `direct ipcMain.handle` — vorsichtiger.
