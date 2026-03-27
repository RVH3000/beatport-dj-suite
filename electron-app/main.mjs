import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIRM_TEXT,
  DEFAULTS,
  exportCsvFromCache,
  exportRunZip,
  getCacheStatus,
  getRunMigrationInfo,
  listLegacyRuns,
  listStoredRuns,
  migrateLegacyRuns,
  readCachedPlaylistDetails,
  readCachedPlaylists,
  readRunPlaylists,
  readRunPlaylistDetails,
  rebuildCacheFromRuns,
  requestRunPause,
  resolveConfig,
  runDeltaSync,
  runAnalyzeSelection,
  runDelete,
  runDiscover,
  runScan,
} from "./scanner/cdp-scanner.mjs";
import { SQLiteCacheStore, resolveCacheDbPath } from "./cache/sqlite-cache.mjs";
import { generateExport } from "./data/export-formats.mjs";
import {
  BeatportXhrClient,
  loadApiContext,
  normalizePlaylist,
  normalizeTrack,
} from "./scanner/xhr-scanner.mjs";
import { SessionManager } from "./auth/session-manager.mjs";
import * as LexiconClient from "./api/lexicon-client.mjs";
import * as DjplaylistsClient from "./api/djplaylists-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CANONICAL_APP_PATH = DEFAULTS.canonicalAppPath;
const sessionManager = new SessionManager({
  partition: DEFAULTS.beatportSessionPartition,
});

function getLiveStatusPath() {
  return path.join(app.getPath("userData"), "live-status.json");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 1080,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function toErrorMessage(error) {
  if (!error) return "Unbekannter Fehler";
  return String(error.message || error);
}

function deriveAppBundlePath(execPath) {
  const marker = ".app/Contents/MacOS/";
  const index = execPath.indexOf(marker);
  if (index === -1) {
    return path.dirname(execPath);
  }
  return execPath.slice(0, index + 4);
}

async function computeBuildId() {
  const candidates = [
    path.join(process.resourcesPath, "app.asar"),
    app.getAppPath(),
  ];

  for (const candidate of candidates) {
    try {
      if (!candidate || !existsSync(candidate)) continue;
      const buffer = await fs.readFile(candidate);
      return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    } catch {
      continue;
    }
  }
  return "dev-build";
}

function discoverAppCopies() {
  const copies = new Set();
  const directCandidates = [
    CANONICAL_APP_PATH,
    "/Applications/Beatport Playlist Scanner.app",
    path.join(app.getPath("home"), "Applications", "Beatport Playlist Scanner.app"),
    path.join(
      app.getPath("home"),
      "Desktop",
      "Beatport-Playlist-Scanner",
      "Beatport Playlist Scanner.app"
    ),
  ];

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      copies.add(candidate);
    }
  }

  const mdResult = spawnSync(
    "mdfind",
    ['kMDItemFSName == "Beatport Playlist Scanner.app"'],
    { encoding: "utf8" }
  );
  if (mdResult.status === 0) {
    String(mdResult.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".app") && existsSync(line))
      .forEach((line) => copies.add(line));
  }

  return [...copies].sort((a, b) => a.localeCompare(b));
}

async function getAppInfo() {
  const execPath = process.execPath;
  const appPath = deriveAppBundlePath(execPath);
  const buildId = await computeBuildId();
  const version = app.getVersion();
  const userDataPath = app.getPath("userData");
  const liveStatusPath = getLiveStatusPath();
  const copies = discoverAppCopies();
  const warnings = [];

  if (
    app.isPackaged &&
    existsSync(appPath) &&
    path.resolve(appPath) !== path.resolve(CANONICAL_APP_PATH)
  ) {
    warnings.push("falsche/alte App-Kopie aktiv");
  }
  if (copies.length > 1) {
    warnings.push("mehrere Installationen gefunden");
  }
  if (appPath.startsWith("/Volumes/")) {
    warnings.push("App läuft direkt vom gemounteten DMG");
  }

  return {
    appPath,
    execPath,
    version,
    buildId,
    userDataPath,
    liveStatusPath,
    canonicalAppPath: CANONICAL_APP_PATH,
    warnings,
    copies,
  };
}

async function writeLiveStatus(payload = {}) {
  const appInfo = await getAppInfo();
  const liveStatusPath = appInfo.liveStatusPath;
  const body = {
    updatedAt: new Date().toISOString(),
    appVersion: appInfo.version,
    appBuildId: appInfo.buildId,
    appPath: appInfo.appPath,
    execPath: appInfo.execPath,
    ...payload,
  };
  await fs.mkdir(path.dirname(liveStatusPath), { recursive: true });
  await fs.writeFile(liveStatusPath, JSON.stringify(body, null, 2), "utf8");
  return {
    ok: true,
    path: liveStatusPath,
    status: body,
  };
}

async function readLiveStatus() {
  const appInfo = await getAppInfo();
  const liveStatusPath = appInfo.liveStatusPath;
  if (!existsSync(liveStatusPath)) {
    return {
      ok: true,
      exists: false,
      path: liveStatusPath,
      status: null,
    };
  }
  const raw = await fs.readFile(liveStatusPath, "utf8");
  return {
    ok: true,
    exists: true,
    path: liveStatusPath,
    status: JSON.parse(raw),
  };
}

async function buildRuntimeConfig(rawConfig = {}) {
  const appInfo = await getAppInfo();
  return resolveConfig({
    ...(rawConfig || {}),
    execPath: appInfo.execPath,
    scannerAppPath: appInfo.appPath,
    appVersion: appInfo.version,
    appBuildId: appInfo.buildId,
    canonicalAppPath: appInfo.canonicalAppPath,
    userDataPath: appInfo.userDataPath,
    runtimeClientFactory: async (runtimeConfig) =>
      sessionManager.createScannerClient(runtimeConfig),
  });
}

app.whenReady().then(() => {
  // IPC-Helper: rawConfig → config → fn(config, ...args) mit einheitlichem Fehler-Handling
  function ipcHandle(channel, fn) {
    ipcMain.handle(channel, async (_event, rawConfig, ...args) => {
      try {
        const config = await buildRuntimeConfig(rawConfig || {});
        return await fn(config, ...args);
      } catch (error) {
        throw new Error(toErrorMessage(error));
      }
    });
  }

  // IPC-Grenze: Renderer darf nur über diese Handler auf Scanner-Funktionen zugreifen.
  ipcMain.handle("scanner:get-defaults", async () => ({
    ...resolveConfig({}),
    confirmText: CONFIRM_TEXT,
  }));

  ipcMain.handle("scanner:get-app-info", async () => {
    try {
      return await getAppInfo();
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("scanner:write-live-status", async (_event, payload = {}) => {
    try {
      return await writeLiveStatus(payload || {});
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("scanner:get-live-status", async () => {
    try {
      return await readLiveStatus();
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  // ── Analysis-Endpunkte ──────────────────────────────────────────────────
  ipcHandle("analysis:get-track-data", async (config) => {
    const cache = new SQLiteCacheStore(config);
    return await cache.getAllTrackRows();
  });

  ipcHandle("analysis:get-overlap-matrix", async (config) => {
    const cache = new SQLiteCacheStore(config);
    return await cache.getPlaylistOverlapMatrix();
  });

  // ── Export-Endpunkte ────────────────────────────────────────────────────
  ipcMain.handle("export:choose-save-path", async (_event, options = {}) => {
    const win = BrowserWindow.getFocusedWindow();
    const filters = {
      rekordbox: [{ name: "Rekordbox XML", extensions: ["xml"] }],
      traktor: [{ name: "Traktor NML", extensions: ["nml"] }],
      json: [{ name: "JSON", extensions: ["json"] }],
      jsonl: [{ name: "JSON Lines", extensions: ["jsonl"] }],
    };
    const result = await dialog.showSaveDialog(win, {
      title: options.title || "Export speichern",
      defaultPath: options.defaultName || "beatport-export",
      filters: filters[options.format] || [{ name: "Alle", extensions: ["*"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return { canceled: false, filePath: result.filePath };
  });

  ipcHandle("export:generate", async (config, query) => {
    const format = query?.format;
    const outputPath = query?.outputPath;
    if (!format || !outputPath) {
      throw new Error("Format und Ausgabepfad erforderlich.");
    }
    const cache = new SQLiteCacheStore(config);
    const tracks = await cache.getAllTrackRows();
    if (!tracks || tracks.length === 0) {
      throw new Error("Keine Track-Daten im Cache. Bitte zuerst einen Scan durchführen.");
    }
    return await generateExport(tracks, format, outputPath);
  });

  // ── Playlist WIZ — XHR-basierte CRUD-Operationen ─────────────────────────
  // Hilfsfunktion: XHR-Client aus exportiertem API-Kontext erstellen
  async function createXhrClient() {
    try {
      const context = await loadApiContext();
      return new BeatportXhrClient(context);
    } catch {
      throw new Error(
        "API-Kontext nicht verfügbar. Bitte im Scanner-Tab: Auth → API-Kontext exportieren."
      );
    }
  }

  ipcMain.handle("playlist:list", async () => {
    try {
      const client = await createXhrClient();
      return await client.discoverAllPlaylists();
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("playlist:tracks", async (_event, playlistId) => {
    try {
      const client = await createXhrClient();
      return await client.fetchPlaylistTracks(playlistId);
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("playlist:create", async (_event, name) => {
    try {
      const client = await createXhrClient();
      return normalizePlaylist(await client.createPlaylist(name));
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("playlist:rename", async (_event, playlistId, newName) => {
    try {
      const client = await createXhrClient();
      return normalizePlaylist(await client.renamePlaylist(playlistId, newName));
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("playlist:delete", async (_event, playlistId) => {
    try {
      const client = await createXhrClient();
      return await client.deletePlaylist(playlistId);
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("playlist:add-tracks", async (_event, playlistId, trackIds) => {
    try {
      const client = await createXhrClient();
      return await client.addTracksToPlaylist(playlistId, trackIds);
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("playlist:remove-tracks", async (_event, playlistId, trackIds) => {
    try {
      const client = await createXhrClient();
      return await client.removeTracksFromPlaylist(playlistId, trackIds);
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcHandle("cache:get-status", (config) => getCacheStatus(config));
  ipcHandle("cache:rebuild-from-runs", (config) => rebuildCacheFromRuns(config));
  ipcHandle("cache:list-playlists", (config) => readCachedPlaylists(config));
  ipcHandle("cache:get-playlist-details", (config, query) => readCachedPlaylistDetails(config, query || {}));
  ipcHandle("export:csv-from-cache", (config, query) => exportCsvFromCache(config, query || {}));

  ipcHandle("auth:get-status", (config) => sessionManager.getStatus(config));
  ipcHandle("auth:open-login-window", (config) => sessionManager.openLoginWindow(config));
  ipcHandle("auth:test-session", (config) => sessionManager.testSession(config));
  ipcHandle("auth:reauthenticate", (config) => sessionManager.reauthenticate(config));

  // API-Kontext für externe Tools exportieren (z.B. beatport_xhr_tool.mjs)
  ipcHandle("auth:export-api-context", async (config) => {
    const context = await sessionManager.resolveBeatportApiContext(config, {
      forceRefresh: true,
    });
    if (!context?.authorization) {
      throw new Error("Kein gültiger API-Kontext verfügbar. Bitte erst einloggen.");
    }
    const exportPath = path.join(
      app.getPath("userData"),
      "api-context.json"
    );
    await fs.writeFile(
      exportPath,
      JSON.stringify(
        { ...context, exportedAt: new Date().toISOString() },
        null,
        2
      ),
      "utf-8"
    );
    return { ok: true, path: exportPath, context };
  });

  ipcMain.handle("auth:save-credentials", async () => {
    try {
      return await sessionManager.saveCredentials();
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("auth:delete-credentials", async () => {
    try {
      return await sessionManager.deleteCredentials();
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("auth:set-mode", async (_event, rawConfig, mode) => {
    try {
      const config = await buildRuntimeConfig({
        ...(rawConfig || {}),
        authMode: mode,
      });
      return await sessionManager.getStatus(config);
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcHandle("scanner:list-runs", (config) => listStoredRuns(config));
  ipcHandle("scanner:list-legacy-runs", (config) => listLegacyRuns(config));
  ipcHandle("scanner:get-playlist-details", (config, query) => readRunPlaylistDetails(config, query || {}));
  ipcHandle("scanner:get-run-migration-info", (config, query) => getRunMigrationInfo(config, query || {}));
  ipcHandle("scanner:scan", (config) => runScan(config));
  ipcHandle("scanner:discover", (config) => runDiscover({ ...config, deepAnalysis: false }));
  ipcHandle("scanner:delta-sync", (config) => runDeltaSync(config));
  ipcHandle("scanner:analyze-selected", (config) => runAnalyzeSelection(config));
  ipcHandle("scanner:pause-run", (config, runId) => requestRunPause(runId || config.runId));
  ipcHandle("scanner:get-run-playlists", (config, query) => readRunPlaylists(config, query || {}));
  ipcHandle("scanner:migrate-legacy-runs", (config, query) => migrateLegacyRuns(config, query || {}));
  ipcHandle("scanner:export-run-zip", (config, query) => exportRunZip(config, query || {}));
  ipcHandle("scanner:delete", (config) => runDelete(config));

  ipcMain.handle("scanner:open-path", async (_event, filePath) => {
    if (!filePath) {
      return { ok: false, message: "Kein Pfad angegeben" };
    }
    const opened = shell.showItemInFolder(filePath);
    if (!opened) {
      return { ok: false, message: "Pfad konnte nicht geöffnet werden" };
    }
    return { ok: true };
  });

  ipcMain.handle("scanner:open-run-folder", async (_event, folderPath) => {
    if (!folderPath) {
      return { ok: false, message: "Kein Run-Ordner angegeben" };
    }
    const result = await shell.openPath(folderPath);
    if (result) {
      return { ok: false, message: result };
    }
    return { ok: true };
  });

  // ── Sync-Pipeline: Lexicon + DJPlaylists.fm ────────────────────────────────

  // Pfad für Sync-Presets (userData)
  function getSyncPresetsPath() {
    return path.join(app.getPath("userData"), "sync-presets.json");
  }

  // Standard-Presets aus dem Projekt laden
  async function loadDefaultPresets() {
    const defaultPath = path.join(__dirname, "data", "sync-presets.json");
    try {
      const raw = await fs.readFile(defaultPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return { playlists: [], config: {} };
    }
  }

  ipcMain.handle("sync:check-lexicon", async () => {
    try {
      return await LexiconClient.checkConnection();
    } catch (err) {
      return { connected: false, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("sync:check-djplaylists", async () => {
    try {
      return await DjplaylistsClient.checkConnection();
    } catch (err) {
      return { reachable: false, authenticated: false, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("sync:explore-apis", async () => {
    const [lexicon, djplaylists] = await Promise.allSettled([
      LexiconClient.exploreApi(),
      DjplaylistsClient.exploreApi(),
    ]);
    return {
      lexicon: lexicon.status === "fulfilled" ? lexicon.value : { error: String(lexicon.reason) },
      djplaylists: djplaylists.status === "fulfilled" ? djplaylists.value : { error: String(djplaylists.reason) },
    };
  });

  ipcMain.handle("sync:save-auth", async (_event, { apiKey, sessionCookie }) => {
    try {
      if (apiKey) DjplaylistsClient.setApiKey(apiKey);
      if (sessionCookie) DjplaylistsClient.setSessionCookie(sessionCookie);

      // In Presets persistieren
      const presetsPath = getSyncPresetsPath();
      let presets;
      try {
        presets = JSON.parse(await fs.readFile(presetsPath, "utf8"));
      } catch {
        presets = await loadDefaultPresets();
      }
      presets.config = presets.config ?? {};
      presets.config.djplaylistsApiKey = apiKey ?? "";
      presets.config.djplaylistsSessionCookie = sessionCookie ?? "";
      await fs.writeFile(presetsPath, JSON.stringify(presets, null, 2), "utf8");

      return { ok: true };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  });

  // Lexicon-Library-Zugriff (Port 48624, bestätigte /v1/-Endpoints)
  ipcMain.handle("sync:get-lexicon-playlists", async () => {
    try {
      return await LexiconClient.getPlaylists();
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  });

  ipcMain.handle("sync:get-lexicon-playlist-tracks", async (_event, playlistId) => {
    try {
      return await LexiconClient.getPlaylistTracks(playlistId);
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  });

  ipcMain.handle("sync:get-lexicon-tracks-sample", async (_event, limit = 20) => {
    try {
      return await LexiconClient.getTracksSample(limit);
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  });

  ipcMain.handle("sync:get-djplaylists-status", async () => {
    try {
      return await LexiconClient.getDjplaylistsIntegrationStatus();
    } catch (err) {
      return { available: false, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("sync:import-to-djplaylists", async (_event, options = {}) => {
    try {
      const result = await DjplaylistsClient.importBeatportPlaylist(options);
      return result;
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("sync:import-to-lexicon", async (_event, options = {}) => {
    try {
      const result = await LexiconClient.importFromDjplaylists(options);
      return result;
    } catch (err) {
      // Kein harter Fehler — Lexicon-API möglicherweise nicht dokumentiert
      return { ok: false, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("sync:trigger-engine-export", async (_event, options = {}) => {
    try {
      const result = await LexiconClient.triggerEngineDjExport(options);
      return result;
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle("sync:get-presets", async () => {
    const presetsPath = getSyncPresetsPath();
    try {
      const raw = await fs.readFile(presetsPath, "utf8");
      const presets = JSON.parse(raw);
      // Auth in Laufzeit wiederherstellen
      if (presets.config?.djplaylistsApiKey) DjplaylistsClient.setApiKey(presets.config.djplaylistsApiKey);
      if (presets.config?.djplaylistsSessionCookie) DjplaylistsClient.setSessionCookie(presets.config.djplaylistsSessionCookie);
      return presets;
    } catch {
      return await loadDefaultPresets();
    }
  });

  ipcMain.handle("sync:save-presets", async (_event, presets) => {
    try {
      const presetsPath = getSyncPresetsPath();
      await fs.writeFile(presetsPath, JSON.stringify(presets, null, 2), "utf8");
      return { ok: true };
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  });

  // ── DJPlaylists.fm → Lexicon Batch-Automation ─────────────────────────────
  //
  // Schritt 1: Scrape djplaylists.fm (HTML) → alle Playlisten des Accounts,
  //            von oben nach unten wie sie auf der Seite erscheinen.
  // Schritt 2: Für jede Playlist: POST an Lexicon /v1/streaming/import (o.ä.)
  // Schritt 3: Live-Progress via IPC-Event 'sync:batch-progress' an Renderer.

  ipcMain.handle("sync:scrape-djplaylists", async (_event, opts = {}) => {
    try {
      const playlists = await DjplaylistsClient.scrapeMyPlaylists(opts);
      return { ok: true, playlists, count: playlists.length };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err), playlists: [] };
    }
  });

  ipcMain.handle("sync:djplaylists-to-lexicon-all", async (_event, opts = {}) => {
    const { targetFolder = "DJPlaylists.fm", delayMs = 1500, username } = opts;

    // Renderer-Fenster für Live-Events
    const getWin = () => BrowserWindow.getAllWindows()[0] ?? null;

    const sendProgress = (payload) => {
      getWin()?.webContents.send("sync:batch-progress", payload);
    };

    try {
      // ── Phase 1: DJPlaylists.fm scrapen ──
      sendProgress({ phase: "scraping", message: "DJPlaylists.fm wird ausgelesen…" });

      const playlists = await DjplaylistsClient.scrapeMyPlaylists({ username });

      if (!playlists || playlists.length === 0) {
        sendProgress({
          phase: "error",
          message:
            "Keine Playlisten auf DJPlaylists.fm gefunden. " +
            "Bitte Session-Cookie oder API-Key prüfen.",
        });
        return { ok: false, error: "Keine Playlisten gefunden.", playlists: [] };
      }

      sendProgress({
        phase: "found",
        message: `${playlists.length} Playlisten gefunden. Starte Import in Lexicon…`,
        total: playlists.length,
        playlists,
      });

      // ── Phase 2: Sequentieller Lexicon-Import ──
      const results = [];

      for (let i = 0; i < playlists.length; i++) {
        const pl = playlists[i];

        sendProgress({
          phase: "importing",
          current: i + 1,
          total: playlists.length,
          playlist: pl,
          message: `[${i + 1}/${playlists.length}] Importiere: ${pl.name}`,
        });

        const result = await LexiconClient.importStreamingPlaylist({
          djplUrl: pl.url,
          name: pl.name,
          targetFolder,
        });

        const item = { ...pl, ...result };
        results.push(item);

        sendProgress({
          phase: "item-done",
          current: i + 1,
          total: playlists.length,
          playlist: pl,
          result,
          message: result.ok
            ? `✓ [${i + 1}/${playlists.length}] ${pl.name}`
            : result.skipped
            ? `⚠ [${i + 1}/${playlists.length}] ${pl.name} — kein Lexicon-Endpoint (manuell nötig)`
            : `✗ [${i + 1}/${playlists.length}] ${pl.name} — ${result.error}`,
        });

        // Pause zwischen Imports
        if (i < playlists.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      const successCount = results.filter((r) => r.ok).length;
      const skipCount = results.filter((r) => r.skipped).length;
      const failCount = results.filter((r) => !r.ok && !r.skipped).length;

      sendProgress({
        phase: "done",
        total: playlists.length,
        successCount,
        skipCount,
        failCount,
        results,
        message:
          `Fertig: ${successCount} importiert, ${skipCount} übersprungen, ${failCount} Fehler.`,
      });

      return { ok: true, results, successCount, skipCount, failCount };
    } catch (err) {
      const msg = toErrorMessage(err);
      sendProgress({ phase: "error", message: `Kritischer Fehler: ${msg}` });
      return { ok: false, error: msg, results: [] };
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await sessionManager.dispose();
});
