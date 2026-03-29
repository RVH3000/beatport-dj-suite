/**
 * Gemeinsame Hilfsfunktionen für den Hauptprozess und Tools.
 * Nicht im Renderer-Kontext importierbar (kein ES-Module-Support ohne Bundler).
 */

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Escaped einen Wert für CSV-Ausgabe (RFC 4180).
 * Umschließt mit Anführungszeichen wenn Komma, Newline oder Quote enthalten.
 * @param {*} value
 * @returns {string}
 */
export function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
