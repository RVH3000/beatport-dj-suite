import { test } from "node:test";
import assert from "node:assert/strict";
import { FeatureFlags, createFeatureFlags, FEATURE_FLAG_CHANGED } from "../src/feature-flags.mjs";
import { createEventBus } from "@bpdjs/core";

test("createFeatureFlags: Defaults werden zu Booleans normalisiert", () => {
  const f = createFeatureFlags({ defaults: { a: 1, b: 0, c: "yes" }, eventBus: createEventBus() });
  assert.equal(f.isEnabled("a"), true);
  assert.equal(f.isEnabled("b"), false);
  assert.equal(f.isEnabled("c"), true);
});

test("isEnabled: unbekanntes Flag = false", () => {
  const f = createFeatureFlags({ eventBus: createEventBus() });
  assert.equal(f.isEnabled("missing"), false);
});

test("enable / disable / set: ändert Flag", () => {
  const f = createFeatureFlags({ eventBus: createEventBus() });
  f.enable("debug");
  assert.equal(f.isEnabled("debug"), true);
  f.disable("debug");
  assert.equal(f.isEnabled("debug"), false);
  f.set("verbose", true);
  assert.equal(f.isEnabled("verbose"), true);
});

test("toggle: kehrt um", () => {
  const f = createFeatureFlags({ eventBus: createEventBus() });
  f.toggle("x");
  assert.equal(f.isEnabled("x"), true);
  f.toggle("x");
  assert.equal(f.isEnabled("x"), false);
});

test("set: feuert FEATURE_FLAG_CHANGED nur bei echter Änderung", () => {
  const bus = createEventBus();
  const events = [];
  bus.on(FEATURE_FLAG_CHANGED, (e) => events.push(e));
  const f = createFeatureFlags({ defaults: { x: false }, eventBus: bus });
  f.enable("x");
  f.enable("x"); // schon true → kein Event
  f.disable("x");
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { flag: "x", value: true, previous: false });
  assert.deepEqual(events[1], { flag: "x", value: false, previous: true });
});

test("list: liefert alle bekannten Flag-Namen", () => {
  const f = createFeatureFlags({ defaults: { a: true, b: false }, eventBus: createEventBus() });
  const names = f.list().sort();
  assert.deepEqual(names, ["a", "b"]);
});

test("toJSON: Snapshot des Flag-Zustands", () => {
  const f = createFeatureFlags({ defaults: { a: true }, eventBus: createEventBus() });
  f.set("b", true);
  assert.deepEqual(f.toJSON(), { a: true, b: true });
});

test("reset: stellt Defaults wieder her", () => {
  const f = createFeatureFlags({ defaults: { a: false, b: true }, eventBus: createEventBus() });
  f.set("a", true);
  f.set("b", false);
  f.reset();
  assert.deepEqual(f.toJSON(), { a: false, b: true });
});

test("FeatureFlags-Instanz ist Klasseninstanz", () => {
  const f = createFeatureFlags({ eventBus: createEventBus() });
  assert.ok(f instanceof FeatureFlags);
});
