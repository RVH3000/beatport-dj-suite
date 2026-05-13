# PLAN — Backlog-Punkt 33: Playlist WIZ (Live) Filter/Sort/Lock-UI

**Status:** Multi-Agent-Cross-Check abgeschlossen, Implementation **pausiert** —
**starke Divergenz zwischen Implementer und Reviewer**, Kontrollraum-Entscheidung
zur Architektur erforderlich.
**Erstellt:** 2026-05-13 (Werkbank, nach Pilot-Punkt 30 und Plan-Punkt 31)
**Goal-Datei:** `.agents/GOAL-2026-05-13-multi-agent-features.md`

---

## Lage in einem Satz

Robert will im Build → Playlist WIZ (Live) Tab dieselbe ausgefeilte
Filter/Sort/Lock-UI haben wie im Explore → Suche & Filter. Code liegt
in `electron-app/renderer/tabs/search.js` (1702 Z., umfangreich). WIZ
hat heute nur einfache Track-Tabelle (`playlist-wiz.js`, 568 Z.).

## Cross-Check: Divergenz

Implementer und Reviewer **stimmen NICHT überein**.

### Implementer-Empfehlung
- **Modul-Extraktion** nach `components/track-filter.js` als
  `TrackFilterComponent`-Klasse, die `search.js`-State kapselt.
- Aufwand: 7-9 h.
- Begründung: `camelotCompat`, `normBpm`, `camelotSortVal` sind heute
  bereits dreifach im Repo dupliziert (search.js, playlist-builder.js,
  drittes Vorkommen) — eine vierte Kopie ist nicht tolerierbar.
- Tag: v4.4.0.

### Reviewer-Empfehlung (adversarial)
- **Inkrementell** mit nur Pure-Funktionen-Extraktion nach
  `electron-app/renderer/lib/track-utils.js`.
- Aufwand: deutlich kleiner, Phasen-basiert (Phase 1: Sort + Genre +
  BPM-Range; Phase 2 später Lock/Timeline/Pagination).
- Confidence: **hoch** dass Modul-Extraktion ohne State-Refactor scheitert.
- Begründung-Sammlung:
  - **search.js hat 30+ Funktionen die globale Module-Scope-State
    mutieren** (`allTracks`, `lockedSorts`, `sortScope`, `currentPage`,
    `_distributedPages`, `selectedIds`). Eine Klassen-Kapselung ist
    faktisch eine Neuschreibung der Datei.
  - **0 automatisierte Tests** für `search.js` (Grep nach `*search*test*`
    ergibt nichts). Ein 1200-Zeilen-Refactor ohne Sicherheitsnetz ist
    Russisch Roulette.
  - **`.srch-*`-CSS-Klassen 144x in styles.css verankert**, Rename auf
    `.tf-*` wäre nochmal massiver Diff über mehrere Dateien.
  - **Robert hat heute zwei Beinahe-Unfälle erlebt** (asar extract-file
    Beinahe-Unfall in v4.3.0, Arrow-Function-Block-Style fehlendes `}`
    in v4.3.2). Bei 8-Zeilen-Diffs schon Fehler — bei 1200 Zeilen?
  - **Robert sagt Explore „funktioniert sehr sehr gut"** — Regression
    wäre netto-negativ.

## Konvergente Pflicht-Conditions (beide Agents)

Vor JEDEM Code-Schritt:

1. **WIZ-Track-Schema verifizieren.** Beide Agents identifizieren das
   als kritisch. Schema-Annahme aus Render-Code: WIZ-Tracks haben nur
   `trackId, title, mixName, artists, genre, bpm, key, label` (8 Felder).
   Explore-Tracks haben 18+ Felder (zusätzlich: `camelot, year,
   sub_genre, drama, plays_total, rating, count, is_hype, is_dj_edit,
   bpmNorm, length_ms, sample_url, release, file_path, comment`).
   **Filter über fehlende Felder werden lautlos kaputt sein.**

   Verifikation: in der laufenden 4.3.2-App DevTools öffnen
   (`Cmd+Option+I`), WIZ-Tab → Playlist auswählen, Konsole:
   ```js
   window.playlistApi.tracks(7468266).then(r =>
     console.log(JSON.stringify(r[0], null, 2)))
   ```
   Resultierende JSON-Struktur zeigt verfügbare Felder.

2. **Schemadiskussion mit Beatport-API klären.** Falls bestimmte Felder
   fehlen aber von der API verfügbar wären (`camelot`, `year`, `genre`,
   `sub_genre`): IPC-Handler `playlistApi.tracks` müsste erweitert werden,
   um die Felder durchzureichen.

3. **Architektur-Entscheidung** durch Kontrollraum: Implementer-Modul-
   Extraktion oder Reviewer-Inkrementell? (Siehe Werkbank-Empfehlung
   unten.)

## Werkbank-Empfehlung (an Kontrollraum)

**Reviewer-Empfehlung (Inkrementell) annehmen.** Drei harte Argumente:

1. **Test-Lücke** ist faktisch + nicht überwindbar in der Pilot-Session.
   Eine Refactor-Operation auf 1700 Zeilen ohne automatisierte Tests
   ist eine schlechte Wette.
2. **Diff-Größe** wurde heute in zwei Fällen unterschätzt. Auch
   8-Zeilen-Diffs hatten Fehler. 1200-Zeilen-Diff erhöht die
   Fehlerwahrscheinlichkeit überproportional.
3. **„Funktioniert sehr sehr gut"** ist der höchste Wert. Regression
   wäre der Pilot-Tod für das Multi-Agent-Pattern.

**Inkrementelle Schritte** in dieser Reihenfolge:

### Phase 1 — Pure-Funktionen-Lib (v4.3.3, ~1h)
- Neue Datei `electron-app/renderer/lib/track-utils.js`
- Extrahiere nur **state-freie Funktionen** aus search.js Z.42-97:
  `normBpm`, `bpmDisplay`, `camelotSortVal`, `camelotCompat`,
  `dramaScore`, `dramaColor`. Diese sind heute in search.js,
  playlist-builder.js und noch einem dritten Ort dupliziert.
- 5 Unit-Tests für die Pure-Funktionen (auf `tests/track-utils.test.mjs`).
- search.js + playlist-builder.js refactorn: Imports statt Inline-Code.
- Diff-Größe: ~150 Zeilen, kontrolliert.
- Tag: **v4.3.3** (Patch — kein neues Feature, nur DRY-Refactor).

### Phase 2 — WIZ-Track-Schema verifizieren (v4.3.4, ~30 Min)
- DevTools-Inspektion (Pflicht-Condition 1).
- Falls Felder fehlen: IPC-Handler `playlistApi.tracks()` in `main.mjs`
  erweitern um die Felder durchzureichen.
- Tests + Build.
- Tag: **v4.3.4** (Patch — IPC-Erweiterung).

### Phase 3 — WIZ einfache Filter (v4.4.0, ~2h)
- In `playlist-wiz.js` direkt einbauen (keine Modul-Extraktion):
  - Sort-Dropdown (Title, Artist, BPM, Key, Label)
  - Genre-Filter (Single-Select, basierend auf in der Playlist
    vorkommenden Genres)
  - BPM Min/Max Slider
  - Text-Suche im Track-Titel
- Wiederverwendung der Pure-Funktionen aus Phase 1.
- Neue CSS-Klassen `.wiz-filter-*` (kein Rename von `.srch-*`).
- Tag: **v4.4.0** (Minor — neue Tab-Funktion).

### Phase 4 — Erweiterte WIZ-Filter (v4.4.x, ~3h)
- Camelot-Filter (falls Schema vorhanden)
- Dramaturgie/Drama-Filter (falls vorhanden)
- Lock-System für mehrstufige Sortierung
- Track-Timeline-Visualisierung (BPM/Key-Match/Drama-Balken)
- Wildcards und BPM-Norm-Toggle
- Tag: **v4.4.1** oder weitere Patches.

### Phase 5 — Konsolidierung (v4.5.0, optional)
- Falls Phasen 3 und 4 funktionieren UND echte Code-Duplikation messbar
  ist (z.B. 300+ Zeilen doppelt): dann Modul-Extraktion als eigener
  Refactor-Patch.
- Tag: v4.5.0 (Minor — größerer Refactor).
- **Aber nur wenn Tests dafür existieren** (mindestens 10 Unit-Tests
  auf der Filter-Logik).

## Volle Agent-Outputs

### Implementer (a38387e3155666470) — Zusammenfassung
- Modul-Extraktion mit Klasse `TrackFilterComponent({container, dataSource, context})`
- `context = 'wiz'` blendet Scope-Switch + PLs-Spalte aus
- `dataSource: () => Track[]` als Adapter (im Explore: `getSearchSource()`,
  im WIZ: `wizDataSource()`)
- 10 Schritte (5.1–5.10), Aufwand ~7h
- Tag v4.4.0
- Erkennt: `getSearchSource()` ist module-scope-gekoppelt, Klasse löst das
- Test-Strategie: manuell

### Reviewer (a7fb9cb60707d7981) — Zusammenfassung
- Block A: Feld-Mismatch (8 vs. 18+ Felder) ist gravierend
- Block A: `dramaScore` lokal berechnet aus bpm+camelot → ok wenn beide da
- Block A: `getSearchSource` ist module-singleton — Parameter-Plan kollidiert mit 9 anderen Lesern
- Block B: 30+ Funktionen mutieren module-scope-state
- Block B: 0 Tests für search.js
- Block B: 144x `.srch-*` in styles.css verankert
- Block C: Filter-UI für 20 Tracks ist Overkill, Lock-System bei 20 Tracks redundant
- Block D: vier Architekturen bewertet, Inkrementell gewinnt
- Block E: 5 Pflicht-Conditions, Confidence hoch
- Tag-Empfehlung: nicht explizit, aber konvergent v4.4.0 für die Feature-Phase

## Nächster Pingpong-Schritt

**Schritt 1 (Robert):** WIZ-Track-Schema verifizieren via DevTools-Konsole
in der laufenden 4.3.2-App. JSON-Output an mich melden.

**Schritt 2 (Kontrollraum/ChatGPT):** Architektur entscheiden —
Werkbank-Empfehlung ist Reviewer-Inkrementell. Wenn anders entschieden:
Begründung gegen die drei harten Argumente (Tests, Diff-Größe, „sehr sehr
gut"-Wert).

**Schritt 3 (Werkbank):** je nach Entscheidung Phase-1-Implementierung
beginnen (Pure-Funktionen-Lib) — kleiner kontrollierter Patch.

---

**Backup:** Diese Plan-Datei ist neu und überschreibt nichts.
