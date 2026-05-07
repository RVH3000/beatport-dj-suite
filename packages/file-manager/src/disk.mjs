import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function dirExists(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function removeIfExists(targetPath) {
  try {
    await fs.stat(targetPath);
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
  await fs.rm(targetPath, { recursive: true, force: true });
  return true;
}

export async function listFiles(dirPath, { suffix = null } = {}) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.join(dirPath, e.name));
  return suffix ? files.filter((f) => f.endsWith(suffix)) : files;
}

export async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
  return dest;
}
