/**
 * DJPlaylists.fm API Client
 *
 * DJPlaylists.fm (von Rekordcloud) ist die BRÜCKE zwischen Beatport Streaming
 * und Lexicon DJ. Die Seite akzeptiert Beatport Streaming Playlist-URLs und
 * stellt die Playlisten dann für den Lexicon-Import bereit.
 *
 * Pipeline-Rolle: [Beatport] → [DJPlaylists.fm] → Lexicon → Engine DJ → USB
 *
 * Authentifizierung: Session-Cookie (robert-amin) oder API-Key.
 * Da die API nicht öffentlich dokumentiert ist, werden typische REST-Patterns
 * erkundet und das Response-Format normalisiert.
 */

const DJPL_BASE = "https://djplaylists.fm";
const DEFAULT_TIMEOUT_MS = 15000;

// ─── Session-State ───────────────────────────────────────────────────────────

let _sessionCookie = null;
let _apiKey = null;

/**
 * Setzt den API-Key für authentifizierte Requests.
 * @param {string} key
 */
export function setApiKey(key) {
  _apiKey = key;
}

/**
 * Setzt einen Session-Cookie (aus Browser-Export).
 * @param {string} cookie  z.B. "_session=abc123"
 */
export function setSessionCookie(cookie) {
  _sessionCookie = cookie;
}

// ─── HTTP-Hilfsfunktion ──────────────────────────────────────────────────────

async function djplFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeout ?? DEFAULT_TIMEOUT_MS
  );

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Beatport-DJ-Suite/2.2.0",
    ...options.headers,
  };

  if (_apiKey) headers["Authorization"] = `Bearer ${_apiKey}`;
  if (_sessionCookie) headers["Cookie"] = _sessionCookie;

  try {
    const url = path.startsWith("http") ? path : `${DJPL_BASE}${path}`;
    const resp = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ?? undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);
    }

    const ct = resp.headers.get("content-type") ?? "";
    return ct.includes("application/json") ? await resp.json() : await resp.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Verbindungscheck ────────────────────────────────────────────────────────

/**
 * Prüft ob DJPlaylists.fm erreichbar ist und (optional) ob der User eingeloggt ist.
 * @returns {{ reachable: boolean, authenticated: boolean, username?: string, error?: string }}
 */
export async function checkConnection() {
  try {
    // Öffentliche Seite prüfen (kein Auth nötig)
    const html = await djplFetch("/", {
      headers: { Accept: "text/html,application/xhtml+xml" },
      timeout: 8000,
    });

    const text = String(html ?? "");
    const reachable = text.length > 100;

    // Prüfe ob User eingeloggt (suche nach "robert-amin" oder typischen Auth-Signalen)
    const authenticated =
      text.includes("robert-amin") ||
      text.includes("logout") ||
      text.includes("dashboard") ||
      text.includes("my-playlists");

    const usernameMatch = text.match(/robert-amin|data-user="([^"]+)"|username[^>]*>([^<]+)/i);
    const username = usernameMatch?.[0] ?? null;

    return { reachable, authenticated, username };
  } catch (err) {
    return {
      reachable: false,
      authenticated: false,
      error: String(err.message ?? "Verbindung fehlgeschlagen"),
    };
  }
}

// ─── Beatport-Playlist-Import ────────────────────────────────────────────────

/**
 * Importiert eine Beatport Streaming Playlist-URL in DJPlaylists.fm.
 * DJPlaylists.fm akzeptiert Beatport Streaming URLs direkt.
 *
 * Beatport Streaming Playlist-URL Format:
 *   https://streaming.beatport.com/playlists/{id}
 *   https://www.beatport.com/playlists/{slug}
 *
 * @param {{ beatportUrl: string, name?: string }} options
 * @returns {{ ok: boolean, playlistId?: string, playlistUrl?: string, trackCount?: number }}
 */
export async function importBeatportPlaylist(options = {}) {
  const { beatportUrl, name } = options;

  if (!beatportUrl) throw new Error("beatportUrl ist erforderlich.");

  // Normalisiere die URL
  const url = beatportUrl.trim();
  if (!url.includes("beatport.com")) {
    throw new Error(`Ungültige Beatport-URL: ${url}`);
  }

  // Versuche verschiedene Import-Endpunkte
  const importPaths = [
    "/api/playlists/import",
    "/api/import/beatport",
    "/api/playlists/beatport",
    "/api/v1/playlists/import",
    "/playlists/import",
  ];

  const body = JSON.stringify({
    url,
    source: "beatport",
    name: name ?? null,
  });

  for (const path of importPaths) {
    try {
      const data = await djplFetch(path, {
        method: "POST",
        body,
        timeout: 30000,
      });

      return {
        ok: true,
        path,
        playlistId: data?.id ?? data?.playlist_id ?? data?.playlistId ?? null,
        playlistUrl: data?.url ?? data?.playlist_url ?? null,
        name: data?.name ?? name ?? null,
        trackCount: data?.track_count ?? data?.trackCount ?? data?.tracks?.length ?? null,
        raw: data,
      };
    } catch (err) {
      const msg = String(err.message ?? "");
      // 401/403 → Auth-Problem → abbrechen
      if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
        throw new Error(
          "DJPlaylists.fm: Nicht authentifiziert. API-Key oder Session-Cookie fehlt."
        );
      }
      // 400/422 → Parameter-Problem → weitergeben
      if (msg.includes("HTTP 4")) {
        throw new Error(`DJPlaylists.fm Import-Fehler: ${msg}`);
      }
      // Andere Fehler → nächsten Pfad probieren
      continue;
    }
  }

  // Fallback: Rekordcloud-API-Format (DJPlaylists.fm ist ein Rekordcloud-Produkt)
  try {
    const rekordcloudBody = JSON.stringify({
      platform: "beatport",
      playlist_url: url,
      title: name ?? null,
    });

    const data = await djplFetch("/api/playlists", {
      method: "POST",
      body: rekordcloudBody,
      timeout: 30000,
    });

    return {
      ok: true,
      path: "/api/playlists",
      playlistId: data?.id ?? null,
      name: data?.title ?? data?.name ?? name ?? null,
      trackCount: data?.track_count ?? null,
      raw: data,
    };
  } catch (err) {
    const msg = String(err.message ?? "");
    if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
      throw new Error("DJPlaylists.fm: Bitte API-Key eingeben (Einstellungen → DJPlaylists.fm).");
    }
  }

  throw new Error(
    "DJPlaylists.fm Import-Endpunkt nicht gefunden. " +
      "Bitte die Beatport-URL manuell auf djplaylists.fm importieren."
  );
}

// ─── Playlisten abrufen ──────────────────────────────────────────────────────

/**
 * Lädt alle eigenen Playlisten aus DJPlaylists.fm.
 * @returns {Array<{ id: string, name: string, trackCount: number, beatportUrl?: string }>}
 */
export async function getMyPlaylists() {
  const paths = [
    "/api/playlists",
    "/api/v1/playlists",
    "/api/my-playlists",
    "/api/user/playlists",
  ];

  for (const path of paths) {
    try {
      const data = await djplFetch(path);
      if (Array.isArray(data)) return normalizePlaylists(data);
      if (Array.isArray(data?.playlists)) return normalizePlaylists(data.playlists);
      if (Array.isArray(data?.data)) return normalizePlaylists(data.data);
    } catch {
      continue;
    }
  }
  throw new Error("DJPlaylists.fm: Playlisten konnten nicht geladen werden.");
}

function normalizePlaylists(raw) {
  return raw.map((p) => ({
    id: String(p.id ?? p.playlist_id ?? p._id ?? ""),
    name: p.name ?? p.title ?? p.playlist_name ?? "Unbenannte Playlist",
    trackCount: p.track_count ?? p.trackCount ?? p.tracks?.length ?? 0,
    beatportUrl: p.source_url ?? p.beatport_url ?? p.url ?? null,
    updatedAt: p.updated_at ?? p.updatedAt ?? null,
    raw: p,
  }));
}

/**
 * Lädt Tracks einer DJPlaylists.fm-Playlist.
 * @param {string} playlistId
 * @returns {Array<{ title: string, artist: string, bpm?: number, key?: string }>}
 */
export async function getPlaylistTracks(playlistId) {
  const paths = [
    `/api/playlists/${playlistId}/tracks`,
    `/api/playlists/${playlistId}`,
    `/api/v1/playlists/${playlistId}/tracks`,
  ];

  for (const path of paths) {
    try {
      const data = await djplFetch(path);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.tracks)) return data.tracks;
    } catch {
      continue;
    }
  }
  throw new Error(`DJPlaylists.fm: Tracks für Playlist ${playlistId} nicht ladbar.`);
}

// ─── API-Explorer ────────────────────────────────────────────────────────────

/**
 * Erkundet typische DJPlaylists.fm REST-Endpoints.
 * @returns {Record<string, { ok: boolean, error?: string }>}
 */
export async function exploreApi() {
  const paths = [
    "/",
    "/api",
    "/api/v1",
    "/api/status",
    "/api/playlists",
    "/api/v1/playlists",
    "/api/my-playlists",
    "/api/user/playlists",
    "/api/import/beatport",
    "/api/playlists/import",
  ];

  const results = {};
  await Promise.allSettled(
    paths.map(async (path) => {
      try {
        await djplFetch(path, {
          timeout: 4000,
          headers: { Accept: "application/json,text/html" },
        });
        results[path] = { ok: true };
      } catch (err) {
        results[path] = {
          ok: false,
          error: String(err.message ?? "").slice(0, 120),
        };
      }
    })
  );
  return results;
}

// ─── Link für Lexicon ────────────────────────────────────────────────────────

/**
 * Gibt den DJPlaylists.fm-Link zurück, den Lexicon für den Import braucht.
 * Format: https://djplaylists.fm/playlists/{id}
 * @param {string} playlistId
 * @returns {string}
 */
export function buildLexiconImportUrl(playlistId) {
  return `${DJPL_BASE}/playlists/${playlistId}`;
}

/**
 * Extrahiert die Playlist-ID aus einer DJPlaylists.fm-URL.
 * @param {string} url
 * @returns {string|null}
 */
export function extractPlaylistId(url) {
  const match = url.match(/djplaylists\.fm\/(?:playlists?\/)?([a-z0-9_-]+)/i);
  return match?.[1] ?? null;
}
