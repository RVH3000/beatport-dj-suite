# Release-Checklist

## Pflicht vor Freigabe

- `npm test`
- `npm run check`
- `npm run desktop:dist:mac`
- echter Beatport-Smoke-Test erfolgreich

## Smoke-Test muss enthalten

- eingeloggte Beatport-DJ-Session auf `dj.beatport.com`
- Discovery
- Auswahl einer Teilmenge
- Analyse
- Pause/Resume
- ZIP-Export
- Migration eines Legacy-Runs
- Sichtbarkeit eines migrierten Runs
- Delete-Gate ohne Bestätigung blockiert

## Release-Artefakte

- DMG
- ZIP
- dokumentierter Smoke-Report
- aktueller Commit im Scanner-Repo
