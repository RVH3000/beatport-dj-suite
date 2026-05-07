import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const DEFAULT_SQLITE_BIN = "/usr/bin/sqlite3";

export class SqliteUnavailableError extends Error {
  constructor(binPath) {
    super(`sqlite3-Binary nicht gefunden: ${binPath}`);
    this.name = "SqliteUnavailableError";
    this.binPath = binPath;
  }
}

export class SqliteQueryError extends Error {
  constructor(message, { stderr, code } = {}) {
    super(message);
    this.name = "SqliteQueryError";
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * Führt eine SELECT-Query als JSON-Array aus. Read-only — die Funktion
 * setzt explizit -readonly und SET PRAGMA query_only = 1, damit ein versehentliches
 * INSERT/UPDATE/DELETE im SQL-String von SQLite abgewiesen wird.
 *
 * @param {string} dbPath — Pfad zur .db-Datei
 * @param {string} sql — SELECT-Statement
 * @param {object} opts
 * @param {string} [opts.binPath] — Override für sqlite3-Pfad
 * @param {number} [opts.timeoutMs=15000] — Hard-Timeout
 * @returns {Promise<Array<object>>} Parsed JSON rows
 */
export async function querySelect(dbPath, sql, { binPath = DEFAULT_SQLITE_BIN, timeoutMs = 15000 } = {}) {
  if (!existsSync(binPath)) throw new SqliteUnavailableError(binPath);
  if (!dbPath) throw new Error("querySelect: dbPath erforderlich");
  if (typeof sql !== "string" || !sql.trim()) throw new Error("querySelect: sql erforderlich");

  const args = ["-readonly", "-json", dbPath, "PRAGMA query_only = 1; " + sql];
  return runCli(binPath, args, { timeoutMs });
}

/**
 * Liefert einzelne Zeile (oder null) aus einer SELECT-Query.
 */
export async function querySelectOne(dbPath, sql, opts) {
  const rows = await querySelect(dbPath, sql, opts);
  return rows[0] || null;
}

/**
 * Führt eine .schema-Inspektion aus. Read-only.
 */
export async function listTables(dbPath, opts = {}) {
  const rows = await querySelect(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    opts
  );
  return rows.map((r) => r.name);
}

function runCli(binPath, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new SqliteQueryError(`sqlite3-Timeout nach ${timeoutMs}ms`, { stderr, code: "TIMEOUT" }));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new SqliteQueryError(err.message, { stderr }));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new SqliteQueryError(`sqlite3 exit ${code}: ${stderr.trim()}`, { stderr, code }));
      }
      const trimmed = stdout.trim();
      if (!trimmed) return resolve([]);
      try {
        const parsed = JSON.parse(trimmed);
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch (err) {
        reject(new SqliteQueryError(`Ungültiger JSON-Output von sqlite3: ${err.message}`, { stderr: trimmed }));
      }
    });
  });
}
