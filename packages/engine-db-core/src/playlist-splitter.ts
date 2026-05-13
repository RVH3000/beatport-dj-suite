import type { ResolvedTrack } from './auto-history-playlist.js';

export type SplitMode = 'none' | 'byMonth' | 'byYear' | 'byCount' | 'byBpmRange' | 'byLabel' | 'byGenre';

export interface SplitOptions {
    mode: SplitMode;
    chunkSize?: number;        // for byCount
    bpmStep?: number;          // for byBpmRange (default 10)
    bpmStart?: number;         // for byBpmRange (default 60)
    bpmEnd?: number;           // for byBpmRange (default 200)
    minTracksPerChunk?: number; // skip very small chunks
}

export interface SplitChunk {
    name: string;
    tracks: ResolvedTrack[];
}

function safeName(s: string): string {
    return s.replace(/[^a-zA-Z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function monthKey(iso: string | null): string {
    if (!iso) return 'undated';
    return iso.substring(0, 7); // YYYY-MM
}

function yearKey(iso: string | null): string {
    if (!iso) return 'undated';
    return iso.substring(0, 4);
}

export function splitTracks(tracks: ResolvedTrack[], opts: SplitOptions): SplitChunk[] {
    if (tracks.length === 0) return [];
    const minSize = opts.minTracksPerChunk ?? 1;

    let chunks: SplitChunk[];

    switch (opts.mode) {
        case 'none':
            return [{ name: 'all', tracks }];

        case 'byCount': {
            const size = Math.max(1, opts.chunkSize ?? 200);
            chunks = [];
            for (let i = 0; i < tracks.length; i += size) {
                const slice = tracks.slice(i, i + size);
                const idx = Math.floor(i / size) + 1;
                chunks.push({ name: `chunk-${String(idx).padStart(2, '0')}`, tracks: slice });
            }
            break;
        }

        case 'byMonth':
            chunks = groupBy(tracks, t => monthKey(t.firstPlayed));
            chunks.sort((a, b) => a.name.localeCompare(b.name));
            break;

        case 'byYear':
            chunks = groupBy(tracks, t => yearKey(t.firstPlayed));
            chunks.sort((a, b) => a.name.localeCompare(b.name));
            break;

        case 'byBpmRange': {
            const step = opts.bpmStep ?? 10;
            const start = opts.bpmStart ?? 60;
            const end = opts.bpmEnd ?? 200;
            chunks = groupBy(tracks, t => {
                const b = t.bpm || 0;
                if (!b) return 'no-bpm';
                if (b < start) return `under-${start}`;
                if (b >= end) return `${end}-plus`;
                const lo = Math.floor((b - start) / step) * step + start;
                return `${lo}-${lo + step}`;
            });
            chunks.sort((a, b) => a.name.localeCompare(b.name));
            break;
        }

        case 'byLabel':
            chunks = groupBy(tracks, t => safeName(t.label || 'no-label'));
            chunks.sort((a, b) => b.tracks.length - a.tracks.length);
            break;

        case 'byGenre':
            chunks = groupBy(tracks, t => safeName(t.genre || 'no-genre'));
            chunks.sort((a, b) => b.tracks.length - a.tracks.length);
            break;

        default:
            return [{ name: 'all', tracks }];
    }

    return chunks.filter(c => c.tracks.length >= minSize);
}

function groupBy(tracks: ResolvedTrack[], keyFn: (t: ResolvedTrack) => string): SplitChunk[] {
    const m = new Map<string, ResolvedTrack[]>();
    for (const t of tracks) {
        const k = keyFn(t);
        const arr = m.get(k);
        if (arr) arr.push(t);
        else m.set(k, [t]);
    }
    return [...m.entries()].map(([name, tracks]) => ({ name, tracks }));
}
