# Browser DevTools Automation

Dieses Plugin ist als Beobachter fuer eine bereits extern laufende Browser-Automation gedacht.

Es klickt nicht selbst, sondern scannt parallel einen Chromium-Browser mit offenen DevTools, um herauszufinden:

- welche Requests den DJPlaylists- und Beatport-Import treiben
- welche UI-Schritte und Selektoren benutzt werden
- welche JavaScript-Aufrufe hinter Fetch/XHR stecken
- welche Playlist-Titel bereits in der persoenlichen Sammlung vorhanden sind

## Abgedeckter Workflow

1. `djplaylists.fm` oeffnen und ueber das Benutzer-Menue zu `My Playlists` wechseln.
2. Bereits gespeicherte Playlist-Titel aus der Tabelle erkennen und lokal merken.
3. Danach den Import-Flow ueber `Submit Playlist` beobachten:
   - `Import Streaming Playlist`
   - `Beatport` waehlen
   - Label/Artist und Playlist auswaehlen
   - Trackliste laden
   - `Finalize Your Playlist`
   - Community-Standards bestaetigen
   - `Submit Playlist`
   - `Save to Lexicon`
4. Nach jeweils 25 Importen die bekannte Playlist-Menge erneut aktualisieren.

## Wichtige Eigenschaft

Die Playlist-Memory wird bewusst **nicht** ins Repo geschrieben.

Standardpfade:

- Session-Logs: `~/Library/Application Support/beatport-dj-suite/browser-devtools-automation/runs/...`
- Bekannte Playlists: `~/Library/Application Support/beatport-dj-suite/browser-devtools-automation/known-playlists.json`

## Enthalten

- `skills/browser-devtools-investigator/SKILL.md`
- `scripts/launch-devtools-browser.mjs`
- `scripts/observe-djplaylists-session.mjs`
- `.mcp.json` als Platzhalter
- `.app.json` als Platzhalter

## Schnellstart

1. Falls der Browser noch nicht mit Remote-Debugging laeuft, so starten:

```bash
node ./plugins/browser-devtools-automation/scripts/launch-devtools-browser.mjs https://www.djplaylists.fm/
```

Oder die kleine Start-App mit Interface oeffnen:

```bash
npm run browser-devtools:app
```

2. Den Beobachter direkt per CLI starten:

```bash
node ./plugins/browser-devtools-automation/scripts/observe-djplaylists-session.mjs
```

Wenn du erst spaeter starten willst:

```bash
node ./plugins/browser-devtools-automation/scripts/observe-djplaylists-session.mjs --start-at 2026-04-14T21:00:00+02:00
```

3. Die externe Automation normal ausfuehren lassen.

4. Mit `Ctrl+C` beenden. Danach liegen Summary, JSON-Dateien und die aktualisierte Playlist-Memory ausserhalb des Repos vor.

## Startdatum / Startzeit

`--start-at` erwartet einen ISO-Zeitpunkt mit Zeitzone, zum Beispiel:

- `2026-04-14T21:00:00+02:00`
- `2026-04-15T08:30:00+02:00`

Der Observer wartet dann bis genau zu diesem Zeitpunkt und beginnt erst dann mit dem Attach an den Browser.

## Ergebnis

Am Ende hast du typischerweise:

- eine Liste auffaelliger API- oder XHR-Endpunkte
- Kandidaten fuer relevante JavaScript-Funktionen aus Stacktraces
- beobachtete Klicks, Form- und Checkbox-Aenderungen
- erkannte Seitenschritte im Import-Flow
- aktualisierte bekannte Playlist-Titel zur Doubletten-Erkennung
