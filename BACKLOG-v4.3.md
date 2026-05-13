# BACKLOG v4.3 — Brain-Dump 2026-05-08 strukturiert

**Quelle:** User-Brain-Dump nach Sichtung von v4.2.9 (Settings-Doku-Update).
**Stand:** 2026-05-13 (Update nach v4.3.1)
**Format:** Kategorisiert nach Prio + Aufwand. ✓ = bereits erledigt.

## Update 2026-05-13

- ✓ **v4.3.0** — Build-Pipeline-Refactor (esbuild Pre-Build-Bundler ersetzt
  Symlink-Deref-Workaround). Tag gepusht. Plan-Schritte 1–4 aus
  `.agents/v4.3-build-pipeline-plan.md` umgesetzt; Schritt 5 (`main.mjs`
  von `../packages/core/index.js` auf `@bpdjs/core` umstellen) bleibt
  separater Patch und ist Voraussetzung fuer M5 Phase B (Punkt 29).
- ✓ **v4.3.1** — `query_beatport_labels.py` faengt fehlende `bp_labels`-
  Tabelle ab (`missing_table: true`-Flag statt Crash). User-Bestaetigung
  2026-05-13: "Label hat geklappt".
- ✓ **Sofort-Import bp_labels** — 511 Labels via
  `scripts/import_beatport_labels.py` mit
  `~/_handoff/bp_labels_response.json` (192 KB, 2026-04-08) in
  `~/Library/Application Support/beatport-dj-suite/suite.db` befuellt.

**Neue Punkte 30–32** (Robert 2026-05-13, nach v4.3.1-Bestaetigung):
praezisieren Punkte 8 und 18, erweitern Label-Tab um Cover-Anzeige.

---

## A. Daten- & Build-Probleme (kritisch)

1. **Labels-Tab + Engine-Merge: Build-Bundle-Lücke** — `data/suite.db`, `scripts/*.py` und `config/scoring-merge-*.json` fehlten im Bundle.
   - ✓ v4.2.10: Labels-Tab zeigt klare Fehlermeldung statt stiller Leere
   - ✓ v4.2.11: `scripts/`, `data/`, `config/` in `build.files` + `asarUnpack` aufgenommen. Engine-Merge-Preview lädt wieder. Labels-DB wird beim ersten Start nach `userData/suite.db` auto-initialisiert (leer; Re-Import via `scripts/import_beatport_labels.py` füllt sie)
   - ⏳ Offen: tatsächlicher Daten-Reimport — die Beatport-API-JSON muss vom User vorgehalten werden (Quelle: GET /v4/my/beatport/labels/)

2. **App-Warnungen "falsche/alte Kopie aktiv" + "mehrere Installationen gefunden"** — Heuristik passt nicht zur neuen Konvention `Beatport DJ Suite X.Y.Z.app` (parallele Versionen sind erwünscht).
   - ✓ v4.2.10: Warnings werden bei versionierten Suite-Bundles unterdrückt

3. **Engine Import: DB-Quelle springt zurück auf "automatisch erkennen"** — gewählte DB wird nicht persistiert, keine verfügbaren DBs werden angezeigt → Preview unmöglich, Apply blockiert.
   - Code-Pfad: `engine`-IPC-Handler in `main.mjs` + `tabs/automation.js` oder ähnlich
   - "Wo werden Änderungen angewendet?" muss im UI klar sein

4. **Camelot-Wheel will keine Daten** — obwohl Key→Camelot-Mapping verfügbar ist, wird kein Wheel gefüllt.

5. **Playlist Overlap zeigt nur eine Verknüpfung** — sollte alle Playlist-Schnittmengen zeigen.

6. **Sync-Pipeline-Diagramm Reihenfolge falsch** — die Pfeile entsprechen nicht dem tatsächlich besprochenen Workflow. Lösung: modulare Anordnung mit konfigurierbaren Reihenfolgen + Routing-Vorschläge.

---

## B. UX & Erklärungen (mittel — Tooltip-Welle)

7. **Library/Scanner: "Aktiver Run" Knopf rechts** — keine Beschriftung, kein Tooltip, Funktion unklar.

8. **Library/Arbeitsbestand: Spalten-Erweiterung** — alle verfügbaren Track-Daten in die Titelzeile, sortierbar, mit Filter-Erklärungen.

9. **Library/Ergebnis-Reiter** — "Ergebnis von was?" muss klar sein. Spalten Name, Tracks, ID, Status, Quelle alle anzeigen + sortierbar.

10. **Suche & Filter: nicht alle Genres angezeigt** — Genre-Liste unvollständig. Sub-Genres aktuell unbenutzt → komplett deaktivieren oder als Opt-in.

11. **Genre-Breakdown: dunkle Schrift auf Balken** — Kontrast unzureichend. CSS-Fix.

12. **Playlist Overlap & Duplikate-Erklärungen** — "Fuzzis", "Scan starten" etc. nicht selbsterklärend.

13. **Duplikate-Tab: Sortierfunktionen** — ewig lange Liste, aktuell unsortiert. Plus: Markierung welches Duplikat gelöscht werden soll, Vorschläge wo sich Duplikate häufen.

14. **Build-Tab: WIZ + WIZ Live + Playlist Bilder** — dreifach doppelt gemoppelt. Code- und UI-Konsolidierung nötig.

15. **Pipeline/Automation** — was macht das überhaupt? Doku fehlt komplett.

16. **Fragezeichen-Tooltips überall** — Pattern aus dem Scanner-Tab auf alle Tabs ausweiten. Jeder Knopf, jeder Filter, jede Spalte braucht eine Erklärung.

17. **Handbuch in Settings** — entsprechend allen UX-Verbesserungen oben mit erweitern.

---

## C. Größere Features (groß — eigene Patches)

18. **Library/Labels: zweiter Tab "Lieblingskünstler"** — analog zu "Gefolgte Labels", Datenquelle: Beatport-API `/v4/my/artists/`.

19. **Echter Delta-Scan** — nur die seit letztem Run neu hinzugekommenen Tracks aus der Beatport-Streaming-DB scannen + importieren. Aktuell läuft anscheinend immer ein Voll-Scan oder zu breit.

20. **Engine Import + Engine Analyze koppeln** — beide Bereiche teilen sich DB-Erkennung; aktuell separate Implementierungen. Eine gemeinsame DB-Auswahl + geteilte Logik.

21. **Auto-Star-Rating basierend auf Plays** — Track mit höchster Play-Anzahl bekommt 5 Sterne, abnehmend gestaffelt (oder konfigurierbar). Optional, mit Schwellwerten.

22. **Plays/Genre interaktiv** — in der Analyse-Seite Daten ins Verhältnis setzen (z.B. Genre-Bars klickbar zeigen welche Tracks am häufigsten gespielt sind).

23. **BPM-Cluster + Tonarten kombiniert** — neue Visualisierung, die beide Dimensionen verschränkt zeigt. Als parallele Working-Copy rechts neben der bestehenden Dashboard-Ansicht (für direkten Vergleich) entwickeln.

24. **Sync-Pipeline modular** — Engine DJ, Lexicon, Rekordbox etc. als bewegbare Bausteine. App schlägt anhand der Auswahl optimale Reihenfolge vor (Matrix-Logik: was funktioniert mit was, was sind die Metadaten-Verluste).

25. **Pipeline/Export Pre-Flight** — Cache-Anzeige (z.B. "3558 Playlists bereit") soll vor Send eine echte Vorschau zeigen, nicht nur Counter.

26. **Globale UX: kein vertikales Scrollen** — alle Hauptpanels sollen sich an die Fenstergröße fitten (vektorisiert/skaliert). Lange Listen (Tracks, Duplikate) bleiben optional ausklappbar/scrollbar.

27. **Duplikate-Heatmap** — wo häufen sich Duplikate? Welche Playlist hat die meisten?

28. **Build-Tab Konsolidierung** (siehe Punkt 14) — WIZ, WIZ Live, Playlist Bilder zusammenführen.

29. **M5 — main.mjs auf @bpdjs/* migrieren** — der eigentliche v4.2-Refactor-Höhepunkt. Nach v4.3-UX-Pass.

30. **Label-Cover anzeigen** ✓ (v4.3.2, Commit `f9666fa`, User-Bestätigung 2026-05-13: „Cover sichtbar") — CSP-Erweiterung in `index.html` Z.5 (`https://*.beatport.com`) + `onerror`-Fallback in `labels.js`. Multi-Agent-Cross-Check-Pilot war konvergent.

31. **Library/Artists: eigener Tab "Meine Artists"** (Robert 2026-05-13, präzisiert Punkt 18) — sortierbare Tabelle mit allen Metadaten, analog Aufbau zum Labels-Tab. Datenquelle: Beatport-API `GET /v4/my/beatport/artists/` (Endpoint-Pfad spiegelbildlich zu `/v4/my/beatport/labels/`). Erfordert: eigenes `bp_artists`-Schema in `suite.db`, eigenes `import_beatport_artists.py`-Script (Vorlage: `import_beatport_labels.py`), eigenes `query_beatport_artists.py` mit `missing_table`-Defensiv-Pattern (siehe v4.3.1), Renderer-Komponente mit Sort-Logik.

32. **Library/Tracks: eigener Tab "Meine Tracks"** (Robert 2026-05-13) — sortierbare Tabelle aller eigenen Tracks mit allen verfügbaren Metadaten (Title, Artist, Label, BPM, Key, Genre, Release-Date, Play-Count, etc.). Konzeptionell parallel zu Punkt 31, aber Beatport-API-Endpoint klären (`/v4/my/beatport/tracks/` falls existiert, sonst aus dem Scanner-Output ableiten). Wichtig: Abgrenzung zu Punkt 8 (Library/Arbeitsbestand-Spalten-Erweiterung) — Punkt 8 ist Scanner-zentrisch (Ergebnisse des letzten Scans), Punkt 32 ist Account-zentrisch (komplette persönliche Library, persistent). Falls Beatport keinen eigenen `/my/tracks/`-Endpoint hat: Scanner-DB als Quelle plus Beatport-Detail-Lookup für Metadaten-Anreicherung.

33. **Build/Playlist WIZ (Live): Suche-&-Filter-UI bei ausgewählter Playlist** (Robert 2026-05-13, mit Screenshots) — wenn eine Playlist in WIZ-Live geladen ist (z.B. "PAWSA, ANOTR & More - 1 Hour Set" mit 20 Tracks), soll dieselbe ausgefeilte Filter/Sort/Lock-UI verfügbar sein wie im Explore → Suche & Filter (Screenshot 2). Konkrete Features die übernommen werden müssen: Wildcards `*` `?`, BPM Norm Toggle, Lock-System mit mehrstufiger Sortierung (Zahl = Priorität, Klick auf Spaltenheader), Genre-Multi-Select-Chips, Sub-Genre-Dropdown, BPM Min/Max, Tonart, Jahr Min/Max, Label, Flags, Rating, Plays, Sortierung-Dropdown, Fixierungs-Buttons (BPM/Camelot/Dramaturgie/Jahr/Genre/Label) mit Scope Global/Pro-Seite-Umschalter, Track-Timeline (BPM/Key-Match/Dramaturgie als farbige Balken), erweiterte Spalten CAMELOT/DRAMA/JAHR/PLS/★/▶. Heutige Code-Lage (2026-05-13): vollständige Filter-Logik existiert in `electron-app/renderer/tabs/search.js` (1702 Zeilen — normBpm, camelotCompat, dramaScore, multiSort, buildSortChain etc.); `electron-app/renderer/tabs/playlist-wiz.js` (568 Zeilen) hat nur einfache Track-Tabelle. Architektur-Optionen: Vollkopie der Filter-Logik in WIZ (Duplikat-Risiko), Modul-Extraktion nach `electron-app/renderer/components/track-filter.js` (saubere Lösung), oder hybrider Ansatz. Scope-Frage besonders: bei Explore ist die Datenbasis "alle Tracks (99k)", bei WIZ-Live "Tracks in der gewählten Playlist (20)" — Filter-Verhalten muss diesen Unterschied sauber abbilden. Möglicher Synergie-Effekt mit Punkt 14 (WIZ + WIZ Live + Playlist Bilder konsolidieren). Aufwand vorab geschätzt: 4–8 h reines Refactoring, plus CSS-Übernahme. Tag-Strategie: Minor-Bump (v4.5.0 oder v4.4.x je nach Reihenfolge zu Punkten 31/32).

---

## Priorisierungs-Vorschlag

**v4.2.11 (erledigt):**
- Punkt 1 — Build-Konfig-Reparatur (scripts/data/config in Bundle + asarUnpack + suite.db auto-init nach userData)

**Bridge-Track (parallel — eigenes Repo `engine-dj-manager`):**
- ⚠️ Schritt 6 — Live-Verifikation am 2026-05-13 durchgeführt: **partial pass + Doku-Fehler** (siehe `docs/bridge/06-engine-live-validation.md`).
- ✗ Schritt 7 — Live-Test am 2026-05-13: **3/3 fehlgeschlagen**. Engine DJ akzeptiert die Historylist SQL-mäßig, zeigt aber Tracks nicht als gespielt. Neue Diagnose: `playedIndicator` ist ein Session-Cluster-Stempel, kein Random-Wert. Detaillierter Befund in `docs/bridge/07-bridge-repair.md`.
- 🔜 Schritt 8 — `playedIndicator` aus `m.db.Information.currentPlayedIndiciator` lesen statt random. Skript `sync_history_v8.py` zu erstellen. Plan in `docs/bridge/08-played-indicator.md`.
- Konsequenz für v4.2-Monorepo: `@bpdjs/engine-bridge` weiterhin NICHT als M1; Bridge-Reparatur läuft als eigener Paket-Track. Nach Schritt-8-Erfolg kann das Paket im Monorepo landen.

**v4.2.12 (nächster Patch — kosmetisch):**
- Punkt 11 (Genre-Breakdown-Schrift-Fix, ~5 Zeilen CSS)
- Optional Punkte 7, 15, 16 — verschoben, falls v4.3 als "M5 zuerst" gefahren wird

**v4.3.0 (Entscheidung offen — siehe Bridge-Ergebnis):**
- Variante A (Plan halten): Punkte 1, 3, 4, 5 (echte Bug-Fixes), 8, 9, 13 (Sortable-Tables-Pass)
- Variante B (M5 vorziehen): Punkt 29 — main.mjs auf @bpdjs/* migrieren, schrittweise pro IPC-Handler

**v4.4.0:**
- Punkte 14, 24 (Build-Konsolidierung + Pipeline modular)
- Punkte 22, 23 (Visualisierungen)
- UX-Pass (7, 15, 16) auf migrierter Codebasis, falls Variante B gefahren wurde

**Später:**
- Punkte 18, 19, 20, 21 (Daten-Features)
- Punkt 26 (globales Layout)

**v4.4.x oder v5 — neue Label/Artist/Track-Welle (Robert 2026-05-13):**
- Punkt 30 (Label-Cover) — klein, kann auch in einen 4.3.x-Patch
- Punkt 31 (Meine Artists Tab) — präzisierte Variante von Punkt 18
- Punkt 32 (Meine Tracks Tab) — neu, klar abgegrenzt von Punkt 8
