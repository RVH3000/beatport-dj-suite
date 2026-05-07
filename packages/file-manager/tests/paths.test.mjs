import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Paths, createPaths } from "../src/paths.mjs";

function makeMockApp({ paths = {}, isPackaged = false } = {}) {
  return {
    isPackaged,
    getPath(name) {
      if (paths[name]) return paths[name];
      throw new Error(`Mock-App: unbekannter Pfad ${name}`);
    }
  };
}

test("Paths: wirft ohne app", () => {
  assert.throws(() => new Paths({ repoRoot: "/repo" }), /app\.getPath/);
});

test("Paths: wirft ohne repoRoot", () => {
  assert.throws(() => new Paths({ app: makeMockApp() }), /repoRoot/);
});

test("Paths: userData/home/temp delegieren an app.getPath", () => {
  const app = makeMockApp({
    paths: { userData: "/u", home: "/h", temp: "/t", appData: "/a", downloads: "/d", documents: "/doc" }
  });
  const p = createPaths({ app, repoRoot: "/repo" });
  assert.equal(p.userData(), "/u");
  assert.equal(p.home(), "/h");
  assert.equal(p.temp(), "/t");
  assert.equal(p.appData(), "/a");
  assert.equal(p.downloads(), "/d");
  assert.equal(p.documents(), "/doc");
});

test("Paths: liveStatus liegt in userData", () => {
  const app = makeMockApp({ paths: { userData: "/myuserdata" } });
  const p = createPaths({ app, repoRoot: "/repo" });
  assert.equal(p.liveStatus(), path.join("/myuserdata", "live-status.json"));
});

test("Paths: inUserData kombiniert Segmente", () => {
  const app = makeMockApp({ paths: { userData: "/u" } });
  const p = createPaths({ app, repoRoot: "/repo" });
  assert.equal(p.inUserData("logs", "2026-05-07.log"), path.join("/u", "logs", "2026-05-07.log"));
});

test("Paths: inRepo kombiniert Segmente mit repoRoot", () => {
  const app = makeMockApp();
  const p = createPaths({ app, repoRoot: "/myrepo" });
  assert.equal(p.inRepo("electron-app", "main.mjs"), path.join("/myrepo", "electron-app", "main.mjs"));
});

test("Paths: bundled() im Dev-Mode nutzt repoRoot", () => {
  const app = makeMockApp({ isPackaged: false });
  const p = createPaths({ app, repoRoot: "/repo" });
  assert.equal(p.bundled("assets/icon.png"), path.join("/repo", "assets/icon.png"));
});

test("Paths: bundled() in Production nutzt packagedResourcesPath", () => {
  const app = makeMockApp({ isPackaged: true });
  const p = createPaths({
    app,
    repoRoot: "/repo",
    packagedResourcesPath: "/Applications/MyApp.app/Contents/Resources",
    isPackaged: true
  });
  assert.equal(
    p.bundled("scripts/foo.mjs"),
    path.join("/Applications/MyApp.app/Contents/Resources", "app.asar.unpacked", "scripts/foo.mjs")
  );
});

test("Paths: bundled() ohne packagedResources fällt auf repoRoot zurück (auch isPackaged)", () => {
  const app = makeMockApp({ isPackaged: true });
  const p = createPaths({ app, repoRoot: "/repo", isPackaged: true });
  assert.equal(p.bundled("rel/path"), path.join("/repo", "rel/path"));
});

test("createPaths Factory liefert Paths-Instanz", () => {
  const app = makeMockApp();
  const p = createPaths({ app, repoRoot: "/r" });
  assert.ok(p instanceof Paths);
});
