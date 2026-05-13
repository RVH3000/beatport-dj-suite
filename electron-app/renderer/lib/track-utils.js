// track-utils.js — Pure-Funktionen-Bibliothek für Track-Daten.
//
// Konsolidiert vorher dreifach duplizierte Helper aus:
//   - electron-app/renderer/tabs/search.js
//   - electron-app/renderer/components/playlist-builder.js
//   - electron-app/renderer/tabs/engine-analyze.js
//
// Voraussetzung an Phase 1 des Backlog-Punkt-33-Plans
// (siehe .agents/PLAN-punkt-33-wiz-filter.md): nur state-freie,
// DOM-freie Funktionen. Konsolidierungs-Entscheidungen je Helper sind
// im Commit-Body der Einführung dokumentiert.

// ─── Formatting + Escaping ──────────────────────────────────────────────────

export function fmt(n) {
  return n != null ? n.toLocaleString("de-DE") : "—";
}

export function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ─── Count-Badge-Klasse ─────────────────────────────────────────────────────
// Schema-Konvention: niedrige Counts = ruhig (blau), hohe Counts = laut (rot).
// Schwellenwerte aus search.js übernommen.

export function badgeCls(c) {
  if (c >= 20) return "srch-b-red";
  if (c >= 11) return "srch-b-orange";
  if (c >= 6) return "srch-b-cyan";
  return "srch-b-blue";
}

// ─── BPM-Normalisierung ─────────────────────────────────────────────────────
// Halbiert/verdoppelt BPM-Werte bis sie in den Bereich [80, 170] fallen.
// Pure: deterministisch, keine Side-Effects.

export function normBpm(bpm) {
  if (!bpm) return 0;
  let b = bpm;
  while (b < 80 && b > 0) b *= 2;
  while (b > 170) b /= 2;
  return Math.round(b * 10) / 10;
}

// ─── Camelot-Helpers ────────────────────────────────────────────────────────

// Beatport-Key-Format → Camelot. Format aus Beatport-API: "<Note> <Major|Minor>"
// z.B. "A min", "C maj". Diese Map wird von playlist-builder.js und
// analysis.js bereits genutzt (identisch); Konsolidierung Phase 1+ (Punkt 33).
export const BEATPORT_KEY_TO_CAMELOT = {
  "Ab min": "1A", "G# min": "1A", "B maj": "1B",
  "Eb min": "2A", "D# min": "2A", "F# maj": "2B", "Gb maj": "2B",
  "Bb min": "3A", "A# min": "3A", "Db maj": "3B", "C# maj": "3B",
  "F min": "4A", "Ab maj": "4B", "G# maj": "4B",
  "C min": "5A", "Eb maj": "5B", "D# maj": "5B",
  "G min": "6A", "Bb maj": "6B", "A# maj": "6B",
  "D min": "7A", "F maj": "7B",
  "A min": "8A", "C maj": "8B",
  "E min": "9A", "G maj": "9B",
  "B min": "10A", "D maj": "10B",
  "F# min": "11A", "Gb min": "11A", "A maj": "11B",
  "Db min": "12A", "C# min": "12A", "E maj": "12B",
};

// toCamelot: konvertiert einen Key-String in Camelot-Notation.
// - Wenn key bereits Camelot-Format hat (z.B. "8A", "11b"): wird normalisiert
//   (uppercase) zurueckgegeben.
// - Sonst: Lookup in customMap (Default: BEATPORT_KEY_TO_CAMELOT).
// - Bei unbekanntem Key oder leerem Input: gibt "" zurueck (nicht null oder
//   den rohen Key — verhindert ungemappte Strings im Camelot-Filter).
// Engine-analyze.js nutzt diese Funktion mit eigener Engine-Numeric-Map als
// customMap-Argument.
export function toCamelot(key, customMap = null) {
  if (!key && key !== 0) return "";
  const k = String(key).trim();
  if (/^\d{1,2}[AB]$/i.test(k)) return k.toUpperCase();
  const map = customMap || BEATPORT_KEY_TO_CAMELOT;
  return map[k] || "";
}

// camelotSortVal: search.js-Variante übernommen (0-basierte 0-23-Range passt
// zu dramaScore-Normierung durch 24). Plus defensive .toUpperCase() aus
// playlist-builder.js für Robustheit.

export function camelotSortVal(cam) {
  if (!cam) return 999;
  const n = parseInt(cam);
  const l = String(cam).slice(-1).toUpperCase();
  if (isNaN(n)) return 999;
  return (n - 1) * 2 + (l === "B" ? 1 : 0);
}

// camelotCompat: in search.js und playlist-builder.js identisch.
// Rückgabewerte: "perfect" | "good" | "ok" | "bad" | "none".

export function camelotCompat(c1, c2) {
  if (!c1 || !c2) return "none";
  const n1 = parseInt(c1);
  const l1 = String(c1).slice(-1).toUpperCase();
  const n2 = parseInt(c2);
  const l2 = String(c2).slice(-1).toUpperCase();
  if (isNaN(n1) || isNaN(n2)) return "none";
  if (n1 === n2 && l1 === l2) return "perfect";
  if (l1 === l2) {
    const d = Math.abs(n1 - n2);
    if (d === 1 || d === 11) return "good";
  }
  if (n1 === n2 && l1 !== l2) return "good";
  if (l1 === l2) {
    const d = Math.abs(n1 - n2);
    if (d === 2 || d === 10) return "ok";
  }
  return "bad";
}

// ─── Dramaturgie-Score ──────────────────────────────────────────────────────
// dramaScore: pure Variante mit optionalem useNorm-Parameter.
// search.js liest heute bpmNormActive() vom DOM — bei Aufruf muss der
// Caller das selbst auswerten und durchreichen. playlist-builder.js nutzt
// implizit normBpm (immer normalisiert). Hier: Default useNorm=true, aber
// explizit über options überschreibbar.

export function dramaScore(bpm, camelot, options = {}) {
  const useNorm = options.useNorm !== false;
  if (!bpm && !camelot) return 0;
  const effectiveBpm = useNorm ? (normBpm(bpm) || bpm) : bpm;
  const bpmN = effectiveBpm
    ? Math.max(0, Math.min(100, ((effectiveBpm - 80) / 80) * 100))
    : 50;
  const camVal = camelot ? camelotSortVal(camelot) : 12;
  const camN = (camVal / 24) * 100;
  return Math.round(bpmN * 0.6 + camN * 0.4);
}

// dramaColor: search.js-Farben übernommen (sind in der laufenden Explore-UI
// im Einsatz, die laut User „sehr sehr gut funktioniert" — keine Regression
// gewünscht). Aus playlist-builder.js übernommen: defensive Fallbacks für
// CSS-Variablen.

export function dramaColor(score) {
  if (score >= 75) return "var(--danger, #dc2626)";
  if (score >= 55) return "#ff6b35";
  if (score >= 35) return "#fbbf24";
  if (score >= 15) return "var(--primary, #0e6b5f)";
  return "#74c0fc";
}

// ─── Query-Matcher mit Wildcards ────────────────────────────────────────────
// Original aus search.js. Wandelt einen Such-String in eine
// Match-Funktion (s) => boolean. Unterstützt `*` und `?` als Wildcards.
// Pure: gibt eine Closure ohne State-Zugriff zurück.

export function buildQueryMatcher(raw) {
  const q = String(raw || "").toLowerCase().trim();
  if (!q) return null;
  if (!q.includes("*") && !q.includes("?")) {
    return (s) => String(s || "").toLowerCase().includes(q);
  }
  const pattern = q
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  try {
    const re = new RegExp(pattern);
    return (s) => re.test(String(s || "").toLowerCase());
  } catch {
    return (s) => String(s || "").toLowerCase().includes(q);
  }
}
