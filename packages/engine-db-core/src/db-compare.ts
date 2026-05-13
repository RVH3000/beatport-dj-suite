import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getDbDir } from './engine-paths';

export interface TrackSummary {
    id: number;
    title: string;
    artist: string;
    originDatabaseUuid: string | null;
    originTrackId: number | null;
}

export interface PerDbSummary {
    dbId: number;
    label: string;
    path: string;
    trackCount: number;
    exclusiveCount: number;
}

export interface CompareResult {
    dbs: PerDbSummary[];
    totalUnique: number;
    sharedAcrossAll: number;
    pairwiseOverlap: { a: number; b: number; overlap: number }[];
    duplicatesByKey: number;
}

interface InputEntry {
    dbId: number;
    label: string;
    dbDir: string;
}

function assertNotActive(dbDir: string): void {
    const active = getDbDir();
    if (path.resolve(dbDir) === path.resolve(active)) {
        throw new Error(
            `Compare verweigert: Pfad ist identisch mit der aktiven App-DB (${active}).`
        );
    }
}

function readTracks(dbDir: string): TrackSummary[] {
    const mPath = path.join(dbDir, 'm.db');
    if (!fs.existsSync(mPath)) {
        throw new Error(`m.db nicht gefunden in ${dbDir}`);
    }
    const db = new Database(mPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('query_only = ON');
        const rows = db
            .prepare(
                `SELECT id,
                        COALESCE(title, '')  AS title,
                        COALESCE(artist, '') AS artist,
                        originDatabaseUuid,
                        originTrackId
                 FROM Track`
            )
            .all() as any[];
        return rows.map(r => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
            originDatabaseUuid: r.originDatabaseUuid ?? null,
            originTrackId: r.originTrackId ?? null,
        }));
    } finally {
        db.close();
    }
}

function keyFor(t: TrackSummary): string {
    if (t.originDatabaseUuid && t.originTrackId != null) {
        return `origin:${t.originDatabaseUuid}:${t.originTrackId}`;
    }
    return `meta:${t.title.toLowerCase().trim()}|${t.artist.toLowerCase().trim()}`;
}

export function compareDbs(inputs: InputEntry[]): CompareResult {
    if (inputs.length < 2) {
        throw new Error('Compare benötigt mindestens zwei DBs.');
    }
    inputs.forEach(i => assertNotActive(i.dbDir));

    const perDbKeys: Map<number, Set<string>> = new Map();
    const dbInfo: Map<number, { label: string; path: string; trackCount: number }> = new Map();

    for (const inp of inputs) {
        const tracks = readTracks(inp.dbDir);
        const keys = new Set<string>();
        for (const t of tracks) keys.add(keyFor(t));
        perDbKeys.set(inp.dbId, keys);
        dbInfo.set(inp.dbId, {
            label: inp.label,
            path: inp.dbDir,
            trackCount: tracks.length,
        });
    }

    const allKeys = new Set<string>();
    for (const keys of perDbKeys.values()) {
        for (const k of keys) allKeys.add(k);
    }

    const sharedAcrossAll = [...allKeys].filter(k =>
        [...perDbKeys.values()].every(s => s.has(k))
    ).length;

    const ids = [...perDbKeys.keys()];
    const pairwiseOverlap: { a: number; b: number; overlap: number }[] = [];
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const a = perDbKeys.get(ids[i])!;
            const b = perDbKeys.get(ids[j])!;
            let n = 0;
            for (const k of a) if (b.has(k)) n++;
            pairwiseOverlap.push({ a: ids[i], b: ids[j], overlap: n });
        }
    }

    const dbs: PerDbSummary[] = ids.map(id => {
        const keys = perDbKeys.get(id)!;
        const othersUnion = new Set<string>();
        for (const [otherId, otherKeys] of perDbKeys.entries()) {
            if (otherId === id) continue;
            for (const k of otherKeys) othersUnion.add(k);
        }
        let exclusive = 0;
        for (const k of keys) if (!othersUnion.has(k)) exclusive++;
        const info = dbInfo.get(id)!;
        return {
            dbId: id,
            label: info.label,
            path: info.path,
            trackCount: info.trackCount,
            exclusiveCount: exclusive,
        };
    });

    return {
        dbs,
        totalUnique: allKeys.size,
        sharedAcrossAll,
        pairwiseOverlap,
        duplicatesByKey: 0,
    };
}
