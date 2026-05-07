import { test } from "node:test";
import assert from "node:assert/strict";
import { BootSequence, createBootSequence, BOOT_PHASES } from "../src/boot.mjs";
import { createLogger } from "@bpdjs/core";

function silentLogger() {
  return createLogger({ level: "silent" });
}

test("BOOT_PHASES enthält die erwarteten Phasen in Reihenfolge", () => {
  assert.deepEqual(BOOT_PHASES, ["pre-init", "config-load", "ipc-bind", "ui-mount", "ready"]);
});

test("BootSequence.add: wirft bei unbekannter Phase", () => {
  const b = createBootSequence({ logger: silentLogger() });
  assert.throws(() => b.add("schwurbel", () => {}), /unbekannte Phase/);
});

test("BootSequence.add: wirft wenn fn keine Funktion", () => {
  const b = createBootSequence({ logger: silentLogger() });
  assert.throws(() => b.add("config-load", "not a fn"), /muss Funktion sein/);
});

test("BootSequence.run: führt Phasen in BOOT_PHASES-Reihenfolge aus", async () => {
  const order = [];
  const b = createBootSequence({ logger: silentLogger() });
  // Hinzufügen in falscher Reihenfolge → run sortiert
  b.add("ui-mount", () => order.push("ui-mount"));
  b.add("config-load", () => order.push("config-load"));
  b.add("pre-init", () => order.push("pre-init"));
  const result = await b.run();
  assert.equal(result.ok, true);
  assert.deepEqual(order, ["pre-init", "config-load", "ui-mount"]);
});

test("BootSequence.run: kollektiert Ergebnisse pro Phase", async () => {
  const b = createBootSequence({ logger: silentLogger() });
  b.add("config-load", async () => ({ paths: 5 }));
  b.add("ipc-bind", async () => ({ handlers: 95 }));
  const result = await b.run();
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0].result, { paths: 5 });
  assert.equal(result.results[1].ok, true);
});

test("BootSequence.run: bricht bei Fehler ab und meldet failedAt", async () => {
  const b = createBootSequence({ logger: silentLogger() });
  b.add("config-load", async () => "ok");
  b.add("ipc-bind", async () => { throw new Error("krach"); });
  b.add("ready", async () => "should not run");
  const result = await b.run();
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, "ipc-bind");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].error, "krach");
});

test("BootSequence: completedPhases enthält erfolgreich gelaufene Phasen", async () => {
  const b = createBootSequence({ logger: silentLogger() });
  b.add("pre-init", () => "a");
  b.add("config-load", () => "b");
  await b.run();
  assert.deepEqual(b.completedPhases, ["pre-init", "config-load"]);
});

test("BootSequence: leeres run() ist ok", async () => {
  const b = createBootSequence({ logger: silentLogger() });
  const result = await b.run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.results, []);
});

test("createBootSequence: liefert BootSequence-Instanz", () => {
  assert.ok(createBootSequence({ logger: silentLogger() }) instanceof BootSequence);
});
