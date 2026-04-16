# Ralph-Loop Brief — Beatport-Merge

**Ziel:** Die drei Schritte aus `simplifier-critique.md` §5 autonom abarbeiten, kleine Commits, keine Grossaktionen.

**Working Directory:** `~/Projects/_local/beatport-dj-suite.worktrees/merge-analysis/`
**Branch:** `merge-analysis`
**Basis-Branch:** `v4` (bei Zweifeln: mergen, nicht rebasen)

## Defaults (bereits entschieden)

Die drei offenen Fragen aus Simplifier §6 sind beantwortet fuer den Loop:

1. **Fuzzy-Dupes Workflow:** **Lese-Modus**. Nur Anzeige der Duplikat-Gruppen, kein "aus Playlist entfernen"-Button. IPC-Write-Handler werden NICHT implementiert. Nutzer kann Duplikate manuell in den bestehenden Tabs behandeln.
2. **Dramaturgie-Score:** **1:1 portieren** aus PL WIZ v5. Blackbox, kein Refactor, JSDoc-Tag `@experimental`. Validierung kommt spaeter per Hoertest, nicht im Loop.
3. **beatport-dedupe:** **Direkt archivieren** nach 5-Min-Blick. Falls dort Logik ueber WIZ hinausgeht → abbrechen und User fragen. Sonst: `gh repo archive`.

## Iterations-Regel

Jede Loop-Iteration folgt strikt diesem Muster:

1. **Orientierung** (max. 3 Min): `git status`, `git log -5 --oneline`, pruefe welcher Schritt aktiv ist
2. **Ein kleiner Fortschritt**: genau EINE konkrete Datei-Aenderung oder eine konkrete Recherche. Kein "mehrere Dinge gleichzeitig".
3. **Verifikation**: wenn Code geaendert → Datei lesen, Syntax pruefen. Wenn moeglich `npm run test` oder `node --check`.
4. **Commit**: sofort committen mit sprechender Nachricht. Kein "WIP"-Sammeln ueber mehrere Iterationen.
5. **Status-Notiz**: eine Zeile an `.agents/merge-analysis/loop-log.md` anhaengen: `YYYY-MM-DD HH:MM | Schritt X | <was gemacht>`
6. **Weiter oder Pause**: wenn Schritt abgeschlossen → zum naechsten. Wenn blockiert → im Log vermerken und Loop beenden.

## Schritte (verbindliche Reihenfolge)

### Schritt 1 — Fuzzy-Duplikat-Finder (Lese-Modus)

Ziel: Neuer Sub-Tab in "Analyse" zeigt Cross-Playlist-Duplikat-Gruppen via Fuzzy-Matching.

Arbeits-Iterationen (Richtwerte, kein Muss):

1.1 Lese `PL WIZ v5` HTML-Datei, extrahiere Fuzzy-Matching-Logik (Levenshtein + Name-Normalisierung). Notiere Code-Snippet in `.agents/merge-analysis/extracted/fuzzy-matcher-original.js`.

1.2 Erstelle `electron-app/integrations/duplicate-finder.mjs` mit Funktionen:
- `normalize(name)` — lowercase, trim, special-chars raus
- `similarity(a, b)` — Levenshtein-basiert, 0-1
- `groupDuplicates(tracks, threshold=0.85)` — gibt Array von Gruppen zurueck

1.3 Performance-Vorfilter: BPM-Bucket (±5%) VOR Levenshtein. Naives O(n²) auf 99k Tracks waere zu langsam.

1.4 IPC-Handler in `electron-app/main.mjs`: `duplicates:fuzzy-scan` (READ-ONLY, nimmt threshold, gibt Gruppen zurueck).

1.5 Preload-Bridge in `electron-app/preload.mjs` fuer den Handler.

1.6 Neuer Sub-Tab in `electron-app/renderer/tabs/analysis.js`: "Duplikate (Fuzzy)". Liste von Gruppen, pro Gruppe die Tracks mit BPM/Key/Playlist-Herkunft.

1.7 HTML-Anker in `electron-app/renderer/index.html` fuer den Sub-Tab.

1.8 CSS-Styling minimal halten — bestehendes Cockpit-Grid reicht.

1.9 Manueller Smoke-Test: Mit echter `scoring-data.json` starten, Fuzzy-Scan ausloesen, Ergebnis visuell pruefen. Keine Unit-Tests erforderlich.

1.10 Ein abschliessender Commit `feat(analysis): Fuzzy-Duplikat-Finder (Lese-Modus)` wenn Sub-Tab lauffaehig ist.

Exit-Criteria Schritt 1: App startet, Sub-Tab laedt, Fuzzy-Scan gibt mindestens eine bekannte Duplikat-Gruppe zurueck.

### Schritt 2 — Camelot + Dramaturgie + BPM-Normalize

Ziel: Ein File mit drei Pure-Functions, Hooks in Builder und Search.

Arbeits-Iterationen:

2.1 Lese `PL WIZ v5` HTML, extrahiere Camelot-Wheel-Mapping + `dramaScore()` + BPM-Normalize-Logik.

2.2 Erstelle `electron-app/integrations/camelot-dramaturgy.mjs` mit Exporten:
- `toCamelot(key: string): string` — "A minor" → "8A"
- `adjacency(a: string, b: string): number` — 0 (Clash) bis 1 (gleich/adjacent)
- `dramaScore(bpm: number, camelot: string): number` — 0-100 (experimentell)
- `normalizeBpm(bpm: number): number` — 80er × 2, 170er ÷ 2

2.3 Hook in `electron-app/renderer/components/playlist-builder.js`: farbiger Badge pro Track (rot ≥75 / orange ≥50 / cyan <50).

2.4 Hook in `electron-app/renderer/tabs/search.js`: BPM-Filter ruft `normalizeBpm()` on-the-fly auf.

2.5 Smoke-Test: Playlist mit 10 bekannten Tracks laden, Farben pruefen. BPM-Filter mit 80/165 testen.

Exit-Criteria Schritt 2: Badges sichtbar im Builder. BPM-Filter normalisiert.

### Schritt 3 — Legacy archivieren

3.1 Check `~/Projects/_local/beatport-dedupe/` — was ist da? Wenn mehr als Duplikat-Fingerprinting: User fragen. Wenn nicht: weiter.

3.2 `gh repo archive RVH3000/beatport-playlist-scanner --yes` — README vorher updaten mit Verweis auf Nachfolger.

3.3 `Beatport PL WIZ` HTML-Datei in `~/Projects/_local/beatport-dj-suite/legacy/pl-wiz-v5.html` ablegen (als Referenz).

3.4 `beatport-dedupe` archivieren oder loeschen (User-Abhaengig).

Exit-Criteria Schritt 3: Alle drei Legacy-Quellen haben einen klaren Endstatus.

## Abbruch-Kriterien

Loop bricht ab und hinterlaesst Status-Notiz, wenn:

- Ein Build/npm-Befehl fehlschlaegt und Root-Cause nicht in 2 Iterationen zu finden ist
- User-Entscheidung noetig ist, die nicht in den Defaults abgedeckt ist
- Git-Konflikt auftritt (kein Auto-Resolve)
- `git status` zeigt unerwartete Dateien (mehr als 10 untracked beyond bekannter Liste)

## Wichtige Schutz-Regeln

- **NIEMALS `git push --force`** auf v4 oder main
- **NIEMALS** in `electron-app/integrations/python/*.py` neue Features (siehe Strategie: Python einfrieren)
- **NIEMALS** in `main.mjs` mehr als 50 Zeilen ohne vorherige Extraktions-Ueberlegung hinzufuegen
- **IMMER** commits auf `merge-analysis`-Branch, nicht direkt auf v4
- **IMMER** bestehende DB-Schemata respektieren (keine neuen Spalten im ersten Wurf, siehe Simplifier)
