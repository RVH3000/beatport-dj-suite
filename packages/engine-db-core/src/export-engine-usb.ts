import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Track } from './engine-db';

export interface UsbExportResult {
    targetDir: string;
    targetUuid: string | null;
    playlistId: number;
    playlistName: string;
    tracksAdded: number;
    tracksMissing: Array<{ sourceId: number; title: string; artist: string }>;
    dryRun: boolean;
}

export interface UsbExportOptions {
    tracks: Track[];
    targetDir: string;
    playlistName: string;
    dryRun?: boolean;
    /**
     * When false, refuses to write to any path that does not contain "SANDBOX".
     * Default: false (safety on). Set to true to allow writing to a real USB stick.
     */
    allowNonSandbox?: boolean;
}

const SANDBOX_MARKER = 'SANDBOX';

export function exportToEngineUsb({
    tracks,
    targetDir,
    playlistName,
    dryRun = false,
    allowNonSandbox = false,
}: UsbExportOptions): UsbExportResult {
    if (!allowNonSandbox && !targetDir.includes(SANDBOX_MARKER)) {
        throw new Error(
            `Safety: targetDir does not contain "${SANDBOX_MARKER}" — writes blocked. ` +
            `Set allowNonSandbox=true to write to a real USB stick.`
        );
    }

    const mDbPath = path.join(targetDir, 'm.db');
    if (!fs.existsSync(mDbPath)) {
        throw new Error(`Target m.db not found: ${mDbPath}`);
    }

    const target = new Database(mDbPath);
    try {
        const info = target.prepare('SELECT uuid FROM Information LIMIT 1').get() as { uuid: string } | undefined;
        const targetUuid = info?.uuid ?? null;

        // Match each source track in target via (originDatabaseUuid+originTrackId) or by title+artist fallback
        const matches: Array<{ sourceTrack: Track; targetTrackId: number | null }> = [];
        const matchByOrigin = target.prepare(
            'SELECT id FROM Track WHERE originDatabaseUuid = ? AND originTrackId = ? LIMIT 1'
        );
        const matchByTitleArtist = target.prepare(
            'SELECT id FROM Track WHERE title = ? AND artist = ? LIMIT 1'
        );

        for (const src of tracks) {
            let row: { id: number } | undefined;
            const originUuid = (src as unknown as { originDatabaseUuid?: string }).originDatabaseUuid;
            const originId = (src as unknown as { originTrackId?: number }).originTrackId;
            if (originUuid && originId) {
                row = matchByOrigin.get(originUuid, originId) as { id: number } | undefined;
            }
            if (!row && src.title) {
                row = matchByTitleArtist.get(src.title, src.artist || '') as { id: number } | undefined;
            }
            matches.push({ sourceTrack: src, targetTrackId: row?.id ?? null });
        }

        const missing = matches
            .filter(m => m.targetTrackId === null)
            .map(m => ({ sourceId: m.sourceTrack.id, title: m.sourceTrack.title, artist: m.sourceTrack.artist }));
        const present = matches.filter(m => m.targetTrackId !== null) as Array<{ sourceTrack: Track; targetTrackId: number }>;

        // Check title uniqueness under parentListId=0
        const existing = target.prepare(
            'SELECT id FROM Playlist WHERE title = ? AND parentListId = 0'
        ).get(playlistName) as { id: number } | undefined;
        if (existing) {
            throw new Error(
                `A top-level playlist named "${playlistName}" already exists (id=${existing.id}). ` +
                `Choose a different name.`
            );
        }

        if (dryRun) {
            return {
                targetDir,
                targetUuid,
                playlistId: -1,
                playlistName,
                tracksAdded: present.length,
                tracksMissing: missing,
                dryRun: true,
            };
        }

        const insertPlaylist = target.prepare(`
            INSERT INTO Playlist
                (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported)
            VALUES (?, 0, 1, 0, strftime('%s','now'), 0)
        `);
        const insertEntity = target.prepare(`
            INSERT INTO PlaylistEntity
                (listId, trackId, databaseUuid, nextEntityId, membershipReference)
            VALUES (?, ?, ?, ?, 0)
        `);

        const txn = target.transaction(() => {
            const playlistInfo = insertPlaylist.run(playlistName);
            const playlistId = Number(playlistInfo.lastInsertRowid);

            // Insert entries in REVERSE so each new row's nextEntityId = id of previously inserted row
            let prevEntityId = 0;
            for (let i = present.length - 1; i >= 0; i--) {
                const entry = present[i];
                const res = insertEntity.run(playlistId, entry.targetTrackId, targetUuid, prevEntityId);
                prevEntityId = Number(res.lastInsertRowid);
            }
            return playlistId;
        });

        const playlistId = txn();
        return {
            targetDir,
            targetUuid,
            playlistId,
            playlistName,
            tracksAdded: present.length,
            tracksMissing: missing,
            dryRun: false,
        };
    } finally {
        target.close();
    }
}
