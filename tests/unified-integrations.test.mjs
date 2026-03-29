import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildUnifiedComponentMap,
  discoverProjectParts,
} from "../electron-app/integrations/project-discovery.mjs";
import {
  classifyTrackBatch,
  classifyTrackPerformance,
} from "../electron-app/integrations/performance-classifier.mjs";
import {
  buildM3uContent,
  exportM3uPlaylist,
} from "../electron-app/integrations/m3u-exporter.mjs";
import {
  buildOscMessage,
  sendOscSnapshot,
} from "../electron-app/integrations/osc-bridge.mjs";

async function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("Project-Discovery findet zusammengehörende Beatport-, Engine-, Ableton- und Gastro-Teile", async () => {
  const root = await makeTempRoot("unified-discovery-");
  const suiteDir = path.join(root, "Projects", "_local", "beatport-dj-suite");
  const engineDir = path.join(root, "Projects", "_github", "engine-dj-manager");
  const abletonDir = path.join(root, "Projects", "_local", "ableton-sketch-tool-repo");
  const gastroDir = path.join(root, "Projects", "_github", "gastro-erp");
  const hiddenDir = path.join(root, ".beatport-cache");

  await fs.mkdir(suiteDir, { recursive: true });
  await fs.mkdir(engineDir, { recursive: true });
  await fs.mkdir(abletonDir, { recursive: true });
  await fs.mkdir(gastroDir, { recursive: true });
  await fs.mkdir(hiddenDir, { recursive: true });

  await fs.writeFile(
    path.join(suiteDir, "package.json"),
    JSON.stringify({ name: "beatport-dj-suite", description: "Beatport engine workflow" }),
    "utf8"
  );
  await fs.writeFile(path.join(engineDir, "requirements.txt"), "sqlite3\nengine-tools\n", "utf8");
  await fs.writeFile(path.join(abletonDir, "set.maxpat"), "{}", "utf8");
  await fs.writeFile(path.join(gastroDir, "Dockerfile"), "FROM python:3.12\n# beatport bridge\n", "utf8");

  const discovery = await discoverProjectParts({ roots: [root] });
  const components = buildUnifiedComponentMap(discovery, suiteDir);

  assert.ok(discovery.summary.directoryMatches >= 4);
  assert.ok(discovery.summary.fileMatches >= 3);

  const gastro = components.find((entry) => entry.id === "gastro-erp");
  const engine = components.find((entry) => entry.id === "engine-tools");
  const osc = components.find((entry) => entry.id === "osc-vj");

  assert.equal(gastro?.status, "linked");
  assert.match(gastro?.path || "", /gastro-erp/);
  assert.match(engine?.path || "", /engine_tools\.py$/);
  assert.ok((osc?.sourcePaths || []).some((entry) => entry.includes("ableton-sketch-tool-repo")));
});

test("Performance-Classifier normalisiert BPM und erzeugt Stage-Summary", () => {
  const single = classifyTrackPerformance({
    title: "Peak Driver",
    artist: "Unit Test",
    bpm: 62,
    energy: 8,
    genre: "Tech House",
  });

  assert.equal(single.bpm, 124);
  assert.equal(single.stage, "peak-time");
  assert.ok(single.intensity > 0.8);

  const batch = classifyTrackBatch([
    { title: "Warmup", artist: "A", bpm: 110, genre: "Deep House" },
    { title: "Driver", artist: "B", bpm: 128, energy: 0.82, danceability: 0.76, genre: "Tech House" },
    { title: "Cooldown", artist: "C", bpm: 90, genre: "Ambient" },
  ]);

  assert.equal(batch.summary.count, 3);
  assert.equal(batch.topTracks.length, 3);
  assert.equal(batch.topTracks[0].title, "Warmup");
  assert.equal(batch.summary.stageCounts.drive, 2);
  assert.equal(batch.summary.stageCounts.cooldown, 1);
});

test("M3U-Exporter erzeugt EXTM3U-Inhalt und schreibt UTF-8-Playlisten", async () => {
  const tmpDir = await makeTempRoot("unified-m3u-");
  const outputPath = path.join(tmpDir, "engine-playlist.m3u8");
  const tracks = [
    {
      artist: "Artist One",
      title: "Track One",
      durationMs: 185000,
      genre: "Minimal / Deep Tech",
      location: "/Volumes/Music/Artist One - Track One.aiff",
    },
    {
      artist: "Artist Two",
      title: "Track Two",
      duration: 201,
      path: "/Volumes/Music/Artist Two - Track Two.wav",
    },
    {
      artist: "Skip Me",
      title: "No Path",
    },
  ];

  const content = buildM3uContent("QA Playlist", tracks);
  const result = await exportM3uPlaylist({
    name: "QA Playlist",
    tracks,
    outputPath,
  });

  assert.match(content, /#EXTM3U/);
  assert.match(content, /#PLAYLIST:QA Playlist/);
  assert.match(content, /#EXTINF:185,Artist One - Track One/);
  assert.equal(result.writtenCount, 2);
  assert.equal(result.format, "m3u8");
  assert.equal(await fs.readFile(outputPath, "utf8"), content);
});

test("OSC-Bridge baut gültige Pakete und sendet Snapshot-Nachrichten", async () => {
  const packet = buildOscMessage("/suite/test", [1, 0.5, "hello", true, false]);
  assert.ok(Buffer.isBuffer(packet));
  assert.match(packet.toString("utf8"), /\/suite\/test/);

  const dgram = await import("node:dgram");
  const sentPackets = [];
  const originalCreateSocket = dgram.default.createSocket;

  dgram.default.createSocket = () => ({
    once(_event, _handler) {},
    send(packetToSend, port, host, callback) {
      sentPackets.push({
        host,
        port,
        text: packetToSend.toString("utf8"),
      });
      callback(null);
    },
    close() {},
  });

  try {
    const result = await sendOscSnapshot({
      host: "127.0.0.1",
      port: 9911,
      addressPrefix: "/suite",
      summary: {
        count: 2,
        avgEnergy: 0.71,
        avgDanceability: 0.67,
        avgIntensity: 0.74,
      },
      tracks: [
        { title: "First", artist: "A", bpm: 124, intensity: 0.91, stage: "peak-time" },
        { title: "Second", artist: "B", bpm: 120, intensity: 0.62, stage: "drive" },
      ],
    });

    assert.equal(result.sentMessages, 3);
    assert.equal(sentPackets.length, 3);
    assert.ok(sentPackets.some((entry) => entry.text.includes("/suite/summary")));
    assert.equal(sentPackets.filter((entry) => entry.text.includes("/suite/track")).length, 2);
  } finally {
    dgram.default.createSocket = originalCreateSocket;
  }
});
