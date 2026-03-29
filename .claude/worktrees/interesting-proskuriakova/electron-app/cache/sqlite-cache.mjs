import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { normalizeText, toInt } from "../utils/common.mjs";

const SQLITE_BIN = "/usr/bin/sqlite3";
const CACHE_SCHEMA_VERSION = 1;

function toIsoNow() {
  return new Date().toISOString();
}

function sqlLiteral(value) {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runSql(dbPath, sql, { json = false } = {}) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  return await new Promise((resolve, reject) => {
    const args = ["-batch"];
    if (json) {
      args.push("-json");
    }
    args.push(dbPath);

    const child = spawn(SQLITE_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`sqlite3 fehlgeschlagen (${code}): ${stderr || stdout}`));
        return;
      }
      if (!json) {
        resolve(stdout);
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve([]);
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch (error) {
        reject(
          new Error(
            `sqlite3 JSON konnte nicht gelesen werden: ${error.message}\n${trimmed}`
          )
        );
      }
    });

    child.stdin.write(`${sql.trim()}\n`);
    child.stdin.end();
  });
}

function chunk(list, size) {
  const result = [];
  for (let index = 0; index < list.length; index += size) {
    result.push(list.slice(index, index + size));
  }
  return result;
}

export function normalizePlaylistKey(entry = {}) {
  const id = normalizeText(entry.playlistId ?? entry.id ?? "");
  if (id) return id;
  const key = normalizeText(entry.key ?? entry.cacheKey ?? "");
  if (key) return key;
  const name = normalizeText(entry.playlistName ?? entry.name ?? "");
  const tracks = normalizeText(entry.playlistTracksExpected ?? entry.tracks ?? "");
  return name ? `${name}_${tracks}` : "";
}

function normalizePlaylistRecord(entry = {}, options = {}) {
  const now = options.now || toIsoNow();
  const playlistKey = normalizePlaylistKey(entry);
  const syncState = normalizeText(entry.syncState ?? options.syncState ?? "current") || "current";
  const dirty =
    options.dirty ??
    entry.dirty ??
    (syncState === "dirty" || syncState === "needs_analysis" ? 1 : 0);
  return {
    playlistKey,
    playlistId: normalizeText(entry.playlistId ?? entry.id ?? ""),
    name: normalizeText(entry.playlistName ?? entry.name ?? ""),
    tracks: normalizeText(entry.playlistTracksExpected ?? entry.tracks ?? ""),
    key: normalizeText(entry.key ?? ""),
    source: normalizeText(entry.source ?? entry.analysisMethod ?? options.source ?? "cache"),
    serverTrackCount: toInt(entry.serverTrackCount ?? entry.track_count ?? entry.tracks ?? 0, 0),
    discoveredAt: normalizeText(entry.discoveredAt ?? entry.serverSeenAt ?? now) || now,
    serverSeenAt: normalizeText(entry.serverSeenAt ?? now) || now,
    lastSeenAt: normalizeText(entry.lastSeenAt ?? now) || now,
    lastDeepAnalyzedAt: normalizeText(entry.lastDeepAnalyzedAt ?? ""),
    syncState,
    dirty: dirty ? 1 : 0,
    isDuplicateCandidate: entry.isDuplicateCandidate ? 1 : 0,
    isDuplicateConfirmed: entry.isDuplicateConfirmed ? 1 : 0,
    trackFingerprint: normalizeText(entry.trackFingerprint ?? ""),
    lastRunId: normalizeText(entry.lastRunId ?? options.lastRunId ?? ""),
    updatedAt: now,
  };
}

function normalizeTrackRecord(track = {}, playlistKey, options = {}) {
  const now = options.now || toIsoNow();
  const trackId = normalizeText(track.trackId ?? track.id ?? "");
  const trackIndex = toInt(track.trackIndex ?? track.position ?? 0, 0);
  const rowKey = trackId || `row:${trackIndex}`;
  return {
    playlistKey,
    trackRowKey: rowKey,
    trackIndex,
    trackId,
    trackTitle: normalizeText(track.trackTitle ?? track.title ?? ""),
    artists: normalizeText(track.artists ?? ""),
    genre: normalizeText(track.genre ?? ""),
    label: normalizeText(track.label ?? ""),
    year: normalizeText(track.year ?? track.releaseYear ?? ""),
    release: normalizeText(track.release ?? ""),
    releaseDate: normalizeText(track.releaseDate ?? ""),
    releaseYear: normalizeText(track.releaseYear ?? track.year ?? ""),
    bpm: normalizeText(track.bpm ?? ""),
    musicalKey: normalizeText(track.key ?? track.musicalKey ?? ""),
    mixName: normalizeText(track.mixName ?? ""),
    source: normalizeText(track.source ?? options.source ?? "xhr"),
    updatedAt: now,
  };
}

export function resolveCacheDbPath(config = {}) {
  const explicit = normalizeText(config.cacheDbPath);
  if (explicit) {
    return explicit;
  }
  const userDataPath = normalizeText(config.userDataPath);
  const baseDir = userDataPath
    ? path.join(userDataPath, "cache")
    : path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "beatport-playlist-scanner",
        "cache"
      );
  return path.join(baseDir, "beatport-cache.sqlite");
}

export class SQLiteCacheStore {
  constructor(config = {}) {
    this.config = config;
    this.dbPath = resolveCacheDbPath(config);
  }

  async init() {
    await runSql(
      this.dbPath,
      `
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS playlists (
        playlist_key TEXT PRIMARY KEY,
        playlist_id TEXT,
        name TEXT,
        tracks TEXT,
        playlist_dom_key TEXT,
        source TEXT,
        server_track_count INTEGER DEFAULT 0,
        discovered_at TEXT,
        server_seen_at TEXT,
        last_seen_at TEXT,
        last_deep_analyzed_at TEXT,
        sync_state TEXT DEFAULT 'current',
        dirty INTEGER DEFAULT 1,
        is_duplicate_candidate INTEGER DEFAULT 0,
        is_duplicate_confirmed INTEGER DEFAULT 0,
        track_fingerprint TEXT,
        last_run_id TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS playlists_name_idx ON playlists(name);
      CREATE INDEX IF NOT EXISTS playlists_sync_idx ON playlists(sync_state, dirty);
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_key TEXT NOT NULL,
        track_row_key TEXT NOT NULL,
        track_index INTEGER DEFAULT 0,
        track_id TEXT,
        track_title TEXT,
        artists TEXT,
        genre TEXT,
        label TEXT,
        year TEXT,
        release TEXT,
        release_date TEXT,
        release_year TEXT,
        bpm TEXT,
        musical_key TEXT,
        mix_name TEXT,
        source TEXT,
        updated_at TEXT,
        PRIMARY KEY (playlist_key, track_row_key)
      );
      CREATE INDEX IF NOT EXISTS playlist_tracks_lookup_idx ON playlist_tracks(playlist_key, track_index);
      CREATE TABLE IF NOT EXISTS playlist_fingerprints (
        playlist_key TEXT PRIMARY KEY,
        fingerprint TEXT,
        analyzed_track_rows INTEGER DEFAULT 0,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        state_key TEXT PRIMARY KEY,
        state_value TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS exports (
        export_key TEXT PRIMARY KEY,
        export_path TEXT,
        generated_at TEXT,
        row_count INTEGER DEFAULT 0
      );
      INSERT INTO sync_state(state_key, state_value, updated_at)
      VALUES ('schema_version', ${sqlLiteral(String(CACHE_SCHEMA_VERSION))}, ${sqlLiteral(toIsoNow())})
      ON CONFLICT(state_key) DO UPDATE SET
        state_value=excluded.state_value,
        updated_at=excluded.updated_at;
    `
    );
  }

  async clearAll() {
    await this.init();
    await runSql(
      this.dbPath,
      `
      DELETE FROM playlist_tracks;
      DELETE FROM playlist_fingerprints;
      DELETE FROM playlists;
      DELETE FROM exports;
      DELETE FROM sync_state WHERE state_key NOT IN ('schema_version');
    `
    );
  }

  async setSyncState(key, value) {
    await this.init();
    const now = toIsoNow();
    await runSql(
      this.dbPath,
      `
      INSERT INTO sync_state(state_key, state_value, updated_at)
      VALUES (${sqlLiteral(key)}, ${sqlLiteral(typeof value === "string" ? value : JSON.stringify(value))}, ${sqlLiteral(now)})
      ON CONFLICT(state_key) DO UPDATE SET
        state_value=excluded.state_value,
        updated_at=excluded.updated_at;
    `
    );
  }

  async getSyncState(key) {
    await this.init();
    const rows = await runSql(
      this.dbPath,
      `SELECT state_value AS value FROM sync_state WHERE state_key = ${sqlLiteral(key)} LIMIT 1;`,
      { json: true }
    );
    return rows[0]?.value ?? "";
  }

  async getStatus() {
    await this.init();
    const counts = await runSql(
      this.dbPath,
      `
      SELECT
        (SELECT COUNT(*) FROM playlists) AS playlists,
        (SELECT COUNT(*) FROM playlist_tracks) AS tracks,
        (SELECT COUNT(*) FROM playlists WHERE is_duplicate_candidate = 1) AS duplicateCandidates,
        (SELECT COUNT(*) FROM playlists WHERE is_duplicate_confirmed = 1) AS duplicateConfirmed,
        (SELECT COUNT(*) FROM playlists WHERE dirty = 1) AS dirtyPlaylists,
        (SELECT COUNT(*) FROM playlists WHERE last_deep_analyzed_at IS NOT NULL AND last_deep_analyzed_at <> '') AS analyzedPlaylists;
      `,
      { json: true }
    );
    const syncRows = await runSql(
      this.dbPath,
      `SELECT state_key AS key, state_value AS value, updated_at AS updatedAt FROM sync_state ORDER BY state_key;`,
      { json: true }
    );
    const exportRows = await runSql(
      this.dbPath,
      `SELECT export_key AS exportKey, export_path AS exportPath, generated_at AS generatedAt, row_count AS rowCount FROM exports ORDER BY export_key;`,
      { json: true }
    );
    return {
      dbPath: this.dbPath,
      exists: existsSync(this.dbPath),
      counts: counts[0] || {
        playlists: 0,
        tracks: 0,
        duplicateCandidates: 0,
        duplicateConfirmed: 0,
        dirtyPlaylists: 0,
        analyzedPlaylists: 0,
      },
      syncState: syncRows,
      exports: exportRows,
    };
  }

  async listPlaylists() {
    await this.init();
    return await runSql(
      this.dbPath,
      `
      SELECT
        playlist_key AS identity,
        playlist_key AS cacheKey,
        playlist_id AS id,
        name,
        tracks,
        playlist_dom_key AS key,
        source,
        server_track_count AS serverTrackCount,
        discovered_at AS discoveredAt,
        server_seen_at AS serverSeenAt,
        last_seen_at AS lastSeenAt,
        last_deep_analyzed_at AS lastDeepAnalyzedAt,
        sync_state AS syncState,
        dirty,
        is_duplicate_candidate AS isDuplicateCandidate,
        is_duplicate_confirmed AS isDuplicateConfirmed,
        track_fingerprint AS trackFingerprint,
        CASE WHEN is_duplicate_candidate = 1 OR is_duplicate_confirmed = 1 THEN 1 ELSE 0 END AS isDuplicate,
        CASE WHEN last_deep_analyzed_at IS NOT NULL AND last_deep_analyzed_at <> '' THEN 1 ELSE 0 END AS isAnalyzed
      FROM playlists
      ORDER BY LOWER(name), playlist_id, playlist_key;
      `,
      { json: true }
    );
  }

  async getPlaylistRecord(query = {}) {
    await this.init();
    const playlistId = normalizeText(query.playlistId ?? query.id ?? "");
    const playlistKey = normalizePlaylistKey(query);
    const where = playlistId
      ? `playlist_id = ${sqlLiteral(playlistId)} OR playlist_key = ${sqlLiteral(playlistKey)}`
      : `playlist_key = ${sqlLiteral(playlistKey)}`;
    const rows = await runSql(
      this.dbPath,
      `
      SELECT
        playlist_key AS playlistKey,
        playlist_id AS playlistId,
        name,
        tracks,
        playlist_dom_key AS key,
        source,
        server_track_count AS serverTrackCount,
        discovered_at AS discoveredAt,
        server_seen_at AS serverSeenAt,
        last_seen_at AS lastSeenAt,
        last_deep_analyzed_at AS lastDeepAnalyzedAt,
        sync_state AS syncState,
        dirty,
        is_duplicate_candidate AS isDuplicateCandidate,
        is_duplicate_confirmed AS isDuplicateConfirmed,
        track_fingerprint AS trackFingerprint,
        last_run_id AS lastRunId
      FROM playlists
      WHERE ${where}
      ORDER BY CASE WHEN playlist_id = ${sqlLiteral(playlistId)} THEN 0 ELSE 1 END
      LIMIT 1;
      `,
      { json: true }
    );
    return rows[0] || null;
  }

  async getPlaylistDetails(query = {}) {
    await this.init();
    const playlist = await this.getPlaylistRecord(query);
    if (!playlist) {
      return null;
    }
    const trackRows = await runSql(
      this.dbPath,
      `
      SELECT
        track_index AS trackIndex,
        track_id AS trackId,
        track_title AS trackTitle,
        artists,
        genre,
        label,
        year,
        release,
        release_date AS releaseDate,
        release_year AS releaseYear,
        bpm,
        musical_key AS key,
        mix_name AS mixName,
        source
      FROM playlist_tracks
      WHERE playlist_key = ${sqlLiteral(playlist.playlistKey)}
      ORDER BY track_index, track_id, track_row_key;
      `,
      { json: true }
    );
    return { playlist, trackRows };
  }

  async upsertPlaylists(playlists = [], options = {}) {
    await this.init();
    if (!Array.isArray(playlists) || playlists.length === 0) {
      return { inserted: 0, updated: 0 };
    }
    const now = options.now || toIsoNow();
    const existingMap = new Map(
      (await this.listPlaylists()).map((entry) => [entry.cacheKey || entry.identity, entry])
    );
    const statements = ["BEGIN;"];
    let inserted = 0;
    let updated = 0;

    for (const item of playlists) {
      const record = normalizePlaylistRecord(item, {
        now,
        source: options.source,
        syncState: options.syncState,
        dirty: options.dirty,
        lastRunId: options.lastRunId,
      });
      if (!record.playlistKey) continue;
      if (existingMap.has(record.playlistKey)) {
        updated += 1;
      } else {
        inserted += 1;
      }
      statements.push(`
        INSERT INTO playlists (
          playlist_key, playlist_id, name, tracks, playlist_dom_key, source,
          server_track_count, discovered_at, server_seen_at, last_seen_at,
          last_deep_analyzed_at, sync_state, dirty, is_duplicate_candidate,
          is_duplicate_confirmed, track_fingerprint, last_run_id, updated_at
        ) VALUES (
          ${sqlLiteral(record.playlistKey)}, ${sqlLiteral(record.playlistId || null)}, ${sqlLiteral(record.name || null)}, ${sqlLiteral(record.tracks || null)},
          ${sqlLiteral(record.key || null)}, ${sqlLiteral(record.source || null)}, ${sqlLiteral(record.serverTrackCount)}, ${sqlLiteral(record.discoveredAt)},
          ${sqlLiteral(record.serverSeenAt)}, ${sqlLiteral(record.lastSeenAt)}, ${sqlLiteral(record.lastDeepAnalyzedAt || null)}, ${sqlLiteral(record.syncState)}, ${sqlLiteral(record.dirty)},
          ${sqlLiteral(record.isDuplicateCandidate)}, ${sqlLiteral(record.isDuplicateConfirmed)}, ${sqlLiteral(record.trackFingerprint || null)}, ${sqlLiteral(record.lastRunId || null)}, ${sqlLiteral(record.updatedAt)}
        )
        ON CONFLICT(playlist_key) DO UPDATE SET
          playlist_id = COALESCE(excluded.playlist_id, playlists.playlist_id),
          name = COALESCE(excluded.name, playlists.name),
          tracks = COALESCE(excluded.tracks, playlists.tracks),
          playlist_dom_key = COALESCE(excluded.playlist_dom_key, playlists.playlist_dom_key),
          source = COALESCE(excluded.source, playlists.source),
          server_track_count = CASE WHEN excluded.server_track_count > 0 THEN excluded.server_track_count ELSE playlists.server_track_count END,
          discovered_at = COALESCE(playlists.discovered_at, excluded.discovered_at),
          server_seen_at = COALESCE(excluded.server_seen_at, playlists.server_seen_at),
          last_seen_at = COALESCE(excluded.last_seen_at, playlists.last_seen_at),
          last_deep_analyzed_at = COALESCE(excluded.last_deep_analyzed_at, playlists.last_deep_analyzed_at),
          sync_state = COALESCE(excluded.sync_state, playlists.sync_state),
          dirty = excluded.dirty,
          is_duplicate_candidate = excluded.is_duplicate_candidate,
          is_duplicate_confirmed = excluded.is_duplicate_confirmed,
          track_fingerprint = COALESCE(excluded.track_fingerprint, playlists.track_fingerprint),
          last_run_id = COALESCE(excluded.last_run_id, playlists.last_run_id),
          updated_at = excluded.updated_at;
      `);
    }
    statements.push("COMMIT;");
    await runSql(this.dbPath, statements.join("\n"));
    return { inserted, updated };
  }

  async markMissingPlaylists(seenKeys = [], seenAt = toIsoNow()) {
    await this.init();
    const normalized = [...new Set((Array.isArray(seenKeys) ? seenKeys : []).map((value) => normalizeText(value)).filter(Boolean))];
    const predicate = normalized.length
      ? `WHERE playlist_key NOT IN (${normalized.map((value) => sqlLiteral(value)).join(", ")})`
      : "";
    await runSql(
      this.dbPath,
      `
      UPDATE playlists
      SET sync_state = 'missing', dirty = 0, updated_at = ${sqlLiteral(seenAt)}
      ${predicate};
    `
    );
  }

  async replacePlaylistAnalysis(summary = {}, trackRows = [], options = {}) {
    await this.init();
    const now = options.now || toIsoNow();
    const playlistKey = normalizePlaylistKey(summary);
    if (!playlistKey) {
      throw new Error("Cache-Analyse ohne Playlist-Key nicht möglich.");
    }
    const playlistRecord = normalizePlaylistRecord(
      {
        ...summary,
        id: summary.playlistId,
        name: summary.playlistName,
        tracks: summary.playlistTracksExpected,
        source: summary.source || summary.analysisMethod,
        trackFingerprint: summary.trackFingerprint,
        serverTrackCount: summary.serverTrackCount,
        lastDeepAnalyzedAt: now,
        syncState: options.syncState || "current",
        dirty: 0,
      },
      {
        now,
        source: summary.source || summary.analysisMethod,
        syncState: options.syncState || "current",
        dirty: 0,
        lastRunId: options.lastRunId,
      }
    );
    const normalizedTracks = (Array.isArray(trackRows) ? trackRows : []).map((entry) =>
      normalizeTrackRecord(entry, playlistKey, {
        now,
        source: summary.source || summary.analysisMethod || entry.source || "xhr",
      })
    );
    const statements = ["BEGIN;"];
    statements.push(`
      INSERT INTO playlists (
        playlist_key, playlist_id, name, tracks, playlist_dom_key, source,
        server_track_count, discovered_at, server_seen_at, last_seen_at,
        last_deep_analyzed_at, sync_state, dirty, is_duplicate_candidate,
        is_duplicate_confirmed, track_fingerprint, last_run_id, updated_at
      ) VALUES (
        ${sqlLiteral(playlistRecord.playlistKey)}, ${sqlLiteral(playlistRecord.playlistId || null)}, ${sqlLiteral(playlistRecord.name || null)}, ${sqlLiteral(playlistRecord.tracks || null)},
        ${sqlLiteral(playlistRecord.key || null)}, ${sqlLiteral(playlistRecord.source || null)}, ${sqlLiteral(playlistRecord.serverTrackCount)}, ${sqlLiteral(playlistRecord.discoveredAt)},
        ${sqlLiteral(playlistRecord.serverSeenAt)}, ${sqlLiteral(playlistRecord.lastSeenAt)}, ${sqlLiteral(now)}, ${sqlLiteral(options.syncState || "current")}, 0,
        0, 0, ${sqlLiteral(summary.trackFingerprint || null)}, ${sqlLiteral(options.lastRunId || null)}, ${sqlLiteral(now)}
      ) ON CONFLICT(playlist_key) DO UPDATE SET
        playlist_id = COALESCE(excluded.playlist_id, playlists.playlist_id),
        name = COALESCE(excluded.name, playlists.name),
        tracks = COALESCE(excluded.tracks, playlists.tracks),
        playlist_dom_key = COALESCE(excluded.playlist_dom_key, playlists.playlist_dom_key),
        source = COALESCE(excluded.source, playlists.source),
        server_track_count = CASE WHEN excluded.server_track_count > 0 THEN excluded.server_track_count ELSE playlists.server_track_count END,
        server_seen_at = COALESCE(excluded.server_seen_at, playlists.server_seen_at),
        last_seen_at = COALESCE(excluded.last_seen_at, playlists.last_seen_at),
        last_deep_analyzed_at = excluded.last_deep_analyzed_at,
        sync_state = excluded.sync_state,
        dirty = 0,
        track_fingerprint = COALESCE(excluded.track_fingerprint, playlists.track_fingerprint),
        last_run_id = COALESCE(excluded.last_run_id, playlists.last_run_id),
        updated_at = excluded.updated_at;
    `);
    statements.push(`DELETE FROM playlist_tracks WHERE playlist_key = ${sqlLiteral(playlistKey)};`);
    for (const group of chunk(normalizedTracks, 250)) {
      for (const row of group) {
        statements.push(`
          INSERT INTO playlist_tracks (
            playlist_key, track_row_key, track_index, track_id, track_title, artists,
            genre, label, year, release, release_date, release_year, bpm,
            musical_key, mix_name, source, updated_at
          ) VALUES (
            ${sqlLiteral(row.playlistKey)}, ${sqlLiteral(row.trackRowKey)}, ${sqlLiteral(row.trackIndex)}, ${sqlLiteral(row.trackId || null)},
            ${sqlLiteral(row.trackTitle || null)}, ${sqlLiteral(row.artists || null)}, ${sqlLiteral(row.genre || null)}, ${sqlLiteral(row.label || null)},
            ${sqlLiteral(row.year || null)}, ${sqlLiteral(row.release || null)}, ${sqlLiteral(row.releaseDate || null)}, ${sqlLiteral(row.releaseYear || null)},
            ${sqlLiteral(row.bpm || null)}, ${sqlLiteral(row.musicalKey || null)}, ${sqlLiteral(row.mixName || null)}, ${sqlLiteral(row.source || null)}, ${sqlLiteral(now)}
          );
        `);
      }
    }
    statements.push(`
      INSERT INTO playlist_fingerprints (playlist_key, fingerprint, analyzed_track_rows, updated_at)
      VALUES (${sqlLiteral(playlistKey)}, ${sqlLiteral(summary.trackFingerprint || null)}, ${sqlLiteral(normalizedTracks.length)}, ${sqlLiteral(now)})
      ON CONFLICT(playlist_key) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        analyzed_track_rows = excluded.analyzed_track_rows,
        updated_at = excluded.updated_at;
    `);
    statements.push("COMMIT;");
    await runSql(this.dbPath, statements.join("\n"));
  }

  async markPlaylistDeferred(query = {}, reason = "deferred") {
    await this.init();
    const playlistKey = normalizePlaylistKey(query);
    if (!playlistKey) return;
    await runSql(
      this.dbPath,
      `
      UPDATE playlists
      SET sync_state = ${sqlLiteral(reason)}, dirty = 1, updated_at = ${sqlLiteral(toIsoNow())}
      WHERE playlist_key = ${sqlLiteral(playlistKey)};
    `
    );
  }

  async applyDuplicateEntries(duplicates = []) {
    await this.init();
    const now = toIsoNow();
    const statements = [
      `UPDATE playlists SET is_duplicate_candidate = 0, is_duplicate_confirmed = 0, updated_at = ${sqlLiteral(now)};`,
      "BEGIN;",
    ];
    for (const entry of Array.isArray(duplicates) ? duplicates : []) {
      const playlistKey = normalizePlaylistKey(entry);
      if (!playlistKey) continue;
      const confirmed = normalizeText(entry.duplicateStatus) === "confirmed" ? 1 : 0;
      statements.push(`
        UPDATE playlists
        SET is_duplicate_candidate = 1,
            is_duplicate_confirmed = ${confirmed},
            track_fingerprint = COALESCE(${sqlLiteral(normalizeText(entry.trackFingerprint) || null)}, track_fingerprint),
            updated_at = ${sqlLiteral(now)}
        WHERE playlist_key = ${sqlLiteral(playlistKey)};
      `);
    }
    statements.push("COMMIT;");
    await runSql(this.dbPath, statements.join("\n"));
  }

  async getAllTrackRows() {
    await this.init();
    return await runSql(
      this.dbPath,
      `
      SELECT
        t.track_id AS trackId,
        t.track_title AS trackTitle,
        t.artists,
        t.genre,
        t.label,
        t.bpm,
        t.musical_key AS key,
        t.mix_name AS mixName,
        t.release_year AS releaseYear,
        t.playlist_key AS playlistKey,
        p.name AS playlistName,
        p.playlist_id AS playlistId
      FROM playlist_tracks t
      JOIN playlists p ON p.playlist_key = t.playlist_key
      WHERE p.sync_state <> 'missing'
      ORDER BY p.name, t.track_index;
      `,
      { json: true }
    );
  }

  async getPlaylistOverlapMatrix() {
    await this.init();
    return await runSql(
      this.dbPath,
      `
      SELECT
        a.playlist_key AS playlistA,
        pa.name AS nameA,
        b.playlist_key AS playlistB,
        pb.name AS nameB,
        COUNT(DISTINCT a.track_id) AS sharedTracks
      FROM playlist_tracks a
      JOIN playlist_tracks b
        ON a.track_id = b.track_id
        AND a.track_id IS NOT NULL
        AND a.track_id <> ''
        AND a.playlist_key < b.playlist_key
      JOIN playlists pa ON pa.playlist_key = a.playlist_key AND pa.sync_state <> 'missing'
      JOIN playlists pb ON pb.playlist_key = b.playlist_key AND pb.sync_state <> 'missing'
      GROUP BY a.playlist_key, b.playlist_key
      HAVING sharedTracks >= 2
      ORDER BY sharedTracks DESC
      LIMIT 200;
      `,
      { json: true }
    );
  }

  async writeExportRecord(exportKey, exportPath, rowCount = 0) {
    await this.init();
    await runSql(
      this.dbPath,
      `
      INSERT INTO exports(export_key, export_path, generated_at, row_count)
      VALUES (${sqlLiteral(exportKey)}, ${sqlLiteral(exportPath)}, ${sqlLiteral(toIsoNow())}, ${sqlLiteral(rowCount)})
      ON CONFLICT(export_key) DO UPDATE SET
        export_path = excluded.export_path,
        generated_at = excluded.generated_at,
        row_count = excluded.row_count;
    `
    );
  }
}
