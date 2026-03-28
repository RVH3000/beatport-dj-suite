/**
 * xhr-scanner.test.mjs
 * Tests für das xhr-scanner Modul mit Node.js native test runner
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  normalizePlaylist,
  normalizeTrack,
  csvEscape,
  parseArgs,
  DataStore,
  BeatportXhrClient,
  API_BASE,
  PER_PAGE,
  TRACKS_PER_PAGE,
} from "../electron-app/scanner/xhr-scanner.mjs";

// ─── normalizePlaylist Tests ────────────────────────────────────────────────

test("normalizePlaylist: Normalisiert vollständiges API-Objekt korrekt", () => {
  const entry = {
    id: 12345,
    name: "Meine Lieblings-Playliste",
    track_count: 42,
    is_public: true,
    created: "2024-01-15T10:00:00Z",
    updated: "2024-03-28T15:30:00Z",
    image: {
      uri: "https://example.com/image.jpg",
    },
  };

  const result = normalizePlaylist(entry);

  assert.strictEqual(result.id, "12345");
  assert.strictEqual(result.name, "Meine Lieblings-Playliste");
  assert.strictEqual(result.trackCount, 42);
  assert.strictEqual(result.isPublic, true);
  assert.strictEqual(result.createdAt, "2024-01-15T10:00:00Z");
  assert.strictEqual(result.updatedAt, "2024-03-28T15:30:00Z");
  assert.strictEqual(result.imageUrl, "https://example.com/image.jpg");
  assert.strictEqual(result.source, "xhr");
});

test("normalizePlaylist: Setzt source auf 'xhr'", () => {
  const entry = { id: 1, name: "Test" };
  const result = normalizePlaylist(entry);
  assert.strictEqual(result.source, "xhr");
});

test("normalizePlaylist: Handles fehlende Felder (null/undefined)", () => {
  const entry = {
    id: null,
    name: undefined,
    track_count: null,
    is_public: undefined,
    created: null,
    updated: undefined,
    image: null,
  };

  const result = normalizePlaylist(entry);

  assert.strictEqual(result.id, "");
  assert.strictEqual(result.name, "");
  assert.strictEqual(result.trackCount, 0);
  assert.strictEqual(result.isPublic, false);
  assert.strictEqual(result.createdAt, "");
  assert.strictEqual(result.updatedAt, "");
  assert.strictEqual(result.imageUrl, "");
});

test("normalizePlaylist: Konvertiert id zu String", () => {
  const entry = { id: 999, name: "Test" };
  const result = normalizePlaylist(entry);
  assert.strictEqual(typeof result.id, "string");
  assert.strictEqual(result.id, "999");
});

test("normalizePlaylist: Leeres Objekt gibt Standardwerte", () => {
  const result = normalizePlaylist({});
  assert.deepStrictEqual(result, {
    id: "",
    name: "",
    trackCount: 0,
    isPublic: false,
    createdAt: "",
    updatedAt: "",
    imageUrl: "",
    source: "xhr",
  });
});

// ─── normalizeTrack Tests ───────────────────────────────────────────────────

test("normalizeTrack: Normalisiert Track mit verschachteltem track-Objekt", () => {
  const playlistId = "pl-123";
  const entry = {
    track: {
      id: 555,
      name: "Epic Drop",
      mix_name: "Extended Mix",
      artists: [{ name: "Artist A" }, { name: "Artist B" }],
      remixers: [{ name: "Remixer 1" }],
      genre: { name: "House" },
      sub_genres: [{ name: "Deep House" }],
      release: {
        label: { name: "Hypeddit Records" },
      },
      new_release_date: "2024-03-20",
      bpm: 128,
      key: { name: "C Minor" },
      length_ms: 360000,
      isrc: "USICV2401234",
      catalog_number: "CAT-001",
    },
  };

  const result = normalizeTrack(playlistId, entry);

  assert.strictEqual(result.playlistId, "pl-123");
  assert.strictEqual(result.trackId, "555");
  assert.strictEqual(result.title, "Epic Drop");
  assert.strictEqual(result.mixName, "Extended Mix");
  assert.strictEqual(result.artists, "Artist A, Artist B");
  assert.strictEqual(result.remixers, "Remixer 1");
  assert.strictEqual(result.genre, "House");
  assert.strictEqual(result.subGenre, "Deep House");
  assert.strictEqual(result.label, "Hypeddit Records");
  assert.strictEqual(result.releaseDate, "2024-03-20");
  assert.strictEqual(result.bpm, 128);
  assert.strictEqual(result.key, "C Minor");
  assert.strictEqual(result.duration, 360000);
  assert.strictEqual(result.isrc, "USICV2401234");
  assert.strictEqual(result.catalogNumber, "CAT-001");
  assert.strictEqual(result.source, "xhr");
});

test("normalizeTrack: Extrahiert Artists als kommagetrennte Liste", () => {
  const entry = {
    track: {
      id: 1,
      name: "Test",
      artists: [
        { name: "DJ Alice" },
        { name: "DJ Bob" },
        { name: "DJ Charlie" },
      ],
      remixers: [],
    },
  };

  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.artists, "DJ Alice, DJ Bob, DJ Charlie");
});

test("normalizeTrack: Extrahiert Genre aus genre.name", () => {
  const entry = {
    track: {
      id: 1,
      name: "Test",
      genre: { name: "Techno" },
      sub_genres: [],
    },
  };

  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.genre, "Techno");
});

test("normalizeTrack: Extrahiert Label aus release.label.name", () => {
  const entry = {
    track: {
      id: 1,
      name: "Test",
      release: {
        label: { name: "My Label" },
      },
    },
  };

  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.label, "My Label");
});

test("normalizeTrack: Fallback auf track.label.name wenn release nicht vorhanden", () => {
  const entry = {
    track: {
      id: 1,
      name: "Test",
      label: { name: "Direct Label" },
    },
  };

  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.label, "Direct Label");
});

test("normalizeTrack: Fehlende Felder ergeben leere Strings/0", () => {
  const entry = {
    track: {
      id: 1,
      name: "Test",
    },
  };

  const result = normalizeTrack("pl-1", entry);

  assert.strictEqual(result.mixName, "");
  assert.strictEqual(result.artists, "");
  assert.strictEqual(result.remixers, "");
  assert.strictEqual(result.genre, "");
  assert.strictEqual(result.subGenre, "");
  assert.strictEqual(result.label, "");
  assert.strictEqual(result.releaseDate, "");
  assert.strictEqual(result.bpm, 0);
  assert.strictEqual(result.key, "");
  assert.strictEqual(result.duration, 0);
  assert.strictEqual(result.isrc, "");
  assert.strictEqual(result.catalogNumber, "");
});

test("normalizeTrack: Track-Daten direkt (nicht verschachtelt)", () => {
  const entry = {
    id: 100,
    name: "Direct Track",
    artists: [{ name: "Artist C" }],
  };

  const result = normalizeTrack("pl-1", entry);

  assert.strictEqual(result.trackId, "100");
  assert.strictEqual(result.title, "Direct Track");
  assert.strictEqual(result.artists, "Artist C");
});

// ─── csvEscape Tests ────────────────────────────────────────────────────────

test("csvEscape: Normaler String bleibt unverändert", () => {
  const result = csvEscape("Hello World");
  assert.strictEqual(result, "Hello World");
});

test("csvEscape: String mit Komma wird in Anführungszeichen gesetzt", () => {
  const result = csvEscape("Smith, John");
  assert.strictEqual(result, '"Smith, John"');
});

test("csvEscape: Anführungszeichen werden verdoppelt", () => {
  const result = csvEscape('He said "Hello"');
  assert.strictEqual(result, '"He said ""Hello"""');
});

test("csvEscape: Newline wird escaped", () => {
  const result = csvEscape("Line1\nLine2");
  assert.strictEqual(result, '"Line1\nLine2"');
});

test("csvEscape: Kombinierter Fall - Komma, Anführungszeichen und Newline", () => {
  const result = csvEscape('Name: "John", City\nAddress');
  assert.strictEqual(result, '"Name: ""John"", City\nAddress"');
});

test("csvEscape: null/undefined wird zu leerer String", () => {
  assert.strictEqual(csvEscape(null), "");
  assert.strictEqual(csvEscape(undefined), "");
});

test("csvEscape: Zahlen werden konvertiert", () => {
  const result = csvEscape(12345);
  assert.strictEqual(result, "12345");
});

// ─── parseArgs Tests ────────────────────────────────────────────────────────

test("parseArgs: Erkennt Positionsargumente", () => {
  const argv = ["node", "script.js", "arg1", "arg2", "arg3"];
  const result = parseArgs(argv);

  assert.deepStrictEqual(result._, ["arg1", "arg2", "arg3"]);
  assert.deepStrictEqual(result.flags, {});
});

test("parseArgs: Parsed --flag=value korrekt", () => {
  const argv = ["node", "script.js", "--output=/path/to/file", "--format=csv"];
  const result = parseArgs(argv);

  assert.deepStrictEqual(result.flags, {
    output: "/path/to/file",
    format: "csv",
  });
  assert.deepStrictEqual(result._, []);
});

test("parseArgs: Parsed --flag ohne Wert als true", () => {
  const argv = ["node", "script.js", "--verbose", "--debug"];
  const result = parseArgs(argv);

  assert.deepStrictEqual(result.flags, {
    verbose: true,
    debug: true,
  });
});

test("parseArgs: Gemischte Positional- und Flag-Argumente", () => {
  const argv = [
    "node",
    "script.js",
    "playlists.txt",
    "--context=/path/to/context.json",
    "--concurrency=5",
    "--verbose",
    "extra-arg",
  ];
  const result = parseArgs(argv);

  assert.deepStrictEqual(result._, ["playlists.txt", "extra-arg"]);
  assert.deepStrictEqual(result.flags, {
    context: "/path/to/context.json",
    concurrency: "5",
    verbose: true,
  });
});

test("parseArgs: Flag mit Gleichheitszeichen im Wert", () => {
  const argv = ["node", "script.js", "--query=select * where id=123"];
  const result = parseArgs(argv);

  assert.strictEqual(result.flags.query, "select * where id=123");
});

// ─── DataStore Tests ────────────────────────────────────────────────────────

test("DataStore: init() erstellt Verzeichnisse", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datastore-test-"));
  const basePath = path.join(tempDir, "store");

  const store = new DataStore(basePath);
  await store.init();

  assert.strictEqual(existsSync(basePath), true);
  assert.strictEqual(
    existsSync(path.join(basePath, "xhr-tracks")),
    true
  );
});

test("DataStore: savePlaylists/loadPlaylists Roundtrip", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datastore-test-"));
  const basePath = path.join(tempDir, "store");

  const store = new DataStore(basePath);
  await store.init();

  const playlists = [
    {
      id: "1",
      name: "Playlist A",
      trackCount: 10,
      isPublic: true,
      source: "xhr",
    },
    {
      id: "2",
      name: "Playlist B",
      trackCount: 20,
      isPublic: false,
      source: "xhr",
    },
  ];

  await store.savePlaylists(playlists);
  const loaded = await store.loadPlaylists();

  assert.deepStrictEqual(loaded, playlists);
});

test("DataStore: savePlaylistTracks/loadPlaylistTracks Roundtrip", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datastore-test-"));
  const basePath = path.join(tempDir, "store");

  const store = new DataStore(basePath);
  await store.init();

  const tracks = [
    {
      playlistId: "1",
      trackId: "100",
      title: "Track 1",
      artists: "Artist A",
      source: "xhr",
    },
    {
      playlistId: "1",
      trackId: "101",
      title: "Track 2",
      artists: "Artist B",
      source: "xhr",
    },
  ];

  await store.savePlaylistTracks("1", tracks);
  const loaded = await store.loadPlaylistTracks("1");

  assert.deepStrictEqual(loaded, tracks);
});

test("DataStore: loadPlaylists gibt leeres Array bei fehlender Datei", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datastore-test-"));
  const basePath = path.join(tempDir, "store");

  const store = new DataStore(basePath);
  await store.init();

  const result = await store.loadPlaylists();

  assert.deepStrictEqual(result, []);
});

test("DataStore: loadPlaylistTracks gibt null bei fehlender Datei", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datastore-test-"));
  const basePath = path.join(tempDir, "store");

  const store = new DataStore(basePath);
  await store.init();

  const result = await store.loadPlaylistTracks("nonexistent");

  assert.strictEqual(result, null);
});

test("DataStore: getAllTracks sammelt Tracks aus allen Playlisten", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datastore-test-"));
  const basePath = path.join(tempDir, "store");

  const store = new DataStore(basePath);
  await store.init();

  const playlists = [
    { id: "1", name: "Playlist A", trackCount: 2, source: "xhr" },
    { id: "2", name: "Playlist B", trackCount: 1, source: "xhr" },
  ];

  const tracksP1 = [
    { playlistId: "1", trackId: "100", title: "Track 1", source: "xhr" },
    { playlistId: "1", trackId: "101", title: "Track 2", source: "xhr" },
  ];

  const tracksP2 = [
    { playlistId: "2", trackId: "200", title: "Track 3", source: "xhr" },
  ];

  await store.savePlaylists(playlists);
  await store.savePlaylistTracks("1", tracksP1);
  await store.savePlaylistTracks("2", tracksP2);

  const allTracks = await store.getAllTracks();

  assert.strictEqual(allTracks.length, 3);
  assert.strictEqual(allTracks[0].trackId, "100");
  assert.strictEqual(allTracks[1].trackId, "101");
  assert.strictEqual(allTracks[2].trackId, "200");
});

// ─── BeatportXhrClient Tests ────────────────────────────────────────────────

test("BeatportXhrClient: Setzt Authorization-Header korrekt", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest = null;

  try {
    globalThis.fetch = async (url, options) => {
      capturedRequest = { url, options };
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true }),
      };
    };

    const context = {
      authorization: "Bearer test-token-123",
      accept: "application/json",
      referer: "https://dj.beatport.com/",
      userAgent: "TestBot/1.0",
    };

    const client = new BeatportXhrClient(context);
    await client.fetch("https://api.beatport.com/v4/test");

    assert.strictEqual(
      capturedRequest.options.headers.authorization,
      "Bearer test-token-123"
    );
    assert.strictEqual(
      capturedRequest.options.headers.accept,
      "application/json"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: Rate-Limiting wartet bei 429", async () => {
  const originalFetch = globalThis.fetch;
  let attemptCount = 0;

  try {
    globalThis.fetch = async (url, options) => {
      attemptCount++;
      if (attemptCount === 1) {
        return {
          status: 429,
          ok: false,
          headers: new Map([["retry-after", "1"]]),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true }),
      };
    };

    const context = {
      authorization: "Bearer token",
    };

    const client = new BeatportXhrClient(context);
    const startTime = Date.now();
    const result = await client.fetch("https://api.beatport.com/v4/test");
    const elapsed = Date.now() - startTime;

    assert.strictEqual(attemptCount, 2);
    assert.strictEqual(result.success, true);
    assert.ok(elapsed >= 1000, "Should have waited at least 1 second");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: Auth-Fehler wirft bei 401", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, options) => {
      return {
        status: 401,
        ok: false,
        headers: new Map(),
      };
    };

    const context = {
      authorization: "Bearer invalid-token",
    };

    const client = new BeatportXhrClient(context);

    await assert.rejects(
      async () => client.fetch("https://api.beatport.com/v4/test"),
      (err) => {
        return (
          err instanceof Error &&
          err.message.includes("Auth-Fehler 401")
        );
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: Auth-Fehler wirft bei 403", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, options) => {
      return {
        status: 403,
        ok: false,
        headers: new Map(),
      };
    };

    const context = {
      authorization: "Bearer token",
    };

    const client = new BeatportXhrClient(context);

    await assert.rejects(
      async () => client.fetch("https://api.beatport.com/v4/test"),
      (err) => {
        return (
          err instanceof Error &&
          err.message.includes("Auth-Fehler 403")
        );
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: Retry bei 5xx-Fehler", async () => {
  const originalFetch = globalThis.fetch;
  let attemptCount = 0;

  try {
    globalThis.fetch = async (url, options) => {
      attemptCount++;
      if (attemptCount < 3) {
        return {
          status: 500,
          ok: false,
          headers: new Map(),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true }),
      };
    };

    const context = {
      authorization: "Bearer token",
    };

    const client = new BeatportXhrClient(context);
    const result = await client.fetch("https://api.beatport.com/v4/test");

    assert.strictEqual(attemptCount, 3);
    assert.strictEqual(result.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Konstanten Tests ───────────────────────────────────────────────────────

test("Konstanten: API_BASE ist korrekt definiert", () => {
  assert.strictEqual(API_BASE, "https://api.beatport.com/v4");
});

test("Konstanten: PER_PAGE ist korrekt definiert", () => {
  assert.strictEqual(PER_PAGE, 100);
});

test("Konstanten: TRACKS_PER_PAGE ist korrekt definiert", () => {
  assert.strictEqual(TRACKS_PER_PAGE, 100);
});
