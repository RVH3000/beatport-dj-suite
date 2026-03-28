#!/usr/bin/env node
/**
 * lexicon_api_tool.mjs — CLI für die Lexicon DJ Local API
 *
 * Verbindet sich mit der lokalen Lexicon DJ API (http://localhost:48624)
 * und bietet Zugriff auf Playlisten, Tracks, Suche, Export und Statistiken.
 *
 * Verwendung:
 *   node tools/lexicon_api_tool.mjs list
 *   node tools/lexicon_api_tool.mjs playlist 42
 *   node tools/lexicon_api_tool.mjs track 1337
 *   node tools/lexicon_api_tool.mjs search "deadmau5"
 *   node tools/lexicon_api_tool.mjs tags
 *   node tools/lexicon_api_tool.mjs export 42 csv
 *   node tools/lexicon_api_tool.mjs stats
 *   node tools/lexicon_api_tool.mjs sync-check
 *   node tools/lexicon_api_tool.mjs compare 42 99
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";

// ─── ANSI Colors ────────────────────────────────────────────────────────────

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
};

let useColor = process.stdout.isTTY;

function c(color, text) {
  return useColor ? `${color}${text}${C.reset}` : text;
}

// ─── Argument Parser ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const [key, val] = a.slice(2).split("=");
      args.flags[key] = val !== undefined ? val : true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ─── API Client ──────────────────────────────────────────────────────────────

const PORTS = [48624, 11011];

async function detectBaseUrl() {
  for (const port of PORTS) {
    const url = `http://localhost:${port}`;
    try {
      const res = await fetch(`${url}/v1/playlists`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return url;
    } catch {
      // port not available
    }
  }
  return null;
}

async function apiGet(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ": " + body.slice(0, 200) : ""}`);
  }
  return res.json();
}

async function getAllTracks(baseUrl, onProgress) {
  const limit = 500;
  let offset = 0;
  let total = null;
  const all = [];

  do {
    const data = await apiGet(baseUrl, `/v1/tracks?limit=${limit}&offset=${offset}`);
    // API may return { tracks: [...], total: N } or just an array
    const tracks = Array.isArray(data) ? data : (data.tracks || data.items || data.data || []);
    if (total === null) {
      total = data.total ?? data.count ?? tracks.length;
    }
    all.push(...tracks);
    offset += limit;
    if (onProgress) onProgress(all.length, total);
    if (tracks.length < limit) break;
  } while (all.length < total);

  return all;
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function pad(str, len, right = false) {
  const s = String(str ?? "");
  const trimmed = s.length > len ? s.slice(0, len - 1) + "…" : s;
  return right ? trimmed.padStart(len) : trimmed.padEnd(len);
}

function printTable(rows, cols) {
  // cols: [{ key, label, width, right }]
  const header = cols.map(col => c(C.bold + C.cyan, pad(col.label, col.width, col.right))).join("  ");
  const divider = c(C.gray, cols.map(col => "─".repeat(col.width)).join("  "));
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    const line = cols.map(col => {
      const val = col.format ? col.format(row[col.key], row) : row[col.key];
      return pad(val ?? "—", col.width, col.right);
    }).join("  ");
    console.log(line);
  }
}

function formatKey(key) {
  if (!key) return "—";
  return key;
}

function formatBpm(bpm) {
  if (!bpm) return "—";
  return Number(bpm).toFixed(0);
}

function printTree(nodes, prefix = "", isLast = true) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const last = i === nodes.length - 1;
    const connector = last ? "└─" : "├─";
    const childPrefix = prefix + (last ? "   " : "│  ");
    const name = c(C.white, node.name || node.title || `[${node.id}]`);
    const meta = node.trackCount != null
      ? c(C.gray, ` (${node.trackCount} Tracks, ID: ${node.id})`)
      : c(C.gray, ` (ID: ${node.id})`);
    console.log(`${c(C.gray, prefix + connector)} ${name}${meta}`);
    if (node.children && node.children.length > 0) {
      printTree(node.children, childPrefix, last);
    }
    if (node.playlists && node.playlists.length > 0) {
      printTree(node.playlists, childPrefix, last);
    }
  }
}

function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdList(baseUrl, args) {
  const data = await apiGet(baseUrl, "/v1/playlists");

  if (args.flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Normalize: API may return array or { playlists: [...] } or { folders: [...] }
  const tree = Array.isArray(data) ? data : (data.playlists || data.folders || data.items || [data]);

  console.log(c(C.bold, "\nLexicon Playlists\n"));
  printTree(tree);
  console.log();
}

async function cmdPlaylist(baseUrl, args) {
  const id = args._[1];
  if (!id) {
    console.error(c(C.red, "Fehler: Playlist-ID erforderlich. Beispiel: playlist 42"));
    process.exit(1);
  }

  const data = await apiGet(baseUrl, `/v1/playlist?id=${id}`);
  const trackIds = data.trackIds || data.tracks || [];

  if (args.flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const name = data.name || data.title || `Playlist ${id}`;
  console.log(c(C.bold, `\n${name}`) + c(C.gray, ` (ID: ${id})`));
  console.log(c(C.gray, `${trackIds.length} Tracks\n`));

  if (trackIds.length === 0) {
    console.log(c(C.yellow, "Playlist ist leer."));
    return;
  }

  // Fetch all track details
  process.stderr.write(c(C.gray, `Lade Track-Details...`));
  const tracks = [];
  for (let i = 0; i < trackIds.length; i++) {
    const tid = typeof trackIds[i] === "object" ? trackIds[i].id : trackIds[i];
    try {
      const t = await apiGet(baseUrl, `/v1/track?id=${tid}`);
      tracks.push(t);
    } catch {
      tracks.push({ id: tid, title: "?", artist: "?", bpm: null, key: null });
    }
    if ((i + 1) % 10 === 0 || i === trackIds.length - 1) {
      process.stderr.write(`\r${c(C.gray, `Lade Track-Details... ${i + 1}/${trackIds.length}`)}`);
    }
  }
  process.stderr.write("\r\x1b[K");

  printTable(tracks, [
    { key: "id",     label: "ID",     width: 7,  right: true },
    { key: "bpm",    label: "BPM",    width: 5,  right: true, format: formatBpm },
    { key: "key",    label: "Key",    width: 5,  format: formatKey },
    { key: "artist", label: "Artist", width: 28 },
    { key: "title",  label: "Title",  width: 36 },
    { key: "genre",  label: "Genre",  width: 18 },
    { key: "label",  label: "Label",  width: 20 },
  ]);
  console.log();
}

async function cmdTrack(baseUrl, args) {
  const id = args._[1];
  if (!id) {
    console.error(c(C.red, "Fehler: Track-ID erforderlich. Beispiel: track 1337"));
    process.exit(1);
  }

  const t = await apiGet(baseUrl, `/v1/track?id=${id}`);

  if (args.flags.json) {
    console.log(JSON.stringify(t, null, 2));
    return;
  }

  const title  = t.title  || "—";
  const artist = t.artist || t.artists || "—";

  console.log(c(C.bold + C.white, `\n${artist} — ${title}`));
  console.log(c(C.gray, `ID: ${t.id || id}`));
  console.log();

  const fields = [
    ["BPM",       formatBpm(t.bpm)],
    ["Key",       formatKey(t.key)],
    ["Energy",    t.energy != null ? `${t.energy}` : "—"],
    ["Genre",     t.genre],
    ["Label",     t.label],
    ["Year",      t.year || (t.releaseDate ? t.releaseDate.slice(0, 4) : null)],
    ["Duration",  t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")}` : null],
    ["Location",  t.location],
    ["Streaming", t.streamingService ? `${t.streamingService}: ${t.streamingId || "—"}` : null],
    ["Tags",      Array.isArray(t.tags) ? t.tags.join(", ") : t.tags],
  ];

  const labelW = 12;
  for (const [label, val] of fields) {
    if (val == null || val === "" || val === "—") continue;
    console.log(`  ${c(C.cyan, pad(label, labelW))} ${val}`);
  }

  if (t.cuepoints && t.cuepoints.length > 0) {
    console.log(`\n  ${c(C.cyan + C.bold, "Cue Points:")}`);
    for (const cp of t.cuepoints) {
      const pos = cp.position != null ? `${(cp.position / 1000).toFixed(2)}s` : "—";
      console.log(`    ${c(C.gray, "•")} ${cp.name || "—"} @ ${pos}${cp.color ? c(C.gray, ` [${cp.color}]`) : ""}`);
    }
  }
  console.log();
}

async function cmdSearch(baseUrl, args) {
  const query = args._.slice(1).join(" ");
  if (!query) {
    console.error(c(C.red, "Fehler: Suchbegriff erforderlich. Beispiel: search deadmau5"));
    process.exit(1);
  }

  const limit = parseInt(args.flags.limit || "50", 10);

  // Build filter object — try title + artist search
  const filter = JSON.stringify({ title: query, artist: query, operator: "OR", limit });
  const encoded = encodeURIComponent(filter);

  let results;
  try {
    results = await apiGet(baseUrl, `/v1/search/tracks?filter=${encoded}`);
  } catch {
    // Fallback: simple query param
    try {
      results = await apiGet(baseUrl, `/v1/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}`);
    } catch {
      results = await apiGet(baseUrl, `/v1/search/tracks?query=${encodeURIComponent(query)}&limit=${limit}`);
    }
  }

  const tracks = Array.isArray(results) ? results : (results.tracks || results.items || results.data || []);

  if (args.flags.json) {
    console.log(JSON.stringify(tracks, null, 2));
    return;
  }

  console.log(c(C.bold, `\nSuchergebnisse für "${query}"`) + c(C.gray, ` (${tracks.length} Treffer)\n`));

  if (tracks.length === 0) {
    console.log(c(C.yellow, "Keine Treffer."));
    return;
  }

  printTable(tracks, [
    { key: "id",     label: "ID",     width: 7,  right: true },
    { key: "bpm",    label: "BPM",    width: 5,  right: true, format: formatBpm },
    { key: "key",    label: "Key",    width: 5,  format: formatKey },
    { key: "artist", label: "Artist", width: 28 },
    { key: "title",  label: "Title",  width: 36 },
    { key: "genre",  label: "Genre",  width: 18 },
  ]);
  console.log();
}

async function cmdTags(baseUrl, args) {
  const data = await apiGet(baseUrl, "/v1/tags");

  if (args.flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const categories = Array.isArray(data) ? data : (data.categories || data.tags || [data]);

  console.log(c(C.bold, "\nLexicon Tag-Kategorien\n"));

  for (const cat of categories) {
    const catName = cat.name || cat.category || cat.id || "Kategorie";
    const tags = cat.tags || cat.values || cat.items || (typeof cat === "string" ? [cat] : []);
    console.log(c(C.cyan + C.bold, catName));
    if (tags.length > 0) {
      const tagList = tags.map(t => {
        const n = typeof t === "string" ? t : (t.name || t.value || t.id);
        return c(C.gray, "  • ") + n;
      }).join("\n");
      console.log(tagList);
    }
    console.log();
  }
}

async function cmdExport(baseUrl, args) {
  const playlistId = args._[1];
  const format = (args._[2] || "csv").toLowerCase();
  const outputPath = args.flags.output || `lexicon-playlist-${playlistId}.${format}`;

  if (!playlistId) {
    console.error(c(C.red, "Fehler: Playlist-ID erforderlich. Beispiel: export 42 csv"));
    process.exit(1);
  }
  if (!["csv", "json", "m3u"].includes(format)) {
    console.error(c(C.red, `Unbekanntes Format: ${format}. Unterstützt: csv, json, m3u`));
    process.exit(1);
  }

  const playlist = await apiGet(baseUrl, `/v1/playlist?id=${playlistId}`);
  const trackIds = playlist.trackIds || playlist.tracks || [];
  const name = playlist.name || playlist.title || `Playlist ${playlistId}`;

  process.stderr.write(c(C.gray, `Exportiere "${name}" (${trackIds.length} Tracks) als ${format.toUpperCase()}...\n`));

  const tracks = [];
  for (let i = 0; i < trackIds.length; i++) {
    const tid = typeof trackIds[i] === "object" ? trackIds[i].id : trackIds[i];
    try {
      const t = await apiGet(baseUrl, `/v1/track?id=${tid}`);
      tracks.push(t);
    } catch {
      tracks.push({ id: tid });
    }
    if ((i + 1) % 10 === 0 || i === trackIds.length - 1) {
      process.stderr.write(`\r${c(C.gray, `  ${i + 1}/${trackIds.length} Tracks geladen...`)}`);
    }
  }
  process.stderr.write("\r\x1b[K");

  if (format === "json") {
    await fs.writeFile(outputPath, JSON.stringify({ id: playlistId, name, tracks }, null, 2), "utf-8");

  } else if (format === "csv") {
    const header = "id,title,artist,bpm,key,energy,genre,label,year,duration,location,streamingService,streamingId,tags\n";
    const rows = tracks.map(t => [
      t.id,
      csvEscape(t.title),
      csvEscape(t.artist || t.artists),
      formatBpm(t.bpm),
      t.key || "",
      t.energy ?? "",
      csvEscape(t.genre),
      csvEscape(t.label),
      t.year || (t.releaseDate ? t.releaseDate.slice(0, 4) : ""),
      t.duration ?? "",
      csvEscape(t.location),
      csvEscape(t.streamingService),
      csvEscape(t.streamingId),
      csvEscape(Array.isArray(t.tags) ? t.tags.join("; ") : (t.tags || "")),
    ].join(",")).join("\n");
    await fs.writeFile(outputPath, header + rows + "\n", "utf-8");

  } else if (format === "m3u") {
    const lines = ["#EXTM3U", `#PLAYLIST:${name}`, ""];
    for (const t of tracks) {
      const artist = t.artist || t.artists || "";
      const title  = t.title || "";
      const dur    = t.duration ?? -1;
      lines.push(`#EXTINF:${dur},${artist} - ${title}`);
      lines.push(t.location || `# ID:${t.id}`);
    }
    await fs.writeFile(outputPath, lines.join("\n") + "\n", "utf-8");
  }

  console.log(c(C.green, `✓ Export gespeichert: ${outputPath}`) + c(C.gray, ` (${tracks.length} Tracks)`));
}

async function cmdStats(baseUrl, args) {
  process.stderr.write(c(C.gray, "Lade Library-Statistiken...\n"));

  // Get first page to know total
  const first = await apiGet(baseUrl, `/v1/tracks?limit=1&offset=0`);
  const total = first.total ?? first.count ?? 45046;

  process.stderr.write(c(C.gray, `Lade ${total} Tracks (kann etwas dauern)...\n`));

  let loaded = 0;
  const tracks = await getAllTracks(baseUrl, (n, t) => {
    if (n > loaded + 500) {
      loaded = n;
      process.stderr.write(`\r${c(C.gray, `  ${n}/${t} Tracks geladen...`)}`);
    }
  });
  process.stderr.write("\r\x1b[K");

  if (args.flags.json) {
    // Compute stats, output JSON
    const stats = computeStats(tracks, total);
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  const stats = computeStats(tracks, total);

  console.log(c(C.bold, "\nLexicon Library Statistiken\n"));
  console.log(`  ${c(C.cyan, pad("Tracks gesamt", 22))} ${c(C.white + C.bold, stats.total.toLocaleString())}`);
  console.log(`  ${c(C.cyan, pad("Mit BPM", 22))} ${stats.withBpm} (${pct(stats.withBpm, stats.total)}%)`);
  console.log(`  ${c(C.cyan, pad("Mit Key", 22))} ${stats.withKey} (${pct(stats.withKey, stats.total)}%)`);
  console.log(`  ${c(C.cyan, pad("Mit Location", 22))} ${stats.withLocation} (${pct(stats.withLocation, stats.total)}%)`);
  console.log(`  ${c(C.cyan, pad("Ø BPM", 22))} ${stats.avgBpm}`);
  console.log(`  ${c(C.cyan, pad("BPM-Spanne", 22))} ${stats.minBpm} – ${stats.maxBpm}`);

  console.log(c(C.bold, "\n  Genre-Verteilung (Top 15):\n"));
  const genreEntries = Object.entries(stats.genres).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const maxGenreCount = genreEntries[0]?.[1] || 1;
  for (const [genre, count] of genreEntries) {
    const bar = "█".repeat(Math.round((count / maxGenreCount) * 20));
    console.log(`    ${pad(genre, 28)} ${c(C.blue, pad(bar, 20))} ${count}`);
  }

  console.log(c(C.bold, "\n  BPM-Verteilung:\n"));
  for (const [range, count] of Object.entries(stats.bpmRanges)) {
    const bar = "█".repeat(Math.round((count / stats.total) * 40));
    console.log(`    ${pad(range, 10)} ${c(C.magenta, pad(bar, 40))} ${count}`);
  }
  console.log();
}

function computeStats(tracks, fallbackTotal) {
  const total = tracks.length || fallbackTotal;
  let withBpm = 0, withKey = 0, withLocation = 0;
  let bpmSum = 0, bpmMin = Infinity, bpmMax = -Infinity;
  const genres = {};
  const bpmRanges = { "<80": 0, "80-90": 0, "90-100": 0, "100-110": 0, "110-120": 0, "120-130": 0, "130-140": 0, "140-150": 0, ">150": 0 };

  for (const t of tracks) {
    if (t.bpm) {
      withBpm++;
      const bpm = parseFloat(t.bpm);
      bpmSum += bpm;
      if (bpm < bpmMin) bpmMin = bpm;
      if (bpm > bpmMax) bpmMax = bpm;
      if      (bpm < 80)  bpmRanges["<80"]++;
      else if (bpm < 90)  bpmRanges["80-90"]++;
      else if (bpm < 100) bpmRanges["90-100"]++;
      else if (bpm < 110) bpmRanges["100-110"]++;
      else if (bpm < 120) bpmRanges["110-120"]++;
      else if (bpm < 130) bpmRanges["120-130"]++;
      else if (bpm < 140) bpmRanges["130-140"]++;
      else if (bpm < 150) bpmRanges["140-150"]++;
      else                bpmRanges[">150"]++;
    }
    if (t.key)      withKey++;
    if (t.location) withLocation++;
    const g = t.genre || "Unbekannt";
    genres[g] = (genres[g] || 0) + 1;
  }

  return {
    total,
    withBpm,
    withKey,
    withLocation,
    avgBpm: withBpm > 0 ? (bpmSum / withBpm).toFixed(1) : "—",
    minBpm: bpmMin === Infinity ? "—" : bpmMin.toFixed(0),
    maxBpm: bpmMax === -Infinity ? "—" : bpmMax.toFixed(0),
    genres,
    bpmRanges,
  };
}

function pct(n, total) {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

async function cmdSyncCheck(baseUrl, _args) {
  console.log(c(C.bold, "\nLexicon API Sync-Check\n"));

  // Base URL was already detected, so we know it's reachable
  const port = baseUrl ? new URL(baseUrl).port : "—";
  console.log(`  ${c(C.green, "✓")} API erreichbar auf ${c(C.white, baseUrl)} (Port ${port})`);

  try {
    const playlists = await apiGet(baseUrl, "/v1/playlists");
    const count = Array.isArray(playlists) ? countNodes(playlists) : "?";
    console.log(`  ${c(C.green, "✓")} /v1/playlists     — ${count} Einträge`);
  } catch (e) {
    console.log(`  ${c(C.red, "✗")} /v1/playlists     — ${e.message}`);
  }

  try {
    const data = await apiGet(baseUrl, "/v1/tracks?limit=1&offset=0");
    const total = data.total ?? data.count ?? "?";
    console.log(`  ${c(C.green, "✓")} /v1/tracks        — ${total} Tracks total`);
  } catch (e) {
    console.log(`  ${c(C.red, "✗")} /v1/tracks        — ${e.message}`);
  }

  try {
    await apiGet(baseUrl, "/v1/tags");
    console.log(`  ${c(C.green, "✓")} /v1/tags          — OK`);
  } catch (e) {
    console.log(`  ${c(C.red, "✗")} /v1/tags          — ${e.message}`);
  }

  console.log();
  console.log(c(C.green + C.bold, "  Lexicon läuft und ist bereit."));
  console.log();
}

function countNodes(nodes) {
  let n = 0;
  for (const node of nodes) {
    n++;
    if (node.children) n += countNodes(node.children);
    if (node.playlists) n += countNodes(node.playlists);
  }
  return n;
}

async function cmdCompare(baseUrl, args) {
  const id1 = args._[1];
  const id2 = args._[2];
  if (!id1 || !id2) {
    console.error(c(C.red, "Fehler: Zwei Playlist-IDs erforderlich. Beispiel: compare 42 99"));
    process.exit(1);
  }

  process.stderr.write(c(C.gray, "Lade Playlisten...\n"));
  const [pl1, pl2] = await Promise.all([
    apiGet(baseUrl, `/v1/playlist?id=${id1}`),
    apiGet(baseUrl, `/v1/playlist?id=${id2}`),
  ]);

  const ids1 = new Set((pl1.trackIds || pl1.tracks || []).map(t => typeof t === "object" ? t.id : t));
  const ids2 = new Set((pl2.trackIds || pl2.tracks || []).map(t => typeof t === "object" ? t.id : t));

  const common   = [...ids1].filter(id => ids2.has(id));
  const onlyIn1  = [...ids1].filter(id => !ids2.has(id));
  const onlyIn2  = [...ids2].filter(id => !ids1.has(id));

  const name1 = pl1.name || pl1.title || `Playlist ${id1}`;
  const name2 = pl2.name || pl2.title || `Playlist ${id2}`;

  if (args.flags.json) {
    console.log(JSON.stringify({ name1, name2, common, onlyIn1, onlyIn2 }, null, 2));
    return;
  }

  console.log(c(C.bold, `\nVergleich: "${name1}" vs "${name2}"\n`));
  console.log(`  ${c(C.cyan, pad("Tracks in A", 20))} ${ids1.size}`);
  console.log(`  ${c(C.cyan, pad("Tracks in B", 20))} ${ids2.size}`);
  console.log(`  ${c(C.green, pad("Gemeinsam", 20))} ${common.length}`);
  console.log(`  ${c(C.yellow, pad("Nur in A", 20))} ${onlyIn1.length}`);
  console.log(`  ${c(C.yellow, pad("Nur in B", 20))} ${onlyIn2.length}`);

  if (common.length > 0 && !args.flags.quiet) {
    console.log(c(C.bold, "\n  Gemeinsame Tracks (IDs):"));
    console.log(c(C.gray, "  " + common.slice(0, 20).join(", ") + (common.length > 20 ? ` … +${common.length - 20} weitere` : "")));
  }

  if (args.flags.detail) {
    // Fetch track names for common tracks
    process.stderr.write(c(C.gray, "\nLade Track-Details für gemeinsame Tracks...\n"));
    const commonTracks = [];
    for (const id of common.slice(0, 50)) {
      try {
        const t = await apiGet(baseUrl, `/v1/track?id=${id}`);
        commonTracks.push(t);
      } catch { /* skip */ }
    }
    if (commonTracks.length > 0) {
      console.log(c(C.bold, "\n  Gemeinsame Tracks:\n"));
      printTable(commonTracks, [
        { key: "id",     label: "ID",     width: 7,  right: true },
        { key: "bpm",    label: "BPM",    width: 5,  right: true, format: formatBpm },
        { key: "artist", label: "Artist", width: 28 },
        { key: "title",  label: "Title",  width: 36 },
      ]);
    }
  }
  console.log();
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp(command) {
  const helps = {
    list: `
  ${c(C.bold, "list")} — Alle Playlisten als Baum anzeigen

  Verwendung: lexicon_api_tool.mjs list [--json]
`,
    playlist: `
  ${c(C.bold, "playlist <id>")} — Tracks einer Playlist anzeigen

  Verwendung: lexicon_api_tool.mjs playlist 42 [--json]
`,
    track: `
  ${c(C.bold, "track <id>")} — Track-Details anzeigen

  Verwendung: lexicon_api_tool.mjs track 1337 [--json]
`,
    search: `
  ${c(C.bold, "search <query>")} — Tracks suchen

  Verwendung: lexicon_api_tool.mjs search "deadmau5" [--limit=50] [--json]
`,
    tags: `
  ${c(C.bold, "tags")} — Alle Tag-Kategorien anzeigen

  Verwendung: lexicon_api_tool.mjs tags [--json]
`,
    export: `
  ${c(C.bold, "export <playlist-id> [format]")} — Playlist exportieren

  Formate: csv (Standard), json, m3u
  Verwendung: lexicon_api_tool.mjs export 42 csv [--output=file.csv]
`,
    stats: `
  ${c(C.bold, "stats")} — Library-Statistiken anzeigen

  Verwendung: lexicon_api_tool.mjs stats [--json]
  Hinweis: Lädt alle Tracks — kann bei großen Libraries etwas dauern.
`,
    "sync-check": `
  ${c(C.bold, "sync-check")} — Prüft ob Lexicon läuft und die API erreichbar ist

  Verwendung: lexicon_api_tool.mjs sync-check
`,
    compare: `
  ${c(C.bold, "compare <id-1> <id-2>")} — Zwei Playlisten vergleichen

  Verwendung: lexicon_api_tool.mjs compare 42 99 [--detail] [--json]
  --detail: Lädt Track-Details für gemeinsame Tracks
`,
  };

  if (command && helps[command]) {
    console.log(helps[command]);
    return;
  }

  console.log(`
${c(C.bold + C.cyan, "lexicon_api_tool.mjs")} — CLI für die Lexicon DJ Local API

${c(C.bold, "Befehle:")}
  list                          Alle Playlisten als Baum
  playlist <id>                 Tracks einer Playlist (BPM, Key, Artist)
  track <id>                    Track-Details anzeigen
  search <query>                Tracks suchen
  tags                          Tag-Kategorien anzeigen
  export <id> [csv|json|m3u]    Playlist exportieren
  stats                         Library-Statistiken
  sync-check                    API-Verbindung prüfen
  compare <id-1> <id-2>         Zwei Playlisten vergleichen

${c(C.bold, "Globale Flags:")}
  --json                        Maschinenlesbare JSON-Ausgabe
  --no-color                    Farbige Ausgabe deaktivieren
  --port=<n>                    API-Port (Standard: 48624, Fallback: 11011)
  --help [befehl]               Hilfe anzeigen

${c(C.bold, "API:")}
  Lexicon DJ Local API — http://localhost:48624
  Auto-Detection: probiert Port 48624, dann 11011

${c(C.bold, "Beispiele:")}
  node tools/lexicon_api_tool.mjs sync-check
  node tools/lexicon_api_tool.mjs list
  node tools/lexicon_api_tool.mjs playlist 42
  node tools/lexicon_api_tool.mjs search "Bicep" --limit=20
  node tools/lexicon_api_tool.mjs export 42 m3u --output=my-set.m3u
  node tools/lexicon_api_tool.mjs stats --json
  node tools/lexicon_api_tool.mjs compare 42 99 --detail
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const command = args._[0] || "help";

  if (args.flags["no-color"]) useColor = false;

  if (command === "help" || args.flags.help === true) {
    printHelp(args._[1] || null);
    process.exit(0);
  } else if (args.flags.help) {
    printHelp(command);
    process.exit(0);
  }

  // Detect API base URL
  let baseUrl;
  if (args.flags.port) {
    baseUrl = `http://localhost:${args.flags.port}`;
  } else {
    process.stderr.write(c(C.gray, "Verbinde mit Lexicon API...\r"));
    baseUrl = await detectBaseUrl();
    process.stderr.write("\r\x1b[K");
  }

  if (!baseUrl && command !== "help") {
    console.error(c(C.red, "✗ Lexicon API nicht erreichbar."));
    console.error(c(C.gray, `  Geprüfte Ports: ${PORTS.join(", ")}`));
    console.error(c(C.gray, "  Stelle sicher, dass Lexicon DJ läuft."));
    process.exit(1);
  }

  const commands = {
    list:         cmdList,
    playlist:     cmdPlaylist,
    track:        cmdTrack,
    search:       cmdSearch,
    tags:         cmdTags,
    export:       cmdExport,
    stats:        cmdStats,
    "sync-check": cmdSyncCheck,
    compare:      cmdCompare,
  };

  const handler = commands[command];
  if (!handler) {
    console.error(c(C.red, `Unbekannter Befehl: ${command}`));
    printHelp();
    process.exit(1);
  }

  try {
    await handler(baseUrl, args);
  } catch (err) {
    console.error(c(C.red, `✗ Fehler: ${err.message}`));
    if (args.flags.verbose) console.error(err);
    process.exit(1);
  }
}

main();
