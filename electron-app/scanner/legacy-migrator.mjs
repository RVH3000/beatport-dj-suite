import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  createRunId,
  createDefaultOrigin,
  normalizeRunManifest,
  toPlaylistRef,
  toIsoNow,
  ensureRunDirectories,
  ensureDerivedRunArtifacts,
  appendMirroredJsonLine,
} from "./run-store.mjs";

function buildMigrationTargetRun(sourceRun, runPaths, playlists, trackRows) {
  const migratedAt = toIsoNow();
  const normalized = normalizeRunManifest(
    {
      ...sourceRun,
      runId: runPaths.runId,
      origin: createDefaultOrigin("legacy-migrated"),
      migration: {
        sourceRunId: sourceRun.runId,
        sourceVersion: sourceRun.app?.version || "",
        migratedAt,
        mode: "copy",
      },
    },
    runPaths,
    {
      playlistsCount: playlists.length,
      duplicatesCount: sourceRun.duplicates?.length ?? 0,
      analyzedTrackRows: trackRows.length,
      analyzedPlaylists: sourceRun.playlistSummaries?.length ?? 0,
    }
  );

  const playlistRefs = playlists.map((entry) => toPlaylistRef(entry));
  if (playlistRefs.length > 0 && normalized.selection.selectedPlaylists.length === 0) {
    normalized.selection = {
      selectedPlaylists: playlistRefs,
      updatedAt: migratedAt,
      source: "migration_default_all",
    };
  }
  if (
    playlistRefs.length > 0 &&
    normalized.analysisPlan.selectedPlaylists.length === 0
  ) {
    normalized.analysisPlan = {
      ...normalized.analysisPlan,
      selectedPlaylists: playlistRefs,
      totalSelected: playlistRefs.length,
      updatedAt: migratedAt,
    };
  }
  if (
    normalized.analysisPlan.completedPlaylistRefs.length === 0 &&
    Array.isArray(normalized.playlistSummaries) &&
    normalized.playlistSummaries.length > 0
  ) {
    normalized.analysisPlan.completedPlaylistRefs = normalized.playlistSummaries.map(
      (entry) => toPlaylistRef(entry)
    );
  }

  if (
    normalized.counts.playlistsDiscovered > 0 &&
    normalized.counts.analyzedPlaylists === 0
  ) {
    normalized.status = "ready_for_analysis";
    normalized.phase = "ready_for_analysis";
    normalized.finishedAt = "";
  }

  normalized.schemaVersion = 2;
  normalized.origin = createDefaultOrigin("legacy-migrated");
  normalized.migration = {
    sourceRunId: sourceRun.runId,
    sourceVersion: sourceRun.app?.version || "",
    migratedAt,
    mode: "copy",
  };
  normalized.files = {
    ...normalized.files,
    archiveDir: runPaths.archiveDir,
    exportDir: runPaths.exportDir,
    manifestPath: runPaths.files.manifestPath,
    summaryPath: runPaths.files.summaryPath,
    eventsPath: runPaths.files.eventsPath,
    playlistsPath: runPaths.files.playlistsPath,
    duplicatesPath: runPaths.files.duplicatesPath,
    trackAnalysisPath: runPaths.files.trackAnalysisPath,
    statePath: runPaths.files.statePath,
    csvPath: runPaths.files.csvPath,
    analysisJsonPath: runPaths.files.analysisJsonPath,
    analysisTrackCsvPath: runPaths.files.analysisTrackCsvPath,
    analysisSummaryCsvPath: runPaths.files.analysisSummaryCsvPath,
    exportManifestPath: runPaths.exportFiles.manifestPath,
    exportSummaryPath: runPaths.exportFiles.summaryPath,
    exportStatePath: runPaths.exportFiles.statePath,
    exportCsvPath: runPaths.exportFiles.csvPath,
    exportAnalysisJsonPath: runPaths.exportFiles.analysisJsonPath,
    exportAnalysisTrackCsvPath: runPaths.exportFiles.analysisTrackCsvPath,
    exportAnalysisSummaryCsvPath: runPaths.exportFiles.analysisSummaryCsvPath,
  };
  return normalized;
}

/**
 * Migriert Legacy-Runs kopierend in das Schema v2.
 */
async function migrateLegacyRuns(config = {}, query = {}, { resolveConfig, resolveRunPaths, readRunArtifacts, listStoredRuns, persistExistingRunState, normalizePathInput }) {
  const cfg = resolveConfig(config);
  const runIds = Array.isArray(query.runIds)
    ? query.runIds.map((value) => normalizePathInput(value)).filter(Boolean)
    : [];
  const listing = await listStoredRuns(cfg);
  const sourceRuns = listing.runs.filter(
    (run) =>
      run.origin?.kind === "legacy-source" &&
      (runIds.length === 0 || runIds.includes(run.runId))
  );
  const results = [];

  for (const sourceRun of sourceRuns) {
    const existing = listing.runs.find(
      (run) =>
        run.origin?.kind === "legacy-migrated" &&
        run.migration?.sourceRunId === sourceRun.runId
    );
    if (existing) {
      results.push({
        sourceRunId: sourceRun.runId,
        migratedRunId: existing.runId,
        status: "already_migrated",
        run: existing,
      });
      continue;
    }

    const sourceArtifacts = await readRunArtifacts(cfg, sourceRun.runId);
    const migratedRunId = createRunId();
    const targetPaths = resolveRunPaths(cfg, migratedRunId);
    await ensureRunDirectories(targetPaths);
    await fs.cp(sourceArtifacts.runPaths.archiveDir, targetPaths.archiveDir, {
      recursive: true,
      force: true,
    });
    if (existsSync(sourceArtifacts.runPaths.exportDir)) {
      await fs.cp(sourceArtifacts.runPaths.exportDir, targetPaths.exportDir, {
        recursive: true,
        force: true,
      });
    } else {
      await fs.mkdir(targetPaths.exportDir, { recursive: true });
    }

    const migratedRun = buildMigrationTargetRun(
      sourceArtifacts.run,
      targetPaths,
      sourceArtifacts.playlists.map((entry) => toPlaylistRef(entry)),
      sourceArtifacts.trackRows
    );
    await ensureDerivedRunArtifacts(
      migratedRun,
      targetPaths,
      sourceArtifacts.playlists.map((entry) => toPlaylistRef(entry)),
      sourceArtifacts.trackRows
    );
    await persistExistingRunState(migratedRun, targetPaths.files.statePath);
    await appendMirroredJsonLine(
      targetPaths.files.eventsPath,
      targetPaths.exportFiles.eventsPath,
      {
        at: toIsoNow(),
        type: "legacy_migrated",
        payload: {
          sourceRunId: sourceRun.runId,
          sourceVersion: sourceRun.app?.version || "",
        },
      }
    );

    results.push({
      sourceRunId: sourceRun.runId,
      migratedRunId,
      status: "migrated",
      run: migratedRun,
    });
  }

  return {
    migrated: results.filter((entry) => entry.status === "migrated"),
    skipped: results.filter((entry) => entry.status !== "migrated"),
    totalRequested: sourceRuns.length,
    results,
  };
}

export {
  buildMigrationTargetRun,
  migrateLegacyRuns,
};
