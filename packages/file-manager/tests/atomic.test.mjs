import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  writeFileAtomic,
  writeJsonAtomic,
  readTextOptional,
  readJsonOptional
} from "../src/atomic.mjs";

function tmp(suffix = "txt") {
  return path.join(os.tmpdir(), `bpdjs-fm-${Date.now()}-${Math.random().toString(36).slice(2)}.${suffix}`);
}

test("writeFileAtomic schreibt Text und liefert Pfad zurück", async () => {
  const file = tmp();
  const result = await writeFileAtomic(file, "hello world");
  assert.equal(result, file);
  assert.equal(await fs.readFile(file, "utf8"), "hello world");
  await fs.unlink(file).catch(() => {});
});

test("writeFileAtomic legt fehlende Verzeichnisse an", async () => {
  const dir = path.join(os.tmpdir(), `bpdjs-fm-${Date.now()}`, "deep", "nested");
  const file = path.join(dir, "out.txt");
  await writeFileAtomic(file, "x");
  assert.equal(await fs.readFile(file, "utf8"), "x");
  await fs.rm(path.join(os.tmpdir(), `bpdjs-fm-${Date.now()}`).replace(Date.now(), ""), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.dirname(path.dirname(dir)), { recursive: true, force: true }).catch(() => {});
});

test("writeFileAtomic hinterlässt keine .tmp-Datei nach Erfolg", async () => {
  const file = tmp();
  await writeFileAtomic(file, "ok");
  let tmpExists = true;
  try { await fs.access(`${file}.tmp`); } catch { tmpExists = false; }
  assert.equal(tmpExists, false);
  await fs.unlink(file).catch(() => {});
});

test("writeJsonAtomic schreibt formatiertes JSON", async () => {
  const file = tmp("json");
  await writeJsonAtomic(file, { a: 1, b: { c: 2 } });
  const raw = await fs.readFile(file, "utf8");
  assert.equal(raw, '{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
  await fs.unlink(file).catch(() => {});
});

test("readTextOptional liefert null bei fehlender Datei", async () => {
  const result = await readTextOptional(tmp());
  assert.equal(result, null);
});

test("readTextOptional liefert Text bei vorhandener Datei", async () => {
  const file = tmp();
  await fs.writeFile(file, "content", "utf8");
  assert.equal(await readTextOptional(file), "content");
  await fs.unlink(file).catch(() => {});
});

test("readJsonOptional roundtripped Objekt", async () => {
  const file = tmp("json");
  await writeJsonAtomic(file, { x: [1, 2], y: "z" });
  assert.deepEqual(await readJsonOptional(file), { x: [1, 2], y: "z" });
  await fs.unlink(file).catch(() => {});
});

test("readJsonOptional liefert null bei fehlender Datei", async () => {
  assert.equal(await readJsonOptional(tmp("json")), null);
});

test("readJsonOptional wirft bei korruptem JSON", async () => {
  const file = tmp("json");
  await fs.writeFile(file, "{ kaputt", "utf8");
  await assert.rejects(() => readJsonOptional(file));
  await fs.unlink(file).catch(() => {});
});
