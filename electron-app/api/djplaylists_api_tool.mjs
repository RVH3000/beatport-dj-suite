/**
 * DJPlaylists.fm API Tool — Datenpräparation & Batch-Upload
 *
 * Standalone-Modul für die automatisierte Sync-Pipeline v2.3.0.
 * Sortiert Playlists nach Dramaturgie-Score (Intensity), limitiert auf 100 Tracks,
 * und pusht sie via Supabase REST + DJPlaylists.fm Save-Endpoint.
 *
 * Pipeline-Rolle: [Beatport Cache] → [DIESES MODUL] → Lexicon → Engine DJ → USB
 */

import { classifyTrackPerformance } from "../integrations/performance-classifier.mjs";

const SUPABASE_URL = "https://sxwtfewpsfdpqddqxyso.supabase.co";
const DJPL_API_BASE = "https://api.djplaylists.fm";
const DEFAULT_TIMEOUT_MS = 30000;

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

// ─── Datenpräparation ───────────────────────────────────────────────────────

/**
 * Sortiert Tracks nach Dramaturgie-Score (Intensity) absteigend
 * und limitiert auf maxTracks (Standard: 100).
 *
 * @param {Array<Object>} tracks — Rohe Track-Objekte aus dem SQLite-Cache
 * @param {{ maxTracks?: number }} options
 * @returns {{ sorted: Array, dropped: number, summary: { avgIntensity: number, topStage: string } }}
 */
export function preparePlaylist(tracks, options = {}) {
  const { maxTracks = 100 } = options;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { sorted: [], dropped: 0, summary: { avgIntensity: 0, topStage: "cooldown" } };
  }

  // Classify + sortiere nach Intensity absteigend
  const classified = tracks.map((track) => ({
    ...track,
    _performance: classifyTrackPerformance(track),
  }));

  classified.sort((a, b) => b._performance.intensity - a._performance.intensity);

  const sorted = classified.slice(0, maxTracks);
  const dropped = Math.max(0, classified.length - maxTracks);

  // Summary berechnen
  const totalIntensity = sorted.reduce((sum, t) => sum + t._performance.intensity, 0);
  const avgIntensity = sorted.length > 0
    ? Number((totalIntensity / sorted.length).toFixed(3))
    : 0;

  // Häufigste Stage ermitteln
  const stageCounts = {};
  for (const t of sorted) {
    const stage = t._performance.stage;
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
  }
  const topStage = Object.entries(stageCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? "cooldown";

  // _performance-Feld aufräumen — nur intensity für den Consumer behalten
  const clean = sorted.map(({ _performance, ...rest }) => ({
    ...rest,
    intensityScore: _performance.intensity,
    stage: _performance.stage,
  }));

  return { sorted: clean, dropped, summary: { avgIntensity, topStage } };
}

// ─── Supabase: User-Playlists laden ─────────────────────────────────────────

/**
 * Lädt alle Playlists eines Users aus der Supabase-Datenbank von DJPlaylists.fm.
 *
 * @param {{ jwt: string, anonKey: string, userId: string }} auth
 * @returns {Array<{ id: number, title: string, type: string, created_at: string }>}
 */
export async function fetchUserPlaylists({ jwt, anonKey, userId }) {
  if (!jwt) throw new Error("JWT fehlt — DJPlaylists.fm-Login erforderlich.");
  if (!anonKey) throw new Error("Supabase anon key fehlt.");
  if (!userId) throw new Error("User-ID fehlt.");

  const url =
    `${SUPABASE_URL}/rest/v1/playlists` +
    `?select=id,title,type,created_at` +
    `&created_by=eq.${userId}` +
    `&order=id.asc`;

  const data = await apiFetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${jwt || anonKey}`,
    },
    timeout: 15000,
  });

  if (!Array.isArray(data)) {
    throw new Error("Supabase: Unerwartetes Response-Format (kein Array).");
  }

  return data.map((row, index) => ({
    id: row.id,
    title: row.title ?? `Playlist ${index + 1}`,
    type: row.type ?? "playlist",
    createdAt: row.created_at ?? null,
    position: index + 1,
  }));
}

// ─── Batch-Upload: Playlists an DJPlaylists.fm senden ───────────────────────

/**
 * Sendet Playlists sequentiell an den DJPlaylists.fm Save-Endpoint.
 * Dieser Endpoint triggert intern den Lexicon-Import.
 *
 * POST https://api.djplaylists.fm/api/playlist/save
 * Body: { playlistId: N, streamingService: "beatport" }
 *
 * @param {Array<{ id: number, title: string }>} playlists
 * @param {{
 *   jwt: string,
 *   delayMs?: number,
 *   onProgress?: (item: Object) => void
 * }} options
 * @returns {{ results: Array, successCount: number, failCount: number }}
 */
export async function batchUploadToDjplaylists(playlists, options = {}) {
  const { jwt, delayMs = 1000, onProgress } = options;

  if (!jwt) throw new Error("JWT fehlt — DJPlaylists.fm-Login erforderlich.");
  if (!Array.isArray(playlists) || playlists.length === 0) {
    return { results: [], successCount: 0, failCount: 0 };
  }

  const results = [];

  for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];

    let result;
    try {
      const data = await apiFetch(`${DJPL_API_BASE}/api/playlist/save`, {
        method: "POST",
        body: JSON.stringify({
          playlistId: pl.id,
          streamingService: "beatport",
        }),
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
        timeout: 60000,
      });

      result = {
        position: pl.position ?? i + 1,
        id: pl.id,
        title: pl.title,
        ok: true,
        data,
      };
    } catch (err) {
      // 401/403 → Auth-Problem → sofort abbrechen
      if (err.status === 401 || err.status === 403) {
        const authErr = new Error(
          `DJPlaylists.fm: Nicht authentifiziert (${err.status}). JWT abgelaufen oder ungültig.`
        );
        authErr.status = err.status;
        authErr.abortBatch = true;
        throw authErr;
      }

      result = {
        position: pl.position ?? i + 1,
        id: pl.id,
        title: pl.title,
        ok: false,
        error: String(err.message ?? "Unbekannter Fehler"),
      };
    }

    results.push(result);
    onProgress?.(result);

    // Rate-Limiting: Pause zwischen Saves
    if (i < playlists.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return { results, successCount, failCount };
}
