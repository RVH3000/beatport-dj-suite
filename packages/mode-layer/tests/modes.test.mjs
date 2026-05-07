import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODE_STANDARD,
  MODE_DEVELOPER,
  isValidMode,
  detectModeFromEnv,
  isDeveloper,
  isStandard
} from "../src/modes.mjs";

test("Konstanten haben erwartete String-Werte", () => {
  assert.equal(MODE_STANDARD, "standard");
  assert.equal(MODE_DEVELOPER, "developer");
});

test("isValidMode: korrekte Werte", () => {
  assert.equal(isValidMode("standard"), true);
  assert.equal(isValidMode("developer"), true);
  assert.equal(isValidMode("god-mode"), false);
  assert.equal(isValidMode(""), false);
});

test("detectModeFromEnv: Default ist STANDARD", () => {
  assert.equal(detectModeFromEnv({}), MODE_STANDARD);
});

test("detectModeFromEnv: BPDJS_MODE=developer", () => {
  assert.equal(detectModeFromEnv({ BPDJS_MODE: "developer" }), MODE_DEVELOPER);
});

test("detectModeFromEnv: case-insensitive + trim", () => {
  assert.equal(detectModeFromEnv({ BPDJS_MODE: "  DEVELOPER  " }), MODE_DEVELOPER);
});

test("detectModeFromEnv: unbekannter Wert fällt auf STANDARD zurück", () => {
  assert.equal(detectModeFromEnv({ BPDJS_MODE: "lol" }), MODE_STANDARD);
});

test("isDeveloper / isStandard sind exklusive Helper", () => {
  assert.equal(isDeveloper(MODE_DEVELOPER), true);
  assert.equal(isDeveloper(MODE_STANDARD), false);
  assert.equal(isStandard(MODE_STANDARD), true);
  assert.equal(isStandard(MODE_DEVELOPER), false);
});
