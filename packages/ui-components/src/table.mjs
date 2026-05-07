import { escapeHtml, escapeAttr } from "./escape.mjs";

/**
 * Tabellen-Builder. Liefert HTML-String — testbar ohne DOM.
 *
 * columns: Array<{ key, label, format?(value, row) → string, className? }>
 * rows:    Array<object>
 * options: { className, emptyMessage, sortBy, sortDir, onClickAttr }
 */
export function renderTableHtml(columns, rows, opts = {}) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("renderTableHtml: columns erforderlich");
  }
  const className = opts.className ? ` ${opts.className}` : "";
  const headerCells = columns.map((c) => {
    const sortAttr = opts.sortBy === c.key ? ` aria-sort="${opts.sortDir === "desc" ? "descending" : "ascending"}"` : "";
    const clickAttr = opts.onClickAttr ? ` ${opts.onClickAttr}="sort:${escapeAttr(c.key)}"` : "";
    const cls = c.className ? ` class="${escapeAttr(c.className)}"` : "";
    return `<th data-key="${escapeAttr(c.key)}"${cls}${sortAttr}${clickAttr}>${escapeHtml(c.label || c.key)}</th>`;
  }).join("");

  if (!rows || rows.length === 0) {
    const empty = escapeHtml(opts.emptyMessage || "Keine Daten");
    return `<table class="bpdjs-table${className}"><thead><tr>${headerCells}</tr></thead><tbody><tr class="bpdjs-table__empty"><td colspan="${columns.length}">${empty}</td></tr></tbody></table>`;
  }

  const bodyRows = rows.map((row) => {
    const cells = columns.map((c) => {
      const raw = row[c.key];
      const formatted = typeof c.format === "function" ? c.format(raw, row) : raw;
      const cls = c.className ? ` class="${escapeAttr(c.className)}"` : "";
      return `<td${cls}>${escapeHtml(formatted ?? "")}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return `<table class="bpdjs-table${className}"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}
