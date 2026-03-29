# Migration

## Ziel

`1.0.x`-Runs in lesbare und benutzbare `schemaVersion: 2`-Runs überführen, ohne die Quelle zu verändern.

## Erkennung

Ein Run gilt als Legacy, wenn mindestens eines zutrifft:
- `schemaVersion` fehlt oder ist kleiner als `2`
- `phase` fehlt
- `app.version < 1.1.0`

## Modus

- nur manuell
- nur kopierend
- niemals in-place

## Ergebnis

Der migrierte Run enthält:
- `schemaVersion: 2`
- `origin.kind: "legacy-migrated"`
- `migration.sourceRunId`
- `migration.sourceVersion`
- `migration.migratedAt`
- `migration.mode: "copy"`

## Regeln

- Legacy-Quelle bleibt read-only
- migrierter Run ist sofort für Auswahl, Analyse, Vergleich und ZIP-Export nutzbar
- Delete bleibt für Legacy-Quelle blockiert
