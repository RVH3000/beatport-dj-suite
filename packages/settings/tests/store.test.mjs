import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SettingsStore, SETTINGS_CHANGED, SETTINGS_LOADED, SETTINGS_RESET } from "../src/store.mjs";
import { createEventBus, createLogger } from "@bpdjs/core";

function tmpFile() {
  return path.join(os.tmpdir(), `bpdjs-store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function silentLogger() {
  const log = createLogger({ level: "silent" });
  return log;
}

test("SettingsStore: wirft ohne filePath", () => {
  assert.throws(() => new SettingsStore({}), /filePath erforderlich/);
});

test("SettingsStore: load() ohne Datei nutzt Defaults und feuert SETTINGS_LOADED", async () => {
  const file = tmpFile();
  const bus = createEventBus();
  let loaded = null;
  bus.on(SETTINGS_LOADED, (p) => { loaded = p; });
  const store = new SettingsStore({ filePath: file, defaults: { ui: { theme: "light" } }, eventBus: bus, logger: silentLogger() });
  await store.load();
  assert.equal(store.isLoaded, true);
  assert.equal(store.get("ui.theme"), "light");
  assert.deepEqual(loaded.values, { ui: { theme: "light" } });
});

test("SettingsStore: set() persistiert auf Disk und feuert SETTINGS_CHANGED", async () => {
  const file = tmpFile();
  const bus = createEventBus();
  const events = [];
  bus.on(SETTINGS_CHANGED, (p) => events.push(p));
  const store = new SettingsStore({ filePath: file, eventBus: bus, logger: silentLogger() });
  await store.load();
  await store.set("ui.theme", "dark");
  assert.deepEqual(events[0], { key: "ui.theme", value: "dark" });
  const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(onDisk.ui.theme, "dark");
  await fs.unlink(file).catch(() => {});
});

test("SettingsStore: load() liest persistierten Stand wieder", async () => {
  const file = tmpFile();
  const make = () => new SettingsStore({ filePath: file, defaults: { x: 0 }, eventBus: createEventBus(), logger: silentLogger() });
  const a = make();
  await a.load();
  await a.set("x", 42);
  const b = make();
  await b.load();
  assert.equal(b.get("x"), 42);
  await fs.unlink(file).catch(() => {});
});

test("SettingsStore: merge() emittiert pro Key ein SETTINGS_CHANGED", async () => {
  const file = tmpFile();
  const bus = createEventBus();
  const events = [];
  bus.on(SETTINGS_CHANGED, (p) => events.push(p));
  const store = new SettingsStore({ filePath: file, eventBus: bus, logger: silentLogger() });
  await store.load();
  await store.merge({ a: 1, b: 2 });
  assert.equal(events.length, 2);
  await fs.unlink(file).catch(() => {});
});

test("SettingsStore: reset() stellt Defaults wieder her und feuert SETTINGS_RESET", async () => {
  const file = tmpFile();
  const bus = createEventBus();
  let resetEvent = null;
  bus.on(SETTINGS_RESET, (p) => { resetEvent = p; });
  const store = new SettingsStore({ filePath: file, defaults: { x: 1 }, eventBus: bus, logger: silentLogger() });
  await store.load();
  await store.set("x", 99);
  await store.reset();
  assert.equal(store.get("x"), 1);
  assert.deepEqual(resetEvent, { key: null });
  await fs.unlink(file).catch(() => {});
});

test("SettingsStore: parallele set()-Calls bleiben in Reihenfolge persistiert", async () => {
  const file = tmpFile();
  const store = new SettingsStore({ filePath: file, eventBus: createEventBus(), logger: silentLogger() });
  await store.load();
  await Promise.all([
    store.set("a", 1),
    store.set("b", 2),
    store.set("c", 3),
    store.set("d", 4)
  ]);
  const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(onDisk, { a: 1, b: 2, c: 3, d: 4 });
  await fs.unlink(file).catch(() => {});
});
