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
