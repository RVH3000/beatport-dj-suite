/**
 * Performance-Score für Tracks. Kombiniert mehrere Signale zu einem
 * sortierbaren Score (0..100). Reine Rechenlogik, keine externe IO.
 *
 * Signale:
 *  - bpmFitness: wie gut passt der BPM-Bereich (target ±tolerance)
 *  - keyFitness: hat der Track eine Camelot/Tonart-Angabe?
 *  - energyHint: optional — externer Energie-Score (0..1)
 *  - genreMatch: optional — boolean
 */

const DEFAULT_WEIGHTS = {
  bpm: 0.4,
  key: 0.2,
  energy: 0.25,
  genre: 0.15
};

export function computeBpmFitness(trackBpm, { target, tolerance = 4 } = {}) {
  if (typeof trackBpm !== "number" || !target) return 0;
  const diff = Math.abs(trackBpm - target);
  if (diff > tolerance) return 0;
  return Math.max(0, 1 - diff / tolerance);
}

export function computeKeyFitness(track) {
  if (!track) return 0;
  if (track.camelot) return 1;
  if (track.key) return 0.7;
  return 0;
}

export function computePerformanceScore(track, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const bpm = computeBpmFitness(track.bpm, opts);
  const key = computeKeyFitness(track);
  const energy = typeof opts.energy === "number" ? Math.max(0, Math.min(1, opts.energy)) : 0;
  const genre = opts.genreMatch ? 1 : 0;
  const total =
    bpm * weights.bpm +
    key * weights.key +
    energy * weights.energy +
    genre * weights.genre;
  return Math.round(total * 100);
}

export function rankByScore(tracks, opts = {}) {
  return tracks
    .map((t) => ({ track: t, score: computePerformanceScore(t, opts) }))
    .sort((a, b) => b.score - a.score);
}
