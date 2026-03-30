import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Hot-Reload im Dev-Modus ─────────────────────────────────────────────────
if (!app.isPackaged) {
  try {
    const __dirname_main = path.dirname(fileURLToPath(import.meta.url));
    const reload = await import("electron-reload");
    reload.default(path.join(__dirname_main, "renderer"), {
      electron: path.join(__dirname_main, "..", "node_modules", ".bin", "electron"),
      forceHardReset: false,
    });
  } catch { /* electron-reload nicht installiert — kein Problem im Prod-Build */ }
}
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
import {
  buildUnifiedComponentMap,
  discoverProjectParts,
} from "./integrations/project-discovery.mjs";
import { classifyTrackBatch } from "./integrations/performance-classifier.mjs";
import { exportM3uPlaylist } from "./integrations/m3u-exporter.mjs";
import { sendOscSnapshot } from "./integrations/osc-bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
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
    minWidth: 768,
    minHeight: 600,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
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

function resolveBundledPath(relativePath) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", relativePath);
  }
  return path.join(REPO_ROOT, relativePath);
}

function runPythonJson(relativeScriptPath, args = [], options = {}) {
  const pythonCommand = String(options.pythonCommand || "python3");
  const scriptPath = resolveBundledPath(relativeScriptPath);
  const result = spawnSync(pythonCommand, [scriptPath, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });

  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();

  if (result.status !== 0) {
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout);
        throw new Error(parsed.error || stderr || "Python-Kommando fehlgeschlagen.");
      } catch {
        throw new Error(stderr || stdout || "Python-Kommando fehlgeschlagen.");
      }
    }
    throw new Error(stderr || "Python-Kommando fehlgeschlagen.");
  }

  if (!stdout) {
    return { ok: true };
  }

  return JSON.parse(stdout);
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
  // Dock-Icon im Dev-Modus setzen (macOS ignoriert BrowserWindow.icon)
  if (!app.isPackaged && process.platform === "darwin") {
    const iconPath = path.join(__dirname, "..", "assets", "icon.png");
    if (existsSync(iconPath)) {
      try { app.dock.setIcon(iconPath); } catch { /* optional */ }
    }
  }

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
    const defaultFilters = {
      rekordbox: [{ name: "Rekordbox XML", extensions: ["xml"] }],
      traktor: [{ name: "Traktor NML", extensions: ["nml"] }],
      json: [{ name: "JSON", extensions: ["json"] }],
      jsonl: [{ name: "JSON Lines", extensions: ["jsonl"] }],
      m3u: [{ name: "M3U Playlist", extensions: ["m3u"] }],
      m3u8: [{ name: "M3U8 Playlist", extensions: ["m3u8"] }],
      csv: [{ name: "CSV", extensions: ["csv"] }],
    };
    const chosenFilters = options.filters || defaultFilters[options.format] || [{ name: "Alle", extensions: ["*"] }];
    const result = await dialog.showSaveDialog(win, {
      title: options.title || "Export speichern",
      defaultPath: options.defaultPath || options.defaultName || "beatport-export",
      filters: chosenFilters,
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

  // ── Lokaler Playlist-Export (aus Search & Filter Tab) ────────────────────
  ipcMain.handle("export:save-playlist-local", async (_event, options = {}) => {
    const { format, name, tracks, outputPath } = options;
    if (!format || !outputPath || !Array.isArray(tracks)) {
      throw new Error("Format, Ausgabepfad und Tracks erforderlich.");
    }

    const filename = path.basename(outputPath);

    if (format === "m3u") {
      const { buildM3uContent } = await import("./integrations/m3u-exporter.mjs");
      const content = buildM3uContent(name || "Playlist", tracks);
      await fs.writeFile(outputPath, content, "utf8");
      return { ok: true, trackCount: tracks.length, filename, path: outputPath };
    }

    if (format === "json") {
      const payload = {
        name: name || "Playlist",
        exportedAt: new Date().toISOString(),
        trackCount: tracks.length,
        tracks,
      };
      await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
      return { ok: true, trackCount: tracks.length, filename, path: outputPath };
    }

    if (format === "csv") {
      // CSV-Header aus den Track-Keys ableiten
      const headers = tracks.length > 0
        ? Object.keys(tracks[0])
        : ["track_id", "title", "artists", "genre", "bpm", "key", "camelot", "year", "label"];
      const csvEsc = (v) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const lines = [headers.join(",")];
      for (const t of tracks) {
        lines.push(headers.map((h) => csvEsc(t[h])).join(","));
      }
      await fs.writeFile(outputPath, lines.join("\n") + "\n", "utf8");
      return { ok: true, trackCount: tracks.length, filename, path: outputPath };
    }

    throw new Error(`Unbekanntes Export-Format: ${format}`);
  });

  // ── Engine DJ Collection — Streaming-Tracks importieren ─────────────────

  /** Findet alle verfuegbaren Engine DJ Datenbanken (lokal + USB-Sticks) */
  ipcMain.handle("engine:discover-databases", async () => {
    const home = app.getPath("home");
    const candidates = [
      { label: "Lokal", path: path.join(home, "Music", "Engine Library", "Database2") },
    ];

    // USB-Volumes scannen (macOS: /Volumes/*)
    try {
      const { readdirSync, statSync } = await import("node:fs");
      const volumes = readdirSync("/Volumes").filter((v) => v !== "Macintosh HD");
      for (const vol of volumes) {
        const enginePath = path.join("/Volumes", vol, "Engine Library", "Database2");
        try {
          if (statSync(path.join(enginePath, "m.db")).isFile()) {
            candidates.push({ label: `USB: ${vol}`, path: enginePath });
          }
        } catch { /* m.db nicht vorhanden */ }
      }
    } catch { /* /Volumes nicht lesbar */ }

    // Nur existierende zurueckgeben
    const results = [];
    for (const c of candidates) {
      try {
        const { statSync } = await import("node:fs");
        if (statSync(path.join(c.path, "m.db")).isFile()) {
          results.push(c);
        }
      } catch { /* nicht vorhanden */ }
    }
    return { ok: true, databases: results };
  });

  ipcMain.handle("engine:import-streaming", async (_event, options = {}) => {
    const { tracks, playlistTitle, parentListId = 0, databaseFolder } = options;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      throw new Error("Mindestens ein Track erforderlich.");
    }

    // Tracks als temporaere JSON-Datei speichern (Python liest sie)
    const tmpDir = app.getPath("temp");
    const tmpFile = path.join(tmpDir, `bpdj-engine-import-${Date.now()}.json`);
    await fs.writeFile(tmpFile, JSON.stringify(tracks), "utf8");

    try {
      const args = [
        "import-streaming",
        "--tracks-json-file", tmpFile,
      ];
      if (databaseFolder) {
        args.unshift("--database-folder", databaseFolder);
      }
      if (playlistTitle) {
        args.push("--playlist-title", playlistTitle);
      }
      if (parentListId) {
        args.push("--parent-list-id", String(parentListId));
      }

      const result = runPythonJson(
        "electron-app/integrations/python/engine_tools.py",
        args,
      );
      return result;
    } finally {
      // Temp-Datei aufraeumen
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  ipcMain.handle("engine:inspect-schema", async (_event, databaseFolder) => {
    const args = ["inspect-schema"];
    if (databaseFolder) args.unshift("--database-folder", databaseFolder);
    return runPythonJson(
      "electron-app/integrations/python/engine_tools.py",
      args,
    );
  });

  // ── Playlist WIZ — XHR-basierte CRUD-Operationen ─────────────────────────
  // Strategie: Bearer-Token passiv via webRequest.onBeforeSendHeaders abfangen.
  // Der Listener läuft auf der Beatport-Session-Partition und liest den
  // Authorization-Header aus regulären API-Calls der SPA — ohne Navigation.

  // Hilfsfunktion: Kurz warten
  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function createXhrClient() {
    // 1. Sicherstellen, dass das Beatport-Fenster existiert und eingeloggt ist
    let status = await sessionManager.probe({}, { ensureHome: false, show: false });
    if (status.sessionState !== "valid") {
      status = await sessionManager.probe({}, { ensureHome: true, show: false });
      if (status.sessionState !== "valid") {
        throw new Error(
          "Beatport-Session nicht aktiv. Bitte im Scanner-Tab einloggen."
        );
      }
    }

    // 2. Passiv gecaptureten Token prüfen (webRequest-Listener)
    let token = sessionManager.getCapturedToken();

    // 3. Kein Token? Soft-Reload der aktuellen Seite, damit die SPA API-Calls macht
    if (!token) {
      const win = await sessionManager.ensureWindow({ show: false });
      win.webContents.reload();
      // Warten bis die SPA API-Calls abfeuert (Token wird passiv gecaptured)
      for (let i = 0; i < 10; i++) {
        await waitMs(500);
        token = sessionManager.getCapturedToken();
        if (token) break;
      }
    }

    if (!token) {
      throw new Error(
        "Bearer-Token konnte nicht abgefangen werden. Bitte im Scanner-Tab " +
        "das Beatport-Fenster oeffnen, einloggen, und nochmal versuchen."
      );
    }

    // 4. BeatportXhrClient mit dem frischen Token erstellen
    //    session.fetch() sendet automatisch Cookies + User-Agent der Partition.
    //    Gecapturete Headers der SPA als Basis nutzen (Origin, User-Agent, etc.)
    const ses = session.fromPartition(DEFAULTS.beatportSessionPartition);
    const captured = sessionManager.getCapturedHeaders() || {};
    const context = {
      authorization: token,
      accept: captured["Accept"] || captured["accept"] || "application/json, text/plain, */*",
      referer: captured["Referer"] || captured["referer"] || "https://dj.beatport.com/",
      origin: captured["Origin"] || captured["origin"] || "https://dj.beatport.com",
      userAgent: captured["User-Agent"] || captured["user-agent"] || "",
      fetchFn: ses.fetch.bind(ses),
      playlistTemplate: "https://api.beatport.com/v4/my/playlists/{playlistId}/",
      tracksTemplate: "https://api.beatport.com/v4/my/playlists/{playlistId}/tracks/?per_page={perPage}&page={page}",
      discoveryTemplate: "https://api.beatport.com/v4/my/playlists/?per_page={perPage}&page={page}",
      observedAt: new Date().toISOString(),
    };
    return new BeatportXhrClient(context);
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

  // ── Scoring-Data laden (für Search & Filter Tab) ──────────────────────────

  ipcMain.handle("sync:load-scoring-data", async (_event, filePath) => {
    try {
      const resolvedPath = filePath || path.join(
        app.getPath("home"),
        "Documents/Claude/Projects/Beatport PL WIZ/scoring-data.json"
      );
      const raw = await fs.readFile(resolvedPath, "utf8");
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`scoring-data.json nicht ladbar: ${toErrorMessage(err)}`);
    }
  });

  ipcMain.handle("sync:choose-scoring-file", async () => {
    const { dialog } = await import("electron");
    const result = await dialog.showOpenDialog({
      title: "scoring-data.json auswählen",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
      defaultPath: path.join(
        app.getPath("home"),
        "Documents/Claude/Projects/Beatport PL WIZ"
      ),
    });
    if (result.canceled || !result.filePaths.length) return null;
    const raw = await fs.readFile(result.filePaths[0], "utf8");
    return JSON.parse(raw);
  });

  // ── Unified Integration Hub ───────────────────────────────────────────────

  ipcMain.handle("unified:discover-projects", async (_event, options = {}) => {
    try {
      const discovery = await discoverProjectParts(options || {});
      return {
        ...discovery,
        components: buildUnifiedComponentMap(discovery, REPO_ROOT),
      };
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("unified:engine-summary", async (_event, options = {}) => {
    try {
      return runPythonJson(
        "electron-app/integrations/python/engine_tools.py",
        [
          "--database-folder",
          String(options.engineDatabaseFolder || ""),
          "summary",
        ],
        { pythonCommand: options.pythonCommand }
      );
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("unified:engine-playlists", async (_event, options = {}) => {
    try {
      return runPythonJson(
        "electron-app/integrations/python/engine_tools.py",
        [
          "--database-folder",
          String(options.engineDatabaseFolder || ""),
          "playlists",
          "--limit",
          String(options.limit || 200),
        ],
        { pythonCommand: options.pythonCommand }
      );
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("unified:engine-playlist-tracks", async (_event, options = {}) => {
    try {
      return runPythonJson(
        "electron-app/integrations/python/engine_tools.py",
        [
          "--database-folder",
          String(options.engineDatabaseFolder || ""),
          "playlist-tracks",
          "--playlist-id",
          String(options.playlistId || ""),
          "--limit",
          String(options.limit || 500),
        ],
        { pythonCommand: options.pythonCommand }
      );
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("unified:engine-history-sessions", async (_event, options = {}) => {
    try {
      return runPythonJson(
        "electron-app/integrations/python/engine_tools.py",
        [
          "--database-folder",
          String(options.engineDatabaseFolder || ""),
          "history-sessions",
          "--limit",
          String(options.limit || 50),
        ],
        { pythonCommand: options.pythonCommand }
      );
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("unified:engine-history-tracks", async (_event, options = {}) => {
    try {
      return runPythonJson(
        "electron-app/integrations/python/engine_tools.py",
        [
          "--database-folder",
          String(options.engineDatabaseFolder || ""),
          "history-tracks",
          "--session-id",
          String(options.sessionId || ""),
          "--limit",
          String(options.limit || 500),
        ],
        { pythonCommand: options.pythonCommand }
      );
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcMain.handle("unified:engine-play-analytics", async (_event, options = {}) => {
    try {
      const Database = (await import("better-sqlite3")).default;
      const { join } = await import("node:path");
      const { homedir } = await import("node:os");
      const dbFolder = options.engineDatabaseFolder || join(homedir(), "Music", "Engine Library", "Database2");
      const hmDb = new Database(join(dbFolder, "hm.db"), { readonly: true });

      // Top gespielt
      const topPlayed = hmDb.prepare(`
        SELECT t.title, t.artist, t.genre, t.label, t.bpmAnalyzed as bpm,
               COUNT(he.id) as playCount, MAX(he.startTime) as lastPlayed
        FROM HistorylistEntity he JOIN Track t ON he.trackId = t.id
        GROUP BY he.trackId ORDER BY playCount DESC LIMIT ?
      `).all(options.limit || 30);

      // Track-Paare
      const trackPairs = hmDb.prepare(`
        WITH ordered AS (
          SELECT he.listId, he.trackId, ROW_NUMBER() OVER (PARTITION BY he.listId ORDER BY he.startTime, he.id) as pos
          FROM HistorylistEntity he
        )
        SELECT t1.artist as a1, t1.title as t1, t2.artist as a2, t2.title as t2, COUNT(*) as cnt
        FROM ordered o1
        JOIN ordered o2 ON o2.listId = o1.listId AND o2.pos = o1.pos + 1
        JOIN Track t1 ON o1.trackId = t1.id JOIN Track t2 ON o2.trackId = t2.id
        WHERE o1.trackId != o2.trackId
        GROUP BY o1.trackId, o2.trackId HAVING cnt >= 3
        ORDER BY cnt DESC LIMIT ?
      `).all(options.limit || 30);

      // Label-Paare
      const labelPairs = hmDb.prepare(`
        SELECT t1.label as l1, t2.label as l2, COUNT(DISTINCT he1.listId) as sessions
        FROM HistorylistEntity he1
        JOIN HistorylistEntity he2 ON he2.listId = he1.listId AND he1.id < he2.id
        JOIN Track t1 ON he1.trackId = t1.id JOIN Track t2 ON he2.trackId = t2.id
        WHERE t1.label != '' AND t2.label != '' AND t1.label < t2.label
        GROUP BY t1.label, t2.label ORDER BY sessions DESC LIMIT ?
      `).all(options.limit || 20);

      // Gesamt-Stats
      const stats = hmDb.prepare(`
        SELECT COUNT(DISTINCT he.trackId) as uniqueTracks,
               COUNT(he.id) as totalPlays,
               COUNT(DISTINCT he.listId) as sessions
        FROM HistorylistEntity he
      `).get();

      hmDb.close();
      return { topPlayed, trackPairs, labelPairs, stats };
    } catch (error) {
      throw new Error(String(error?.message || error));
    }
  });

  ipcMain.handle("unified:export-m3u", async (_event, options = {}) => {
    try {
      return await exportM3uPlaylist(options);
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  ipcHandle("unified:classify-cache", async (config) => {
    const cache = new SQLiteCacheStore(config);
    const tracks = await cache.getAllTrackRows();
    return classifyTrackBatch(tracks);
  });

  ipcMain.handle("unified:send-osc-snapshot", async (_event, options = {}) => {
    try {
      return await sendOscSnapshot(options);
    } catch (error) {
      throw new Error(toErrorMessage(error));
    }
  });

  // ── DJPlaylists.fm → Lexicon Batch-Automation ─────────────────────────────
  //
  // Entdeckte Endpoints (2026-03-27, via Browser-Interception):
  //   GET  https://sxwtfewpsfdpqddqxyso.supabase.co/rest/v1/playlists?created_by=eq.{userId}
  //        → alle Playlisten des Users (mit Supabase anon key aus JS-Bundle)
  //   POST https://api.djplaylists.fm/api/playlist/save
  //        → Body: { playlistId: N, streamingService: "beatport" }
  //        → Response: { success: true, message: "Playlist saved successfully" }
  //
  // Technische Umsetzung: Hidden BrowserWindow mit DJPlaylists.fm-Session.
  // Die Auth-Token liegen im localStorage der Seite (djplaylists-auth).
  // executeJavaScript() führt die Automation im Seiten-Kontext aus → CORS kein Problem.

  /** Singleton Hidden-BrowserWindow für DJPlaylists.fm */
  let _djplWin = null;

  async function getDjplBrowserWindow() {
    if (_djplWin && !_djplWin.isDestroyed()) return _djplWin;

    _djplWin = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        partition: "persist:djplaylists",
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    _djplWin.on("closed", () => { _djplWin = null; });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout: DJPlaylists.fm konnte nicht geladen werden.")),
        30_000
      );
      _djplWin.webContents.once("did-finish-load", () => { clearTimeout(timer); resolve(); });
      _djplWin.webContents.once("did-fail-load", (_e, code, desc) => {
        clearTimeout(timer);
        reject(new Error(`Ladefehler: ${desc} (${code})`));
      });
      _djplWin.loadURL("https://www.djplaylists.fm/app/playlist/227");
    });

    // SPA-Initialisierung abwarten
    await new Promise((r) => setTimeout(r, 2500));
    return _djplWin;
  }

  /** Führt JS im DJPlaylists.fm-Fenster aus */
  async function runInDjpl(script) {
    const win = await getDjplBrowserWindow();
    return win.webContents.executeJavaScript(script);
  }

  /** Prüft Login-Status im Hidden-Window */
  async function checkDjplLogin() {
    try {
      return await runInDjpl(`(async () => {
        const raw = localStorage.getItem('djplaylists-auth');
        if (!raw) return { loggedIn: false };
        try {
          const ud = localStorage.getItem('user_data');
          const user = ud ? JSON.parse(ud) : null;
          return { loggedIn: true, username: user?.username ?? null };
        } catch { return { loggedIn: !!raw }; }
      })()`);
    } catch {
      return { loggedIn: false };
    }
  }

  /** Holt alle User-Playlisten via Supabase REST aus dem Hidden-Window */
  async function fetchDjplPlaylists() {
    return runInDjpl(`(async () => {
      const raw = localStorage.getItem('djplaylists-auth');
      let jwt = null;
      try { const p = JSON.parse(raw); jwt = p.token || p.access_token || p.accessToken || p.jwt || raw; }
      catch { jwt = raw; }

      const bundleEl = Array.from(document.querySelectorAll('script[src]'))
        .find(s => s.src.includes('/assets/index-'));
      if (!bundleEl) throw new Error('JS-Bundle nicht gefunden — ist djplaylists.fm geladen?');

      const bundleText = await fetch(bundleEl.src).then(r => r.text());
      const jwts = bundleText.match(/eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*/g) || [];
      const anonKey = jwts[0];
      if (!anonKey) throw new Error('Supabase anon key nicht im Bundle gefunden');

      const me = await fetch('https://api.djplaylists.fm/api/user/me', {
        headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' }
      }).then(r => r.json());
      const userId = me?.data?.settings?.user_id;
      if (!userId) throw new Error('User-ID nicht ermittelbar: ' + JSON.stringify(me).slice(0, 200));

      const rows = await fetch(
        'https://sxwtfewpsfdpqddqxyso.supabase.co/rest/v1/playlists' +
        '?select=id,title,type,created_at&created_by=eq.' + userId + '&order=id.asc',
        { headers: { 'apikey': anonKey, 'Authorization': 'Bearer ' + (jwt || anonKey) } }
      ).then(r => r.json());

      if (!Array.isArray(rows))
        throw new Error('Supabase-Antwort unerwartet: ' + JSON.stringify(rows).slice(0, 300));

      return rows.map((pl, i) => ({
        id: pl.id,
        name: pl.title,
        type: pl.type,
        createdAt: pl.created_at,
        url: 'https://www.djplaylists.fm/app/playlist/' + pl.id,
        position: i + 1,
        trackCount: null,
      }));
    })()`);
  }

  /** Sendet eine Playlist an Lexicon über den DJPlaylists.fm Save-Endpoint */
  async function saveDjplPlaylistToLexicon(playlistId) {
    return runInDjpl(`(async () => {
      const raw = localStorage.getItem('djplaylists-auth');
      let jwt = null;
      try { const p = JSON.parse(raw); jwt = p.token || p.access_token || p.accessToken || p.jwt || raw; }
      catch { jwt = raw; }
      const resp = await fetch('https://api.djplaylists.fm/api/playlist/save', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { 'Authorization': 'Bearer ' + jwt } : {}),
        },
        body: JSON.stringify({ playlistId: ${JSON.stringify(playlistId)}, streamingService: 'beatport' }),
      });
      return resp.json();
    })()`);
  }

  // ── IPC: Playlisten aus DJPlaylists.fm laden ────────────────────────────────

  ipcMain.handle("sync:scrape-djplaylists", async () => {
    try {
      await getDjplBrowserWindow();
      const login = await checkDjplLogin();
      if (!login.loggedIn) {
        // Fenster kurz einblenden damit User sich einloggen kann
        _djplWin?.show();
        return {
          ok: false,
          error: "Nicht bei DJPlaylists.fm eingeloggt. Bitte im geöffneten Fenster einloggen und erneut versuchen.",
          playlists: [],
          count: 0,
        };
      }
      const playlists = await fetchDjplPlaylists();
      return { ok: true, playlists, count: playlists.length };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err), playlists: [], count: 0 };
    }
  });

  // ── IPC: Alle Playlisten sequentiell in Lexicon speichern ──────────────────
  //
  // Kernentdeckung: POST /api/playlist/save mit {playlistId, streamingService:"beatport"}
  // triggert in Lexicon den DJPlaylists.fm-Import für genau diese Playlist.

  ipcMain.handle("sync:djplaylists-to-lexicon-all", async (event, opts = {}) => {
    const { delayMs = 800 } = opts;

    const sendProgress = (payload) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("sync:batch-progress", payload);
      }
    };

    try {
      sendProgress({ phase: "scraping", message: "Verbinde mit DJPlaylists.fm…" });

      await getDjplBrowserWindow();
      const login = await checkDjplLogin();

      if (!login.loggedIn) {
        _djplWin?.show();
        sendProgress({ phase: "error", message: "Nicht eingeloggt — bitte im geöffneten Fenster einloggen." });
        return { ok: false, error: "Nicht eingeloggt.", successCount: 0, failCount: 0, skipCount: 0, results: [] };
      }

      sendProgress({ phase: "scraping", message: "Lade Playlist-Liste aus DJPlaylists.fm (via Supabase)…" });
      const playlists = await fetchDjplPlaylists();

      if (!playlists.length) {
        sendProgress({ phase: "error", message: "Keine Playlisten im Account gefunden." });
        return { ok: false, error: "Keine Playlisten gefunden.", successCount: 0, failCount: 0, skipCount: 0, results: [] };
      }

      sendProgress({
        phase: "found",
        message: `${playlists.length} Playlisten gefunden → starte Lexicon-Speicherung…`,
        total: playlists.length,
        playlists,
      });

      const results = [];
      let successCount = 0, failCount = 0;

      for (let i = 0; i < playlists.length; i++) {
        const pl = playlists[i];

        sendProgress({
          phase: "importing",
          current: i + 1,
          total: playlists.length,
          playlist: pl,
          message: `[${i + 1}/${playlists.length}] ${pl.name}`,
        });

        let saveResult;
        try {
          saveResult = await saveDjplPlaylistToLexicon(pl.id);
        } catch (saveErr) {
          saveResult = { success: false, message: toErrorMessage(saveErr) };
        }

        const ok = saveResult?.success === true;
        if (ok) successCount++; else failCount++;

        const item = { id: pl.id, name: pl.name, url: pl.url, ok, msg: saveResult?.message };
        results.push(item);

        sendProgress({
          phase: "item-done",
          current: i + 1,
          total: playlists.length,
          playlist: pl,
          result: { ok },
          message: ok
            ? `✓ [${i + 1}/${playlists.length}] ${pl.name}`
            : `✗ [${i + 1}/${playlists.length}] ${pl.name} — ${saveResult?.message ?? "Unbekannt"}`,
        });

        if (i < playlists.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      sendProgress({
        phase: "done",
        current: playlists.length,
        total: playlists.length,
        successCount,
        failCount,
        skipCount: 0,
        results,
        message: `Fertig: ${successCount} gespeichert, ${failCount} Fehler.`,
      });

      return { ok: true, successCount, failCount, skipCount: 0, results };
    } catch (err) {
      const msg = toErrorMessage(err);
      sendProgress({ phase: "error", message: `Fehler: ${msg}` });
      return { ok: false, error: msg, successCount: 0, failCount: 0, skipCount: 0, results: [] };
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
