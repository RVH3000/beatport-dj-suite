import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SQLiteCacheStore,
  normalizePlaylistKey,
  resolveCacheDbPath,
} from "../electron-app/cache/sqlite-cache.mjs";

const SQLITE_BIN = "/usr/bin/sqlite3";

async function checkSqliteAvailable() {
  return existsSync(SQLITE_BIN);
}

async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sqlite-cache-test-"));
}

test("normalizePlaylistKey - gibt playlistId zurück wenn vorhanden", () => {
  const entry = {
    playlistId: "  BP_12345  ",
    name: "My Playlist",
    tracks: "50",
  };
  const result = normalizePlaylistKey(entry);
  assert.strictEqual(result, "BP_12345");
});

test("normalizePlaylistKey - gibt id zurück wenn playlistId nicht vorhanden", () => {
  const entry = {
    id: "  ID_67890  ",
    name: "Another Playlist",
    tracks: "30",
  };
  const result = normalizePlaylistKey(entry);
  assert.strictEqual(result, "ID_67890");
});

test("normalizePlaylistKey - gibt key zurück wenn keine id vorhanden", () => {
  const entry = {
    key: "  cache_key_abc  ",
    name: "Playlist Name",
    tracks: "25",
  };
  const result = normalizePlaylistKey(entry);
  assert.strictEqual(result, "cache_key_abc");
});

test("normalizePlaylistKey - gibt cacheKey zurück wenn key nicht vorhanden", () => {
  const entry = {
    cacheKey: "  my_cache_key  ",
    name: "Some Playlist",
    tracks: "15",
  };
  const result = normalizePlaylistKey(entry);
  assert.strictEqual(result, "my_cache_key");
});

test("normalizePlaylistKey - gibt name_tracks Composite zurück ohne id/key", () => {
  const entry = {
    name: "  Summer  Hits  ",
    tracks: "  42  ",
  };
  const result = normalizePlaylistKey(entry);
  assert.strictEqual(result, "Summer Hits_42");
});

test("normalizePlaylistKey - gibt playlistName und playlistTracksExpected zurück", () => {
  const entry = {
    playlistName: "  Winter  Tunes  ",
    playlistTracksExpected: "  38  ",
  };
  const result = normalizePlaylistKey(entry);
  assert.strictEqual(result, "Winter Tunes_38");
});

test("normalizePlaylistKey - gibt leeren String für leeres Objekt zurück", () => {
  const result = normalizePlaylistKey({});
  assert.strictEqual(result, "");
});

test("normalizePlaylistKey - wirft bei null (bekanntes Verhalten, Default-Param fängt null nicht ab)", () => {
  assert.throws(() => normalizePlaylistKey(null), TypeError);
});

test("normalizePlaylistKey - gibt leeren String zurück bei undefined", () => {
  const result = normalizePlaylistKey(undefined);
  assert.strictEqual(result, "");
});

test("normalizePlaylistKey - ignoriert leere IDs und fällt auf Name zurück", () => {
  const entry = {
    playlistId: "   ",
    id: "",
    name: "Fallback Playlist",
    tracks: "20",
  };
  const result = normalizePlaylistKey(entry);
  assert.strictEqual(result, "Fallback Playlist_20");
});

test("resolveCacheDbPath - verwendet explizite cacheDbPath wenn vorhanden", () => {
  const config = {
    cacheDbPath: "/custom/path/to/cache.sqlite",
  };
  const result = resolveCacheDbPath(config);
  assert.strictEqual(result, "/custom/path/to/cache.sqlite");
});

test("resolveCacheDbPath - verwendet userDataPath + /cache/beatport-cache.sqlite", () => {
  const config = {
    userDataPath: "/home/user/appdata",
  };
  const result = resolveCacheDbPath(config);
  assert.strictEqual(result, "/home/user/appdata/cache/beatport-cache.sqlite");
});

test("resolveCacheDbPath - fällt auf ~/Library/Application Support Pfad zurück", () => {
  const config = {};
  const result = resolveCacheDbPath(config);
  const homeDir = os.homedir();
  const expected = path.join(
    homeDir,
    "Library",
    "Application Support",
    "beatport-playlist-scanner",
    "cache",
    "beatport-cache.sqlite"
  );
  assert.strictEqual(result, expected);
});

test("resolveCacheDbPath - bevorzugt cacheDbPath vor userDataPath", () => {
  const config = {
    cacheDbPath: "/explicit/cache.sqlite",
    userDataPath: "/home/user/appdata",
  };
  const result = resolveCacheDbPath(config);
  assert.strictEqual(result, "/explicit/cache.sqlite");
});

test("resolveCacheDbPath - ignoriert leere cacheDbPath und verwendet userDataPath", () => {
  const config = {
    cacheDbPath: "   ",
    userDataPath: "/home/user/data",
  };
  const result = resolveCacheDbPath(config);
  assert.strictEqual(result, "/home/user/data/cache/beatport-cache.sqlite");
});

const sqliteAvailable = await checkSqliteAvailable();

if (sqliteAvailable) {
  test("SQLiteCacheStore.init - erstellt Tabellen ohne Fehler", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    assert(existsSync(dbPath), "Datenbank-Datei sollte existieren");

    const status = await store.getStatus();
    assert(status.exists, "Datenbank sollte existieren");
    assert.strictEqual(status.counts.playlists, 0, "Sollte keine Playlists haben");
    assert.strictEqual(status.counts.tracks, 0, "Sollte keine Tracks haben");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.upsertPlaylists - fügt neue Playlists ein", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlists = [
      {
        playlistId: "playlist_1",
        name: "Techno Mix",
        tracks: "50",
      },
      {
        playlistId: "playlist_2",
        name: "House Vibes",
        tracks: "75",
      },
    ];

    const result = await store.upsertPlaylists(playlists);
    assert.strictEqual(result.inserted, 2, "Sollte 2 Playlists eingefügt haben");
    assert.strictEqual(result.updated, 0, "Sollte 0 Playlists aktualisiert haben");

    const status = await store.getStatus();
    assert.strictEqual(
      status.counts.playlists,
      2,
      "Sollte 2 Playlists in der DB haben"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.upsertPlaylists - aktualisiert existierende Playlists", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlist = {
      playlistId: "playlist_update",
      name: "Original Name",
      tracks: "30",
    };

    // Erste Einfügung
    const result1 = await store.upsertPlaylists([playlist]);
    assert.strictEqual(result1.inserted, 1, "Erste Einfügung sollte erfolgreich sein");

    // Zweite Einfügung (Update)
    const updatedPlaylist = {
      playlistId: "playlist_update",
      name: "Updated Name",
      tracks: "35",
    };

    const result2 = await store.upsertPlaylists([updatedPlaylist]);
    assert.strictEqual(result2.inserted, 0, "Sollte 0 neue Playlists einfügen");
    assert.strictEqual(result2.updated, 1, "Sollte 1 Playlist aktualisieren");

    const status = await store.getStatus();
    assert.strictEqual(
      status.counts.playlists,
      1,
      "Sollte insgesamt 1 Playlist haben"
    );

    const record = await store.getPlaylistRecord({
      playlistId: "playlist_update",
    });
    assert.strictEqual(record.name, "Updated Name", "Name sollte aktualisiert sein");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.listPlaylists - gibt eingefügte Playlists zurück", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlists = [
      {
        playlistId: "list_1",
        name: "First Playlist",
        tracks: "20",
      },
      {
        playlistId: "list_2",
        name: "Second Playlist",
        tracks: "40",
      },
    ];

    await store.upsertPlaylists(playlists);

    const listed = await store.listPlaylists();
    assert.strictEqual(listed.length, 2, "Sollte 2 Playlists zurückgeben");
    assert(
      listed.some((p) => p.id === "list_1"),
      "Sollte playlist_1 enthalten"
    );
    assert(
      listed.some((p) => p.id === "list_2"),
      "Sollte playlist_2 enthalten"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.getPlaylistRecord - findet Playlist nach playlistId", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlist = {
      playlistId: "find_me_123",
      name: "Find This Playlist",
      tracks: "55",
    };

    await store.upsertPlaylists([playlist]);

    const record = await store.getPlaylistRecord({
      playlistId: "find_me_123",
    });

    assert(record !== null, "Sollte Playlist finden");
    assert.strictEqual(
      record.playlistId,
      "find_me_123",
      "playlistId sollte stimmen"
    );
    assert.strictEqual(record.name, "Find This Playlist", "Name sollte stimmen");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.getPlaylistRecord - gibt null zurück wenn nicht gefunden", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const record = await store.getPlaylistRecord({
      playlistId: "nonexistent",
    });

    assert.strictEqual(record, null, "Sollte null zurückgeben wenn nicht gefunden");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.getPlaylistDetails - gibt Tracks nach replacePlaylistAnalysis zurück", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const summary = {
      playlistId: "details_test",
      playlistName: "Details Test Playlist",
      playlistTracksExpected: "3",
      trackFingerprint: "fp_123",
    };

    const trackRows = [
      {
        trackId: "track_1",
        trackTitle: "Track One",
        artists: "Artist A",
        trackIndex: 0,
      },
      {
        trackId: "track_2",
        trackTitle: "Track Two",
        artists: "Artist B",
        trackIndex: 1,
      },
      {
        trackId: "track_3",
        trackTitle: "Track Three",
        artists: "Artist C",
        trackIndex: 2,
      },
    ];

    await store.replacePlaylistAnalysis(summary, trackRows);

    const details = await store.getPlaylistDetails({
      playlistId: "details_test",
    });

    assert(details !== null, "Sollte Details zurückgeben");
    assert.strictEqual(details.trackRows.length, 3, "Sollte 3 Tracks haben");
    assert.strictEqual(
      details.trackRows[0].trackTitle,
      "Track One",
      "Erster Track sollte korrekt sein"
    );
    assert.strictEqual(
      details.trackRows[1].trackTitle,
      "Track Two",
      "Zweiter Track sollte korrekt sein"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.setSyncState / getSyncState - Roundtrip", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    await store.setSyncState("test_key", "test_value");

    const value = await store.getSyncState("test_key");
    assert.strictEqual(value, "test_value", "getSyncState sollte gespeicherten Wert zurückgeben");

    await store.setSyncState("test_key", "updated_value");
    const updatedValue = await store.getSyncState("test_key");
    assert.strictEqual(
      updatedValue,
      "updated_value",
      "getSyncState sollte aktualisierten Wert zurückgeben"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.setSyncState - speichert JSON Objekte", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const obj = { nested: { value: 42 }, array: [1, 2, 3] };
    await store.setSyncState("json_key", obj);

    const value = await store.getSyncState("json_key");
    const parsed = JSON.parse(value);
    assert.deepStrictEqual(parsed, obj, "Sollte JSON Objekt speichern und abrufen");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.getStatus - gibt korrekte Zählungen zurück", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlists = [
      {
        playlistId: "status_1",
        name: "Status Playlist 1",
        tracks: "10",
      },
      {
        playlistId: "status_2",
        name: "Status Playlist 2",
        tracks: "20",
      },
    ];

    await store.upsertPlaylists(playlists);

    const summary = {
      playlistId: "status_1",
      playlistName: "Status Playlist 1",
      playlistTracksExpected: "10",
    };

    const trackRows = [
      {
        trackId: "st_1",
        trackTitle: "Status Track 1",
        artists: "Artist",
        trackIndex: 0,
      },
      {
        trackId: "st_2",
        trackTitle: "Status Track 2",
        artists: "Artist",
        trackIndex: 1,
      },
    ];

    await store.replacePlaylistAnalysis(summary, trackRows);

    const status = await store.getStatus();

    assert.strictEqual(status.counts.playlists, 2, "Sollte 2 Playlists haben");
    assert.strictEqual(status.counts.tracks, 2, "Sollte 2 Tracks haben");
    assert.strictEqual(
      status.counts.analyzedPlaylists,
      1,
      "Sollte 1 analysierte Playlist haben"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.clearAll - löscht alle Daten aber behält schema_version", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlists = [
      {
        playlistId: "clear_1",
        name: "Clear Test Playlist",
        tracks: "5",
      },
    ];

    await store.upsertPlaylists(playlists);
    await store.setSyncState("custom_state", "custom_value");

    let status = await store.getStatus();
    assert.strictEqual(status.counts.playlists, 1, "Sollte 1 Playlist haben vor clear");

    await store.clearAll();

    status = await store.getStatus();
    assert.strictEqual(status.counts.playlists, 0, "Sollte 0 Playlists nach clear haben");
    assert.strictEqual(status.counts.tracks, 0, "Sollte 0 Tracks nach clear haben");

    const schemaVersion = await store.getSyncState("schema_version");
    assert.strictEqual(
      schemaVersion,
      "1",
      "schema_version sollte erhalten bleiben"
    );

    const customState = await store.getSyncState("custom_state");
    assert.strictEqual(customState, "", "custom_state sollte gelöscht sein");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.markMissingPlaylists - markiert Playlists als fehlend", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlists = [
      {
        playlistId: "keep_1",
        name: "Keep This Playlist",
        tracks: "10",
      },
      {
        playlistId: "missing_1",
        name: "Missing Playlist",
        tracks: "15",
      },
      {
        playlistId: "missing_2",
        name: "Another Missing",
        tracks: "20",
      },
    ];

    await store.upsertPlaylists(playlists);

    // normalizePlaylistKey gibt playlistId zurück wenn vorhanden → "keep_1"
    const seenKeys = ["keep_1"];
    await store.markMissingPlaylists(seenKeys);

    const listed = await store.listPlaylists();
    const keep = listed.find((p) => p.id === "keep_1");
    const missing1 = listed.find((p) => p.id === "missing_1");
    const missing2 = listed.find((p) => p.id === "missing_2");

    assert.strictEqual(keep.syncState, "current", "Gesehene Playlist sollte 'current' sein");
    assert.strictEqual(missing1.syncState, "missing", "Ungesehene Playlist sollte 'missing' sein");
    assert.strictEqual(missing2.syncState, "missing", "Ungesehene Playlist sollte 'missing' sein");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.markPlaylistDeferred - setzt sync_state", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlist = {
      playlistId: "defer_test",
      name: "Defer Test Playlist",
      tracks: "25",
    };

    await store.upsertPlaylists([playlist]);

    await store.markPlaylistDeferred({ playlistId: "defer_test" }, "deferred");

    const record = await store.getPlaylistRecord({ playlistId: "defer_test" });
    assert.strictEqual(record.syncState, "deferred", "sync_state sollte 'deferred' sein");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.applyDuplicateEntries - markiert Duplikate", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const playlists = [
      {
        playlistId: "dup_1",
        name: "Potential Duplicate 1",
        tracks: "30",
      },
      {
        playlistId: "dup_2",
        name: "Potential Duplicate 2",
        tracks: "30",
      },
    ];

    await store.upsertPlaylists(playlists);

    const duplicates = [
      {
        playlistId: "dup_1",
        duplicateStatus: "candidate",
        trackFingerprint: "fp_dup_1",
      },
      {
        playlistId: "dup_2",
        duplicateStatus: "confirmed",
        trackFingerprint: "fp_dup_2",
      },
    ];

    await store.applyDuplicateEntries(duplicates);

    const record1 = await store.getPlaylistRecord({ playlistId: "dup_1" });
    const record2 = await store.getPlaylistRecord({ playlistId: "dup_2" });

    assert.strictEqual(
      record1.isDuplicateCandidate,
      1,
      "dup_1 sollte isDuplicateCandidate sein"
    );
    assert.strictEqual(
      record1.isDuplicateConfirmed,
      0,
      "dup_1 sollte nicht isDuplicateConfirmed sein"
    );

    assert.strictEqual(
      record2.isDuplicateCandidate,
      1,
      "dup_2 sollte isDuplicateCandidate sein"
    );
    assert.strictEqual(
      record2.isDuplicateConfirmed,
      1,
      "dup_2 sollte isDuplicateConfirmed sein"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.writeExportRecord - speichert Export-Metadaten", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    await store.writeExportRecord("export_1", "/path/to/export.csv", 42);

    const status = await store.getStatus();
    assert.strictEqual(status.exports.length, 1, "Sollte 1 Export-Record haben");
    assert.strictEqual(
      status.exports[0].exportKey,
      "export_1",
      "Export-Key sollte stimmen"
    );
    assert.strictEqual(
      status.exports[0].rowCount,
      42,
      "Row-Count sollte 42 sein"
    );

    await store.writeExportRecord("export_1", "/path/to/export_v2.csv", 50);
    const updatedStatus = await store.getStatus();
    assert.strictEqual(
      updatedStatus.exports[0].rowCount,
      50,
      "Row-Count sollte auf 50 aktualisiert sein"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.replacePlaylistAnalysis - mit leerer Tracks-Array", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const summary = {
      playlistId: "empty_tracks",
      playlistName: "Empty Tracks Playlist",
      playlistTracksExpected: "0",
      trackFingerprint: "fp_empty",
    };

    await store.replacePlaylistAnalysis(summary, []);

    const details = await store.getPlaylistDetails({
      playlistId: "empty_tracks",
    });

    assert(details !== null, "Sollte Details zurückgeben");
    assert.strictEqual(details.trackRows.length, 0, "Sollte 0 Tracks haben");

    const record = await store.getPlaylistRecord({
      playlistId: "empty_tracks",
    });
    assert.strictEqual(
      record.lastDeepAnalyzedAt !== "",
      true,
      "lastDeepAnalyzedAt sollte gesetzt sein"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.getAllTrackRows - verbindet Playlists und Tracks", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const summary1 = {
      playlistId: "playlist_a",
      playlistName: "Playlist A",
      playlistTracksExpected: "2",
    };

    const trackRows1 = [
      {
        trackId: "track_a1",
        trackTitle: "Track A1",
        artists: "Artist A",
        trackIndex: 0,
      },
      {
        trackId: "track_a2",
        trackTitle: "Track A2",
        artists: "Artist A",
        trackIndex: 1,
      },
    ];

    const summary2 = {
      playlistId: "playlist_b",
      playlistName: "Playlist B",
      playlistTracksExpected: "1",
    };

    const trackRows2 = [
      {
        trackId: "track_b1",
        trackTitle: "Track B1",
        artists: "Artist B",
        trackIndex: 0,
      },
    ];

    await store.replacePlaylistAnalysis(summary1, trackRows1);
    await store.replacePlaylistAnalysis(summary2, trackRows2);

    const allTracks = await store.getAllTrackRows();

    assert.strictEqual(allTracks.length, 3, "Sollte 3 Tracks insgesamt haben");
    assert(
      allTracks.some((t) => t.trackId === "track_a1"),
      "Sollte track_a1 enthalten"
    );
    assert(
      allTracks.some((t) => t.trackId === "track_b1"),
      "Sollte track_b1 enthalten"
    );

    const trackFromA = allTracks.find((t) => t.trackId === "track_a1");
    assert.strictEqual(
      trackFromA.playlistName,
      "Playlist A",
      "Track sollte mit Playlist verknüpft sein"
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore.getPlaylistOverlapMatrix - findet gemeinsame Tracks", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    // Playlist 1 mit Tracks
    const summary1 = {
      playlistId: "overlap_1",
      playlistName: "Overlap Playlist 1",
      playlistTracksExpected: "3",
    };

    const trackRows1 = [
      {
        trackId: "shared_1",
        trackTitle: "Shared Track 1",
        artists: "Artist",
        trackIndex: 0,
      },
      {
        trackId: "shared_2",
        trackTitle: "Shared Track 2",
        artists: "Artist",
        trackIndex: 1,
      },
      {
        trackId: "unique_1",
        trackTitle: "Unique to P1",
        artists: "Artist",
        trackIndex: 2,
      },
    ];

    // Playlist 2 mit Tracks (teilt 2 mit Playlist 1)
    const summary2 = {
      playlistId: "overlap_2",
      playlistName: "Overlap Playlist 2",
      playlistTracksExpected: "3",
    };

    const trackRows2 = [
      {
        trackId: "shared_1",
        trackTitle: "Shared Track 1",
        artists: "Artist",
        trackIndex: 0,
      },
      {
        trackId: "shared_2",
        trackTitle: "Shared Track 2",
        artists: "Artist",
        trackIndex: 1,
      },
      {
        trackId: "unique_2",
        trackTitle: "Unique to P2",
        artists: "Artist",
        trackIndex: 2,
      },
    ];

    await store.replacePlaylistAnalysis(summary1, trackRows1);
    await store.replacePlaylistAnalysis(summary2, trackRows2);

    const matrix = await store.getPlaylistOverlapMatrix();

    // Matrix sollte leer oder minimal sein da nur 2 gemeinsame Tracks
    // und die Funktion HAVING sharedTracks >= 2 hat
    const overlap = matrix.find(
      (m) =>
        (m.playlistA.includes("overlap_1") && m.playlistB.includes("overlap_2")) ||
        (m.playlistA.includes("overlap_2") && m.playlistB.includes("overlap_1"))
    );

    // Mit nur 2 gemeinsamen sollte es gefunden werden (HAVING >= 2)
    assert(
      overlap !== undefined,
      "Sollte Überlappung mit 2 gemeinsamen Tracks finden"
    );
    assert.strictEqual(overlap.sharedTracks, 2, "Sollte 2 gemeinsame Tracks haben");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore - upsertPlaylists mit leerer Array", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const result = await store.upsertPlaylists([]);
    assert.strictEqual(result.inserted, 0, "Sollte 0 eingefügt haben");
    assert.strictEqual(result.updated, 0, "Sollte 0 aktualisiert haben");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore - replacePlaylistAnalysis ohne playlistId wirft Fehler", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    const summary = {
      // Keine playlistId, name, oder ähnliches
    };

    try {
      await store.replacePlaylistAnalysis(summary, []);
      assert.fail("Sollte einen Fehler werfen");
    } catch (error) {
      assert(error.message.includes("Playlist-Key"), "Fehler sollte Playlist-Key erwähnen");
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("SQLiteCacheStore - getPlaylistRecord mit playlistKey Query", async () => {
    const tempDir = await makeTempDir();
    const dbPath = path.join(tempDir, "test.sqlite");
    const store = new SQLiteCacheStore({ cacheDbPath: dbPath });

    await store.init();

    // Playlist OHNE playlistId → normalizePlaylistKey erzeugt name_tracks Composite
    const playlist = {
      name: "By Key Playlist",
      tracks: "45",
    };

    await store.upsertPlaylists([playlist]);

    // Suche nach dem gleichen name_tracks Composite-Key
    const record = await store.getPlaylistRecord({
      name: "By Key Playlist",
      tracks: "45",
    });

    assert(record !== null, "Sollte Playlist nach Name+Tracks Composite-Key finden");
    assert.strictEqual(record.name, "By Key Playlist", "Name sollte stimmen");

    // Suche nach playlistId funktioniert ebenfalls
    const byId = await store.getPlaylistRecord({ playlistId: "by_key_test" });
    assert.strictEqual(byId, null, "Nicht-existierende playlistId sollte null geben");

    await fs.rm(tempDir, { recursive: true, force: true });
  });
} else {
  test.skip("SQLiteCacheStore Tests - sqlite3 nicht verfügbar", () => {
    // sqlite3 ist nicht installiert, diese Tests können nicht laufen
  });
}
