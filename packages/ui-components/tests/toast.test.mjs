import { test } from "node:test";
import assert from "node:assert/strict";
import { TOAST_TYPES, buildToast, renderToastHtml } from "../src/toast.mjs";

test("TOAST_TYPES enthält die 4 Standard-Typen", () => {
  for (const t of ["info", "success", "warn", "error"]) {
    assert.ok(TOAST_TYPES.includes(t));
  }
});

test("buildToast: wirft ohne message", () => {
  assert.throws(() => buildToast({}), /message erforderlich/);
});

test("buildToast: wirft bei unbekanntem type", () => {
  assert.throws(() => buildToast({ message: "x", type: "fancy" }), /unbekannter type/);
});

test("buildToast: error-Toasts sind sticky (duration null)", () => {
  const t = buildToast({ message: "Boom", type: "error" });
  assert.equal(t.duration, null);
  assert.equal(t.sticky, true);
});

test("buildToast: nicht-error Toasts haben Default 3000ms", () => {
  const t = buildToast({ message: "Hi", type: "info" });
  assert.equal(t.duration, 3000);
  assert.equal(t.sticky, false);
});

test("buildToast: explizite duration=0 macht ihn sticky", () => {
  const t = buildToast({ message: "x", type: "info", duration: null });
  assert.equal(t.sticky, true);
});

test("renderToastHtml: enthält klassen + escape", () => {
  const t = buildToast({ message: "Hi <b>there</b>", type: "success" });
  const html = renderToastHtml(t);
  assert.match(html, /class="bpdjs-toast bpdjs-toast--success"/);
  assert.match(html, /Hi &lt;b&gt;there&lt;\/b&gt;/);
  assert.match(html, /role="status"/);
});

test("renderToastHtml: sticky setzt data-sticky", () => {
  const t = buildToast({ message: "Boom", type: "error" });
  const html = renderToastHtml(t);
  assert.match(html, /data-sticky="true"/);
  assert.equal(html.includes("data-duration"), false);
});

test("renderToastHtml: nicht-sticky setzt data-duration", () => {
  const t = buildToast({ message: "x", type: "info" });
  const html = renderToastHtml(t);
  assert.match(html, /data-duration="3000"/);
});
