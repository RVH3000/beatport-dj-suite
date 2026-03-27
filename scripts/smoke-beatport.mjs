#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  exportRunZip,
  listStoredRuns,
  migrateLegacyRuns,
  readRunPlaylists,
  requestRunPause,
  runAnalyzeSelection,
  runDelete,
  runDiscover,
} from "../electron-app/scanner/cdp-scanner.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[name] = true;
      continue;
    }
    options[name] = next;
    index += 1;
  }
  return options;
}

function stopFreshStartProcesses() {
  const patterns = [
    "Helium --remote-debugging-port=9222",
    "app_mode_loader --remote-debugging-port=9222",
  ];
  for (const pattern of patterns) {
    spawnSync("pkill", ["-f", pattern], { stdio: "ignore" });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const freshStart = Boolean(options["fresh-start"]);
  const baseConfig = {
    launchApp: true,
    deepAnalysis: false,
    analysisMethod: "auto",
    exportsRootDir: path.join(
      os.homedir(),
      "Downloads",
      "Beatport-Scanner-Exports"
    ),
  };
  if (options.host) baseConfig.host = options.host;
  if (options.port) baseConfig.port = options.port;
  if (options["app-path"]) baseConfig.appPath = options["app-path"];
  if (options["host-app-path"]) baseConfig.hostAppPath = options["host-app-path"];

  const report = {
    startedAt: new Date().toISOString(),
    steps: [],
  };

  if (freshStart) {
    stopFreshStartProcesses();
    await sleep(2500);
    report.steps.push({
      name: "fresh-start",
      host: baseConfig.host || "127.0.0.1",
      port: baseConfig.port || 9222,
      status: "restarted-debug-host",
    });
  }

  const legacyListing = await listStoredRuns(baseConfig);
  const legacyRunIds = legacyListing.runs
    .filter((run) => run.origin?.kind === "legacy-source")
    .map((run) => run.runId)
    .slice(0, 1);
  if (legacyRunIds.length > 0) {
    const migration = await migrateLegacyRuns(baseConfig, { runIds: legacyRunIds });
    report.steps.push({
      name: "legacy-migration",
      sourceRunIds: legacyRunIds,
      migrated: migration.migrated.map((entry) => entry.migratedRunId),
      skipped: migration.skipped.map((entry) => entry.sourceRunId),
    });
  }

  const discovery = await runDiscover(baseConfig);
  report.steps.push({
    name: "discovery",
    runId: discovery.run.runId,
    playlists: discovery.run.counts.playlistsDiscovered,
    duplicates: discovery.run.counts.duplicates,
  });

  const playlistListing = await readRunPlaylists(baseConfig, {
    runId: discovery.run.runId,
  });
  const selectedPlaylists = playlistListing.playlists.slice(0, 3).map((entry) => ({
    id: entry.id,
    name: entry.name,
    tracks: entry.tracks,
    key: entry.key,
  }));

  setTimeout(() => {
    requestRunPause(discovery.run.runId).catch(() => {});
  }, 1000);

  const paused = await runAnalyzeSelection({
    ...baseConfig,
    runId: discovery.run.runId,
    selectedPlaylists,
  });
  report.steps.push({
    name: "analysis-pause",
    runId: paused.run.runId,
    status: paused.run.status,
    analyzedPlaylists: paused.run.counts.analyzedPlaylists,
    analyzedTrackRows: paused.run.counts.analyzedTrackRows,
  });

  const resumed = await runAnalyzeSelection({
    ...baseConfig,
    runId: discovery.run.runId,
  });
  report.steps.push({
    name: "analysis-resume",
    runId: resumed.run.runId,
    status: resumed.run.status,
    analyzedPlaylists: resumed.run.counts.analyzedPlaylists,
    analyzedTrackRows: resumed.run.counts.analyzedTrackRows,
  });

  const zipResult = await exportRunZip(baseConfig, {
    runId: discovery.run.runId,
  });
  report.steps.push({
    name: "zip-export",
    runId: discovery.run.runId,
    zipPath: zipResult.zipPath,
  });

  let deleteGate = "unexpected-success";
  try {
    await runDelete({
      ...baseConfig,
      runId: discovery.run.runId,
      confirm: "FALSCH",
    });
  } catch (error) {
    deleteGate = String(error.message || error);
  }
  report.steps.push({
    name: "delete-gate",
    runId: discovery.run.runId,
    result: deleteGate,
  });

  report.finishedAt = new Date().toISOString();
  if (options.report) {
    await fs.mkdir(path.dirname(path.resolve(options.report)), { recursive: true });
    await fs.writeFile(
      path.resolve(options.report),
      JSON.stringify(report, null, 2),
      "utf8"
    );
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error.message || error)}\n`);
  process.exitCode = 1;
});
