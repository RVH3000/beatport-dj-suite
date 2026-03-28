# Smoke-Test Report

## Erfolgreicher Live-Lauf

- Datum: 2026-03-12
- Report-Datei: `docs/SMOKE_TEST_REPORT.json`
- Discovery-Run: `2026-03-12T03-34-35-504Z-ahlmlr`
- Migrierter Legacy-Run: `2026-03-12T03-34-35-408Z-quu5ru`

Ergebnis des erfolgreichen Live-Laufs:
- Legacy-Migration eines `1.0.1`-Runs erfolgreich
- Discovery erfolgreich mit `1569` Playlists und `22` Duplikaten
- Analyse einer Teilmenge erfolgreich
- Pause/Resume erfolgreich
- ZIP-Export erfolgreich
- Delete-Gate blockiert ohne exakten Bestätigungstext

## Wichtige Voraussetzung

Der Live-Smoke-Test setzt eine bereits eingeloggte Beatport-DJ-Session voraus. Ein erzwungener Host-Neustart kann in eine nicht authentifizierte Startseite führen; in diesem Zustand liefert Discovery erwartbar `0` Playlists.

## Aktueller Prüfhinweis

Das aktuelle Smoke-Script unterstützt deshalb standardmäßig keinen Frischstart mehr. Ein Frischstart ist nur noch explizit per `--fresh-start` vorgesehen und dient nur zur Debugging-Diagnose, nicht als Standard-Freigabepfad.
