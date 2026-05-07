/**
 * Camelot-Wheel-Logik für harmonische Mix-Reihenfolge.
 * Reine Domain-Logik, keine IO, kein Beatport-Bezug.
 */

const CAMELOT_RE = /^(\d{1,2})([AB])$/;

const KEY_TO_CAMELOT = {
  // Minor (A = innen)
  "Abm": "1A", "G#m": "1A",
  "Ebm": "2A", "D#m": "2A",
  "Bbm": "3A", "A#m": "3A",
  "Fm":  "4A",
  "Cm":  "5A",
  "Gm":  "6A",
  "Dm":  "7A",
  "Am":  "8A",
  "Em":  "9A",
  "Bm":  "10A",
  "F#m": "11A", "Gbm": "11A",
  "Dbm": "12A", "C#m": "12A",
  // Major (B = außen)
  "B":   "1B",
  "F#":  "2B", "Gb": "2B",
  "Db":  "3B", "C#": "3B",
  "Ab":  "4B", "G#": "4B",
  "Eb":  "5B", "D#": "5B",
  "Bb":  "6B", "A#": "6B",
  "F":   "7B",
  "C":   "8B",
  "G":   "9B",
  "D":   "10B",
  "A":   "11B",
  "E":   "12B"
};

export function parseCamelot(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().toUpperCase().match(CAMELOT_RE);
  if (!m) return null;
  const num = Number(m[1]);
  const letter = m[2];
  if (num < 1 || num > 12) return null;
  return { num, letter, raw: `${num}${letter}` };
}

/**
 * Konvertiert klassische Tonart-Notation ("Am", "C#m", "F", "Bb") nach Camelot.
 * Liefert den Camelot-String oder null bei unbekannter Eingabe.
 * Wenn die Eingabe bereits Camelot ist, wird sie normalisiert zurückgegeben.
 */
export function normalizeKey(rawKey) {
  if (!rawKey) return null;
  const trimmed = String(rawKey).trim();
  // Already Camelot?
  const cam = parseCamelot(trimmed);
  if (cam) return cam.raw;
  // Versuche klassische Notation: "C min" → "Cm", "C maj" → "C"
  const cleaned = trimmed.replace(/\s*min\s*$/i, "m").replace(/\s*maj\s*$/i, "");
  return KEY_TO_CAMELOT[cleaned] || null;
}

/**
 * Prüft ob zwei Camelot-Werte für harmonisches Mixing kompatibel sind.
 * Kompatibel sind:
 *  - gleicher Wert (1A↔1A)
 *  - ±1 auf dem Wheel (1A↔2A, 1A↔12A)
 *  - innen/außen am gleichen Slot (1A↔1B)
 */
export function isCompatible(a, b) {
  const A = parseCamelot(a);
  const B = parseCamelot(b);
  if (!A || !B) return false;
  if (A.num === B.num && A.letter === B.letter) return true;
  if (A.num === B.num && A.letter !== B.letter) return true;
  if (A.letter === B.letter) {
    const diff = Math.abs(A.num - B.num);
    if (diff === 1 || diff === 11) return true;
  }
  return false;
}

/**
 * Distanz auf dem Camelot-Wheel — kleiner = harmonisch ähnlicher.
 *  0 = identisch
 *  1 = direkter Nachbar (kompatibel)
 *  2+ = weiter weg
 *  Innen/Außen-Wechsel (A↔B am gleichen Slot) zählt als 1.
 */
export function distance(a, b) {
  const A = parseCamelot(a);
  const B = parseCamelot(b);
  if (!A || !B) return Infinity;
  // Wheel-Distanz für Nummern (1..12 zyklisch)
  const numDiff = Math.min(
    Math.abs(A.num - B.num),
    12 - Math.abs(A.num - B.num)
  );
  const letterDiff = A.letter === B.letter ? 0 : 1;
  return numDiff + letterDiff;
}

/**
 * Verschiebt eine Camelot-Position um `steps` Schritte auf dem Wheel.
 * Positiver Wert geht im Uhrzeigersinn (1A → 2A → 3A → ...).
 */
export function shift(camelotValue, steps) {
  const c = parseCamelot(camelotValue);
  if (!c) return null;
  let n = ((c.num - 1 + steps) % 12 + 12) % 12;
  return `${n + 1}${c.letter}`;
}

/**
 * Wechselt zwischen innen (A, minor) und außen (B, major) am gleichen Slot.
 */
export function flipMode(camelotValue) {
  const c = parseCamelot(camelotValue);
  if (!c) return null;
  return `${c.num}${c.letter === "A" ? "B" : "A"}`;
}
