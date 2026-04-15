import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("observerLauncher", {
  getState: () => ipcRenderer.invoke("launcher:get-state"),
  startObserver: (options) => ipcRenderer.invoke("launcher:start-observer", options),
  stopObserver: () => ipcRenderer.invoke("launcher:stop-observer"),
  launchBrowser: (options) => ipcRenderer.invoke("launcher:launch-browser", options),
  openPath: (targetPath) => ipcRenderer.invoke("launcher:open-path", targetPath),
  onState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("observer:state", handler);
  },
  onLog: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("observer:log", handler);
  }
});
