import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EngineLibrary, openLibrary } from "../src/library.mjs";
import { EngineLibraryNotFoundError } from "../src/sandbox.mjs";
import { createLogger } from "@bpdjs/core";

function tmpDir() {
  return path.join(os.tmpdir(), `bpdjs-edb-lib-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function makeFakeLibrary({ files = ["m.db", "hm.db"] } = {}) {
  const dir = tmpDir();
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) await fs.writeFile(path.join(dir, f), "fake-db", "utf8");
  return dir;
}

test("EngineLibrary: wirft ohne rootDir", () => {
  assert.throws(() => new EngineLibrary({}), /rootDir erforderlich/);
});

test("EngineLibrary.assertExists: erfolgreich bei m.db", async () => {
  const dir = await makeFakeLibrary();
  const lib = openLibrary(dir, { logger: createLogger({ level: "silent" }) });
  await lib.assertExists();
  await fs.rm(dir, { recursive: true, force: true });
});

test("EngineLibrary.assertExists: wirft EngineLibraryNotFoundError ohne m.db", async () => {
  const dir = await makeFakeLibrary({ files: ["other.db"] });
  const lib = openLibrary(dir, { logger: createLogger({ level: "silent" }) });
  await assert.rejects(() => lib.assertExists(), EngineLibraryNotFoundError);
  await fs.rm(dir, { recursive: true, force: true });
});

test("EngineLibrary.dbFiles: liefert alle vorhandenen DB-Dateien", async () => {
  const dir = await makeFakeLibrary({ files: ["m.db", "hm.db", "stm.db"] });
  const lib = openLibrary(dir, { logger: createLogger({ level: "silent" }) });
  const files = await lib.dbFiles();
  assert.equal(Object.keys(files).length, 3);
  assert.ok(files["m.db"].endsWith("m.db"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("EngineLibrary.pathOf: kombiniert rootDir + dbName", async () => {
  const dir = await makeFakeLibrary();
  const lib = openLibrary(dir, { logger: createLogger({ level: "silent" }) });
  assert.equal(lib.pathOf("hm.db"), path.join(dir, "hm.db"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("openLibrary: liefert EngineLibrary-Instanz", async () => {
  const dir = await makeFakeLibrary();
  const lib = openLibrary(dir, { logger: createLogger({ level: "silent" }) });
  assert.ok(lib instanceof EngineLibrary);
  await fs.rm(dir, { recursive: true, force: true });
});
