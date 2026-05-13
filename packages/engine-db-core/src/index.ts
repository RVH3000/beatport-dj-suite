// Public API von @bpdjs/engine-db-core.
// Plain-Copy aus engine-dj-manager (MIT-License, siehe LICENSE.engine-dj-manager).
//
// Dieser Haupt-Export enthält NUR Module, die keine native-Dep (better-sqlite3)
// brauchen — er ist sofort konsumierbar ohne extra Installation.
//
// Für DB-Module bitte Sub-Pfade nutzen, z.B.:
//   import { EngineDB } from '@bpdjs/engine-db-core/engine-db'
//   import { EngineHistoryDB } from '@bpdjs/engine-db-core/engine-history-db'
//   import { scanDbs } from '@bpdjs/engine-db-core/db-scanner'
//   import { compareDbs } from '@bpdjs/engine-db-core/db-compare'
//   import { Registry } from '@bpdjs/engine-db-core/registry'
//   import { exportEngineUsb } from '@bpdjs/engine-db-core/export-engine-usb'
// Sub-Pfad-Konsumenten benötigen 'better-sqlite3' als peerDependency.

// — Helpers (kein sqlite) —
export { engineRatingToStars } from './engine-rating.js';
export { trackDedupKey } from './streaming-uri.js';
export type { MatchType } from './streaming-uri.js';
export { getDbDir, getEngineDbPath, getHistoryDbPath } from './engine-paths.js';

// (engine-schema enthält getDbVersion mit sqlite — nur über Sub-Pfad importieren:
//   import { getDbVersion } from '@bpdjs/engine-db-core/engine-schema')

// — Auto-History-Playlist Typen (Datenstrukturen, keine sqlite-Imports) —
export type {
  HistoryScanStats,
  ResolvedTrack,
} from './auto-history-playlist.js';

// — Lexicon-Client (fetch-basiert, kein sqlite) —
export * from './lexicon-client.js';

// — Reine CSV-/Rekordbox-Exporter (kein sqlite an dieser Stelle) —
export * from './export-csv.js';
export * from './export-rekordbox.js';

// — Playlist-Splitter (arbeitet auf Datenstrukturen, kein sqlite) —
export * from './playlist-splitter.js';
