import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigStore, createConfig } from "../src/config.mjs";

test("ConfigStore: get/set einfache Keys", () => {
  const c = new ConfigStore({ a: 1, b: "hello" });
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("b"), "hello");
  c.set("a", 42);
  assert.equal(c.get("a"), 42);
});

test("ConfigStore: get mit Punkt-Pfad (verschachtelt)", () => {
  const c = new ConfigStore({ ui: { theme: "light", size: 14 } });
  assert.equal(c.get("ui.theme"), "light");
  assert.equal(c.get("ui.size"), 14);
});

test("ConfigStore: set legt verschachtelte Pfade automatisch an", () => {
  const c = new ConfigStore();
  c.set("a.b.c", "deep");
  assert.equal(c.get("a.b.c"), "deep");
});

test("ConfigStore: get liefert fallback bei fehlendem Key", () => {
  const c = new ConfigStore();
  assert.equal(c.get("missing", "default"), "default");
  assert.equal(c.get("missing"), undefined);
});

test("ConfigStore: get() ohne Key liefert komplette Kopie", () => {
  const c = new ConfigStore({ x: 1 });
  const all = c.get();
  assert.deepEqual(all, { x: 1 });
  all.x = 99;
  assert.equal(c.get("x"), 1, "Originalwert darf nicht verändert werden");
});

test("ConfigStore: merge mit deep-merge", () => {
  const c = new ConfigStore({ ui: { theme: "light", size: 14 } });
  c.merge({ ui: { theme: "dark" }, scanner: { parallel: 4 } });
  assert.equal(c.get("ui.theme"), "dark");
  assert.equal(c.get("ui.size"), 14, "size bleibt erhalten beim deep-merge");
  assert.equal(c.get("scanner.parallel"), 4);
});

test("ConfigStore: has prüft Existenz", () => {
  const c = new ConfigStore({ a: { b: 1 } });
  assert.equal(c.has("a.b"), true);
  assert.equal(c.has("a.c"), false);
});

test("ConfigStore: reset(key) stellt Default-Wert wieder her", () => {
  const c = new ConfigStore({ ui: { theme: "light" } });
  c.set("ui.theme", "dark");
  c.reset("ui.theme");
  assert.equal(c.get("ui.theme"), "light");
});

test("ConfigStore: reset() ohne Key stellt alle Defaults wieder her", () => {
  const c = new ConfigStore({ a: 1, b: 2 });
  c.set("a", 99);
  c.set("b", 88);
  c.reset();
  assert.deepEqual(c.toJSON(), { a: 1, b: 2 });
});

test("ConfigStore: toJSON liefert Kopie (kein Original-Reference)", () => {
  const c = new ConfigStore({ nested: { key: "value" } });
  const json = c.toJSON();
  json.nested.key = "mutated";
  assert.equal(c.get("nested.key"), "value");
});

test("createConfig: Factory-Variante funktioniert identisch", () => {
  const c = createConfig({ x: 1 });
  assert.ok(c instanceof ConfigStore);
  assert.equal(c.get("x"), 1);
});
