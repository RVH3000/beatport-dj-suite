import { test } from "node:test";
import assert from "node:assert/strict";
import { TabRouter, createTabRouter, TAB_CHANGED } from "../src/tab-router.mjs";
import { createEventBus } from "@bpdjs/core";

function defaultTabs() {
  return [
    { id: "library", label: "Library" },
    { id: "explore", label: "Explore" },
    { id: "build", label: "Build" },
    { id: "debug", label: "Debug", requiresMode: "developer" }
  ];
}

test("TabRouter: leerer Konstruktor → kein active Tab", () => {
  const r = new TabRouter({ eventBus: createEventBus() });
  assert.equal(r.active, null);
});

test("TabRouter: setzt initial den ersten sichtbaren Tab", () => {
  const r = createTabRouter({ tabs: defaultTabs(), eventBus: createEventBus() });
  assert.equal(r.active, "library");
});

test("TabRouter: explizites initial wird respektiert", () => {
  const r = createTabRouter({ tabs: defaultTabs(), initial: "explore", eventBus: createEventBus() });
  assert.equal(r.active, "explore");
});

test("visibleTabs: respektiert mode-Filter", () => {
  const r = createTabRouter({ tabs: defaultTabs(), mode: "standard", eventBus: createEventBus() });
  const visible = r.visibleTabs().map((t) => t.id);
  assert.deepEqual(visible, ["library", "explore", "build"]);
});

test("visibleTabs: developer-mode zeigt Debug-Tab", () => {
  const r = createTabRouter({ tabs: defaultTabs(), mode: "developer", eventBus: createEventBus() });
  const visible = r.visibleTabs().map((t) => t.id);
  assert.ok(visible.includes("debug"));
});

test("switchTo: ändert active und feuert TAB_CHANGED", () => {
  const bus = createEventBus();
  const events = [];
  bus.on(TAB_CHANGED, (e) => events.push(e));
  const r = createTabRouter({ tabs: defaultTabs(), eventBus: bus });
  r.switchTo("build");
  assert.equal(r.active, "build");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { from: "library", to: "build" });
});

test("switchTo: wirft bei unbekanntem Tab", () => {
  const r = createTabRouter({ tabs: defaultTabs(), eventBus: createEventBus() });
  assert.throws(() => r.switchTo("ghost"), /unbekannter Tab/);
});

test("switchTo: wirft bei unsichtbarem Tab im aktuellen Mode", () => {
  const r = createTabRouter({ tabs: defaultTabs(), mode: "standard", eventBus: createEventBus() });
  assert.throws(() => r.switchTo("debug"), /nicht sichtbar/);
});

test("setMode: schaltet Tab-Sichtbarkeit um", () => {
  const r = createTabRouter({ tabs: defaultTabs(), mode: "standard", eventBus: createEventBus() });
  assert.equal(r.isVisible("debug"), false);
  r.setMode("developer");
  assert.equal(r.isVisible("debug"), true);
  r.switchTo("debug");
  assert.equal(r.active, "debug");
});

test("setMode: aktiver Tab wird unsichtbar → Fallback auf ersten sichtbaren", () => {
  const r = createTabRouter({ tabs: defaultTabs(), mode: "developer", initial: "debug", eventBus: createEventBus() });
  r.setMode("standard");
  assert.equal(r.active, "library");
});

test("addTab: fügt hinzu, optional aktiviert", () => {
  const r = createTabRouter({ tabs: defaultTabs(), eventBus: createEventBus() });
  r.addTab({ id: "pipeline", label: "Pipeline" }, { activate: true });
  assert.equal(r.active, "pipeline");
});

test("addTab: wirft bei Duplikat", () => {
  const r = createTabRouter({ tabs: defaultTabs(), eventBus: createEventBus() });
  assert.throws(() => r.addTab({ id: "library", label: "x" }), /existiert bereits/);
});

test("removeTab: entfernt + fällt auf ersten zurück wenn aktiv war", () => {
  const r = createTabRouter({ tabs: defaultTabs(), initial: "explore", eventBus: createEventBus() });
  r.removeTab("explore");
  assert.equal(r.active, "library");
  assert.equal(r.hasTab("explore"), false);
});
