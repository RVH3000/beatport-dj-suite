# PLAN — Backlog-Punkt 31: Library/Artists eigener Tab

**Status:** Multi-Agent-Cross-Check abgeschlossen, Implementation **pausiert**
**Erstellt:** 2026-05-13 (Werkbank, nach Pilot-Lauf Punkt 30)
**Methode:** Implementer (feature-dev:code-architect) + Reviewer (ultra-think adversarial)
**Goal-Datei:** `.agents/GOAL-2026-05-13-multi-agent-features.md`

---

## Lage

Implementer-Plan steht (~600 Worte unten zusammengefasst). Reviewer hat
SIEBEN echte Bedenken aufgeworfen, die der Implementer-Plan nicht
adressiert. Das ist KEIN hartes Veto — Reviewer empfiehlt Hybrid-
Architektur mit fuenf Pflicht-Conditions. Confidence: mittel.

## Blocker bevor Implementation startet

### Daten-Beschaffung (durch Robert)

1. **Endpoint-Verifikation per curl-Probe:**
   ```bash
   # Auth-Cookie aus Beatport-Browser-Session in ein Header-File legen,
   # dann probieren:
   curl -s "https://api.beatport.com/v4/my/beatport/artists/" \
        -H "Authorization: Bearer <token>" \
        -H "Cookie: <session>" \
        | jq '.' > ~/_handoff/bp_artists_response_probe.json
   ```
   Wenn 404 oder leeres JSON: Endpoint existiert nicht, dann
   Alternativ-Discovery via beatport.com/my-beatport (DevTools-
   Network-Tab beim Aufruf der Artists-Section).

2. **Vollstaendige JSON-Datei holen** (analog `bp_labels_response.json`):
   `~/_handoff/bp_artists_response.json` mit allen gefolgten Artists.

3. **Pagination-Check:** wenn die Response ein `next`-Feld oder `count`-
   Feld groesser als `len(results)` hat, ist Pagination noetig. Dann
   muss `import_beatport_artists.py` paginieren oder Robert muss mehrere
   Pages zusammenfuegen.

### Architektur-Entscheidungen (durch Kontrollraum/ChatGPT)

4. **Helper-Extraktion vor oder waehrend Punkt 31?**
   - Option A: Erst `scripts/_bp_db_helpers.py` (upsert_by_id, backup_db,
     ensure_table_with_first_seen_trigger) extrahieren, dann Artists
     darauf bauen. **Mehr Aufwand jetzt, weniger Duplikat bei Punkt 32.**
   - Option B: Punkt 31 als Vollkopie des Labels-Pattern, Helper-Extraktion
     bei Punkt 32 nachziehen.
   - Option C: Bewusst als Tech-Debt zurueckstellen, Ticket fuer v4.3.4.

5. **`is_followed`-Drift fixen?**
   - Bei Labels heute: Re-Import setzt `is_followed=1` fuer alle
     gesehenen Eintraege, aber entfernte Follows bleiben `is_followed=1`
     stehen (kein DELETE, kein DIFF). Bei 511 Labels unbemerkt.
   - Bei Artists (vermutlich 1500+) wahrscheinlich relevant.
   - Fix-Option: vor Import `UPDATE bp_artists SET is_followed=0`, dann
     Upsert setzt `1`. Oder neue Spalte `synced_in_this_batch`.
   - Entscheidung: jetzt fixen (auch fuer Labels) oder fuer Artists
     separates Pattern oder zurueckstellen?

## Implementer-Plan (Zusammenfassung, ~600 Worte)

### Schema `bp_artists`

```
id              INTEGER PRIMARY KEY
name            TEXT NOT NULL
slug            TEXT
release_count   INTEGER DEFAULT 0
track_count     INTEGER DEFAULT 0
image_id        INTEGER
image_uri       TEXT
image_dynamic   TEXT
is_followed     INTEGER DEFAULT 1
last_synced_at  TEXT NOT NULL
first_seen_at   TEXT NOT NULL
```

Indices: name (COLLATE NOCASE), followed, count DESC.
Trigger: `bp_artists_first_seen_lock` (analog labels).

### Neue/geaenderte Dateien

| Datei | Status |
|---|---|
| `scripts/import_beatport_artists.py` | neu, ~6 KB |
| `scripts/query_beatport_artists.py` | neu, ~3 KB |
| `electron-app/renderer/tabs/artists.js` | neu, ~5 KB |
| `electron-app/renderer/index.html` | Edit: Tab-Button + Panel |
| `electron-app/renderer/styles.css` | Edit: `.artist-*` Klassen (~8 Z.) |
| `electron-app/main.mjs` | Edit: IPC-Handler `artists:stats`, `artists:list` |
| `electron-app/preload.mjs` | Edit: `window.artistsApi`-Bridge |
| `electron-app/renderer/app.js` | Edit: `loadArtistsTab()` + Dispatch |

### Destruktive Operationen (GOAL §4)

1. `CREATE TABLE bp_artists` (Schema-Change, §4 Punkt 6)
2. INSERT/UPDATE in produktiver `suite.db` (§4 Punkt 2 — Sandbox-First!)
3. Edit auf `main.mjs` (kritische Datei, §4 Punkt 1)
4. Edit auf `preload.mjs` (kritische Datei, §4 Punkt 1)

### Tag-Strategie

**v4.4.0** (Minor): neuer Tab = neue sichtbare Funktion fuer User.
Schema-Erweiterung rechtfertigt strukturell auch Minor-Bump.

## Reviewer-Bedenken (Zusammenfassung, 7 Punkte)

### Block A — Beatport-API
- **Endpoint `/v4/my/beatport/artists/` UNSICHER.** Beatport hat
  `/v4/my/beatport/labels/` und `/v4/catalog/artists/{id}/` dokumentiert,
  ein symmetrisches My-Followed-Artists nicht. Risiko: 404.
- **Schema-Symmetrie unwahrscheinlich:** Artists haben slug, biography,
  soundcloud_url, genres-Array, country — Labels nicht.
- **Pagination NICHT in `import_beatport_labels.py`:** bei 1500+
  Artists stiller Datenverlust.
- **`release_count` ist labels-semantisch:** bei Artists eher
  `track_count` oder mehrere Counts.

### Block B — Schema
- **Migration-Pfad fehlt:** `CREATE TABLE IF NOT EXISTS` reicht nur
  beim Erst-Setup, nicht fuer spaetere Spalten.
- **Composite-Key-Konflikte** latent bei kuenftigem Tracks-Tab (Punkt 32)
  wenn artist_id + label_id in JOIN-Queries mischen.
- **`is_followed`-Drift** ist bei Labels heute schon ein stiller
  Datenfehler — wird bei Artists sichtbar.

### Block C — Renderer + UX
- **1000+ Karten ohne Virtualisierung = Scroll-Lag.** Untergrenze 500.
  Bei mehr: IntersectionObserver-Pattern Pflicht.
- **Sort-Optionen** sind labels-spezifisch — fuer Artists bei v1
  bewusst auf die vier Labels-Sorts beschraenken, keine Phantasie.
- **`image_dynamic`-Template-Pattern** (`{w}`/`{h}`) bei Artists nicht
  garantiert — vor Copy-Paste pruefen.

### Block D — Architektur-Empfehlung
**Hybrid (Option C).** Separate Tabellen `bp_artists`, `bp_tracks`
bleiben, aber gemeinsame Helper-Module:
- `scripts/_bp_db_helpers.py` (upsert_by_id, backup_db, table_exists,
  ensure_table_with_first_seen_trigger)
- `electron-app/renderer/_card_grid.js` (renderGrid mit card-template-
  function als Parameter)

Confidence: **mittel.** Steigt auf hoch wenn Endpoint verifiziert.

## Konvergente Pflicht-Conditions (beide Agents)

1. JSON-Datei `~/_handoff/bp_artists_response.json` muss vorliegen
2. Endpoint-Pfad muss per curl-Probe verifiziert sein
3. Schema aus Sample abgeleitet (NICHT aus Labels-Analogie)
4. Sandbox-First fuer DB-Schreiboperation (Backup von `suite.db`
   vor erstem Import)
5. `git diff --stat` proportional vor Commit (Lehre aus v4.3.0
   asar-Vorfall und v4.3.2 Block-Style-Arrow-Function-Fix)

## Empfehlung der Werkbank fuer Kontrollraum-Entscheidung

**Schritt 1:** Robert holt `bp_artists_response.json` von der Beatport-API
(curl-Probe + Vollabfrage). Dauert ~10 Min.

**Schritt 2:** Kontrollraum (ChatGPT) entscheidet zwischen Implementer-
Default (Vollkopie) und Reviewer-Hybrid (mit Helper-Extraktion). Empfehlung
der Werkbank: **Reviewer-Hybrid annehmen** — die Argumente sind valide,
und Punkt 32 (Tracks) profitiert direkt von Helper-Extraktion.

**Schritt 3:** `is_followed`-Drift in einem separaten v4.3.3-Patch fixen
(BEVOR Artists-Tab kommt) — Labels profitieren auch, Pattern ist
etabliert wenn Artists implementiert wird.

**Schritt 4:** Nach Schritten 1+2+3: Werkbank-Session fuer Punkt 31 mit
Helper-Modulen + bp_artists, dann Renderer-Tab, dann Tag v4.4.0.

---

**Volle Agent-Outputs als Original-Quelle:**

- Implementer (aaaaa118c86ce2c6af68): siehe Cross-Check-Bericht in
  Conversation-Log von 2026-05-13.
- Reviewer (a5fb1f0141d06aa24): siehe Cross-Check-Bericht in
  Conversation-Log von 2026-05-13.
