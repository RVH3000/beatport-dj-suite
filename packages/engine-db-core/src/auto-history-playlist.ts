import path from 'path';
import fs from 'fs';
import { EngineDB, Track } from './engine-db';
import { EngineHistoryDB, HistoryTrack } from './engine-history-db';
import { trackDedupKey, MatchType } from './streaming-uri';

export interface HistoryScanStats {
    sourceDbDir: string;
    mDbExists: boolean;
    hmDbExists: boolean;
    totalSessions: number;
    duplicateSessionGroups: number;
    uniqueSessions: number;
    totalHistoryEntries: number;
    uniqueClusters: number;
    liveMatchCount: number;
    snapshotOnlyCount: number;
    matchTypeBreakdown: Record<MatchType, number>;
    dateRangeStart: string | null;
    dateRangeEnd: string | null;
    topGenres: { name: string; count: number }[];
    topLabels: { name: string; count: number }[];
    topArtists: { name: string; count: number }[];
}

export interface ResolvedTrack {
    source: 'live' | 'snapshot';
    matchType: MatchType;
    clusterSize: number;
    firstPlayed: string | null;
    lastPlayed: string | null;
    sessionTitles: string[];
    id: number;
    title: string;
    artist: string;
    album: string;
    genre: string;
    label: string;
    bpm: number;
    key: number | string;
    rating: number;
    year: number;
    length: number | null;
    comment: string;
    filename: string;
    path: string | null;
    uri: string | null;
    streamingSource: string | null;
}

interface ClusterAccumulator {
    key: string;
    matchType: MatchType;
    snapshotsByTrackId: Map<number, HistoryTrack>;
    playCount: number;
    firstPlayed: string | null;
    lastPlayed: string | null;
    sessionTitles: Set<string>;
}

function resolveDbPaths(input: string): { dbDir: string; mDb: string; hmDb: string } {
    const stat = fs.existsSync(input) ? fs.statSync(input) : null;
    const dbDir = stat?.isDirectory() ? input : path.dirname(input);
    return {
        dbDir,
        mDb: path.join(dbDir, 'm.db'),
        hmDb: path.join(dbDir, 'hm.db'),
    };
}

function metadataRichness(t: { title?: string | null; artist?: string | null; album?: string | null; genre?: string | null; label?: string | null; bpm?: number | null; key?: number | string | null; year?: number | null; comment?: string | null; rating?: number | null }): number {
    let score = 0;
    const keys: (keyof typeof t)[] = ['title', 'artist', 'album', 'genre', 'label', 'bpm', 'key', 'year', 'comment'];
    for (const k of keys) {
        const v = t[k];
        if (v !== null && v !== undefined && v !== '' && v !== 0) score++;
    }
    if ((t.rating ?? 0) > 0) score += 2; // Rating zählt doppelt — User-Wertung > Metadaten
    return score;
}

function pickBestSnapshot(snapshots: HistoryTrack[]): HistoryTrack {
    return [...snapshots].sort((a, b) => {
        const r = (b.rating || 0) - (a.rating || 0);
        if (r) return r;
        const m = metadataRichness(b) - metadataRichness(a);
        if (m) return m;
        return (b.timeLastPlayed || 0) - (a.timeLastPlayed || 0);
    })[0];
}

function pickBestLive(candidates: Track[]): Track {
    return [...candidates].sort((a, b) => {
        const r = (b.rating || 0) - (a.rating || 0);
        if (r) return r;
        const m = metadataRichness(b) - metadataRichness(a);
        if (m) return m;
        return (b.timeLastPlayed || 0) - (a.timeLastPlayed || 0);
    })[0];
}

function liveTrackToResolved(
    t: Track,
    cluster: ClusterAccumulator,
): ResolvedTrack {
    return {
        source: 'live',
        matchType: cluster.matchType,
        clusterSize: cluster.playCount,
        firstPlayed: cluster.firstPlayed,
        lastPlayed: cluster.lastPlayed,
        sessionTitles: [...cluster.sessionTitles],
        id: t.id,
        title: t.title || '',
        artist: t.artist || '',
        album: t.album || '',
        genre: t.genre || '',
        label: t.label || '',
        bpm: t.bpm || 0,
        key: t.key,
        rating: t.rating || 0,
        year: t.year || 0,
        length: t.length,
        comment: t.comment || '',
        filename: t.filename || '',
        path: t.path,
        uri: t.uri,
        streamingSource: t.streamingSource,
    };
}

function snapshotToResolved(
    t: HistoryTrack,
    cluster: ClusterAccumulator,
): ResolvedTrack {
    return {
        source: 'snapshot',
        matchType: cluster.matchType,
        clusterSize: cluster.playCount,
        firstPlayed: cluster.firstPlayed,
        lastPlayed: cluster.lastPlayed,
        sessionTitles: [...cluster.sessionTitles],
        id: t.trackId,
        title: t.title || '',
        artist: t.artist || '',
        album: t.album || '',
        genre: t.genre || '',
        label: t.label || '',
        bpm: t.bpm || 0,
        key: t.key,
        rating: t.rating || 0,
        year: t.year || 0,
        length: t.length,
        comment: t.comment || '',
        filename: t.path ? path.basename(t.path) : '',
        path: t.path,
        uri: t.uri,
        streamingSource: t.streamingSource,
    };
}

function buildClusters(input: string): {
    clusters: Map<string, ClusterAccumulator>;
    sessions: { id: number; title: string; startTime: string }[];
    duplicateSessionGroups: number;
    uniqueSessions: number;
    totalEntries: number;
    dateRangeStart: string | null;
    dateRangeEnd: string | null;
} {
    const { hmDb } = resolveDbPaths(input);
    const hist = new EngineHistoryDB(hmDb, true);
    try {
        const sessions = hist.getSessions();
        const sessionKey = (s: { title: string; startTime: string }) => `${s.title}|${s.startTime}`;
        const seenKeys = new Set<string>();
        let duplicateGroups = 0;
        const uniqueSessions: typeof sessions = [];
        const grouped = new Map<string, typeof sessions>();
        for (const s of sessions) {
            const k = sessionKey(s);
            if (!grouped.has(k)) grouped.set(k, []);
            grouped.get(k)!.push(s);
        }
        for (const [k, group] of grouped) {
            if (group.length > 1) duplicateGroups++;
            uniqueSessions.push(group[0]);
            seenKeys.add(k);
        }

        const clusters = new Map<string, ClusterAccumulator>();
        let totalEntries = 0;
        let dateMin: string | null = null;
        let dateMax: string | null = null;

        for (const session of sessions) {
            const tracks = hist.getSessionTracks(session.id);
            for (const t of tracks) {
                totalEntries++;
                const { key, type } = trackDedupKey({ id: t.trackId, title: t.title, artist: t.artist, uri: t.uri });
                let c = clusters.get(key);
                if (!c) {
                    c = {
                        key,
                        matchType: type,
                        snapshotsByTrackId: new Map(),
                        playCount: 0,
                        firstPlayed: null,
                        lastPlayed: null,
                        sessionTitles: new Set(),
                    };
                    clusters.set(key, c);
                }
                c.playCount++;
                c.sessionTitles.add(session.title);
                if (!c.snapshotsByTrackId.has(t.trackId)) {
                    c.snapshotsByTrackId.set(t.trackId, t);
                }
                const played = t.startTime || null;
                if (played) {
                    if (!c.firstPlayed || played < c.firstPlayed) c.firstPlayed = played;
                    if (!c.lastPlayed || played > c.lastPlayed) c.lastPlayed = played;
                    if (!dateMin || played < dateMin) dateMin = played;
                    if (!dateMax || played > dateMax) dateMax = played;
                }
            }
        }

        return {
            clusters,
            sessions: uniqueSessions,
            duplicateSessionGroups: duplicateGroups,
            uniqueSessions: uniqueSessions.length,
            totalEntries,
            dateRangeStart: dateMin,
            dateRangeEnd: dateMax,
        };
    } finally {
        hist.close();
    }
}

function buildLiveMap(mDbPath: string): Map<string, Track[]> {
    const map = new Map<string, Track[]>();
    if (!fs.existsSync(mDbPath)) return map;
    const eng = new EngineDB(mDbPath, true);
    try {
        for (const t of eng.getAllTracks()) {
            const { key } = trackDedupKey({ id: t.id, title: t.title, artist: t.artist, uri: t.uri });
            const arr = map.get(key);
            if (arr) arr.push(t);
            else map.set(key, [t]);
        }
    } finally {
        eng.close();
    }
    return map;
}

export function scanHistoryDb(input: string): HistoryScanStats {
    const { dbDir, mDb, hmDb } = resolveDbPaths(input);
    const stats: HistoryScanStats = {
        sourceDbDir: dbDir,
        mDbExists: fs.existsSync(mDb),
        hmDbExists: fs.existsSync(hmDb),
        totalSessions: 0,
        duplicateSessionGroups: 0,
        uniqueSessions: 0,
        totalHistoryEntries: 0,
        uniqueClusters: 0,
        liveMatchCount: 0,
        snapshotOnlyCount: 0,
        matchTypeBreakdown: { bp: 0, sc: 0, meta: 0, id: 0 },
        dateRangeStart: null,
        dateRangeEnd: null,
        topGenres: [],
        topLabels: [],
        topArtists: [],
    };
    if (!stats.hmDbExists) return stats;

    const hist = new EngineHistoryDB(hmDb, true);
    let totalSessions = 0;
    try {
        totalSessions = hist.getSessions().length;
    } finally {
        hist.close();
    }
    stats.totalSessions = totalSessions;

    const built = buildClusters(input);
    stats.duplicateSessionGroups = built.duplicateSessionGroups;
    stats.uniqueSessions = built.uniqueSessions;
    stats.totalHistoryEntries = built.totalEntries;
    stats.uniqueClusters = built.clusters.size;
    stats.dateRangeStart = built.dateRangeStart;
    stats.dateRangeEnd = built.dateRangeEnd;

    const liveMap = stats.mDbExists ? buildLiveMap(mDb) : new Map();
    const genreCount = new Map<string, number>();
    const labelCount = new Map<string, number>();
    const artistCount = new Map<string, number>();

    for (const c of built.clusters.values()) {
        stats.matchTypeBreakdown[c.matchType]++;
        if (liveMap.has(c.key)) stats.liveMatchCount++;
        else stats.snapshotOnlyCount++;

        const sample = liveMap.get(c.key)?.[0] || pickBestSnapshot([...c.snapshotsByTrackId.values()]);
        const g = (sample.genre || '').trim();
        const l = (sample.label || '').trim();
        const a = (sample.artist || '').trim();
        if (g) genreCount.set(g, (genreCount.get(g) || 0) + 1);
        if (l) labelCount.set(l, (labelCount.get(l) || 0) + 1);
        if (a) artistCount.set(a, (artistCount.get(a) || 0) + 1);
    }

    const top = (m: Map<string, number>, n = 10) =>
        [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([name, count]) => ({ name, count }));
    stats.topGenres = top(genreCount);
    stats.topLabels = top(labelCount);
    stats.topArtists = top(artistCount);

    return stats;
}

export type SortMode = 'firstPlayed' | 'lastPlayed' | 'playCount' | 'rating' | 'bpm' | 'artist' | 'title' | 'genre';

export interface BuildOptions {
    sort?: SortMode;
    sortDir?: 'asc' | 'desc';
    minPlayCount?: number;
    minRating?: number;
    onlyLive?: boolean;
    matchTypes?: MatchType[];
}

export function buildHistoryPlaylist(input: string, opts: BuildOptions = {}): ResolvedTrack[] {
    const { mDb } = resolveDbPaths(input);
    const built = buildClusters(input);
    const liveMap = fs.existsSync(mDb) ? buildLiveMap(mDb) : new Map();

    const out: ResolvedTrack[] = [];
    for (const c of built.clusters.values()) {
        const liveCandidates = liveMap.get(c.key);
        if (liveCandidates && liveCandidates.length > 0) {
            out.push(liveTrackToResolved(pickBestLive(liveCandidates), c));
        } else {
            if (opts.onlyLive) continue;
            const snaps = [...c.snapshotsByTrackId.values()];
            if (snaps.length > 0) out.push(snapshotToResolved(pickBestSnapshot(snaps), c));
        }
    }

    let arr = out;
    if (opts.minPlayCount && opts.minPlayCount > 1) {
        arr = arr.filter(t => t.clusterSize >= opts.minPlayCount!);
    }
    if (opts.minRating) {
        arr = arr.filter(t => (t.rating || 0) >= opts.minRating! * 10);
    }
    if (opts.matchTypes && opts.matchTypes.length > 0) {
        const allowed = new Set(opts.matchTypes);
        arr = arr.filter(t => allowed.has(t.matchType));
    }

    sortResolved(arr, opts.sort || 'firstPlayed', opts.sortDir || 'asc');
    return arr;
}

export function sortResolved(arr: ResolvedTrack[], mode: SortMode, dir: 'asc' | 'desc' = 'asc'): void {
    const sign = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
        switch (mode) {
            case 'firstPlayed':
                return sign * compareNullable(a.firstPlayed, b.firstPlayed);
            case 'lastPlayed':
                return sign * compareNullable(a.lastPlayed, b.lastPlayed);
            case 'playCount':
                return sign * (a.clusterSize - b.clusterSize);
            case 'rating':
                return sign * ((a.rating || 0) - (b.rating || 0));
            case 'bpm':
                return sign * ((a.bpm || 0) - (b.bpm || 0));
            case 'artist':
                return sign * a.artist.localeCompare(b.artist);
            case 'title':
                return sign * a.title.localeCompare(b.title);
            case 'genre':
                return sign * a.genre.localeCompare(b.genre);
            default:
                return 0;
        }
    });
}

function compareNullable(a: string | null, b: string | null): number {
    if (a === b) return 0;
    if (a === null) return 1;  // nulls last
    if (b === null) return -1;
    return a < b ? -1 : 1;
}

// Convert ResolvedTrack to Track for existing exporters
export function resolvedToTrack(r: ResolvedTrack): Track {
    return {
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album,
        genre: r.genre,
        bpm: r.bpm,
        key: typeof r.key === 'string' ? r.key : String(r.key || ''),
        rating: r.rating,
        year: r.year,
        filename: r.filename,
        comment: r.comment,
        label: r.label,
        path: r.path,
        uri: r.uri,
        length: r.length,
        isPlayed: 1,
        timeLastPlayed: null,
        streamingSource: r.streamingSource,
        playCount: r.clusterSize,
        dbPlayOrder: null,
        dateAdded: null,
        dateCreated: null,
    };
}
