# Beatport DJ Suite — Claude Code Guidelines

**Projekt:** Beatport DJ Suite (All-in-One Beatport Electron App)
**Repository:** `~/Projects/_local/beatport-dj-suite`
**Remote:** github.com/RVH3000/beatport-dj-suite (private)
**Version:** 2.3.0
**Branch:** main (stable: release/v2.3-stable)
**Stack:** Electron + Node.js
**Letzte Aktualisierung:** 2026-03-30

---

## Projekt-Kontext

Nachfolger des beatport-scanner v1.5.1. Modulare Suite mit 8 Tabs:
- **Scanner** — CDP/XHR-basiertes Beatport-Scraping mit Session-Management
- **Suche & Filter** — 99k Track-Datenbank, BPM-Lock, Dramaturgie-Score, Playlist Builder (PL WIZ v5)
- **Analyse** — BPM-Verteilung, Key-Kompatibilitaet, Genre-Breakdown
- **Playlist WIZ** — Live Playlist-Management (erstellen, umbenennen, Tracks verwalten)
- **Sync-Pipeline** — Beatport Streaming → DJPlaylists.fm → Lexicon DJ → Engine DJ → USB
- **Automation** — Geplante Scans, Auto-Sync, Regel-basierte Updates
- **Export** — Rekordbox XML, Traktor NML, JSON, JSONL, Engine DJ m.db
- **Einstellungen** — Pfade, Python-Command, OSC-Bridge Config

## Design

Dark Professional Theme (inspiriert von Rekordbox/Traktor/Engine DJ).
CSS Custom Properties in styles.css, Teal/Cyan Primary (#4ecdc4).

## Wichtige Datenpfade

- **scoring-data.json** (23 MB) → `~/Documents/Claude/Projects/Beatport PL WIZ/scoring-data.json`
  Wird per IPC geladen, NICHT im Repo enthalten. NICHT loeschen!
- **sync-presets.json** → `electron-app/data/sync-presets.json`

## Scripts

```bash
npm run desktop:dev      # Entwicklungsserver
npm run desktop:dist:mac # macOS-Build
npm run test             # Tests
npm run beatport:scan    # Scan starten
```

## Verwandte Projekte

- **beatport-scanner** → `~/Projects/_github/beatport-scanner` (Vorgaenger v1.x)
- **beatport-dedupe** → `~/Projects/_local/beatport-dedupe` (Duplikat-Analyse)
- **Beatport PL WIZ** → `~/Documents/Claude/Projects/Beatport PL WIZ/` (HTML-Tool, v5)
