import fs from "node:fs/promises";
import path from "node:path";

/**
 * Schreibt Inhalt atomar auf Disk: erst .tmp schreiben, dann fs.rename.
 * Verhindert halbgeschriebene Dateien bei Crash zwischen open() und close().
 */
export async function writeFileAtomic(filePath, data, encoding = "utf8") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, encoding);
  await fs.rename(tmp, filePath);
  return filePath;
}

/**
 * Convenience-Wrapper: serialisiert ein Objekt als JSON (2-space indent)
 * und schreibt es atomar.
 */
export async function writeJsonAtomic(filePath, data) {
  return writeFileAtomic(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Liest eine Datei als Text. Liefert null wenn Datei nicht existiert.
 * Wirft bei anderen Fehlern (Permissions, etc.).
 */
export async function readTextOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Liest eine JSON-Datei. Liefert null wenn Datei nicht existiert.
 * Wirft bei korruptem JSON (Aufrufer entscheidet ob Default).
 */
export async function readJsonOptional(filePath) {
  const raw = await readTextOptional(filePath);
  return raw === null ? null : JSON.parse(raw);
}
