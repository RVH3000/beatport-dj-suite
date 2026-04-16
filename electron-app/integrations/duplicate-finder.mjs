/**
 * duplicate-finder.mjs — Cross-Playlist Fuzzy-Duplikat-Erkennung
 *
 * Zwei Modi:
 * 1. Cross-Playlist: Tracks die in 2+ Playlists vorkommen (exakter ID-Match, schnell)
 * 2. Fuzzy: Tracks mit aehnlichem Title+Artist aber unterschiedlicher ID (Levenshtein)
 *
 * Datenformat: scoring-data.json Tracks ({i, t, m, a, b, k, c, p, ...})
 */

// ─── Normalisierung ──────────────────────────────────────────────────────────

const STRIP_PATTERNS = [
  /\s*\(original mix\)\s*/gi,
  /\s*\(extended mix\)\s*/gi,
  /\s*\(radio edit\)\s*/gi,
  /\s*feat\.?\s*/gi,
  /\s*ft\.?\s*/gi,
  /\s*featuring\s*/gi,
  /\s*&\s*/g,
  /\s*,\s*/g,
  /[''`´]/g,
  /[^\w\s]/g,
];

export function normalize(str) {
  if (!str) return "";
  let s = str.toLowerCase().trim();
  for (const pat of STRIP_PATTERNS) {
    s = s.replace(pat, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

// ─── Levenshtein ──────────────────────────────────────────────────────────────

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Optimierung: nur 2 Zeilen statt volle Matrix
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

// ─── Fingerprint (fuer schnellen Exact-Match nach Normalisierung) ─────────

function fingerprint(track) {
  return normalize(track.t) + "|" + normalize(track.a);
}

// ─── Cross-Playlist-Duplikate (exakter Track-ID, mehrere Playlists) ────────

export function findCrossPlaylistDupes(tracks) {
  return tracks
    .filter((t) => t.p && t.p.length > 1)
    .map((t) => ({
      trackId: t.i,
      title: t.t,
      mix: t.m || "",
      artist: t.a,
      genre: t.g,
      bpm: t.b,
      key: t.k,
      camelot: t.c || "",
      year: t.y,
      label: t.l,
      playlistCount: t.p.length,
      playlistIds: t.p,
    }))
    .sort((a, b) => b.playlistCount - a.playlistCount);
}

// ─── Fuzzy-Duplikate (unterschiedliche Track-IDs, aehnlicher Name) ─────────

export function findFuzzyDuplicates(tracks, options = {}) {
  const threshold = options.threshold ?? 0.85;
  const bpmTolerance = options.bpmTolerance ?? 5;

  // Phase 1: Fingerprint-Gruppen (O(n), schnell)
  // Tracks mit identischem normalisierten Title+Artist → sicher Duplikate
  const fpMap = new Map();
  for (const t of tracks) {
    const fp = fingerprint(t);
    if (!fpMap.has(fp)) fpMap.set(fp, []);
    fpMap.get(fp).push(t);
  }

  const groups = [];
  const matchedIds = new Set();

  // Fingerprint-Gruppen mit 2+ Tracks = exakte Duplikate nach Normalisierung
  for (const [fp, members] of fpMap) {
    if (members.length < 2) continue;
    // Nur wenn unterschiedliche Track-IDs (nicht derselbe Track in mehreren Playlists)
    const uniqueIds = new Set(members.map((t) => t.i));
    if (uniqueIds.size < 2) continue;

    groups.push({
      matchType: "fingerprint",
      similarity: 1.0,
      tracks: members.map(trackToResult),
    });
    for (const t of members) matchedIds.add(t.i);
  }

  // Phase 2: Fuzzy-Matching innerhalb BPM-Buckets (fuer noch nicht gematchte)
  // Bucket-Key = Math.round(bpm / bpmTolerance)
  const remaining = tracks.filter((t) => !matchedIds.has(t.i));
  const bpmBuckets = new Map();
  for (const t of remaining) {
    const bucket = Math.round((t.b || 0) / bpmTolerance);
    if (!bpmBuckets.has(bucket)) bpmBuckets.set(bucket, []);
    bpmBuckets.get(bucket).push(t);
  }

  // Vergleiche innerhalb und zwischen benachbarten Buckets
  for (const [bucket, members] of bpmBuckets) {
    // Auch Nachbar-Buckets einbeziehen (±1)
    const candidates = [...members];
    for (const nb of [bucket - 1, bucket + 1]) {
      if (bpmBuckets.has(nb)) candidates.push(...bpmBuckets.get(nb));
    }

    for (let i = 0; i < members.length; i++) {
      const a = members[i];
      if (matchedIds.has(a.i)) continue;
      const aFp = fingerprint(a);

      for (let j = 0; j < candidates.length; j++) {
        const b = candidates[j];
        if (a.i >= b.i) continue; // Keine Selbstvergleiche, keine doppelten Paare
        if (matchedIds.has(b.i)) continue;

        const bFp = fingerprint(b);
        if (aFp === bFp) continue; // Schon in Phase 1 erfasst

        const sim = similarity(a.t + " " + a.a, b.t + " " + b.a);
        if (sim >= threshold) {
          groups.push({
            matchType: "fuzzy",
            similarity: Math.round(sim * 100) / 100,
            tracks: [trackToResult(a), trackToResult(b)],
          });
          matchedIds.add(a.i);
          matchedIds.add(b.i);
          break; // Naechster Track
        }
      }
    }
  }

  return groups.sort((a, b) => b.similarity - a.similarity);
}

function trackToResult(t) {
  return {
    trackId: t.i,
    title: t.t,
    mix: t.m || "",
    artist: t.a,
    genre: t.g,
    bpm: t.b,
    key: t.k,
    camelot: t.c || "",
    year: t.y,
    label: t.l,
    playlistCount: t.p ? t.p.length : 0,
  };
}
