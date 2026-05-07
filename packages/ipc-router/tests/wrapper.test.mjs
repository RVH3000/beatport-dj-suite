import { test } from "node:test";
import assert from "node:assert/strict";
import { createIpcRouter } from "../src/wrapper.mjs";

function makeMockIpcMain() {
  const handlers = new Map();
  return {
    handle(channel, fn) { handlers.set(channel, fn); },
    removeHandler(channel) { handlers.delete(channel); },
    async invoke(channel, ...args) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler for ${channel}`);
      return fn({ sender: { send: () => {} } }, ...args);
    },
    has(channel) { return handlers.has(channel); }
  };
}

test("createIpcRouter: wirft ohne ipcMain", () => {
  assert.throws(() => createIpcRouter({}), /ipcMain mit \.handle/);
});

test("handle(): registriert Handler und liefert Rückgabewert", async () => {
  const ipcMain = makeMockIpcMain();
  const router = createIpcRouter({ ipcMain });
  router.handle("ping", async (msg) => `pong:${msg}`);
  const result = await ipcMain.invoke("ping", "hi");
  assert.equal(result, "pong:hi");
});

test("handle(): wandelt Fehler über toErrorMessage", async () => {
  const ipcMain = makeMockIpcMain();
  const router = createIpcRouter({ ipcMain });
  router.handle("boom", async () => { throw new Error("Detail"); });
  await assert.rejects(() => ipcMain.invoke("boom"), /Detail/);
});

test("handle(): logger.error wird bei Fehler aufgerufen", async () => {
  const ipcMain = makeMockIpcMain();
  const logged = [];
  const logger = { error: (msg) => logged.push(msg) };
  const router = createIpcRouter({ ipcMain, logger });
  router.handle("fail", async () => { throw new Error("Krach"); });
  await assert.rejects(() => ipcMain.invoke("fail"));
  assert.equal(logged.length, 1);
  assert.match(logged[0], /ipc:fail/);
  assert.match(logged[0], /Krach/);
});

test("handle(): mit buildConfig wird config injiziert", async () => {
  const ipcMain = makeMockIpcMain();
  const router = createIpcRouter({
    ipcMain,
    buildConfig: async (raw) => ({ ...raw, derived: "yes" })
  });
  router.handle("cfg", async (config, extra) => ({ config, extra }));
  const result = await ipcMain.invoke("cfg", { src: "raw" }, "extra-arg");
  assert.deepEqual(result.config, { src: "raw", derived: "yes" });
  assert.equal(result.extra, "extra-arg");
});

test("handle(): event wird NICHT als Extra-Argument an fn weitergereicht", async () => {
  const ipcMain = makeMockIpcMain();
  const router = createIpcRouter({ ipcMain });
  router.handle("count", async (...args) => args.length);
  const result = await ipcMain.invoke("count", "a", "b");
  assert.equal(result, 2, "Nur die explizit übergebenen Args, kein event-Objekt");
});

test("handle(): ohne buildConfig werden args 1:1 durchgereicht", async () => {
  const ipcMain = makeMockIpcMain();
  const router = createIpcRouter({ ipcMain });
  router.handle("plain", async (a, b) => a + b);
  const result = await ipcMain.invoke("plain", 2, 3);
  assert.equal(result, 5);
});

test("handle(): liefert Unsubscribe-Funktion (removeHandler)", async () => {
  const ipcMain = makeMockIpcMain();
  const router = createIpcRouter({ ipcMain });
  const unsub = router.handle("temp", async () => "ok");
  assert.equal(ipcMain.has("temp"), true);
  unsub();
  assert.equal(ipcMain.has("temp"), false);
});
