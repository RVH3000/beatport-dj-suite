/**
 * xhr-scanner.mjs — XHR-basierter Beatport API Client + Daten-Store
 *
 * Modul-Exporte für Electron-App und CLI-Wrapper (tools/bpx.mjs).
 * Nutzt die Beatport REST API (v4) direkt, ohne DOM-Scraping.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";

// ─── Konfiguration ─────────────────────────────────────────────────────────────

export const USER_DATA_PATHS = [
  path.join(
    process.env.HOME || "~",
    "Library/Application Support/beatport-dj-suite"
  ),
  path.join(
    process.env.HOME || "~",
    "Library/Application Support/beatport-playlist-scanner"
  ),
  path.join(
    process.env.HOME || "~",
    ".config/beatport-playlist-scanner"
  ),
];

export const API_BASE = "https://api.beatport.com/v4";
export const PER_PAGE = 100;
export const TRACKS_PER_PAGE = 100;
export const DEFAULT_CONCURRENCY = 3;
export const REQUEST_DELAY_MS = 200;
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 2000;

// ─── Hilfsfunktionen ───────────────────────────────────────────────────────────

export function log(msg) {
  process.stderr.write(`[xhr-tool] ${msg}\n`);
}

export function logProgress(current, total, label = "") {
  const pct = total > 0 ? ((current / total) * 100).toFixed(1) : "?";
  process.stderr.write(
    `\r[xhr-tool] ${label} ${current}/${total} (${pct}%)   `
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      args.flags[key] = rest.length > 0 ? rest.join("=") : true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

// ─── API-Kontext laden ─────────────────────────────────────────────────────────

export async function findContextFile(explicitPath) {
  if (explicitPath) {
    if (existsSync(explicitPath)) return explicitPath;
    throw new Error(`Angegebene Kontextdatei nicht gefunden: ${explicitPath}`);
  }
  for (const base of USER_DATA_PATHS) {
    const candidate = path.join(base, "api-context.json");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `api-context.json nicht gefunden. Bitte im Scanner: Auth → API-Kontext exportieren.\n` +
      `Oder manuell angeben: --context=/pfad/zu/api-context.json`
  );
}

export async function loadApiContext(explicitPath) {
  const filePath = await findContextFile(explicitPath);
  const raw = await fs.readFile(filePath, "utf-8");
  const ctx = JSON.parse(raw);
  if (!ctx.authorization) {
    throw new Error(
      "API-Kontext enthält kein Authorization-Token. Bitte neu exportieren."
    );
  }
  const age = Date.now() - new Date(ctx.exportedAt || ctx.observedAt || 0).getTime();
  if (age > 30 * 60 * 1000) {
    log(
      `⚠ API-Kontext ist ${Math.round(age / 60000)} Minuten alt. ` +
        `Token könnte abgelaufen sein. Bei 401-Fehlern bitte neu exportieren.`
    );
  }
  return ctx;
}

// ─── Beatport API Client ───────────────────────────────────────────────────────

export class BeatportXhrClient {
  constructor(context) {
    this.context = context;
    this.requestCount = 0;
    this.lastRequestAt = 0;
  }

  async fetch(url, options = {}) {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - elapsed);
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      this.lastRequestAt = Date.now();
      this.requestCount++;

      const response = await globalThis.fetch(url, {
        method: options.method || "GET",
        headers: {
          accept: this.context.accept || "application/json, text/plain, */*",
          authorization: this.context.authorization,
          referer: this.context.referer || "https://dj.beatport.com/",
          "user-agent": this.context.userAgent || "",
          ...(options.headers || {}),
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });

      if (response.status === 429) {
        const retryAfter =
          parseInt(response.headers.get("retry-after") || "5", 10) * 1000;
        log(`Rate-Limit erreicht. Warte ${retryAfter / 1000}s...`);
        await sleep(retryAfter);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Auth-Fehler ${response.status} für ${url}. ` +
            `Token vermutlich abgelaufen — bitte im Scanner neu exportieren.`
        );
      }

      if (!response.ok) {
        if (attempt < MAX_RETRIES) {
          log(`HTTP ${response.status} für ${url} — Retry ${attempt}/${MAX_RETRIES}...`);
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw new Error(`Beatport API ${response.status}: ${url}`);
      }

      return await response.json();
    }
  }

  async discoverAllPlaylists() {
    const playlists = [];
    let page = 1;
    let hasMore = true;

    log("Starte Playlist-Discovery via XHR...");
    while (hasMore) {
      const url = `${API_BASE}/my/playlists/?per_page=${PER_PAGE}&page=${page}`;
      const payload = await this.fetch(url);
      const results = Array.isArray(payload?.results) ? payload.results : [];

      for (const entry of results) {
        playlists.push(normalizePlaylist(entry));
      }

      logProgress(playlists.length, payload?.count || "?", "Playlisten");

      if (payload?.next) {
        page++;
      } else {
        hasMore = false;
      }
    }

    process.stderr.write("\n");
    log(`Discovery abgeschlossen: ${playlists.length} Playlisten gefunden.`);
    return playlists;
  }

  async fetchPlaylistTracks(playlistId) {
    const rows = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${API_BASE}/my/playlists/${playlistId}/tracks/?per_page=${TRACKS_PER_PAGE}&page=${page}`;
      const payload = await this.fetch(url);
      const results = Array.isArray(payload?.results) ? payload.results : [];
      rows.push(...results.map((t) => normalizeTrack(playlistId, t)));

      if (payload?.next) {
        page++;
      } else {
        hasMore = false;
      }
    }

    return rows;
  }

  async fetchPlaylistMeta(playlistId) {
    const url = `${API_BASE}/my/playlists/${playlistId}/`;
    return await this.fetch(url);
  }

  async addTracksToPlaylist(playlistId, trackIds) {
    const url = `${API_BASE}/my/playlists/${playlistId}/tracks/`;
    const results = [];
    for (const trackId of trackIds) {
      try {
        const res = await this.fetch(url, {
          method: "POST",
          body: { track_id: Number(trackId) },
        });
        results.push({ trackId, status: "added", response: res });
        log(`Track ${trackId} → Playlist ${playlistId}: ✓ hinzugefügt`);
      } catch (error) {
        results.push({ trackId, status: "error", error: error.message });
        log(`Track ${trackId} → Playlist ${playlistId}: ✗ ${error.message}`);
      }
    }
    return results;
  }

  async removeTracksFromPlaylist(playlistId, trackIds) {
    const results = [];
    for (const trackId of trackIds) {
      try {
        const url = `${API_BASE}/my/playlists/${playlistId}/tracks/${trackId}/`;
        await this.fetch(url, { method: "DELETE" });
        results.push({ trackId, status: "removed" });
        log(`Track ${trackId} aus Playlist ${playlistId}: ✓ entfernt`);
      } catch (error) {
        results.push({ trackId, status: "error", error: error.message });
        log(`Track ${trackId} aus Playlist ${playlistId}: ✗ ${error.message}`);
      }
    }
    return results;
  }

  async renamePlaylist(playlistId, newName) {
    const url = `${API_BASE}/my/playlists/${playlistId}/`;
    const result = await this.fetch(url, {
      method: "PATCH",
      body: { name: newName },
    });
    log(`Playlist ${playlistId} umbenannt zu: "${newName}"`);
    return result;
  }

  async createPlaylist(name) {
    const url = `${API_BASE}/my/playlists/`;
    const result = await this.fetch(url, {
      method: "POST",
      body: { name },
    });
    log(`Playlist erstellt: "${name}" (ID: ${result?.id})`);
    return result;
  }

  async deletePlaylist(playlistId) {
    const url = `${API_BASE}/my/playlists/${playlistId}/`;
    await this.fetch(url, { method: "DELETE" });
    log(`Playlist ${playlistId} gelöscht.`);
    return { ok: true };
  }
}

// ─── Normalisierung ────────────────────────────────────────────────────────────

export function normalizePlaylist(entry) {
  return {
    id: String(entry.id || ""),
    name: String(entry.name || ""),
    trackCount: Number(entry.track_count ?? 0),
    isPublic: Boolean(entry.is_public),
    createdAt: entry.created || "",
    updatedAt: entry.updated || "",
    imageUrl: entry.image?.uri || "",
    source: "xhr",
  };
}

export function normalizeTrack(playlistId, entry) {
  const track = entry.track || entry;
  const artists = Array.isArray(track.artists)
    ? track.artists.map((a) => a.name).join(", ")
    : "";
  const remixers = Array.isArray(track.remixers)
    ? track.remixers.map((a) => a.name).join(", ")
    : "";
  const genre =
    track.genre?.name ||
    (Array.isArray(track.sub_genres) && track.sub_genres[0]?.name) ||
    "";
  const label = track.release?.label?.name || track.label?.name || "";

  return {
    playlistId,
    trackId: String(track.id || ""),
    title: String(track.name || ""),
    mixName: String(track.mix_name || ""),
    artists,
    remixers,
    genre,
    subGenre: Array.isArray(track.sub_genres)
      ? track.sub_genres.map((g) => g.name).join(", ")
      : "",
    label,
    releaseDate: track.new_release_date || track.publish_date || "",
    bpm: Number(track.bpm || 0),
    key: track.key?.name || "",
    duration: Number(track.length_ms || 0),
    isrc: track.isrc || "",
    catalogNumber: track.catalog_number || "",
    source: "xhr",
  };
}

// ─── Daten-Store (lokaler JSON-Cache) ──────────────────────────────────────────

export class DataStore {
  constructor(basePath) {
    this.basePath = basePath;
    this.playlistsFile = path.join(basePath, "xhr-playlists.json");
    this.tracksDir = path.join(basePath, "xhr-tracks");
  }

  async init() {
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.mkdir(this.tracksDir, { recursive: true });
  }

  async savePlaylists(playlists) {
    await fs.writeFile(
      this.playlistsFile,
      JSON.stringify(playlists, null, 2),
      "utf-8"
    );
  }

  async loadPlaylists() {
    try {
      const raw = await fs.readFile(this.playlistsFile, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async savePlaylistTracks(playlistId, tracks) {
    await fs.writeFile(
      path.join(this.tracksDir, `${playlistId}.json`),
      JSON.stringify(tracks, null, 2),
      "utf-8"
    );
  }

  async loadPlaylistTracks(playlistId) {
    try {
      const raw = await fs.readFile(
        path.join(this.tracksDir, `${playlistId}.json`),
        "utf-8"
      );
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async getAllTracks() {
    const playlists = await this.loadPlaylists();
    const all = [];
    for (const pl of playlists) {
      const tracks = await this.loadPlaylistTracks(pl.id);
      if (tracks) all.push(...tracks);
    }
    return all;
  }
}

// ─── CSV-Helper ─────────────────────────────────────────────────────────────────

// csvEscape ist jetzt in utils/common.mjs zentralisiert
export { csvEscape } from "../utils/common.mjs";
