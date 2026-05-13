# LLM Handoff — Beatport DJ Suite v4.2
**Erstellt:** 2026-05-13 12:03 CEST
**Von:** Claude Code CLI (Opus 4.7, 1M Context)
**Nach:** Dispatch (Cowork)
**Thema:** v4.3.0 Build-Pipeline-Refactor + M5 Phase B-E

---

## Aktueller Stand

- **Worktree:** `~/Projects/_local/beatport-dj-suite.worktrees/v4.2`
- **Branch:** `feat/v4.2`
- **Letzter Commit:** `650f4b8 docs(v4.3): Build-Pipeline-Plan via code-architect Agent`
- **Aktuelle Version:** `v4.2.17` (gepusht auf origin)
- **Installierte App:** `/Applications/Beatport DJ Suite 4.2.17.app` — läuft sauber
- **Tests:** 905/905 grün
- **PR:** #9 (offen) — `feat/v4.2 → v4`, Monorepo-Refactor + Bridge + M5-Mapping

## Was diese Session geleistet hat

### 7 neue Commits seit Session-Start

| Tag | Commit | Inhalt |
|---|---|---|
| v4.2.13 | `571ae44` | `mainWindow`-Bugfix |
| v4.2.14 | `af76522` | M5 Phase A — 4 Helper aus main.mjs nach @bpdjs/core |
| v4.2.15 | `230762c` | fix(build): packages/* + @bpdjs-Symlinks ins .app-Bundle |
| v4.2.16 | `d337433` | fix(main): @bpdjs/core via relativem Pfad (Workaround) |
| v4.2.17 | `3fcc894` | fix(ui): Tooltip-Auto-Positionierung (`tooltip-positioner.js`) |
| — | `650f4b8` | docs(v4.3): Build-Pipeline-Plan |
| — | `1aeeb60` | docs(bridge): Schritt 7 Live-Test 3/3 ✗ + Schritt 8 Skizze |

### Bridge-Track 2026-05-13

Schritt 6 + Schritt 7 live in Engine DJ Release v4.3.4 getestet — beide **3/3 ✗**.
Diagnose-Befund: `playedIndicator` ist ein Session-Cluster-Stempel aus
`m.db.Information.currentPlayedIndiciator`, kein Random-Wert pro Bridge-Lauf.
Schritt 8 (`sync_history_v8.py` mit Information-gelesenem Indicator) ist in
`docs/bridge/08-played-indicator.md` skizziert, aber **nicht implementiert**.

**Wichtiger Befund von Robert:** Engine DJ Desktop kann Beatport-LINK-Streaming-Tracks
**nicht abspielen**. Der USP-Test muss auf Hardware (Denon SC6000) oder via USB-Sync
erfolgen, nicht im Desktop. Bisherige Tests sind strukturell ungeeignet.

**Alternativer konzipierter Bridge-Weg** laut `~/MASTER_CONTEXT.md` Z.97-99:
M3U8 mit `#EXTBEATPORTID` ohne Playback — wurde diese Session NICHT geprüft.
Vor Schritt 8 erst klären: SQL-Weg oder M3U8-Weg.

## ⚠️ Uncommitted

```
M  package-lock.json
```

Modifiziert durch npm install nach Symlink-Restore in `build-mac.sh`.
**Empfehlung:** committen als `chore: package-lock.json sync nach build-mac.sh restore`.

## Offene TODOs (Priorität top-down)

- [ ] **v4.3.0 Build-Pipeline-Refactor** umsetzen — Plan liegt in `.agents/v4.3-build-pipeline-plan.md`
  - Strategie 1 (esbuild Pre-Build-Bundler) wird empfohlen
  - 6 Schritte, geschätzt 6–8h
  - Minor-Bump, weil Build-Pipeline ändert sich
  - **Erst nach Abschluss** kann M5 Phase B mit echten `@bpdjs/*`-Imports starten
- [ ] **M5 Phase B** (nach v4.3.0): `@bpdjs/ipc-router`-Extraction, 27 `ipcHandle`-Aufrufe
- [ ] **M5 Phase C** (nach Phase B): ~30 Lese-Handler migrieren
- [ ] **Bridge Schritt 8 oder M3U8-Pfad?** Vor Implementierung Kontrollraum-Entscheidung holen
- [ ] **PR #9 Body** ist auf v4.2.12-Stand, müsste auf v4.2.17 + v4.3-Plan aktualisiert werden
- [ ] **`engine-analyzer`** hat kein Git — Backup-Empfehlung offen (laut `~/AI-Context/OPEN-LOOPS.md`)

## Wichtige Dateipfade

- `.agents/v4.3-build-pipeline-plan.md` — **Plan für den nächsten Patch**, 376 Zeilen
- `.agents/v4.2-m5-mapping.md` — Mapping aller 98 IPC-Handler in main.mjs auf 14 Pakete
- `electron-app/main.mjs` (1968 Zeilen) — Hauptdatei, M5-Migrations-Ziel
- `electron-app/renderer/tooltip-positioner.js` — Auto-Positioner (heute neu, v4.2.17)
- `scripts/build-mac.sh` — Build-Wrapper mit Symlink-Deref + trap-Restore (wird in v4.3 ersetzt)
- `docs/bridge/06-engine-live-validation.md` — Schritt 6 Doku + 2026-05-13-Befund (partial pass)
- `docs/bridge/07-bridge-repair.md` — Schritt 7 Doku + 2026-05-13-Befund (3/3 ✗) + playedIndicator-Befund
- `docs/bridge/08-played-indicator.md` — Schritt-8-Skizze (nicht implementiert)
- `packages/engine-db-core/` — Plain-Copy aus engine-dj-manager, TS-Build via `tsc → dist/`
- `BACKLOG-v4.3.md` — Bridge-Track-Status + v4.3-Themen
- `~/AI-Context/SESSION-RECAP-2026-05-13.md` — strukturelle Selbstkritik dieser Session
- `~/MASTER_CONTEXT.md` — globaler Kontext, Signal-Chain, Aktive Projekte (7)
- `~/AI-Context/MODEL-ROLES.md` — Pingpong: ChatGPT=Kontrollraum, Claude=Werkbank, Codex=Spezialwerkzeug

## Geschützte Dateien (NIEMALS umbenennen / löschen)

- `electron-app/scanner/xhr-scanner.mjs` (Beatport-API)
- `electron-app/auth/session-manager.mjs` (Beatport-Auth)
- `*.db` in `Engine Library/` (Engine DJ — Sandbox-First!)
- `.als`, `.maxpat`, `.vstpreset` (Ableton/Max-Assets)

## Sandboxen (Engine DJ) — bleiben erhalten

- `~/Music/Engine Library SANDBOX-claude/` — v5-Bridge-Daten
- `~/Music/Engine Library SANDBOX-v7/` — v7-Bridge-Daten (Schritt 7, partial)
- `~/Music/Engine Library SANDBOX-v8/` — frisch, unbenutzt (Reverse-Engineering verworfen)
- `~/Music/Engine Library/` — Produktiv, MAX historylist.id=51 unverändert

## Startbefehle

```bash
cd ~/Projects/_local/beatport-dj-suite.worktrees/v4.2
npm install                    # Workspaces synchronisieren
npm test                       # Full Suite (erwartet 905 grün)
npm run desktop:dev            # Dev-Modus (Workspace-Symlinks direkt)
npm run desktop:dist:mac       # Build via scripts/build-mac.sh (Symlink-Deref + trap-Restore)
git status                     # Uncommitted-Lage prüfen
```

## Heilige Regeln (aus `~/.claude/CLAUDE.md` + `MODEL-ROLES.md`)

1. **v4.1-Branch unangetastet** — feat/v4.1 und main nicht ändern
2. **Sandbox-First** für alle Engine-DB-Schreibzugriffe (ganzen Library-Ordner kopieren)
3. **Patch-Version-Bumps** nach jedem Paket-Schritt; Minor-Bump für Build-Pipeline-Änderung
4. **Deutsch** für Doku + Kommentare
5. **AI-Context lesen zu Session-Beginn** (siehe SESSION-RECAP, strukturelle Selbstkritik)
6. **Pingpong-Rolle:** Werkbank setzt um, Kontrollraum priorisiert. Strategie kommt nicht aus der Werkbank.
7. **Vor Änderungen an aktiven Code-/Doku-Dateien:** Backup unter `~/.claude/backups/<projekt>/<TS>-<phase>/`

## Kontext für den nächsten Agent (Dispatch)

Du übernimmst v4.3.0 — Build-Pipeline-Refactor. Plan steht. Implementierung kommt:

1. **Pflichtlektüre vor Start:**
   - `.agents/v4.3-build-pipeline-plan.md` — Implementierungs-Plan (6 Schritte)
   - `~/AI-Context/SESSION-RECAP-2026-05-13.md` — was die letzte Session strukturell falsch gemacht hat
   - `~/AI-Context/MODEL-ROLES.md` — Pingpong-Rolle (Werkbank ≠ Kontrollraum)

2. **Erste Schritte (DECISIONS §6 — Inventur → Plan → Backup → Freigabe → Ausführung → Bericht):**
   - `git status` + `npm test` + `npm run desktop:dist:mac` Smoke (sollte heute alles grün sein)
   - Plan-Mode aktivieren mit Plan aus `.agents/v4.3-build-pipeline-plan.md`
   - Robert um explizite Freigabe bitten **bevor** Build-Pipeline-Änderungen committen
   - Backup vor Änderung an `package.json`, `scripts/build-mac.sh`, `electron-app/main.mjs`

3. **Was NICHT machen:**
   - Bridge Schritt 8 ohne Kontrollraum-Entscheidung (M3U8 vs SQL)
   - M5 Phase B–E vor Abschluss v4.3.0
   - Engine-DB-Schreibzugriffe ohne Sandbox-Switch
   - Goals selbst erfinden — Werkbank setzt um, was Kontrollraum priorisiert

4. **Falls Robert „ohne fragen" sagt:**
   - DECISIONS §6 trotzdem einhalten (Backup, Bericht)
   - Aber kein zwischengeschaltetes „OK?" pro Tool-Call
   - Plan-Mode-Freigabe einmal am Anfang reicht
