# LLM Handoff

## Branch

- `feature/unified-app-build`

## Gefundene Projektteile und Pfade

- Electron-App / Ziel-Repo:
  - `/Users/roberth./Projects/_local/beatport-dj-suite`
- Beatport-Scanner / Vorläufer:
  - `/Users/roberth./Projects/_github/beatport-scanner`
- Engine-DJ-Manager / Engine-DB-TypeScript-Logik:
  - `/Users/roberth./Projects/_github/engine-dj-manager`
- Engine-Analyzer / Python-Analyse:
  - `/Users/roberth./Projects/_local/engine-analyzer`
- Ableton / OSC / Max-relevante Projekte:
  - `/Users/roberth./Projects/_local/ableton-sketch-tool-codex`
  - `/Users/roberth./Projects/_local/ableton-sketch-tool-repo`
  - `/Users/roberth./Projects/_local/ableton-sketch-bridge`
  - `/Users/roberth./ableton-sketch-tool`
  - `/Users/roberth./Projects/AbletonBridge`
- Beatport Playlist Creator / heuristische Referenz:
  - `/Users/roberth./Desktop/beatport-playlist-creator`
- Gastro ERP / optional verlinktes Fremdprojekt:
  - `/Users/roberth./Projects/_github/gastro-erp`
- Reale Daten-/Medienpfade aus dem Umfeld:
  - `/Users/roberth./Music/Engine Library`
  - `/Users/roberth./Music/DJ/Engine Library`
  - `/Users/roberth./Music/Beatport.m3u8`

## Relevante erkannte Komponenten

- `Electron App (beatport-dj-suite)` als zentrale Oberfläche
- `M3U8 Export Script` als integriertes Modul in der Electron-App
- `Engine DB / Denon History Tools (Python)` als integriertes Read-only-CLI-Modul
- `Performance Classifier (BPM/Energy/Danceability)` als integriertes Heuristik-Modul
- `OSC -> Max/MSP / VJ Integration` als integrierte UDP/OSC-Bridge
- `Gastro ERP (FastAPI, Docker)` nur als verlinkter externer Kontext, nicht als eingebetteter Laufzeitteil

## Was gebaut wurde

- Neue Integrationsmodule unter `electron-app/integrations/`:
  - `project-discovery.mjs`
  - `performance-classifier.mjs`
  - `m3u-exporter.mjs`
  - `osc-bridge.mjs`
  - `python/engine_tools.py`
- Neue Renderer-Tabs:
  - `electron-app/renderer/tabs/automation.js`
  - `electron-app/renderer/tabs/settings.js`
  - `electron-app/renderer/tabs/unified-settings.js`
- Neue IPC-Brücke in `electron-app/main.mjs` und `electron-app/preload.mjs` für:
  - Projekt-Discovery
  - Engine-Summary
  - Engine-Playlists
  - Engine-History
  - M3U/M3U8-Export
  - Cache-Klassifikation
  - OSC-Snapshot-Versand
- UI-Integration in `electron-app/renderer/app.js` und `electron-app/renderer/index.html`
- Styling für den Unified-Automation-Bereich in `electron-app/renderer/styles.css`
- Testabdeckung für die neuen Integrationen in `tests/unified-integrations.test.mjs`
- Packaging-Anpassung in `package.json`, damit Python-Dateien per `asarUnpack` im Build verfügbar bleiben

## Verifikation

- Syntaxcheck erfolgreich:
  - `node --check electron-app/main.mjs`
  - `node --check electron-app/preload.mjs`
  - `node --check electron-app/renderer/app.js`
  - `node --check electron-app/renderer/tabs/automation.js`
  - `node --check electron-app/renderer/tabs/settings.js`
  - `node --check tests/unified-integrations.test.mjs`
  - `python3 -m py_compile electron-app/integrations/python/engine_tools.py`
- Test-Suite erfolgreich:
  - `npm test`
- Projekt-Check erfolgreich:
  - `npm run check`
- Packaging erfolgreich:
  - `npm run desktop:dir:mac`
  - Artefakt: `/Users/roberth./Projects/_local/beatport-dj-suite/dist-electron/mac-arm64/Beatport DJ Suite.app`

## Offene TODOs / nicht auflösbare Konflikte

- `Gastro ERP` wurde bewusst nicht in die Electron-Laufzeit eingebettet. Es bleibt ein externer, nur entdeckter/verlinkter Dienstkontext.
- Der Build verwendet aktuell das Default-Electron-Icon. `electron-builder` meldet explizit, dass kein eigenes App-Icon gesetzt ist.
- Der macOS-Build ist nicht signiert, weil `CSC_IDENTITY_AUTO_DISCOVERY=false` gesetzt ist.
- Die Python-Engine-Tools erwarten ein lokal verfügbares `python3` im PATH.
- Engine-/Denon-Funktionen hängen von einem lesbaren lokalen Engine-Library-Ordner ab; Default-Auflösung erfolgt über typische Ordner unter `~/Music`.
- Im Repository existieren fremde untracked Dateien außerhalb dieses Scopes, die absichtlich nicht in die Branch-Historie aufgenommen wurden:
  - `.claude/`
  - `assets/icon.svg`
  - `tools/beatport_cdp_tool.mjs`

## Startbefehl der fertigen App

- Dev-Start aus dem Repo:
  - `cd /Users/roberth./Projects/_local/beatport-dj-suite && npm run desktop:dev`
- Gebautes App-Bundle öffnen:
  - `open "/Users/roberth./Projects/_local/beatport-dj-suite/dist-electron/mac-arm64/Beatport DJ Suite.app"`

## Empfohlener Einstieg in der App

- Tab `Automation` öffnen
- Projekt-Discovery starten bzw. Defaults prüfen
- Engine Database Folder setzen, falls Auto-Resolve nicht greift
- `Engine Status laden`
- `Playlists laden` oder `History laden`
- `Cache klassifizieren`
- Optional `M3U8 exportieren` oder `Snapshot senden`
