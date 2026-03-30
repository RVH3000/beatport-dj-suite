#!/usr/bin/env node
/**
 * djplaylists_api_tool.mjs — CLI für die DJPlaylists.fm API
 *
 * Auth: Supabase JWT — Token aus dem Browser exportieren (siehe 'setup' Befehl).
 * Kontext-Datei: ~/.config/beatport-dj-suite/djplaylists-context.json
 *
 * Verwendung:
 *   node tools/djplaylists_api_tool.mjs setup        # Token-Export-Anleitung
 *   node tools/djplaylists_api_tool.mjs list          # Eigene Playlisten
 *   node tools/djplaylists_api_tool.mjs trending      # Trending Playlisten
 *   node tools/djplaylists_api_tool.mjs latest        # Neueste Playlisten
 *   node tools/djplaylists_api_tool.mjs genres        # Playlisten nach Genre
 *   node tools/djplaylists_api_tool.mjs playlist 42   # Playlist-Details
 *   node tools/djplaylists_api_tool.mjs import <url>  # Beatport-Playlist importieren
 *   node tools/djplaylists_api_tool.mjs search <q>    # Tracks suchen
 *   node tools/djplaylists_api_tool.mjs export <id> [csv|json]
 *   node tools/djplaylists_api_tool.mjs me            # Eigenes Profil
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

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

// ─── Context (Auth) ───────────────────────────────────────────────────────────

const CONTEXT_PATHS = [
  path.join(os.homedir(), ".config", "beatport-dj-suite", "djplaylists-context.json"),
  path.join(os.homedir(), ".config", "djplaylists-context.json"),
  path.join(process.cwd(), "djplaylists-context.json"),
];

async function loadContext(explicitPath) {
  const paths = explicitPath ? [explicitPath, ...CONTEXT_PATHS] : CONTEXT_PATHS;
  for (const p of paths) {
    if (existsSync(p)) {
      const raw = await fs.readFile(p, "utf-8");
      const ctx = JSON.parse(raw);
      if (!ctx.token && !ctx.access_token) {
        throw new Error(`Kontext-Datei hat kein Token: ${p}\nBitte 'setup' ausführen.`);
      }
      return { ...ctx, token: ctx.token || ctx.access_token, _path: p };
    }
  }
  throw new Error(
    "djplaylists-context.json nicht gefunden.\n" +
    "Bitte zuerst ausführen: node tools/djplaylists_api_tool.mjs setup\n" +
    `Oder: node tools/djplaylists_api_tool.mjs setup --save-token=<TOKEN>`
  );
}

async function saveContext(ctx, explicitPath) {
  const filePath = explicitPath || CONTEXT_PATHS[0];
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ ...ctx, exportedAt: new Date().toISOString() }, null, 2), "utf-8");
  return filePath;
}

function checkTokenAge(ctx) {
  if (!ctx.exportedAt) return;
  const age = Date.now() - new Date(ctx.exportedAt).getTime();
  const hours = Math.round(age / 3600000);
  // Supabase JWTs sind typischerweise 1h gültig, Refresh-Token länger
  if (age > 50 * 60 * 1000) {
    process.stderr.write(
      c(C.yellow, `⚠ Token ist ${hours > 0 ? hours + "h" : Math.round(age / 60000) + "min"} alt — ` +
      `könnte abgelaufen sein. Bei 401-Fehlern: setup erneut ausführen.\n`)
    );
  }
}

// ─── API Client ───────────────────────────────────────────────────────────────

const API_BASE = "https://api.djplaylists.fm";

class DJPlaylistsClient {
  constructor(ctx) {
    this.token = ctx.token;
    this.requestCount = 0;
  }

  async fetch(endpoint, options = {}) {
    this.requestCount++;
    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Origin": "https://djplaylists.fm",
        "Referer": "https://djplaylists.fm/",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401) {
      throw new Error("401 Unauthorized — Token abgelaufen. Bitte 'setup' erneut ausführen.");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ": " + body.slice(0, 300) : ""}`);
    }
    return res.json();
  }

  async post(endpoint, body) {
    return this.fetch(endpoint, { method: "POST", body });
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function pad(str, len, right = false) {
  const s = String(str ?? "");
  const trimmed = s.length > len ? s.slice(0, len - 1) + "…" : s;
  return right ? trimmed.padStart(len) : trimmed.padEnd(len);
}

function printTable(rows, cols) {
  const header = cols.map(col => c(C.bold + C.cyan, pad(col.label, col.width, col.right ?? false))).join("  ");
  const divider = c(C.gray, cols.map(col => "─".repeat(col.width)).join("  "));
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    const line = cols.map(col => {
      const val = col.format ? col.format(row[col.key], row) : row[col.key];
      return pad(val ?? "—", col.width, col.right ?? false);
    }).join("  ");
    console.log(line);
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

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE");
}

function formatTrackCount(n) {
  return n != null ? String(n) : "?";
}

function normalizePlaylist(pl) {
  // DJPlaylists.fm response shapes vary — normalize common fields
  return {
    id:          pl.id || pl.playlist_id,
    title:       pl.title || pl.name || pl.playlist_name || "—",
    author:      pl.author || pl.username || pl.user?.username || "—",
    trackCount:  pl.track_count ?? pl.trackCount ?? pl.tracks?.length ?? null,
    genre:       pl.genre || pl.genres?.[0] || "—",
    views:       pl.views ?? pl.view_count ?? null,
    likes:       pl.likes ?? pl.like_count ?? null,
    createdAt:   pl.created_at || pl.createdAt || null,
    _raw:        pl,
  };
}

function normalizeTrack(t) {
  return {
    id:     t.id || t.track_id,
    title:  t.title || t.name || "—",
    artist: t.artist || t.artists || t.artist_name || "—",
    bpm:    t.bpm,
    key:    t.key,
    genre:  t.genre,
    label:  t.label,
    _raw:   t,
  };
}

function printPlaylistTable(playlists) {
  const rows = playlists.map(normalizePlaylist);
  printTable(rows, [
    { key: "id",         label: "ID",       width: 8,  right: true },
    { key: "title",      label: "Titel",    width: 40 },
    { key: "author",     label: "Author",   width: 20 },
    { key: "trackCount", label: "Tracks",   width: 6,  right: true, format: formatTrackCount },
    { key: "genre",      label: "Genre",    width: 20 },
    { key: "createdAt",  label: "Datum",    width: 12, format: formatDate },
  ]);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdSetup(_client, args) {
  // If --save-token is provided, save directly
  if (args.flags["save-token"]) {
    const token = args.flags["save-token"];
    const ctx = { token };
    const p = await saveContext(ctx, args.flags.context);
    console.log(c(C.green, `✓ Token gespeichert: ${p}`));
    return;
  }

  // If --save-json is provided, parse Supabase localStorage JSON
  if (args.flags["save-json"]) {
    const raw = args.flags["save-json"];
    try {
      const parsed = JSON.parse(raw);
      const token = parsed.access_token || parsed.token;
      const refreshToken = parsed.refresh_token;
      if (!token) throw new Error("Kein access_token gefunden.");
      const ctx = { token, refresh_token: refreshToken };
      const p = await saveContext(ctx, args.flags.context);
      console.log(c(C.green, `✓ Supabase Session gespeichert: ${p}`));
    } catch (e) {
      console.error(c(C.red, `Fehler beim Parsen: ${e.message}`));
      process.exit(1);
    }
    return;
  }

  // Show instructions
  const savePath = CONTEXT_PATHS[0];
  console.log(`
${c(C.bold + C.cyan, "DJPlaylists.fm — Auth Setup")}

${c(C.bold, "Schritt 1: Browser öffnen")}
  Öffne https://djplaylists.fm und melde dich an.

${c(C.bold, "Schritt 2: Token aus Browser kopieren")}
  Öffne die Browser-Konsole (F12 → Console) und führe aus:

  ${c(C.gray, "// Methode A: Supabase localStorage (empfohlen)")}
  ${c(C.green, `(() => {`)}
  ${c(C.green, `  const key = Object.keys(localStorage).find(k => k.includes('supabase') || k.includes('auth'));`)}
  ${c(C.green, `  if (!key) { console.error('Kein Supabase-Key gefunden'); return; }`)}
  ${c(C.green, `  const session = JSON.parse(localStorage.getItem(key));`)}
  ${c(C.green, `  const token = session?.access_token || session?.data?.session?.access_token;`)}
  ${c(C.green, `  console.log('TOKEN:', token);`)}
  ${c(C.green, `  copy(token);`)}
  ${c(C.green, `})();`)}

  ${c(C.gray, "// Methode B: Aus Network-Tab (Auth-Header)")}
  ${c(C.gray, "  Network → beliebige /api/ Request → Request Headers → Authorization: Bearer <TOKEN>")}

${c(C.bold, "Schritt 3: Token speichern")}

  ${c(C.cyan, "Einfach (nur Token):")}
  node tools/djplaylists_api_tool.mjs setup --save-token=<TOKEN>

  ${c(C.cyan, "Mit Refresh-Token (empfohlen — längere Lebensdauer):")}
  ${c(C.green, `(() => {`)}
  ${c(C.green, `  const key = Object.keys(localStorage).find(k => k.includes('supabase') || k.includes('auth'));`)}
  ${c(C.green, `  const s = JSON.parse(localStorage.getItem(key));`)}
  ${c(C.green, `  const sess = s?.data?.session || s;`)}
  ${c(C.green, `  copy(JSON.stringify({ access_token: sess.access_token, refresh_token: sess.refresh_token }));`)}
  ${c(C.green, `})();`)}
  ${c(C.gray, "  // Dann:")}
  node tools/djplaylists_api_tool.mjs setup --save-json='<PASTE_JSON>'

${c(C.bold, "Gespeichert unter:")}
  ${savePath}

${c(C.bold, "Hinweis:")}
  Supabase Access-Tokens laufen nach ~1 Stunde ab.
  Mit Refresh-Token kann das Tool automatisch verlängern (TODO).
`);
}

async function cmdList(client, args) {
  const data = await client.fetch("/api/playlists/my");
  const playlists = Array.isArray(data) ? data : (data.playlists || data.data || data.items || []);

  if (args.flags.json) {
    console.log(JSON.stringify(playlists, null, 2));
    return;
  }

  console.log(c(C.bold, `\nMeine DJPlaylists.fm Playlisten`) + c(C.gray, ` (${playlists.length})\n`));
  if (playlists.length === 0) {
    console.log(c(C.yellow, "Keine eigenen Playlisten gefunden."));
    return;
  }
  printPlaylistTable(playlists);
  console.log();
}

async function cmdTrending(client, args) {
  const data = await client.fetch("/api/playlists/trending");
  const playlists = Array.isArray(data) ? data : (data.playlists || data.data || data.items || []);

  if (args.flags.json) {
    console.log(JSON.stringify(playlists, null, 2));
    return;
  }

  console.log(c(C.bold, `\nTrending Playlisten`) + c(C.gray, ` (${playlists.length})\n`));
  printPlaylistTable(playlists);
  console.log();
}

async function cmdLatest(client, args) {
  const data = await client.fetch("/api/playlists/latest");
  const playlists = Array.isArray(data) ? data : (data.playlists || data.data || data.items || []);

  if (args.flags.json) {
    console.log(JSON.stringify(playlists, null, 2));
    return;
  }

  console.log(c(C.bold, `\nNeueste Playlisten`) + c(C.gray, ` (${playlists.length})\n`));
  printPlaylistTable(playlists);
  console.log();
}

async function cmdGenres(client, args) {
  const data = await client.fetch("/api/playlists/genres");

  if (args.flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Data may be genres list or playlists grouped by genre
  const items = Array.isArray(data) ? data : (data.genres || data.data || data.items || []);
  console.log(c(C.bold, "\nGenre-Playlisten\n"));

  for (const item of items) {
    if (typeof item === "string") {
      console.log(`  ${c(C.cyan, "•")} ${item}`);
    } else if (item.genre || item.name) {
      const name = item.genre || item.name;
      const count = item.count || item.playlist_count;
      console.log(`  ${c(C.cyan, "•")} ${c(C.white, name)}${count ? c(C.gray, ` (${count})`) : ""}`);
      if (item.playlists?.length) {
        for (const pl of item.playlists.slice(0, 3)) {
          const n = normalizePlaylist(pl);
          console.log(c(C.gray, `      └─ ${n.title} (${n.trackCount ?? "?"} Tracks)`));
        }
      }
    }
  }
  console.log();
}

async function cmdPlaylist(client, args) {
  const id = args._[1];
  if (!id) {
    console.error(c(C.red, "Fehler: Playlist-ID erforderlich. Beispiel: playlist 42"));
    process.exit(1);
  }

  const data = await client.fetch(`/api/playlist/${id}`);

  if (args.flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const pl = normalizePlaylist(data);
  const raw = data;

  console.log(c(C.bold + C.white, `\n${pl.title}`));
  console.log(c(C.gray, `ID: ${pl.id}  •  von ${pl.author}  •  ${formatDate(pl.createdAt)}`));
  if (pl.genre && pl.genre !== "—") console.log(c(C.gray, `Genre: ${pl.genre}`));
  if (pl.views != null)  console.log(c(C.gray, `Views: ${pl.views.toLocaleString()}`));
  if (pl.likes != null)  console.log(c(C.gray, `Likes: ${pl.likes}`));
  console.log();

  const tracks = raw.tracks || raw.track_list || raw.playlist_tracks || [];

  if (tracks.length === 0) {
    console.log(c(C.yellow, "Keine Tracks in dieser Playlist (oder keine Berechtigung)."));
    return;
  }

  const normalized = tracks.map(t => {
    // Tracks may be nested: { track: {...}, position: N }
    const track = t.track || t;
    return normalizeTrack(track);
  });

  printTable(normalized, [
    { key: "id",     label: "ID",     width: 8,  right: true },
    { key: "bpm",    label: "BPM",    width: 5,  right: true },
    { key: "key",    label: "Key",    width: 5 },
    { key: "artist", label: "Artist", width: 28 },
    { key: "title",  label: "Title",  width: 36 },
    { key: "genre",  label: "Genre",  width: 18 },
  ]);
  console.log(c(C.gray, `\n  ${tracks.length} Tracks`));
  console.log();
}

async function cmdImport(client, args) {
  const beatportUrl = args._[1];
  if (!beatportUrl) {
    console.error(c(C.red, "Fehler: Beatport-URL erforderlich."));
    console.error(c(C.gray, "Beispiel: import https://www.beatport.com/playlist/..."));
    process.exit(1);
  }

  if (!beatportUrl.includes("beatport.com")) {
    console.error(c(C.yellow, "⚠ URL sieht nicht nach Beatport aus. Trotzdem versuchen..."));
  }

  console.log(c(C.gray, `Importiere Playlist: ${beatportUrl}\n`));

  // Step 1: Initiate import
  let importResult;
  try {
    importResult = await client.post("/api/playlist/import-playlist", {
      url: beatportUrl,
      source: "beatport",
    });
  } catch (e) {
    console.error(c(C.red, `Import fehlgeschlagen: ${e.message}`));
    process.exit(1);
  }

  if (args.flags.json) {
    console.log(JSON.stringify(importResult, null, 2));
    return;
  }

  // The API may return a code for polling, or directly a result
  const code = importResult.code || importResult.import_code || importResult.id;

  if (code) {
    console.log(c(C.cyan, `Import gestartet. Code: ${code}`));
    console.log(c(C.gray, "Warte auf Verarbeitung..."));

    // Step 2: Poll for completion
    let attempts = 0;
    const maxAttempts = 20;
    while (attempts < maxAttempts) {
      await sleep(3000);
      attempts++;
      try {
        const status = await client.fetch(`/api/playlist/awaiting-import?code=${code}`);

        if (args.flags.verbose) {
          console.log(c(C.gray, `  Status (${attempts}): ${JSON.stringify(status)}`));
        }

        const done = status.status === "done" || status.status === "completed" ||
                     status.complete === true || status.finished === true ||
                     status.playlist_id || status.id;

        if (done) {
          const plId = status.playlist_id || status.id || status.playlist?.id;
          console.log(c(C.green, `\n✓ Import abgeschlossen!`));
          if (plId) {
            console.log(`  Playlist-ID: ${c(C.white, plId)}`);
            console.log(c(C.gray, `  Details: node tools/djplaylists_api_tool.mjs playlist ${plId}`));
          }
          if (status.track_count || status.tracks) {
            console.log(`  Tracks importiert: ${status.track_count || status.tracks?.length || "?"}`);
          }
          return;
        }

        const failed = status.status === "error" || status.status === "failed" || status.error;
        if (failed) {
          throw new Error(status.error || status.message || "Import fehlgeschlagen");
        }

        process.stderr.write(`\r${c(C.gray, `  Warte... (${attempts}/${maxAttempts})`)}`);
      } catch (e) {
        if (e.message.includes("Import fehlgeschlagen")) {
          process.stderr.write("\n");
          console.error(c(C.red, `✗ ${e.message}`));
          process.exit(1);
        }
        // Polling-Fehler ignorieren, weiter warten
      }
    }

    process.stderr.write("\n");
    console.log(c(C.yellow, `⚠ Timeout nach ${maxAttempts * 3}s. Import läuft möglicherweise noch.`));
    console.log(c(C.gray, `  Code: ${code} — Status manuell prüfen:`));
    console.log(c(C.gray, `  curl "${API_BASE}/api/playlist/awaiting-import?code=${code}"`));

  } else {
    // Direct result
    console.log(c(C.green, "✓ Import abgeschlossen!"));
    const plId = importResult.playlist_id || importResult.id || importResult.playlist?.id;
    if (plId) {
      console.log(`  Playlist-ID: ${c(C.white, plId)}`);
    }
    if (importResult.track_count) {
      console.log(`  Tracks: ${importResult.track_count}`);
    }
  }
}

async function cmdSearch(client, args) {
  const query = args._.slice(1).join(" ");
  if (!query) {
    console.error(c(C.red, "Fehler: Suchbegriff erforderlich. Beispiel: search Bicep"));
    process.exit(1);
  }

  const limit = args.flags.limit || "30";
  const encoded = encodeURIComponent(query);

  let results;
  try {
    results = await client.fetch(`/api/utility/search-tracks?q=${encoded}&limit=${limit}`);
  } catch {
    try {
      results = await client.fetch(`/api/utility/search-tracks?query=${encoded}&limit=${limit}`);
    } catch {
      results = await client.fetch(`/api/utility/tracks?search=${encoded}&limit=${limit}`);
    }
  }

  const tracks = Array.isArray(results) ? results : (results.tracks || results.data || results.items || []);

  if (args.flags.json) {
    console.log(JSON.stringify(tracks, null, 2));
    return;
  }

  console.log(c(C.bold, `\nTrack-Suche: "${query}"`) + c(C.gray, ` (${tracks.length} Treffer)\n`));

  if (tracks.length === 0) {
    console.log(c(C.yellow, "Keine Treffer."));
    return;
  }

  const normalized = tracks.map(normalizeTrack);
  printTable(normalized, [
    { key: "id",     label: "ID",     width: 8,  right: true },
    { key: "bpm",    label: "BPM",    width: 5,  right: true },
    { key: "key",    label: "Key",    width: 5 },
    { key: "artist", label: "Artist", width: 28 },
    { key: "title",  label: "Title",  width: 36 },
    { key: "genre",  label: "Genre",  width: 18 },
  ]);
  console.log();
}

async function cmdExport(client, args) {
  const id = args._[1];
  const format = (args._[2] || "csv").toLowerCase();
  const outputPath = args.flags.output || `djplaylists-${id}.${format}`;

  if (!id) {
    console.error(c(C.red, "Fehler: Playlist-ID erforderlich. Beispiel: export 42 csv"));
    process.exit(1);
  }
  if (!["csv", "json"].includes(format)) {
    console.error(c(C.red, `Unbekanntes Format: ${format}. Unterstützt: csv, json`));
    process.exit(1);
  }

  const data = await client.fetch(`/api/playlist/${id}`);
  const pl = normalizePlaylist(data);
  const rawTracks = data.tracks || data.track_list || data.playlist_tracks || [];
  const tracks = rawTracks.map(t => normalizeTrack(t.track || t));

  process.stderr.write(c(C.gray, `Exportiere "${pl.title}" (${tracks.length} Tracks) als ${format.toUpperCase()}...\n`));

  if (format === "json") {
    await fs.writeFile(outputPath, JSON.stringify({ ...pl, tracks }, null, 2), "utf-8");
  } else if (format === "csv") {
    const header = "id,title,artist,bpm,key,genre,label\n";
    const rows = tracks.map(t => [
      t.id,
      csvEscape(t.title),
      csvEscape(t.artist),
      t.bpm ?? "",
      t.key ?? "",
      csvEscape(t.genre),
      csvEscape(t.label),
    ].join(",")).join("\n");
    await fs.writeFile(outputPath, header + rows + "\n", "utf-8");
  }

  console.log(c(C.green, `✓ Export gespeichert: ${outputPath}`) + c(C.gray, ` (${tracks.length} Tracks)`));
}

async function cmdMe(client, args) {
  const data = await client.fetch("/api/user/me");

  if (args.flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const user = data.user || data;
  console.log(c(C.bold, "\nMein DJPlaylists.fm Profil\n"));

  const fields = [
    ["Username",  user.username],
    ["Name",      user.display_name || user.name],
    ["E-Mail",    user.email],
    ["ID",        user.id || user.user_id],
    ["Plan",      user.plan || user.subscription],
    ["Erstellt",  formatDate(user.created_at)],
  ];

  for (const [label, val] of fields) {
    if (!val) continue;
    console.log(`  ${c(C.cyan, pad(label, 12))} ${val}`);
  }
  console.log();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(command) {
  const helps = {
    setup: `
  ${c(C.bold, "setup")} — Auth-Token aus Browser exportieren und speichern

  Verwendung:
    djplaylists setup                           # Anleitung anzeigen
    djplaylists setup --save-token=<TOKEN>      # Token direkt speichern
    djplaylists setup --save-json='<JSON>'      # Supabase-Session speichern
`,
    list: `
  ${c(C.bold, "list")} — Eigene Playlisten anzeigen

  Verwendung: djplaylists list [--json]
`,
    trending: `
  ${c(C.bold, "trending")} — Trending Playlisten anzeigen

  Verwendung: djplaylists trending [--json]
`,
    latest: `
  ${c(C.bold, "latest")} — Neueste Playlisten anzeigen

  Verwendung: djplaylists latest [--json]
`,
    genres: `
  ${c(C.bold, "genres")} — Playlisten nach Genre

  Verwendung: djplaylists genres [--json]
`,
    playlist: `
  ${c(C.bold, "playlist <id>")} — Playlist-Details und Tracks

  Verwendung: djplaylists playlist 42 [--json]
`,
    import: `
  ${c(C.bold, "import <beatport-url>")} — Beatport-Playlist importieren

  Verwendung: djplaylists import https://www.beatport.com/playlist/...
  Das Tool pollt automatisch auf den Abschluss des Imports.
`,
    search: `
  ${c(C.bold, "search <query>")} — Tracks suchen

  Verwendung: djplaylists search "Bicep" [--limit=30] [--json]
`,
    export: `
  ${c(C.bold, "export <id> [format]")} — Playlist exportieren

  Formate: csv (Standard), json
  Verwendung: djplaylists export 42 csv [--output=file.csv]
`,
    me: `
  ${c(C.bold, "me")} — Eigenes Profil anzeigen

  Verwendung: djplaylists me [--json]
`,
  };

  if (command && helps[command]) {
    console.log(helps[command]);
    return;
  }

  console.log(`
${c(C.bold + C.cyan, "djplaylists_api_tool.mjs")} — CLI für DJPlaylists.fm

${c(C.bold, "Auth:")}
  Zuerst Token einrichten:
  node tools/djplaylists_api_tool.mjs setup

${c(C.bold, "Befehle:")}
  setup                         Token-Export-Anleitung / Token speichern
  list                          Eigene Playlisten
  trending                      Trending Playlisten
  latest                        Neueste Playlisten
  genres                        Playlisten nach Genre
  playlist <id>                 Playlist-Details + Tracks
  import <beatport-url>         Beatport-Playlist importieren
  search <query>                Tracks suchen
  export <id> [csv|json]        Playlist exportieren
  me                            Eigenes Profil

${c(C.bold, "Globale Flags:")}
  --json                        Maschinenlesbare JSON-Ausgabe
  --no-color                    Farbige Ausgabe deaktivieren
  --context=<pfad>              Pfad zur djplaylists-context.json
  --verbose                     Ausführliche Ausgabe
  --help [befehl]               Hilfe anzeigen

${c(C.bold, "Kontext-Datei:")}
  ${CONTEXT_PATHS[0]}

${c(C.bold, "Beispiele:")}
  node tools/djplaylists_api_tool.mjs setup
  node tools/djplaylists_api_tool.mjs list
  node tools/djplaylists_api_tool.mjs trending
  node tools/djplaylists_api_tool.mjs playlist 42
  node tools/djplaylists_api_tool.mjs import "https://www.beatport.com/playlist/..."
  node tools/djplaylists_api_tool.mjs search "Fred Again"
  node tools/djplaylists_api_tool.mjs export 42 csv --output=my-playlist.csv
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

  // setup doesn't need a valid token (it creates one)
  if (command === "setup") {
    await cmdSetup(null, args);
    return;
  }

  // All other commands need auth
  let ctx;
  try {
    ctx = await loadContext(args.flags.context);
  } catch (e) {
    console.error(c(C.red, `✗ Auth-Fehler: ${e.message}`));
    process.exit(1);
  }

  checkTokenAge(ctx);
  const client = new DJPlaylistsClient(ctx);

  const commands = {
    list:     cmdList,
    trending: cmdTrending,
    latest:   cmdLatest,
    genres:   cmdGenres,
    playlist: cmdPlaylist,
    import:   cmdImport,
    search:   cmdSearch,
    export:   cmdExport,
    me:       cmdMe,
  };

  const handler = commands[command];
  if (!handler) {
    console.error(c(C.red, `Unbekannter Befehl: ${command}`));
    printHelp();
    process.exit(1);
  }

  try {
    await handler(client, args);
  } catch (err) {
    console.error(c(C.red, `✗ Fehler: ${err.message}`));
    if (args.flags.verbose) console.error(err);
    process.exit(1);
  }
}

main();
