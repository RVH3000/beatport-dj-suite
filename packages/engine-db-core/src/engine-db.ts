import Database from 'better-sqlite3';
import fs from 'fs';
import { getEngineDbPath } from './engine-paths';

export interface Track {
    id: number;
    title: string;
    artist: string;
    album: string;
    genre: string;
    bpm: number;
    key: string;
    rating: number;
    year: number;
    filename: string;
    comment: string;
    label: string;
    path: string | null;
    uri: string | null;
    length: number | null;
    isPlayed: number | null;
    timeLastPlayed: number | null;
    streamingSource: string | null;
    playCount?: number;
    // Engine DJ DB-Spalten fuer erweiterte Sortierung:
    dbPlayOrder: number | null;       // DB-Spalte Track.playOrder (Engine DJ)
    dateAdded: string | null;         // ISO-DATETIME wann der Track in die Library kam
    dateCreated: string | null;       // ISO-DATETIME wann der Track-Eintrag in der DB erstellt wurde
}

export interface Playlist {
    id: number;
    parentListId: number;
    title: string;
    trackCount?: number;
    lastEditTime?: string | null;
    isPersisted?: number;
    isExplicitlyExported?: number;
    nextListId?: number;
}

const TRACK_FIELDS = [
    'id', 'title', 'artist', 'album', 'genre', 'bpm', 'key',
    'rating', 'year', 'filename', 'comment', 'label',
    'path', 'uri', 'length',
    'isPlayed', 'timeLastPlayed', 'streamingSource',
    // Spalten direkt aus dem Engine DJ Track-Schema (PRAGMA-verifiziert):
    'playOrder AS dbPlayOrder', 'dateAdded', 'dateCreated',
].join(', ');

export class EngineDB {
    private db: Database.Database;

    constructor(dbPath: string = getEngineDbPath(), readonly: boolean = true) {
        if (!fs.existsSync(dbPath)) {
            throw new Error(`Engine DJ database not found at ${dbPath}`);
        }
        this.db = new Database(dbPath, { readonly });
    }

    getTracks(limit: number = 100, offset: number = 0): Track[] {
        const stmt = this.db.prepare(
            `SELECT ${TRACK_FIELDS} FROM Track LIMIT ? OFFSET ?`
        );
        return stmt.all(limit, offset) as Track[];
    }

    getAllTracks(): Track[] {
        const stmt = this.db.prepare(`SELECT ${TRACK_FIELDS} FROM Track`);
        return stmt.all() as Track[];
    }

    updateTrack(id: number, data: Partial<Track>): void {
        const ALLOWED_FIELDS: (keyof Track)[] = [
            'title', 'artist', 'album', 'genre', 'bpm', 'key',
            'rating', 'year', 'comment', 'label',
        ];
        const entries = Object.entries(data).filter(
            ([k]) => ALLOWED_FIELDS.includes(k as keyof Track)
        );
        if (entries.length === 0) return;

        const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
        const values = entries.map(([, v]) => v);

        const stmt = this.db.prepare(`UPDATE Track SET ${setClause} WHERE id = ?`);
        stmt.run(...values, id);
    }

    getPlaylists(): Playlist[] {
        const stmt = this.db.prepare(`
            SELECT p.id, p.parentListId, p.title,
                   p.lastEditTime, p.isPersisted, p.isExplicitlyExported, p.nextListId,
                   (SELECT COUNT(*) FROM PlaylistEntity pe WHERE pe.listId = p.id) AS trackCount
            FROM Playlist p
            ORDER BY p.title
        `);
        return stmt.all() as Playlist[];
    }

    getTracksInPlaylist(playlistId: number): Track[] {
        // PlaylistEntity is a linked list via nextEntityId; for now we sort by pe.id
        // which roughly matches insertion order. TODO: traverse the linked list properly.
        const stmt = this.db.prepare(`
            SELECT ${TRACK_FIELDS.split(', ').map(f => `t.${f}`).join(', ')}
            FROM Track t
            JOIN PlaylistEntity pe ON t.id = pe.trackId
            WHERE pe.listId = ?
            ORDER BY pe.id ASC
        `);
        return stmt.all(playlistId) as Track[];
    }

    close() {
        this.db.close();
    }
}

