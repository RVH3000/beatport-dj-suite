// tests/track-utils.test.mjs
// Unit-Tests für die konsolidierte Pure-Funktionen-Lib unter
// electron-app/renderer/lib/track-utils.js (Phase 1 Backlog-Punkt 33).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fmt,
  esc,
  debounce,
  badgeCls,
  normBpm,
  camelotSortVal,
  camelotCompat,
  dramaScore,
  dramaColor,
  buildQueryMatcher,
  toCamelot,
  BEATPORT_KEY_TO_CAMELOT,
} from "../electron-app/renderer/lib/track-utils.js";

// ─── fmt ─────────────────────────────────────────────────────────────────────

test("fmt: gibt deutsches Format für Zahlen", () => {
  assert.equal(fmt(1234567), "1.234.567");
  assert.equal(fmt(0), "0");
});

test("fmt: gibt Platzhalter für null/undefined", () => {
  assert.equal(fmt(null), "—");
  assert.equal(fmt(undefined), "—");
});

// ─── esc ─────────────────────────────────────────────────────────────────────

test("esc: maskiert HTML-Sonderzeichen", () => {
  assert.equal(esc("<script>"), "&lt;script&gt;");
  assert.equal(esc('"&\'<>'), "&quot;&amp;'&lt;&gt;");
});

test("esc: gibt leeren String für null/undefined", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

// ─── badgeCls ────────────────────────────────────────────────────────────────

test("badgeCls: thresholds 0/6/11/20", () => {
  assert.equal(badgeCls(0), "srch-b-blue");
  assert.equal(badgeCls(5), "srch-b-blue");
  assert.equal(badgeCls(6), "srch-b-cyan");
  assert.equal(badgeCls(10), "srch-b-cyan");
  assert.equal(badgeCls(11), "srch-b-orange");
  assert.equal(badgeCls(19), "srch-b-orange");
  assert.equal(badgeCls(20), "srch-b-red");
  assert.equal(badgeCls(999), "srch-b-red");
});

// ─── normBpm ─────────────────────────────────────────────────────────────────

test("normBpm: lässt BPM im Range [80,170] unverändert", () => {
  assert.equal(normBpm(120), 120);
  assert.equal(normBpm(80), 80);
  assert.equal(normBpm(170), 170);
});

test("normBpm: verdoppelt BPM unter 80 bis Range erreicht", () => {
  assert.equal(normBpm(60), 120);
  assert.equal(normBpm(75), 150);
  assert.equal(normBpm(40), 80); // 40*2=80, Range erreicht, stop
  assert.equal(normBpm(45), 90); // 45*2=90, im Range
});

test("normBpm: halbiert BPM über 170 bis Range erreicht", () => {
  assert.equal(normBpm(180), 90);
  assert.equal(normBpm(200), 100);
  assert.equal(normBpm(340), 170); // 340/2=170, Range erreicht, stop
  assert.equal(normBpm(360), 90);  // 360/2=180, 180>170, /2=90
});

test("normBpm: gibt 0 für falsy", () => {
  assert.equal(normBpm(0), 0);
  assert.equal(normBpm(null), 0);
  assert.equal(normBpm(undefined), 0);
});

test("normBpm: rundet auf 1 Nachkommastelle", () => {
  assert.equal(normBpm(125.55), 125.6);
});

// ─── toCamelot ───────────────────────────────────────────────────────────────

test("toCamelot: Beatport-Format → Camelot", () => {
  assert.equal(toCamelot("A min"), "8A");
  assert.equal(toCamelot("C maj"), "8B");
  assert.equal(toCamelot("F# min"), "11A");
  assert.equal(toCamelot("Gb min"), "11A"); // enharmonisches Aequivalent
  assert.equal(toCamelot("E maj"), "12B");
});

test("toCamelot: Camelot-Input wird normalisiert (uppercase)", () => {
  assert.equal(toCamelot("8A"), "8A");
  assert.equal(toCamelot("11b"), "11B");
  assert.equal(toCamelot("1a"), "1A");
});

test("toCamelot: leere/null/undefined → leerer String", () => {
  assert.equal(toCamelot(""), "");
  assert.equal(toCamelot(null), "");
  assert.equal(toCamelot(undefined), "");
});

test("toCamelot: unbekannter Key → leerer String (kein Durchsickern)", () => {
  assert.equal(toCamelot("Xmin"), "");
  assert.equal(toCamelot("foo"), "");
  assert.equal(toCamelot("13A"), "13A"); // numerisch+B nur via Regex, 13 ist out-of-range aber Regex matcht
});

test("toCamelot: customMap fuer Engine-Format", () => {
  const engineMap = { "C": "8B", "Am": "8A", "0": "8B", "5": "7A" };
  assert.equal(toCamelot("C", engineMap), "8B");
  assert.equal(toCamelot("Am", engineMap), "8A");
  assert.equal(toCamelot("0", engineMap), "8B");
  assert.equal(toCamelot("notInMap", engineMap), "");
});

test("BEATPORT_KEY_TO_CAMELOT: deckt 24 Camelot-Positionen ab", () => {
  const values = new Set(Object.values(BEATPORT_KEY_TO_CAMELOT));
  assert.equal(values.size, 24); // 12 A + 12 B
});

// ─── camelotSortVal ──────────────────────────────────────────────────────────

test("camelotSortVal: 1A → 0, 1B → 1, 2A → 2, 12B → 23 (0-basierte 0..23)", () => {
  assert.equal(camelotSortVal("1A"), 0);
  assert.equal(camelotSortVal("1B"), 1);
  assert.equal(camelotSortVal("2A"), 2);
  assert.equal(camelotSortVal("12A"), 22);
  assert.equal(camelotSortVal("12B"), 23);
});

test("camelotSortVal: gibt 999 für invalide Inputs", () => {
  assert.equal(camelotSortVal(""), 999);
  assert.equal(camelotSortVal(null), 999);
  assert.equal(camelotSortVal("xyz"), 999);
  assert.equal(camelotSortVal("AB"), 999);
});

test("camelotSortVal: ist case-insensitive (b → B)", () => {
  assert.equal(camelotSortVal("1b"), 1);
  assert.equal(camelotSortVal("12a"), 22);
});

// ─── camelotCompat ───────────────────────────────────────────────────────────

test("camelotCompat: perfect für identische Werte", () => {
  assert.equal(camelotCompat("8A", "8A"), "perfect");
  assert.equal(camelotCompat("12B", "12B"), "perfect");
});

test("camelotCompat: good für ±1 (Wheel-Wrap 12↔1) oder Mode-Wechsel", () => {
  assert.equal(camelotCompat("8A", "9A"), "good");
  assert.equal(camelotCompat("8A", "7A"), "good");
  assert.equal(camelotCompat("12A", "1A"), "good"); // wheel wrap
  assert.equal(camelotCompat("8A", "8B"), "good"); // mode switch
});

test("camelotCompat: ok für ±2 (energy boost)", () => {
  assert.equal(camelotCompat("8A", "10A"), "ok");
  assert.equal(camelotCompat("8A", "6A"), "ok");
  assert.equal(camelotCompat("12A", "2A"), "ok"); // wheel wrap
});

test("camelotCompat: none für leere oder invalide Eingaben", () => {
  assert.equal(camelotCompat("", "8A"), "none");
  assert.equal(camelotCompat("8A", null), "none");
  assert.equal(camelotCompat("xyz", "8A"), "none");
});

// ─── dramaScore ──────────────────────────────────────────────────────────────

test("dramaScore: deterministisch für gleiche Inputs", () => {
  const s1 = dramaScore(125, "8A");
  const s2 = dramaScore(125, "8A");
  assert.equal(s1, s2);
});

test("dramaScore: gibt 0 wenn weder bpm noch camelot vorhanden", () => {
  assert.equal(dramaScore(null, null), 0);
  assert.equal(dramaScore(0, ""), 0);
  assert.equal(dramaScore(undefined, undefined), 0);
});

test("dramaScore: höhere BPM → höhere Werte (bei konstantem Camelot)", () => {
  const low = dramaScore(90, "8A");
  const high = dramaScore(160, "8A");
  assert.ok(high > low);
});

test("dramaScore: respektiert useNorm=false-Option (rohe BPM-Werte)", () => {
  // BPM = 60 ist außerhalb [80,170]; mit useNorm wird auf 120 normalisiert.
  const norm = dramaScore(60, "8A", { useNorm: true });
  const raw = dramaScore(60, "8A", { useNorm: false });
  assert.notEqual(norm, raw);
});

test("dramaScore: Default ist useNorm=true", () => {
  const def = dramaScore(60, "8A");
  const explicit = dramaScore(60, "8A", { useNorm: true });
  assert.equal(def, explicit);
});

// ─── dramaColor ──────────────────────────────────────────────────────────────

test("dramaColor: thresholds 15/35/55/75", () => {
  assert.equal(dramaColor(0), "#74c0fc");
  assert.equal(dramaColor(14), "#74c0fc");
  assert.equal(dramaColor(15), "var(--primary, #0e6b5f)");
  assert.equal(dramaColor(34), "var(--primary, #0e6b5f)");
  assert.equal(dramaColor(35), "#fbbf24");
  assert.equal(dramaColor(54), "#fbbf24");
  assert.equal(dramaColor(55), "#ff6b35");
  assert.equal(dramaColor(74), "#ff6b35");
  assert.equal(dramaColor(75), "var(--danger, #dc2626)");
  assert.equal(dramaColor(100), "var(--danger, #dc2626)");
});

// ─── buildQueryMatcher ───────────────────────────────────────────────────────

test("buildQueryMatcher: gibt null für leeren Query", () => {
  assert.equal(buildQueryMatcher(""), null);
  assert.equal(buildQueryMatcher("   "), null);
  assert.equal(buildQueryMatcher(null), null);
});

test("buildQueryMatcher: einfache Substring-Suche (case-insensitive)", () => {
  const m = buildQueryMatcher("FISHER");
  assert.equal(m("fisher remix"), true);
  assert.equal(m("FISHER (Original)"), true);
  assert.equal(m("Mau P"), false);
});

test("buildQueryMatcher: Wildcard * matcht beliebige Zeichen", () => {
  const m = buildQueryMatcher("orig*mix");
  assert.equal(m("Original Mix"), true);
  assert.equal(m("origmix"), true);
  assert.equal(m("Extended Mix"), false);
});

test("buildQueryMatcher: Wildcard ? matcht genau ein Zeichen", () => {
  const m = buildQueryMatcher("p?w");
  assert.equal(m("paw"), true);
  assert.equal(m("pew"), true);
  assert.equal(m("pwx"), false); // ? braucht genau 1 Zeichen
});

test("buildQueryMatcher: schluckt null/undefined-Inputs in Match-Funktion", () => {
  const m = buildQueryMatcher("test");
  assert.equal(m(null), false);
  assert.equal(m(undefined), false);
});

// ─── debounce ────────────────────────────────────────────────────────────────

test("debounce: ruft fn erst nach Verzögerung auf, einmalig bei Burst", async () => {
  let callCount = 0;
  const d = debounce(() => { callCount++; }, 50);
  d(); d(); d();
  assert.equal(callCount, 0); // sofort noch nicht aufgerufen
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(callCount, 1); // genau einmal nach Verzögerung
});
