// Engine DJ stores streaming tracks with a URI like:
//   streaming://Beatport%20LINK/Track/12345678
//   streaming://SoundCloud/Track/1837355526
// The numeric ID is stable across Engine-Sync between devices, even when the
// internal Track.id changes — making it the most reliable dedup key.

const BEATPORT_RE = /Beatport[^/]*\/Track\/(\d+)/i;
const SOUNDCLOUD_RE = /SoundCloud[^/]*\/Track\/(\d+)/i;

export function parseBeatportTrackId(uri: string | null | undefined): string | null {
    if (!uri) return null;
    const m = uri.match(BEATPORT_RE);
    return m ? m[1] : null;
}

export function parseSoundCloudTrackId(uri: string | null | undefined): string | null {
    if (!uri) return null;
    const m = uri.match(SOUNDCLOUD_RE);
    return m ? m[1] : null;
}

export type MatchType = 'bp' | 'sc' | 'meta' | 'id';

export interface MatchMeta {
    icon: string;
    bg: string;
    label: string;
    statLabel: string;
}

// Smart dedup hierarchy: stable Streaming-ID → artist+title → Track-ID fallback.
// Used both for multi-session merge and library-wide duplicate detection.
export function trackDedupKey(t: {
    id: number;
    title?: string | null;
    artist?: string | null;
    uri?: string | null;
}): { key: string; type: MatchType } {
    const bp = parseBeatportTrackId(t.uri);
    if (bp) return { key: `bp:${bp}`, type: 'bp' };
    const sc = parseSoundCloudTrackId(t.uri);
    if (sc) return { key: `sc:${sc}`, type: 'sc' };
    const a = (t.artist || '').trim().toLowerCase();
    const ti = (t.title || '').trim().toLowerCase();
    if (a && ti) return { key: `m:${a}|${ti}`, type: 'meta' };
    return { key: `i:${t.id}`, type: 'id' };
}

export const MATCH_META: Record<MatchType, MatchMeta> = {
    bp: {
        icon: '🅱',
        bg: 'rgba(29, 78, 216, 0.5)',
        label: 'Match via Beatport-Streaming-ID (zuverlässigster Match)',
        statLabel: 'Beatport',
    },
    sc: {
        icon: '☁',
        bg: 'rgba(217, 119, 6, 0.5)',
        label: 'Match via SoundCloud-Streaming-ID',
        statLabel: 'SoundCloud',
    },
    meta: {
        icon: '≈',
        bg: 'rgba(168, 85, 247, 0.5)',
        label: 'Match via Artist + Title (case-insensitive)',
        statLabel: 'Artist+Title',
    },
    id: {
        icon: '#',
        bg: 'rgba(100, 100, 100, 0.5)',
        label: 'Match via Track-ID',
        statLabel: 'Track-ID',
    },
};
