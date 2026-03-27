# Architektur

## Komponenten

- `electron-app/auth/*`
  - interner Beatport-Session-Kontext
  - persistente Electron-Partition
  - Session-Probe und Login-Öffnung ohne Passwortspeicherung
- `electron-app/scanner/cdp-scanner.mjs`
  - interner Client oder externer CDP-Fallback
  - XHR-First Discovery und Analyse über Beatport-API
  - lokaler SQLite-Arbeitsbestand als Primärquelle für UI und CSV
  - Request-Context-Resolver für Authorization/Header aus dem internen Session-Kontext
  - Route-/DOM-Fallback, wenn XHR nicht auflösbar ist
  - RunStore
  - Legacy-Erkennung, Migration, ZIP-Export
  - bevorzugter kompatibler Run und Delta-Baseline für neue Discovery-Läufe
- `tools/beatport_cdp_tool.mjs`
  - kompatibler CLI-Entrypoint auf den Scanner-Kern
- `tools/bpx.mjs`
  - XHR-/Playlist-CLI für API-Kontext, CRUD und Cache-Export
- `electron-app/main.mjs`
  - IPC-Grenze zwischen UI und Tool
- `electron-app/renderer/*`
  - Archivansicht
  - Discovery-/Analyse-Workflow
  - Analysis-, Export- und Playlist-Wiz-Tabs
  - Legacy-Migration und ZIP-Export

## Run-Schema v2

Pflichtfelder:
- `schemaVersion: 2`
- `origin.kind`
- `migration`
- `counts`
- `selection`
- `analysisPlan`

## Persistenzmodell

- SQLite ist der operative Arbeitsbestand für Playlistlisten, Trackdetails, Fingerprints und Exportstände
- JSONL ist der technische Primärbestand
- CSV/JSON sind abgeleitete Exportformate
- jede Änderung wird gespiegelt in:
  - Archivordner
  - sichtbaren Exportordner
- Beatport-Login lebt getrennt davon ausschließlich im persistenten Electron-Profil
- Run-Artefakte enthalten keine Passwörter, Tokens oder Cookies
- der Cache wird bei Bedarf aus vorhandenen Runs wiederaufgebaut
- Delta-Sync aktualisiert den Cache aus Beatport-Summaries, ohne automatisch eine Vollanalyse anzustoßen
- Playlist- und Trackdaten enthalten die effektive Datenquelle `xhr`, `route` oder `dom`
- Duplikate werden zuerst als Kandidaten über `Name + Trackzahl` und danach serverseitig über einen Track-Fingerprint bestätigt

## Statusmodell

- `running`
- `ready_for_analysis`
- `paused`
- `completed`
- `incomplete`
