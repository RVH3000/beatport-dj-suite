import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVersion,
  compareVersions,
  isNewer,
  formatVersion
} from "../src/version.mjs";

test("parseVersion: einfache Version", () => {
  assert.deepEqual(parseVersion("4.2.7"), {
    major: 4, minor: 2, patch: 7, prerelease: null, build: null, raw: "4.2.7"
  });
});

test("parseVersion: mit v-Prefix", () => {
  const v = parseVersion("v1.0.0");
  assert.equal(v.major, 1);
});

test("parseVersion: Prerelease und Build", () => {
  const v = parseVersion("4.2.7-beta.1+sha.abc");
  assert.equal(v.prerelease, "beta.1");
  assert.equal(v.build, "sha.abc");
});

test("parseVersion: ungültiges Format wirft", () => {
  assert.throws(() => parseVersion("nope"), /ungültiges Format/);
  assert.throws(() => parseVersion("1.2"), /ungültiges Format/);
  assert.throws(() => parseVersion(42), /erwartet String/);
});

test("compareVersions: major/minor/patch", () => {
  assert.equal(compareVersions("1.0.0", "2.0.0"), -1);
  assert.equal(compareVersions("1.2.0", "1.1.0"), 1);
  assert.equal(compareVersions("1.0.5", "1.0.5"), 0);
});

test("compareVersions: prerelease < release", () => {
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta"), 1);
});

test("compareVersions: prerelease numerisch vs alphanumerisch", () => {
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
});

test("compareVersions: längere Prerelease-Kette gewinnt bei Tie", () => {
  assert.equal(compareVersions("1.0.0-beta", "1.0.0-beta.1"), -1);
});

test("isNewer", () => {
  assert.equal(isNewer("4.2.8", "4.2.7"), true);
  assert.equal(isNewer("4.2.7", "4.2.7"), false);
  assert.equal(isNewer("4.2.6", "4.2.7"), false);
});

test("formatVersion: rundtrip", () => {
  assert.equal(formatVersion("v4.2.7"), "4.2.7");
  assert.equal(formatVersion("4.2.7-beta.1"), "4.2.7-beta.1");
  assert.equal(formatVersion("4.2.7-rc.1+sha.abc"), "4.2.7-rc.1+sha.abc");
});

test("compareVersions: akzeptiert geparstes Objekt", () => {
  const a = parseVersion("1.0.0");
  const b = parseVersion("2.0.0");
  assert.equal(compareVersions(a, b), -1);
});
