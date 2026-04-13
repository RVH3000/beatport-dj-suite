/**
 * Engine-Analyse Matching-Modul
 * Matcht Engine-DJ-Tracks gegen scoring-data.json (Beatport-Daten)
 *
 * Stufe 1: beatport_id (exakt) — für Streaming-Tracks mit URI
 * Stufe 2: normalize(title)|normalize(artist) — für lokale Tracks
 * Stufe 3: Fuzzy Token-Match (Dice-Koeffizient ≥ 0.85)
 */

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

/**
 * Normalisiert einen String für den Vergleich:
 * lowercase → Diakritika entfernen → Sonderzeichen raus → Whitespace vereinheitlichen
 */
export function normalizeForMatch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // combining marks entfernen
    .replace(/[^a-z0-9\s]/g, '')       // nur alphanumerisch + Leerzeichen
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Dice-Koeffizient (intern)
// ---------------------------------------------------------------------------

/**
 * Berechnet den Dice-Koeffizienten zweier Strings anhand ihrer Bigramme.
 * @returns {number} Wert zwischen 0 und 1
 */
function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg);
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

// ---------------------------------------------------------------------------
// Index aufbauen
// ---------------------------------------------------------------------------

/**
 * Baut einen Lookup-Index aus scoring-data.json Tracks.
 * Unterstützt sowohl Langform- (track_id, title, artists) als auch
 * Kurzform-Keys (i, t, a).
 */
export function buildMatchIndex(scoringTracks) {
  const byBeatportId = new Map();
  const byTitleArtist = new Map();

  for (const trk of scoringTracks) {
    const id     = trk.track_id ?? trk.i;
    const title  = trk.title    ?? trk.t ?? '';
    const artist = trk.artists  ?? trk.a ?? '';

    if (id != null) {
      byBeatportId.set(String(id), trk);
    }

    const key = `${normalizeForMatch(title)}|${normalizeForMatch(artist)}`;
    if (key !== '|') {
      byTitleArtist.set(key, trk);
    }
  }

  return { byBeatportId, byTitleArtist, totalTracks: scoringTracks.length };
}

// ---------------------------------------------------------------------------
// Prefix-Bucket für Fuzzy-Optimierung
// ---------------------------------------------------------------------------

function buildPrefixBuckets(byTitleArtist, prefixLen = 3) {
  const buckets = new Map();
  for (const [key, trk] of byTitleArtist) {
    const prefix = key.slice(0, prefixLen);
    if (!buckets.has(prefix)) buckets.set(prefix, []);
    buckets.get(prefix).push({ key, trk });
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Haupt-Matching
// ---------------------------------------------------------------------------

const FUZZY_THRESHOLD = 0.85;
const PREFIX_LEN = 3;

/**
 * Matcht ein Array von Engine-DJ-Tracks gegen den Scoring-Index.
 * Dreistufig: exact_id → title_artist → fuzzy (Dice ≥ 0.85)
 */
export function matchEngineTracksToScoring(engineTracks, scoringIndex) {
  const { byBeatportId, byTitleArtist } = scoringIndex;
  const prefixBuckets = buildPrefixBuckets(byTitleArtist, PREFIX_LEN);

  const stats = { total: engineTracks.length, exact_id: 0, title_artist: 0, fuzzy: 0, none: 0, matchRate: 0 };
  const tracks = [];

  for (const et of engineTracks) {
    let matchType = 'none';
    let matchScore = 0;
    let scoringTrack = null;

    // Stufe 1 — exakte Beatport-ID
    if (et.beatport_id) {
      const found = byBeatportId.get(String(et.beatport_id));
      if (found) {
        matchType = 'exact_id';
        matchScore = 1;
        scoringTrack = found;
      }
    }

    // Stufe 2 — normalisierter Title|Artist
    if (matchType === 'none') {
      const key = `${normalizeForMatch(et.title)}|${normalizeForMatch(et.artists)}`;
      const found = byTitleArtist.get(key);
      if (found) {
        matchType = 'title_artist';
        matchScore = 1;
        scoringTrack = found;
      }
    }

    // Stufe 3 — Fuzzy (Dice) mit Prefix-Filter
    if (matchType === 'none') {
      const normTitle = normalizeForMatch(et.title);
      const queryKey = `${normTitle}|${normalizeForMatch(et.artists)}`;
      const prefix = queryKey.slice(0, PREFIX_LEN);
      const candidates = prefixBuckets.get(prefix) || [];

      let bestScore = 0;
      let bestTrack = null;

      for (const { key, trk } of candidates) {
        const score = diceCoefficient(queryKey, key);
        if (score > bestScore) {
          bestScore = score;
          bestTrack = trk;
        }
      }

      if (bestScore >= FUZZY_THRESHOLD) {
        matchType = 'fuzzy';
        matchScore = Math.round(bestScore * 1000) / 1000;
        scoringTrack = bestTrack;
      }
    }

    stats[matchType]++;
    tracks.push({ ...et, matchType, matchScore, scoringTrack });
  }

  stats.matchRate = stats.total > 0
    ? Math.round(((stats.total - stats.none) / stats.total) * 100)
    : 0;

  return { tracks, stats };
}
