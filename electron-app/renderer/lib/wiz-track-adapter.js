// wiz-track-adapter.js — wandelt WIZ-Tracks (Beatport-API-Format) ins
// Filter-Schema das auch der Explore-Tab benutzt.
//
// Eingabe-Schema (aus electron-app/scanner/xhr-scanner.mjs normalizeTrack):
//   { trackId, title, mixName, artists, remixers, genre, subGenre, label,
//     releaseDate, bpm, key, duration, isrc, catalogNumber, source }
//
// Ausgabe-Schema (analog zu search.js getSearchSource):
//   { track_id, title, mix_name, artists, genre, sub_genre, bpm, bpmNorm,
//     key, camelot, year, label, drama, count, rating, is_hype, is_dj_edit,
//     plays_total }
//
// Felder die im WIZ-Schema NICHT verfuegbar sind (count, rating, is_hype,
// is_dj_edit, plays_total) werden mit 0/null/false gefuellt — die UI muss
// Filter darauf im WIZ-Kontext ausblenden bzw. dokumentieren dass sie nicht
// auf Live-Playlists anwendbar sind.

import { normBpm, dramaScore, toCamelot } from "./track-utils.js";

// Parst Jahr aus releaseDate-String. Robust gegen null/malformed Strings.
function parseYear(releaseDate) {
  if (!releaseDate || typeof releaseDate !== "string") return null;
  const y = parseInt(releaseDate.slice(0, 4), 10);
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
}

export function wizTrackToFilterable(t) {
  if (!t || typeof t !== "object") return null;
  const bpm = Number(t.bpm) || 0;
  const camelot = toCamelot(t.key);
  return {
    track_id: String(t.trackId || ""),
    title: String(t.title || ""),
    mix_name: String(t.mixName || ""),
    artists: String(t.artists || ""),
    remixers: String(t.remixers || ""),
    genre: String(t.genre || ""),
    sub_genre: String(t.subGenre || ""),
    bpm,
    bpmNorm: bpm ? normBpm(bpm) : 0,
    key: String(t.key || ""),
    camelot,
    year: parseYear(t.releaseDate),
    label: String(t.label || ""),
    // WIZ-Tracks haben keinen DOM-Toggle fuer BPM-Norm; useNorm: true
    // matched playlist-builder.js und gibt sinnvolle Drama-Scores auch
    // fuer extreme BPM-Werte (Halftime/Doubletime).
    drama: dramaScore(bpm, camelot, { useNorm: true }),
    // Felder die im WIZ-Schema nicht existieren — konstante Defaults damit
    // bestehende Filter-Logik nicht crasht. UI muss diese Spalten/Filter
    // im WIZ-Kontext ausblenden.
    count: 0,
    rating: null,
    is_hype: false,
    is_dj_edit: false,
    plays_total: 0,
  };
}

export function wizTracksToFilterable(rawTracks) {
  if (!Array.isArray(rawTracks)) return [];
  return rawTracks
    .map(wizTrackToFilterable)
    .filter((t) => t !== null);
}
