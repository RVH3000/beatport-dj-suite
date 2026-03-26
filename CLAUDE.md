# Beatport DJ Suite — Claude Code Guidelines

**Projekt:** Beatport DJ Suite (All-in-One Beatport Electron App)
**Repository:** `~/Projects/_local/beatport-dj-suite`
**Remote:** ⚠️ KEINS — noch nicht auf GitHub gepusht!
**Version:** 2.0.0
**Branch:** main
**Stack:** Electron + Node.js
**Letzte Aktualisierung:** 2026-03-26 (Pfade aktualisiert nach Ordner-Umstrukturierung)

---

## Projekt-Kontext

Nachfolger des beatport-scanner v1.5.1. Umstrukturiert als modulare Suite mit Tabs:
- **Playlist Scanner** — CDP-basiertes Beatport-Scraping
- **Analysis** — Track-Analyse und Scoring (NEU, in Entwicklung)
- **Export** — Verschiedene Exportformate (NEU, in Entwicklung)
- **Playlist Wiz** — Playlist-Builder (NEU, in Entwicklung)

## Aktueller Stand

6 modifizierte Dateien + 4 neue Tab-Module. Aktive Entwicklung.

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

## ⚠️ Backup-Priorität

Dieses Repo hat KEIN GitHub-Remote. Push empfohlen:
```bash
gh repo create RVH3000/beatport-dj-suite --private --source=. --push
```
