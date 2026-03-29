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
