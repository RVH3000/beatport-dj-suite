# Simplifier-Kritik: Merge-Strategie beatport-dj-suite

**Erstellt:** 2026-04-15
**Basis:** architect-strategy.md + Explorer-Reports 01-03
**Perspektive:** Solo-DJ, kein Team, dokumentierte Overengineering-Abneigung

---

## 1. Bewertung

Die Strategie hat den richtigen Kern: Feature-Ernte aus zwei Quellen statt Neuschreiben. Die Top-3-Gewinne (Fuzzy-Dupes, Dramaturgie-Score, Delta-Baseline) sind korrekt priorisiert. Die Anti-Patterns-Liste (Abschnitt 6) ist praezise.

Sie schiesst aber in drei Punkten ueber das Ziel hinaus:

1. **Sechs Phasen sind zu viel.** Fuer eine Solo-App mit vier konkreten Features ist das Projekt-Management-Overhead.
2. **Neue Ordner `analysis/` und `utils/sort-locks.mjs`** fuegen Struktur hinzu, wo bestehende Dateien reichen. 23.6k LoC im Haupttool rechtfertigen kein neues Unterverzeichnis fuer zwei Funktionen.
3. **Schema-Migration `bpm_normalized` als Spalte** ist unnoetig — Normalisierung ist eine Funktion, kein Feld. Persistieren macht sie zum Wartungsproblem (Recompute bei jedem BPM-Update).
4. **Phase 0 als Hard-Blocker** fuer `renderTable()`-Refactor bremst den einzig echten User-Nutzen (Fuzzy-Dupes) aus. Das ist Technical-Debt-Tourismus.
5. **Unit-Tests fuer `dramaScore()`** und 20-Paar-Fixture-Set sind fuer ein Solo-Tool uebertrieben, solange es keine Regression-Risiken gibt.

Die Strategie ist nicht falsch, nur zu ambitioniert fuer den Kontext.

---

## 2. Streich-Kandidaten

| Vorschlag | Verlust bei Streichung | Empfehlung |
|---|---|---|
| `utils/sort-locks.mjs` als eigene Datei | Null — bleibt in `search.js`, bei Bedarf spaeter extrahieren | **Streichen** |
| `analysis/filter-engine.mjs` als neuer Ordner | Null — BPM-Normalisierung ist eine 5-Zeilen-Funktion, gehoert in `utils/common.mjs` | **Streichen** |
| `bpm_normalized` DB-Spalte | Null — on-the-fly berechnen, keine Migration noetig | **Streichen** |
| `Duplicate`-Tabelle mit `status`-Feld | Gering — im ersten Wurf reicht In-Memory-Gruppierung + JSON-Snapshot | **Vereinfachen**: erst mal keine DB-Persistenz |
| `source`-Feld-Migration in DB | Gering — nuetzlich, aber kein Feature-Blocker | **Verschieben** nach hinten, nicht Phase 2 |
| Test-Fixtures aus Scanner portieren | Gering — Scanner v1.5.1 ist stable, Tests sind Versicherung | **Optional**, nicht Exit-Criteria |
| Unit-Test fuer `dramaturgie-scorer` | Gering — Score ist experimentell, User validiert per Ohr | **Streichen**, als manueller Smoke-Test reicht |
| Phase 4 (Jahres-Timeline, Artist-Cards) | Gering — Nice-to-have, kein klarer User-Pain | **Aufschieben**, nicht Teil des Merges |
| Phase 5 Cleanup als eigene Phase | Null — `git archive` + README-Update ist 15 Minuten | **In Phase 3 einklappen** |
| Versionsnummer-Entscheidung v4.5 vs v5 | Null — Solo-Tool, Version ist nur Marketing fuer sich selbst | **Streichen als Diskussion** |
| Plugin-System-Entscheidung | Null — Architekt sagt selbst "belassen" | **Kein Entscheidungspunkt**, einfach weglassen |

---

## 3. Zusammenlegungs-Kandidaten

- **Phase 0 + Phase 1 zusammenlegen.** `renderTable()`-Refactor nur dann, wenn Phase 1 ihn tatsaechlich braucht. Sonst nachziehen, wenn er stoert. Das ist kein echter Blocker — Engine-Analyze funktioniert seit v4 mit Duplikat.
- **Camelot-Wheel + Dramaturgie-Score + BPM-Normalize in ein Modul.** Alles drei sind reine Funktionen, gehoeren logisch zusammen (WIZ hatte sie auch inline zusammen). Ein File `integrations/camelot-dramaturgy.mjs` reicht, statt drei Dateien in drei Ordnern.
- **Fuzzy-Duplikat-Finder + Analyse-Sub-Tab als eine Phase.** Der Algorithmus ohne UI ist wertlos.
- **Scanner-Provenance + Delta-Baseline nur dann**, wenn der User einen konkreten Scan-Bug hat. Sonst: nicht anfassen, Scanner ist stable.

Ergebnis: **drei Phasen statt sechs.**

---

## 4. Reihenfolge-Kritik

Architekt-Reihenfolge: Infra → Scanner → WIZ → UI → Cleanup.

Das ist klassisch "erst aufraeumen, dann Features" — optimiert fuer Teams, nicht fuer Solo.

**Meine Reihenfolge:**
1. Fuzzy-Duplikat-Finder (groesster User-Nutzen, isoliert, kein Refactor noetig)
2. Camelot/Dramaturgie/BPM-Normalize (algorithmische Quick-Wins, parallel moeglich)
3. Alles andere nur wenn es konkret stoert

Der `renderTable()`-Refactor ist ein echter Wunsch-Kandidat, aber nicht Vorbedingung. `main.mjs` mit 1915 LoC ist nicht schoen, aber funktioniert. Solange kein konkreter Schmerz existiert, nicht anfassen.

**Parallelisierung:** Camelot-Wheel, Dramaturgie-Score und BPM-Normalize sind isolierte Pure-Functions. Koennen an einem Nachmittag gebaut werden, keine Abhaengigkeiten.

**Unnoetiger Blocker:** Phase 0 `renderTable()` als Hard-Gate. Streichen.

---

## 5. "Das wuerde ich so machen"-Vorschlag

### Schritt 1: Fuzzy-Dupes (1 Tag)

- `integrations/duplicate-finder.mjs` neu anlegen: Levenshtein-Funktion + BPM-Bucket-Vorfilter + Cross-Playlist-Gruppierung
- Neuer Sub-Tab in `analysis.js`: Liste von Duplikat-Gruppen, Action-Buttons "ignorieren"/"bestaetigen" (im UI-State, nicht in DB)
- IPC-Handler `duplicates:fuzzy-scan` in `main.mjs` — ja, main.mjs waechst. Ist okay. Extrahieren wenn's wirklich zu viel wird.
- Keine neue DB-Tabelle. Ergebnis als JSON-Snapshot in `~/Library/.../suite-duplicates.json` (oder gar nur In-Memory pro Session).

### Schritt 2: Camelot + Dramaturgie + BPM-Normalize (1 Tag)

- Ein File: `integrations/camelot-dramaturgy.mjs` exportiert `toCamelot(key)`, `adjacency(a, b)`, `dramaScore(bpm, camelot)`, `normalizeBpm(bpm)`.
- Hook in `playlist-builder.js`: Score als farbiger Badge pro Track.
- Hook in `search.js`: BPM-Filter ruft `normalizeBpm()` on-the-fly auf. Keine DB-Aenderung.
- Kein Test-Setup, manueller Smoke-Test: 10 bekannte Tracks in Builder laden, Farben pruefen.

### Schritt 3: Legacy archivieren (30 Minuten)

- `beatport-scanner`: README-Satz "archiviert, Nachfolger beatport-dj-suite", `gh repo archive`.
- `Beatport PL WIZ` HTML: in `legacy/` im Haupttool-Repo ablegen, als Nachschlage-Quelle.
- `beatport-dedupe`: kurz reinschauen (5 Min) — hat es Features jenseits WIZ? Wenn nein, archivieren.

### Bewusst NICHT tun

- Keine DB-Migration (`source`, `bpm_normalized`, `drama_score`-Spalten).
- Keine Provenance-Tags im UI, solange kein Bug dazu zwingt.
- Keine Delta-Baseline-Portierung — das existierende Scannen laeuft.
- Kein `renderTable()`-Refactor, solange kein konkreter UI-Bug daran haengt.
- Keine Jahres-Timeline, keine Artist-Cards. Kann spaeter kommen, wenn Wunsch da ist.
- Keine Versionsnummer-Diskussion. Es ist immer v4.x.

### Definition of Done

Der Merge ist fertig, wenn:
- Fuzzy-Dupes-Tab im Haupttool laeuft und Duplikate findet.
- Playlist-Builder zeigt Dramaturgie-Badges.
- BPM-Filter normalisiert.
- Die zwei Legacy-Repos sind archiviert.

Zeitbudget: 2-3 fokussierte Tage, nicht 2-3 Wochen.

---

## 6. Offene Fragen an den User

Nur drei, nicht sechs:

1. **Fuzzy-Dupes: was ist der Workflow bei einem Treffer?** Nur anzeigen, oder direkt "aus Playlist X entfernen"-Button? Das entscheidet, ob IPC-Write-Handler noetig sind oder reine Lese-UI reicht.

2. **Dramaturgie-Score: soll der WIZ-Algorithmus 1:1 portiert werden (Blackbox, "funktioniert gut genug") oder willst du ihn erst verstehen und evtl. anpassen?** Ersteres ist 2 Stunden, letzteres mehrere Tage inklusive Hoertests.

3. **beatport-dedupe: gibt es dort Logik die ueber WIZ hinausgeht, die du vermissen wuerdest?** Wenn nein, direkt archivieren und nicht analysieren.

Gestrichen aus Architekt-Liste (unnoetig gross):
- Versionsnummer → egal
- Plugin-System → schon entschieden (nicht weiterverfolgen)
- Python einfrieren/migrieren → einfrieren, keine Diskussion noetig
- Phase-0-Timing → keine Phase 0
