/**
 * Sendet ein Progress-/Broadcast-Event an einen Renderer.
 * Konsolidiert das v4.1-Pattern `event.sender.send("sync:batch-progress", ...)`
 * aus electron-app/main.mjs.
 */
export function sendProgress(target, channel, payload) {
  if (!target) return false;
  // Akzeptiert sowohl event-Objekte (mit .sender.send) als auch BrowserWindow (.webContents.send)
  if (target.sender && typeof target.sender.send === "function") {
    target.sender.send(channel, payload);
    return true;
  }
  if (target.webContents && typeof target.webContents.send === "function") {
    target.webContents.send(channel, payload);
    return true;
  }
  if (typeof target.send === "function") {
    target.send(channel, payload);
    return true;
  }
  return false;
}

/**
 * Erzeugt einen wiederverwendbaren Progress-Sender für eine spezifische Bridge.
 * Praktisch wenn ein Modul wiederholt an dasselbe Window/Event sendet.
 */
export function createProgressSender(target) {
  return (channel, payload) => sendProgress(target, channel, payload);
}

/**
 * Bridges einen EventBus an einen IPC-Channel: jedes EventBus-Event mit dem
 * angegebenen Namen wird automatisch an den Renderer weitergesendet.
 * Liefert eine Unsubscribe-Funktion.
 */
export function bridgeEventToIpc(eventBus, eventName, target, channel = eventName) {
  const listener = (payload) => sendProgress(target, channel, payload);
  return eventBus.on(eventName, listener);
}
