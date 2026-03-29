# Troubleshooting

## Interne Session ist nicht angemeldet

Prüfen:
- in `Sicherheit & Session` auf `Beatport-Fenster öffnen` klicken
- dort manuell bei Beatport anmelden
- danach `Session testen`
- erst dann den Scan erneut starten

## CDP-Endpunkt nicht erreichbar

Nur relevant im Modus `Externer Fallback`.

Prüfen:
- Beatport DJ App läuft
- Remote-Debugging-Port stimmt
- Host-Browserpfad stimmt
- `App/Host vor Zugriff starten` ist aktiv

## Keine Playlists gefunden

Prüfen:
- Beatport ist im internen Fenster oder im externen Fallback wirklich eingeloggt
- richtige DJ-Ansicht ist offen
- Sidebar ist wirklich geladen

## Delta-Sync ist langsamer als erwartet

Prüfen:
- ob der lokale Cache bereits gefüllt ist
- ob beim Start zuerst Cache-Daten sichtbar werden
- ob nur `dirty` oder neue Playlists tief analysiert werden
- ob unnötig `Externer Fallback` statt `Interne Beatport-Session` aktiv ist

Hinweis:
- der lokale SQLite-Arbeitsbestand ist die schnelle Primärquelle
- Delta-Sync zieht nur Playlist-Summaries nach
- vollständige Trackanalyse läuft nur für ausgewählte oder geänderte Playlists

## Analyse pausiert oder unvollständig

Diagnose immer mit:
- App-Version
- Build-ID
- Run-ID
- `events.jsonl`
- `manifest.json`
- `summary.json`

## Support-Artefakte

Wichtige Dateien:
- `events.jsonl`
- `manifest.json`
- `summary.json`
- `playlists.jsonl`
- `duplicates.jsonl`
- `track-analysis.jsonl`
- Run-ZIP
