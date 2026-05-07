import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBpmFitness, computeKeyFitness, computePerformanceScore, rankByScore } from "../src/scoring.mjs";

test("computeBpmFitness: target hit = 1", () => {
  assert.equal(computeBpmFitness(120, { target: 120 }), 1);
});

test("computeBpmFitness: außerhalb tolerance = 0", () => {
  assert.equal(computeBpmFitness(120, { target: 140, tolerance: 4 }), 0);
});

test("computeBpmFitness: linear innerhalb tolerance", () => {
  assert.equal(computeBpmFitness(122, { target: 120, tolerance: 4 }), 0.5);
});

test("computeBpmFitness: ohne target = 0", () => {
  assert.equal(computeBpmFitness(120, {}), 0);
});

test("computeKeyFitness: camelot = 1", () => {
  assert.equal(computeKeyFitness({ camelot: "8A" }), 1);
});

test("computeKeyFitness: nur key = 0.7", () => {
  assert.equal(computeKeyFitness({ key: "Am" }), 0.7);
});

test("computeKeyFitness: ohne key = 0", () => {
  assert.equal(computeKeyFitness({}), 0);
});

test("computePerformanceScore: kombiniert alle Signale", () => {
  const score = computePerformanceScore(
    { bpm: 120, camelot: "8A" },
    { target: 120, energy: 1, genreMatch: true }
  );
  // bpm=1*0.4 + key=1*0.2 + energy=1*0.25 + genre=1*0.15 = 1.0 → 100
  assert.equal(score, 100);
});

test("computePerformanceScore: ohne Signale = 0", () => {
  assert.equal(computePerformanceScore({}, {}), 0);
});

test("rankByScore: sortiert absteigend", () => {
  const tracks = [
    { id: "low", bpm: 100 },
    { id: "high", bpm: 120, camelot: "8A" },
    { id: "mid", bpm: 122, camelot: "8A" }
  ];
  const ranked = rankByScore(tracks, { target: 120, tolerance: 4 });
  assert.equal(ranked[0].track.id, "high");
});
