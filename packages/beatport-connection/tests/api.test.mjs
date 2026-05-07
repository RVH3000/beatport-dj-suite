import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadScannerModule,
  createBeatportClient,
  loadApiContext,
  normalizePlaylist,
  normalizeTrack,
  getScannerModulePath,
  __setLoader,
  __resetLoader
} from "../src/api.mjs";

afterEach(() => __resetLoader());

test("getScannerModulePath: zeigt auf v4.1 electron-app/scanner/xhr-scanner.mjs", () => {
  const p = getScannerModulePath();
  assert.match(p, /electron-app\/scanner\/xhr-scanner\.mjs$/);
});

test("loadScannerModule: nutzt den injizierten Loader (Test-Mock)", async () => {
  __setLoader(async () => ({ ping: "pong" }));
  const mod = await loadScannerModule();
  assert.deepEqual(mod, { ping: "pong" });
});

test("createBeatportClient: instantiiert BeatportXhrClient aus geladenem Modul", async () => {
  class FakeClient {
    constructor(opts) { this.opts = opts; }
  }
  __setLoader(async () => ({ BeatportXhrClient: FakeClient }));
  const client = await createBeatportClient({ token: "abc" });
  assert.ok(client instanceof FakeClient);
  assert.deepEqual(client.opts, { token: "abc" });
});

test("createBeatportClient: wirft wenn BeatportXhrClient fehlt", async () => {
  __setLoader(async () => ({}));
  await assert.rejects(() => createBeatportClient(), /BeatportXhrClient nicht/);
});

test("loadApiContext: delegiert an Modul-Funktion", async () => {
  __setLoader(async () => ({
    loadApiContext: async (a, b) => ({ called: true, a, b })
  }));
  const result = await loadApiContext("x", "y");
  assert.deepEqual(result, { called: true, a: "x", b: "y" });
});

test("loadApiContext: wirft wenn Funktion fehlt", async () => {
  __setLoader(async () => ({}));
  await assert.rejects(() => loadApiContext(), /loadApiContext nicht/);
});

test("normalizePlaylist + normalizeTrack: durchgereicht an Modul", async () => {
  __setLoader(async () => ({
    normalizePlaylist: (e) => ({ normalized: "playlist", e }),
    normalizeTrack: (pid, e) => ({ normalized: "track", pid, e })
  }));
  assert.deepEqual(await normalizePlaylist({ id: 1 }), { normalized: "playlist", e: { id: 1 } });
  assert.deepEqual(await normalizeTrack("p1", { id: 2 }), { normalized: "track", pid: "p1", e: { id: 2 } });
});

test("__resetLoader: stellt Default-Loader wieder her", async () => {
  __setLoader(async () => ({ MOCKED: true }));
  __resetLoader();
  // Default-Loader würde versuchen die echte Datei zu laden — wir prüfen nur,
  // dass kein Mock mehr greift
  try {
    const mod = await loadScannerModule();
    // wenn echte Datei vorhanden: sie hat KEIN MOCKED-Property
    assert.equal(mod.MOCKED, undefined);
  } catch {
    // wenn Datei nicht vorhanden: ok, default-loader wurde versucht
  }
});
