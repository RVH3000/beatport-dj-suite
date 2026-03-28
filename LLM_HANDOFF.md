# LLM Handoff — Beatport DJ Suite

**Datum:** 2026-03-27
**Branch:** `feature/unified-app-build`
**Version:** 2.0.0
**GitHub:** https://github.com/RVH3000/beatport-dj-suite (privat, soeben erstellt)

---

## Was in dieser Session passiert ist

### Phase 1 — GitHub-Backup (erledigt)
- Repo war bisher nur lokal (`_local/`) ohne Remote
- `gh repo create RVH3000/beatport-dj-suite --private` ausgeführt
- Alle Branches gepusht: `main`, `feature/unified-app-build`, drei `claude/*`-Branches

### Phase 2 — Strangler Fig Extraktion (erledigt, noch nicht committed)
Aus `cdp-scanner.mjs` wurden zwei eigenständige Module extrahiert:

**`electron-app/scanner/run-store.mjs`** (neu, untracked)
- RunStore-Klasse: Runs laden, speichern, suchen, löschen
- Schema-Validierung (schemaVersion: 2)
- Pflichtfelder: `origin.kind`, `migration`, `counts`, `selection`, `analysisPlan`
- Statusmodell: `running`, `ready_for_analysis`, `paused`, `completed`, `incomplete`
- Legacy-Erkennung: schemaVersion < 2, `phase` fehlt, `app.version < 1.1.0`
- Track-Fingerprint (`buildTrackFingerprint` via `node:crypto`)
- CSV-Header-Definitionen (`TRACK_CSV_HEADERS`, `SUMMARY_CSV_HEADERS`)

**`electron-app/scanner/legacy-migrator.mjs`** (neu, untracked)
- `buildMigrationTargetRun` — baut migrierten Run aus Legacy-Quelle
- `migrateLegacyRunsImpl` — kopierender Migrationsmodus (niemals in-place)
- Setzt: `origin.kind: "legacy-migrated"`, `migration.sourceRunId/Version/migratedAt/mode`
- Importiert Helfer aus `run-store.mjs`

**`electron-app/scanner/cdp-scanner.mjs`** (modifiziert)
- Lokale Definitionen von `buildMigrationTargetRun` und `migrateLegacyRuns` entfernt
- Wrapper-Funktion `migrateLegacyRuns` mit Parameter-Injection ersetzt
- Importiert jetzt aus `legacy-migrator.mjs`
- Nicht mehr verwendete Imports entfernt (`createHash`)
- Außenschnittstelle unverändert

---

## Aktueller Git-Status

```
modified:   electron-app/scanner/cdp-scanner.mjs
untracked:  electron-app/scanner/run-store.mjs
untracked:  electron-app/scanner/legacy-migrator.mjs
untracked:  tools/beatport_cdp_tool.mjs
untracked:  assets/
untracked:  .claude/
```

**Die Extraktion ist noch nicht committed.** Vor dem Commit sollte ein Smoke-Test durchgeführt werden.

---

## Offene TODOs (Refactoring-Roadmap)

### Sofort (vor nächstem Feature)
- [ ] Smoke-Test mit Live-Beatport-Session durchführen (laut `docs/RELEASE_CHECKLIST.md`)
- [ ] Extraktions-Commit: `run-store.mjs` + `legacy-migrator.mjs` + geänderter `cdp-scanner.mjs`
- [ ] `tools/beatport_cdp_tool.mjs` und `assets/` committen oder in `.gitignore` aufnehmen

### Phase 3 — IPC-Formalisierung
- [ ] Alle IPC-Handler aus `main.mjs` in `electron-app/ipc-api.mjs` zentralisieren
- [ ] Neue Tabs (`analysis.js`, `export.js`, `playlist-wiz.js`, `sync.js`, `search.js`, `automation.js`) gegen formale IPC-API bauen
- [ ] `unified-settings.js` von direktem State-Zugriff entkoppeln

### Phase 4 — SQLite als Service (nach Phase 3)
- [ ] `sqlite-cache.mjs` zum einzigen DB-Zugriffspunkt machen
- [ ] Alle direkten `sqlite`-Imports in anderen Modulen entfernen
- [ ] Schema-Migration-Mechanismus in SQLite-Service integrieren

### Infrastruktur
- [ ] Test-Coverage für `run-store.mjs` und `legacy-migrator.mjs` schreiben (ohne Electron)
- [ ] `SMOKE_TEST_REPORT.md` nach nächstem Live-Lauf aktualisieren (letzter: 2026-03-12)

---

## Relevante Dateipfade

| Datei | Zweck |
|-------|-------|
| `electron-app/scanner/cdp-scanner.mjs` | Kern-Scanner (XHR/CDP, God Object — wird schrittweise verkleinert) |
| `electron-app/scanner/run-store.mjs` | NEU: Run-Verwaltung, Schema-Validierung, Fingerprints |
| `electron-app/scanner/legacy-migrator.mjs` | NEU: Legacy-Migration (1.0.x → schemaVersion 2) |
| `electron-app/cache/sqlite-cache.mjs` | SQLite-Persistenz (nächster Extraktion-Kandidat) |
| `electron-app/main.mjs` | IPC-Grenze Electron Main ↔ Renderer |
| `electron-app/preload.mjs` | Electron-Preload-Bridge |
| `electron-app/renderer/app.js` | Renderer-Root |
| `electron-app/renderer/tabs/*.js` | Tab-Module (analysis, export, playlist-wiz, sync, search, automation, settings, unified-settings) |
| `electron-app/api/djplaylists-client.mjs` | DJPlaylists-API-Client |
| `electron-app/api/lexicon-client.mjs` | Lexicon-API-Client |
| `electron-app/integrations/*.mjs` | OSC-Bridge, M3U-Exporter, Project-Discovery, Performance-Classifier |
| `docs/ARCHITECTURE.md` | Architektur-Übersicht |
| `docs/MIGRATION.md` | Migration-Spezifikation |
| `docs/RELEASE_CHECKLIST.md` | Release-Prozess |
| `docs/SMOKE_TEST_REPORT.md` | Letzter Smoke-Test: 2026-03-12 |

---

## Kontext für nächste Session

- Die App ist ein Electron-Scraper für Beatport DJ-Playlists
- CDP = Chrome DevTools Protocol (Fallback wenn XHR nicht ausreicht)
- Beatport-Login lebt ausschließlich im persistenten Electron-Profil (keine Passwörter in Artefakten)
- JSONL = technischer Primärbestand; SQLite = operativer Arbeitsbestand für UI
- Delta-Sync aktualisiert Cache aus Beatport-Summaries ohne Vollanalyse
- Duplikate: erst Kandidaten via `Name + Trackzahl`, dann serverseitige Bestätigung via Track-Fingerprint
