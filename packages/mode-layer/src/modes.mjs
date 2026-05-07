/**
 * App-Mode-Layer: STANDARD vs DEVELOPER.
 * Bestimmt was im UI sichtbar ist (z. B. Debug-Tab nur in Developer-Mode).
 */

export const MODE_STANDARD = "standard";
export const MODE_DEVELOPER = "developer";

const VALID_MODES = new Set([MODE_STANDARD, MODE_DEVELOPER]);

export function isValidMode(value) {
  return VALID_MODES.has(value);
}

/**
 * Liest aus ENV-Variable BPDJS_MODE — fallback STANDARD.
 * Nützlich für die initiale Mode-Bestimmung beim App-Start.
 */
export function detectModeFromEnv(env = process.env) {
  const v = (env.BPDJS_MODE || "").trim().toLowerCase();
  return isValidMode(v) ? v : MODE_STANDARD;
}

export function isDeveloper(mode) {
  return mode === MODE_DEVELOPER;
}

export function isStandard(mode) {
  return mode === MODE_STANDARD;
}
