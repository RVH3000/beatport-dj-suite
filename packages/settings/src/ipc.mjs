import { createIpcRouter, bridgeEventToIpc } from "@bpdjs/ipc-router";
import { SETTINGS_CHANGED } from "./store.mjs";

/**
 * Registriert die Standard-IPC-Handler für SettingsStore.
 * Liefert Unsubscribe-Map zurück, damit der Aufrufer beim Shutdown aufräumen kann.
 *
 * IPC-Channels:
 *   settings:get      → (key?) → Wert oder ganzes Objekt wenn key null
 *   settings:set      → (key, value) → ack
 *   settings:merge    → (object) → ack
 *   settings:reset    → (key?) → ack
 *   settings:list     → (—) → ganzes Settings-Objekt
 *
 * Wenn `progressTarget` (event/window) übergeben wird, leitet er zusätzlich
 * den EventBus-Channel SETTINGS_CHANGED automatisch an den Renderer weiter.
 */
export function registerSettingsIpc({ ipcMain, store, logger = null, eventBus = null, progressTarget = null }) {
  const router = createIpcRouter({ ipcMain, logger });
  const unsubs = [];

  unsubs.push(router.handle("settings:get", async (key) => {
    return key ? store.get(key) : store.toJSON();
  }));

  unsubs.push(router.handle("settings:set", async (key, value) => {
    await store.set(key, value);
    return { ok: true };
  }));

  unsubs.push(router.handle("settings:merge", async (obj) => {
    await store.merge(obj || {});
    return { ok: true };
  }));

  unsubs.push(router.handle("settings:reset", async (key) => {
    await store.reset(key || null);
    return { ok: true };
  }));

  unsubs.push(router.handle("settings:list", async () => store.toJSON()));

  if (progressTarget && eventBus) {
    unsubs.push(bridgeEventToIpc(eventBus, SETTINGS_CHANGED, progressTarget));
  }

  return {
    dispose() { for (const u of unsubs) try { u(); } catch { /* noop */ } }
  };
}
