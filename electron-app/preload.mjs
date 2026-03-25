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
