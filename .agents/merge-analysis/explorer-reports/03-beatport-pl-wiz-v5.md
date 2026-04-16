# Explorer Report: Beatport PL WIZ v5 (HTML-Tool)

**Pfad:** `/Users/roberth./Documents/Claude/Projects/Beatport PL WIZ/`
**Version:** v5, Single-File-HTML (~248 KB)

## 1. Zweck & Kernfunktion

Browser-basiertes DJ-Playlist-Analysewerkzeug für 3.126 Beatport-Playlisten mit 99.411+ Tracks. Kernaufgaben:
- Cross-playlist Duplikat-Erkennung
- Interaktive Playlist-Kuratierung mit Drag&Drop
- Multi-Kriterien-Filterung (Genre, BPM, Tonart, Jahr, Label)
- Musikologisches Scoring für DJ-Dramaturgie (Camelot-Harmonie, Energieverlauf)

Im Gegensatz zu den Electron-Apps ist WIZ ein reines HTML/JS-Tool mit inline Top-200-Tracks und optionalem JSON-Import (22 MB scoring-data) via Drag&Drop.

## 2. Tech-Stack

- Vanilla JavaScript + CSS Grid/Flexbox (kein Framework)
- Inline-JSON (q1–q7 Dashboard-Queries) + scoring-data.json per File-Drop
- localStorage für UI-State + Playlist-Builder-Daten
- Browser-APIs: Fetch, File API, Print-CSS
- Kein Build-System — direkt im Browser lauffähig
- Web Worker ready (notiert, nicht implementiert)

## 3. Haupt-Features

| Feature | Beschreibung | Technik |
|---------|-------------|---------|
| **Dashboard** | Statistik-Cards (6 Metriken), Top-200-Häufigkeit, Artist-Cards, Genre-Balken, BPM/Key-Verteilungen, Jahres-Timeline | DOM-Viz |
| **Suche & Filter** | Echtzeit-Filter (Genre/SubGenre/BPM/Key/Year/Label/Flags), BPM-Normalisierung (80→×2, 170→÷2) | Query-Matching + Pagination |
| **Duplikat-Finder** | Fuzzy-Matching (Name+Artist), cross-playlist gruppierte Anzeige mit BPM/Key-Vergleich | Levenshtein + Clustering |
| **Playlist Builder** | Split-Panel: Links Pool, Rechts aktuelle Playlist. Drag&Drop, Auto-Sort (Camelot/BPM), Dauer-Berechnung | DOM + localStorage |
| **Camelot-Kompatibilität** | Farbpunkte: grün (benachbart), gelb (2 Steps), rot (Clash). Visualisierung im Builder | Camelot-Wheel Mapping |
| **Dramaturgie-Score** | BPM + Camelot → 0–100-Wert für DJ-Energiearc. Farbig: rot ≥75 (Breakdown), orange/gelb (Mid), cyan (Smooth) | `dramaScore(bpm, camelot) → 0–100` |
| **BPM-Flow-Kurve** | Mini-Sparkline des Tempoverlaufs | Visuell |
| **Export** | JSON, CSV, Snapshot, Print-optimiert | Blob-Download + localStorage |

## 4. Kern-Algorithmen

### Camelot-Wheel-System
Standard 12 Minor/Major × 2 (m/M) auf Camelot (1A–12B). Adjacent = ±1 harmonisch, Clash = 7+ Steps.

### Dramaturgie-Score
```js
dramaScore(bpm, camelot) {
  // Normalisiert BPM 60–200 → linear 0-100
  // + Camelot-Position-Gewichtung (Peak-Boost)
  // → 0–100 "DJ Energy at this moment"
}
```
**Algorithmus unklar dokumentiert**, Code muss ausgelesen werden.

### BPM-Normalisierung
- BPM < 80 → × 2 (Halftime → Normal)
- BPM > 170 → ÷ 2 (Dubstep/Drumstep Halftime)
- **Zweck:** DJ-Range standardisieren

### Duplikat-Finder (Fuzzy)
- String-Ähnlichkeit Name+Artist (Schwellenwert ~85% Levenshtein, geschätzt)
- Cross-Playlist-Analyse (einzigartig in WIZ v5)

## 5. Datenquellen

| Quelle | Format | Größe | Integration |
|--------|--------|-------|-------------|
| Inline-Daten | Hardcoded JSON (q1–q7) | ~5 KB | Sofort aktiv |
| scoring-data.json | `{all_tracks: [99k Tracks]}` | 22 MB | Drop-Zone, localStorage-Cache |
| playlists.json | 1.580 Playlists | ~1 MB | Embedded oder Drop |
| API-Import | — | — | **nicht implementiert** |

**Fluss:** App startet mit Inline Top-200 (gelbes Badge) → Nutzer droppt scoring-data → full dataset (grünes Badge) → Filter/Sort arbeitet gegen Memory.

scoring-data.json kommt vom Beatport Scanner (XHR-Tool). Kein Live-Beatport-API in v5.

## 6. UI-Konzepte

1. **Multi-Lock-Sortierung** — "Fixiere BPM asc, dann sekundär Camelot". Locks bleiben bis manuell gelöst
2. **Timeline-Sparklines (Suche-Tab)** — 3 inline Charts: BPM/Key/Dramaturgie-Trend pro Filterung
3. **Drag&Drop Builder (Split-Panel)** — Pool links, Playlist rechts, manuell/auto-sortierbar
4. **Farbige Kompatibilitäts-Punkte** — grün/rot vor jedem Track im Builder
5. **Pagination pro Seite** — Sort gilt pro 100er, nicht global (nützlich bei 99k)
6. **Status-Badges** — Inline vs. Full-Daten-Status
7. **Print-Optimierung** — `@media print` versteckt UI-Kontrollen

Dark Theme: Cyan Primär (#4ecdc4), Orange/Purple Akzente.

## 7. Unique Features (vs. Electron-Apps)

| Feature | PL WIZ v5 | Scanner v1.5.1 | Haupttool |
|---------|-----------|----------------|-----------|
| Cross-Playlist Duplikat-Finder (Fuzzy) | ✓ | ✗ | teilweise (exakt, nicht fuzzy) |
| Dramaturgie-Score (BPM+Camelot) | ✓ | ✗ | ✗ |
| BPM-Normalisierung (80→×2, 170→÷2) | ✓ | ✗ | ✗ |
| Drag&Drop Playlist-Curation | ✓ | ✗ | teilweise (Builder) |
| Jahres-Timeline Viz | ✓ | ✗ | ✗ |
| Multi-Kriterien-Sort-Locks | ✓ | ✗ | teilweise (search.js) |
| Artist-Genre-Cards | ✓ | ✗ | ✗ |

## 8. Portierungsbarrieren

### Kritisch: DOM-State-Management
v5 hält Daten im DOM (getElementById für Filter, `id="plList"` für Builder-State). Portierung benötigt Refactor zu State-Objekt (`window.appState`).

### Moderat: localStorage → Electron-IPC
`localStorage.setItem(key, val)` → `ipcRenderer.invoke('db:set', key, val)` + SQLite-Backend.

### Moderat: File-Drop-API
DOM-DragEvent → Electron Preload-API, JSON-Parse in Main-Prozess (für große Files).

### Klein: Inline-JSON
q1–q7 hardcoded → externe JSON oder SQLite-Seed.

### Klein: window.print()
In Electron unterstützt.

### Performance-Risiko
100k+ Tracks ohne Web-Worker → UI-Freeze. Worker-Implementation oder async Task-Splitting nötig.

### Klein: Camelot-Parsing
Standard 24-Pos Mapping, Code muss ausgelesen werden (evtl. "A minor" → "1A" Format).

## 9. Integrationsstrategie

### Phase 1: Modularisierung (~2-3 Tage)
```
analysis/
  ├── duplicate-finder.mjs         # Fuzzy-Matching
  ├── dramaturgie-scorer.mjs       # BPM+Camelot Score
  └── filter-engine.mjs            # Query-Builder
ui/
  ├── dashboard-charts.mjs         # Stats-Viz
  ├── playlist-builder.mjs         # Drag&Drop
  └── filter-controls.mjs          # Multi-Locks UI
data/
  ├── track-index.mjs              # In-Memory/SQLite
  └── camelot-wheel.mjs            # Key-Mapping
```

### Phase 2: Datenmodell-Unification (Low Effort)
- Scanner: `{id, title, artist, ...}`
- WIZ v5: `{i, t, m, ...}` (abgekürzt)
- → Unified Schema in SQLite, beide Parser importieren gleich

### Phase 3: UI-Integration
**Option A (schnell):** v5 als iframe in Haupttool-Tab — kaum Refactor, aber localStorage-Isolation, keine IPC
**Option B (proper):** v5 als Plain-JS-Modul — 2-3 Tage Refactor, aber einheitliches IPC/State (**empfohlen**)

### Phase 4: Unique Features ins Haupttool
- Duplikat-Finder → neuer Sub-Tab in Analyse
- Dramaturgie-Score → Visual-Feedback im Builder
- BPM-Normalize → Option in Filter

## 10. Empfehlungen für Architekt

| Entscheidung | Empfehlung | Begründung |
|--------------|-----------|-----------|
| Modularisierung | Ja, ESM (nicht Iframe) | IPC-Integration, Code-Wiederverwendung |
| Duplikat-Finder | **Priorisiert!** | Unique, wichtig für Datenqualität |
| Dramaturgie-Score | Modulieren, "experimental" taggen | Algorithmus unklar, Validierung nötig |
| Storage | SQLite statt localStorage | Unified mit Scanner-Cache |
| BPM-Normalisierung | In Filter-Engine | Standard-Feature, leicht |
| Camelot-Wheel | Extern spec | Code in v5 unklar |
| Timeline-Sparklines | Nice-to-have später | Nicht MVP-kritisch |

## Fazit

PL WIZ v5 bringt 3 hochwertige Unique Features:
1. **Cross-Playlist-Duplikat-Finder (Fuzzy)** — sofort wertvoll
2. **Dramaturgie-Scoring** — DJ-Energieverlauf-Feedback
3. **Drag&Drop-Curation mit Camelot-Harmonie-Feedback**

**Portierungsaufwand mittel** — Haupt-Barriere ist DOM-State-Kopplung, nicht Komplexität. **Quick-Win:** Duplikat-Finder sofort importieren (isoliert nutzbar). Dramaturgie später validieren.
