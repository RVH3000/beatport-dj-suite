# Beatport DJ Suite v4.2

| Feld | Wert |
|------|------|
| Path | ~/Projects/_local/beatport-dj-suite.worktrees/v4.2 |
| Remote | github.com/roberthaugwitz/beatport-dj-suite |
| Branch | feat/v4.2 |
| Version | 4.2.0 |
| Stack | Electron + Node.js + npm workspaces |
| Status | Phase 0 — Monorepo Setup |
| Datum | 2026-05-07 |

## Projektkontext
Modulares Refactoring von v4.1 (Monolith) zu npm-Workspace-Monorepo mit 13 @bpdjs/ Paketen. v4.1 bleibt komplett unangetastet — Code wird nur kopiert, nie geändert oder gelöscht.

## Verwandte Projekte
- **beatport-dj-suite v4.1** — ~/Projects/_local/beatport-dj-suite (feat/v4.1) — Basis, wird nur gelesen
- **engine-dj-manager** — ~/Projects/_github/engine-dj-manager — Quelle für @bpdjs/engine-db

## Interface-Regeln
- 8pt-Grid
- CI-Palette: #00D4CC (Türkis), #E84040 (Rot), #C8A882 (Sand)
- Viewports: 1440×900 + 3440×1440
- Kein Touch

## Regeln
- v4.1 wird NIE geändert oder gelöscht
- Code nur kopieren, nie verschieben
- Sandbox-First für alle DB-Operationen
- Deutsch als Dokumentationssprache
- Regelmäßige Commits + Patch-Version-Bumps
