<!-- doc-governance
project_id: beatport-scanner
doc_role: readme
scope: project
owner_root: /Users/roberth./Projects/products/beatport-scanner
canonical: true
updated_at: 2026-03-16
-->

# Beatport Playlist Scanner

macOS-Desktop-App für Beatport DJ Playlists mit internem persistentem Beatport-Profil.

Funktionen:
- lokaler SQLite-Arbeitsbestand für sofortige Playlist-Ansicht
- Delta-Sync statt Vollanalyse beim Start
- XHR-First Discovery aller Playlists über `api.beatport.com/v4/my/playlists`
- Duplikaterkennung
- pausierbare XHR-First Tiefenanalyse nach Genre, Label und Jahr nur für ausgewählte Playlists
- interne Beatport-Session ohne Passwortspeicherung
- aggressive Recovery des internen Beatport-Kontexts ohne Neustart der Scanner-App
- automatische Migration alter `1.0.x`-Runs beim Start
- automatische Auswahl des letzten kompatiblen Runs beim Start
- Delta-Discovery mit Wiederverwendung vorhandener Playlistbestände
- crash-sichere Run-Archive
- Legacy-Migration von `1.0.x` nach Schema `v2`
- ZIP-Export kompletter Runs
- Datenquellen-Anzeige pro Run und Playlist: `xhr`, `route`, `dom`

## Kernpfade

- App: `electron-app/`
- Scanner-Engine: `tools/beatport_cdp_tool.mjs`
- Tests: `tests/`
- Dokumentation: `docs/`

## Lokaler Start

```bash
npm install
npm run desktop:dev
```

## Fuer Einsteiger
- zuerst `EINFACH_ERKLAERT.md` lesen
- danach `START_HIER.md`

## Session-Modell

- Standard ist `Interne Beatport-Session`
- kein Passwort im JSON, in Run-Artefakten oder im Renderer-Storage
- Login bleibt über das persistente Electron-Profil erhalten
- wenn Beatport die Session verliert, öffnet die App nur das interne Beatport-Fenster zur erneuten Anmeldung
- `Externer Fallback` bleibt für Diagnosefälle verfügbar
- Serverdaten sind führend; DOM bleibt nur Fallback für Visualisierung und Delete

## Build

```bash
npm run desktop:dist:mac
```

Artefakte:
- `dist-electron/*.dmg`
- `dist-electron/*.zip`

## Qualitäts-Skripte

```bash
npm test
npm run check
```

`npm run check` prüft:
- Syntax der Kernmodule
- Fixture-basierte Tests
- Vorhandensein der Pflichtdokumentation
- Build-Konfigurationsgrundlagen

## Live-Smoke-Test

```bash
npm run smoke:beatport
```

Voraussetzungen:
- im Standardmodus genügt eine gültige interne Beatport-Session
- nur im Modus `Externer Fallback` wird ein CDP-Target auf `dj.beatport.com` benötigt
- `--fresh-start` nur verwenden, wenn ein absichtlicher Neustart des externen Debug-Hosts gewünscht ist

Optional mit Reportdatei:

```bash
node scripts/smoke-beatport.mjs --report docs/SMOKE_TEST_REPORT.json
node scripts/smoke-beatport.mjs --fresh-start --report docs/SMOKE_TEST_REPORT.json
```

## Run-Archiv

Standardpfade:
- Archiv: `~/Library/Application Support/Beatport Playlist Scanner/runs/<runId>/`
- Export: `~/Downloads/Beatport-Scanner-Exports/<runId>/`

Run-Typen:
- `native`
- `legacy-source`
- `legacy-migrated`

## Startverhalten

- beim Start werden vorhandene `legacy-source`-Runs automatisch kopierend migriert
- danach baut die App bei Bedarf den lokalen SQLite-Cache aus vorhandenen Runs auf
- die UI zeigt zuerst den lokalen Arbeitsbestand
- danach läuft Delta-Sync gegen Beatport, ohne automatisch jede Playlist tief zu analysieren

Details siehe:
- [Benutzerhandbuch](/Users/roberth./Projects/products/beatport-scanner/docs/USER_GUIDE.md)
- [Troubleshooting](/Users/roberth./Projects/products/beatport-scanner/docs/TROUBLESHOOTING.md)
- [Architektur](/Users/roberth./Projects/products/beatport-scanner/docs/ARCHITECTURE.md)
- [Migration](/Users/roberth./Projects/products/beatport-scanner/docs/MIGRATION.md)
- [Release-Checklist](/Users/roberth./Projects/products/beatport-scanner/docs/RELEASE_CHECKLIST.md)
