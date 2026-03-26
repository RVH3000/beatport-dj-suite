/**
 * Lexicon DJ Local API Client
 *
 * Kommuniziert mit der Lexicon Desktop-App über ihre Local REST-API auf Port 11011.
 * Lexicon nutzt diese API intern — die Endpunkte sind nicht öffentlich dokumentiert,
 * werden hier über typische REST-Patterns erkundet und gecacht.
 *
 * Pipeline-Rolle: Beatport → DJPlaylists.fm → [Lexicon] → Engine DJ → USB
 */

const LEXICON_BASE = "http://localhost:11011";
const DEFAULT_TIMEOUT_MS = 5000;

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

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
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
 * Prüft ob Lexicon läuft und die API erreichbar ist.
 * @returns {{ connected: boolean, endpoint?: string, version?: string, error?: string }}
 */
export async function checkConnection() {
  // Typische Endpunkte für Lexicon / Electron-basierte Desktop-Apps
  const candidates = [
    "/api/status",
    "/api/health",
    "/api/v1/status",
    "/status",
    "/health",
    "/api",
    "/api/library",
    "/api/playlists",
  ];

  for (const path of candidates) {
    try {
      const data = await lexiconFetch(path, { timeout: 2500 });
      return {
        connected: true,
        endpoint: path,
        version: data?.version ?? data?.appVersion ?? null,
        raw: data,
      };
    } catch (err) {
      const msg = String(err.message ?? "");
      // ECONNREFUSED = Lexicon nicht gestartet
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("fetch failed") ||
        msg.includes("Failed to fetch") ||
        err.name === "AbortError"
      ) {
        return {
          connected: false,
          error: "Lexicon ist nicht gestartet oder API nicht erreichbar (Port 11011).",
        };
      }
      // HTTP-Fehler → Port offen, aber Endpunkt falsch → nächsten probieren
    }
  }

  return {
    connected: false,
    error: "Lexicon API antwortet nicht auf bekannten Endpunkten. Bitte Lexicon-Version prüfen.",
  };
}

// ─── API-Explorer ────────────────────────────────────────────────────────────

/**
 * Erkundet alle bekannten Endpunkte und gibt zurück, welche antworten.
 * Nützlich für Debugging und Ersteinrichtung.
 * @returns {Record<string, { ok: boolean, status?: number, data?: unknown, error?: string }>}
 */
export async function exploreApi() {
  const endpoints = [
    "/api",
    "/api/status",
    "/api/health",
    "/api/version",
    "/api/library",
    "/api/library/playlists",
    "/api/library/tracks",
    "/api/playlists",
    "/api/playlists/all",
    "/api/tracks",
    "/api/integrations",
    "/api/integrations/djplaylists",
    "/api/integrations/beatport",
    "/api/djplaylists",
    "/api/djplaylists/import",
    "/api/djplaylists/sync",
    "/api/engine",
    "/api/engine/status",
    "/api/engine/export",
    "/api/engine/sync",
    "/api/sync",
    "/api/v1/library",
    "/api/v1/playlists",
  ];

  const results = {};

  await Promise.allSettled(
    endpoints.map(async (path) => {
      try {
        const data = await lexiconFetch(path, { timeout: 2000 });
        results[path] = { ok: true, data };
      } catch (err) {
        const msg = String(err.message ?? "");
        const status = msg.match(/HTTP (\d+)/)?.[1];
        results[path] = { ok: false, status: status ? Number(status) : null, error: msg };
      }
    })
  );

  return results;
}

// ─── Playlisten ──────────────────────────────────────────────────────────────

/**
 * Lädt alle Playlisten aus der Lexicon-Library.
 * @returns {Array<{ id: string, name: string, trackCount?: number }>}
 */
export async function getPlaylists() {
  const paths = [
    "/api/library/playlists",
    "/api/playlists",
    "/api/v1/playlists",
    "/api/library",
  ];

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.playlists)) return data.playlists;
      if (Array.isArray(data?.data)) return data.data;
      if (Array.isArray(data?.items)) return data.items;
    } catch {
      continue;
    }
  }
  throw new Error(
    "Playlisten konnten nicht geladen werden. Bitte Lexicon-API-Endpunkt prüfen."
  );
}

/**
 * Lädt Tracks einer bestimmten Playlist.
 * @param {string} playlistId
 * @returns {Array<{ id: string, title: string, artist: string, bpm?: number, key?: string }>}
 */
export async function getPlaylistTracks(playlistId) {
  const paths = [
    `/api/library/playlists/${playlistId}/tracks`,
    `/api/playlists/${playlistId}/tracks`,
    `/api/playlists/${playlistId}`,
    `/api/v1/playlists/${playlistId}/tracks`,
  ];

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.tracks)) return data.tracks;
      if (Array.isArray(data?.data)) return data.data;
    } catch {
      continue;
    }
  }
  throw new Error(`Tracks für Playlist "${playlistId}" nicht ladbar.`);
}

// ─── DJPlaylists.fm Integration ──────────────────────────────────────────────

/**
 * Prüft ob die DJPlaylists.fm-Integration in Lexicon verfügbar ist.
 * @returns {{ available: boolean, status?: string, raw?: unknown }}
 */
export async function getDjplaylistsIntegrationStatus() {
  const paths = [
    "/api/integrations/djplaylists",
    "/api/djplaylists",
    "/api/integrations",
  ];

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path, { timeout: 3000 });
      return { available: true, path, raw: data };
    } catch {
      continue;
    }
  }
  return {
    available: false,
    note: "DJPlaylists.fm-Endpunkt nicht gefunden. Integration möglicherweise über andere API-Route erreichbar.",
  };
}

/**
 * Triggert einen Import einer DJPlaylists.fm-Playlist in Lexicon.
 * @param {{ djplaylistsId?: string, djplaylistsUrl?: string, targetFolder?: string }} options
 * @returns {{ ok: boolean, playlistId?: string, trackCount?: number }}
 */
export async function importFromDjplaylists(options = {}) {
  const paths = [
    "/api/integrations/djplaylists/import",
    "/api/djplaylists/import",
    "/api/integrations/djplaylists/sync",
    "/api/sync/djplaylists",
  ];

  const body = JSON.stringify({
    playlistId: options.djplaylistsId,
    url: options.djplaylistsUrl,
    targetFolder: options.targetFolder ?? "Beatport Sync",
  });

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path, {
        method: "POST",
        body,
        timeout: 30000,
      });
      return { ok: true, path, data };
    } catch (err) {
      const msg = String(err.message ?? "");
      // 4xx → Endpunkt existiert, aber Parameter falsch → Fehler weitergeben
      if (msg.includes("HTTP 4")) throw new Error(`Lexicon Import-Fehler: ${msg}`);
      continue;
    }
  }

  throw new Error(
    "Lexicon DJPlaylists.fm-Import-Endpunkt nicht gefunden. " +
      "Bitte in Lexicon unter Integrations → DJPlaylists.fm manuell importieren."
  );
}

// ─── Engine DJ Export ────────────────────────────────────────────────────────

/**
 * Triggert den Engine DJ Sync/Export in Lexicon.
 * @param {{ playlistIds?: string[], exportAll?: boolean, targetDevice?: string }} options
 * @returns {{ ok: boolean, exportedCount?: number }}
 */
export async function triggerEngineDjExport(options = {}) {
  const paths = [
    "/api/engine/export",
    "/api/engine/sync",
    "/api/sync/engine",
    "/api/export/engine",
    "/api/library/export/engine",
  ];

  const body = JSON.stringify({
    playlistIds: options.playlistIds ?? [],
    exportAll: options.exportAll ?? false,
    targetDevice: options.targetDevice ?? null,
  });

  for (const path of paths) {
    try {
      const data = await lexiconFetch(path, {
        method: "POST",
        body,
        timeout: 60000,
      });
      return { ok: true, path, data };
    } catch (err) {
      const msg = String(err.message ?? "");
      if (msg.includes("HTTP 4")) throw new Error(`Engine-DJ-Export-Fehler: ${msg}`);
      continue;
    }
  }

  throw new Error(
    "Engine DJ Export-Endpunkt in Lexicon nicht gefunden. " +
      "Bitte in Lexicon unter Sync → Engine DJ manuell exportieren."
  );
}
