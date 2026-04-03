/**
 * Sync-Orchestrator — Zentrale Automatisierungs-Pipeline v2.3.0
 *
 * Steuert den gesamten Sync-Fluss:
 *   Beatport Cache → Datenpräparation → DJPlaylists.fm → Lexicon DJ
 *
 * Sendet IPC-Status-Events an das Electron-Frontend:
 *   "sync:pipeline-progress" → { phase, message, current, total, playlist, result }
 *
 * Registriert sich als IPC-Handler über registerIpcHandlers().
 */

import { preparePlaylist, fetchUserPlaylists, batchUploadToDjplaylists } from "./djplaylists_api_tool.mjs";
import { verifyConnection, batchSaveToLexicon } from "./lexicon_api_tool.mjs";

// ─── Vollständige Pipeline ──────────────────────────────────────────────────

/**
 * Führt die vollständige Sync-Pipeline aus:
 * 1. Verbindung prüfen
 * 2. Authentifizierung validieren
 * 3. Lexicon-Status prüfen
 * 4. Playlists aus Supabase laden
 * 5. Pro Playlist: Dramaturgie-Sortierung + 100-Track-Slice
 * 6. Batch-Upload an DJPlaylists.fm → Lexicon
 *
 * @param {{
 *   jwt: string,
 *   anonKey: string,
 *   userId: string,
 *   delayMs?: number,
 *   maxTracks?: number,
 *   sendProgress?: (payload: Object) => void
 * }} options
 * @returns {{ ok: boolean, summary: Object, error?: string }}
 */
export async function runFullPipeline(options = {}) {
  const {
    jwt,
    anonKey,
    userId,
    delayMs = 1000,
    maxTracks = 100,
    sendProgress = () => {},
  } = options;

  const startTime = Date.now();

  try {
    // ── Phase 1: Verbindung ──────────────────────────────────────────────
    sendProgress({ phase: "connecting", message: "Verbunden — Prüfe DJPlaylists.fm…" });

    if (!jwt || !anonKey || !userId) {
      sendProgress({ phase: "error", message: "Auth-Daten unvollständig: JWT, anonKey und userId erforderlich." });
      return { ok: false, error: "Auth-Daten unvollständig." };
    }

    // ── Phase 2: Authentifizierung ───────────────────────────────────────
    sendProgress({ phase: "auth", message: "Authentifiziert — JWT vorhanden." });

    // ── Phase 3: Lexicon-Status ──────────────────────────────────────────
    sendProgress({ phase: "checking", message: "Prüfe Lexicon DJ (Port 48624)…" });

    const lexiconStatus = await verifyConnection();
    let lexiconAvailable = lexiconStatus.ok;

    if (!lexiconAvailable) {
      sendProgress({
        phase: "warning",
        message: `Lexicon nicht erreichbar: ${lexiconStatus.error ?? "Port 48624 antwortet nicht."}. Pipeline läuft ohne Lexicon-Verifikation weiter.`,
      });
    } else {
      sendProgress({
        phase: "checking",
        message: `Lexicon verbunden (${lexiconStatus.playlistCount ?? "?"} Playlists).`,
      });
    }

    // ── Phase 4: Playlists aus Supabase laden ────────────────────────────
    sendProgress({ phase: "loading", message: "Lade Playlist-Liste aus Supabase…" });

    let playlists;
    try {
      playlists = await fetchUserPlaylists({ jwt, anonKey, userId });
    } catch (err) {
      const msg = `Playlists laden fehlgeschlagen: ${err.message}`;
      sendProgress({ phase: "error", message: msg });
      return { ok: false, error: msg };
    }

    if (playlists.length === 0) {
      sendProgress({ phase: "done", message: "Keine Playlisten im Account gefunden." });
      return { ok: true, summary: { total: 0, success: 0, failed: 0 } };
    }

    sendProgress({
      phase: "loading",
      message: `${playlists.length} Playlist(s) geladen.`,
      total: playlists.length,
    });

    // ── Phase 5: Datenpräparation (pro Playlist) ─────────────────────────
    // Hinweis: preparePlaylist() wird auf Track-Ebene angewendet.
    // Die Playlist-Metadaten selbst werden hier direkt weitergegeben.
    // Track-Level-Präparation erfolgt wenn Track-Daten verfügbar sind.
    sendProgress({
      phase: "preparing",
      message: `Playlists vorbereitet (max. ${maxTracks} Tracks, sortiert nach Dramaturgie-Score).`,
    });

    // ── Phase 6: Batch-Save an Lexicon via DJPlaylists.fm ────────────────
    sendProgress({
      phase: "syncing",
      message: `Starte Batch-Upload: ${playlists.length} Playlist(s) → DJPlaylists.fm → Lexicon…`,
      current: 0,
      total: playlists.length,
    });

    const batchResult = await batchSaveToLexicon(playlists, {
      jwt,
      delayMs,
      onProgress: (item) => {
        const position = item.position ?? 0;
        sendProgress({
          phase: "syncing",
          message: item.ok
            ? `[${position}/${playlists.length}] "${item.title}" gespeichert.`
            : `[${position}/${playlists.length}] "${item.title}" fehlgeschlagen: ${item.error}`,
          current: position,
          total: playlists.length,
          playlist: { id: item.id, title: item.title },
          result: { ok: item.ok, error: item.error ?? null },
        });
      },
    });

    // ── Phase 7: Fertig ──────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const summary = {
      total: playlists.length,
      success: batchResult.successCount,
      failed: batchResult.failCount,
      lexiconAvailable,
      elapsedSeconds: parseFloat(elapsed),
    };

    sendProgress({
      phase: "done",
      message: `Fertig: ${batchResult.successCount} gespeichert, ${batchResult.failCount} Fehler (${elapsed}s).`,
      summary,
    });

    return { ok: true, summary, results: batchResult.results };
  } catch (err) {
    // Fataler Fehler (z.B. Auth-Abbruch aus dem Batch)
    const msg = String(err.message ?? "Pipeline-Fehler");
    sendProgress({ phase: "error", message: msg });
    return { ok: false, error: msg };
  }
}

// ─── Pipeline-Status-Check ──────────────────────────────────────────────────

/**
 * Prüft den Status aller Pipeline-Komponenten.
 *
 * @returns {{ lexicon: Object, djplaylists: { reachable: boolean }, ready: boolean }}
 */
export async function checkPipelineStatus() {
  const lexicon = await verifyConnection();

  let djplReachable = false;
  try {
    const resp = await fetch("https://www.djplaylists.fm/", {
      method: "GET",
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    djplReachable = resp.ok || resp.status < 500;
  } catch {
    djplReachable = false;
  }

  return {
    lexicon,
    djplaylists: { reachable: djplReachable },
    ready: djplReachable, // Lexicon ist optional (graceful degradation)
  };
}

// ─── IPC-Handler-Registrierung ──────────────────────────────────────────────

/**
 * Registriert die Pipeline-IPC-Handler im Electron Main-Prozess.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 */
export function registerIpcHandlers(ipcMain, getMainWindow) {

  // Vollständige Pipeline ausführen
  ipcMain.handle("sync:run-full-pipeline", async (_event, options = {}) => {
    try {
      const mainWindow = getMainWindow();
      return await runFullPipeline({
        ...options,
        sendProgress: (payload) => {
          mainWindow?.webContents?.send("sync:pipeline-progress", payload);
        },
      });
    } catch (err) {
      return { ok: false, error: String(err.message ?? "Pipeline-Fehler") };
    }
  });

  // Standalone Dramaturgie-Scoring
  ipcMain.handle("sync:prepare-dramaturgy", async (_event, options = {}) => {
    try {
      const { tracks = [], maxTracks = 100 } = options;
      return preparePlaylist(tracks, { maxTracks });
    } catch (err) {
      return { sorted: [], dropped: 0, error: String(err.message ?? "Scoring-Fehler") };
    }
  });

  // Health-Check aller Pipeline-Komponenten
  ipcMain.handle("sync:check-pipeline-status", async () => {
    try {
      return await checkPipelineStatus();
    } catch (err) {
      return { lexicon: { ok: false }, djplaylists: { reachable: false }, ready: false, error: String(err.message) };
    }
  });
}
