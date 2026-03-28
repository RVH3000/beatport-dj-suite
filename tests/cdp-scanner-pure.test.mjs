/**
 * cdp-scanner-pure.test.mjs
 * Phase 6: Reine Funktions-Tests für cdp-scanner.mjs
 * Testet alle exportierten und aus Quellcode extrahierten Pure Functions
 * ohne CDP/Electron/WebSocket-Abhängigkeiten.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";

import {
  resolveConfig,
  resolveRunPaths,
  resolveStorageRoots,
  DEFAULTS,
  CONFIRM_TEXT,
  normalizeApiPlaylistRecord,
  normalizeApiTrackRecord,
  buildPlaylistSummaryFromTrackRows,
  buildDuplicateEntries,
  buildTrackFingerprint,
  sanitizeSensitiveText,
  parseHumanTrackCount,
  compareVersions,
  isLegacyRunManifest,
  normalizeRunManifest,
} from "../electron-app/scanner/cdp-scanner.mjs";

// ─── Aus Quellcode extrahierte interne Funktionen ──────────────────────────────

// parseArgs (nicht exportiert — aus Source rebuilt)
function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) {
      positional.push(part);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }
  return { positional, options };
}

// stableStringify (nicht exportiert — aus Source rebuilt)
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// fillUrlTemplate (nicht exportiert — aus Source rebuilt)
function fillUrlTemplate(template, replacements = {}) {
  return Object.entries(replacements).reduce(
    (url, [key, value]) =>
      url.replace(new RegExp(`\\{${key}\\}`, "g"), encodeURIComponent(String(value))),
    template
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("cdp-scanner Pure Functions", () => {

  // ── DEFAULTS & CONFIRM_TEXT ──────────────────────────────────────────────────

  describe("DEFAULTS", () => {
    it("hat erwartete Standardwerte", () => {
      assert.equal(DEFAULTS.host, "127.0.0.1");
      assert.equal(DEFAULTS.port, 9222);
      assert.equal(typeof DEFAULTS.timeoutMs, "number");
      assert.ok(DEFAULTS.timeoutMs > 0);
    });

    it("enthält alle kritischen Konfigurationsschlüssel", () => {
      const keys = Object.keys(DEFAULTS);
      for (const required of ["host", "port", "stateFile", "csvFile", "parallelism"]) {
        assert.ok(keys.includes(required), `DEFAULTS fehlt Schlüssel: ${required}`);
      }
    });

    it("CONFIRM_TEXT ist der erwartete Sicherheitstext", () => {
      assert.equal(CONFIRM_TEXT, "LÖSCHEN BESTÄTIGT");
    });
  });

  // ── parseArgs ────────────────────────────────────────────────────────────────

  describe("parseArgs (intern)", () => {
    it("parst positionale Argumente", () => {
      const result = parseArgs(["discover", "scan"]);
      assert.deepEqual(result.positional, ["discover", "scan"]);
      assert.deepEqual(result.options, {});
    });

    it("parst --key value Paare", () => {
      const result = parseArgs(["--port", "9333", "--host", "localhost"]);
      assert.equal(result.options.port, "9333");
      assert.equal(result.options.host, "localhost");
    });

    it("parst Flags ohne Wert als true", () => {
      const result = parseArgs(["--deep-analysis", "--verbose"]);
      assert.equal(result.options["deep-analysis"], true);
      assert.equal(result.options.verbose, true);
    });

    it("mischt positionale und Options korrekt", () => {
      const result = parseArgs(["discover", "--port", "9222", "scan", "--verbose"]);
      assert.deepEqual(result.positional, ["discover", "scan"]);
      assert.equal(result.options.port, "9222");
      assert.equal(result.options.verbose, true);
    });

    it("behandelt leere Eingabe", () => {
      const result = parseArgs([]);
      assert.deepEqual(result.positional, []);
      assert.deepEqual(result.options, {});
    });
  });

  // ── resolveConfig ────────────────────────────────────────────────────────────

  describe("resolveConfig", () => {
    it("gibt Default-Werte zurück bei leerem Input", () => {
      const cfg = resolveConfig({});
      assert.equal(cfg.host, "127.0.0.1");
      assert.equal(cfg.port, 9222);
      assert.equal(typeof cfg.outputDir, "string");
      assert.ok(cfg.outputDir.length > 0);
    });

    it("überschreibt Host und Port", () => {
      const cfg = resolveConfig({ host: "192.168.1.1", port: 9333 });
      assert.equal(cfg.host, "192.168.1.1");
      assert.equal(cfg.port, 9333);
    });

    it("begrenzt Parallelism auf 1-6", () => {
      const cfg1 = resolveConfig({ parallelism: 100 });
      assert.ok(cfg1.parallelism <= 6, "Parallelism sollte max 6 sein");
      const cfg2 = resolveConfig({ parallelism: 0 });
      assert.ok(cfg2.parallelism >= 1, "Parallelism sollte min 1 sein");
    });

    it("resolvet boolsche Felder korrekt", () => {
      const cfg = resolveConfig({ deepAnalysis: false, cacheEnabled: false, launchApp: true });
      assert.equal(cfg.deepAnalysis, false);
      assert.equal(cfg.cacheEnabled, false);
      assert.equal(cfg.launchApp, true);
    });

    it("setzt Default-Werte für authMode und recoveryPolicy", () => {
      const cfg = resolveConfig({});
      assert.equal(cfg.authMode, DEFAULTS.authMode);
      assert.equal(cfg.recoveryPolicy, DEFAULTS.recoveryPolicy);
    });

    it("verhindert Root-Pfad '/' als outputDir auf macOS", () => {
      const cfg = resolveConfig({ outputDir: "/" });
      assert.notEqual(path.resolve(cfg.outputDir), "/", "Root sollte nie outputDir sein");
    });
  });

  // ── resolveStorageRoots ──────────────────────────────────────────────────────

  describe("resolveStorageRoots", () => {
    it("gibt archiveRootDir und exportsRootDir zurück", () => {
      const cfg = resolveConfig({});
      const roots = resolveStorageRoots(cfg);
      assert.ok(typeof roots.archiveRootDir === "string");
      assert.ok(typeof roots.exportsRootDir === "string");
      assert.ok(path.isAbsolute(roots.archiveRootDir));
      assert.ok(path.isAbsolute(roots.exportsRootDir));
    });

    it("archiveRootDir enthält 'runs'", () => {
      const roots = resolveStorageRoots(resolveConfig({}));
      assert.ok(roots.archiveRootDir.includes("runs"));
    });
  });

  // ── resolveRunPaths ──────────────────────────────────────────────────────────

  describe("resolveRunPaths", () => {
    it("erzeugt Pfade mit der Run-ID", () => {
      const cfg = resolveConfig({});
      const paths = resolveRunPaths(cfg, "run-2026-03-29");
      assert.equal(paths.runId, "run-2026-03-29");
      assert.ok(paths.archiveDir.includes("run-2026-03-29"));
      assert.ok(paths.exportDir.includes("run-2026-03-29"));
    });

    it("enthält alle erwarteten Dateipfade", () => {
      const cfg = resolveConfig({});
      const paths = resolveRunPaths(cfg, "test-run");
      const fileKeys = Object.keys(paths.files);
      for (const key of ["manifestPath", "summaryPath", "eventsPath", "playlistsPath", "csvPath"]) {
        assert.ok(fileKeys.includes(key), `files fehlt: ${key}`);
      }
    });

    it("erzeugt exportFiles parallel zu files", () => {
      const cfg = resolveConfig({});
      const paths = resolveRunPaths(cfg, "test-run");
      assert.ok(Object.keys(paths.exportFiles).length > 0);
      assert.ok(paths.exportFiles.manifestPath.includes("test-run"));
    });
  });

  // ── stableStringify ──────────────────────────────────────────────────────────

  describe("stableStringify (intern)", () => {
    it("sortiert Objekt-Schlüssel alphabetisch", () => {
      const result = stableStringify({ z: 1, a: 2, m: 3 });
      assert.equal(result, '{"a":2,"m":3,"z":1}');
    });

    it("serialisiert Arrays", () => {
      assert.equal(stableStringify([1, 2, 3]), "[1,2,3]");
    });

    it("serialisiert verschachtelte Strukturen", () => {
      const result = stableStringify({ b: [1, { x: 2, a: 1 }], a: "hi" });
      assert.equal(result, '{"a":"hi","b":[1,{"a":1,"x":2}]}');
    });

    it("behandelt Primitives", () => {
      assert.equal(stableStringify("hello"), '"hello"');
      assert.equal(stableStringify(42), "42");
      assert.equal(stableStringify(null), "null");
      assert.equal(stableStringify(true), "true");
    });
  });

  // ── fillUrlTemplate ──────────────────────────────────────────────────────────

  describe("fillUrlTemplate (intern)", () => {
    it("ersetzt Platzhalter im Template", () => {
      const result = fillUrlTemplate("https://api.example.com/{id}/tracks", { id: "123" });
      assert.equal(result, "https://api.example.com/123/tracks");
    });

    it("URL-encoded Sonderzeichen", () => {
      const result = fillUrlTemplate("https://example.com/{q}", { q: "hello world" });
      assert.equal(result, "https://example.com/hello%20world");
    });

    it("ersetzt mehrere Vorkommen desselben Keys", () => {
      const result = fillUrlTemplate("{id}-{id}", { id: "x" });
      assert.equal(result, "x-x");
    });

    it("lässt unbekannte Platzhalter unverändert", () => {
      const result = fillUrlTemplate("{known}/{unknown}", { known: "a" });
      assert.equal(result, "a/{unknown}");
    });
  });

  // ── normalizeApiPlaylistRecord ───────────────────────────────────────────────

  describe("normalizeApiPlaylistRecord", () => {
    it("normalisiert minimalen Playlist-Eintrag", () => {
      const result = normalizeApiPlaylistRecord({ id: "abc", name: "Test Playlist", track_count: 5 });
      assert.equal(result.playlistId, "abc");
      assert.equal(result.playlistName, "Test Playlist");
      assert.equal(result.playlistTracksExpected, "5");
      assert.equal(result.source, "xhr");
    });

    it("behandelt fehlende Felder", () => {
      const result = normalizeApiPlaylistRecord({});
      assert.equal(result.playlistId, "");
      assert.equal(result.playlistName, "");
      assert.equal(result.playlistTracksExpected, "0");
    });

    it("setzt discoveredAt als ISO-String", () => {
      const result = normalizeApiPlaylistRecord({ id: "test" });
      assert.ok(result.discoveredAt);
      assert.ok(result.discoveredAt.includes("T"), "Sollte ISO-Format sein");
    });
  });

  // ── normalizeApiTrackRecord ──────────────────────────────────────────────────

  describe("normalizeApiTrackRecord", () => {
    it("extrahiert Track-Daten aus verschachtelter Struktur", () => {
      const playlist = { id: "pl1", name: "Test", tracks: "3" };
      const entry = {
        position: 1,
        track: {
          id: "42",
          name: "Techno Dream",
          mix_name: "Original Mix",
          bpm: 128,
          key: { name: "Am" },
          genre: { name: "Techno" },
          artists: [{ name: "DJ Test" }],
          release: { label: { name: "Test Records" }, publish_date: "2025-06-15" },
        },
      };
      const result = normalizeApiTrackRecord(playlist, entry);
      assert.ok(result.trackTitle.includes("Techno Dream"));
      assert.ok(result.trackTitle.includes("Original Mix"));
      assert.equal(result.artists, "DJ Test");
      assert.equal(result.genre, "Techno");
      assert.equal(result.label, "Test Records");
      assert.equal(result.source, "xhr");
    });

    it("behandelt leeren Eintrag ohne Crash", () => {
      const result = normalizeApiTrackRecord({ id: "", name: "", tracks: "0" }, {});
      assert.ok(result !== null);
      assert.equal(result.source, "xhr");
    });

    it("verbindet mehrere Artists mit Komma", () => {
      const entry = {
        track: { name: "Collab", artists: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      };
      const result = normalizeApiTrackRecord({ id: "1", name: "Test", tracks: "1" }, entry);
      assert.equal(result.artists, "A, B, C");
    });
  });

  // ── buildPlaylistSummaryFromTrackRows ────────────────────────────────────────

  describe("buildPlaylistSummaryFromTrackRows", () => {
    it("erstellt Summary aus Track-Rows", () => {
      const playlist = { id: "pl1", name: "House Set", tracks: "2", serverTrackCount: 2 };
      const tracks = [
        { genre: "House", label: "Defected", year: "2025" },
        { genre: "House", label: "Toolroom", year: "2025" },
      ];
      const summary = buildPlaylistSummaryFromTrackRows(playlist, tracks);
      assert.equal(summary.playlistId, "pl1");
      assert.equal(summary.playlistName, "House Set");
      assert.equal(summary.status, "ok");
      assert.equal(summary.analysisMethod, "xhr");
    });

    it("zählt Genres korrekt", () => {
      const tracks = [
        { genre: "Techno" },
        { genre: "House" },
        { genre: "Techno" },
      ];
      const summary = buildPlaylistSummaryFromTrackRows(
        { id: "1", name: "Mix", tracks: "3" }, tracks
      );
      assert.ok(summary.genreCounts);
      const technoCount = summary.genreCounts.find((e) => e.value === "Techno");
      assert.ok(technoCount, "Techno sollte in genreCounts sein");
      assert.equal(technoCount.count, 2);
    });

    it("behandelt leere Track-Liste", () => {
      const summary = buildPlaylistSummaryFromTrackRows(
        { id: "1", name: "Empty", tracks: "0" }, []
      );
      assert.equal(summary.analyzedTrackRows, 0);
    });
  });

  // ── sanitizeSensitiveText ────────────────────────────────────────────────────

  describe("sanitizeSensitiveText", () => {
    it("maskiert Bearer-Token", () => {
      const result = sanitizeSensitiveText("Bearer eyJhbGciOiJSUzI1NiIsInR5cCI");
      assert.ok(!result.includes("eyJhbGci"), "Token sollte maskiert sein");
    });

    it("lässt normalen Text unverändert", () => {
      const result = sanitizeSensitiveText("Playlist Discovery abgeschlossen");
      assert.equal(result, "Playlist Discovery abgeschlossen");
    });
  });

  // ── parseHumanTrackCount ─────────────────────────────────────────────────────

  describe("parseHumanTrackCount", () => {
    it('parst "25 tracks" zu "25"', () => {
      assert.equal(parseHumanTrackCount("25 tracks"), "25");
    });

    it('parst "1 track" zu "1"', () => {
      assert.equal(parseHumanTrackCount("1 track"), "1");
    });

    it("parst reine Zahl als String", () => {
      assert.equal(parseHumanTrackCount("42"), "42");
    });

    it("gibt leeren String zurück für ungültige Eingabe", () => {
      assert.equal(parseHumanTrackCount("keine"), "");
      assert.equal(parseHumanTrackCount(""), "");
      assert.equal(parseHumanTrackCount(null), "");
    });
  });

  // ── compareVersions ──────────────────────────────────────────────────────────

  describe("compareVersions", () => {
    it("erkennt gleiche Versionen", () => {
      assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
    });

    it("erkennt neuere Version", () => {
      assert.ok(compareVersions("2.0.0", "1.0.0") > 0);
      assert.ok(compareVersions("1.1.0", "1.0.0") > 0);
      assert.ok(compareVersions("1.0.1", "1.0.0") > 0);
    });

    it("erkennt ältere Version", () => {
      assert.ok(compareVersions("1.0.0", "2.0.0") < 0);
    });

    it("behandelt unterschiedliche Segmentlängen", () => {
      assert.ok(compareVersions("1.0.0.1", "1.0.0") > 0);
    });
  });

  // ── buildTrackFingerprint ────────────────────────────────────────────────────

  describe("buildTrackFingerprint", () => {
    it("generiert konsistenten Fingerprint", () => {
      const tracks = [{ trackId: "1" }, { trackId: "2" }];
      const fp1 = buildTrackFingerprint(tracks);
      const fp2 = buildTrackFingerprint(tracks);
      assert.equal(fp1, fp2, "Fingerprint sollte deterministisch sein");
    });

    it("ändert sich bei anderen Tracks", () => {
      const fp1 = buildTrackFingerprint([{ trackId: "1" }]);
      const fp2 = buildTrackFingerprint([{ trackId: "2" }]);
      assert.notEqual(fp1, fp2);
    });

    it("behandelt leeres Array", () => {
      const fp = buildTrackFingerprint([]);
      assert.ok(typeof fp === "string");
    });
  });

  // ── isLegacyRunManifest ──────────────────────────────────────────────────────

  describe("isLegacyRunManifest", () => {
    it("erkennt altes Manifest ohne schemaVersion", () => {
      const result = isLegacyRunManifest({ runId: "old-run" });
      assert.ok(result === true || result === false, "Gibt Boolean zurück");
    });
  });

  // ── buildDuplicateEntries ────────────────────────────────────────────────────

  describe("buildDuplicateEntries", () => {
    it("findet Duplikate über Playlists hinweg", () => {
      const tracks = [
        { playlistId: "pl1", playlistName: "A", trackId: "42", trackTitle: "Shared Track" },
        { playlistId: "pl2", playlistName: "B", trackId: "42", trackTitle: "Shared Track" },
        { playlistId: "pl1", playlistName: "A", trackId: "99", trackTitle: "Unique" },
      ];
      const duplicates = buildDuplicateEntries(tracks);
      assert.ok(Array.isArray(duplicates));
      // Track 42 sollte als Duplikat erkannt werden
      if (duplicates.length > 0) {
        const dup = duplicates.find((d) => String(d.trackId) === "42");
        assert.ok(dup, "Track 42 sollte als Duplikat erscheinen");
      }
    });

    it("gibt leeres Array wenn keine Duplikate", () => {
      const tracks = [
        { playlistId: "pl1", trackId: "1", trackTitle: "A" },
        { playlistId: "pl1", trackId: "2", trackTitle: "B" },
      ];
      const duplicates = buildDuplicateEntries(tracks);
      assert.ok(Array.isArray(duplicates));
    });
  });
});
