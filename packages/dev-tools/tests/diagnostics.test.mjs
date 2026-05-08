import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DiagnosticsCollector,
  createDiagnosticsCollector,
  collectEnvironment,
  formatDiagnosticsReport
} from "../src/diagnostics.mjs";

const silentLogger = { info() {}, warn() {}, error() {}, tag() { return this; } };

test("collectEnvironment: liefert Node/OS/Memory-Felder", () => {
  const env = collectEnvironment();
  assert.match(env.node, /^v\d+/);
  assert.ok(env.platform);
  assert.ok(env.arch);
  assert.ok(typeof env.pid === "number");
  assert.ok(typeof env.memory.rssMb === "number");
  assert.ok(env.os.cpuCount >= 1);
});

test("DiagnosticsCollector.register: validiert Argumente", () => {
  const dc = new DiagnosticsCollector({ logger: silentLogger });
  assert.throws(() => dc.register(null, () => {}), /name erforderlich/);
  assert.throws(() => dc.register("x", 42), /muss Funktion sein/);
});

test("DiagnosticsCollector.run: liefert Report mit Environment + Checks", async () => {
  const dc = new DiagnosticsCollector({ logger: silentLogger })
    .register("count", () => 7)
    .register("async-info", async () => ({ a: 1 }));
  const report = await dc.run();
  assert.ok(report.startedAt);
  assert.ok(report.finishedAt);
  assert.ok(report.environment);
  assert.equal(report.checks.count.ok, true);
  assert.equal(report.checks.count.value, 7);
  assert.deepEqual(report.checks["async-info"].value, { a: 1 });
});

test("DiagnosticsCollector.run: Check-Fehler stoppen den Lauf nicht", async () => {
  const dc = new DiagnosticsCollector({ logger: silentLogger })
    .register("good", () => "ok")
    .register("bad", () => { throw new Error("kaputt"); })
    .register("after", () => "weiter");
  const report = await dc.run();
  assert.equal(report.checks.good.ok, true);
  assert.equal(report.checks.bad.ok, false);
  assert.equal(report.checks.bad.error, "kaputt");
  assert.equal(report.checks.after.value, "weiter");
});

test("DiagnosticsCollector: includeEnvironment=false unterdrückt Env-Block", async () => {
  const dc = new DiagnosticsCollector({ logger: silentLogger, includeEnvironment: false })
    .register("a", () => 1);
  const report = await dc.run();
  assert.equal(report.environment, undefined);
  assert.equal(report.checks.a.value, 1);
});

test("DiagnosticsCollector.checkCount", () => {
  const dc = new DiagnosticsCollector({ logger: silentLogger });
  assert.equal(dc.checkCount, 0);
  dc.register("a", () => {}).register("b", () => {});
  assert.equal(dc.checkCount, 2);
});

test("createDiagnosticsCollector: Factory gibt Instanz", () => {
  const dc = createDiagnosticsCollector({ logger: silentLogger });
  assert.ok(dc instanceof DiagnosticsCollector);
});

test("formatDiagnosticsReport: erzeugt menschenlesbaren Text", async () => {
  const dc = new DiagnosticsCollector({ logger: silentLogger })
    .register("ping", () => "pong")
    .register("failing", () => { throw new Error("oops"); });
  const report = await dc.run();
  const text = formatDiagnosticsReport(report);
  assert.match(text, /Diagnostics-Report/);
  assert.match(text, /Umgebung:/);
  assert.match(text, /Checks:/);
  assert.match(text, /✓ ping/);
  assert.match(text, /✗ failing/);
  assert.match(text, /oops/);
});

test("formatDiagnosticsReport: ohne Environment keine Umgebungs-Zeilen", async () => {
  const dc = new DiagnosticsCollector({ logger: silentLogger, includeEnvironment: false })
    .register("a", () => 1);
  const report = await dc.run();
  const text = formatDiagnosticsReport(report);
  assert.doesNotMatch(text, /Umgebung:/);
});
