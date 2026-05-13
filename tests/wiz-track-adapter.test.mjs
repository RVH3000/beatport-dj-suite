// tests/wiz-track-adapter.test.mjs
// Unit-Tests fuer den WIZ-Track-Adapter (Backlog-Punkt 33, v4.4.0).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  wizTrackToFilterable,
  wizTracksToFilterable,
} from "../electron-app/renderer/lib/wiz-track-adapter.js";

// Hilfs-Faktoren fuer Test-Tracks (Beatport-WIZ-Format)
const baseTrack = {
  trackId: 12345,
  title: "Roll Play",
  mixName: "Extended Mix",
  artists: "PAWSA",
  remixers: "",
  genre: "Minimal / Deep Tech",
  subGenre: "",
  label: "PAWZ",
  releaseDate: "2024-03-15",
  bpm: 128,
  key: "Db min",
  duration: 360000,
  isrc: "GBLFP2400123",
  catalogNumber: "PAWZ024",
  source: "xhr",
};

test("wizTrackToFilterable: vollstaendiger Track wird sauber gemappt", () => {
  const result = wizTrackToFilterable(baseTrack);
  assert.equal(result.track_id, "12345");
  assert.equal(result.title, "Roll Play");
  assert.equal(result.mix_name, "Extended Mix");
  assert.equal(result.artists, "PAWSA");
  assert.equal(result.genre, "Minimal / Deep Tech");
  assert.equal(result.label, "PAWZ");
  assert.equal(result.bpm, 128);
  assert.equal(result.key, "Db min");
  assert.equal(result.camelot, "12A"); // Db min → 12A
  assert.equal(result.year, 2024);
  assert.ok(typeof result.drama === "number");
  // Konstanten fuer WIZ-Kontext
  assert.equal(result.count, 0);
  assert.equal(result.rating, null);
  assert.equal(result.is_hype, false);
  assert.equal(result.is_dj_edit, false);
  assert.equal(result.plays_total, 0);
});

test("wizTrackToFilterable: track_id wird zu String", () => {
  const result = wizTrackToFilterable({ ...baseTrack, trackId: 99 });
  assert.equal(typeof result.track_id, "string");
  assert.equal(result.track_id, "99");
});

test("wizTrackToFilterable: fehlende releaseDate → year = null", () => {
  assert.equal(wizTrackToFilterable({ ...baseTrack, releaseDate: null }).year, null);
  assert.equal(wizTrackToFilterable({ ...baseTrack, releaseDate: "" }).year, null);
  assert.equal(wizTrackToFilterable({ ...baseTrack, releaseDate: undefined }).year, null);
});

test("wizTrackToFilterable: malformed releaseDate → year = null", () => {
  assert.equal(wizTrackToFilterable({ ...baseTrack, releaseDate: "unknown" }).year, null);
  assert.equal(wizTrackToFilterable({ ...baseTrack, releaseDate: "0000-01-01" }).year, null);
  assert.equal(wizTrackToFilterable({ ...baseTrack, releaseDate: "3000-01-01" }).year, null);
});

test("wizTrackToFilterable: unbekannter Key → camelot = leerer String", () => {
  assert.equal(wizTrackToFilterable({ ...baseTrack, key: "" }).camelot, "");
  assert.equal(wizTrackToFilterable({ ...baseTrack, key: null }).camelot, "");
  assert.equal(wizTrackToFilterable({ ...baseTrack, key: "Xmin" }).camelot, "");
});

test("wizTrackToFilterable: fehlende bpm → 0, bpmNorm → 0, drama → 0", () => {
  const result = wizTrackToFilterable({ ...baseTrack, bpm: null, key: "" });
  assert.equal(result.bpm, 0);
  assert.equal(result.bpmNorm, 0);
  assert.equal(result.drama, 0);
});

test("wizTrackToFilterable: bpm als String wird zu Number", () => {
  const result = wizTrackToFilterable({ ...baseTrack, bpm: "128" });
  assert.equal(result.bpm, 128);
  assert.equal(typeof result.bpm, "number");
});

test("wizTrackToFilterable: null/undefined Input → null", () => {
  assert.equal(wizTrackToFilterable(null), null);
  assert.equal(wizTrackToFilterable(undefined), null);
  assert.equal(wizTrackToFilterable("nicht-objekt"), null);
});

test("wizTracksToFilterable: leeres/Non-Array Input → []", () => {
  assert.deepEqual(wizTracksToFilterable([]), []);
  assert.deepEqual(wizTracksToFilterable(null), []);
  assert.deepEqual(wizTracksToFilterable(undefined), []);
  assert.deepEqual(wizTracksToFilterable("string"), []);
});

test("wizTracksToFilterable: Array mit gemischten Validitaeten filtert null heraus", () => {
  const result = wizTracksToFilterable([
    baseTrack,
    null,
    { ...baseTrack, trackId: 999 },
    undefined,
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].track_id, "12345");
  assert.equal(result[1].track_id, "999");
});

test("wizTracksToFilterable: Camelot wird fuer alle Tracks abgeleitet", () => {
  const tracks = [
    { ...baseTrack, key: "A min" },   // 8A
    { ...baseTrack, key: "C maj" },   // 8B
    { ...baseTrack, key: "F# min" },  // 11A
  ];
  const result = wizTracksToFilterable(tracks);
  assert.equal(result[0].camelot, "8A");
  assert.equal(result[1].camelot, "8B");
  assert.equal(result[2].camelot, "11A");
});
