# LLM Handoff — beatport-dj-suite
Erstellt: 2026-03-29
Von: Claude Desktop (Cowork)
Nach: Claude Code CLI

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
