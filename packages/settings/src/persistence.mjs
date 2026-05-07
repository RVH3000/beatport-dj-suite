import fs from "node:fs/promises";
import path from "node:path";

/**
 * Schreibt JSON atomar auf Disk: erst .tmp schreiben, dann rename.
 * Verhindert halbgeschriebene Dateien bei Crash.
 *
 * Stub-Implementierung — wird in Phase 4 durch @bpdjs/file-manager ersetzt.
 */
export async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
  return filePath;
}

/**
 * Liest JSON von Disk. Liefert null wenn Datei nicht existiert.
 * Wirft bei korruptem JSON — der Aufrufer entscheidet, ob Default zurückgesetzt wird.
 */
export async function readJsonOptional(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
