# Beatport Playlist Scanner einfach erklaert

## Was ist das?
Das hier ist der sichtbare Quellordner fuer die App `Beatport Playlist Scanner`.

Er ist fuer Entwicklung gedacht:
- Quellcode
- Tests
- Dokumentation
- Build-Konfiguration

Er ist nicht der Ort fuer:
- deine Runs
- Exporte
- Cache-Dateien
- die installierte App in `~/Applications`

## Wofuer ist das gut?
Wenn du an der App arbeiten willst, ist das der richtige Ort.

Hier startest du:
- die Entwicklungs-App
- Tests
- Checks
- Builds

## Die wichtigsten Teile
- `electron-app/`
  - die eigentliche Desktop-App
- `tools/`
  - Scanner-Logik und Hilfsskripte
- `tests/`
  - Tests und Fixtures
- `docs/`
  - laengere Erklaerungen

## Wie starte ich das als Entwickler?
```bash
npm install
npm run desktop:dev
```

## Wie pruefe ich, ob der Stand sauber ist?
```bash
npm test
npm run check
```

## Was ist der Unterschied zur installierten App?
- dieses Repo = Quellcode
- `~/Applications/Beatport Playlist Scanner.app` = installierte App
- `~/Library/Application Support/Beatport Playlist Scanner/...` = Runs und Daten

## Was war der versteckte alte Ordner?
Frueher gab es einen gemischten versteckten Worktree unter `.codex/worktrees/...`.

Der war nicht sauber:
- alter Git-Unterbau
- Mischbestand aus mehreren Themen
- Build-Reste und grosse Abhaengigkeiten

Dieser sichtbare Ordner ist der saubere Zielort.

## Was soll ich als Anfaenger zuerst lesen?
1. `EINFACH_ERKLAERT.md`
2. `START_HIER.md`
3. `README.md`
4. `docs/USER_GUIDE.md`
5. `KNOWN_ISSUES.md`
