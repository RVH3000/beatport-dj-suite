import { isCompatible, distance, parseCamelot } from "./camelot.mjs";

/**
 * Validiert die harmonische Mix-Reihenfolge einer Playlist.
 * Liefert { ok, warnings: [{trackIndex, reason, fromCamelot, toCamelot}] }.
 *
 * Regel:
 *  - Aufeinanderfolgende Tracks müssen Camelot-kompatibel sein
 *    (gleicher Wert / ±1 / Innen↔Außen am gleichen Slot)
 *  - Tracks ohne Camelot werden übersprungen (kein Warning, weil unbekannt)
 *  - BPM-Sprünge >8% werden als zusätzliche Warning gemeldet
 */
export function validateMixOrder(playlist, { maxBpmDeltaPercent = 8 } = {}) {
  const tracks = playlist.tracks || [];
  const warnings = [];
  for (let i = 1; i < tracks.length; i++) {
    const prev = tracks[i - 1];
    const cur = tracks[i];
    if (prev.camelot && cur.camelot && !isCompatible(prev.camelot, cur.camelot)) {
      warnings.push({
        trackIndex: i,
        reason: "key-incompatible",
        fromCamelot: prev.camelot,
        toCamelot: cur.camelot,
        wheelDistance: distance(prev.camelot, cur.camelot)
      });
    }
    if (typeof prev.bpm === "number" && typeof cur.bpm === "number" && prev.bpm > 0) {
      const deltaPct = Math.abs((cur.bpm - prev.bpm) / prev.bpm) * 100;
      if (deltaPct > maxBpmDeltaPercent) {
        warnings.push({
          trackIndex: i,
          reason: "bpm-jump",
          fromBpm: prev.bpm,
          toBpm: cur.bpm,
          deltaPercent: Number(deltaPct.toFixed(2))
        });
      }
    }
  }
  return { ok: warnings.length === 0, warnings };
}

/**
 * Schlägt Kandidaten-Tracks vor, die harmonisch zu einem aktuellen Track passen.
 * Liefert eine sortierte Liste — beste Matches zuerst.
 */
export function suggestNextTracks(currentTrack, candidates, { limit = 10 } = {}) {
  if (!currentTrack || !currentTrack.camelot) return [];
  const cur = parseCamelot(currentTrack.camelot);
  if (!cur) return [];

  const scored = [];
  for (const cand of candidates) {
    if (!cand.camelot) continue;
    if (cand.id === currentTrack.id) continue;
    const dist = distance(currentTrack.camelot, cand.camelot);
    if (dist > 2) continue; // zu weit weg
    let bpmPenalty = 0;
    if (typeof currentTrack.bpm === "number" && typeof cand.bpm === "number" && currentTrack.bpm > 0) {
      const deltaPct = Math.abs((cand.bpm - currentTrack.bpm) / currentTrack.bpm) * 100;
      bpmPenalty = deltaPct / 4; // 8% BPM ≈ 2 Penalty-Punkte
    }
    scored.push({ track: cand, score: dist + bpmPenalty, wheelDistance: dist });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit);
}
