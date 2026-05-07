import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { SettingsStore, SETTINGS_CHANGED } from "../src/store.mjs";
import { registerSettingsIpc } from "../src/ipc.mjs";
import { createEventBus, createLogger } from "@bpdjs/core";

function tmpFile() {
  return path.join(os.tmpdir(), `bpdjs-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

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
    list() { return [...handlers.keys()]; }
  };
}

async function makeStore(file, defaults = {}) {
  const bus = createEventBus();
  const log = createLogger({ level: "silent" });
  const store = new SettingsStore({ filePath: file, defaults, eventBus: bus, logger: log });
  await store.load();
  return { store, bus, log };
}

test("registerSettingsIpc: registriert alle 5 Standard-Channels", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, log } = await makeStore(file);
  registerSettingsIpc({ ipcMain, store, logger: log });
  const channels = ipcMain.list();
  for (const ch of ["settings:get", "settings:set", "settings:merge", "settings:reset", "settings:list"]) {
    assert.ok(channels.includes(ch), `${ch} fehlt`);
  }
  await fs.unlink(file).catch(() => {});
});

test("settings:get liefert einzelnen Wert oder ganzes Objekt", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, log } = await makeStore(file, { ui: { theme: "light" } });
  registerSettingsIpc({ ipcMain, store, logger: log });
  assert.equal(await ipcMain.invoke("settings:get", "ui.theme"), "light");
  assert.deepEqual(await ipcMain.invoke("settings:get"), { ui: { theme: "light" } });
  await fs.unlink(file).catch(() => {});
});

test("settings:set persistiert auf Disk", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, log } = await makeStore(file);
  registerSettingsIpc({ ipcMain, store, logger: log });
  await ipcMain.invoke("settings:set", "ui.theme", "dark");
  const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(onDisk.ui.theme, "dark");
  await fs.unlink(file).catch(() => {});
});

test("settings:merge wendet Mehrfach-Updates an", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, log } = await makeStore(file);
  registerSettingsIpc({ ipcMain, store, logger: log });
  await ipcMain.invoke("settings:merge", { a: 1, b: 2 });
  assert.equal(store.get("a"), 1);
  assert.equal(store.get("b"), 2);
  await fs.unlink(file).catch(() => {});
});

test("settings:reset stellt Defaults wieder her", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, log } = await makeStore(file, { x: 1 });
  registerSettingsIpc({ ipcMain, store, logger: log });
  await ipcMain.invoke("settings:set", "x", 99);
  await ipcMain.invoke("settings:reset");
  assert.equal(store.get("x"), 1);
  await fs.unlink(file).catch(() => {});
});

test("settings:list liefert komplettes Objekt", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, log } = await makeStore(file, { a: 1, b: 2 });
  registerSettingsIpc({ ipcMain, store, logger: log });
  assert.deepEqual(await ipcMain.invoke("settings:list"), { a: 1, b: 2 });
  await fs.unlink(file).catch(() => {});
});

test("progressTarget bridged SETTINGS_CHANGED an Renderer", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, bus, log } = await makeStore(file);
  const sent = [];
  const target = { sender: { send: (ch, p) => sent.push({ ch, p }) } };
  registerSettingsIpc({ ipcMain, store, logger: log, eventBus: bus, progressTarget: target });
  await ipcMain.invoke("settings:set", "ui.theme", "dark");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ch, SETTINGS_CHANGED);
  assert.deepEqual(sent[0].p, { key: "ui.theme", value: "dark" });
  await fs.unlink(file).catch(() => {});
});

test("dispose() entfernt alle registrierten Handler", async () => {
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, log } = await makeStore(file);
  const handle = registerSettingsIpc({ ipcMain, store, logger: log });
  assert.equal(ipcMain.list().length >= 5, true);
  handle.dispose();
  assert.equal(ipcMain.list().length, 0);
  await fs.unlink(file).catch(() => {});
});

test("End-to-End-Integration: Phase 1+2+3 in einem Use Case", async () => {
  // Validiert Ultra-Think-Empfehlung: Phase 3 nutzt alle core+ipc-router Module
  const file = tmpFile();
  const ipcMain = makeMockIpcMain();
  const { store, bus, log } = await makeStore(file, { ui: { theme: "light" } });
  const renderer = [];
  const target = { sender: { send: (ch, p) => renderer.push({ ch, p }) } };
  const handle = registerSettingsIpc({ ipcMain, store, logger: log, eventBus: bus, progressTarget: target });

  // Renderer simuliert: theme ändern
  const ack = await ipcMain.invoke("settings:set", "ui.theme", "dark");
  assert.deepEqual(ack, { ok: true });

  // ConfigStore [core] enthält neuen Wert
  assert.equal(store.get("ui.theme"), "dark");

  // Persistenz [settings/persistence] hat geschrieben
  const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(onDisk.ui.theme, "dark");

  // EventBus [core] hat Event gefeuert + ipc-router/progress hat broadcasted
  assert.equal(renderer.length, 1);
  assert.equal(renderer[0].ch, SETTINGS_CHANGED);

  handle.dispose();
  await fs.unlink(file).catch(() => {});
});
