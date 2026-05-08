import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHANNELS,
  isValidChannel,
  detectChannel,
  channelAccepts,
  filterReleasesByChannel
} from "../src/channels.mjs";

test("CHANNELS: stable/beta/alpha in dieser Reihenfolge", () => {
  assert.deepEqual([...CHANNELS], ["stable", "beta", "alpha"]);
});

test("isValidChannel", () => {
  assert.equal(isValidChannel("stable"), true);
  assert.equal(isValidChannel("beta"), true);
  assert.equal(isValidChannel("alpha"), true);
  assert.equal(isValidChannel("nightly"), false);
  assert.equal(isValidChannel(""), false);
});

test("detectChannel: stable bei fehlender Prerelease", () => {
  assert.equal(detectChannel("4.2.7"), "stable");
});

test("detectChannel: beta/alpha aus Prerelease", () => {
  assert.equal(detectChannel("4.2.7-beta.1"), "beta");
  assert.equal(detectChannel("4.2.7-alpha.3"), "alpha");
});

test("detectChannel: unbekannte Prerelease → alpha (konservativ)", () => {
  assert.equal(detectChannel("4.2.7-rc.1"), "alpha");
  assert.equal(detectChannel("4.2.7-canary"), "alpha");
});

test("channelAccepts: stable-Channel akzeptiert nur stable", () => {
  assert.equal(channelAccepts("stable", "stable"), true);
  assert.equal(channelAccepts("stable", "beta"), false);
  assert.equal(channelAccepts("stable", "alpha"), false);
});

test("channelAccepts: beta-Channel akzeptiert stable + beta, kein alpha", () => {
  assert.equal(channelAccepts("beta", "stable"), true);
  assert.equal(channelAccepts("beta", "beta"), true);
  assert.equal(channelAccepts("beta", "alpha"), false);
});

test("channelAccepts: alpha-Channel akzeptiert alle", () => {
  assert.equal(channelAccepts("alpha", "stable"), true);
  assert.equal(channelAccepts("alpha", "beta"), true);
  assert.equal(channelAccepts("alpha", "alpha"), true);
});

test("channelAccepts: ungültiger Channel wirft", () => {
  assert.throws(() => channelAccepts("nightly", "stable"), /Unknown channel/);
  assert.throws(() => channelAccepts("stable", "nightly"), /Unknown channel/);
});

test("filterReleasesByChannel: nur passende Releases", () => {
  const releases = [
    { version: "4.2.7" },
    { version: "4.2.8-beta.1" },
    { version: "4.2.8-alpha.2" },
    { version: "4.3.0" }
  ];
  assert.deepEqual(
    filterReleasesByChannel(releases, "stable").map((r) => r.version),
    ["4.2.7", "4.3.0"]
  );
  assert.deepEqual(
    filterReleasesByChannel(releases, "beta").map((r) => r.version),
    ["4.2.7", "4.2.8-beta.1", "4.3.0"]
  );
  assert.equal(filterReleasesByChannel(releases, "alpha").length, 4);
});

test("filterReleasesByChannel: ungültiger Channel wirft", () => {
  assert.throws(() => filterReleasesByChannel([], "nightly"), /Unknown channel/);
});
