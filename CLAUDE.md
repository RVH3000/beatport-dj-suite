# Beatport DJ Suite — Claude Code Guidelines

**Projekt:** Beatport DJ Suite (All-in-One Beatport Electron App)
**Repository:** `~/Projects/_local/beatport-dj-suite`
**Remote:** github.com/RVH3000/beatport-dj-suite (privat)
**Version:** 4.0.0
**Branch:** v4 (aktiv); daneben `main`, `release/v2.3-stable`, `feat/label-import-2026-04-08`, `merge-analysis`
**Stack:** Electron 32 + Node.js + Python 3 (Engine-DB-Integration)
**Letzte Aktualisierung:** 2026-04-16 (Merge-Analyse gestartet — drei Beatport-Tools werden konsolidiert)

---

## Projekt-Kontext

Nachfolger des beatport-scanner v1.5.1. Modulare Electron-Suite mit Tabs:
- **📚 Library** — Scanner (CDP/XHR Delta-Sync), Arbeitsbestand, Duplikat-Tiefenanalyse, Engine-Import
- **🔍 Explore** — Wildcard-Suche + Multi-Filter, Labels, Analyse-Dashboards, Engine-Analyse
- **🛠 Build** — Playlist WIZ (Live Beatport CRUD), Playlist Builder (Camelot-Check)
- **🚀 Pipeline** — Beatport → DJPL → Lexicon → Engine → USB Sync; Rekordbox/Traktor/M3U/JSON Export; OSC-Bridge (OBS)
- **⚙️ Settings** — Unified Config

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

## Backup-Status

GitHub-Remote ist eingerichtet (`RVH3000/beatport-dj-suite`, privat). Push via `git push origin v4` (bzw. den jeweils aktuellen Branch).
