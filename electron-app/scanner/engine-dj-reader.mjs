/**
 * engine-dj-reader.mjs — Read-Only Engine DJ Database Reader
 *
 * Liest Playlists, Tracks und History aus Engine DJ Datenbanken.
 * SCHREIBT NIEMALS in die Datenbank — nur SELECT Queries.
 *
 * Engine DJ DB-Struktur:
 *   Engine Library/Database2/m.db   — Haupt-DB (Playlists, Tracks)
 *   Engine Library/Database2/hm.db  — History-DB (Historylist)
 *
 * Export-Formate fuer Lexicon:
 *   - CSV (Tracks + Playlists)
 *   - M3U (Playlists als Dateilisten)
 *   - Rekordbox XML (experimentell)
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ── Engine DJ Library Pfade ───────────────────────────────────────

const KNOWN_LIBRARY_ROOTS = [
  join(homedir(), "Music"),
  "/Volumes/AMIN_STUDIO",
  "/Volumes/MOVESPEED",
];

/**
 * Findet alle Engine DJ Datenbanken auf dem System.
 * @returns {Array<{root: string, mainDb: string, historyDb: string, label: string}>}
 */
export function findEngineDatabases(extraRoots = []) {
  const roots = [...KNOWN_LIBRARY_ROOTS, ...extraRoots];
  const found = [];

  for (const root of roots) {
    const mainDb = join(root, "Engine Library", "Database2", "m.db");
    const historyDb = join(root, "Engine Library", "Database2", "hm.db");

    if (existsSync(mainDb)) {
      found.push({
        root,
        mainDb,
        historyDb: existsSync(historyDb) ? historyDb : null,
        label: basename(root),
      });
    }
  }
  return found;
}

// ── Database Helper ───────────────────────────────────────────────

function openReadOnly(dbPath) {
  if (!existsSync(dbPath)) {
    throw new Error(`Datenbank nicht gefunden: ${dbPath}`);
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

// ── Playlists ─────────────────────────────────────────────────────

/**
 * Liest alle Playlists aus der Engine DJ Datenbank.
 * @param {string} dbPath — Pfad zur m.db
 * @returns {Array<{id, title, parentListId, trackCount, isPersisted}>}
 */
export function readPlaylists(dbPath) {
  const db = openReadOnly(dbPath);
  try {
    const rows = db
      .prepare(`
        SELECT p.id, p.title, p.parentListId, p.isPersisted,
               (SELECT COUNT(*) FROM PlaylistEntity pe WHERE pe.listId = p.id) as trackCount
        FROM Playlist p
        ORDER BY p.parentListId, p.title
      `)
      .all();
    return rows;
  } finally {
    db.close();
  }
}

/**
 * Liest alle Tracks einer Playlist.
 * @param {string} dbPath
 * @param {number} playlistId
 * @returns {Array<{id, title, artist, filename, path, bpm, key, genre, rating, duration}>}
 */
export function readPlaylistTracks(dbPath, playlistId) {
  const db = openReadOnly(dbPath);
  try {
    const rows = db
      .prepare(`
        SELECT t.id, t.title, t.artist, t.filename, t.path,
               t.bpmAnalyzed as bpm, t.keyText as key,
               t.genre, t.rating, t.length as duration
        FROM PlaylistEntity pe
        JOIN Track t ON t.id = pe.trackId
        WHERE pe.listId = ?
        ORDER BY pe.id
      `)
      .all(playlistId);
    return rows;
  } finally {
    db.close();
  }
}

// ── Tracks ────────────────────────────────────────────────────────

/**
 * Liest alle Tracks aus der Datenbank.
 * @param {string} dbPath
 * @param {object} options — { limit, offset, search }
 */
export function readTracks(dbPath, { limit = 500, offset = 0, search = "" } = {}) {
  const db = openReadOnly(dbPath);
  try {
    let query = `
      SELECT id, title, artist, filename, path,
             bpmAnalyzed as bpm, keyText as key,
             genre, rating, length as duration
      FROM Track
    `;
    const params = [];
    if (search) {
      query += ` WHERE title LIKE ? OR artist LIKE ?`;
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ` ORDER BY title LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return db.prepare(query).all(...params);
  } finally {
    db.close();
  }
}

/**
 * Zaehlt alle Tracks.
 */
export function countTracks(dbPath) {
  const db = openReadOnly(dbPath);
  try {
    return db.prepare("SELECT COUNT(*) as count FROM Track").get().count;
  } finally {
    db.close();
  }
}

// ── History ───────────────────────────────────────────────────────

/**
 * Liest die Play-History aus hm.db.
 * @param {string} historyDbPath — Pfad zur hm.db
 * @returns {Array<{id, startTime, timezone, date, tracks: Array}>}
 */
export function readHistory(historyDbPath) {
  const db = openReadOnly(historyDbPath);
  try {
    const sessions = db
      .prepare("SELECT id, startTime, timezone FROM Historylist ORDER BY startTime DESC")
      .all();

    return sessions.map((session) => {
      const trackIds = db
        .prepare("SELECT trackId FROM HistorylistEntity WHERE listId = ?")
        .all(session.id);

      const tracks = trackIds.map(({ trackId }) => {
        const track = db
          .prepare("SELECT title, artist FROM Track WHERE id = ?")
          .get(trackId);
        return track || { title: "Unknown", artist: "Unknown" };
      });

      const date = new Date(session.startTime * 1000);

      return {
        id: session.id,
        startTime: session.startTime,
        timezone: session.timezone,
        date: date.toISOString(),
        dateFormatted: date.toLocaleDateString("de-DE", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit",
        }),
        trackCount: tracks.length,
        tracks,
      };
    });
  } finally {
    db.close();
  }
}

// ── Export: CSV ────────────────────────────────────────────────────

function escCsv(val) {
  if (val == null) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/**
 * Exportiert eine Playlist als CSV.
 */
export async function exportPlaylistCsv(dbPath, playlistId, outputDir) {
  const tracks = readPlaylistTracks(dbPath, playlistId);
  const playlists = readPlaylists(dbPath);
  const playlist = playlists.find((p) => p.id === playlistId);
  const name = playlist ? playlist.title : `playlist_${playlistId}`;

  await mkdir(outputDir, { recursive: true });

  const header = "Title,Artist,BPM,Key,Genre,Rating,Duration,Filename,Path";
  const rows = tracks.map(
    (t) =>
      [t.title, t.artist, t.bpm, t.key, t.genre, t.rating, t.duration, t.filename, t.path]
        .map(escCsv)
        .join(",")
  );

  const csv = [header, ...rows].join("\n");
  const outPath = join(outputDir, `${name.replace(/[/\\:*?"<>|]/g, "_")}.csv`);
  await writeFile(outPath, csv, "utf-8");
  return { path: outPath, trackCount: tracks.length };
}

/**
 * Exportiert die History als CSV.
 */
export async function exportHistoryCsv(historyDbPath, outputDir) {
  const history = readHistory(historyDbPath);
  await mkdir(outputDir, { recursive: true });

  const header = "Session Date,Track #,Title,Artist";
  const rows = [];
  for (const session of history) {
    session.tracks.forEach((t, i) => {
      rows.push(
        [session.dateFormatted, i + 1, t.title, t.artist].map(escCsv).join(",")
      );
    });
  }

  const csv = [header, ...rows].join("\n");
  const outPath = join(outputDir, "engine_dj_history.csv");
  await writeFile(outPath, csv, "utf-8");
  return { path: outPath, sessionCount: history.length, trackCount: rows.length };
}

// ── Export: M3U ───────────────────────────────────────────────────

/**
 * Exportiert eine Playlist als M3U.
 */
export async function exportPlaylistM3u(dbPath, playlistId, outputDir) {
  const tracks = readPlaylistTracks(dbPath, playlistId);
  const playlists = readPlaylists(dbPath);
  const playlist = playlists.find((p) => p.id === playlistId);
  const name = playlist ? playlist.title : `playlist_${playlistId}`;

  await mkdir(outputDir, { recursive: true });

  const lines = ["#EXTM3U", `#PLAYLIST:${name}`];
  for (const t of tracks) {
    const dur = Math.round(t.duration || 0);
    lines.push(`#EXTINF:${dur},${t.artist || "Unknown"} - ${t.title || "Unknown"}`);
    lines.push(t.path || t.filename || "");
  }

  const outPath = join(outputDir, `${name.replace(/[/\\:*?"<>|]/g, "_")}.m3u`);
  await writeFile(outPath, lines.join("\n"), "utf-8");
  return { path: outPath, trackCount: tracks.length };
}

// ── Quick Summary ─────────────────────────────────────────────────

/**
 * Gibt eine schnelle Zusammenfassung der Engine DJ Library.
 */
export function getLibrarySummary(dbPath, historyDbPath = null) {
  const db = openReadOnly(dbPath);
  let summary;
  try {
    const trackCount = db.prepare("SELECT COUNT(*) as c FROM Track").get().c;
    const playlistCount = db.prepare("SELECT COUNT(*) as c FROM Playlist WHERE isPersisted = 1").get().c;
    const playlistEntryCount = db.prepare("SELECT COUNT(*) as c FROM PlaylistEntity").get().c;

    summary = { trackCount, playlistCount, playlistEntryCount };
  } finally {
    db.close();
  }

  if (historyDbPath && existsSync(historyDbPath)) {
    const hdb = openReadOnly(historyDbPath);
    try {
      summary.historySessionCount = hdb.prepare("SELECT COUNT(*) as c FROM Historylist").get().c;
    } finally {
      hdb.close();
    }
  }

  return summary;
}
