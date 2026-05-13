import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getDbDir } from './engine-paths.js';

export interface ScanResult {
    dbDir: string;
    scannedAt: number;
    mDb: {
        exists: boolean;
        sizeBytes: number;
        trackCount: number;
        playlistCount: number;
        schemaVersion: string | null;
        lastModified: number;
    };
    hmDb: {
        exists: boolean;
        sizeBytes: number;
        historylistCount: number;
        historylistEntityCount: number;
        lastModified: number;
        firstSession: number | null;
        lastSession: number | null;
    };
    totalSizeBytes: number;
    files: string[];
    warnings: string[];
}

export class ScannerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ScannerError';
    }
}

function normalize(p: string): string {
    return path.resolve(p);
}

function assertNotActiveDb(targetDir: string): void {
    const active = getDbDir();
    if (normalize(targetDir) === normalize(active)) {
        throw new ScannerError(
            `Scan verweigert: Pfad ist identisch mit der aktiven App-DB (${active}). ` +
                `Die aktive DB wird nicht in der Registry gescannt.`
        );
    }
}

function readSchemaVersion(db: Database.Database): string | null {
    try {
        const row = db
            .prepare(
                "SELECT value FROM Information WHERE id = (SELECT MAX(id) FROM Information)"
            )
            .get() as any;
        return row?.value ? String(row.value) : null;
    } catch {
        return null;
    }
}

function countTable(db: Database.Database, name: string): number {
    try {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as any;
        return Number(row?.n ?? 0);
    } catch {
        return 0;
    }
}

export function scanDbDir(dbDir: string): ScanResult {
    assertNotActiveDb(dbDir);

    if (!fs.existsSync(dbDir)) {
        throw new ScannerError(`Ordner existiert nicht: ${dbDir}`);
    }
    const stat = fs.statSync(dbDir);
    if (!stat.isDirectory()) {
        throw new ScannerError(`Pfad ist kein Ordner: ${dbDir}`);
    }

    const warnings: string[] = [];
    const mPath = path.join(dbDir, 'm.db');
    const hmPath = path.join(dbDir, 'hm.db');

    const mExists = fs.existsSync(mPath);
    const hmExists = fs.existsSync(hmPath);

    if (!mExists) {
        warnings.push('m.db nicht gefunden — kein Engine-DJ-Database2-Ordner?');
    }

    let trackCount = 0;
    let playlistCount = 0;
    let schemaVersion: string | null = null;
    let mSize = 0;
    let mModified = 0;

    if (mExists) {
        const s = fs.statSync(mPath);
        mSize = s.size;
        mModified = Math.floor(s.mtimeMs / 1000);

        const db = new Database(mPath, { readonly: true, fileMustExist: true });
        try {
            db.pragma('query_only = ON');
            trackCount = countTable(db, 'Track');
            playlistCount = countTable(db, 'Playlist');
            schemaVersion = readSchemaVersion(db);
        } finally {
            db.close();
        }
    }

    let historylistCount = 0;
    let historylistEntityCount = 0;
    let hmSize = 0;
    let hmModified = 0;
    let firstSession: number | null = null;
    let lastSession: number | null = null;

    if (hmExists) {
        const s = fs.statSync(hmPath);
        hmSize = s.size;
        hmModified = Math.floor(s.mtimeMs / 1000);

        const db = new Database(hmPath, { readonly: true, fileMustExist: true });
        try {
            db.pragma('query_only = ON');
            historylistCount = countTable(db, 'Historylist');
            historylistEntityCount = countTable(db, 'HistorylistEntity');
            try {
                const row = db
                    .prepare(
                        `SELECT MIN(startTime) AS firstSession, MAX(startTime) AS lastSession
                         FROM Historylist
                         WHERE isDeleted IS NULL OR isDeleted = 0`
                    )
                    .get() as { firstSession: number | null; lastSession: number | null };
                firstSession = row?.firstSession ?? null;
                lastSession = row?.lastSession ?? null;
            } catch {
                // Historylist-Schema anders als erwartet — Session-Metriken bleiben null
            }
        } finally {
            db.close();
        }
    } else {
        warnings.push('hm.db nicht gefunden — History-Scan übersprungen.');
    }

    const files = fs.readdirSync(dbDir).filter(f => /\.db($|-)/.test(f));

    return {
        dbDir: normalize(dbDir),
        scannedAt: Math.floor(Date.now() / 1000),
        mDb: {
            exists: mExists,
            sizeBytes: mSize,
            trackCount,
            playlistCount,
            schemaVersion,
            lastModified: mModified,
        },
        hmDb: {
            exists: hmExists,
            sizeBytes: hmSize,
            historylistCount,
            historylistEntityCount,
            lastModified: hmModified,
            firstSession,
            lastSession,
        },
        totalSizeBytes: mSize + hmSize,
        files,
        warnings,
    };
}

export function writeScanArtifacts(
    result: ScanResult,
    label: string
): { jsonPath: string; mdPath: string } {
    const jsonPath = path.join(result.dbDir, 'enginedj-scan.json');
    const mdPath = path.join(result.dbDir, 'enginedj-scan.md');

    fs.writeFileSync(jsonPath, JSON.stringify({ label, ...result }, null, 2), 'utf-8');
    fs.writeFileSync(mdPath, renderMd(result, label), 'utf-8');

    return { jsonPath, mdPath };
}

function renderMd(r: ScanResult, label: string): string {
    const ts = new Date(r.scannedAt * 1000).toISOString();
    const sizeMB = (r.totalSizeBytes / 1024 / 1024).toFixed(2);
    const lines = [
        `# Engine DJ Scan — ${label}`,
        '',
        `**Pfad:** \`${r.dbDir}\``,
        `**Gescannt:** ${ts}`,
        `**Gesamtgröße:** ${sizeMB} MB`,
        '',
        '## m.db',
        `- Vorhanden: ${r.mDb.exists ? 'ja' : 'nein'}`,
        `- Größe: ${(r.mDb.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
        `- Tracks: ${r.mDb.trackCount.toLocaleString('de-DE')}`,
        `- Playlists: ${r.mDb.playlistCount.toLocaleString('de-DE')}`,
        `- Schema: ${r.mDb.schemaVersion ?? 'unbekannt'}`,
        `- Zuletzt geändert: ${r.mDb.lastModified ? new Date(r.mDb.lastModified * 1000).toISOString() : '–'}`,
        '',
        '## hm.db',
        `- Vorhanden: ${r.hmDb.exists ? 'ja' : 'nein'}`,
        `- Größe: ${(r.hmDb.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
        `- Historylist: ${r.hmDb.historylistCount.toLocaleString('de-DE')}`,
        `- HistorylistEntity: ${r.hmDb.historylistEntityCount.toLocaleString('de-DE')}`,
        `- Zuletzt geändert: ${r.hmDb.lastModified ? new Date(r.hmDb.lastModified * 1000).toISOString() : '–'}`,
        `- Aktiv: ${r.hmDb.firstSession && r.hmDb.lastSession
            ? `seit ${new Date(r.hmDb.firstSession * 1000).toISOString().slice(0, 10)} bis ${new Date(r.hmDb.lastSession * 1000).toISOString().slice(0, 10)}`
            : '–'}`,
        '',
        '## Dateien im Ordner',
        ...r.files.map(f => `- \`${f}\``),
    ];
    if (r.warnings.length > 0) {
        lines.push('', '## Warnungen', ...r.warnings.map(w => `- ${w}`));
    }
    return lines.join('\n');
}
