function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBpm(rawBpm) {
  const numeric = Number(rawBpm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  let bpm = numeric;
  while (bpm > 170) bpm /= 2;
  while (bpm > 0 && bpm < 80) bpm *= 2;
  return Math.round(bpm * 10) / 10;
}

function normalizeEnergy(rawEnergy) {
  const numeric = Number(rawEnergy);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric <= 1) return clamp(numeric, 0, 1);
  if (numeric <= 10) return clamp(numeric / 10, 0, 1);
  return clamp(numeric / 100, 0, 1);
}

const DANCEABILITY_HINTS = [
  ["house", 0.82],
  ["tech house", 0.86],
  ["minimal", 0.78],
  ["deep", 0.74],
  ["disco", 0.88],
  ["techno", 0.7],
  ["trance", 0.62],
  ["breaks", 0.58],
  ["ambient", 0.34],
  ["downtempo", 0.46],
];

const ENERGY_HINTS = [
  ["hard", 0.9],
  ["peak", 0.92],
  ["acid", 0.84],
  ["techno", 0.82],
  ["house", 0.74],
  ["minimal", 0.62],
  ["deep", 0.54],
  ["melodic", 0.58],
  ["ambient", 0.22],
  ["downtempo", 0.36],
];

function scoreFromHints(text, hints, fallback) {
  const haystack = String(text || "").toLowerCase();
  for (const [needle, score] of hints) {
    if (haystack.includes(needle)) {
      return score;
    }
  }
  return fallback;
}

function deriveDanceability(track, bpm) {
  const genreText = [track.genre, track.subGenre, track.label].filter(Boolean).join(" ");
  const base = scoreFromHints(genreText, DANCEABILITY_HINTS, 0.58);
  const bpmInfluence = bpm ? clamp((bpm - 90) / 60, 0, 1) * 0.18 : 0;
  return clamp(base + bpmInfluence, 0, 1);
}

function deriveEnergy(track, bpm) {
  const genreText = [track.genre, track.subGenre, track.label, track.title].filter(Boolean).join(" ");
  const base = scoreFromHints(genreText, ENERGY_HINTS, 0.56);
  const bpmInfluence = bpm ? clamp((bpm - 80) / 90, 0, 1) * 0.24 : 0;
  return clamp(base + bpmInfluence, 0, 1);
}

function classifyStage(intensity) {
  if (intensity >= 0.8) return "peak-time";
  if (intensity >= 0.62) return "drive";
  if (intensity >= 0.45) return "groove";
  if (intensity >= 0.28) return "warmup";
  return "cooldown";
}

export function classifyTrackPerformance(track = {}) {
  const bpm = normalizeBpm(track.bpm);
  const bpmScore = bpm ? clamp((bpm - 80) / 80, 0, 1) : 0;
  const energy = normalizeEnergy(track.energy) ?? deriveEnergy(track, bpm);
  const danceability = normalizeEnergy(track.danceability) ?? deriveDanceability(track, bpm);
  const intensity = clamp(
    energy * 0.5 + danceability * 0.35 + bpmScore * 0.15,
    0,
    1
  );
  const confidence = clamp(
    (bpm ? 0.3 : 0) + (track.energy != null ? 0.4 : 0.15) + (track.genre ? 0.3 : 0.15),
    0.2,
    1
  );

  return {
    title: track.title ?? "",
    artist: track.artist ?? track.artists ?? "",
    genre: track.genre ?? "",
    bpm,
    energy: Number(energy.toFixed(3)),
    danceability: Number(danceability.toFixed(3)),
    intensity: Number(intensity.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    stage: classifyStage(intensity),
  };
}

export function classifyTrackBatch(tracks = []) {
  const classified = tracks.map((track) => ({
    ...track,
    performance: classifyTrackPerformance(track),
  }));

  const summary = classified.reduce(
    (accumulator, track) => {
      const { performance } = track;
      accumulator.count += 1;
      accumulator.avgEnergy += performance.energy;
      accumulator.avgDanceability += performance.danceability;
      accumulator.avgIntensity += performance.intensity;
      accumulator.stageCounts[performance.stage] =
        (accumulator.stageCounts[performance.stage] || 0) + 1;
      return accumulator;
    },
    {
      count: 0,
      avgEnergy: 0,
      avgDanceability: 0,
      avgIntensity: 0,
      stageCounts: {},
    }
  );

  if (summary.count > 0) {
    summary.avgEnergy = Number((summary.avgEnergy / summary.count).toFixed(3));
    summary.avgDanceability = Number(
      (summary.avgDanceability / summary.count).toFixed(3)
    );
    summary.avgIntensity = Number((summary.avgIntensity / summary.count).toFixed(3));
  }

  const topTracks = [...classified]
    .sort((left, right) => right.performance.intensity - left.performance.intensity)
    .slice(0, 12)
    .map((track) => ({
      title: track.title ?? "",
      artist: track.artist ?? track.artists ?? "",
      bpm: track.performance.bpm,
      stage: track.performance.stage,
      energy: track.performance.energy,
      danceability: track.performance.danceability,
      intensity: track.performance.intensity,
    }));

  return { summary, tracks: classified, topTracks };
}
