import { AppError } from "@bpdjs/core";

/**
 * Track-Analyse-Datenmodell. Audio-Detection (BPM-Estimation, Key-Detection,
 * Spectral-Analyse) wird absichtlich NICHT in v4.2 implementiert — das wäre
 * eine eigene Phase mit externer Library oder Python-Bridge.
 *
 * Dieser Layer bietet:
 *  - Stabiles Datenmodell für Analyse-Ergebnisse
 *  - Merge-Logik (mehrere Quellen kombinieren, z. B. Beatport + Engine)
 *  - Validierung
 */

export const ANALYSIS_SOURCES = ["beatport", "engine", "manual", "external"];

export function buildAnalysis({ trackId, source = "manual", bpm = null, camelot = null, key = null, energy = null, confidence = 1, timestamp = null } = {}) {
  if (!trackId) throw new AppError("buildAnalysis: trackId erforderlich", { code: "E_NO_TRACK_ID" });
  if (!ANALYSIS_SOURCES.includes(source)) {
    throw new AppError(`buildAnalysis: unbekannte source ${source}`, { code: "E_BAD_SOURCE" });
  }
  return {
    trackId: String(trackId),
    source,
    bpm: typeof bpm === "number" ? bpm : null,
    camelot: camelot ? String(camelot).toUpperCase() : null,
    key: key ? String(key) : null,
    energy: typeof energy === "number" ? Math.max(0, Math.min(1, energy)) : null,
    confidence: Math.max(0, Math.min(1, confidence)),
    timestamp: timestamp || Date.now()
  };
}

/**
 * Mergt mehrere Analyse-Ergebnisse. Strategie:
 *  - Felder werden nach confidence gewichtet kombiniert
 *  - Bei numerischen Feldern (bpm, energy): gewichteter Durchschnitt
 *  - Bei String-Feldern (camelot, key): höchste confidence gewinnt
 */
export function mergeAnalyses(analyses) {
  if (!Array.isArray(analyses) || analyses.length === 0) return null;
  if (analyses.length === 1) return { ...analyses[0] };

  const trackIds = new Set(analyses.map((a) => a.trackId));
  if (trackIds.size > 1) {
    throw new AppError("mergeAnalyses: alle Analysen müssen denselben trackId haben", { code: "E_TRACKID_MISMATCH" });
  }

  const sortedByConf = [...analyses].sort((a, b) => b.confidence - a.confidence);
  const totalConf = analyses.reduce((sum, a) => sum + a.confidence, 0) || 1;

  const weightedNum = (key) => {
    let total = 0, weight = 0;
    for (const a of analyses) {
      if (typeof a[key] === "number" && a.confidence > 0) {
        total += a[key] * a.confidence;
        weight += a.confidence;
      }
    }
    return weight > 0 ? total / weight : null;
  };

  const bestString = (key) => {
    for (const a of sortedByConf) {
      if (a[key]) return a[key];
    }
    return null;
  };

  return {
    trackId: analyses[0].trackId,
    source: "merged",
    bpm: weightedNum("bpm") ? Math.round(weightedNum("bpm") * 100) / 100 : null,
    camelot: bestString("camelot"),
    key: bestString("key"),
    energy: weightedNum("energy"),
    confidence: totalConf / analyses.length,
    timestamp: Date.now(),
    sources: analyses.map((a) => a.source)
  };
}
