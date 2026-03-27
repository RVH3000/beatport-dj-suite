import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("scannerApi", {
  getDefaults: () => ipcRenderer.invoke("scanner:get-defaults"),
  getAppInfo: () => ipcRenderer.invoke("scanner:get-app-info"),
  writeLiveStatus: (payload) => ipcRenderer.invoke("scanner:write-live-status", payload),
  getLiveStatus: () => ipcRenderer.invoke("scanner:get-live-status"),
  getCacheStatus: (config) => ipcRenderer.invoke("cache:get-status", config),
  rebuildCacheFromRuns: (config) =>
    ipcRenderer.invoke("cache:rebuild-from-runs", config),
  listCachedPlaylists: (config) => ipcRenderer.invoke("cache:list-playlists", config),
  getCachedPlaylistDetails: (config, query) =>
    ipcRenderer.invoke("cache:get-playlist-details", config, query),
  exportCsvFromCache: (config, query) =>
    ipcRenderer.invoke("export:csv-from-cache", config, query),
  listRuns: (config) => ipcRenderer.invoke("scanner:list-runs", config),
  listLegacyRuns: (config) => ipcRenderer.invoke("scanner:list-legacy-runs", config),
  getRunMigrationInfo: (config, query) =>
    ipcRenderer.invoke("scanner:get-run-migration-info", config, query),
  getRunPlaylists: (config, query) =>
    ipcRenderer.invoke("scanner:get-run-playlists", config, query),
  getPlaylistDetails: (config, query) =>
    ipcRenderer.invoke("scanner:get-playlist-details", config, query),
  migrateLegacyRuns: (config, query) =>
    ipcRenderer.invoke("scanner:migrate-legacy-runs", config, query),
  exportRunZip: (config, query) =>
    ipcRenderer.invoke("scanner:export-run-zip", config, query),
  deltaSync: (config) => ipcRenderer.invoke("scanner:delta-sync", config),
  discover: (config) => ipcRenderer.invoke("scanner:discover", config),
  analyzeSelected: (config) => ipcRenderer.invoke("scanner:analyze-selected", config),
  analyzeRun: (config) => ipcRenderer.invoke("scanner:analyze-selected", config),
  pauseRun: (config, runId) =>
    ipcRenderer.invoke("scanner:pause-run", config, runId),
  scan: (config) => ipcRenderer.invoke("scanner:scan", config),
  deleteDuplicates: (config) => ipcRenderer.invoke("scanner:delete", config),
  openPath: (filePath) => ipcRenderer.invoke("scanner:open-path", filePath),
  openRunFolder: (folderPath) =>
    ipcRenderer.invoke("scanner:open-run-folder", folderPath),
});

contextBridge.exposeInMainWorld("playlistApi", {
  list: () => ipcRenderer.invoke("playlist:list"),
  tracks: (playlistId) => ipcRenderer.invoke("playlist:tracks", playlistId),
  create: (name) => ipcRenderer.invoke("playlist:create", name),
  rename: (playlistId, newName) => ipcRenderer.invoke("playlist:rename", playlistId, newName),
  remove: (playlistId) => ipcRenderer.invoke("playlist:delete", playlistId),
  addTracks: (playlistId, trackIds) => ipcRenderer.invoke("playlist:add-tracks", playlistId, trackIds),
  removeTracks: (playlistId, trackIds) => ipcRenderer.invoke("playlist:remove-tracks", playlistId, trackIds),
});

contextBridge.exposeInMainWorld("exportApi", {
  chooseSavePath: (options) => ipcRenderer.invoke("export:choose-save-path", options),
  generate: (config, query) => ipcRenderer.invoke("export:generate", config, query),
});

contextBridge.exposeInMainWorld("analysisApi", {
  getTrackData: (config) => ipcRenderer.invoke("analysis:get-track-data", config),
  getOverlapMatrix: (config) => ipcRenderer.invoke("analysis:get-overlap-matrix", config),
});

contextBridge.exposeInMainWorld("authApi", {
  getStatus: (config) => ipcRenderer.invoke("auth:get-status", config),
  openLoginWindow: (config) => ipcRenderer.invoke("auth:open-login-window", config),
  saveCredentials: () => ipcRenderer.invoke("auth:save-credentials"),
  deleteCredentials: () => ipcRenderer.invoke("auth:delete-credentials"),
  testSession: (config) => ipcRenderer.invoke("auth:test-session", config),
  reauthenticate: (config) => ipcRenderer.invoke("auth:reauthenticate", config),
  setMode: (config, mode) => ipcRenderer.invoke("auth:set-mode", config, mode),
  exportApiContext: (config) => ipcRenderer.invoke("auth:export-api-context", config),
});

// Sync-Pipeline: Beatport → DJPlaylists.fm → Lexicon → Engine DJ → USB/Prime 4+
contextBridge.exposeInMainWorld("syncApi", {
  // Verbindungsstatus
  checkLexicon:             ()              => ipcRenderer.invoke("sync:check-lexicon"),
  checkDjplaylists:         ()              => ipcRenderer.invoke("sync:check-djplaylists"),
  exploreApis:              ()              => ipcRenderer.invoke("sync:explore-apis"),
  // Lexicon-Library-Zugriff (Port 48624, /v1/)
  getLexiconPlaylists:      ()              => ipcRenderer.invoke("sync:get-lexicon-playlists"),
  getLexiconPlaylistTracks: (id)            => ipcRenderer.invoke("sync:get-lexicon-playlist-tracks", id),
  getLexiconTracksSample:   (limit)         => ipcRenderer.invoke("sync:get-lexicon-tracks-sample", limit),
  getDjplaylistsStatus:     ()              => ipcRenderer.invoke("sync:get-djplaylists-status"),
  // Authentifizierung
  saveAuth:                 (auth)          => ipcRenderer.invoke("sync:save-auth", auth),
  // Pipeline-Schritte
  importToDjplaylists:      (opts)          => ipcRenderer.invoke("sync:import-to-djplaylists", opts),
  importToLexicon:          (opts)          => ipcRenderer.invoke("sync:import-to-lexicon", opts),
  triggerEngineExport:      (opts)          => ipcRenderer.invoke("sync:trigger-engine-export", opts),
  // DJPlaylists.fm → Lexicon Batch-Automation
  scrapeDjplaylists:        (opts)          => ipcRenderer.invoke("sync:scrape-djplaylists", opts),
  djplaylistsToLexiconAll:  (opts)          => ipcRenderer.invoke("sync:djplaylists-to-lexicon-all", opts),
  // Live-Progress-Events (djplaylistsToLexiconAll sendet 'sync:batch-progress')
  onBatchProgress: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("sync:batch-progress", handler);
    return () => ipcRenderer.removeListener("sync:batch-progress", handler);
  },
  // Presets
  getPresets:               ()              => ipcRenderer.invoke("sync:get-presets"),
  savePresets:              (presets)       => ipcRenderer.invoke("sync:save-presets", presets),
  // Scoring-Data (Search & Filter Tab)
  loadScoringData:          (filePath)      => ipcRenderer.invoke("sync:load-scoring-data", filePath),
  chooseScoringFile:        ()              => ipcRenderer.invoke("sync:choose-scoring-file"),
});
