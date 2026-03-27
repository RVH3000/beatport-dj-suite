immer deutsch antworten

# Beatport Scanner Repo

## Projektziel
- macOS-Desktop-App fuer Beatport DJ Suite
- Quellcode nur fuer Scanner, keine fachfremden Projekte

## Wichtige Pfade
- `electron-app/` UI und Electron-Prozess
- `electron-app/scanner/cdp-scanner.mjs` Scanner-Kern
- `tools/beatport_cdp_tool.mjs` kompatibler Scanner-CLI-Entrypoint
- `tools/bpx.mjs` XHR-/Playlist-CLI
- `scripts/` Checks und Smoke-Test
- `tests/` automatisierte Tests
- `docs/` Benutzer- und Technikdoku

## Regeln
- Keine Nutzerdaten ins Repo schreiben
- Build-Artefakte nicht als Quellbestand behandeln
- Immer deutsch antworten
