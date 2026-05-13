# @bpdjs/engine-db-core

Plain-Copy der TypeScript-Module aus `engine-dj-manager` (MIT-Lizenz).
Quelle: `~/Projects/_github/engine-dj-manager/src/lib/*` und `tools/*`.
Stand der Quelle bei Übernahme: 2026-05-13, Branch `master` (Commit `839aac0`, v0.4).

## Inhalt

### `src/` — DB- und Domänen-Module

| Modul | Aufgabe |
|---|---|
| `engine-db.ts` | Read-only Layer für `m.db` (Tracks, Playlists, PlaylistEntity) |
| `engine-history-db.ts` | Read-only Layer für `hm.db` (Sessions, HistorylistEntity) |
| `engine-paths.ts` | Path-Resolver für Engine-Library-Ordner und Database2 |
| `engine-schema.ts` | Schema-Konstanten (Spaltennamen, Konstanten) |
| `engine-rating.ts` | 0–50 ⇄ 0–5 Sterne Mapping (Engine-Format) |
| `auto-history-playlist.ts` | Sessions clustern, Stats, Dedup nach Streaming-URI |
| `streaming-uri.ts` | Track-Dedup über Streaming-URLs |
| `db-scanner.ts` | Engine-DBs im Dateisystem finden |
| `db-compare.ts` | Zwei Engine-DBs vergleichen (gemeinsame/fehlende Tracks) |
| `registry.ts` | Mehrere Engine-DBs verwalten + Switching |
| `playlist-splitter.ts` | Master-Playlist nach Regeln in Sub-Playlists aufteilen |
| `export-csv.ts` | Tracks/Playlists als CSV exportieren |
| `export-rekordbox.ts` | Export nach Rekordbox XML |
| `export-engine-usb.ts` | Export auf USB im Engine-Format (Sandbox-First) |
| `lexicon-client.ts` | Lexicon-Format-Client (Import-Preview + Export) |
| `ui-density.ts` | UI-Helper für Dichte-Settings (gehört eigentlich nicht hierher — folgt später raus) |

### `tools/`

- `bridge/sync_history.py` — Bridge-PoC Schritt 5 (synthetische History-Einträge in Sandbox)
- `bridge/README.md`, `bridge/RESULT.md` — Doku des PoC-Laufs vom 2026-04-20
- `history-merge/export.py` — History-Merge-Tool (Sessions konsolidieren)
- `history-merge/README.md`

## Status

**Nicht produktiv eingebunden** — das Paket ist eine Quelltext-Sammlung.
TS-Build-Setup (tsconfig + Build-Script) folgt im nächsten Schritt, bevor die Suite das Paket konsumieren kann.

### Was noch fehlt

- `src/index.ts` mit Public-API-Re-Exports
- `tsconfig.json` + Build-Pipeline (z.B. esbuild oder tsc → dist)
- Tests (Original-Tests aus engine-dj-manager portieren)
- `ui-density.ts` herauslösen — gehört nicht in das DB-Core-Paket
- `lexicon-client.ts` evtl. eigenes Paket `@bpdjs/lexicon-client`

## Lizenz

MIT — Original-Lizenz aus `engine-dj-manager` (siehe `LICENSE.engine-dj-manager`).
Die Suite selbst hat keine eigene Lizenz-Erklärung; das Paket erbt von der Suite-Lizenz, soweit nicht oben anders vermerkt.
