# HANDOFF — Beatport LINK → Engine Library Bridge

**Erstellt:** 19. April 2026
**Von:** Session „Strategischer Rundgang Phase 1-4"
**An:** Neue Session zur Bridge-Implementierung
**Zweck:** Kontext ohne erneuten Rundgang — direkt an die eigentliche Arbeit

---

## Kern-Erkenntnis dieser Session

**Alleinstellungsmerkmal der App:**
Die Beatport DJ Suite macht das, was Soundiiz, TuneMyMusic, DJ.Studio und alle anderen etablierten Tools **nicht können**: **die letzte Meile von Beatport LINK Streaming-Playlisten in die Engine DJ Library**.

**Das Problem:**
Engine DJ zeigt Streaming-Tracks in gemischten Playlisten erst dann korrekt an, wenn jeder Track mindestens einmal abgespielt wurde (History-Eintrag). Bei großen Playlisten unzumutbar.

**Die Lösung (das Kern-Feature):**
Automatisiert für den User diesen History-Eintrag. Kein Track wird heruntergeladen, keine Datei wird kopiert — die Wiedergabe läuft weiterhin über den legitimen Beatport-LINK-Streaming-Mechanismus. Nur der „einmal spielen"-UI-Schritt wird umgangen.

**Rechtliche Einschätzung:**
Bewegt sich innerhalb des zahlenden LINK-Abos. Kein AGB-Verstoß im engen Sinn — die Tracks bleiben Streaming-Tracks, funktionieren nicht ohne aktives Abo, werden nicht als Besitz behandelt. Ähnliche Tools (DJ.Studio, Soundiiz) werden von Beatport offiziell unterstützt — der Markt ist etabliert.

---

## Aktueller Projekt-Stand (Stand 19.04.2026 nach Rundgang)

### Repo
- **Pfad:** `~/Projects/_local/beatport-dj-suite/`
- **Branch:** `v4` — sauber, gepusht, getaggt `v4.0.0`
- **Release-Workflow:** heute eingeführt (commit-and-tag-version, CHANGELOG-Split)
- **Worktrees:** `merge-analysis` (aktiv), `dual-mode-review` (Referenz, nicht mergen)

### Relevante Files für die Bridge
- `electron-app/integrations/python/engine_tools.py` — Engine-DB-Zugriff (Python, 78 KB)
- `electron-app/integrations/engine-analyze-matcher.mjs` — Track-Matching-Logik
- `electron-app/renderer/tabs/engine-analyze.js` — UI für Engine-Analyse (40 KB)
- `electron-app/renderer/tabs/sync.js` — Sync-Pipeline-UI (65 KB)
- `electron-app/api/sync_orchestrator.mjs` — orchestriert die gesamte Pipeline
- `electron-app/scanner/xhr-scanner.mjs` + `cdp-scanner.mjs` — Beatport-API-Zugriff
- `tools/bpx.mjs` — CLI-Wrapper für Scanner
- `electron-app/auth/session-manager.mjs` + `session-probe.mjs` — Beatport-Login-Verwaltung

### Was bereits funktioniert
- Beatport-Login in der App (Session-basiert, DOM + XHR)
- Beatport-Playlisten lesen und ändern (CRUD)
- Engine-DJ-DB lesen (Read-Only, inkl. Playlisten, History, PerformanceData-BLOBs)
- DJPlaylists.fm-Integration via DOM-Automation
- Soundiiz-Monitoring (optional)
- Lexicon-DJ-Client
- Camelot-Analyse, Duplikat-Finder, Export (Rekordbox/Traktor/M3U/JSON)

### Was für die Bridge fehlt / unklar ist
- **History-Eintrag schreiben:** Ist in `engine_tools.py` der Schreib-Zugriff aktuell nur Read-Only (`PRAGMA query_only = ON` laut LLM_HANDOFF.md)? Muss geprüft werden.
- **Streaming-Track-Identifier in Engine-DB:** Wie werden Streaming-Tracks von Engine intern identifiziert? Welches Feld markiert „schon gespielt"?
- **Atomare Schreib-Operationen:** Kann die Bridge einen ganzen Playlist-Block in einem Durchgang eintragen, ohne die Engine-DB zu korrumpieren?
- **Sicherheit/Backup:** Vor jedem Schreibvorgang muss die Engine-DB automatisch gesichert werden.

---

## Feature-Verteilung (Phase-3-Ergebnis)

### Core (offen, keine Logins nötig)
- Engine-Analyse (Read-Only)
- Duplikat-Analyse
- Export (Rekordbox/Traktor/M3U/JSON)
- Camelot-Darstellung
- OSC-Bridge → Max/MSP/Ableton
- Scoring/Classifier

### Pro (Kern-Produkt, braucht Logins)
- **Beatport LINK → Engine Bridge** *(das Herzstück)*
- Beatport-Suche & Interaktion in der App
- Playlist WIZ (Live Beatport CRUD)
- Scanner (XHR + CDP Delta-Sync)
- DJPlaylists.fm-Integration
- Soundiiz-Integration
- Lexicon-Client
- Automation / Workflows

### Privat (nur Robert)
- Eigene Presets, eigene Sessions, eigene API-Kontexte

### Außen vor
- Browser-DevTools-Plugin (eigenes Werkzeug, kein Produkt)
- OBS-Now-Playing Lua (gehört zu ALB-Streaming)

---

## Referenz-Code aus anderer Quelle

**`docs/references/license-manager-jules-ref.mjs`** (3 KB, untracked)

Ein Agent (Jules von Google Labs) hat in einem früheren Branch ein Feature-Gating-Konzept geschrieben: PIN + Lizenzschlüssel, CSS-basierte UI-Guards, IPC-Blockaden. **Nicht direkt mergen** (veraltete Basis), aber als Vorlage für Core-vs-Pro-Trennung brauchbar. Thema für 3. Mai.

---

## Offene organisatorische Baustellen (nicht jetzt)

- `main`-Branch hinkt hinter `v4` — irgendwann nachziehen
- `feat/label-import-2026-04-08` — Status unklar (fertig? tot?)
- 9 Untracked Files im Projekt-Root (bbp-*.html, theme-showcase.pdf etc.) — Aufräumen
- StagelinQ / Prime-4-Netzwerk: nie gebaut, als Roadmap markieren

---

## Nächster Schritt für neue Session

**Thema:** Beatport LINK → Engine Library Bridge technisch angehen

**Empfohlener Einstieg:**
1. Ist-Stand in `engine_tools.py`: gibt es Schreib-Pfade, nur Read-Only-Zugriffe, oder ist das flexibel?
2. Engine-DB-Schema für Streaming-Tracks und History verstehen
3. Backup-Strategie definieren (vor jedem Schreibvorgang)
4. Einen kleinen, reversiblen Proof-of-Concept bauen (eine Playlist, 5 Tracks, Engine-DB vorher sichern)

**Nicht in der neuen Session:**
- Vermarktungs-Diskussion (abgeschlossen)
- Scope-Neuverhandlung (abgeschlossen)
- Git-Aufräumarbeiten (separates Thema)
