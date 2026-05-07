import { toErrorMessage } from "@bpdjs/core";

/**
 * Erzeugt einen IPC-Handler-Wrapper. Generisch — der Aufrufer entscheidet,
 * ob Config-Inject, Logging oder beides aktiv ist. Konsolidiert das
 * v4.1-`ipcHandle`-Pattern aus electron-app/main.mjs (Zeile 307–316).
 *
 * Optionen:
 *   ipcMain      — Electron ipcMain-Modul (für Tests injizierbar)
 *   logger       — optional, erhält error-Logs vor dem rethrow
 *   buildConfig  — optional, async (rawConfig) => config — wenn gesetzt,
 *                  wird das erste Argument als rawConfig behandelt und
 *                  durchgereicht: fn(config, ...restArgs)
 */
export function createIpcRouter({ ipcMain, logger = null, buildConfig = null } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error("createIpcRouter: ipcMain mit .handle() erforderlich");
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...rawArgs) => {
      try {
        let args = rawArgs;
        if (buildConfig) {
          const [rawConfig, ...rest] = rawArgs;
          const config = await buildConfig(rawConfig || {});
          args = [config, ...rest];
        }
        return await fn(...args);
      } catch (error) {
        const msg = toErrorMessage(error);
        if (logger) logger.error(`ipc:${channel} → ${msg}`);
        throw new Error(msg);
      }
    });
    return () => {
      if (typeof ipcMain.removeHandler === "function") {
        ipcMain.removeHandler(channel);
      }
    };
  }

  return { handle };
}
