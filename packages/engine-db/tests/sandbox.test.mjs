import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ENGINE_DB_FILES,
  EngineLibraryNotFoundError,
  isEngineLibrary,
  listEngineDbFiles,
  copyLibraryToSandbox
} from "../src/sandbox.mjs";

function tmpDir() {
  return path.join(os.tmpdir(), `bpdjs-edb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function makeFakeLibrary({ files = ["m.db", "hm.db"], extras = [] } = {}) {
  const dir = tmpDir();
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) await fs.writeFile(path.join(dir, f), "fake-db", "utf8");
  for (const f of extras) await fs.writeFile(path.join(dir, f), "extra", "utf8");
  return dir;
}

test("ENGINE_DB_FILES enthält die erwarteten 7 DBs", () => {
  for (const expected of ["m.db", "hm.db", "stm.db", "sm.db", "rbm.db", "itm.db", "trm.db"]) {
    assert.ok(ENGINE_DB_FILES.includes(expected), `${expected} fehlt`);
  }
});

test("isEngineLibrary: true bei m.db, false sonst", async () => {
  const lib = await makeFakeLibrary({ files: ["m.db"] });
  assert.equal(await isEngineLibrary(lib), true);
  await fs.rm(lib, { recursive: true, force: true });

  const noLib = await makeFakeLibrary({ files: ["other.db"] });
  assert.equal(await isEngineLibrary(noLib), false);
  await fs.rm(noLib, { recursive: true, force: true });

  assert.equal(await isEngineLibrary("/nonexistent/totally/not/here"), false);
});

test("listEngineDbFiles findet bekannte DBs, ignoriert fremde Dateien", async () => {
  const lib = await makeFakeLibrary({
    files: ["m.db", "hm.db", "stm.db"],
    extras: ["irrelevant.txt", "playlist.xml"]
  });
  const result = await listEngineDbFiles(lib);
  assert.equal(Object.keys(result).length, 3);
  assert.ok(result["m.db"]);
  assert.ok(result["hm.db"]);
  assert.ok(result["stm.db"]);
  assert.equal(result["irrelevant.txt"], undefined);
  await fs.rm(lib, { recursive: true, force: true });
});

test("copyLibraryToSandbox kopiert kompletten Ordner inkl. fremder Dateien", async () => {
  const lib = await makeFakeLibrary({
    files: ["m.db", "hm.db"],
    extras: ["fremd.txt"]
  });
  const sandbox = tmpDir();
  const copied = await copyLibraryToSandbox(lib, sandbox);
  assert.equal(Object.keys(copied).length, 2);
  // Fremde Datei sollte mitkopiert werden bei Voll-Variante
  const sandboxFiles = await fs.readdir(sandbox);
  assert.ok(sandboxFiles.includes("fremd.txt"));
  await fs.rm(lib, { recursive: true, force: true });
  await fs.rm(sandbox, { recursive: true, force: true });
});

test("copyLibraryToSandbox onlyDbFiles: nur die DBs, ohne fremde Dateien", async () => {
  const lib = await makeFakeLibrary({
    files: ["m.db", "hm.db", "stm.db"],
    extras: ["fremd.txt", "log.json"]
  });
  const sandbox = tmpDir();
  const copied = await copyLibraryToSandbox(lib, sandbox, { onlyDbFiles: true });
  assert.equal(Object.keys(copied).length, 3);
  const sandboxFiles = await fs.readdir(sandbox);
  assert.equal(sandboxFiles.includes("fremd.txt"), false);
  assert.equal(sandboxFiles.includes("log.json"), false);
  await fs.rm(lib, { recursive: true, force: true });
  await fs.rm(sandbox, { recursive: true, force: true });
});

test("copyLibraryToSandbox wirft EngineLibraryNotFoundError wenn m.db fehlt", async () => {
  const fake = await makeFakeLibrary({ files: ["other.db"] });
  await assert.rejects(
    () => copyLibraryToSandbox(fake, tmpDir()),
    EngineLibraryNotFoundError
  );
  await fs.rm(fake, { recursive: true, force: true });
});
