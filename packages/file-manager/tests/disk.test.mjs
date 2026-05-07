import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensureDir,
  fileExists,
  dirExists,
  removeIfExists,
  listFiles,
  copyFile
} from "../src/disk.mjs";

function tmpDir() {
  return path.join(os.tmpdir(), `bpdjs-fm-disk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("ensureDir legt verschachteltes Verzeichnis an", async () => {
  const dir = path.join(tmpDir(), "a", "b", "c");
  await ensureDir(dir);
  assert.equal(await dirExists(dir), true);
  await fs.rm(path.dirname(path.dirname(dir)), { recursive: true, force: true }).catch(() => {});
});

test("fileExists liefert true/false korrekt", async () => {
  const dir = await ensureDir(tmpDir());
  const file = path.join(dir, "test.txt");
  assert.equal(await fileExists(file), false);
  await fs.writeFile(file, "x", "utf8");
  assert.equal(await fileExists(file), true);
  // Verzeichnis ist KEINE Datei
  assert.equal(await fileExists(dir), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("dirExists liefert true für Verzeichnis, false für Datei", async () => {
  const dir = await ensureDir(tmpDir());
  assert.equal(await dirExists(dir), true);
  const file = path.join(dir, "f.txt");
  await fs.writeFile(file, "x", "utf8");
  assert.equal(await dirExists(file), false);
  assert.equal(await dirExists(path.join(dir, "missing")), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("removeIfExists liefert true wenn entfernt, false wenn nicht da", async () => {
  const dir = await ensureDir(tmpDir());
  const file = path.join(dir, "x.txt");
  await fs.writeFile(file, "y", "utf8");
  assert.equal(await removeIfExists(file), true);
  assert.equal(await fileExists(file), false);
  assert.equal(await removeIfExists(file), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("listFiles liefert nur Dateien (keine Verzeichnisse)", async () => {
  const dir = await ensureDir(tmpDir());
  await fs.writeFile(path.join(dir, "a.txt"), "1", "utf8");
  await fs.writeFile(path.join(dir, "b.json"), "2", "utf8");
  await ensureDir(path.join(dir, "sub"));
  const files = await listFiles(dir);
  assert.equal(files.length, 2);
  assert.ok(files.some((f) => f.endsWith("a.txt")));
  assert.ok(files.some((f) => f.endsWith("b.json")));
  await fs.rm(dir, { recursive: true, force: true });
});

test("listFiles mit suffix filtert", async () => {
  const dir = await ensureDir(tmpDir());
  await fs.writeFile(path.join(dir, "a.txt"), "1", "utf8");
  await fs.writeFile(path.join(dir, "b.json"), "2", "utf8");
  const json = await listFiles(dir, { suffix: ".json" });
  assert.equal(json.length, 1);
  assert.ok(json[0].endsWith("b.json"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("copyFile dupliziert und legt Zielverzeichnis an", async () => {
  const dir = await ensureDir(tmpDir());
  const src = path.join(dir, "src.txt");
  const dst = path.join(dir, "nested", "dst.txt");
  await fs.writeFile(src, "payload", "utf8");
  await copyFile(src, dst);
  assert.equal(await fs.readFile(dst, "utf8"), "payload");
  await fs.rm(dir, { recursive: true, force: true });
});
