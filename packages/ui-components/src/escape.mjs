/**
 * Escape-Helper für UI-Strings. Verhindert XSS bei dynamischen Inhalten.
 */

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function escapeAttr(value) {
  return escapeHtml(value);
}
