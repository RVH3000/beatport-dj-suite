---
name: browser-devtools-investigator
description: Beobachtet eine extern laufende Browser-Automation ueber CDP/DevTools, um Requests, Selektoren, Client-Funktionen und bekannte Playlist-Titel fuer DJPlaylists/Beatport zu erkennen.
---

# Browser DevTools Investigator

Nutze diesen Skill, wenn ein Browser-Workflow bereits extern automatisiert wird und parallel technisch mitgeschnitten werden soll.

## Ziel

Waehrend die externe Automation laeuft, soll identifiziert werden:

- welche UI-Schritte wirklich noetig sind
- welche Netzwerk-Requests den Ablauf treiben
- welche DOM-Selektoren stabil genug sind
- welche Client-Funktionen oder Events beteiligt sind
- welche Vorbedingungen wie Login, Cookies oder lokale Session-Daten existieren
- welche Playlist-Titel bereits im DJPlaylists-Konto vorhanden sind

## Empfohlener Ablauf

1. Browser mit DevTools-Unterstuetzung starten oder an einen laufenden Chromium-Browser mit Remote-Debugging-Port haengen:

```bash
node ./plugins/browser-devtools-automation/scripts/launch-devtools-browser.mjs "<ziel-url>"
```

2. Beobachter starten:

```bash
node ./plugins/browser-devtools-automation/scripts/observe-djplaylists-session.mjs
```

Optional mit geplantem Start:

```bash
node ./plugins/browser-devtools-automation/scripts/observe-djplaylists-session.mjs --start-at 2026-04-14T21:00:00+02:00
```

3. Den Ablauf durch die externe Automation ausfuehren lassen.

4. Parallel diese Signale sammeln:

- Console-Fehler und Warnungen
- Network-Requests inklusive Methode, URL, Payload und Response-Typ
- relevante DOM-Selektoren bei Klicks und Formularaenderungen
- Fetch/XHR-Aufrufe inklusive Stack-Hinweisen auf Client-Funktionen
- erkannte Playlist-Titel aus `My Playlists`
- Schrittwechsel im Import-Flow bis `Save to Lexicon`

5. Die Aufgabe danach in zwei Ebenen beschreiben:

- Benutzerfluss: Was passiert sichtbar im Browser?
- Technische Spur: Welche Requests, Funktionen oder Statuswechsel treiben das?

## Spezifischer DJPlaylists-Workflow

Der Beobachter ist auf diesen Ablauf zugeschnitten:

1. `My Playlists` oeffnen
2. Titel aus der Playlist-Tabelle lesen und in lokale Memory uebernehmen
3. `Submit Playlist` starten
4. `Import Streaming Playlist` waehlen
5. `Beatport` als Quelle waehlen
6. Label/Artist und Playlist auswaehlen
7. Trackliste und `Next` beobachten
8. `Finalize Your Playlist` inklusive Titel-Feld beobachten
9. Community-Standards-Checkbox und `Submit Playlist` beobachten
10. `Save to Lexicon` und Bestaetigungsdialog erkennen

## Memory-Regel

Bekannte Playlist-Titel duerfen nicht im Repo landen.

Verwende deshalb die Standard-Memory ausserhalb des Repos oder einen expliziten `--memory-path`.

Wenn die Automation erst spaeter laufen soll, verwende `--start-at` mit einem ISO-Zeitpunkt inklusive Zeitzone.

## Immer dokumentieren

- Start-URL
- Trigger-Aktion
- erwartetes Ergebnis
- benoetigte Selektoren
- benoetigte Requests oder API-Endpunkte
- relevante Funktionsnamen aus Stacktraces
- erkannte Playlist-Titel und neu hinzugekommene Titel
- moegliche Fehlerquellen

## Gewuenschtes Ergebnis

Der Output soll kompakt genug sein, um daraus spaeter gezielt zu bauen oder gegen Doubletten zu pruefen:

- Playwright-Skript
- Codex-Skill
- MCP-Server
- Hook-basierte Automation
- Vergleich gegen bereits bekannte Playlists

## Hinweis

Dieser Skill ist bewusst als Analyse-Vorstufe gedacht. Er soll erst sichtbar machen, wie der DJPlaylists-/Beatport-Import technisch funktioniert, bevor eine produktive Automation oder Duplicate-Logik darauf aufsetzt.
