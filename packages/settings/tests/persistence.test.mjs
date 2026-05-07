import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeJsonAtomic, readJsonOptional, fileExists } from "../src/persistence.mjs";

function tmpFile(suffix = "json") {
  return path.join(os.tmpdir(), `bpdjs-set-${Date.now()}-${Math.random().toString(36).slice(2)}.${suffix}`);
}

test("writeJsonAtomic + readJsonOptional Roundtrip", async () => {
  const file = tmpFile();
  await writeJsonAtomic(file, { a: 1, b: [2, 3], c: { d: "x" } });
  const data = await readJsonOptional(file);
  assert.deepEqual(data, { a: 1, b: [2, 3], c: { d: "x" } });
  await fs.unlink(file);
});

test("writeJsonAtomic legt Verzeichnis automatisch an", async () => {
  const dir = path.join(os.tmpdir(), `bpdjs-set-deep-${Date.now()}`, "nested", "more");
  const file = path.join(dir, "config.json");
  await writeJsonAtomic(file, { ok: true });
  const data = await readJsonOptional(file);
  assert.deepEqual(data, { ok: true });
  await fs.rm(path.join(os.tmpdir(), `bpdjs-set-deep-${Date.now()}`).split("/").slice(0, -2).join("/") || dir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

test("readJsonOptional liefert null bei nicht existierender Datei", async () => {
  const data = await readJsonOptional(tmpFile());
  assert.equal(data, null);
});

test("readJsonOptional wirft bei korruptem JSON", async () => {
  const file = tmpFile();
  await fs.writeFile(file, "{ this is not json", "utf8");
  await assert.rejects(() => readJsonOptional(file));
  await fs.unlink(file);
});

test("fileExists liefert true/false korrekt", async () => {
  const file = tmpFile();
  assert.equal(await fileExists(file), false);
  await fs.writeFile(file, "x", "utf8");
  assert.equal(await fileExists(file), true);
  await fs.unlink(file);
});
