import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandboxBanner, renderSandboxBannerHtml } from "../src/sandbox-banner.mjs";

test("buildSandboxBanner: inaktiv → minimal Daten", () => {
  const b = buildSandboxBanner({ active: false });
  assert.equal(b.active, false);
  assert.equal(b.label, null);
  assert.match(b.cssClass, /hidden/);
});

test("buildSandboxBanner: aktiv mit Default-Label", () => {
  const b = buildSandboxBanner({ active: true });
  assert.equal(b.active, true);
  assert.equal(b.label, "SANDBOX-MODUS");
});

test("buildSandboxBanner: custom label überschreibt Default", () => {
  const b = buildSandboxBanner({ active: true, label: "Test-DB aktiv" });
  assert.equal(b.label, "Test-DB aktiv");
});

test("renderSandboxBannerHtml: inaktiv ist aria-hidden", () => {
  const b = buildSandboxBanner({ active: false });
  const html = renderSandboxBannerHtml(b);
  assert.match(html, /aria-hidden="true"/);
  assert.equal(html.includes("SANDBOX"), false);
});

test("renderSandboxBannerHtml: aktiv hat role=alert + Label", () => {
  const b = buildSandboxBanner({ active: true });
  const html = renderSandboxBannerHtml(b);
  assert.match(html, /role="alert"/);
  assert.match(html, /SANDBOX-MODUS/);
  assert.match(html, /aria-label=/);
});

test("renderSandboxBannerHtml: escaped Label", () => {
  const b = buildSandboxBanner({ active: true, label: "<evil>" });
  const html = renderSandboxBannerHtml(b);
  assert.match(html, /&lt;evil&gt;/);
});
