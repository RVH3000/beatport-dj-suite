# Beatport DJ Suite — Claude Code Guidelines

**Projekt:** Beatport DJ Suite (All-in-One Beatport Electron App)
**Repository:** `~/Projects/_local/beatport-dj-suite`
**Remote:** github.com/RVH3000/beatport-dj-suite (privat)
**Version:** 4.1.0 (Branch `feat/v4.1`); v4 noch auf 4.0.0
**Branch:** v4 (führend); daneben `feat/v4.1` (Versions-Workflow + dyn. Badge), `main`, `release/v2.3-stable`, `feat/label-import-2026-04-08`, `merge-analysis`
**Stack:** Electron 32 + Node.js + Python 3 (Engine-DB-Integration)
**Letzte Aktualisierung:** 2026-05-06 (App-Naming-Konvention, v4.1.0 Build)

---

## Projekt-Kontext

Nachfolger des beatport-scanner v1.5.1. Modulare Electron-Suite mit Tabs:
- **📚 Library** — Scanner (CDP/XHR Delta-Sync), Arbeitsbestand, Duplikat-Tiefenanalyse, Engine-Import
- **🔍 Explore** — Wildcard-Suche + Multi-Filter, Labels, Analyse-Dashboards, Engine-Analyse
- **🛠 Build** — Playlist WIZ (Live Beatport CRUD), Playlist Builder (Camelot-Check)
- **🚀 Pipeline** — Beatport → DJPL → Lexicon → Engine → USB Sync; Rekordbox/Traktor/M3U/JSON Export; OSC-Bridge (OBS)
- **⚙️ Settings** — Unified Config

## Beatport LINK → Engine Library Bridge (Alleinstellungsmerkmal)

Das **Kern-Feature** der App. Andere Tools (Soundiiz, TuneMyMusic, DJ.Studio) können das nicht.

**Problem:** Engine DJ zeigt Beatport-LINK-Tracks in Playlisten erst korrekt an, wenn jeder Track einmal abgespielt wurde (History-Eintrag). Bei großen Playlisten unzumutbar.

**Lösung:** Synthetische History-Einträge schreiben — ohne echte Wiedergabe, ohne Download. Bleibt innerhalb des LINK-Abos.

**Technische Bausteine:**
- Schreib-Kanal vorhanden: **engine-dj-manager** unter `~/Projects/_github/engine-dj-manager/` (Next.js, läuft auf localhost:3000)
- Analyse-Report: `~/Projects/_github/engine-dj-manager/ANALYSE_REPORT.md`
- `PATCH /api/tracks/{id}` funktioniert bereits — schreibt in m.db
- `POST /api/backup` macht automatisches Backup vor Änderung
- **Fehlt noch:** Schreib-Endpoint für `hm.db` (History) — aktuell Read-Only

**Eingefrorener Planungsstand:** `.agents/poc-link-bridge/EINFRIER-STATUS-2026-04-19.md`
**Erste Analyse:** `docs/bridge/01-engine-tools-analysis.md`
**Sandbox-Handoff:** `docs/bridge/HANDOFF_02_SANDBOX.md`

## Engine Library Sandbox

**NIEMALS** direkt auf der echten Engine-DB arbeiten — weder lesend-mit-Lock noch schreibend.

**Sandbox-Strategie:** Immer den **ganzen Ordner** `/Users/roberth./Music/Engine Library/` kopieren, nicht einzelne DB-Dateien. Grund: m.db, hm.db, stm.db, sm.db, rbm.db, itm.db, trm.db referenzieren sich gegenseitig. Einzelne Datei = inkonsistenter Zustand.

**Sandbox anlegen:**
```bash
cp -a "/Users/roberth./Music/Engine Library" \
      "/Users/roberth./Music/Engine Library SANDBOX"
```

**Bestehende Backups im Original-Ordner** (nicht als Sandbox geeignet, nur als Vergleich):
- `hm.db.FULL-BACKUP-2026-03-30` (64 MB, 30. März)
- `m.db.FULL-BACKUP-2026-03-30` (58 MB, 30. März)
- `backups/` (5 × m.db vom 29./30. März)
- `hm.db Kopie` (56 MB, 1. Februar — zu alt, 10 MB fehlen)

## Merge-Analyse (laufend)

Aktive Konsolidierung: Unique Features aus `beatport-scanner` v1.5.1 und `Beatport PL WIZ` v5 werden ins Haupttool portiert. Strategie + Simplifier-Kritik liegen im Worktree `merge-analysis`:

- `.agents/merge-analysis/architect-strategy.md` (270 Zeilen, 6 Phasen — zu ambitioniert)
- `.agents/merge-analysis/simplifier-critique.md` (130 Zeilen, reduziert auf 3 Schritte — verbindlich)
- `.agents/merge-analysis/explorer-reports/` (drei Repo-Analysen)

Worktree-Pfad: `~/Projects/_local/beatport-dj-suite.worktrees/merge-analysis/`

## Scripts

```bash
npm run desktop:dev      # Entwicklungsserver
npm run desktop:dist:mac # macOS-Build
npm run test             # Tests
npm run beatport:scan    # Scan starten
```

## Verwandte Projekte

- **beatport-scanner** → `~/Projects/_github/beatport-scanner` (Vorgänger v1.x)
- **beatport-dedupe** → `~/Projects/_local/beatport-dedupe` (Duplikat-Analyse)
- **Beatport PL WIZ** → `~/Documents/Claude/Projects/Beatport PL WIZ/` (HTML-Tool, v5)
- **engine-dj-manager** → `~/Projects/_github/engine-dj-manager` (Next.js, Schreib-Kanal für Bridge)
- **engine-analyzer** → `~/Projects/_local/engine-analyzer` (Python, Read-Only Verifikation)

## FragmentIndex Scan-Ergebnisse

Unter `/Users/roberth./FragmentIndex/reports/` liegen 145 Scan-Berichte vom 19. April. Für dieses Projekt relevant:
- `scan_2026-04-19_1314_02_beatport-dj-suite.md` (95 KB, 567 Treffer)
- `scan_2026-04-19_1314_03_engine-dj-manager.md` (9 KB, 52 Treffer)
- `scan_2026-04-19_1314_04_engine-analyzer.md` (0,6 KB, 2 Treffer)

## Backup-Status

GitHub-Remote ist eingerichtet (`RVH3000/beatport-dj-suite`, privat). Push via `git push origin v4` (bzw. den jeweils aktuellen Branch).

## App-Installation: Versionsnummer im Namen

Builds die nach `/Applications/` installiert werden, IMMER mit Versionsnummer benennen:
- `/Applications/Beatport DJ Suite 4.1.0.app` ✓
- `/Applications/Beatport DJ Suite.app` ✗ (nicht ohne Suffix)

Grund: alte Builds bleiben parallel verfügbar (Rollback ohne Neu-Build). Ältere Versionen → in `~/.Trash/` verschieben, nicht überschreiben. Vor dem Ersetzen die laufende Instanz beenden (`osascript -e 'tell application "..." to quit'`).

## Session-Kontinuität (Pflicht)

Bei JEDEM neuen Chat in diesem Projekt gilt für Claude:

1. Bevor auf die erste Nachricht geantwortet wird: `conversation_search`
   oder `recent_chats` aufrufen, um den letzten Stand aus vorherigen Chats
   zu laden.
2. Einsteiger-Sätze wie "Nächster Schritt 2...", "weiter wie gestern",
   "mach weiter mit...", "OK für Schritt X?" sind IMMER ein Signal, dass
   der Kontext aus einem früheren Chat kommt — nicht aus den Projekt-Dateien.
3. Zusätzlich die aktuellste `LLM_HANDOFF.md` und alle `HANDOFF_*.md`
   im Repo-Root lesen.
4. Erst DANN antworten. Niemals raten, was der User meint, wenn Referenzen
   auf vergangene Arbeit fehlen.
5. Wenn der Kontext nach der Suche noch unklar ist: gezielt nachfragen,
   statt blind Schritte vorzuschlagen.

Ablauf:
- Änderung in der Datei vornehmen
- `git status` zeigen
- `git diff CLAUDE.md` zeigen
- Auf meine Bestätigung warten, BEVOR commit/push
- Commit-Message-Vorschlag: "docs: Session-Kontinuitäts-Regel in CLAUDE.md ergänzt"
- Nicht pushen ohne explizites OK
