import path from "node:path";
import fs from "node:fs/promises";
import { ensureDir, dirExists, copyFile, listFiles } from "@bpdjs/file-manager";

export const ENGINE_DB_FILES = ["m.db", "hm.db", "stm.db", "sm.db", "rbm.db", "itm.db", "trm.db"];

export class EngineLibraryNotFoundError extends Error {
  constructor(dirPath) {
    super(`Kein Engine-Library-Ordner unter ${dirPath} (m.db nicht gefunden)`);
    this.name = "EngineLibraryNotFoundError";
    this.dirPath = dirPath;
  }
}

/**
 * Prüft, ob ein Verzeichnis wie eine Engine-Library aussieht.
 * Minimal-Kriterium: m.db existiert.
 */
export async function isEngineLibrary(dirPath) {
  if (!(await dirExists(dirPath))) return false;
  try {
    const stat = await fs.stat(path.join(dirPath, "m.db"));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Listet welche der bekannten Engine-DB-Dateien im Verzeichnis existieren.
 * Liefert Map { fileName → fullPath }.
 */
export async function listEngineDbFiles(dirPath) {
  if (!(await dirExists(dirPath))) return {};
  const files = await listFiles(dirPath);
  const present = {};
  for (const name of ENGINE_DB_FILES) {
    const full = path.join(dirPath, name);
    if (files.includes(full)) present[name] = full;
  }
  return present;
}

/**
 * Kopiert die KOMPLETTE Engine-Library in ein Sandbox-Verzeichnis.
 * Wichtig: alle DB-Dateien werden zusammen kopiert, weil sie sich
 * gegenseitig referenzieren (siehe CLAUDE.md Sandbox-Regel).
 *
 * Liefert die kopierten DB-Dateien zurück.
 */
export async function copyLibraryToSandbox(srcDir, sandboxDir, { onlyDbFiles = false } = {}) {
  if (!(await isEngineLibrary(srcDir))) throw new EngineLibraryNotFoundError(srcDir);
  await ensureDir(sandboxDir);

  if (onlyDbFiles) {
    // Light-Variante: nur die bekannten DB-Dateien kopieren (schneller)
    const present = await listEngineDbFiles(srcDir);
    const copied = {};
    for (const [name, srcFull] of Object.entries(present)) {
      const dst = path.join(sandboxDir, name);
      await copyFile(srcFull, dst);
      copied[name] = dst;
    }
    return copied;
  }

  // Voll-Variante: alle Dateien rekursiv kopieren (sicher, weil DBs sich referenzieren)
  await fs.cp(srcDir, sandboxDir, { recursive: true, force: true });
  return listEngineDbFiles(sandboxDir);
}
