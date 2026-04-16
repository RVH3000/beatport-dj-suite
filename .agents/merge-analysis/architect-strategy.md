# Merge-Strategie: beatport-dj-suite v5

**Erstellt:** 2026-04-16
**Basis:** Explorer-Reports 01/02/03
**Ziel-Version:** v5.0.0 (oder v4.5.0 — siehe Abschnitt 5)

---

## 1. Executive Summary

Das Haupttool (v4) hat bereits den Kern beider Legacy-Tools integriert. Der Merge ist kein Neuschreiben, sondern eine gezielte Feature-Ernte aus zwei Quellen plus ein Infrastruktur-Aufraeumen.

**Top-3-Gewinne:**
1. Cross-Playlist Fuzzy-Duplikat-Finder aus PL WIZ v5 schliesst eine echte Luecke (Haupttool hat nur exaktes Matching)
2. Dramaturgie-Score (BPM+Camelot) und BPM-Normalisierung machen den Playlist-Builder erheblich nuetzlicher
3. Delta-Discovery-Baseline und Datenquellen-Provenance aus Scanner v1.5.1 festigen die Scanner-Stabilitaet

**Top-3-Risiken:**
1. PL WIZ v5 DOM-State-Kopplung — Portierung ohne sauberes State-Objekt erzeugt Tech-Debt
2. Python-Dependency-Growth — jeder neue Engine-Feature zieht `engine_tools.py` weiter auf, langfristig Wartungsrisiko
3. `renderTable()`-Duplikat in `engine-analyze.js` ist aktuell ein stiller Blocker: neue Tab-Patterns werden inkonsistent, wenn das nicht vorher gefixt wird

**Reihenfolge (grob):**
Infrastruktur stabilisieren → Scanner-Features portieren → WIZ-Algorithmen portieren → UI-Integration → Legacy archivieren

---

## 2. Ziel-Architektur

### Ordnerstruktur (Aenderungen gegenueber v4)

```
electron-app/
├── main.mjs                         (unveraendert, IPC-Handler erweitert)
├── preload.mjs                      (unveraendert)
├── renderer/
│   ├── app.js                       (REFACTOR: renderTable + sort-locks als shared Export)
│   ├── index.html                   (neuer Tab "Analyse" Sub-Tabs)
│   ├── components/
│   │   ├── playlist-builder.js      (ERWEITERT: Dramaturgie-Score + BPM-Normalize)
│   │   └── camelot-wheel.js         (NEU: aus WIZ v5 portiert, shared)
│   └── tabs/
│       ├── analysis.js              (ERWEITERT: neuer Sub-Tab "Duplikate Fuzzy")
│       ├── engine-analyze.js        (REFACTOR: shared renderTable nutzen)
│       ├── search.js                (ERWEITERT: BPM-Normalisierung in Filter)
│       └── [bestehende unberuehrt]
├── scanner/
│   ├── cdp-scanner.mjs              (ERWEITERT: Delta-Baseline, Provenance-Tags)
│   ├── run-store.mjs                (ERWEITERT: source-Metadaten pro Track)
│   └── [xhr-scanner, legacy-migrator unveraendert]
├── integrations/
│   ├── duplicate-finder.mjs         (NEU: Fuzzy-Matching aus WIZ v5)
│   ├── dramaturgie-scorer.mjs       (NEU: BPM+Camelot Score-Algorithmus)
│   ├── engine-analyze-matcher.mjs   (unveraendert)
│   └── python/                      (unveraendert, kein Ausbau ohne Entscheidung)
├── analysis/
│   └── filter-engine.mjs            (NEU: Query-Builder, BPM-Normalisierung)
└── utils/
    ├── common.mjs                   (unveraendert)
    └── sort-locks.mjs               (NEU: aus search.js extrahiert, shared)
```

Entfernt werden: keine Dateien in v4. Legacy-Repos werden archiviert, nicht geloescht.

### Plugin-System

Nicht weiterverfolgen. Der Plugin-Scaffold (`.mcp.json`, `plugins/`) bleibt Placeholder. Der Aufwand, Scanner/WIZ als isolierte Electron-Plugins einzubinden, uebersteigt den Nutzen bei einem Single-User-Tool. Entscheidung in Abschnitt 5 bestaetigen lassen.

### Python-Komponente

Einfrieren auf aktuellem Stand. `engine_tools.py` und `merge_engine_scoring.py` bleiben unveraendert. Keine neuen Features in Python hinzufuegen. PerformanceData-BLOB-Decoder bleibt Python-only — das ist akzeptabel solange kein Node-nativer SQLite-BLOB-Parser verfuegbar ist. Node-Migration als optionale spaetere Phase, kein Blocker.

### Datenmodell

Einheitliches Track-Schema in SQLite (`suite.db`). Beide Quell-Schemata werden beim Import normalisiert:

```
Track {
  id            INTEGER PRIMARY KEY
  title         TEXT
  artist        TEXT
  bpm           REAL          -- raw, unnormalized
  bpm_normalized REAL         -- nach BPM-Normalisierung (80×2, 170÷2)
  key           TEXT          -- "Camelot" format z.B. "8A"
  genre         TEXT
  sub_genre     TEXT
  label         TEXT
  release_year  INTEGER
  plays         INTEGER
  rating        INTEGER
  source        TEXT          -- "xhr|route|dom"
  drama_score   REAL          -- 0-100, nullable (erst nach Scoring)
  playlist_ids  TEXT          -- JSON-Array (denormalisiert fuer Performance)
}

Playlist {
  id            INTEGER PRIMARY KEY
  name          TEXT
  server_count  INTEGER
  user_count    INTEGER
  last_run_id   TEXT
}

Duplicate {
  id            INTEGER PRIMARY KEY
  track_a_id    INTEGER
  track_b_id    INTEGER
  similarity    REAL          -- 0-1, Levenshtein-Score
  match_type    TEXT          -- "exact|fuzzy"
  status        TEXT          -- "candidate|confirmed|ignored"
}
```

Der WIZ-abgekuerzte Schemata (`{i, t, m}`) wird beim Import in dieses Schema uebersetzt. Scanner v1.5.1 `{id, title, artist}` passt bereits.

---

## 3. Merge-Inventar

| Feature | Herkunft | Ziel-Datei | Aufwand | Abhaengigkeit | Risk |
|---------|----------|-----------|---------|--------------|------|
| Track-Fingerprint Duplikat-Logik (zweistufig) | Scanner v1.5.1 `tools/beatport_cdp_tool.mjs` | `integrations/duplicate-finder.mjs` (erweiterbar) | S | keiner | niedrig |
| Delta-Discovery mit Run-Baseline (`resolveDiscoveryBaseline()`) | Scanner v1.5.1 `tools/beatport_cdp_tool.mjs` | `scanner/cdp-scanner.mjs` | M | Provenance-Tags zuerst | mittel |
| Pausierbare Run-Controls (`RUN_CONTROLS`-Map) | Scanner v1.5.1 `tools/beatport_cdp_tool.mjs` | `scanner/cdp-scanner.mjs` | S | keiner | niedrig |
| Datenquellen-Provenance (`source: xhr/route/dom`) | Scanner v1.5.1 `tools/beatport_cdp_tool.mjs` | `scanner/run-store.mjs` + DB-Schema | S | DB-Schema-Migration | niedrig |
| Test-Fixtures (Legacy-Migration) | Scanner v1.5.1 `tests/beatport-scanner.test.mjs` | `tests/scanner.test.mjs` (adaptiert) | S | keiner | niedrig |
| Cross-Playlist Fuzzy-Duplikat-Finder | PL WIZ v5 (inline, ~200 LoC geschaetzt) | `integrations/duplicate-finder.mjs` | M | State-Objekt-Refactor WIZ | mittel |
| Dramaturgie-Score (`dramaScore()`) | PL WIZ v5 (inline) | `integrations/dramaturgie-scorer.mjs` | S | Camelot-Wheel | niedrig |
| BPM-Normalisierung (80→×2, 170→÷2) | PL WIZ v5 (inline) | `analysis/filter-engine.mjs` | S | keiner | niedrig |
| Camelot-Wheel-Mapping | PL WIZ v5 (inline) | `renderer/components/camelot-wheel.js` | S | keiner | niedrig |
| Multi-Lock-Sortierung | PL WIZ v5 (inline) | `utils/sort-locks.mjs` | M | `renderTable()` Refactor | mittel |
| Jahres-Timeline Sparklines | PL WIZ v5 (inline) | `renderer/tabs/analysis.js` | M | Duplikat-Finder zuerst | niedrig |
| Artist-Genre-Cards (Dashboard) | PL WIZ v5 (inline) | `renderer/tabs/analysis.js` | M | unified Track-Schema | niedrig |

Aufwand: S = < 4h, M = 4-16h, L = > 16h

---

## 4. Implementierungs-Phasen

### Phase 0 — Infrastruktur-Stabilisierung (Blocker-Clearing)

**Ziel:** Geteilte Helfer existieren, bevor neue Features einhaken.

Dateien:
- ERSTELLEN `electron-app/utils/sort-locks.mjs` — Sort-Lock-Logik aus `renderer/tabs/search.js` extrahieren
- REFACTOR `electron-app/renderer/app.js` — `renderTable()` als named export verfuegbar machen, Engine-Analyze importiert es dann
- REFACTOR `electron-app/renderer/tabs/engine-analyze.js` — eigenes `renderTable()` entfernen, shared nutzen
- ERSTELLEN `electron-app/analysis/filter-engine.mjs` — BPM-Normalisierung, Query-Builder-Stub

Tests: `renderTable()` muss exakt gleiche DOM-Ausgabe wie vorher erzeugen. Vorher/Nachher-Screenshot-Vergleich der Library-Tab-Ansicht genuegt.

Exit-Criteria: `engine-analyze.js` und `search.js` nutzen beide `renderTable` aus `app.js`. Keine Duplikat-Logik mehr.

---

### Phase 1 — Camelot + Algorithmen (Quick-Wins aus WIZ)

**Ziel:** Die drei unabhaengigen WIZ-Algorithmen als isolierte Module im Haupttool verfuegbar machen.

Dateien:
- ERSTELLEN `electron-app/renderer/components/camelot-wheel.js` — Mapping aus WIZ v5 HTML-File extrahieren (Camelot-Parsing, Adjacent-Logik)
- ERSTELLEN `electron-app/integrations/dramaturgie-scorer.mjs` — `dramaScore(bpm, camelot)` portieren, "experimental" JSDoc-Tag
- ERWEITERN `electron-app/analysis/filter-engine.mjs` — BPM-Normalisierung implementieren
- ERWEITERN `electron-app/renderer/components/playlist-builder.js` — Dramaturgie-Score pro Track anzeigen (farbige Badges wie in WIZ: rot/orange/cyan)

Tests: Unit-Test `dramaturgie-scorer.test.mjs` mit 5-10 bekannten BPM/Key-Paaren und erwarteten Score-Bereichen. Camelot-Wheel: alle 24 Positionen gegen bekanntes Mapping pruefen.

Exit-Criteria: Playlist-Builder zeigt Dramaturgie-Farbbadges. BPM-Filter normalisiert automatisch. Tests gruen.

---

### Phase 2 — Scanner-Stabilitaet (Features aus v1.5.1)

**Ziel:** Robustere Scanner-Infrastruktur.

Dateien:
- ERWEITERN `electron-app/scanner/cdp-scanner.mjs` — `resolveDiscoveryBaseline()` integrieren (Delta-Sync mit Run-Vergleich)
- ERWEITERN `electron-app/scanner/run-store.mjs` — `source`-Feld (`xhr|route|dom`) pro Track persistieren
- DB-MIGRATION `electron-app/cache/sqlite-cache.mjs` — `source`-Spalte zu Track-Tabelle, `bpm_normalized`-Spalte
- ADAPTIEREN `tests/scanner.test.mjs` — Fixtures aus `beatport-scanner/tests/beatport-scanner.test.mjs` portieren

Tests: Delta-Sync-Test: zwei aufeinanderfolgende Test-Runs, zweiter Run enthaelt Subset. Erwartung: nur Delta wird verarbeitet.

Exit-Criteria: Scanner meldet korrekte Delta-Groesse bei Folge-Scan. Provenance-Tags sichtbar in Library-Tab.

---

### Phase 3 — Fuzzy-Duplikat-Finder (Hauptgewinn aus WIZ)

**Ziel:** Cross-Playlist Fuzzy-Matching als neuer Sub-Tab in Analyse.

Dateien:
- ERSTELLEN `electron-app/integrations/duplicate-finder.mjs` — Levenshtein-basiertes Fuzzy-Matching (Name+Artist), Schwellenwert konfigurierbar, Cross-Playlist-Gruppierung
- ERWEITERN `electron-app/renderer/tabs/analysis.js` — Sub-Tab "Duplikate (Fuzzy)" mit Gruppen-Anzeige, Bestaetigungs-/Ignorier-Aktionen
- ERWEITERN `electron-app/main.mjs` — IPC-Handler `duplicates:fuzzy-scan` + `duplicates:set-status`
- ERWEITERN `electron-app/cache/sqlite-cache.mjs` — `Duplicate`-Tabelle mit `similarity` + `match_type`-Spalten

Performance: Levenshtein ueber 99k Tracks naiv = O(n²). Strategie: erst nach BPM-Bucket (±5%) vorfiltern, dann nur innerhalb Bucket fuzzy-matchen. Async mit Progress-Callback.

Tests: Fixture-Set mit 20 bekannten Duplikat-Paaren (verschiedene Schreibweisen). Erwartete Trefferquote > 90%.

Exit-Criteria: Fuzzy-Scan laeuft durch ohne UI-Freeze. Bekannte Duplikate werden gefunden. Status (confirmed/ignored) wird gespeichert.

---

### Phase 4 — Dashboard-Erweiterungen (Nice-to-Have aus WIZ)

**Ziel:** Analyse-Tab mit Jahres-Timeline und Artist-Cards anreichern.

Dateien:
- ERWEITERN `electron-app/renderer/tabs/analysis.js` — Jahres-Timeline-Sparkline, Artist-Genre-Cards
- ERWEITERN `electron-app/renderer/index.html` — Chart-Container

Abhaengigkeit: Phasen 0-3 abgeschlossen, unified Track-Schema vorhanden.

Exit-Criteria: Analyse-Tab zeigt Timeline und Cards mit echten Daten aus `scoring-data.json`.

---

### Phase 5 — Cleanup und Archivierung

**Ziel:** Legacy-Repos sauber archivieren.

- `beatport-scanner` Repo: README-Update ("archiviert, Nachfolger: beatport-dj-suite"), GitHub-Archivierung
- `Beatport PL WIZ` HTML-Datei: in `_archive/` verschieben oder in Repo-Unterordner `legacy/`
- `beatport-dedupe` Repo: pruefen ob alle Features in Phase 3 abgedeckt, dann archivieren
- `electron-app/scanner/legacy-migrator.mjs`: nach v1.0.x-Daten-Uebergang behalten, aber kein weiterer Ausbau

---

## 5. Entscheidungen, die der User treffen muss

1. **Versionsnummer:** v4.5.0 (inkrementell, kein Breaking-Change) oder v5.0.0 (Marketing-Signal fuer vollstaendigen Merge)? Empfehlung: v5.0.0 nur wenn DB-Schema-Migration einen Breaking-Change erzwingt.

2. **Plugin-System:** Den bestehenden Plugin-Scaffold (`.mcp.json`, `plugins/`) weiterverfolgen oder dauerhaft als Placeholder belassen und Ressourcen sparen? Empfehlung: Belassen, nicht weiterverfolgen.

3. **Python einfrieren oder migrieren:** `engine_tools.py` (77 KB, 11 Subcommands) einfrieren (kein Ausbau) oder mit Node.js-Migration beginnen? Node-Migration ist L-Aufwand, kein kurzfristiger Gewinn.

4. **`beatport-dedupe`-Repo:** Wurde im Merge-Inventar nicht explizit analysiert (kein Explorer-Report). Vor Phase 3 pruefen ob dort Logik existiert, die ueber WIZ v5 hinausgeht. Dann entscheiden: direkt archivieren oder als Quelle fuer Phase 3 nutzen.

5. **Dramaturgie-Score-Validierung:** Algorithmus in WIZ v5 ist "unklar dokumentiert". Akzeptabel als experimentelles Feature taggen und spaeter validieren — oder zuerst Algorithmus mit echter DJ-Expertise pruefen bevor es in den Builder kommt?

6. **Phase-0-Timing:** `renderTable()`-Refactor als harten Blocker behandeln (Phase 0 muss vor allem anderen abgeschlossen sein) oder parallel zu Phase 1 erlauben (Risiko: kurzfristig zwei Implementierungen im Code)?

---

## 6. Anti-Patterns — Was NICHT uebernehmen

Aus Scanner v1.5.1:
- **v1.0.x Schema-Migration** (`legacy-migrator.mjs` Pattern): Das existierende Modul im Haupttool reicht. Keine weitere Rueckwaerts-Kompatibilitaet zu alten Scanner-Daten.
- **External Fallback CDP-Mode** (Chromium/Helium auf `dj.beatport.com`): Zu fragil, Beatport-seitige Aenderungen brechen diesen Pfad staendig.
- **DOM-Scraping Fallback** (MutationObserver fuer Duplikat-Markierung): Brittle, kein stabiler Contract.
- **`beatport_duplicates_state.json`** Legacy-State-Datei: Nicht weiteruebertragen, SQLite ist die Wahrheitsquelle.
- **Electron-Profil-Management mit Keychain** (Partition `persist:beatport-auth-v1`): Haupttool nutzt moderne Session-Verwaltung, nicht zurueckrudern.

Aus PL WIZ v5:
- **Iframe-Integration**: Isoliert localStorage, verhindert IPC, schafft CSS-Kollisionen. Nicht tun.
- **Inline-JSON (q1-q7 hardcoded)**: Alle Daten kommen aus SQLite, keine hardcodierten Datensaetze in den Renderer.
- **`localStorage` als State-Backend**: Electron-Apps nutzen IPC + SQLite. WIZ-localStorage-Aufrufe werden vollstaendig ersetzt.
- **Globale DOM-IDs als State** (`getElementById('plList')` etc.): Refactor zu State-Objekt ist Pflicht, kein Optional.
- **Print-CSS als Export-Strategie**: Im Electron-Kontext steht echter PDF-Export via `webContents.print()` zur Verfuegung.

Generell:
- Kein weiteres Wachstum von `main.mjs` (bereits 1915 LoC): Neue IPC-Handler in separate Handler-Module extrahieren statt direkt in main.mjs anhaengen.
- Keine neuen Tabs ohne vorher Phase 0 abzuschliessen: UI-Inkonsistenz akkumuliert sich sonst weiter.

---

*Strategie-Stand: 2026-04-16. Vor Implementierungsstart Abschnitt 5 mit User klaeren.*
