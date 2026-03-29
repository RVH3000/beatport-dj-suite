#!/usr/bin/env node
/**
 * bpx.mjs — CLI-Wrapper für den XHR-basierten Beatport Scanner
 *
 * Importiert das Modul aus electron-app/scanner/xhr-scanner.mjs
 * und stellt die CLI-Befehle bereit.
 *
 * Verwendung:
 *   node tools/bpx.mjs scan
 *   node tools/bpx.mjs list --filter="Deep House"
 *   node tools/bpx.mjs tracks 5484547
 *   node tools/bpx.mjs add 5484547 19283746
 *   node tools/bpx.mjs export csv --output ./export.csv
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";

import {
  API_BASE,
  BeatportXhrClient,
  DataStore,
  DEFAULT_CONCURRENCY,
  USER_DATA_PATHS,
  csvEscape,
  loadApiContext,
  log,
  logProgress,
  normalizePlaylist,
  parseArgs,
} from "../electron-app/scanner/xhr-scanner.mjs";

// ─── Befehle ───────────────────────────────────────────────────────────────────

async function cmdContext(client, _args) {
  log("Teste API-Kontext...");
  try {
    const payload = await client.fetch(`${API_BASE}/my/playlists/?per_page=1`);
    const total = payload?.count || 0;
    log(`✓ Kontext gültig. ${total} Playlisten auf dem Server.`);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          totalPlaylists: total,
          authorization: client.context.authorization.slice(0, 20) + "...",
          exportedAt: client.context.exportedAt || client.context.observedAt,
        },
        null,
        2
      )
    );
  } catch (error) {
    log(`✗ Kontext ungültig: ${error.message}`);
    process.exit(1);
  }
}

async function cmdScan(client, args, store) {
  const force = args.flags.force === true;
  const concurrency = parseInt(args.flags.concurrency || DEFAULT_CONCURRENCY, 10);

  const playlists = await client.discoverAllPlaylists();
  await store.savePlaylists(playlists);

  const total = playlists.length;
  let completed = 0;
  let totalTracks = 0;
  let skipped = 0;

  log(`Starte Track-Analyse für ${total} Playlisten (concurrency=${concurrency})...`);

  const queue = [...playlists];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const playlist = queue.shift();
      if (!playlist) break;

      if (!force) {
        const cached = await store.loadPlaylistTracks(playlist.id);
        if (cached && cached.length === playlist.trackCount) {
          completed++;
          totalTracks += cached.length;
          skipped++;
          logProgress(completed, total, "Playlisten analysiert");
          continue;
        }
      }

      try {
        const tracks = await client.fetchPlaylistTracks(playlist.id);
        await store.savePlaylistTracks(playlist.id, tracks);
        totalTracks += tracks.length;
      } catch (error) {
        log(`\n✗ Playlist ${playlist.id} (${playlist.name}): ${error.message}`);
      }

      completed++;
      logProgress(completed, total, "Playlisten analysiert");
    }
  });

  await Promise.all(workers);

  process.stderr.write("\n");
  log(
    `Scan abgeschlossen: ${total} Playlisten, ${totalTracks} Tracks gesamt` +
      (skipped > 0 ? ` (${skipped} aus Cache)` : "") +
      `.`
  );
  log(`Daten gespeichert in: ${store.basePath}`);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        playlistsDiscovered: total,
        totalTracks,
        skippedFromCache: skipped,
        requestCount: client.requestCount,
        dataPath: store.basePath,
      },
      null,
      2
    )
  );
}

async function cmdList(_client, args, store) {
  const playlists = await store.loadPlaylists();
  if (playlists.length === 0) {
    log("Keine Playlisten im Cache. Bitte zuerst 'scan' ausführen.");
    return;
  }

  const filter = args.flags.filter
    ? new RegExp(args.flags.filter, "i")
    : null;
  const filtered = filter
    ? playlists.filter((p) => filter.test(p.name))
    : playlists;

  if (args.flags.json) {
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    log(`${filtered.length} Playlisten${filter ? " (gefiltert)" : ""}:`);
    for (const p of filtered) {
      console.log(`${p.id}\t${p.trackCount}\t${p.name}`);
    }
  }
}

async function cmdTracks(client, args, store) {
  const playlistId = args._[1];
  if (!playlistId) {
    log("Fehler: Playlist-ID erforderlich. Beispiel: tracks 5484547");
    process.exit(1);
  }

  let tracks = await store.loadPlaylistTracks(playlistId);
  if (!tracks || args.flags.refresh) {
    log(`Lade Tracks für Playlist ${playlistId} via API...`);
    tracks = await client.fetchPlaylistTracks(playlistId);
    await store.savePlaylistTracks(playlistId, tracks);
  }

  if (args.flags.json) {
    console.log(JSON.stringify(tracks, null, 2));
  } else {
    log(`${tracks.length} Tracks in Playlist ${playlistId}:`);
    for (const t of tracks) {
      console.log(
        `${t.trackId}\t${t.bpm}\t${t.key}\t${t.artists} - ${t.title} (${t.mixName})\t${t.label}\t${t.genre}`
      );
    }
  }
}

async function cmdAdd(client, args, _store) {
  const playlistId = args._[1];
  const trackIds = args._.slice(2);
  if (!playlistId || trackIds.length === 0) {
    log("Fehler: Playlist-ID + Track-IDs erforderlich. Beispiel: add 5484547 19283746");
    process.exit(1);
  }
  const results = await client.addTracksToPlaylist(playlistId, trackIds);
  console.log(JSON.stringify(results, null, 2));
}

async function cmdRemove(client, args, _store) {
  const playlistId = args._[1];
  const trackIds = args._.slice(2);
  if (!playlistId || trackIds.length === 0) {
    log(
      "Fehler: Playlist-ID + Track-IDs erforderlich. Beispiel: remove 5484547 19283746"
    );
    process.exit(1);
  }
  const results = await client.removeTracksFromPlaylist(playlistId, trackIds);
  console.log(JSON.stringify(results, null, 2));
}

async function cmdRename(client, args, _store) {
  const playlistId = args._[1];
  const newName = args._.slice(2).join(" ");
  if (!playlistId || !newName) {
    log('Fehler: Playlist-ID + Name erforderlich. Beispiel: rename 5484547 "Neuer Name"');
    process.exit(1);
  }
  const result = await client.renamePlaylist(playlistId, newName);
  console.log(JSON.stringify(normalizePlaylist(result), null, 2));
}

async function cmdCreate(client, args, _store) {
  const name = args._.slice(1).join(" ");
  if (!name) {
    log('Fehler: Name erforderlich. Beispiel: create "Meine Neue Playlist"');
    process.exit(1);
  }
  const result = await client.createPlaylist(name);
  console.log(JSON.stringify(normalizePlaylist(result), null, 2));
}

async function cmdDelete(client, args, _store) {
  const playlistId = args._[1];
  if (!playlistId) {
    log("Fehler: Playlist-ID erforderlich. Beispiel: delete 5484547");
    process.exit(1);
  }
  if (!args.flags.confirm) {
    log(
      `⚠ Playlist ${playlistId} wird unwiderruflich gelöscht! ` +
        `Bestätige mit --confirm`
    );
    process.exit(1);
  }
  await client.deletePlaylist(playlistId);
  console.log(JSON.stringify({ ok: true, deleted: playlistId }));
}

async function cmdExport(_client, args, store) {
  const format = args._[1] || "jsonl";
  const outputPath = args.flags.output || `beatport-export.${format}`;

  const playlists = await store.loadPlaylists();
  if (playlists.length === 0) {
    log("Keine Daten zum Exportieren. Bitte zuerst 'scan' ausführen.");
    return;
  }

  log(`Exportiere ${playlists.length} Playlisten als ${format}...`);

  if (format === "json") {
    const data = [];
    for (const pl of playlists) {
      const tracks = await store.loadPlaylistTracks(pl.id);
      data.push({ ...pl, tracks: tracks || [] });
    }
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf-8");
  } else if (format === "jsonl") {
    const stream = createWriteStream(outputPath, "utf-8");
    for (const pl of playlists) {
      const tracks = await store.loadPlaylistTracks(pl.id);
      stream.write(JSON.stringify({ ...pl, tracks: tracks || [] }) + "\n");
    }
    stream.end();
    await new Promise((resolve) => stream.on("finish", resolve));
  } else if (format === "csv") {
    const header =
      "playlistId,playlistName,trackId,position,artists,title,mixName,genre,label,bpm,key,releaseDate\n";
    const stream = createWriteStream(outputPath, "utf-8");
    stream.write(header);
    for (const pl of playlists) {
      const tracks = (await store.loadPlaylistTracks(pl.id)) || [];
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const row = [
          pl.id,
          csvEscape(pl.name),
          t.trackId,
          i + 1,
          csvEscape(t.artists),
          csvEscape(t.title),
          csvEscape(t.mixName),
          csvEscape(t.genre),
          csvEscape(t.label),
          t.bpm,
          csvEscape(t.key),
          t.releaseDate,
        ].join(",");
        stream.write(row + "\n");
      }
    }
    stream.end();
    await new Promise((resolve) => stream.on("finish", resolve));
  } else {
    log(`Unbekanntes Format: ${format}. Unterstützt: json, jsonl, csv`);
    process.exit(1);
  }

  log(`✓ Export gespeichert: ${outputPath}`);
}

// ─── Hilfe ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
bpx.mjs — CLI für den XHR-basierten Beatport Scanner (beatport-dj-suite)

Befehle:
  context                     API-Kontext testen
  scan                        Alle Playlisten entdecken + Tracks fetchen
  list                        Gecachte Playlisten auflisten
  tracks <playlist-id>        Tracks einer Playlist anzeigen
  add <playlist-id> <track-ids...>    Tracks hinzufügen
  remove <playlist-id> <track-ids...> Tracks entfernen
  rename <playlist-id> <name>         Playlist umbenennen
  create <name>               Neue Playlist erstellen
  delete <playlist-id>        Playlist löschen (mit --confirm)
  export [json|jsonl|csv]     Daten exportieren

Flags:
  --context=<pfad>     Pfad zur api-context.json (sonst automatisch)
  --data=<pfad>        Daten-Verzeichnis (Default: Scanner userData)
  --force              Cache ignorieren
  --concurrency=<n>    Parallele Requests (Default: ${DEFAULT_CONCURRENCY})
  --filter=<regex>     Playlisten nach Name filtern
  --json               Ausgabe als JSON
  --refresh            Tracks neu laden statt aus Cache
  --output=<pfad>      Export-Pfad
  --confirm            Lösch-Bestätigung
  --help               Diese Hilfe anzeigen
`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const command = args._[0] || "help";

  if (command === "help" || args.flags.help) {
    printHelp();
    process.exit(0);
  }

  const context = await loadApiContext(args.flags.context);
  const client = new BeatportXhrClient(context);

  const dataPath =
    args.flags.data ||
    USER_DATA_PATHS.find((p) => existsSync(p)) ||
    USER_DATA_PATHS[0];
  const store = new DataStore(path.join(dataPath, "xhr-data"));
  await store.init();

  const commands = {
    context: cmdContext,
    scan: cmdScan,
    list: cmdList,
    tracks: cmdTracks,
    add: cmdAdd,
    remove: cmdRemove,
    rename: cmdRename,
    create: cmdCreate,
    delete: cmdDelete,
    export: cmdExport,
  };

  const handler = commands[command];
  if (!handler) {
    log(`Unbekannter Befehl: ${command}`);
    printHelp();
    process.exit(1);
  }

  try {
    await handler(client, args, store);
  } catch (error) {
    log(`✗ Fehler: ${error.message}`);
    if (args.flags.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
