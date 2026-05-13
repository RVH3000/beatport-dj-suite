import Database from 'better-sqlite3';
import fs from 'fs';
import { getHistoryDbPath } from './engine-paths';

export interface HistorySession {
    id: number;
    title: string;
    startTime: string; // ISO date string coming from DB usually as timestamp or string
}

export interface HistoryTrack {
    id: number;
    trackId: number;
    title: string;
    artist: string;
    album: string | null;
    label: string | null;
    genre: string | null;
    bpm: number;
    key: number;
    rating: number | null;
    year: number | null;
    length: number | null;
    comment: string | null;
    path: string | null;
    uri: string | null;
    streamingSource: string | null;
    isPlayed: number | null;
    timeLastPlayed: number | null;
    startTime: string; // From HistorylistEntity
}

export class EngineHistoryDB {
    private db: Database.Database;

    constructor(dbPath: string = getHistoryDbPath(), readonly: boolean = true) {
        if (!fs.existsSync(dbPath)) {
            throw new Error(`Engine DJ History database not found at ${dbPath}`);
        }
        this.db = new Database(dbPath, { readonly });
    }

    getSessions(): HistorySession[] {
        // Fetch all history lists (sessions)
        const stmt = this.db.prepare(`
            SELECT id, title, datetime(startTime, 'unixepoch') as startTime
            FROM Historylist
            WHERE isDeleted = 0
            ORDER BY startTime DESC
        `);
        return stmt.all() as HistorySession[];
    }

    getSessionTracks(listId: number): HistoryTrack[] {
        // Join HistorylistEntity with Track table in hm.db to get metadata
        // Note: Track table in hm.db is a SNAPSHOT of the track when it was played.
        const stmt = this.db.prepare(`
            SELECT
                he.id,
                he.trackId,
                t.title, t.artist, t.album, t.label, t.genre,
                t.bpm, t.key, t.rating, t.year, t.length, t.comment,
                t.path, t.uri, t.streamingSource,
                t.isPlayed, t.timeLastPlayed,
                datetime(he.startTime, 'unixepoch') as startTime
            FROM HistorylistEntity he
            LEFT JOIN Track t ON he.trackId = t.id
            WHERE he.listId = ?
            ORDER BY he.startTime ASC
        `);
        return stmt.all(listId) as HistoryTrack[];
    }

    getPlayCountsByTrackId(): Map<number, number> {
        const rows = this.db.prepare(`
            SELECT trackId, COUNT(*) AS playCount
            FROM HistorylistEntity
            GROUP BY trackId
        `).all() as Array<{ trackId: number; playCount: number }>;
        const map = new Map<number, number>();
        for (const r of rows) map.set(r.trackId, r.playCount);
        return map;
    }

    deduplicateHistory(): { merged: number, deleted: number } {
        const duplicates = this.db.prepare(`
            SELECT title, startTime, COUNT(*) as count
            FROM Historylist
            WHERE isDeleted = 0
            GROUP BY title, startTime
            HAVING count > 1
        `).all() as any[];

        let mergedCount = 0;
        let deletedCount = 0;

        const transaction = this.db.transaction((dupes) => {
            for (const group of dupes) {
                const ids = this.db.prepare(`
                    SELECT id FROM Historylist
                    WHERE title IS ? AND startTime IS ? AND isDeleted = 0
                    ORDER BY id ASC
                `).all(group.title, group.startTime) as any[];

                const keepId = ids[0].id;
                const deleteIds = ids.slice(1).map((row: any) => row.id);

                for (const delId of deleteIds) {
                    // Move tracks to the keepId session
                    this.db.prepare(`
                        UPDATE HistorylistEntity
                        SET listId = ?
                        WHERE listId = ?
                    `).run(keepId, delId);

                    // Delete the duplicate list entry
                    this.db.prepare(`
                        DELETE FROM Historylist WHERE id = ?
                    `).run(delId);

                    mergedCount++;
                    deletedCount++;
                }
            }
        });

        transaction(duplicates);
        return { merged: mergedCount, deleted: deletedCount };
    }

    close() {
        this.db.close();
    }
}
