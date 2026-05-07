import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTableHtml } from "../src/table.mjs";

test("renderTableHtml: wirft ohne Spalten", () => {
  assert.throws(() => renderTableHtml([], []), /columns erforderlich/);
});

test("renderTableHtml: leere Daten zeigen empty-message", () => {
  const html = renderTableHtml(
    [{ key: "a", label: "A" }],
    [],
    { emptyMessage: "Nichts da" }
  );
  assert.match(html, /class="bpdjs-table__empty"/);
  assert.match(html, /Nichts da/);
});

test("renderTableHtml: rendert Zellen aus row-Properties", () => {
  const html = renderTableHtml(
    [{ key: "name", label: "Name" }, { key: "bpm", label: "BPM" }],
    [{ name: "Track A", bpm: 120 }, { name: "Track B", bpm: 128 }]
  );
  assert.match(html, /Track A/);
  assert.match(html, /Track B/);
  assert.match(html, /120/);
  assert.match(html, /128/);
});

test("renderTableHtml: format-Funktion wird angewendet", () => {
  const html = renderTableHtml(
    [{ key: "bpm", label: "BPM", format: (v) => `${v} bpm` }],
    [{ bpm: 120 }]
  );
  assert.match(html, /120 bpm/);
});

test("renderTableHtml: escaped HTML in Werten", () => {
  const html = renderTableHtml(
    [{ key: "name", label: "Name" }],
    [{ name: "<script>" }]
  );
  assert.match(html, /&lt;script&gt;/);
  assert.equal(html.includes("<script>"), false);
});

test("renderTableHtml: aria-sort bei aktiver Sortierung", () => {
  const html = renderTableHtml(
    [{ key: "a", label: "A" }],
    [{ a: 1 }],
    { sortBy: "a", sortDir: "desc" }
  );
  assert.match(html, /aria-sort="descending"/);
});

test("renderTableHtml: onClickAttr fügt Click-Marker hinzu", () => {
  const html = renderTableHtml(
    [{ key: "name", label: "Name" }],
    [{ name: "x" }],
    { onClickAttr: "data-action" }
  );
  assert.match(html, /data-action="sort:name"/);
});

test("renderTableHtml: column className wird übernommen", () => {
  const html = renderTableHtml(
    [{ key: "name", label: "Name", className: "col-narrow" }],
    [{ name: "x" }]
  );
  assert.match(html, /class="col-narrow"/);
});
