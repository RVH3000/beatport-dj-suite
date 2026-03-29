/**
 * xhr-scanner.test.mjs
 * Tests für das xhr-scanner Modul mit Node.js native test runner
 */

import test, { describe, it } from "node:test";
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
  findContextFile,
  loadApiContext,
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

// ─── BeatportXhrClient: discoverAllPlaylists Tests ─────────────────────────

test("BeatportXhrClient: discoverAllPlaylists paginiert korrekt", async () => {
  const originalFetch = globalThis.fetch;

  try {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            count: 3,
            results: [
              { id: 1, name: "Playlist A", track_count: 10 },
              { id: 2, name: "Playlist B", track_count: 20 },
            ],
            next: "https://api.beatport.com/v4/my/playlists/?page=2",
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          count: 3,
          results: [{ id: 3, name: "Playlist C", track_count: 5 }],
          next: null,
        }),
      };
    };

    const client = new BeatportXhrClient({ authorization: "Bearer token" });
    const playlists = await client.discoverAllPlaylists();

    assert.strictEqual(playlists.length, 3);
    assert.strictEqual(playlists[0].name, "Playlist A");
    assert.strictEqual(playlists[2].name, "Playlist C");
    assert.strictEqual(callCount, 2, "Sollte 2 API-Requests machen");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: discoverAllPlaylists mit leerer Response", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({ count: 0, results: [], next: null }),
    });

    const client = new BeatportXhrClient({ authorization: "Bearer token" });
    const playlists = await client.discoverAllPlaylists();

    assert.strictEqual(playlists.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: fetchPlaylistTracks gibt normalisierte Tracks zurück", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        results: [
          {
            track: {
              id: 100,
              name: "Track A",
              mix_name: "Original",
              artists: [{ name: "DJ X" }],
              bpm: 128,
              key: { name: "Am" },
            },
          },
          {
            track: {
              id: 101,
              name: "Track B",
              mix_name: "Remix",
              artists: [{ name: "DJ Y" }],
              bpm: 132,
            },
          },
        ],
        next: null,
      }),
    });

    const client = new BeatportXhrClient({ authorization: "Bearer token" });
    const tracks = await client.fetchPlaylistTracks("pl-99");

    assert.strictEqual(tracks.length, 2);
    assert.strictEqual(tracks[0].title, "Track A");
    assert.strictEqual(tracks[0].artists, "DJ X");
    assert.strictEqual(tracks[0].playlistId, "pl-99");
    assert.strictEqual(tracks[1].bpm, 132);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: requestCount wird korrekt hochgezählt", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({ ok: true }),
    });

    const client = new BeatportXhrClient({ authorization: "Bearer token" });
    assert.strictEqual(client.requestCount, 0);

    await client.fetch("https://api.beatport.com/v4/test1");
    assert.strictEqual(client.requestCount, 1);

    await client.fetch("https://api.beatport.com/v4/test2");
    assert.strictEqual(client.requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: POST-Request sendet Content-Type header", async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders = null;

  try {
    globalThis.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return {
        status: 200,
        ok: true,
        json: async () => ({ id: "new-playlist" }),
      };
    };

    const client = new BeatportXhrClient({ authorization: "Bearer token" });
    await client.fetch("https://api.beatport.com/v4/my/playlists/", {
      method: "POST",
      body: { name: "New Playlist" },
    });

    assert.strictEqual(capturedHeaders["content-type"], "application/json");
    assert.strictEqual(capturedHeaders.authorization, "Bearer token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BeatportXhrClient: createPlaylist sendet POST", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;

  try {
    globalThis.fetch = async (url, options) => {
      capturedBody = options.body;
      return {
        status: 200,
        ok: true,
        json: async () => ({ id: "42", name: "Test Playlist" }),
      };
    };

    const client = new BeatportXhrClient({ authorization: "Bearer token" });
    const result = await client.createPlaylist("Test Playlist");

    assert.strictEqual(result.name, "Test Playlist");
    const parsed = JSON.parse(capturedBody);
    assert.strictEqual(parsed.name, "Test Playlist");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── normalizePlaylist Erweiterungen ────────────────────────────────────────

test("normalizePlaylist: Behandelt fehlende image gracefully", () => {
  const entry = {
    id: 99,
    name: "No Image",
    track_count: 5,
  };
  const result = normalizePlaylist(entry);
  assert.strictEqual(result.imageUrl, "");
});

test("normalizePlaylist: isPublic Default ist false", () => {
  const entry = { id: 1, name: "Private" };
  const result = normalizePlaylist(entry);
  assert.strictEqual(result.isPublic, false);
});

// ─── normalizeTrack Erweiterungen ───────────────────────────────────────────

test("normalizeTrack: Extrahiert sub_genres korrekt", () => {
  const entry = {
    track: {
      id: 200,
      name: "Subgenre Track",
      sub_genres: [{ name: "Acid" }, { name: "Hard" }],
    },
  };
  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.subGenre, "Acid, Hard");
});

test("normalizeTrack: Sub-Genre als Fallback für Genre", () => {
  const entry = {
    track: {
      id: 201,
      name: "Fallback Genre",
      sub_genres: [{ name: "Progressive" }],
    },
  };
  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.genre, "Progressive");
});

test("normalizeTrack: Remixers werden korrekt extrahiert", () => {
  const entry = {
    track: {
      id: 202,
      name: "Remixed",
      remixers: [{ name: "DJ Remix" }, { name: "DJ Other" }],
    },
  };
  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.remixers, "DJ Remix, DJ Other");
});

test("normalizeTrack: ISRC und Katalognummer", () => {
  const entry = {
    track: {
      id: 203,
      name: "Full Metadata",
      isrc: "US1234567890",
      catalog_number: "CAT-001",
    },
  };
  const result = normalizeTrack("pl-1", entry);
  assert.strictEqual(result.isrc, "US1234567890");
  assert.strictEqual(result.catalogNumber, "CAT-001");
});

// ─── Phase 6: parseArgs, findContextFile, loadApiContext, Client-Methoden ──────



describe("parseArgs", () => {
  it("parst positionale Argumente (ab Index 2)", () => {
    const result = parseArgs(["node", "script.mjs", "discover"]);
    assert.deepStrictEqual(result._, ["discover"]);
    assert.deepStrictEqual(result.flags, {});
  });

  it("parst --key=value Flags", () => {
    const result = parseArgs(["node", "s.mjs", "--context=/tmp/ctx.json", "--port=9222"]);
    assert.strictEqual(result.flags.context, "/tmp/ctx.json");
    assert.strictEqual(result.flags.port, "9222");
  });

  it("parst --flag ohne Wert als true", () => {
    const result = parseArgs(["node", "s.mjs", "--verbose", "--dry-run"]);
    assert.strictEqual(result.flags.verbose, true);
    assert.strictEqual(result.flags["dry-run"], true);
  });

  it("behandelt --key=val mit mehreren = korrekt", () => {
    const result = parseArgs(["node", "s.mjs", "--url=https://example.com?a=1"]);
    assert.strictEqual(result.flags.url, "https://example.com?a=1");
  });

  it("mischt positionale und Flags", () => {
    const result = parseArgs(["node", "s.mjs", "scan", "--output=/tmp", "extra"]);
    assert.deepStrictEqual(result._, ["scan", "extra"]);
    assert.strictEqual(result.flags.output, "/tmp");
  });

  it("gibt leere Struktur bei nur node+script", () => {
    const result = parseArgs(["node", "script.mjs"]);
    assert.deepStrictEqual(result._, []);
    assert.deepStrictEqual(result.flags, {});
  });
});

describe("findContextFile", () => {
  it("gibt expliziten Pfad zurück wenn Datei existiert", async () => {
    const tmpDir = path.join(os.tmpdir(), `xhr-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const ctxPath = path.join(tmpDir, "api-context.json");
    await fs.writeFile(ctxPath, '{"authorization":"Bearer test"}');
    try {
      const result = await findContextFile(ctxPath);
      assert.strictEqual(result, ctxPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("wirft Fehler wenn expliziter Pfad nicht existiert", async () => {
    await assert.rejects(
      () => findContextFile("/tmp/nonexistent-ctx-file-12345.json"),
      (err) => err.message.includes("nicht gefunden")
    );
  });

  it("gibt Pfad oder Fehler zurück wenn kein expliziter Pfad angegeben", async () => {
    // Ohne Argument sucht sie in USER_DATA_PATHS — je nach System
    // wird eine api-context.json gefunden oder ein Fehler geworfen
    try {
      const result = await findContextFile(undefined);
      assert.ok(result.endsWith("api-context.json"), "Sollte api-context.json-Pfad sein");
    } catch (err) {
      assert.ok(err.message.includes("api-context.json nicht gefunden"));
    }
  });
});

describe("loadApiContext", () => {
  it("lädt gültigen Kontext mit Authorization", async () => {
    const tmpDir = path.join(os.tmpdir(), `xhr-ctx-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const ctxPath = path.join(tmpDir, "api-context.json");
    const ctx = {
      authorization: "Bearer eyTest123",
      exportedAt: new Date().toISOString(),
    };
    await fs.writeFile(ctxPath, JSON.stringify(ctx));
    try {
      const result = await loadApiContext(ctxPath);
      assert.strictEqual(result.authorization, "Bearer eyTest123");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("wirft Fehler wenn Authorization fehlt", async () => {
    const tmpDir = path.join(os.tmpdir(), `xhr-noauth-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const ctxPath = path.join(tmpDir, "api-context.json");
    await fs.writeFile(ctxPath, '{"exportedAt":"2025-01-01T00:00:00Z"}');
    try {
      await assert.rejects(
        () => loadApiContext(ctxPath),
        (err) => err.message.includes("kein Authorization-Token")
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("BeatportXhrClient: erweiterte Methoden", () => {
  it("fetchPlaylistMeta ruft korrekte URL auf", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let calledUrl = "";
      globalThis.fetch = async (url) => {
        calledUrl = url;
        return { status: 200, ok: true, json: async () => ({ id: "pl1", name: "Test" }) };
      };
      const client = new BeatportXhrClient({ authorization: "Bearer token" });
      const meta = await client.fetchPlaylistMeta("pl1");
      assert.ok(calledUrl.includes("/my/playlists/pl1/"));
      assert.strictEqual(meta.name, "Test");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("addTracksToPlaylist sendet POST für jeden Track", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const calls = [];
      globalThis.fetch = async (url, opts) => {
        calls.push({ url, method: opts?.method, body: opts?.body });
        return { status: 200, ok: true, json: async () => ({ ok: true }) };
      };
      const client = new BeatportXhrClient({ authorization: "Bearer token" });
      const results = await client.addTracksToPlaylist("pl1", ["100", "200"]);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].status, "added");
      assert.strictEqual(results[1].status, "added");
      assert.ok(calls.every((c) => c.method === "POST"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("addTracksToPlaylist fängt Fehler pro Track ab", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        if (callCount === 1) throw new Error("Netzwerkfehler");
        return { status: 200, ok: true, json: async () => ({ ok: true }) };
      };
      const client = new BeatportXhrClient({ authorization: "Bearer token" });
      const results = await client.addTracksToPlaylist("pl1", ["100", "200"]);
      assert.strictEqual(results[0].status, "error");
      assert.strictEqual(results[1].status, "added");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("removeTracksFromPlaylist sendet DELETE für jeden Track", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const methods = [];
      globalThis.fetch = async (url, opts) => {
        methods.push(opts?.method);
        return { status: 200, ok: true, json: async () => ({}) };
      };
      const client = new BeatportXhrClient({ authorization: "Bearer token" });
      const results = await client.removeTracksFromPlaylist("pl1", ["100", "200"]);
      assert.strictEqual(results.length, 2);
      assert.ok(results.every((r) => r.status === "removed"));
      assert.ok(methods.every((m) => m === "DELETE"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("renamePlaylist sendet PATCH mit neuem Namen", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let sentBody = null;
      globalThis.fetch = async (url, opts) => {
        sentBody = opts?.body;
        return { status: 200, ok: true, json: async () => ({ name: "Neuer Name" }) };
      };
      const client = new BeatportXhrClient({ authorization: "Bearer token" });
      const result = await client.renamePlaylist("pl1", "Neuer Name");
      assert.strictEqual(result.name, "Neuer Name");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deletePlaylist sendet DELETE und gibt {ok: true}", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let method = "";
      globalThis.fetch = async (url, opts) => {
        method = opts?.method;
        return { status: 200, ok: true, json: async () => ({}) };
      };
      const client = new BeatportXhrClient({ authorization: "Bearer token" });
      const result = await client.deletePlaylist("pl1");
      assert.strictEqual(method, "DELETE");
      assert.strictEqual(result.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
