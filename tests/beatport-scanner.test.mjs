import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildDuplicateEntries,
  buildPlaylistSummaryFromTrackRows,
  buildTrackFingerprint,
  exportCsvFromCache,
  getCacheStatus,
  RunStore,
  isLegacyRunManifest,
  listStoredRuns,
  migrateLegacyRuns,
  normalizeApiPlaylistRecord,
  normalizeApiTrackRecord,
  parseHumanTrackCount,
  readCachedPlaylistDetails,
  readCachedPlaylists,
  rebuildCacheFromRuns,
  resolveConfig,
  resolveRunPaths,
  sanitizeSensitiveText,
} from "../electron-app/scanner/cdp-scanner.mjs";
import { detectBeatportSessionState } from "../electron-app/auth/session-probe.mjs";

const FIXTURE_ROOT = path.resolve("tests/fixtures/runs");

async function makeTempRoots() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "beatport-scanner-test-"));
  const archiveRootDir = path.join(base, "archive");
  const exportsRootDir = path.join(base, "exports");
  await fs.mkdir(archiveRootDir, { recursive: true });
  await fs.mkdir(exportsRootDir, { recursive: true });
  return { base, archiveRootDir, exportsRootDir };
}

async function installFixtureRuns(targetRoot) {
  const names = await fs.readdir(FIXTURE_ROOT);
  for (const name of names) {
    await fs.cp(path.join(FIXTURE_ROOT, name), path.join(targetRoot, name), {
      recursive: true,
      force: true,
    });
  }
}

test("Legacy-Detection erkennt alte Manifeste", async () => {
  const manifest101 = JSON.parse(
    await fs.readFile(
      path.join(FIXTURE_ROOT, "legacy-1.0.1-complete", "manifest.json"),
      "utf8"
    )
  );
  const manifestNative = JSON.parse(
    await fs.readFile(
      path.join(FIXTURE_ROOT, "native-2.0-ready", "manifest.json"),
      "utf8"
    )
  );

  assert.equal(isLegacyRunManifest(manifest101), true);
  assert.equal(isLegacyRunManifest(manifestNative), false);
});

test("listStoredRuns normalisiert gemischte Archive auf Schema v2", async () => {
  const roots = await makeTempRoots();
  await installFixtureRuns(roots.archiveRootDir);

  const listing = await listStoredRuns({
    archiveRootDir: roots.archiveRootDir,
    exportsRootDir: roots.exportsRootDir,
  });

  assert.equal(listing.runs.length, 3);
  const legacyRuns = listing.runs.filter((run) => run.origin.kind === "legacy-source");
  const nativeRuns = listing.runs.filter((run) => run.origin.kind === "native");
  assert.equal(legacyRuns.length, 2);
  assert.equal(nativeRuns.length, 1);
  assert.equal(listing.runs.every((run) => run.schemaVersion === 2), true);
  assert.equal(listing.preferredRun?.runId, "native-2.0-ready");
});

test("Legacy-Migration erzeugt kopierte Schema-v2-Runs und lässt die Quelle unverändert", async () => {
  const roots = await makeTempRoots();
  await installFixtureRuns(roots.archiveRootDir);

  const result = await migrateLegacyRuns(
    {
      archiveRootDir: roots.archiveRootDir,
      exportsRootDir: roots.exportsRootDir,
    },
    {
      runIds: ["legacy-1.0.1-complete"],
    }
  );

  assert.equal(result.migrated.length, 1);
  const migrated = result.migrated[0].run;
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.origin.kind, "legacy-migrated");
  assert.equal(migrated.migration.sourceRunId, "legacy-1.0.1-complete");
  assert.equal(migrated.counts.playlistsDiscovered, 2);
  assert.equal(migrated.counts.duplicates, 1);
  assert.equal(migrated.counts.analyzedTrackRows, 2);
  assert.equal(existsSync(path.join(roots.archiveRootDir, migrated.runId, "manifest.json")), true);

  const sourceManifest = JSON.parse(
    await fs.readFile(
      path.join(roots.archiveRootDir, "legacy-1.0.1-complete", "manifest.json"),
      "utf8"
    )
  );
  assert.equal(sourceManifest.schemaVersion ?? 0, 0);
  assert.equal(sourceManifest.origin?.kind ?? "", "");
});

test("RunStore persistiert Pause/Resume-Zustände im Schema v2", async () => {
  const roots = await makeTempRoots();
  const cfg = resolveConfig({
    archiveRootDir: roots.archiveRootDir,
    exportsRootDir: roots.exportsRootDir,
    runId: "runstore-smoke",
    scannerAppPath: "/Applications/Test.app",
    appVersion: "1.2.0",
    appBuildId: "test-build",
  });
  const runPaths = resolveRunPaths(cfg, "runstore-smoke");
  const store = new RunStore(cfg, runPaths);
  await store.initialize();
  await store.addPlaylists([
    { id: "playlist-1", name: "RunStore Playlist", tracks: "3", key: "RunStore Playlist_3" },
  ]);
  await store.markDiscoveryComplete(store.playlists);
  await store.beginAnalysis(store.playlists, "auto", "start");
  await store.setCurrentPlaylist(store.playlists[0], 1, 1);
  await store.markPaused("pause_requested");

  const manifest = JSON.parse(await fs.readFile(runPaths.files.manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.origin.kind, "native");
  assert.equal(manifest.status, "paused");
  assert.equal(manifest.phase, "paused");
});

test("RunStore kann Playlists aus einem älteren kompatiblen Run als Baseline übernehmen", async () => {
  const roots = await makeTempRoots();
  const cfg = resolveConfig({
    archiveRootDir: roots.archiveRootDir,
    exportsRootDir: roots.exportsRootDir,
    runId: "baseline-import",
    scannerAppPath: "/Applications/Test.app",
    appVersion: "1.2.0",
    appBuildId: "test-build",
  });
  const runPaths = resolveRunPaths(cfg, "baseline-import");
  const store = new RunStore(cfg, runPaths);
  await store.initialize();
  await store.importBaseline(
    { runId: "source-run", startedAt: "2026-03-12T00:00:00.000Z", status: "completed" },
    [
      { id: "playlist-1", name: "Imported A", tracks: "2", key: "Imported A_2" },
      { id: "playlist-2", name: "Imported B", tracks: "4", key: "Imported B_4" },
    ],
    [{ id: "playlist-2", name: "Imported B", tracks: "4", key: "Imported B_4" }]
  );

  const manifest = JSON.parse(await fs.readFile(runPaths.files.manifestPath, "utf8"));
  assert.equal(manifest.counts.playlistsDiscovered, 2);
  assert.equal(manifest.counts.duplicates, 1);
  assert.equal(manifest.networkHints.deltaSeedRunId, "source-run");
});

test("Cache-Rebuild übernimmt Playlists und Trackdaten aus kompatiblen Runs", async () => {
  const roots = await makeTempRoots();
  await installFixtureRuns(roots.archiveRootDir);
  const config = {
    archiveRootDir: roots.archiveRootDir,
    exportsRootDir: roots.exportsRootDir,
    userDataPath: path.join(roots.base, "user-data"),
    cacheEnabled: true,
  };

  const rebuild = await rebuildCacheFromRuns(config);
  const status = await getCacheStatus(config);
  const playlists = await readCachedPlaylists(config);
  const details = await readCachedPlaylistDetails(config, { playlistId: "dup-1" });

  assert.equal(rebuild.rebuiltFromRuns >= 2, true);
  assert.equal(status.counts.playlists >= 3, true);
  assert.equal(playlists.total >= 3, true);
  assert.equal(details.playlistId, "dup-1");
  assert.equal(details.trackRows.length, 2);
});

test("CSV-Export liest aus dem Cache statt aus einem neuen Scan", async () => {
  const roots = await makeTempRoots();
  await installFixtureRuns(roots.archiveRootDir);
  const config = {
    archiveRootDir: roots.archiveRootDir,
    exportsRootDir: roots.exportsRootDir,
    userDataPath: path.join(roots.base, "user-data"),
    cacheEnabled: true,
  };

  await rebuildCacheFromRuns(config);
  const exported = await exportCsvFromCache(config, {
    selectedPlaylistKeys: ["dup-1"],
  });

  assert.equal(existsSync(exported.playlistsPath), true);
  assert.equal(existsSync(exported.tracksPath), true);
  assert.equal(existsSync(exported.dimensionsPath), true);
  const playlistsCsv = await fs.readFile(exported.playlistsPath, "utf8");
  const tracksCsv = await fs.readFile(exported.tracksPath, "utf8");
  assert.match(playlistsCsv, /Legacy Groove Alpha/);
  assert.match(tracksCsv, /First Legacy Track/);
});

test("Track-Count-Parser liest nur die echte Track-Anzahl", () => {
  assert.equal(parseHumanTrackCount("44 tracks • 04h 42m"), "44");
  assert.equal(parseHumanTrackCount("9 tracks"), "9");
  assert.equal(parseHumanTrackCount("04h 42m"), "");
});

test("XHR-Playlist-Normalisierung übernimmt Serverdaten führend", () => {
  const playlist = normalizeApiPlaylistRecord({
    id: 6698258,
    name: "032026",
    track_count: 6,
    genres: ["Minimal / Deep Tech"],
  });
  assert.equal(playlist.id, "6698258");
  assert.equal(playlist.name, "032026");
  assert.equal(playlist.tracks, "6");
  assert.equal(playlist.serverTrackCount, 6);
  assert.equal(playlist.source, "xhr");
});

test("XHR-Track-Normalisierung liest Label Genre Jahr Artist BPM und Key", () => {
  const playlist = normalizeApiPlaylistRecord({
    id: 6698258,
    name: "032026",
    track_count: 6,
  });
  const row = normalizeApiTrackRecord(playlist, {
    position: 1,
    track: {
      id: 23976801,
      name: "Killa",
      mix_name: "Original Mix",
      bpm: 123,
      genre: { name: "Minimal / Deep Tech" },
      key: { name: "F Minor" },
      publish_date: "2026-03-06",
      artists: [{ name: "Brian Cid" }],
      release: {
        label: { name: "Frau Blau" },
      },
    },
  });
  assert.equal(row.trackId, "23976801");
  assert.equal(row.trackTitle, "Killa - Original Mix");
  assert.equal(row.artists, "Brian Cid");
  assert.equal(row.genre, "Minimal / Deep Tech");
  assert.equal(row.label, "Frau Blau");
  assert.equal(row.year, "2026");
  assert.equal(row.bpm, "123");
  assert.equal(row.key, "F Minor");
  assert.equal(row.source, "xhr");
});

test("Track-Fingerprint bestätigt nur identische Server-Inhalte", () => {
  const playlistA = { id: "a", name: "Groof", tracks: "2", serverTrackCount: 2, source: "xhr" };
  const playlistB = { id: "b", name: "Groof", tracks: "2", serverTrackCount: 2, source: "xhr" };
  const trackRowsA = [
    { playlistId: "a", trackIndex: 1, trackId: "10", trackTitle: "A", artists: "X", genre: "G", label: "L", release: "2026-01-01", year: "2026", source: "xhr" },
    { playlistId: "a", trackIndex: 2, trackId: "11", trackTitle: "B", artists: "Y", genre: "G", label: "L", release: "2026-01-01", year: "2026", source: "xhr" },
  ];
  const trackRowsB = [
    { playlistId: "b", trackIndex: 1, trackId: "10", trackTitle: "A", artists: "X", genre: "G", label: "L", release: "2026-01-01", year: "2026", source: "xhr" },
    { playlistId: "b", trackIndex: 2, trackId: "11", trackTitle: "B", artists: "Y", genre: "G", label: "L", release: "2026-01-01", year: "2026", source: "xhr" },
  ];
  const summaryA = buildPlaylistSummaryFromTrackRows(playlistA, trackRowsA, "xhr");
  const summaryB = buildPlaylistSummaryFromTrackRows(playlistB, trackRowsB, "xhr");
  assert.equal(summaryA.trackFingerprint, buildTrackFingerprint(trackRowsA));
  assert.equal(summaryA.trackFingerprint, summaryB.trackFingerprint);

  const duplicates = buildDuplicateEntries([playlistA, playlistB], [summaryA, summaryB]);
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates.every((entry) => entry.duplicateStatus === "confirmed"), true);
});

test("Gleicher Name und Trackzahl mit unterschiedlichem Fingerprint bleibt unbestätigt", () => {
  const playlists = [
    { id: "a", name: "Groof", tracks: "2", serverTrackCount: 2, source: "xhr" },
    { id: "b", name: "Groof", tracks: "2", serverTrackCount: 2, source: "xhr" },
  ];
  const summaries = [
    {
      playlistId: "a",
      playlistName: "Groof",
      playlistTracksExpected: "2",
      analyzedTrackRows: 2,
      analysisMethod: "xhr",
      source: "xhr",
      trackFingerprint: "fp-a",
      genreCounts: [{ value: "G", count: 2 }],
      labelCounts: [{ value: "L", count: 2 }],
      yearCounts: [{ value: "2026", count: 2 }],
    },
    {
      playlistId: "b",
      playlistName: "Groof",
      playlistTracksExpected: "2",
      analyzedTrackRows: 2,
      analysisMethod: "xhr",
      source: "xhr",
      trackFingerprint: "fp-b",
      genreCounts: [{ value: "G", count: 2 }],
      labelCounts: [{ value: "L", count: 2 }],
      yearCounts: [{ value: "2026", count: 2 }],
    },
  ];
  const duplicates = buildDuplicateEntries(playlists, summaries);
  assert.equal(duplicates.length, 0);
});

test("Auth-Defaults bevorzugen interne Session ohne Passwortspeicherung", () => {
  const config = resolveConfig({});
  assert.equal(config.authMode, "internal");
  assert.equal(config.fallbackEnabled, true);
  assert.equal(config.keychainEnabled, false);
  assert.equal(config.autoLoginEnabled, false);
  assert.equal(config.beatportSessionPartition, "persist:beatport-auth-v1");
  assert.equal(config.preferServerData, true);
});

test("Session-Heuristik erkennt Beatport-Loginseite als ungültig", () => {
  const state = detectBeatportSessionState({
    host: "account.beatport.com",
    pathname: "/",
    hasPasswordField: true,
    hasUsernameField: true,
    hasLoginTrigger: false,
    hasPlaylistUi: false,
    hasMyLibraryText: false,
    bodyText: "Log in Username Password",
  });
  assert.equal(state, "invalid");
});

test("Session-Heuristik erkennt aktive DJ-Session als gültig", () => {
  const state = detectBeatportSessionState({
    host: "dj.beatport.com",
    pathname: "/home",
    hasPasswordField: false,
    hasUsernameField: false,
    hasLoginTrigger: false,
    hasPlaylistUi: true,
    hasMyLibraryText: true,
    bpUserId: 42,
    bodyText: "My Library Collection",
  });
  assert.equal(state, "valid");
});

test("Secret-Redaction entfernt E-Mails und Token aus Persistenztexten", () => {
  const redacted = sanitizeSensitiveText(
    "user@example.com access_token=abc123 Bearer very.secret.token"
  );
  assert.equal(redacted.includes("user@example.com"), false);
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("very.secret.token"), false);
});
