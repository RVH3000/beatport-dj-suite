import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, escapeAttr } from "../src/escape.mjs";

test("escapeHtml entkommt alle gefährlichen Zeichen", () => {
  assert.equal(escapeHtml("<script>alert('x')</script>"),
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
});

test("escapeHtml mit &", () => {
  assert.equal(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
});

test("escapeHtml mit Anführungszeichen", () => {
  assert.equal(escapeHtml('a "b" c'), "a &quot;b&quot; c");
});

test("escapeHtml mit null/undefined → leerer String", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("escapeHtml mit Number", () => {
  assert.equal(escapeHtml(42), "42");
});

test("escapeAttr verhält sich wie escapeHtml", () => {
  assert.equal(escapeAttr('a"b'), escapeHtml('a"b'));
});
