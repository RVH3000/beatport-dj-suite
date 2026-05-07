import { test } from "node:test";
import assert from "node:assert/strict";
import { toErrorMessage, AppError } from "../src/errors.mjs";

test("toErrorMessage: liefert Fallback bei null/undefined", () => {
  assert.equal(toErrorMessage(null), "Unbekannter Fehler");
  assert.equal(toErrorMessage(undefined), "Unbekannter Fehler");
});

test("toErrorMessage: liest .message bei Error-Instanz", () => {
  const e = new Error("Boom");
  assert.equal(toErrorMessage(e), "Boom");
});

test("toErrorMessage: stringifiziert primitive Werte", () => {
  assert.equal(toErrorMessage("plain string"), "plain string");
  assert.equal(toErrorMessage(42), "42");
});

test("AppError: setzt name und cause + code", () => {
  const cause = new Error("root");
  const err = new AppError("Failed", { cause, code: "E_FAIL" });
  assert.equal(err.name, "AppError");
  assert.equal(err.message, "Failed");
  assert.equal(err.cause, cause);
  assert.equal(err.code, "E_FAIL");
});

test("AppError: ohne Optionen lässt cause/code undefined", () => {
  const err = new AppError("Plain");
  assert.equal(err.cause, undefined);
  assert.equal(err.code, undefined);
});
