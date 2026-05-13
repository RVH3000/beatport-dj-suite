import Database from 'better-sqlite3';

export interface SchemaVersion {
    major: number;
    minor: number;
    patch: number;
}

export interface DbHealth {
    path: string;
    exists: boolean;
    version?: SchemaVersion;
    error?: string;
}

export function getDbVersion(path: string): SchemaVersion | undefined {
    try {
        const db = new Database(path, { readonly: true });
        const version = db.prepare('SELECT schemaVersionMajor, schemaVersionMinor, schemaVersionPatch FROM Information').get() as any;
        db.close();

        if (version) {
            return {
                major: version.schemaVersionMajor,
                minor: version.schemaVersionMinor,
                patch: version.schemaVersionPatch
            };
        }
    } catch (e) {
        // Table might not exist in all DBs (e.g. itm.db might be different)
        return undefined;
    }
    return undefined;
}
