/**
 * Lexicon DJ API Tool — Controller für Playlist-Import
 *
 * Standalone-Modul für die automatisierte Sync-Pipeline v2.3.0.
 * Holt Playlists aus DJPlaylists.fm/Supabase und sendet sie via
 * POST an die Lexicon-API (localhost:48624) mit streamingService: "beatport".
 *
 * Pipeline-Rolle: Beatport → DJPlaylists.fm → [DIESES MODUL] → Engine DJ → USB
 *
 * Der tatsächliche Import läuft über den DJPlaylists.fm Save-Endpoint:
 *   POST https://api.djplaylists.fm/api/playlist/save
 *   Body: { playlistId, streamingService: "beatport" }
 * DJPlaylists.fm triggert dann intern den Push an Lexicon.
 */

import { checkConnection } from "./lexicon-client.mjs";

const LEXICON_BASE = "http://localhost:48624";
const DJPL_API_BASE = "https://api.djplaylists.fm";
const DEFAULT_TIMEOUT_MS = 60000;

// ─── HTTP-Hilfsfunktion ──────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeout ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const resp = await fetch(url, {
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
      const err = new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }

    const ct = resp.headers.get("content-type") ?? "";
    return ct.includes("application/json") ? await resp.json() : await resp.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Verbindungscheck ───────────────────────────────────────────────────────

/**
 * Prüft ob Lexicon DJ auf Port 48624 erreichbar ist.
 *
 * @returns {{ ok: boolean, playlistCount?: number, error?: string }}
 */
export async function verifyConnection() {
  try {
    const result = await checkConnection();
    return {
      ok: result.connected === true,
      playlistCount: result.playlistCount ?? null,
      endpoint: result.endpoint ?? null,
      error: result.error ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Lexicon-Verbindungscheck fehlgeschlagen: ${err.message}`,
    };
  }
}

// ─── Einzelne Playlist an Lexicon senden ────────────────────────────────────

/**
 * Sendet eine einzelne Playlist an Lexicon über den DJPlaylists.fm Save-Endpoint.
 *
 * Der Save-Endpoint auf DJPlaylists.fm triggert den Push an die lokale Lexicon-Instanz.
 * Das ist der gleiche Mechanismus wie der "Save to Lexicon"-Button auf der Website.
 *
 * @param {{ playlistId: number, jwt: string, streamingService?: string }} options
 * @returns {{ ok: boolean, data?: unknown, error?: string }}
 */
export async function savePlaylistToLexicon(options = {}) {
  const { playlistId, jwt, streamingService = "beatport" } = options;

  if (!playlistId) throw new Error("playlistId ist erforderlich.");
  if (!jwt) throw new Error("JWT fehlt — DJPlaylists.fm-Login erforderlich.");

  try {
    const data = await apiFetch(`${DJPL_API_BASE}/api/playlist/save`, {
      method: "POST",
      body: JSON.stringify({ playlistId, streamingService }),
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      timeout: 60000,
    });

    return { ok: true, data };
  } catch (err) {
    // Auth-Fehler → sofort melden
    if (err.status === 401 || err.status === 403) {
      return {
        ok: false,
        error: `Nicht authentifiziert (${err.status}). JWT abgelaufen oder ungültig.`,
        authError: true,
      };
    }
    return { ok: false, error: String(err.message ?? "Unbekannter Fehler") };
  }
}

// ─── Batch-Import: Alle Playlists sequentiell an Lexicon ────────────────────

/**
 * Importiert alle übergebenen Playlists sequentiell in Lexicon.
 * Nutzt den DJPlaylists.fm Save-Endpoint mit Rate-Limiting.
 *
 * @param {Array<{ id: number, title: string, position?: number }>} playlists
 * @param {{
 *   jwt: string,
 *   delayMs?: number,
 *   onProgress?: (item: Object) => void
 * }} options
 * @returns {{ results: Array, successCount: number, failCount: number }}
 */
export async function batchSaveToLexicon(playlists, options = {}) {
  const { jwt, delayMs = 1500, onProgress } = options;

  if (!jwt) throw new Error("JWT fehlt — DJPlaylists.fm-Login erforderlich.");
  if (!Array.isArray(playlists) || playlists.length === 0) {
    return { results: [], successCount: 0, failCount: 0 };
  }

  const results = [];

  for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];
    const result = await savePlaylistToLexicon({
      playlistId: pl.id,
      jwt,
    });

    const item = {
      position: pl.position ?? i + 1,
      id: pl.id,
      title: pl.title,
      ...result,
    };

    results.push(item);
    onProgress?.(item);

    // Auth-Fehler → sofort abbrechen, weitere Saves sinnlos
    if (result.authError) {
      break;
    }

    // Rate-Limiting: Pause zwischen Saves
    if (i < playlists.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return { results, successCount, failCount };
}
