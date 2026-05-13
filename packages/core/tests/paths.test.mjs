import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";

import {
  deriveAppBundlePath,
  createBundledPathResolver,
  createBuildIdComputer,
} from "../src/paths.mjs";

test("deriveAppBundlePath: erkennt .app/Contents/MacOS/-Marker", () => {
  const result = deriveAppBundlePath(
    "/Applications/Beatport DJ Suite 4.2.13.app/Contents/MacOS/Beatport DJ Suite",
  );
  assert.equal(result, "/Applications/Beatport DJ Suite 4.2.13.app");
});

test("deriveAppBundlePath: ohne Marker → dirname-Fallback", () => {
  const result = deriveAppBundlePath("/usr/local/bin/electron");
  assert.equal(result, "/usr/local/bin");
});

test("createBundledPathResolver: packaged → resourcesPath/app.asar.unpacked", () => {
  const resolve = createBundledPathResolver({
    isPackaged: true,
    resourcesPath: "/path/to/Resources",
    repoRoot: "/dev/root",
  });
  assert.equal(
    resolve("scripts/foo.py"),
    "/path/to/Resources/app.asar.unpacked/scripts/foo.py",
  );
});

test("createBundledPathResolver: dev (nicht packaged) → repoRoot", () => {
  const resolve = createBundledPathResolver({
    isPackaged: false,
    resourcesPath: "/ignored",
    repoRoot: "/dev/root",
  });
  assert.equal(resolve("scripts/foo.py"), "/dev/root/scripts/foo.py");
});

test("createBuildIdComputer: liefert 12-Hex-Char SHA-256 wenn appPath existiert", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "paths-test-"));
  const appPath = path.join(tmp, "fake-app");
  writeFileSync(appPath, "hallo welt");
  try {
    const compute = createBuildIdComputer({
      resourcesPath: "/no/such/dir",
      appPath,
    });
    const id = await compute();
    assert.match(id, /^[0-9a-f]{12}$/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("createBuildIdComputer: Fallback wenn weder app.asar noch appPath existieren", async () => {
  const compute = createBuildIdComputer({
    resourcesPath: "/no/such/dir",
    appPath: "/also/no/such/file",
    fallback: "test-fallback",
  });
  const id = await compute();
  assert.equal(id, "test-fallback");
});

test("createBuildIdComputer: Default-Fallback ist 'dev-build'", async () => {
  const compute = createBuildIdComputer({
    resourcesPath: "/no/such/dir",
    appPath: "/also/no/such/file",
  });
  const id = await compute();
  assert.equal(id, "dev-build");
});
