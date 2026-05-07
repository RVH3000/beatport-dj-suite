import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCamelot, normalizeKey, isCompatible, distance, shift, flipMode } from "../src/camelot.mjs";

test("parseCamelot: gültige Notationen", () => {
  assert.deepEqual(parseCamelot("8A"), { num: 8, letter: "A", raw: "8A" });
  assert.deepEqual(parseCamelot("12B"), { num: 12, letter: "B", raw: "12B" });
  assert.deepEqual(parseCamelot("1a"), { num: 1, letter: "A", raw: "1A" });
});

test("parseCamelot: ungültige Eingaben", () => {
  assert.equal(parseCamelot(null), null);
  assert.equal(parseCamelot(""), null);
  assert.equal(parseCamelot("13A"), null);
  assert.equal(parseCamelot("0B"), null);
  assert.equal(parseCamelot("Am"), null);
});

test("normalizeKey: Camelot-Input wird durchgereicht", () => {
  assert.equal(normalizeKey("8A"), "8A");
  assert.equal(normalizeKey("8a"), "8A");
});

test("normalizeKey: Klassische Notation → Camelot", () => {
  assert.equal(normalizeKey("Am"), "8A");
  assert.equal(normalizeKey("C"), "8B");
  assert.equal(normalizeKey("F#m"), "11A");
  assert.equal(normalizeKey("Db"), "3B");
  assert.equal(normalizeKey("C# min"), "12A");
  assert.equal(normalizeKey("Eb maj"), "5B");
});

test("normalizeKey: unbekannter Input → null", () => {
  assert.equal(normalizeKey("Xyz"), null);
  assert.equal(normalizeKey(null), null);
  assert.equal(normalizeKey(""), null);
});

test("isCompatible: identisch ist kompatibel", () => {
  assert.equal(isCompatible("8A", "8A"), true);
});

test("isCompatible: ±1 auf gleichem Letter ist kompatibel", () => {
  assert.equal(isCompatible("8A", "7A"), true);
  assert.equal(isCompatible("8A", "9A"), true);
  // Wheel-Wrap: 12A ↔ 1A
  assert.equal(isCompatible("12A", "1A"), true);
  assert.equal(isCompatible("1B", "12B"), true);
});

test("isCompatible: Innen↔Außen am gleichen Slot ist kompatibel", () => {
  assert.equal(isCompatible("8A", "8B"), true);
  assert.equal(isCompatible("3B", "3A"), true);
});

test("isCompatible: 2-Slot-Sprünge sind nicht kompatibel", () => {
  assert.equal(isCompatible("8A", "10A"), false);
  assert.equal(isCompatible("8A", "5B"), false);
});

test("isCompatible: ungültige Eingaben", () => {
  assert.equal(isCompatible("8A", "Xyz"), false);
  assert.equal(isCompatible(null, "8A"), false);
});

test("distance: identisch = 0", () => {
  assert.equal(distance("5A", "5A"), 0);
});

test("distance: Innen↔Außen = 1", () => {
  assert.equal(distance("5A", "5B"), 1);
});

test("distance: zyklisch im Wheel", () => {
  assert.equal(distance("1A", "12A"), 1);
  assert.equal(distance("1A", "11A"), 2);
  assert.equal(distance("1A", "7A"), 6);
});

test("distance: Infinity bei ungültigen Eingaben", () => {
  assert.equal(distance("8A", "fail"), Infinity);
});

test("shift: rotiert zyklisch im Wheel", () => {
  assert.equal(shift("8A", 1), "9A");
  assert.equal(shift("12A", 1), "1A");
  assert.equal(shift("1A", -1), "12A");
  assert.equal(shift("1A", 13), "2A");
});

test("flipMode: A↔B am gleichen Slot", () => {
  assert.equal(flipMode("8A"), "8B");
  assert.equal(flipMode("8B"), "8A");
  assert.equal(flipMode("12A"), "12B");
});

test("flipMode: ungültige Eingabe → null", () => {
  assert.equal(flipMode("Xyz"), null);
});
