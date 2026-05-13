# BACKLOG v4.3 — Brain-Dump 2026-05-08 strukturiert

**Quelle:** User-Brain-Dump nach Sichtung von v4.2.9 (Settings-Doku-Update).
**Stand:** 2026-05-08
**Format:** Kategorisiert nach Prio + Aufwand. ✓ = bereits in v4.2.10 erledigt.

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
