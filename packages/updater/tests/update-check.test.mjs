import { test } from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, createUpdateChecker } from "../src/update-check.mjs";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, tag() { return this; } };

test("checkForUpdate: kein Update wenn current gleich latest", () => {
  const result = checkForUpdate({
    current: "4.2.7",
    releases: [{ version: "4.2.7" }, { version: "4.2.6" }]
  });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.latest.version, "4.2.7");
  assert.equal(result.fromReleases, 2);
});

test("checkForUpdate: Update wenn neuere Version verfügbar", () => {
  const result = checkForUpdate({
    current: "4.2.7",
    releases: [{ version: "4.2.8" }, { version: "4.2.6" }]
  });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latest.version, "4.2.8");
});

test("checkForUpdate: filtert Beta wenn auf stable-Channel", () => {
  const result = checkForUpdate({
    current: "4.2.7",
    channel: "stable",
    releases: [
      { version: "4.2.8-beta.1" },
      { version: "4.2.7" }
    ]
  });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.latest.version, "4.2.7");
});

test("checkForUpdate: nimmt Beta wenn auf beta-Channel", () => {
  const result = checkForUpdate({
    current: "4.2.7",
    channel: "beta",
    releases: [
      { version: "4.2.8-beta.1" },
      { version: "4.2.7" }
    ]
  });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latest.version, "4.2.8-beta.1");
});

test("checkForUpdate: leere Releases → updateAvailable false, latest null", () => {
  const result = checkForUpdate({ current: "4.2.7", releases: [] });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.latest, null);
});

test("checkForUpdate: erkennt currentChannel", () => {
  const result = checkForUpdate({
    current: "4.2.7-beta.1",
    channel: "beta",
    releases: [{ version: "4.2.7-beta.2" }]
  });
  assert.equal(result.currentChannel, "beta");
  assert.equal(result.updateAvailable, true);
});

test("checkForUpdate: ungültige Inputs werfen", () => {
  assert.throws(() => checkForUpdate({ releases: [] }), /current erforderlich/);
  assert.throws(() => checkForUpdate({ current: "1.0.0", releases: "x" }), /Array/);
  assert.throws(
    () => checkForUpdate({ current: "1.0.0", releases: [], channel: "nightly" }),
    /ungültiger channel/
  );
});

test("checkForUpdate: kürt höchste Version (auch unsortiert)", () => {
  const result = checkForUpdate({
    current: "4.2.0",
    releases: [
      { version: "4.2.1" },
      { version: "4.3.0" },
      { version: "4.2.9" }
    ]
  });
  assert.equal(result.latest.version, "4.3.0");
});

test("createUpdateChecker: ruft Fetcher und liefert Ergebnis", async () => {
  let called = 0;
  const checker = createUpdateChecker({
    logger: silentLogger,
    fetchReleases: async () => {
      called += 1;
      return [{ version: "4.2.8" }, { version: "4.2.7" }];
    }
  });
  const result = await checker.check({ current: "4.2.7", channel: "stable" });
  assert.equal(called, 1);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latest.version, "4.2.8");
});

test("createUpdateChecker: ungültiger Fetcher wirft", () => {
  assert.throws(() => createUpdateChecker({}), /fetchReleases muss Funktion sein/);
  assert.throws(
    () => createUpdateChecker({ fetchReleases: "no" }),
    /fetchReleases muss Funktion sein/
  );
});
