import test from "node:test";
import assert from "node:assert/strict";
import {
  RUN_SCHEMA_VERSION,
  LEGACY_VERSION_CUTOFF,
  TRACK_CSV_HEADERS,
  SUMMARY_CSV_HEADERS,
  compareVersions,
  createRunId,
  createDefaultOrigin,
  isCompatibleOperationalRun,
  pickPreferredCompatibleRun,
  isLegacyRunManifest,
  normalizeLooseText,
  normalizePathInput,
  derivePhaseFromStatus,
  sanitizeSensitiveText,
  sanitizeSensitiveValue,
  buildTrackFingerprint,
  buildDuplicateEntries,
  csvEscape,
  parseHumanTrackCount,
  normalizeTrackRow,
  normalizePlaylistSummary,
  toPlaylistRef,
  getPlaylistIdentity,
  rowsToCsv,
} from "../electron-app/scanner/run-store.mjs";

test("compareVersions - Gleiche Versionen geben 0 zurück", () => {
  assert.strictEqual(compareVersions("1.0.0", "1.0.0"), 0);
  assert.strictEqual(compareVersions("2.5.3", "2.5.3"), 0);
});

test("compareVersions - Linke Version größer gibt 1 zurück", () => {
  assert.strictEqual(compareVersions("2.0.0", "1.0.0"), 1);
  assert.strictEqual(compareVersions("1.5.0", "1.0.0"), 1);
  assert.strictEqual(compareVersions("1.0.1", "1.0.0"), 1);
});

test("compareVersions - Linke Version kleiner gibt -1 zurück", () => {
  assert.strictEqual(compareVersions("1.0.0", "2.0.0"), -1);
  assert.strictEqual(compareVersions("1.0.0", "1.5.0"), -1);
  assert.strictEqual(compareVersions("1.0.0", "1.0.1"), -1);
});

test("compareVersions - Fehlende Patch-Version wird behandelt", () => {
  assert.strictEqual(compareVersions("1.0", "1.0.0"), 0);
  assert.strictEqual(compareVersions("1.1", "1.0.0"), 1);
  assert.strictEqual(compareVersions("1.0", "1.1.0"), -1);
});

test("compareVersions - Leere Strings", () => {
  assert.strictEqual(compareVersions("", ""), 0);
  assert.strictEqual(compareVersions("1.0.0", ""), 1);
  assert.strictEqual(compareVersions("", "1.0.0"), -1);
});

test("compareVersions - Nicht-numerische Teile werden ignoriert", () => {
  assert.strictEqual(compareVersions("1.0.0-beta", "1.0.0"), 0);
  assert.strictEqual(compareVersions("1.0.x", "1.0.0"), 0);
});

test("createRunId - Gibt nicht-leeren String zurück", () => {
  const id = createRunId();
  assert.strictEqual(typeof id, "string");
  assert(id.length > 0);
});

test("createRunId - Enthält Timestamp-Format", () => {
  const id = createRunId();
  assert(id.includes("-"));
  const parts = id.split("-");
  assert(parts.length >= 5);
});

test("createRunId - Zwei Aufrufe produzieren unterschiedliche IDs", () => {
  const id1 = createRunId();
  const id2 = createRunId();
  assert.notStrictEqual(id1, id2);
});

test("isLegacyRunManifest - Legacy origin.kind gibt true zurück", () => {
  const manifest = {
    origin: { kind: "legacy-source" },
    schemaVersion: 2,
    phase: "completed",
    app: { version: "1.2.0" },
  };
  assert.strictEqual(isLegacyRunManifest(manifest), true);
});

test("isLegacyRunManifest - schemaVersion < 2 gibt true zurück", () => {
  const manifest = {
    origin: { kind: "native" },
    schemaVersion: 1,
    phase: "completed",
    app: { version: "1.2.0" },
  };
  assert.strictEqual(isLegacyRunManifest(manifest), true);
});

test("isLegacyRunManifest - Fehlende Phase gibt true zurück", () => {
  const manifest = {
    origin: { kind: "native" },
    schemaVersion: 2,
    app: { version: "1.2.0" },
  };
  assert.strictEqual(isLegacyRunManifest(manifest), true);
});

test("isLegacyRunManifest - App-Version < 1.1.0 gibt true zurück", () => {
  const manifest = {
    origin: { kind: "native" },
    schemaVersion: 2,
    phase: "completed",
    app: { version: "1.0.0" },
  };
  assert.strictEqual(isLegacyRunManifest(manifest), true);
});

test("isLegacyRunManifest - Native v2 mit Phase gibt false zurück", () => {
  const manifest = {
    origin: { kind: "native" },
    schemaVersion: 2,
    phase: "completed",
    app: { version: "1.1.0" },
  };
  assert.strictEqual(isLegacyRunManifest(manifest), false);
});

test("isLegacyRunManifest - Leeres Manifest gibt true zurück", () => {
  const manifest = {};
  assert.strictEqual(isLegacyRunManifest(manifest), true);
});

test("isCompatibleOperationalRun - Abgeschlossener nativer Run mit Playlists → true", () => {
  const run = {
    origin: { kind: "native" },
    status: "completed",
    counts: { playlistsDiscovered: 5 },
  };
  assert.strictEqual(isCompatibleOperationalRun(run), true);
});

test("isCompatibleOperationalRun - Legacy-source → false", () => {
  const run = {
    origin: { kind: "legacy-source" },
    status: "completed",
    counts: { playlistsDiscovered: 5 },
  };
  assert.strictEqual(isCompatibleOperationalRun(run), false);
});

test("isCompatibleOperationalRun - Keine entdeckten Playlists → false", () => {
  const run = {
    origin: { kind: "native" },
    status: "completed",
    counts: { playlistsDiscovered: 0 },
  };
  assert.strictEqual(isCompatibleOperationalRun(run), false);
});

test("isCompatibleOperationalRun - Fehlender origin → false", () => {
  const run = {
    status: "completed",
    counts: { playlistsDiscovered: 5 },
  };
  assert.strictEqual(isCompatibleOperationalRun(run), false);
});

test("isCompatibleOperationalRun - Ungültiger Status → false", () => {
  const run = {
    origin: { kind: "native" },
    status: "invalid_status",
    counts: { playlistsDiscovered: 5 },
  };
  assert.strictEqual(isCompatibleOperationalRun(run), false);
});

test("pickPreferredCompatibleRun - Bevorzugt paused vor completed", () => {
  const runs = [
    {
      origin: { kind: "native" },
      status: "completed",
      counts: { playlistsDiscovered: 5 },
      startedAt: "2026-03-01T10:00:00Z",
    },
    {
      origin: { kind: "native" },
      status: "paused",
      counts: { playlistsDiscovered: 5 },
      startedAt: "2026-03-01T09:00:00Z",
    },
  ];
  const result = pickPreferredCompatibleRun(runs);
  assert.strictEqual(result.status, "paused");
});

test("pickPreferredCompatibleRun - Bevorzugt neuere startedAt auf gleicher Rangstufe", () => {
  const runs = [
    {
      origin: { kind: "native" },
      status: "completed",
      counts: { playlistsDiscovered: 5 },
      startedAt: "2026-03-01T09:00:00Z",
    },
    {
      origin: { kind: "native" },
      status: "completed",
      counts: { playlistsDiscovered: 5 },
      startedAt: "2026-03-01T10:00:00Z",
    },
  ];
  const result = pickPreferredCompatibleRun(runs);
  assert.strictEqual(result.startedAt, "2026-03-01T10:00:00Z");
});

test("pickPreferredCompatibleRun - Gibt null für leeres Array zurück", () => {
  const result = pickPreferredCompatibleRun([]);
  assert.strictEqual(result, null);
});

test("pickPreferredCompatibleRun - Filtert Legacy-Runs heraus", () => {
  const runs = [
    {
      origin: { kind: "legacy-source" },
      status: "completed",
      counts: { playlistsDiscovered: 5 },
      startedAt: "2026-03-01T10:00:00Z",
    },
    {
      origin: { kind: "native" },
      status: "completed",
      counts: { playlistsDiscovered: 5 },
      startedAt: "2026-03-01T09:00:00Z",
    },
  ];
  const result = pickPreferredCompatibleRun(runs);
  assert.strictEqual(result.origin.kind, "native");
});

test("pickPreferredCompatibleRun - Gibt einen kompatiblen Run zurück", () => {
  const runs = [
    {
      origin: { kind: "native" },
      status: "completed",
      counts: { playlistsDiscovered: 5 },
      startedAt: "2026-03-01T10:00:00Z",
    },
  ];
  const result = pickPreferredCompatibleRun(runs);
  assert(result !== null);
  assert.strictEqual(result.origin.kind, "native");
});

test("normalizeLooseText - Schneidet Whitespace ab", () => {
  assert.strictEqual(normalizeLooseText("  hello  "), "hello");
  assert.strictEqual(normalizeLooseText("\n  test  \t"), "test");
});

test("normalizeLooseText - Mehrere Leerzeichen zusammenfassen", () => {
  assert.strictEqual(normalizeLooseText("hello   world"), "hello world");
  assert.strictEqual(normalizeLooseText("a\n\nb"), "a b");
});

test("normalizeLooseText - Verarbeitet null/undefined", () => {
  assert.strictEqual(normalizeLooseText(null), "");
  assert.strictEqual(normalizeLooseText(undefined), "");
});

test("normalizeLooseText - Verarbeitet Zahlen", () => {
  assert.strictEqual(normalizeLooseText(42), "42");
  assert.strictEqual(normalizeLooseText(3.14), "3.14");
});

test("normalizePathInput - Schneidet umgebende Anführungszeichen ab", () => {
  assert.strictEqual(normalizePathInput('"hello"'), "hello");
  assert.strictEqual(normalizePathInput("'world'"), "world");
  assert.strictEqual(normalizePathInput('""test""'), "test");
});

test("normalizePathInput - Schneidet Whitespace ab", () => {
  assert.strictEqual(normalizePathInput('  "hello"  '), "hello");
});

test("normalizePathInput - Verarbeitet null", () => {
  assert.strictEqual(normalizePathInput(null), "");
  assert.strictEqual(normalizePathInput(undefined), "");
});

test("derivePhaseFromStatus - Leerer String → 'completed'", () => {
  assert.strictEqual(derivePhaseFromStatus(""), "completed");
  assert.strictEqual(derivePhaseFromStatus(null), "completed");
});

test("derivePhaseFromStatus - 'ready_for_analysis' bleibt gleich", () => {
  assert.strictEqual(derivePhaseFromStatus("ready_for_analysis"), "ready_for_analysis");
});

test("derivePhaseFromStatus - 'paused' bleibt gleich", () => {
  assert.strictEqual(derivePhaseFromStatus("paused"), "paused");
});

test("derivePhaseFromStatus - 'incomplete' bleibt gleich", () => {
  assert.strictEqual(derivePhaseFromStatus("incomplete"), "incomplete");
});

test("derivePhaseFromStatus - 'running' → 'analysis'", () => {
  assert.strictEqual(derivePhaseFromStatus("running"), "analysis");
});

test("sanitizeSensitiveText - Entfernt E-Mails", () => {
  const result = sanitizeSensitiveText("Kontakt: user@example.com");
  assert(result.includes("[redacted-email]"));
  assert(!result.includes("@"));
});

test("sanitizeSensitiveText - Entfernt access_token-Werte", () => {
  const result = sanitizeSensitiveText("access_token=abc123xyz");
  assert(result.includes("[redacted]"));
  assert(!result.includes("abc123xyz"));
});

test("sanitizeSensitiveText - Entfernt Bearer-Token", () => {
  const result = sanitizeSensitiveText("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  assert(result.includes("[redacted]"));
  assert(!result.includes("eyJ"));
});

test("sanitizeSensitiveText - Lässt normalen Text intakt", () => {
  const text = "Das ist ein normaler Text ohne Geheimnisse";
  assert.strictEqual(sanitizeSensitiveText(text), text);
});

test("buildTrackFingerprint - Gleiche Tracks produzieren gleichen Fingerprint", () => {
  const tracks1 = [
    { trackId: "track1", trackIndex: 0 },
    { trackId: "track2", trackIndex: 1 },
  ];
  const tracks2 = [
    { trackId: "track1", trackIndex: 0 },
    { trackId: "track2", trackIndex: 1 },
  ];
  const fp1 = buildTrackFingerprint(tracks1);
  const fp2 = buildTrackFingerprint(tracks2);
  assert.strictEqual(fp1, fp2);
});

test("buildTrackFingerprint - Unterschiedliche Tracks produzieren unterschiedliche Fingerprints", () => {
  const tracks1 = [
    { trackId: "track1", trackIndex: 0 },
    { trackId: "track2", trackIndex: 1 },
  ];
  const tracks2 = [
    { trackId: "track1", trackIndex: 0 },
    { trackId: "track3", trackIndex: 1 },
  ];
  const fp1 = buildTrackFingerprint(tracks1);
  const fp2 = buildTrackFingerprint(tracks2);
  assert.notStrictEqual(fp1, fp2);
});

test("buildTrackFingerprint - Leeres Array produziert konsistentes Ergebnis", () => {
  const fp1 = buildTrackFingerprint([]);
  const fp2 = buildTrackFingerprint([]);
  assert.strictEqual(fp1, fp2);
  assert.strictEqual(fp1, "");
});

test("buildDuplicateEntries - Gleicher Name + Tracks + Fingerprint → confirmed", () => {
  const playlists = [
    {
      name: "Best Of",
      tracks: "10",
      id: "id1",
      trackFingerprint: "abc123",
    },
    {
      name: "Best Of",
      tracks: "10",
      id: "id2",
      trackFingerprint: "abc123",
    },
  ];
  const summaries = [
    {
      playlistId: "id1",
      playlistName: "Best Of",
      playlistTracksExpected: "10",
      trackFingerprint: "abc123",
      serverTrackCount: 10,
      trackRows: [
        { trackId: "t1", trackIndex: 0 },
        { trackId: "t2", trackIndex: 1 },
      ],
    },
    {
      playlistId: "id2",
      playlistName: "Best Of",
      playlistTracksExpected: "10",
      trackFingerprint: "abc123",
      serverTrackCount: 10,
      trackRows: [
        { trackId: "t1", trackIndex: 0 },
        { trackId: "t2", trackIndex: 1 },
      ],
    },
  ];
  const result = buildDuplicateEntries(playlists, summaries);
  assert.strictEqual(result.length, 2);
  assert(result.every((e) => e.duplicateStatus === "confirmed"));
});

test("buildDuplicateEntries - Gleicher Name + Tracks, unterschiedliche Fingerprints", () => {
  const playlists = [
    { name: "Mix", tracks: "20", id: "id1", trackFingerprint: "abc" },
    { name: "Mix", tracks: "20", id: "id2", trackFingerprint: "xyz" },
  ];
  const summaries = [
    {
      playlistId: "id1",
      playlistName: "Mix",
      playlistTracksExpected: "20",
      trackFingerprint: "abc",
      serverTrackCount: 20,
      trackRows: [],
    },
    {
      playlistId: "id2",
      playlistName: "Mix",
      playlistTracksExpected: "20",
      trackFingerprint: "xyz",
      serverTrackCount: 20,
      trackRows: [],
    },
  ];
  const result = buildDuplicateEntries(playlists, summaries);
  assert.strictEqual(result.length, 0);
});

test("buildDuplicateEntries - Einzigartige Playlists → leeres Array", () => {
  const playlists = [
    { name: "Playlist A", tracks: "10", id: "id1" },
    { name: "Playlist B", tracks: "20", id: "id2" },
  ];
  const result = buildDuplicateEntries(playlists, []);
  assert.strictEqual(result.length, 0);
});

test("buildDuplicateEntries - Mehrere Gruppen", () => {
  const playlists = [
    { name: "A", tracks: "10", id: "id1" },
    { name: "A", tracks: "10", id: "id2" },
    { name: "B", tracks: "20", id: "id3" },
    { name: "B", tracks: "20", id: "id4" },
  ];
  const result = buildDuplicateEntries(playlists, []);
  assert.strictEqual(result.length, 4);
});

test("csvEscape - Keine Sonderzeichen → unverändert", () => {
  assert.strictEqual(csvEscape("hello"), "hello");
});

test("csvEscape - Komma → zitiert", () => {
  const result = csvEscape("hello, world");
  assert(result.startsWith('"'));
  assert(result.endsWith('"'));
});

test("csvEscape - Anführungszeichen → verdoppelt und zitiert", () => {
  const result = csvEscape('say "hello"');
  assert.strictEqual(result, '"say ""hello"""');
});

test("csvEscape - Newline → zitiert", () => {
  const result = csvEscape("line1\nline2");
  assert(result.startsWith('"'));
  assert(result.endsWith('"'));
});

test("parseHumanTrackCount - '44 tracks • 04h 42m' → '44'", () => {
  assert.strictEqual(parseHumanTrackCount("44 tracks • 04h 42m"), "44");
});

test("parseHumanTrackCount - '9 tracks' → '9'", () => {
  assert.strictEqual(parseHumanTrackCount("9 tracks"), "9");
});

test("parseHumanTrackCount - '04h 42m' → ''", () => {
  assert.strictEqual(parseHumanTrackCount("04h 42m"), "");
});

test("parseHumanTrackCount - Leerer String → ''", () => {
  assert.strictEqual(parseHumanTrackCount(""), "");
});

test("createDefaultOrigin - 'native' → Label 'Native'", () => {
  const origin = createDefaultOrigin("native");
  assert.strictEqual(origin.kind, "native");
  assert.strictEqual(origin.label, "Native");
});

test("createDefaultOrigin - 'legacy-source' → Label 'Legacy-Quelle'", () => {
  const origin = createDefaultOrigin("legacy-source");
  assert.strictEqual(origin.kind, "legacy-source");
  assert.strictEqual(origin.label, "Legacy-Quelle");
});

test("createDefaultOrigin - 'legacy-migrated' → Label 'Migrierter Run'", () => {
  const origin = createDefaultOrigin("legacy-migrated");
  assert.strictEqual(origin.kind, "legacy-migrated");
  assert.strictEqual(origin.label, "Migrierter Run");
});

test("normalizeTrackRow - Normalisiert alle Felder", () => {
  const row = {
    playlistId: "  pl1  ",
    playlistName: "  MyPlaylist  ",
    trackId: "  t123  ",
    trackTitle: "  Song  ",
    artists: "  Artist1, Artist2  ",
  };
  const result = normalizeTrackRow(row);
  assert.strictEqual(result.playlistId, "pl1");
  assert.strictEqual(result.playlistName, "MyPlaylist");
  assert.strictEqual(result.trackId, "t123");
});

test("normalizePlaylistSummary - Berechnet Fingerprint aus trackRows", () => {
  const summary = {
    playlistId: "pl1",
    playlistName: "Test",
    playlistTracksExpected: "2",
    trackRows: [
      { trackId: "t1", trackIndex: 0 },
      { trackId: "t2", trackIndex: 1 },
    ],
  };
  const result = normalizePlaylistSummary(summary);
  assert(result.trackFingerprint.length > 0);
});

test("normalizePlaylistSummary - Zählt Genre-, Label- und Jahrbuckets", () => {
  const summary = {
    playlistId: "pl1",
    playlistName: "Test",
    playlistTracksExpected: "2",
    trackRows: [
      {
        trackId: "t1",
        trackIndex: 0,
        genre: "Techno",
        label: "LabelA",
        year: "2020",
      },
      {
        trackId: "t2",
        trackIndex: 1,
        genre: "Techno",
        label: "LabelB",
        year: "2020",
      },
    ],
  };
  const result = normalizePlaylistSummary(summary);
  assert.strictEqual(result.genreCounts[0].value, "Techno");
  assert.strictEqual(result.genreCounts[0].count, 2);
});

test("toPlaylistRef - Konvertiert Eintrag zu PlaylistRef", () => {
  const entry = {
    id: "pl1",
    name: "My Playlist",
    tracks: "10",
  };
  const result = toPlaylistRef(entry);
  assert.strictEqual(result.id, "pl1");
  assert.strictEqual(result.name, "My Playlist");
  assert.strictEqual(result.tracks, "10");
});

test("toPlaylistRef - Entfernt 'ref-' Präfix von ID", () => {
  const entry = { id: "ref-pl1", name: "Test", tracks: "5" };
  const result = toPlaylistRef(entry);
  assert.strictEqual(result.id, "pl1");
});

test("getPlaylistIdentity - Gibt eindeutige Identität zurück", () => {
  const entry = { id: "pl1", name: "MyPlaylist", tracks: "10" };
  const identity = getPlaylistIdentity(entry);
  assert.strictEqual(identity, "pl1");
});

test("rowsToCsv - Generiert CSV mit Headers", () => {
  const headers = ["Name", "Count"];
  const rows = [
    { Name: "A", Count: "1" },
    { Name: "B", Count: "2" },
  ];
  const csv = rowsToCsv(headers, rows);
  assert(csv.includes("Name,Count"));
  assert(csv.includes("A,1"));
  assert(csv.includes("B,2"));
});

test("rowsToCsv - Wendet csvEscape auf Werte an", () => {
  const headers = ["Value"];
  const rows = [{ Value: "hello, world" }];
  const csv = rowsToCsv(headers, rows);
  assert(csv.includes('"hello, world"'));
});

test("sanitizeSensitiveValue - Tiefe Objekte verarbeiten", () => {
  const value = {
    user: {
      name: "John",
      password: "secret123",
    },
  };
  const result = sanitizeSensitiveValue(value);
  assert.strictEqual(result.user.password, "[redacted]");
  assert.strictEqual(result.user.name, "John");
});

test("sanitizeSensitiveValue - Arrays verarbeiten", () => {
  const value = [
    { token: "xyz789" },
    { data: "public" },
  ];
  const result = sanitizeSensitiveValue(value);
  assert.strictEqual(result[0].token, "[redacted]");
  assert.strictEqual(result[1].data, "public");
});

test("RUN_SCHEMA_VERSION ist 2", () => {
  assert.strictEqual(RUN_SCHEMA_VERSION, 2);
});

test("LEGACY_VERSION_CUTOFF ist '1.1.0'", () => {
  assert.strictEqual(LEGACY_VERSION_CUTOFF, "1.1.0");
});

test("TRACK_CSV_HEADERS ist Array", () => {
  assert(Array.isArray(TRACK_CSV_HEADERS));
  assert(TRACK_CSV_HEADERS.length > 0);
  assert(TRACK_CSV_HEADERS.includes("trackId"));
  assert(TRACK_CSV_HEADERS.includes("playlistName"));
});

test("SUMMARY_CSV_HEADERS ist Array", () => {
  assert(Array.isArray(SUMMARY_CSV_HEADERS));
  assert(SUMMARY_CSV_HEADERS.length > 0);
  assert(SUMMARY_CSV_HEADERS.includes("trackFingerprint"));
});
