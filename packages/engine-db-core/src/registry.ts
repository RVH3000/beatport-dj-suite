import path from 'path';
import os from 'os';
import fs from 'fs';
import Database from 'better-sqlite3';

const REGISTRY_DIR = path.join(os.homedir(), '.engine-dj-manager');
const REGISTRY_DB_PATH = path.join(REGISTRY_DIR, 'registry.db');

export interface DbEntry {
    id: number;
    label: string;
    path: string;
    role: string | null;
    notes: string | null;
    addedAt: number;
}

export interface ScanRecord {
    id: number;
    dbEntryId: number;
    startedAt: number;
    finishedAt: number | null;
    status: 'running' | 'ok' | 'error';
    error: string | null;
    trackCount: number | null;
    playlistCount: number | null;
    sizeBytes: number | null;
    schemaVersion: string | null;
    scanJsonPath: string | null;
    scanMdPath: string | null;
    firstSessionAt: number | null;
    lastSessionAt: number | null;
    historylistCount: number | null;
    hmLastModified: number | null;
}

export interface DbEntryWithLastScan extends DbEntry {
    lastScan: ScanRecord | null;
}

let dbInstance: Database.Database | null = null;

function ensureDir(): void {
    if (!fs.existsSync(REGISTRY_DIR)) {
        fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    }
}

function openDb(): Database.Database {
    if (dbInstance) return dbInstance;
    ensureDir();
    const db = new Database(REGISTRY_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    dbInstance = db;
    return db;
}

function ensureSchema(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS db_entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            label       TEXT NOT NULL,
            path        TEXT NOT NULL UNIQUE,
            role        TEXT,
            notes       TEXT,
            added_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scans (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            db_entry_id     INTEGER NOT NULL REFERENCES db_entries(id) ON DELETE CASCADE,
            started_at      INTEGER NOT NULL,
            finished_at     INTEGER,
            status          TEXT NOT NULL,
            error           TEXT,
            track_count     INTEGER,
            playlist_count  INTEGER,
            size_bytes      INTEGER,
            schema_version  TEXT,
            scan_json_path  TEXT,
            scan_md_path    TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_scans_db_entry_id ON scans(db_entry_id);
        CREATE INDEX IF NOT EXISTS idx_scans_started_at  ON scans(started_at);
    `);

    // Idempotente Spalten-Migrationen (ALTER TABLE ADD COLUMN ist in SQLite sicher,
    // muss aber nur einmal laufen — deshalb PRAGMA-Check).
    const cols = db.prepare('PRAGMA table_info(scans)').all() as { name: string }[];
    const existing = new Set(cols.map(c => c.name));
    if (!existing.has('first_session_at')) {
        db.exec('ALTER TABLE scans ADD COLUMN first_session_at INTEGER');
    }
    if (!existing.has('last_session_at')) {
        db.exec('ALTER TABLE scans ADD COLUMN last_session_at INTEGER');
    }
    if (!existing.has('historylist_count')) {
        db.exec('ALTER TABLE scans ADD COLUMN historylist_count INTEGER');
    }
    if (!existing.has('hm_last_modified')) {
        db.exec('ALTER TABLE scans ADD COLUMN hm_last_modified INTEGER');
    }
}

function rowToEntry(row: any): DbEntry {
    return {
        id: row.id,
        label: row.label,
        path: row.path,
        role: row.role ?? null,
        notes: row.notes ?? null,
        addedAt: row.added_at,
    };
}

function rowToScan(row: any): ScanRecord {
    return {
        id: row.id,
        dbEntryId: row.db_entry_id,
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? null,
        status: row.status,
        error: row.error ?? null,
        trackCount: row.track_count ?? null,
        playlistCount: row.playlist_count ?? null,
        sizeBytes: row.size_bytes ?? null,
        schemaVersion: row.schema_version ?? null,
        scanJsonPath: row.scan_json_path ?? null,
        scanMdPath: row.scan_md_path ?? null,
        firstSessionAt: row.first_session_at ?? null,
        lastSessionAt: row.last_session_at ?? null,
        historylistCount: row.historylist_count ?? null,
        hmLastModified: row.hm_last_modified ?? null,
    };
}

export function listEntries(): DbEntryWithLastScan[] {
    const db = openDb();
    const entries = db.prepare('SELECT * FROM db_entries ORDER BY added_at DESC').all() as any[];
    const lastScanStmt = db.prepare(
        'SELECT * FROM scans WHERE db_entry_id = ? ORDER BY started_at DESC LIMIT 1'
    );
    return entries.map(row => {
        const scanRow = lastScanStmt.get(row.id) as any;
        return {
            ...rowToEntry(row),
            lastScan: scanRow ? rowToScan(scanRow) : null,
        };
    });
}

export function getEntry(id: number): DbEntryWithLastScan | null {
    const db = openDb();
    const row = db.prepare('SELECT * FROM db_entries WHERE id = ?').get(id) as any;
    if (!row) return null;
    const scanRow = db
        .prepare('SELECT * FROM scans WHERE db_entry_id = ? ORDER BY started_at DESC LIMIT 1')
        .get(id) as any;
    return {
        ...rowToEntry(row),
        lastScan: scanRow ? rowToScan(scanRow) : null,
    };
}

export function addEntry(input: {
    label: string;
    path: string;
    role?: string | null;
    notes?: string | null;
}): DbEntry {
    const db = openDb();
    const now = Math.floor(Date.now() / 1000);
    const result = db
        .prepare(
            'INSERT INTO db_entries (label, path, role, notes, added_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(input.label, input.path, input.role ?? null, input.notes ?? null, now);
    return {
        id: Number(result.lastInsertRowid),
        label: input.label,
        path: input.path,
        role: input.role ?? null,
        notes: input.notes ?? null,
        addedAt: now,
    };
}

export function deleteEntry(id: number): boolean {
    const db = openDb();
    const result = db.prepare('DELETE FROM db_entries WHERE id = ?').run(id);
    return result.changes > 0;
}

export function updateEntry(
    id: number,
    patch: { label?: string; role?: string | null; notes?: string | null }
): boolean {
    const db = openDb();
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.label !== undefined) {
        sets.push('label = ?');
        values.push(patch.label);
    }
    if (patch.role !== undefined) {
        sets.push('role = ?');
        values.push(patch.role);
    }
    if (patch.notes !== undefined) {
        sets.push('notes = ?');
        values.push(patch.notes);
    }
    if (sets.length === 0) return false;
    values.push(id);
    const result = db.prepare(`UPDATE db_entries SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
}

export function startScan(dbEntryId: number): number {
    const db = openDb();
    const now = Math.floor(Date.now() / 1000);
    const result = db
        .prepare(
            'INSERT INTO scans (db_entry_id, started_at, status) VALUES (?, ?, ?)'
        )
        .run(dbEntryId, now, 'running');
    return Number(result.lastInsertRowid);
}

export function completeScan(
    scanId: number,
    data: {
        trackCount: number;
        playlistCount: number;
        sizeBytes: number;
        schemaVersion: string | null;
        scanJsonPath: string | null;
        scanMdPath: string | null;
        firstSessionAt: number | null;
        lastSessionAt: number | null;
        historylistCount: number | null;
        hmLastModified: number | null;
    }
): void {
    const db = openDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
        `UPDATE scans SET
            finished_at = ?, status = 'ok',
            track_count = ?, playlist_count = ?, size_bytes = ?, schema_version = ?,
            scan_json_path = ?, scan_md_path = ?,
            first_session_at = ?, last_session_at = ?,
            historylist_count = ?, hm_last_modified = ?
         WHERE id = ?`
    ).run(
        now,
        data.trackCount,
        data.playlistCount,
        data.sizeBytes,
        data.schemaVersion,
        data.scanJsonPath,
        data.scanMdPath,
        data.firstSessionAt,
        data.lastSessionAt,
        data.historylistCount,
        data.hmLastModified,
        scanId
    );
}

export function failScan(scanId: number, error: string): void {
    const db = openDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
        `UPDATE scans SET finished_at = ?, status = 'error', error = ? WHERE id = ?`
    ).run(now, error, scanId);
}

export function listScans(dbEntryId: number, limit = 20): ScanRecord[] {
    const db = openDb();
    const rows = db
        .prepare('SELECT * FROM scans WHERE db_entry_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(dbEntryId, limit) as any[];
    return rows.map(rowToScan);
}

export function getRegistryDbPath(): string {
    return REGISTRY_DB_PATH;
}
