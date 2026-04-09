/**
 * export-formats.mjs — Rekordbox XML & Traktor NML Generator
 *
 * Erzeugt DJ-Software-kompatible Exportdateien aus Cache-Track-Daten.
 * Läuft im Main-Prozess (Node.js, kein Renderer).
 */

import fs from "node:fs/promises";
import path from "node:path";

// ─── XML-Hilfsfunktionen ────────────────────────────────────────────────────────

function xmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlAttr(key, value) {
  return `${key}="${xmlEscape(value)}"`;
}

// ─── Camelot → Rekordbox Tonality ───────────────────────────────────────────────

const CAMELOT_TO_OPENKEY = {
  "1A": "Abm",  "2A": "Ebm",  "3A": "Bbm",  "4A": "Fm",
  "5A": "Cm",   "6A": "Gm",   "7A": "Dm",    "8A": "Am",
  "9A": "Em",  "10A": "Bm",  "11A": "F#m",  "12A": "Dbm",
  "1B": "B",    "2B": "F#",   "3B": "Db",    "4B": "Ab",
  "5B": "Eb",   "6B": "Bb",   "7B": "F",     "8B": "C",
  "9B": "G",   "10B": "D",   "11B": "A",    "12B": "E",
};

function normalizeKeyForRekordbox(rawKey) {
  if (!rawKey) return "";
  const k = rawKey.trim();
  // Already Camelot notation?
  if (/^\d{1,2}[AB]$/i.test(k)) {
    return CAMELOT_TO_OPENKEY[k.toUpperCase()] || k;
  }
  // "C min" → "Cm", "C maj" → "C"
  return k.replace(/\s*min\s*$/i, "m").replace(/\s*maj\s*$/i, "");
}

// ─── Tracks gruppieren ──────────────────────────────────────────────────────────

function groupByPlaylist(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const key = t.playlistKey || t.playlistId || "unknown";
    if (!map.has(key)) {
      map.set(key, {
        playlistKey: key,
        playlistId: t.playlistId || "",
        playlistName: t.playlistName || key,
        tracks: [],
      });
    }
    map.get(key).tracks.push(t);
  }
  return [...map.values()];
}

function uniqueTracksById(tracks) {
  const seen = new Map();
  for (const t of tracks) {
    const id = t.trackId || `${t.trackTitle}_${t.artists}`;
    if (!seen.has(id)) {
      seen.set(id, t);
    }
  }
  return [...seen.values()];
}

// ─── Rekordbox XML ──────────────────────────────────────────────────────────────

export function generateRekordboxXml(tracks) {
  const playlists = groupByPlaylist(tracks);
  const allUnique = uniqueTracksById(tracks);

  // Track-ID → fortlaufende Nummer (Rekordbox braucht numerische IDs)
  const idMap = new Map();
  allUnique.forEach((t, i) => {
    const id = t.trackId || `${t.trackTitle}_${t.artists}`;
    idMap.set(id, i + 1);
  });

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<DJ_PLAYLISTS Version="1.0.0">');
  lines.push(`  <PRODUCT ${xmlAttr("Name", "Beatport DJ Suite")} ${xmlAttr("Version", "2.0.0")} Company=""/>`);

  // COLLECTION
  lines.push(`  <COLLECTION Entries="${allUnique.length}">`);
  for (const t of allUnique) {
    const tid = idMap.get(t.trackId || `${t.trackTitle}_${t.artists}`);
    const bpm = parseFloat(t.bpm) || 0;
    const tonality = normalizeKeyForRekordbox(t.key);
    lines.push(
      `    <TRACK ${xmlAttr("TrackID", String(tid))}` +
      ` ${xmlAttr("Name", t.trackTitle || "")}` +
      ` ${xmlAttr("Artist", t.artists || "")}` +
      ` ${xmlAttr("Genre", t.genre || "")}` +
      ` ${xmlAttr("Label", t.label || "")}` +
      ` ${xmlAttr("Mix", t.mixName || "")}` +
      ` ${xmlAttr("Tonality", tonality)}` +
      ` ${xmlAttr("AverageBpm", bpm.toFixed(2))}` +
      ` ${xmlAttr("Year", t.releaseYear || "")}` +
      ` />`
    );
  }
  lines.push("  </COLLECTION>");

  // PLAYLISTS
  lines.push("  <PLAYLISTS>");
  lines.push(`    <NODE Type="0" Name="ROOT" Count="${playlists.length}">`);
  for (const pl of playlists) {
    lines.push(`      <NODE ${xmlAttr("Name", pl.playlistName)} Type="1" KeyType="0" Entries="${pl.tracks.length}">`);
    for (const t of pl.tracks) {
      const tid = idMap.get(t.trackId || `${t.trackTitle}_${t.artists}`);
      lines.push(`        <TRACK Key="${tid}"/>`);
    }
    lines.push("      </NODE>");
  }
  lines.push("    </NODE>");
  lines.push("  </PLAYLISTS>");
  lines.push("</DJ_PLAYLISTS>");

  return lines.join("\n");
}

// ─── Traktor NML ────────────────────────────────────────────────────────────────

const KEY_TO_TRAKTOR = {
  "Cm": 0, "Dbm": 1, "Dm": 2, "Ebm": 3, "Em": 4, "Fm": 5,
  "F#m": 6, "Gbm": 6, "Gm": 7, "Abm": 8, "G#m": 8, "Am": 9,
  "Bbm": 10, "A#m": 10, "Bm": 11,
  "C": 12, "Db": 13, "C#": 13, "D": 14, "Eb": 15, "D#": 15,
  "E": 16, "F": 17, "F#": 18, "Gb": 18, "G": 19, "Ab": 20,
  "G#": 20, "A": 21, "Bb": 22, "A#": 22, "B": 23,
};

function traktorKeyValue(rawKey) {
  if (!rawKey) return -1;
  const normalized = normalizeKeyForRekordbox(rawKey);
  return KEY_TO_TRAKTOR[normalized] ?? -1;
}

export function generateTraktorNml(tracks) {
  const playlists = groupByPlaylist(tracks);
  const allUnique = uniqueTracksById(tracks);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  lines.push('<NML VERSION="19">')
  lines.push("  <HEAD COMPANY=\"Beatport DJ Suite\" PROGRAM=\"Beatport DJ Suite 2.0.0\"/>");
  lines.push("  <MUSICFOLDERS/>");

  // COLLECTION
  lines.push(`  <COLLECTION ENTRIES="${allUnique.length}">`);
  for (const t of allUnique) {
    const bpm = parseFloat(t.bpm) || 0;
    const keyVal = traktorKeyValue(t.key);
    const title = xmlEscape(t.trackTitle || "");
    const artist = xmlEscape(t.artists || "");

    lines.push("    <ENTRY>");
    lines.push(`      <LOCATION DIR="/:" FILE="${xmlEscape(t.trackId || title)}"/>`);
    lines.push(`      <ALBUM TITLE=""/>`);
    lines.push(`      <MODIFICATION_INFO/>`);
    lines.push(`      <INFO ${xmlAttr("GENRE", t.genre || "")} ${xmlAttr("LABEL", t.label || "")} ${xmlAttr("MIX", t.mixName || "")} ${xmlAttr("RELEASE_DATE", t.releaseYear || "")} PLAYCOUNT="0" RANKING="0"${keyVal >= 0 ? ` ${xmlAttr("KEY", String(keyVal))}` : ""}/>`);
    lines.push(`      <TEMPO ${xmlAttr("BPM", bpm.toFixed(6))} BPM_QUALITY="100"/>`);
    lines.push(`      <TITLE>${title}</TITLE>`);
    lines.push(`      <ARTIST>${artist}</ARTIST>`);
    lines.push("    </ENTRY>");
  }
  lines.push("  </COLLECTION>");

  // PLAYLISTS
  lines.push("  <PLAYLISTS>");
  lines.push(`    <NODE TYPE="FOLDER" NAME="$ROOT">`);
  lines.push(`      <SUBNODES COUNT="${playlists.length}">`);
  for (const pl of playlists) {
    lines.push(`        <NODE TYPE="PLAYLIST" NAME="${xmlEscape(pl.playlistName)}">`);
    lines.push(`          <PLAYLIST ENTRIES="${pl.tracks.length}" TYPE="LIST" UUID="">`);
    for (const t of pl.tracks) {
      const title = xmlEscape(t.trackTitle || t.trackId || "");
      lines.push(`            <ENTRY><PRIMARYKEY TYPE="TRACK" KEY="/://${title}"/></ENTRY>`);
    }
    lines.push("          </PLAYLIST>");
    lines.push("        </NODE>");
  }
  lines.push("      </SUBNODES>");
  lines.push("    </NODE>");
  lines.push("  </PLAYLISTS>");

  lines.push("</NML>");
  return lines.join("\n");
}

// ─── JSON / JSONL ───────────────────────────────────────────────────────────────

export function generateJson(tracks) {
  const playlists = groupByPlaylist(tracks);
  return JSON.stringify(playlists, null, 2);
}

export function generateJsonl(tracks) {
  const playlists = groupByPlaylist(tracks);
  return playlists.map((pl) => JSON.stringify(pl)).join("\n") + "\n";
}

// ─── Haupt-Export-Funktion ──────────────────────────────────────────────────────

function generateM3u(tracks) {
  const lines = ["#EXTM3U"];
  for (const t of tracks) {
    const duration = Math.round((t.lengthMs || t.length_ms || 0) / 1000);
    const artist = t.artist || t.artists || "";
    const title = t.title || "";
    const filename = t.filename || t.file_path || `${artist} - ${title}.mp3`;
    lines.push(`#EXTINF:${duration},${artist} - ${title}`);
    lines.push(filename);
  }
  return lines.join("\n") + "\n";
}

export async function generateExport(tracks, format, outputPath) {
  let content;
  let ext;

  switch (format) {
    case "rekordbox":
      content = generateRekordboxXml(tracks);
      ext = ".xml";
      break;
    case "traktor":
      content = generateTraktorNml(tracks);
      ext = ".nml";
      break;
    case "json":
      content = generateJson(tracks);
      ext = ".json";
      break;
    case "jsonl":
      content = generateJsonl(tracks);
      ext = ".jsonl";
      break;
    case "m3u":
      content = generateM3u(tracks);
      ext = ".m3u8";
      break;
    default:
      throw new Error(`Unbekanntes Export-Format: ${format}`);
  }

  const finalPath = outputPath.endsWith(ext) ? outputPath : outputPath + ext;
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.writeFile(finalPath, content, "utf-8");

  return {
    ok: true,
    format,
    path: finalPath,
    size: Buffer.byteLength(content, "utf-8"),
    trackCount: tracks.length,
    playlistCount: new Set(tracks.map((t) => t.playlistKey)).size,
  };
}
