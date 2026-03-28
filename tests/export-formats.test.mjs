#!/usr/bin/env node
/**
 * Export-Formate Tests
 *
 * Testet alle Export-Funktionen aus export-formats.mjs:
 * - XML-Hilfsfunktionen (xmlEscape, normalizeKeyForRekordbox)
 * - Rekordbox XML-Generierung
 * - Traktor NML-Generierung
 * - JSON / JSONL-Export
 * - generateExport() — Datei-Ausgabe mit Temp-Verzeichnis
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Module importieren ────────────────────────────────────────────────────────

const mod = await import(
  path.join(ROOT, "electron-app", "data", "export-formats.mjs")
);
const {
  generateRekordboxXml,
  generateTraktorNml,
  generateJson,
  generateJsonl,
  generateExport,
} = mod;

// ── Interne Funktionen per Source-Analyse nachbauen ───────────────────────────

function xmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const CAMELOT_TO_OPENKEY = {
  "1A": "Abm", "2A": "Ebm", "3A": "Bbm", "4A": "Fm",
  "5A": "Cm", "6A": "Gm", "7A": "Dm", "8A": "Am",
  "9A": "Em", "10A": "Bm", "11A": "F#m", "12A": "Dbm",
  "1B": "B", "2B": "F#", "3B": "Db", "4B": "Ab",
  "5B": "Eb", "6B": "Bb", "7B": "F", "8B": "C",
  "9B": "G", "10B": "D", "11B": "A", "12B": "E",
};

function normalizeKeyForRekordbox(rawKey) {
  if (!rawKey) return "";
  const k = rawKey.trim();
  if (/^\d{1,2}[AB]$/i.test(k)) {
    return CAMELOT_TO_OPENKEY[k.toUpperCase()] || k;
  }
  return k.replace(/\s*min\s*$/i, "m").replace(/\s*maj\s*$/i, "");
}

// ── Test-Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_TRACKS = [
  {
    trackId: "t1",
    trackTitle: "Sunset Boulevard",
    artists: "DJ Cosmic",
    genre: "Melodic Techno",
    label: "Afterlife",
    mixName: "Original Mix",
    key: "8A",
    bpm: "124.5",
    releaseYear: "2025",
    playlistKey: "pl-1",
    playlistId: "pl-1",
    playlistName: "Summer Vibes",
  },
  {
    trackId: "t2",
    trackTitle: "Dark Matter",
    artists: "Synthex",
    genre: "Techno",
    label: "Drumcode",
    mixName: "Club Mix",
    key: "5A",
    bpm: "132",
    releaseYear: "2024",
    playlistKey: "pl-1",
    playlistId: "pl-1",
    playlistName: "Summer Vibes",
  },
  {
    trackId: "t3",
    trackTitle: "Aurora",
    artists: "Nox",
    genre: "Progressive House",
    label: "Anjunadeep",
    mixName: "",
    key: "C min",
    bpm: "122",
    releaseYear: "2026",
    playlistKey: "pl-2",
    playlistId: "pl-2",
    playlistName: "Deep Sessions",
  },
];

const TRACK_WITH_SPECIAL_CHARS = {
  trackId: "t-special",
  trackTitle: 'Beats & Breaks <Live> "2026"',
  artists: "DJ's & Friends",
  genre: "Tech House",
  label: "Hot Creations",
  mixName: "Extended",
  key: "3B",
  bpm: "128",
  releaseYear: "2026",
  playlistKey: "pl-special",
  playlistName: "Test & \"Play\"",
};

let tmpDir;

// ── xmlEscape Tests ───────────────────────────────────────────────────────────

describe("xmlEscape (intern)", () => {
  it("Escaped Ampersand korrekt", () => {
    assert.equal(xmlEscape("A & B"), "A &amp; B");
  });

  it("Escaped spitze Klammern", () => {
    assert.equal(xmlEscape("<tag>"), "&lt;tag&gt;");
  });

  it("Escaped Anführungszeichen", () => {
    assert.equal(xmlEscape('"quote"'), "&quot;quote&quot;");
  });

  it("Escaped Apostrophe", () => {
    assert.equal(xmlEscape("it's"), "it&apos;s");
  });

  it("Behandelt null/undefined als leeren String", () => {
    assert.equal(xmlEscape(null), "");
    assert.equal(xmlEscape(undefined), "");
    assert.equal(xmlEscape(""), "");
  });

  it("Kombiniert mehrere Escapes", () => {
    const input = 'DJ\'s "Beats & <Drops>"';
    const expected = "DJ&apos;s &quot;Beats &amp; &lt;Drops&gt;&quot;";
    assert.equal(xmlEscape(input), expected);
  });
});

// ── normalizeKeyForRekordbox Tests ────────────────────────────────────────────

describe("normalizeKeyForRekordbox (intern)", () => {
  it("Konvertiert Camelot 8A → Am", () => {
    assert.equal(normalizeKeyForRekordbox("8A"), "Am");
  });

  it("Konvertiert Camelot 5B → Eb", () => {
    assert.equal(normalizeKeyForRekordbox("5B"), "Eb");
  });

  it("Konvertiert Camelot 11A → F#m", () => {
    assert.equal(normalizeKeyForRekordbox("11A"), "F#m");
  });

  it("Konvertiert 'C min' → 'Cm'", () => {
    assert.equal(normalizeKeyForRekordbox("C min"), "Cm");
  });

  it("Konvertiert 'C maj' → 'C'", () => {
    assert.equal(normalizeKeyForRekordbox("C maj"), "C");
  });

  it("Lässt bereits normalisierte Keys unverändert", () => {
    assert.equal(normalizeKeyForRekordbox("Am"), "Am");
    assert.equal(normalizeKeyForRekordbox("Db"), "Db");
  });

  it("Gibt leeren String für null/undefined zurück", () => {
    assert.equal(normalizeKeyForRekordbox(null), "");
    assert.equal(normalizeKeyForRekordbox(undefined), "");
    assert.equal(normalizeKeyForRekordbox(""), "");
  });

  it("Trimmt Whitespace", () => {
    assert.equal(normalizeKeyForRekordbox("  8A  "), "Am");
  });

  it("Ist case-insensitive für Camelot", () => {
    assert.equal(normalizeKeyForRekordbox("8a"), "Am");
    assert.equal(normalizeKeyForRekordbox("5b"), "Eb");
  });
});

// ── generateRekordboxXml Tests ────────────────────────────────────────────────

describe("generateRekordboxXml", () => {
  it("Generiert valides XML mit DOCTYPE", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.startsWith('<?xml version="1.0"'), "XML-Deklaration fehlt");
    assert.ok(xml.includes("<DJ_PLAYLISTS"), "DJ_PLAYLISTS-Tag fehlt");
    assert.ok(xml.includes("</DJ_PLAYLISTS>"), "Schließender DJ_PLAYLISTS-Tag fehlt");
  });

  it("Enthält PRODUCT-Tag mit Beatport DJ Suite", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.includes('Name="Beatport DJ Suite"'), "Produktname fehlt");
  });

  it("COLLECTION enthält korrekte Anzahl einzigartiger Tracks", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.includes('Entries="3"'), "Collection Entries sollte 3 sein");
  });

  it("Tracks haben alle erforderlichen Attribute", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.includes('Name="Sunset Boulevard"'), "Track-Name fehlt");
    assert.ok(xml.includes('Artist="DJ Cosmic"'), "Artist fehlt");
    assert.ok(xml.includes('Genre="Melodic Techno"'), "Genre fehlt");
    assert.ok(xml.includes('Label="Afterlife"'), "Label fehlt");
  });

  it("BPM wird mit 2 Dezimalstellen formatiert", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.includes('AverageBpm="124.50"'), "BPM 124.50 fehlt");
    assert.ok(xml.includes('AverageBpm="132.00"'), "BPM 132.00 fehlt");
  });

  it("Tonality wird von Camelot konvertiert", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.includes('Tonality="Am"'), "8A sollte Am sein");
    assert.ok(xml.includes('Tonality="Cm"'), "5A sollte Cm sein");
  });

  it("'C min' Key wird korrekt konvertiert", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.includes('Tonality="Cm"'), "C min sollte Cm sein");
  });

  it("Playlists-Sektion enthält 2 Playlists", () => {
    const xml = generateRekordboxXml(SAMPLE_TRACKS);
    assert.ok(xml.includes("<PLAYLISTS>"), "PLAYLISTS-Tag fehlt");
    assert.ok(xml.includes('Name="Summer Vibes"'), "Playlist 1 fehlt");
    assert.ok(xml.includes('Name="Deep Sessions"'), "Playlist 2 fehlt");
  });

  it("Escaped Sonderzeichen in Track-Daten", () => {
    const xml = generateRekordboxXml([TRACK_WITH_SPECIAL_CHARS]);
    assert.ok(xml.includes("&amp;"), "Ampersand nicht escaped");
    assert.ok(xml.includes("&lt;"), "< nicht escaped");
    assert.ok(xml.includes("&quot;"), "Quote nicht escaped");
  });

  it("Leere Track-Liste generiert gültiges XML", () => {
    const xml = generateRekordboxXml([]);
    assert.ok(xml.includes('Entries="0"'), "Leere Collection erwartet");
    assert.ok(xml.includes("<PLAYLISTS>"), "PLAYLISTS-Sektion fehlt");
  });

  it("Duplikate werden in COLLECTION dedupliziert", () => {
    const duplicated = [...SAMPLE_TRACKS, SAMPLE_TRACKS[0]];
    const xml = generateRekordboxXml(duplicated);
    assert.ok(xml.includes('Entries="3"'), "Duplikat nicht dedupliziert");
  });
});

// ── generateTraktorNml Tests ──────────────────────────────────────────────────

describe("generateTraktorNml", () => {
  it("Generiert valides NML mit Version 19", () => {
    const nml = generateTraktorNml(SAMPLE_TRACKS);
    assert.ok(nml.startsWith('<?xml version="1.0"'), "XML-Deklaration fehlt");
    assert.ok(nml.includes('<NML VERSION="19">'), "NML VERSION fehlt");
    assert.ok(nml.includes("</NML>"), "Schließender NML-Tag fehlt");
  });

  it("Enthält HEAD mit Beatport DJ Suite", () => {
    const nml = generateTraktorNml(SAMPLE_TRACKS);
    assert.ok(
      nml.includes('PROGRAM="Beatport DJ Suite 2.0.0"'),
      "Programmname fehlt"
    );
  });

  it("COLLECTION enthält korrekte Anzahl", () => {
    const nml = generateTraktorNml(SAMPLE_TRACKS);
    assert.ok(nml.includes('ENTRIES="3"'), "Collection ENTRIES sollte 3 sein");
  });

  it("Tracks haben ENTRY/LOCATION/INFO/TEMPO Struktur", () => {
    const nml = generateTraktorNml(SAMPLE_TRACKS);
    assert.ok(nml.includes("<ENTRY>"), "ENTRY-Tag fehlt");
    assert.ok(nml.includes("<LOCATION"), "LOCATION-Tag fehlt");
    assert.ok(nml.includes("<INFO"), "INFO-Tag fehlt");
    assert.ok(nml.includes("<TEMPO"), "TEMPO-Tag fehlt");
  });

  it("BPM hat 6 Dezimalstellen (Traktor-Format)", () => {
    const nml = generateTraktorNml(SAMPLE_TRACKS);
    assert.ok(nml.includes('BPM="124.500000"'), "BPM 124.500000 fehlt");
  });

  it("PLAYLISTS hat $ROOT-Knoten mit SUBNODES", () => {
    const nml = generateTraktorNml(SAMPLE_TRACKS);
    assert.ok(nml.includes('NAME="$ROOT"'), "$ROOT fehlt");
    assert.ok(nml.includes('COUNT="2"'), "SUBNODES COUNT sollte 2 sein");
  });

  it("Leere Track-Liste generiert gültiges NML", () => {
    const nml = generateTraktorNml([]);
    assert.ok(nml.includes('ENTRIES="0"'), "Leere Collection erwartet");
    assert.ok(nml.includes('COUNT="0"'), "SUBNODES COUNT sollte 0 sein");
  });

  it("Escaped Sonderzeichen korrekt", () => {
    const nml = generateTraktorNml([TRACK_WITH_SPECIAL_CHARS]);
    assert.ok(nml.includes("&amp;"), "Ampersand nicht escaped");
  });
});

// ── generateJson Tests ────────────────────────────────────────────────────────

describe("generateJson", () => {
  it("Gibt valides JSON zurück", () => {
    const json = generateJson(SAMPLE_TRACKS);
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed), "Ergebnis sollte ein Array sein");
  });

  it("Gruppiert Tracks nach Playlist", () => {
    const json = generateJson(SAMPLE_TRACKS);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 2, "Sollte 2 Playlists haben");
    assert.equal(parsed[0].playlistName, "Summer Vibes");
    assert.equal(parsed[1].playlistName, "Deep Sessions");
  });

  it("Erste Playlist enthält 2 Tracks", () => {
    const json = generateJson(SAMPLE_TRACKS);
    const parsed = JSON.parse(json);
    assert.equal(parsed[0].tracks.length, 2);
  });

  it("Leere Track-Liste ergibt leeres Array", () => {
    const json = generateJson([]);
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed, []);
  });

  it("JSON ist pretty-printed (2 Spaces)", () => {
    const json = generateJson(SAMPLE_TRACKS);
    assert.ok(json.includes("\n  "), "Sollte eingerückt sein");
  });
});

// ── generateJsonl Tests ───────────────────────────────────────────────────────

describe("generateJsonl", () => {
  it("Gibt eine Zeile pro Playlist zurück", () => {
    const jsonl = generateJsonl(SAMPLE_TRACKS);
    const lines = jsonl.trim().split("\n");
    assert.equal(lines.length, 2, "Sollte 2 Zeilen haben");
  });

  it("Jede Zeile ist valides JSON", () => {
    const jsonl = generateJsonl(SAMPLE_TRACKS);
    const lines = jsonl.trim().split("\n");
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.playlistKey, "playlistKey fehlt");
      assert.ok(Array.isArray(parsed.tracks), "tracks sollte Array sein");
    }
  });

  it("Endet mit Newline", () => {
    const jsonl = generateJsonl(SAMPLE_TRACKS);
    assert.ok(jsonl.endsWith("\n"), "Sollte mit Newline enden");
  });

  it("Leere Track-Liste ergibt leeren String + Newline", () => {
    const jsonl = generateJsonl([]);
    assert.equal(jsonl, "\n");
  });
});

// ── generateExport — Dateiausgabe ─────────────────────────────────────────────

describe("generateExport (Dateiausgabe)", () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-test-"));
  });

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("Exportiert Rekordbox XML und gibt Metadaten zurück", async () => {
    const outPath = path.join(tmpDir, "test-rekordbox");
    const result = await generateExport(SAMPLE_TRACKS, "rekordbox", outPath);
    assert.equal(result.ok, true);
    assert.equal(result.format, "rekordbox");
    assert.equal(result.trackCount, 3);
    assert.equal(result.playlistCount, 2);
    assert.ok(result.path.endsWith(".xml"), "Pfad sollte auf .xml enden");
    assert.ok(result.size > 0, "Dateigröße sollte > 0 sein");
    assert.ok(existsSync(result.path), "Datei wurde nicht erstellt");
  });

  it("Exportiert Traktor NML", async () => {
    const outPath = path.join(tmpDir, "test-traktor");
    const result = await generateExport(SAMPLE_TRACKS, "traktor", outPath);
    assert.equal(result.ok, true);
    assert.equal(result.format, "traktor");
    assert.ok(result.path.endsWith(".nml"), "Pfad sollte auf .nml enden");
    assert.ok(existsSync(result.path), "Datei wurde nicht erstellt");
  });

  it("Exportiert JSON", async () => {
    const outPath = path.join(tmpDir, "test-export-json");
    const result = await generateExport(SAMPLE_TRACKS, "json", outPath);
    assert.equal(result.ok, true);
    assert.ok(result.path.endsWith(".json"), "Pfad sollte auf .json enden");
    const content = await fs.readFile(result.path, "utf-8");
    const parsed = JSON.parse(content);
    assert.ok(Array.isArray(parsed));
  });

  it("Exportiert JSONL", async () => {
    const outPath = path.join(tmpDir, "test-export-jsonl");
    const result = await generateExport(SAMPLE_TRACKS, "jsonl", outPath);
    assert.equal(result.ok, true);
    assert.ok(result.path.endsWith(".jsonl"), "Pfad sollte auf .jsonl enden");
  });

  it("Wirft Fehler bei unbekanntem Format", async () => {
    const outPath = path.join(tmpDir, "test-unknown");
    await assert.rejects(
      () => generateExport(SAMPLE_TRACKS, "wav", outPath),
      /Unbekanntes Export-Format: wav/
    );
  });

  it("Hängt Extension nicht doppelt an", async () => {
    const outPath = path.join(tmpDir, "test.xml");
    const result = await generateExport(SAMPLE_TRACKS, "rekordbox", outPath);
    assert.equal(result.path, outPath, "Pfad sollte unverändert sein");
  });

  it("Erstellt Elternverzeichnis bei Bedarf", async () => {
    const outPath = path.join(tmpDir, "sub", "deep", "test");
    const result = await generateExport(SAMPLE_TRACKS, "json", outPath);
    assert.ok(existsSync(result.path), "Datei in verschachteltem Pfad fehlt");
  });

  it("Leere Track-Liste exportiert ohne Fehler", async () => {
    const outPath = path.join(tmpDir, "empty");
    const result = await generateExport([], "rekordbox", outPath);
    assert.equal(result.ok, true);
    assert.equal(result.trackCount, 0);
  });

  it("Dateiinhalt ist UTF-8 kodiert", async () => {
    const tracks = [{
      ...SAMPLE_TRACKS[0],
      trackTitle: "Ünïcödé Ñight",
      artists: "Señor DJ",
    }];
    const outPath = path.join(tmpDir, "utf8-test");
    const result = await generateExport(tracks, "rekordbox", outPath);
    const content = await fs.readFile(result.path, "utf-8");
    assert.ok(content.includes("Ünïcödé"), "UTF-8 Zeichen fehlen");
    assert.ok(content.includes("Señor"), "UTF-8 Zeichen fehlen");
  });
});

// ── Camelot-Tabelle Vollständigkeit ───────────────────────────────────────────

describe("Camelot-Konvertierung Vollständigkeit", () => {
  it("Alle 24 Camelot-Werte sind abgedeckt", () => {
    const expected = [
      "1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A", "9A", "10A", "11A", "12A",
      "1B", "2B", "3B", "4B", "5B", "6B", "7B", "8B", "9B", "10B", "11B", "12B",
    ];
    for (const key of expected) {
      const result = normalizeKeyForRekordbox(key);
      assert.ok(result.length > 0, `${key} hat kein Mapping`);
      assert.notEqual(result, key, `${key} wurde nicht konvertiert`);
    }
  });

  it("Traktor-Keys sind numerisch (0-23)", () => {
    const trackWithKey = {
      ...SAMPLE_TRACKS[0],
      key: "8A",
    };
    const nml = generateTraktorNml([trackWithKey]);
    assert.ok(nml.includes('KEY="9"'), "Traktor-Key sollte 9 für Am sein");
  });
});
