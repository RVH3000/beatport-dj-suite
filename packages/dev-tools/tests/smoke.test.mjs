import { test } from "node:test";
import assert from "node:assert/strict";
import { SmokeRunner, createSmokeRunner } from "../src/smoke.mjs";

const silentLogger = { info() {}, warn() {}, error() {}, tag() { return this; } };

test("SmokeRunner.add: validiert Argumente", () => {
  const runner = new SmokeRunner({ logger: silentLogger });
  assert.throws(() => runner.add(null, () => {}), /name erforderlich/);
  assert.throws(() => runner.add("x", "not-a-fn"), /muss Funktion sein/);
});

test("SmokeRunner.run: alle Checks ok", async () => {
  const runner = new SmokeRunner({ logger: silentLogger })
    .add("a", () => 1)
    .add("b", async () => "done");
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].value, 1);
  assert.equal(result.results[1].value, "done");
});

test("SmokeRunner.run: einzelner Fail bricht NICHT ab (Default)", async () => {
  const runner = new SmokeRunner({ logger: silentLogger })
    .add("ok-1", () => 1)
    .add("fails", () => { throw new Error("boom"); })
    .add("ok-2", () => 2);
  const result = await runner.run();
  assert.equal(result.ok, false);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].error, "boom");
  assert.equal(result.results[2].value, 2);
});

test("SmokeRunner.run: stopOnFail bricht ab", async () => {
  const runner = new SmokeRunner({ logger: silentLogger })
    .add("fails", () => { throw new Error("nope"); })
    .add("never-runs", () => 1);
  const result = await runner.run({ stopOnFail: true });
  assert.equal(result.ok, false);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].name, "fails");
});

test("SmokeRunner.checkCount", () => {
  const runner = new SmokeRunner({ logger: silentLogger });
  assert.equal(runner.checkCount, 0);
  runner.add("x", () => {}).add("y", () => {});
  assert.equal(runner.checkCount, 2);
});

test("createSmokeRunner: erzeugt Instanz", () => {
  const runner = createSmokeRunner({ logger: silentLogger });
  assert.ok(runner instanceof SmokeRunner);
});

test("SmokeRunner: durationMs wird gemessen", async () => {
  const runner = new SmokeRunner({ logger: silentLogger })
    .add("slow", async () => { await new Promise((r) => setTimeout(r, 5)); });
  const result = await runner.run();
  assert.ok(result.results[0].durationMs >= 0);
});
