import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_SOURCES, buildAnalysis, mergeAnalyses } from "../src/analysis.mjs";

test("ANALYSIS_SOURCES enthält die 4 Quellen", () => {
  for (const s of ["beatport", "engine", "manual", "external"]) {
    assert.ok(ANALYSIS_SOURCES.includes(s));
  }
});

test("buildAnalysis: wirft ohne trackId", () => {
  assert.throws(() => buildAnalysis({}), /trackId erforderlich/);
});

test("buildAnalysis: wirft bei unbekannter source", () => {
  assert.throws(() => buildAnalysis({ trackId: "x", source: "alien" }), /unbekannte source/);
});

test("buildAnalysis: setzt Defaults", () => {
  const a = buildAnalysis({ trackId: "t1" });
  assert.equal(a.source, "manual");
  assert.equal(a.bpm, null);
  assert.equal(a.confidence, 1);
  assert.ok(a.timestamp > 0);
});

test("buildAnalysis: clamped confidence + energy auf 0..1", () => {
  const a = buildAnalysis({ trackId: "t1", confidence: 5, energy: -2 });
  assert.equal(a.confidence, 1);
  assert.equal(a.energy, 0);
});

test("buildAnalysis: camelot wird upper-cased", () => {
  const a = buildAnalysis({ trackId: "t1", camelot: "8a" });
  assert.equal(a.camelot, "8A");
});

test("mergeAnalyses: leere Liste → null", () => {
  assert.equal(mergeAnalyses([]), null);
});

test("mergeAnalyses: einzelne Analyse wird kopiert", () => {
  const a = buildAnalysis({ trackId: "t1", bpm: 120 });
  const merged = mergeAnalyses([a]);
  assert.deepEqual(merged, a);
});

test("mergeAnalyses: wirft bei verschiedenen trackIds", () => {
  const a = buildAnalysis({ trackId: "t1" });
  const b = buildAnalysis({ trackId: "t2" });
  assert.throws(() => mergeAnalyses([a, b]), /trackId/);
});

test("mergeAnalyses: numerische Felder gewichtet kombiniert", () => {
  const a = buildAnalysis({ trackId: "t1", bpm: 120, confidence: 1 });
  const b = buildAnalysis({ trackId: "t1", bpm: 130, confidence: 0.5 });
  const m = mergeAnalyses([a, b]);
  // (120*1 + 130*0.5) / (1 + 0.5) = 195 / 1.5 = 130 ... aber gewichtet zu 120 hin
  // 120*1 + 130*0.5 = 185 → /1.5 = 123.33
  assert.ok(m.bpm > 122 && m.bpm < 124);
});

test("mergeAnalyses: höchste confidence gewinnt bei String-Feldern", () => {
  const a = buildAnalysis({ trackId: "t1", camelot: "8A", confidence: 0.3 });
  const b = buildAnalysis({ trackId: "t1", camelot: "9A", confidence: 0.9 });
  const m = mergeAnalyses([a, b]);
  assert.equal(m.camelot, "9A");
});

test("mergeAnalyses: liefert sources-Liste", () => {
  const a = buildAnalysis({ trackId: "t1", source: "beatport" });
  const b = buildAnalysis({ trackId: "t1", source: "engine" });
  const m = mergeAnalyses([a, b]);
  assert.deepEqual(m.sources.sort(), ["beatport", "engine"]);
  assert.equal(m.source, "merged");
});
