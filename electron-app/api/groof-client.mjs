/**
 * Groof.app Integration — Recommendations via api.groof.music
 *
 * Groof ist eine Electron-App (cloud.rekord.groof) vom selben Dev wie djplaylists.fm.
 * Sie betreibt einen lokalen CORS-Proxy auf localhost (Port 8080+).
 * Die Recommendations-API läuft auf https://api.groof.music/recommendations
 *
 * Zwei Modi:
 * 1. Via Groof CORS-Proxy (wenn Groof läuft) — nutzt Groof's Auth + Cache
 * 2. Direkt via api.groof.music (falls Auth-Token verfügbar)
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

const GROOF_BUNDLE_ID = "cloud.rekord.groof";
const GROOF_API = "https://api.groof.music";
const GROOF_LOG_DIR = path.join(app.getPath("appData"), "Groof", "logs");
const DEFAULT_CORS_PORT = 8080;

/**
 * Prüft ob Groof.app aktuell läuft.
 */
export function isGroofRunning() {
  try {
    const out = execSync(
      `pgrep -f "Groof" 2>/dev/null | head -1`,
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Findet den CORS-Proxy-Port den Groof geöffnet hat.
 * Strategie: lsof auf localhost Ports die "Groof" gehören.
 */
export function findGroofProxyPort() {
  try {
    // Methode 1: lsof nach Groof-Prozessen die auf localhost lauschen
    const out = execSync(
      `lsof -iTCP -sTCP:LISTEN -P 2>/dev/null | grep -i "groof\\|cors" | grep -oE "localhost:[0-9]+" | head -1`,
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    const match = out.match(/:(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch { /* ignore */ }

  try {
    // Methode 2: Groof-Log durchsuchen nach "CORS_PROXY_PORT:XXXX"
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(GROOF_LOG_DIR, `${today}.log`);
    if (existsSync(logFile)) {
      const content = readFileSync(logFile, "utf8");
      const lines = content.split("\n").reverse();
      for (const line of lines) {
        const match = line.match(/CORS_PROXY_PORT:(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Holt Empfehlungen via Groof's CORS-Proxy oder direkt.
 *
 * @param {Object} options
 * @param {number[]} options.trackIds - Beatport Track-IDs als Seeds
 * @param {number} [options.limit=20]
 * @param {number} [options.proxyPort] - Groof CORS-Proxy-Port (auto-detect wenn leer)
 * @param {Function} [options.fetchFn] - Custom fetch (z.B. aus Electron-Session)
 */
export async function fetchRecommendations(options = {}) {
  const { trackIds = [], limit = 20, fetchFn = globalThis.fetch } = options;
  if (!trackIds.length) {
    return { ok: false, error: "Keine Track-IDs angegeben", tracks: [] };
  }

  const running = isGroofRunning();
  const proxyPort = options.proxyPort || (running ? findGroofProxyPort() : null);

  // Endpunkte die wir durchprobieren (Groof + Spotify-Style)
  const seedParam = trackIds.join(",");
  const targetUrls = [
    `${GROOF_API}/recommendations?seed_tracks=${seedParam}&limit=${limit}`,
    `${GROOF_API}/recommendations?track_ids=${seedParam}&per_page=${limit}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      let url;
      if (proxyPort) {
        // Via CORS-Proxy
        url = `http://localhost:${proxyPort}/?url=${encodeURIComponent(targetUrl)}`;
      } else {
        // Direkt (braucht ggf. Auth)
        url = targetUrl;
      }

      const response = await fetchFn(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });

      if (!response.ok) continue;

      const payload = await response.json();
      const tracks = Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.tracks)
          ? payload.tracks
          : Array.isArray(payload)
            ? payload
            : [];

      if (tracks.length > 0) {
        return {
          ok: true,
          source: proxyPort ? `groof-proxy:${proxyPort}` : "groof-direct",
          endpoint: targetUrl.split("?")[0],
          count: tracks.length,
          tracks: tracks.map(normalizeTrack),
        };
      }
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    source: running ? "groof-running-but-no-results" : "groof-not-running",
    proxyPort,
    error: running
      ? "Groof läuft, aber keine Empfehlungen für diese Tracks gefunden."
      : "Groof.app ist nicht gestartet. Bitte öffne Groof und versuche es erneut.",
    tracks: [],
  };
}

function normalizeTrack(t) {
  return {
    id: t.id || t.track_id,
    title: t.name || t.title || "",
    mix_name: t.mix_name || t.mixName || "",
    artists: Array.isArray(t.artists)
      ? t.artists.map((a) => a.name || a).join(", ")
      : t.artists || t.artist || "",
    genre: t.genre?.name || t.genre || "",
    bpm: t.bpm,
    key: t.key?.name || t.key || "",
    label: t.label?.name || t.label || "",
    image: t.image?.dynamic_uri || t.image?.uri || t.artwork_url || "",
    source: "groof",
  };
}

/**
 * Status-Check: Groof-Verfügbarkeit als Objekt.
 */
export function getGroofStatus() {
  const running = isGroofRunning();
  const port = running ? findGroofProxyPort() : null;
  return {
    installed: existsSync("/Applications/Groof.app"),
    running,
    proxyPort: port,
    apiUrl: GROOF_API,
  };
}
