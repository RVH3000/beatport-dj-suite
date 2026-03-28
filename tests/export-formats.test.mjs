/**
 * export-formats.test.mjs — Tests für export-formats Modul
 *
 * Nutzt Node.js nativen Test-Runner (node:test + node:assert/strict)
 * Tests für Rekordbox XML, Traktor NML, JSON und JSONL Export
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  generateRekordboxXml,
  generateTraktorNml,
  generateJson,
  generateJsonl,
  generateExport,
} from "../electron-app/data/export-formats.mjs";

// ─── Test-Tracks ────────────────────────────────────────────────────────────

const sampleTracks = [
  {
    playlistKey: "pl1",
    playlistId: "id1",
    playlistName: "House Mix",
    trackId: "t1",
    trackTitle: "House Track & Title",
    artists: "Artist One",
    genre: "House",
    label: "Record Label",
    mixName: "Original Mix",
    bpm: 128.5,
    key: "5A", // Camelot → Cm
    releaseYear: 2023,
  },
  {
    playlistKey: "pl1",
    playlistId: "id1",
    playlistName: "House Mix",
    trackId: "t2",
    trackTitle: "Tech House <Track>",
    artists: "Artist Two",
    genre: "Tech House",
    label: "Another Label",
    mixName: "Extended Mix",
    bpm: 130,
    key: "8B", // Camelot → C
    releaseYear: 2024,
  },
  {
    playlistKey: "pl2",
    playlistId: "id2",
    playlistName: "Techno Vibes",
    trackId: "t3",
    trackTitle: "Minimal Techno",
    artists: "Artist Three",
    genre: "Techno",
    label: "Tech Label",
    mixName: "Original",
    bpm: 125.0,
    key: "C min", // Text-Format → Cm
    releaseYear: 2024,
  },
  {
    playlistKey: "pl2",
    playlistId: "id2",
    playlistName: "Techno Vibes",
    trackId: "t4",
    trackTitle: "Deep Minimal",
    artists: "Artist Four",
    genre: "Techno",
    label: "Deep Label",
    mixName: "Dub",
    bpm: 122.75,
    key: "C maj", // Text-Format → C
    releaseYear: 2023,
  },
];

// ─── Test Suite: generateRekordboxXml ────────────────────────────────────────

test("generateRekordboxXml - Erzeugt valides XML mit DJ_PLAYLISTS Root", () => {
  const xml = generateRekordboxXml(sampleTracks);
  assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<DJ_PLAYLISTS"));
  assert.ok(xml.includes("</DJ_PLAYLISTS>"));
});

test("generateRekordboxXml - Enthält COLLECTION mit korrekter Anzahl", () => {
  const xml = generateRekordboxXml(sampleTracks);
  // 4 unterschiedliche Tracks
  assert.ok(xml.includes('<COLLECTION Entries="4">'));
  // Alle 4 Tracks sollten in COLLECTION sein
  assert.ok(xml.includes('TrackID="1"'));
  assert.ok(xml.includes('TrackID="2"'));
  assert.ok(xml.includes('TrackID="3"'));
  assert.ok(xml.includes('TrackID="4"'));
});

test("generateRekordboxXml - Enthält PLAYLISTS-Knoten pro Playlist", () => {
  const xml = generateRekordboxXml(sampleTracks);
  // 2 Playlists
  assert.ok(xml.includes('Count="2"'));
  assert.ok(xml.includes('Name="House Mix"'));
  assert.ok(xml.includes('Name="Techno Vibes"'));
  assert.ok(xml.includes('Entries="2"')); // Beide Playlists haben 2 Tracks
});

test("generateRekordboxXml - Konvertiert Camelot-Keys korrekt (5A → Cm)", () => {
  const xml = generateRekordboxXml(sampleTracks);
  // 5A sollte zu Cm konvertiert werden
  assert.ok(xml.includes('Tonality="Cm"'));
  // 8B sollte zu C konvertiert werden
  assert.ok(xml.includes('Tonality="C"'));
});

test("generateRekordboxXml - XML-escapet Sonderzeichen in Tracknamen", () => {
  const xml = generateRekordboxXml(sampleTracks);
  // "House Track & Title" sollte zu "House Track &amp; Title"
  assert.ok(xml.includes("House Track &amp; Title"));
  // "<Track>" sollte zu "&lt;Track&gt;"
  assert.ok(xml.includes("Tech House &lt;Track&gt;"));
});

test("generateRekordboxXml - Leere Track-Liste erzeugt leeres XML", () => {
  const xml = generateRekordboxXml([]);
  assert.ok(xml.includes("<DJ_PLAYLISTS"));
  assert.ok(xml.includes('COLLECTION Entries="0"'));
  assert.ok(xml.includes('Count="0"'));
});

// ─── Test Suite: generateTraktorNml ──────────────────────────────────────────

test("generateTraktorNml - Erzeugt NML-Root mit Version 19", () => {
  const nml = generateTraktorNml(sampleTracks);
  assert.ok(nml.includes('<?xml version="1.0" encoding="UTF-8"'));
  assert.ok(nml.includes('<NML VERSION="19">'));
  assert.ok(nml.includes("</NML>"));
});

test("generateTraktorNml - Enthält ENTRY-Elemente pro Track", () => {
  const nml = generateTraktorNml(sampleTracks);
  // 4 unique tracks sollten mindestens 4 ENTRY-Elemente geben
  // (auch in COLLECTION und Playlists)
  const entryMatches = nml.match(/<ENTRY>/g);
  assert.ok(entryMatches && entryMatches.length >= 4);
});

test("generateTraktorNml - BPM hat 6 Dezimalstellen", () => {
  const nml = generateTraktorNml(sampleTracks);
  // 128.5 sollte zu 128.500000
  assert.ok(nml.includes('BPM="128.500000"'));
  // 130 sollte zu 130.000000
  assert.ok(nml.includes('BPM="130.000000"'));
  // 125.0 sollte zu 125.000000
  assert.ok(nml.includes('BPM="125.000000"'));
  // 122.75 sollte zu 122.750000
  assert.ok(nml.includes('BPM="122.750000"'));
});

test("generateTraktorNml - Leere Track-Liste erzeugt leeres NML", () => {
  const nml = generateTraktorNml([]);
  assert.ok(nml.includes('<NML VERSION="19">'));
  assert.ok(nml.includes('COLLECTION ENTRIES="0"'));
});

// ─── Test Suite: generateJson ───────────────────────────────────────────────

test("generateJson - Gruppiert Tracks nach Playlist", () => {
  const json = generateJson(sampleTracks);
  const parsed = JSON.parse(json);

  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 2); // 2 Playlists

  // Erste Playlist: House Mix
  assert.equal(parsed[0].playlistName, "House Mix");
  assert.equal(parsed[0].tracks.length, 2);
  assert.equal(parsed[0].tracks[0].trackId, "t1");
  assert.equal(parsed[0].tracks[1].trackId, "t2");

  // Zweite Playlist: Techno Vibes
  assert.equal(parsed[1].playlistName, "Techno Vibes");
  assert.equal(parsed[1].tracks.length, 2);
  assert.equal(parsed[1].tracks[0].trackId, "t3");
  assert.equal(parsed[1].tracks[1].trackId, "t4");
});

test("generateJson - Erzeugt valides JSON", () => {
  const json = generateJson(sampleTracks);
  assert.doesNotThrow(() => JSON.parse(json));
});

// ─── Test Suite: generateJsonl ──────────────────────────────────────────────

test("generateJsonl - Eine Zeile pro Playlist", () => {
  const jsonl = generateJsonl(sampleTracks);
  const lines = jsonl.split("\n").filter((line) => line.length > 0);
  assert.equal(lines.length, 2); // 2 Playlists
});

test("generateJsonl - Endet mit Newline", () => {
  const jsonl = generateJsonl(sampleTracks);
  assert.ok(jsonl.endsWith("\n"));
});

test("generateJsonl - Jede Zeile ist valides JSON", () => {
  const jsonl = generateJsonl(sampleTracks);
  const lines = jsonl.split("\n").filter((line) => line.length > 0);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

// ─── Test Suite: generateExport ─────────────────────────────────────────────

test("generateExport - Schreibt Rekordbox-XML auf Disk", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export");

  try {
    const result = await generateExport(sampleTracks, "rekordbox", outputPath);

    assert.equal(result.ok, true);
    assert.equal(result.format, "rekordbox");
    assert.ok(result.path.endsWith(".xml"));
    assert.ok(result.size > 0);
    assert.equal(result.trackCount, 4);
    assert.equal(result.playlistCount, 2);

    // Datei sollte existieren
    const content = await fs.readFile(result.path, "utf-8");
    assert.ok(content.includes("<DJ_PLAYLISTS"));
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Schreibt Traktor-NML auf Disk", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export");

  try {
    const result = await generateExport(sampleTracks, "traktor", outputPath);

    assert.equal(result.ok, true);
    assert.equal(result.format, "traktor");
    assert.ok(result.path.endsWith(".nml"));
    assert.ok(result.size > 0);
    assert.equal(result.trackCount, 4);
    assert.equal(result.playlistCount, 2);

    // Datei sollte existieren
    const content = await fs.readFile(result.path, "utf-8");
    assert.ok(content.includes('<NML VERSION="19">'));
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Schreibt JSON auf Disk", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export");

  try {
    const result = await generateExport(sampleTracks, "json", outputPath);

    assert.equal(result.ok, true);
    assert.equal(result.format, "json");
    assert.ok(result.path.endsWith(".json"));
    assert.ok(result.size > 0);

    const content = await fs.readFile(result.path, "utf-8");
    const parsed = JSON.parse(content);
    assert.equal(Array.isArray(parsed), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Schreibt JSONL auf Disk", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export");

  try {
    const result = await generateExport(sampleTracks, "jsonl", outputPath);

    assert.equal(result.ok, true);
    assert.equal(result.format, "jsonl");
    assert.ok(result.path.endsWith(".jsonl"));
    assert.ok(result.size > 0);

    const content = await fs.readFile(result.path, "utf-8");
    const lines = content.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 2);
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Wirft Fehler bei unbekanntem Format", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export");

  try {
    await assert.rejects(
      () => generateExport(sampleTracks, "unknown", outputPath),
      /Unbekanntes Export-Format/
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Fügt korrekte Dateiendung hinzu", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export"); // Keine Endung

  try {
    // Rekordbox
    const result1 = await generateExport(sampleTracks, "rekordbox", outputPath);
    assert.ok(result1.path.endsWith(".xml"));

    // Traktor
    const result2 = await generateExport(
      sampleTracks,
      "traktor",
      path.join(tmpDir, "export2")
    );
    assert.ok(result2.path.endsWith(".nml"));

    // JSON
    const result3 = await generateExport(
      sampleTracks,
      "json",
      path.join(tmpDir, "export3")
    );
    assert.ok(result3.path.endsWith(".json"));

    // JSONL
    const result4 = await generateExport(
      sampleTracks,
      "jsonl",
      path.join(tmpDir, "export4")
    );
    assert.ok(result4.path.endsWith(".jsonl"));
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Überschreibt nicht Dateiendung wenn bereits vorhanden", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export.xml"); // Mit Endung

  try {
    const result = await generateExport(sampleTracks, "rekordbox", outputPath);
    assert.equal(result.path, outputPath); // Sollte nicht .xml.xml sein
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Gibt trackCount und playlistCount zurück", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const outputPath = path.join(tmpDir, "export");

  try {
    const result = await generateExport(sampleTracks, "rekordbox", outputPath);

    assert.equal(result.trackCount, 4);
    assert.equal(result.playlistCount, 2);
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

test("generateExport - Erstellt Verzeichnisse wenn nötig", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  const nestedPath = path.join(tmpDir, "deeply", "nested", "path", "export");

  try {
    const result = await generateExport(sampleTracks, "rekordbox", nestedPath);

    assert.ok(result.path);
    const content = await fs.readFile(result.path, "utf-8");
    assert.ok(content.includes("<DJ_PLAYLISTS"));
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
});

// ─── Edge Cases und spezielle Tests ──────────────────────────────────────────

test("Handles Tracks ohne trackId", () => {
  const tracksWithoutId = [
    {
      playlistKey: "pl1",
      playlistName: "Mix",
      trackTitle: "Track One",
      artists: "Artist",
      bpm: 120,
    },
  ];

  const xml = generateRekordboxXml(tracksWithoutId);
  assert.ok(xml.includes("<DJ_PLAYLISTS"));
  assert.ok(xml.includes("COLLECTION Entries="));

  const nml = generateTraktorNml(tracksWithoutId);
  assert.ok(nml.includes("<NML"));
});

test("Handles Tracks mit fehlenden optionalen Feldern", () => {
  const minimalTracks = [
    {
      playlistKey: "pl1",
      playlistName: "Mix",
      trackId: "t1",
      trackTitle: "Track",
    },
  ];

  assert.doesNotThrow(() => generateRekordboxXml(minimalTracks));
  assert.doesNotThrow(() => generateTraktorNml(minimalTracks));
  assert.doesNotThrow(() => generateJson(minimalTracks));
  assert.doesNotThrow(() => generateJsonl(minimalTracks));
});

test("Normalisiert Keys mit Großbuchstaben korrekt", () => {
  const tracksWithUppercase = [
    {
      playlistKey: "pl1",
      playlistName: "Mix",
      trackId: "t1",
      trackTitle: "Track",
      key: "5A",
    },
    {
      playlistKey: "pl1",
      playlistName: "Mix",
      trackId: "t2",
      trackTitle: "Track 2",
      key: "5a", // Kleinbuchstabe
    },
  ];

  const xml = generateRekordboxXml(tracksWithUppercase);
  const matches = xml.match(/Tonality="Cm"/g);
  assert.ok(matches && matches.length >= 2);
});

test("Behandelt BPM als Float korrekt", () => {
  const tracksWithDifferentBpm = [
    {
      playlistKey: "pl1",
      playlistName: "Mix",
      trackId: "t1",
      trackTitle: "Track",
      bpm: "128.5", // String
    },
    {
      playlistKey: "pl1",
      playlistName: "Mix",
      trackId: "t2",
      trackTitle: "Track 2",
      bpm: 130, // Number
    },
  ];

  const xml = generateRekordboxXml(tracksWithDifferentBpm);
  assert.ok(xml.includes("AverageBpm="));

  const nml = generateTraktorNml(tracksWithDifferentBpm);
  assert.ok(nml.includes('BPM="128.500000"'));
  assert.ok(nml.includes('BPM="130.000000"'));
});
