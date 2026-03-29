# Beatport DJ Suite — Testing-Strategie

**Version:** 2.0.0
**Erstellt:** 2026-03-28
**Test-Runner:** Node.js native `node --test`
**Ziel:** Vollständige Testabdeckung nach Testing-Pyramide mit App-Bundle-Smoke-Tests

---

## 1. Ist-Zustand

### Vorhandene Tests (555 LOC, 2 Dateien)

Die aktuelle Testsuite deckt zwei Bereiche ab:

**beatport-scanner.test.mjs** — 17 Assertions in 13 Tests:
- Legacy-Detection und Migration (Schema v1→v2)
- RunStore: Pause/Resume, Baseline-Import
- Cache-Rebuild und CSV-Export
- XHR-Normalisierung (Playlists, Tracks)
- Track-Fingerprint und Duplikaterkennung
- Auth-Defaults und Session-Heuristik
- Secret-Redaction

**unified-integrations.test.mjs** — 4 Tests:
- Project-Discovery (Verzeichnis-Scanning)
- Performance-Classifier (BPM-Normalisierung, Stage-Zuweisung)
- M3U-Exporter (EXTM3U-Format, UTF-8-Ausgabe)
- OSC-Bridge (Paket-Bau, Snapshot-Versand)

### Qualitäts-Skripte

`npm run check` (scripts/check-scanner.mjs) prüft Syntax der Kernmodule, führt Tests aus und validiert Dokumentation sowie Build-Konfiguration. `npm run smoke:beatport` existiert als Script, aber der Inhalt ist unklar.

---

## 2. Lücken-Analyse

### Kritische Lücken (Prio 1 — sofort schließen)

| Modul | LOC | Getestet? | Risiko |
|-------|-----|-----------|--------|
| **main.mjs** (IPC-Handler) | 1.133 | Nein | Hoch — alle Renderer↔Main-Aufrufe ungetestet |
| **sqlite-cache.mjs** | 714 | Indirekt | Hoch — Cache-Korruption kann App unbrauchbar machen |
| **session-manager.mjs** | 466 | Nein | Hoch — Auth-Fehler blockieren alle Scans |
| **xhr-scanner.mjs** | 403 | Teilweise | Mittel — nur Normalisierung getestet, nicht HTTP-Logik |
| **run-store.mjs** | 1.661 | Teilweise | Mittel — nur über cdp-scanner importiert |

### Mittlere Lücken (Prio 2 — nächste Iteration)

| Modul | LOC | Status |
|-------|-----|--------|
| **lexicon-client.mjs** | 571 | Komplett ungetestet |
| **djplaylists-client.mjs** | 453 | Komplett ungetestet |
| **export-formats.mjs** | 255 | Komplett ungetestet |
| **preload.mjs** (IPC-Bridge) | 119 | Komplett ungetestet |
| **legacy-migrator.mjs** | 203 | Nur indirekt über cdp-scanner |

### Renderer-Lücken (Prio 3 — spätere Phase)

| Modul | LOC | Status |
|-------|-----|--------|
| **renderer/app.js** | 2.566 | Komplett ungetestet |
| **renderer/tabs/** (7 Dateien) | 3.909 | Komplett ungetestet |

### Fehlende Kategorien

- Kein E2E-/Smoke-Test der gebauten `.app`
- Kein Linting (ESLint) oder Formatierung (Prettier)
- Keine CI-Pipeline (GitHub Actions)
- Keine Code-Coverage-Messung
- Keine Regressionstests für bekannte Issues (KNOWN_ISSUES.md)

---

## 3. Testing-Pyramide

```
            ╱  Smoke / E2E  ╲         2-3 Tests: App startet, Fenster öffnet
           ╱   Integration    ╲        8-12 Tests: IPC, Cache, Auth-Flow
          ╱    Unit-Tests       ╲      30-50 Tests: Jede Funktion isoliert
```

### Ziel-Verteilung

| Ebene | Anzahl | Laufzeit-Budget | Priorität |
|-------|--------|-----------------|-----------|
| Unit | 30-50 Tests | < 5 Sekunden | Sofort |
| Integration | 8-12 Tests | < 15 Sekunden | Phase 2 |
| Smoke / E2E | 2-3 Tests | < 30 Sekunden | Phase 3 |

---

## 4. Testplan nach Modul

### 4.1 Scanner-Kern (cdp-scanner.mjs + run-store.mjs)

**Status:** Teilweise getestet — gute Basis vorhanden.

**Neue Tests benötigt:**

```
tests/scanner-core.test.mjs
├── resolveConfig() — Merge von Defaults + Overrides
├── resolveRunPaths() — Pfadkonstruktion bei Sonderzeichen
├── RunStore.initialize() — Erstellt korrektes Verzeichnis-Layout
├── RunStore.addPlaylists() — Duplikat-Handling bei Wiederholung
├── RunStore.markCompleted() — Manifest-Status + Zeitstempel
├── RunStore.resumeFromPause() — Korrekte Wiederaufnahme
├── buildPlaylistSummaryFromTrackRows() — Leere Track-Liste
├── buildDuplicateEntries() — 0, 1, N Duplikate
├── sanitizeSensitiveText() — URL-Tokens, Cookies, Pfade
└── parseHumanTrackCount() — Grenzfälle: leer, nur Dauer, Unicode
```

**Beispiel-Test:**
```javascript
test("resolveConfig merged Overrides korrekt mit Defaults", () => {
  const config = resolveConfig({ archiveRootDir: "/custom/path" });
  assert.equal(config.archiveRootDir, "/custom/path");
  assert.equal(config.authMode, "internal"); // Default bleibt
  assert.equal(config.preferServerData, true);
});
```

### 4.2 SQLite-Cache (sqlite-cache.mjs)

**Status:** Nur indirekt über rebuildCacheFromRuns getestet.

**Neue Tests benötigt:**

```
tests/sqlite-cache.test.mjs
├── SQLiteCacheStore — Initialisierung und Schema-Erstellung
├── SQLiteCacheStore — Playlist-Insert und -Abfrage
├── SQLiteCacheStore — Track-Insert mit Fremdschlüssel
├── SQLiteCacheStore — Upsert bei bestehendem Datensatz
├── SQLiteCacheStore — Leere DB gibt leere Ergebnisse zurück
├── SQLiteCacheStore — Concurrent-Write-Schutz (WAL-Modus)
├── resolveCacheDbPath() — Erstellt Elternverzeichnis
└── SQLiteCacheStore — Graceful Close nach Operationen
```

**Wichtig:** Jeder Test erstellt eine eigene temporäre SQLite-DB via `os.tmpdir()`, damit Tests parallel laufen können.

### 4.3 Auth & Session (session-manager.mjs + session-probe.mjs)

**Status:** Nur session-probe Heuristik getestet (2 Tests).

**Neue Tests benötigt:**

```
tests/auth.test.mjs
├── detectBeatportSessionState() — Weitere Szenarien:
│   ├── Intermediate-Redirect (host wechselt)
│   ├── Timeout / leerer Body
│   ├── Partial-Login (nur Username ausgefüllt)
│   └── API-Endpunkt statt Browser-Seite
├── SessionManager (erfordert Electron-Mock oder Extraktion):
│   ├── getPartition() — Gibt korrekten Partitionsnamen
│   ├── isSessionValid() — Cookie-Prüfung
│   └── clearSession() — Bereinigt alle Session-Daten
```

**Hinweis:** `SessionManager` nutzt Electron-APIs (`session.fromPartition`). Zwei Ansätze möglich:
1. **Empfohlen:** Logik in testbare Pure Functions extrahieren
2. Alternativ: Electron-Session via Dependency Injection mocken

### 4.4 XHR-Scanner (xhr-scanner.mjs)

**Status:** Normalisierung getestet, HTTP-Logik nicht.

**Neue Tests benötigt:**

```
tests/xhr-scanner.test.mjs
├── BeatportXhrClient.fetchPlaylists() — Mock-Response-Parsing
├── BeatportXhrClient.fetchPlaylistTracks() — Paginierung
├── BeatportXhrClient.fetchPlaylistTracks() — Rate-Limiting (429)
├── BeatportXhrClient — Timeout-Handling
├── loadApiContext() — Extrahiert Token aus Cookie-String
├── normalizePlaylist() — Fehlende Felder (null, undefined)
└── normalizeTrack() — Fehlende Artists, Label, Genre
```

### 4.5 API-Clients (lexicon-client.mjs + djplaylists-client.mjs)

**Status:** Komplett ungetestet.

**Neue Tests benötigt:**

```
tests/api-clients.test.mjs
├── LexiconClient — Basis-Request-Konstruktion
├── LexiconClient — Auth-Header-Injection
├── LexiconClient — Error-Response-Handling (4xx, 5xx)
├── DjplaylistsClient — Playlist-CRUD-Operationen (Mock)
├── DjplaylistsClient — Rate-Limit-Backoff
└── DjplaylistsClient — Netzwerk-Timeout
```

**Ansatz:** HTTP-Requests über injizierbare `fetch`-Funktion mocken.

### 4.6 Export-Formate (export-formats.mjs)

**Neue Tests:**

```
tests/export-formats.test.mjs
├── generateExport("csv") — Korrekte Spalten und Trennzeichen
├── generateExport("json") — Valides JSON mit Schema
├── generateExport("m3u") — Delegiert an m3u-exporter
├── generateExport() — Unbekanntes Format wirft Fehler
└── generateExport() — Leere Playlist-Liste
```

### 4.7 IPC-Integration (main.mjs ↔ preload.mjs)

**Status:** Komplett ungetestet — höchstes Risiko.

**Strategie:** IPC-Handler einzeln testen, ohne Electron-Window.

```
tests/ipc-handlers.test.mjs
├── Handler "scanner:list-runs" — Ruft listStoredRuns mit config auf
├── Handler "cache:get-status" — Leitet an getCacheStatus weiter
├── Handler "cache:rebuild-from-runs" — Rückgabewert korrekt
├── Handler "export:csv-from-cache" — Pfade in Antwort enthalten
├── Handler "scanner:delta-sync" — Gibt Progress-Events weiter
└── Handler "scanner:pause-run" — Setzt Pause-Flag korrekt
```

**Voraussetzung:** IPC-Handler-Registrierung aus `main.mjs` in eigenes Modul extrahieren (z.B. `electron-app/ipc-handlers.mjs`), damit sie ohne `BrowserWindow` testbar sind.

### 4.8 App-Bundle Smoke-Tests

**Neue Datei:**

```
tests/smoke-app-bundle.test.mjs
├── App-Binary existiert unter dist-electron/mac-arm64/
├── App startet und beendet sich ohne Crash (Exitcode 0)
├── App erstellt userData-Verzeichnis korrekt
└── Haupt-Fenster öffnet sich (optionaler Spectron/Playwright-Test)
```

**Implementierung:**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const APP_PATH = path.resolve(
  "dist-electron/mac-arm64/Beatport DJ Suite.app/Contents/MacOS/Beatport DJ Suite"
);

test("App-Binary existiert nach Build", () => {
  assert.ok(existsSync(APP_PATH), `Binary nicht gefunden: ${APP_PATH}`);
});

test("App startet und akzeptiert --version ohne Crash", () => {
  // Electron-Apps akzeptieren --version
  const result = execFileSync(APP_PATH, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.match(result.trim(), /^\d+\.\d+/);
});
```

---

## 5. Priorisierte Umsetzungsreihenfolge

### Phase 1 — Sofort (Woche 1-2)

1. **sqlite-cache.test.mjs** erstellen — Datenverlust-Risiko minimieren
2. **scanner-core.test.mjs** erweitern — RunStore-Edge-Cases abdecken
3. **xhr-scanner.test.mjs** erstellen — Mock-basierte HTTP-Tests
4. **auth.test.mjs** erweitern — Mehr Session-Heuristik-Szenarien

### Phase 2 — Kurz danach (Woche 3-4)

5. **api-clients.test.mjs** erstellen
6. **export-formats.test.mjs** erstellen
7. IPC-Handler extrahieren und **ipc-handlers.test.mjs** erstellen
8. **smoke-app-bundle.test.mjs** erstellen

### Phase 3 — Mittelfristig (Monat 2)

9. Renderer-Tests (erfordert jsdom oder Playwright)
10. CI-Pipeline (GitHub Actions) einrichten
11. Code-Coverage-Messung via `c8` oder `node --test --experimental-test-coverage`
12. ESLint + Prettier einrichten

---

## 6. Coverage-Ziele

| Metrik | Aktuell (geschätzt) | Ziel Phase 1 | Ziel Phase 3 |
|--------|---------------------|---------------|---------------|
| Funktionsabdeckung | ~15% | 50% | 80% |
| Zeilenabdeckung | ~8% | 40% | 70% |
| Branchabdeckung | ~5% | 30% | 60% |
| Kritische Pfade | ~40% | 90% | 95% |

**Coverage messen:**
```bash
node --test --experimental-test-coverage tests/**/*.test.mjs
```

---

## 7. Test-Konventionen

### Dateistruktur

```
tests/
├── fixtures/
│   ├── runs/           # Bestehende Run-Fixtures
│   ├── api-responses/  # Mock-Antworten für API-Tests (NEU)
│   └── cache-seeds/    # Vorbefüllte SQLite-DBs (NEU)
├── beatport-scanner.test.mjs      (bestehend)
├── unified-integrations.test.mjs  (bestehend)
├── scanner-core.test.mjs          (NEU)
├── sqlite-cache.test.mjs          (NEU)
├── auth.test.mjs                  (NEU)
├── xhr-scanner.test.mjs           (NEU)
├── api-clients.test.mjs           (NEU)
├── export-formats.test.mjs        (NEU)
├── ipc-handlers.test.mjs          (NEU)
└── smoke-app-bundle.test.mjs      (NEU)
```

### Namenskonvention

Alle Testdateien enden auf `.test.mjs` — kompatibel mit dem bestehenden Glob-Pattern in `package.json`: `node --test tests/**/*.test.mjs`.

### Temporäre Dateien

Jeder Test, der Dateisystem-Zugriff braucht, erstellt sein eigenes Temp-Verzeichnis via `fs.mkdtemp()` und räumt es nach Möglichkeit auf. Kein Test schreibt in das Projekt-Verzeichnis.

### Keine externen Test-Frameworks

Das Projekt nutzt bewusst `node:test` + `node:assert/strict`. Dabei bleiben — keine Migration zu Jest, Vitest etc. nötig. Vorteile: keine Abhängigkeit, schneller Start, Electron-kompatibel.

---

## 8. Refactoring-Empfehlungen für Testbarkeit

### Hohe Priorität

1. **IPC-Handler extrahieren:** Die ~50 `ipcMain.handle()`-Aufrufe in `main.mjs` in ein eigenes Modul verschieben. Dann können Handler ohne Electron-Window getestet werden.

2. **SessionManager-Logik trennen:** Die reine Entscheidungslogik (Cookie-Validierung, Partition-Auswahl) von Electron-`session`-API entkoppeln.

3. **HTTP-Clients injizierbar machen:** `BeatportXhrClient`, `LexiconClient` und `DjplaylistsClient` sollten eine `fetch`-Funktion als Parameter akzeptieren statt `globalThis.fetch` direkt zu nutzen.

### Mittlere Priorität

4. **cdp-scanner.mjs aufteilen:** Mit 4.926 Zeilen ist diese Datei zu groß. Empfehlung: Run-Management, Normalisierung und Export in eigene Module.

5. **Renderer-Code modularisieren:** `app.js` (2.566 LOC) enthält UI-Logik und Geschäftslogik gemischt. Die Geschäftslogik in testbare Module auslagern.

---

## 9. Backup-Strategie für Test-Artefakte

Da dieses Repository kein GitHub-Remote hat (siehe CLAUDE.md), ist folgendes Backup besonders wichtig:

```bash
# Remote einrichten (einmalig)
gh repo create RVH3000/beatport-dj-suite --private --source=. --push

# Vor größeren Test-Änderungen
git stash
git checkout -b testing-strategy
# Tests schreiben...
git add tests/
git commit -m "test: neue Testing-Strategie Phase 1"
git push -u origin testing-strategy
```

Test-Fixtures (SQLite-Seeds, Mock-Responses) gehören ins Repository — sie sind klein und reproduzierbar.

---

## 10. npm-Scripts-Erweiterung

Empfohlene Ergänzungen in `package.json`:

```json
{
  "scripts": {
    "test": "node --test tests/**/*.test.mjs",
    "test:coverage": "node --test --experimental-test-coverage tests/**/*.test.mjs",
    "test:smoke": "node --test tests/smoke-app-bundle.test.mjs",
    "test:unit": "node --test tests/scanner-core.test.mjs tests/sqlite-cache.test.mjs tests/auth.test.mjs tests/xhr-scanner.test.mjs tests/api-clients.test.mjs tests/export-formats.test.mjs",
    "test:integration": "node --test tests/ipc-handlers.test.mjs tests/unified-integrations.test.mjs",
    "check": "node scripts/check-scanner.mjs"
  }
}
```

---

## Zusammenfassung

Die bestehende Testsuite ist solide für den Scanner-Kern, lässt aber ~85% des Codes ungetestet. Die größten Risiken liegen bei der IPC-Schicht (main.mjs), dem SQLite-Cache und der Session-Verwaltung. Durch die vorgeschlagene 3-Phasen-Strategie lässt sich die Abdeckung innerhalb von 4-6 Wochen auf ein produktionstaugliches Niveau bringen, ohne externe Abhängigkeiten einführen zu müssen.
