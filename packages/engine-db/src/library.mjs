import path from "node:path";
import { isEngineLibrary, listEngineDbFiles, EngineLibraryNotFoundError } from "./sandbox.mjs";
import { querySelect, querySelectOne, listTables } from "./sqlite-cli.mjs";
import { logger as defaultLogger } from "@bpdjs/core";

/**
 * Repräsentiert eine Engine-DJ-Library (Ordner mit m.db, hm.db, ...).
 * Phase 5: read-only Foundation. Schreibzugriff kommt in einer späteren Phase
 * mit zusätzlichen Sandbox-Garantien.
 */
export class EngineLibrary {
  constructor({ rootDir, logger = defaultLogger } = {}) {
    if (!rootDir) throw new Error("EngineLibrary: rootDir erforderlich");
    this._rootDir = rootDir;
    this._logger = logger.tag ? logger.tag("engine-db") : logger;
    this._dbFiles = null;
  }

  get rootDir() { return this._rootDir; }

  async assertExists() {
    if (!(await isEngineLibrary(this._rootDir))) {
      throw new EngineLibraryNotFoundError(this._rootDir);
    }
    return this;
  }

  async dbFiles() {
    if (this._dbFiles) return this._dbFiles;
    this._dbFiles = await listEngineDbFiles(this._rootDir);
    return this._dbFiles;
  }

  pathOf(dbName) {
    return path.join(this._rootDir, dbName);
  }

  /**
   * Read-only SELECT auf einer der Library-DBs (m.db, hm.db, ...).
   */
  async select(dbName, sql, opts = {}) {
    const dbPath = this.pathOf(dbName);
    return querySelect(dbPath, sql, opts);
  }

  async selectOne(dbName, sql, opts = {}) {
    return querySelectOne(this.pathOf(dbName), sql, opts);
  }

  async tables(dbName) {
    return listTables(this.pathOf(dbName));
  }
}

export function openLibrary(rootDir, opts = {}) {
  return new EngineLibrary({ rootDir, ...opts });
}
