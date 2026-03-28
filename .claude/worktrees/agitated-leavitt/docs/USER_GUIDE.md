# Benutzerhandbuch

## Standardablauf

1. App von `/Users/roberth./Applications/Beatport Playlist Scanner.app` starten.
2. Die App migriert alte `1.0.x`-Runs automatisch und baut bei Bedarf den lokalen Cache aus vorhandenen Runs auf.
3. Im Bereich `Sicherheit & Session` den Modus `Interne Beatport-Session` lassen.
4. Falls nötig `Beatport-Fenster öffnen` und dort normal einloggen.
5. `Session testen`.
6. `Delta-Sync` starten oder den automatischen Delta-Lauf abwarten.
7. Im Bereich `Schneller Arbeitsbestand` Playlists filtern und markieren.
8. `Auswahl analysieren`.
9. Optional `Pause anfordern`, danach `Resume`.
10. Bei Bedarf `CSV exportieren` oder `ZIP exportieren`.

## Sicherheit & Session

- Die App speichert kein Passwort.
- Beatport bleibt über das interne Electron-Profil angemeldet, solange die Session-Cookies gültig sind.
- Wenn Beatport die Session verliert, genügt `Beatport-Fenster öffnen` oder `Neu verbinden`; die Scanner-App selbst muss nicht neu gestartet werden.
- `Externer Fallback` ist nur für Diagnose- oder Notfälle gedacht.

## Lokaler Arbeitsbestand

- Die App nutzt einen lokalen SQLite-Arbeitsbestand für schnelle Listen, Filter und CSV-Exporte.
- Beim Start wird zuerst dieser lokale Bestand angezeigt.
- Delta-Sync aktualisiert danach nur neue oder geänderte Playlists.
- Tiefenanalyse läuft nur für ausgewählte Playlists und schreibt die Ergebnisse zurück in Cache und Run-Archiv.

## XHR-First Analyse

- Standard ist `Auto (XHR bevorzugen, Route, DOM Fallback)`.
- Discovery liest Playlists serverseitig paginiert aus Beatport.
- Tiefenanalyse liest bevorzugt Trackdaten direkt aus den Playlist-API-Endpunkten.
- In Ergebnis- und Detailansicht ist die effektive Quelle sichtbar: `xhr`, `route` oder `dom`.
- `Label`, `Genre` und `Release-Jahr` werden aus den Serverdaten bevorzugt; `Artist`, `BPM` und `Key` bleiben zusätzlich erhalten.

## Run-Typen

- `Native`: Lauf wurde mit dem aktuellen Schema erstellt.
- `Legacy-Quelle`: alter `1.0.x`-Lauf, nur lesbar.
- `Migriert`: kopierte und normalisierte Fassung eines Legacy-Runs.

## Legacy-Migration

- Button `Legacy-Runs migrieren` erzeugt neue Runs.
- Originale Legacy-Runs bleiben unverändert.
- Nach der Migration nur mit dem migrierten Run weiterarbeiten.

## Löschen

- Löschen arbeitet nur gegen abgeschlossene native oder migrierte Runs.
- Legacy-Quellen sind read-only.
- Der Text `LÖSCHEN BESTÄTIGT` muss exakt eingegeben werden.
