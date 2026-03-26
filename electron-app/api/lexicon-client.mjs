/**
 * Lexicon DJ Local API Client
 *
 * Kommuniziert mit der Lexicon Desktop-App über die Local REST-API.
 * Bestätigte Endpoints (entdeckt 2026-03-27):
 *   GET  /v1/playlists                    — Verschachtelter Playlist-Baum (ROOT → Ordner → Playlisten)
 *   GET  /v1/tracks?limit=N&offset=N      — Paginierte Track-Liste (45 046 Tracks, alle Metadaten)
 *
 * Fehlerformat: { "message": "API /pfad does not exist", "errorCode": 4 }
 *
 * Pipeline-Rolle: Beatport → DJPlaylists.fm → [Lexicon] → Engine DJ → USB
 */

const LEXICON_BASE = "http://localhost:48624";
const DEFAULT_TIMEOUT_MS = 8000;
const TRACKS_PAGE_SIZE = 500;

// ─── HTTP-Hilfsfunktion ──────────────────────────────────────────────────────

async function lexiconFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeout ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const resp = await fetch(`${LEXICON_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
      body: options.body ?? undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const ct = resp.headers.get("content-type") ?? "";
    const data = ct.includes("application/json") ? await resp.json() : await resp.text();

    // Lexicon-Fehlerformat: { errorCode: 4, message: "API /... does not exist" }
    if (!resp.ok || (data?.errorCode != null && data.errorCode !== 0)) {
      const msg = data?.message ?? `HTTP ${resp.status} ${resp.statusText}`;
      const err = new Error(msg);
      err.errorCode = data?.errorCode ?? resp.status;
      err.status = resp.status;
      throw err;
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Verbindungscheck ────────────────────────────────────────────────────────

/**
 * Prüft ob Lexicon läuft und die API auf Port 48624 erreichbar ist.
 * @returns {{ connected: boolean, version?: string, trackCount?: number, error?: string }}
 */
export async function checkConnection() {
  try {
    // /v1/playlists ist der zuverlässigste bekannte Endpoint
    const playlists = await lexiconFetch("/v1/playlists", { timeout: 4000 });
    return {
      connected: true,
      endpoint: "/v1/playlists",
      playlistCount: countPlaylists(playlists),
    };
  } catch (err) {
    const msg = String(err.message ?? "");
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("Failed to fetch") ||
      err.name === "AbortError"
    ) {
      return {
        connected: false,
        error: "Lexicon ist nicht gestartet (Port 48624 nicht erreichbar).",
      };
    }
    return { connected: false, error: msg };
  }
}

function countPlaylists(tree) {
  if (!tree) return 0;
  let count = 0;
  const visit = (node) => {
    if (!node) return;
    if (node.type === "playlist") count++;
    if (Array.isArray(node.children)) node.children.forEach(visit);
    if (Array.isArray(node.playlists)) node.playlists.forEach(visit);
  };
  if (Array.isArray(tree)) tree.forEach(visit);
  else visit(tree);
  return count;
}

// ─── API-Explorer ────────────────────────────────────────────────────────────

/**
 * Erkundet alle möglichen /v1/-Endpoints und gibt zurück, welche antworten.
 * @returns {Record<string, { ok: boolean, errorCode?: number, data?: unknown, error?: string }>}
 */
export async function exploreApi() {
  const candidates = [
    // Bestätigte Endpoints
    "/v1/playlists",
    "/v1/tracks",
    // Erkundungs-Kandidaten
    "/v1/playlist",
    "/v1/library",
    "/v1/library/playlists",
    "/v1/status",
    "/v1/health",
    "/v1/version",
    "/v1/sync",
    "/v1/sync/engine",
    "/v1/export",
    "/v1/export/engine",
    "/v1/integrations",
    "/v1/integrations/djplaylists",
    "/v1/djplaylists",
    "/v1/beatport",
    "/v1/crates",
    "/v1/tags",
    "/v1/genres",
    "/v1/artists",
    "/v1/labels",
    "/v1/devices",
    "/v1/devices/engine",
    "/v1/prefs",
    "/v1/settings",
  ];

  const results = {};

  await Promise.allSettled(
    candidates.map(async (path) => {
      try {
        const data = await lexiconFetch(path, { timeout: 2500 });
        results[path] = { ok: true, data };
      } catch (err) {
        results[path] = {
          ok: false,
          errorCode: err.errorCode ?? null,
          error: err.message,
          // errorCode 4 = Endpoint existiert nicht in Lexicon
          isNotFound: err.errorCode === 4 || err.message?.includes("does not exist"),
        };
      }
    })
  );

  return results;
}

// ─── Playlisten ──────────────────────────────────────────────────────────────

/**
 * Lädt den gesamten Playlist-Baum aus Lexicon.
 * Struktur: ROOT → Ordner → Playlisten (verschachtelt)
 *
 * @returns {{ tree: unknown, flat: Array<LexiconPlaylist> }}
 */
export async function getPlaylists() {
  const tree = await lexiconFetch("/v1/playlists");
  return {
    tree,
    flat: flattenPlaylistTree(tree),
  };
}

/**
 * Flacht den Playlist-Baum auf eine Liste von Playlists ab.
 * @param {unknown} node
 * @param {string} [folderPath]
 * @returns {Array<LexiconPlaylist>}
 */
function flattenPlaylistTree(node, folderPath = "") {
  const result = [];
  if (!node) return result;

  const nodes = Array.isArray(node) ? node : [node];

  for (const n of nodes) {
    if (!n) continue;

    const name = n.name ?? n.title ?? n.id ?? "";
    const type = n.type ?? (n.children ? "folder" : "playlist");

    if (type === "playlist" || type === "smartPlaylist") {
      result.push({
        id: String(n.id ?? n.playlistId ?? ""),
        name,
        type,
        trackCount: n.trackCount ?? n.track_count ?? null,
        folderPath,
        raw: n,
      });
    }

    // Ordner rekursiv auffalten
    const childPath = type === "folder" ? (folderPath ? `${folderPath}/${name}` : name) : folderPath;
    if (Array.isArray(n.children)) result.push(...flattenPlaylistTree(n.children, childPath));
    if (Array.isArray(n.playlists)) result.push(...flattenPlaylistTree(n.playlists, childPath));
  }

  return result;
}

// ─── Tracks einer Playlist ───────────────────────────────────────────────────

/**
 * Lädt Tracks einer bestimmten Lexicon-Playlist.
 * Probiert /v1/playlist/:id/tracks, /v1/playlists/:id/tracks usw.
 *
 * @param {string} playlistId
 * @returns {Array<LexiconTrack>}
 */
export async function getPlaylistTracks(playlistId) {
  const paths = [
    `/v1/playlist/${playlistId}/tracks`,
    `/v1/playlists/${playlistId}/tracks`,
    `/v1/playlist/${playlistId}`,
    `/v1/playlists/${playlistId}`,
  ];

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path);
      // Normalisiere — Lexicon liefert evtl. { tracks: [...] } oder direkt [...]
      const tracks = Array.isArray(data) ? data
        : Array.isArray(data?.tracks) ? data.tracks
        : Array.isArray(data?.data) ? data.data
        : null;
      if (tracks) return tracks.map(normalizeTrack);
    } catch (err) {
      // errorCode 4 = Endpoint nicht vorhanden → weiter probieren
      if (err.errorCode === 4) continue;
      throw err;
    }
  }
  throw new Error(`Kein Endpoint für Playlist-Tracks gefunden (Playlist ID: ${playlistId}).`);
}

// ─── Alle Tracks (paginiert) ─────────────────────────────────────────────────

/**
 * Lädt alle Tracks aus der Lexicon-Library (paginiert via /v1/tracks).
 *
 * @param {{ onProgress?: (loaded: number, total: number) => void, maxTracks?: number }} options
 * @returns {Array<LexiconTrack>}
 */
export async function getAllTracks(options = {}) {
  const { onProgress, maxTracks = Infinity } = options;
  const all = [];
  let offset = 0;

  while (true) {
    const limit = Math.min(TRACKS_PAGE_SIZE, maxTracks - all.length);
    const data = await lexiconFetch(`/v1/tracks?limit=${limit}&offset=${offset}`);

    const tracks = Array.isArray(data) ? data
      : Array.isArray(data?.tracks) ? data.tracks
      : Array.isArray(data?.data) ? data.data
      : [];

    const total = data?.total ?? data?.count ?? null;

    all.push(...tracks.map(normalizeTrack));
    onProgress?.(all.length, total ?? all.length);

    if (tracks.length < limit || all.length >= maxTracks) break;
    if (total !== null && all.length >= total) break;
    offset += limit;
  }

  return all;
}

/**
 * Lädt nur die erste Seite der Track-Liste (schnell, für Status-Checks).
 * @returns {{ tracks: Array<LexiconTrack>, total: number }}
 */
export async function getTracksSample(limit = 20) {
  const data = await lexiconFetch(`/v1/tracks?limit=${limit}&offset=0`);
  const tracks = Array.isArray(data) ? data
    : Array.isArray(data?.tracks) ? data.tracks
    : Array.isArray(data?.data) ? data.data
    : [];
  return {
    tracks: tracks.map(normalizeTrack),
    total: data?.total ?? data?.count ?? tracks.length,
  };
}

// ─── Track-Normalisierung ────────────────────────────────────────────────────

/**
 * @typedef {Object} LexiconTrack
 * @property {string}   id
 * @property {string}   title
 * @property {string}   artist
 * @property {number|null} bpm
 * @property {string|null} key
 * @property {number|null} energy
 * @property {string|null} genre
 * @property {string|null} label
 * @property {string|null} streamingService
 * @property {string|null} streamingId
 * @property {string|null} location
 * @property {Array}    cuepoints
 * @property {Array}    tags
 */
function normalizeTrack(raw) {
  return {
    id: String(raw.id ?? raw.trackId ?? ""),
    title: raw.title ?? raw.name ?? "",
    artist: raw.artist ?? raw.artistName ?? "",
    bpm: raw.bpm ?? raw.tempo ?? null,
    key: raw.key ?? raw.musicalKey ?? null,
    energy: raw.energy ?? null,
    genre: raw.genre ?? null,
    label: raw.label ?? null,
    streamingService: raw.streamingService ?? null,
    streamingId: raw.streamingId ?? null,
    location: raw.location ?? raw.filePath ?? null,
    cuepoints: raw.cuepoints ?? raw.cues ?? [],
    tags: raw.tags ?? [],
    duration: raw.duration ?? null,
    year: raw.year ?? null,
    raw,
  };
}

// ─── DJPlaylists.fm Integration ──────────────────────────────────────────────

/**
 * Prüft ob DJPlaylists.fm-Integration in Lexicon vorhanden ist.
 * Erkundet dazu typische /v1/-Pfade.
 * @returns {{ available: boolean, path?: string, raw?: unknown, note?: string }}
 */
export async function getDjplaylistsIntegrationStatus() {
  const paths = [
    "/v1/integrations/djplaylists",
    "/v1/djplaylists",
    "/v1/integrations",
    "/v1/sync",
  ];

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path, { timeout: 3000 });
      return { available: true, path, raw: data };
    } catch (err) {
      if (err.errorCode === 4) continue; // Endpoint nicht vorhanden
      if (err.message?.includes("ECONNREFUSED")) break;
    }
  }

  return {
    available: false,
    note: "DJPlaylists.fm-Integration Endpoint noch nicht gefunden. Import evtl. über /v1/sync oder manuell in Lexicon.",
  };
}

/**
 * Versucht einen DJPlaylists.fm-Import in Lexicon zu triggern.
 * Probiert alle bekannten /v1/-Patterns für Import/Sync.
 *
 * @param {{ djplaylistsId?: string, djplaylistsUrl?: string, targetFolder?: string }} opts
 * @returns {{ ok: boolean, path?: string, data?: unknown, error?: string }}
 */
export async function importFromDjplaylists(opts = {}) {
  const body = JSON.stringify({
    playlistId: opts.djplaylistsId,
    url: opts.djplaylistsUrl,
    targetFolder: opts.targetFolder ?? "Beatport Sync",
    source: "djplaylists",
  });

  const paths = [
    "/v1/integrations/djplaylists/import",
    "/v1/djplaylists/import",
    "/v1/sync/djplaylists",
    "/v1/integrations/djplaylists/sync",
    "/v1/import",
  ];

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path, {
        method: "POST",
        body,
        timeout: 30000,
      });
      return { ok: true, path, data };
    } catch (err) {
      if (err.errorCode === 4) continue; // Endpoint nicht vorhanden
      // Echter Fehler (4xx mit anderem Code) → zurückgeben
      return { ok: false, path, error: err.message };
    }
  }

  return {
    ok: false,
    error:
      "Kein DJPlaylists.fm-Import-Endpoint in Lexicon gefunden. " +
      "Bitte in Lexicon manuell unter Integrations → DJPlaylists.fm importieren.",
  };
}

// ─── Engine DJ Export ────────────────────────────────────────────────────────

/**
 * Triggert den Engine DJ Sync/Export in Lexicon.
 *
 * @param {{ playlistIds?: string[], exportAll?: boolean }} opts
 * @returns {{ ok: boolean, path?: string, data?: unknown, error?: string }}
 */
export async function triggerEngineDjExport(opts = {}) {
  const body = JSON.stringify({
    playlistIds: opts.playlistIds ?? [],
    exportAll: opts.exportAll ?? false,
    target: "engine",
  });

  const paths = [
    "/v1/sync/engine",
    "/v1/export/engine",
    "/v1/engine/export",
    "/v1/engine/sync",
    "/v1/sync",
    "/v1/export",
  ];

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path, {
        method: "POST",
        body,
        timeout: 120000, // Engine-Export kann lange dauern
      });
      return { ok: true, path, data };
    } catch (err) {
      if (err.errorCode === 4) continue;
      return { ok: false, path, error: err.message };
    }
  }

  return {
    ok: false,
    error:
      "Kein Engine-DJ-Export-Endpoint gefunden. " +
      "Bitte in Lexicon manuell Sync → Engine DJ starten.",
  };
}
