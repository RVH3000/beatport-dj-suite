import path from 'path';
import os from 'os';
import fs from 'fs';

const DEFAULT_DB_DIR = path.join(os.homedir(), 'Music', 'Engine Library', 'Database2');
const CONFIG_DIR = path.join(os.homedir(), '.engine-dj-manager');
const ACTIVE_CONFIG_PATH = path.join(CONFIG_DIR, 'active.json');

export type OverrideSource = 'config' | 'env' | 'default';

interface ActiveConfig {
    dbDir: string;
    setAt?: number;
}

function readActiveConfig(): ActiveConfig | null {
    try {
        if (!fs.existsSync(ACTIVE_CONFIG_PATH)) return null;
        const raw = fs.readFileSync(ACTIVE_CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed?.dbDir === 'string' && parsed.dbDir.trim().length > 0) {
            return { dbDir: parsed.dbDir, setAt: parsed.setAt };
        }
    } catch {
        // ignore corrupted config
    }
    return null;
}

export function getActiveConfigPath(): string {
    return ACTIVE_CONFIG_PATH;
}

export function getConfigDir(): string {
    return CONFIG_DIR;
}

export function getDbDir(): string {
    const cfg = readActiveConfig();
    if (cfg) return cfg.dbDir;
    if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
    return DEFAULT_DB_DIR;
}

export function getEngineDbPath(): string {
    return path.join(getDbDir(), 'm.db');
}

export function getHistoryDbPath(): string {
    return path.join(getDbDir(), 'hm.db');
}

export function isSandbox(): boolean {
    return getDbDir().includes('SANDBOX');
}

export function isOverride(): boolean {
    return overrideSource() !== 'default';
}

export function overrideSource(): OverrideSource {
    if (readActiveConfig()) return 'config';
    if (process.env.DATABASE_PATH) return 'env';
    return 'default';
}
