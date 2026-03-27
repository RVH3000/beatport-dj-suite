#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { createHash } from "node:crypto";
import { WebSocket as WsWebSocket } from "ws";
import {
  SQLiteCacheStore,
  normalizePlaylistKey,
  resolveCacheDbPath,
} from "../cache/sqlite-cache.mjs";
import { toInt } from "../utils/common.mjs";

const DEFAULTS = {
  host: "127.0.0.1",
  port: 9222,
  targetPattern: "dj.beatport.com",
  timeoutMs: 15000,
  appPath: "/Users/roberth./Applications/Chromium Apps.localized/Beatport DJ.app",
  stateFile: ".beatport_duplicates_state.json",
  csvFile: "beatport_duplicates_backup.csv",
  analysisJsonFile: "beatport_playlist_deep_analysis.json",
  analysisTrackCsvFile: "beatport_playlist_track_analysis.csv",
  analysisSummaryCsvFile: "beatport_playlist_dimension_summary.csv",
  sidebarScrollStep: 900,
  deepAnalysisWaitMs: 850,
  analysisMethod: "auto",
  preferServerData: true,
  hostAppPath: "/Applications/Helium.app",
  launchApp: true,
  autoRecoverCdp: true,
  outputDir: "",
  archiveRootDir: "",
  exportsRootDir: "",
  statePath: "",
  runId: "",
  execPath: "",
  scannerAppPath: "",
  appVersion: "",
  appBuildId: "",
  canonicalAppPath: "/Users/roberth./Applications/Beatport Playlist Scanner.app",
  userDataPath: "",
  authMode: "internal",
  keychainEnabled: false,
  autoLoginEnabled: false,
  recoveryPolicy: "aggressive",
  fallbackEnabled: true,
  beatportSessionPartition: "persist:beatport-auth-v1",
  runtimeClientFactory: null,
  autoMigrateLegacyRuns: true,
  autoSelectLastCompatibleRun: true,
  deltaDiscoveryEnabled: true,
  deltaSourceRunId: "",
  startupMode: "delta-live",
  analysisPolicy: "selected-only",
  parallelism: 4,
  cacheEnabled: true,
  cacheDbPath: "",
};

const CONFIRM_TEXT = "LÖSCHEN BESTÄTIGT";
const RUN_SCHEMA_VERSION = 2;
const LEGACY_VERSION_CUTOFF = "1.1.0";
const RuntimeWebSocket = globalThis.WebSocket || WsWebSocket;
const RUN_CONTROLS = new Map();
const PLAYLIST_DISCOVERY_PER_PAGE = 100;
const PLAYLIST_TRACKS_PER_PAGE = 100;

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


function normalizePathInput(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const trimmed = String(value).trim();
  return trimmed.replace(/^['"]+|['"]+$/g, "");
}

function resolveConfig(config = {}) {
  const defaultExportDir = path.join(
    os.homedir(),
    "Downloads",
    "Beatport-Scanner-Exports"
  );
  const defaultArchiveDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Beatport Playlist Scanner",
    "runs"
  );
  const resolveDefaultOutputDir = () => {
    const requested = normalizePathInput(config.outputDir);
    if (requested) {
      // "/" ist auf modernen macOS-Systemen nicht verlässlich beschreibbar.
      if (process.platform === "darwin" && path.resolve(requested) === "/") {
        return defaultExportDir;
      }
      return requested;
    }
    if (DEFAULTS.outputDir) {
      return DEFAULTS.outputDir;
    }
    if (process.versions?.electron) {
      return defaultExportDir;
    }
    return process.cwd();
  };
  const normalizeLegacyRootPath = (value, fallbackName) => {
    const candidateRaw = normalizePathInput(value);
    const candidate = candidateRaw || fallbackName;
    if (!path.isAbsolute(candidate)) {
      return candidate;
    }
    const dir = path.dirname(candidate);
    if (dir !== "/") {
      return candidate;
    }
    const base = path.basename(candidate);
    const fallbackBase = path.basename(fallbackName);
    const fallbackBaseNoDot = fallbackBase.replace(/^\./, "");
    // Root-Level-Dateien immer auf den relativen Standardnamen zurückführen.
    if (
      base === fallbackBase ||
      base === fallbackBaseNoDot ||
      /^beatport_.*\.(csv|json)$/i.test(base) ||
      base.length > 0
    ) {
      return fallbackName;
    }
    return fallbackName;
  };

  return {
    host: config.host || DEFAULTS.host,
    port: toInt(config.port, DEFAULTS.port),
    targetPattern: config.targetPattern || DEFAULTS.targetPattern,
    timeoutMs: toInt(config.timeoutMs, DEFAULTS.timeoutMs),
    appPath: config.appPath || DEFAULTS.appPath,
    outputDir: resolveDefaultOutputDir(),
    archiveRootDir:
      normalizePathInput(config.archiveRootDir) || defaultArchiveDir,
    exportsRootDir:
      normalizePathInput(config.exportsRootDir) || resolveDefaultOutputDir(),
    stateFile: normalizeLegacyRootPath(config.stateFile, DEFAULTS.stateFile),
    csvFile: normalizeLegacyRootPath(config.csvFile, DEFAULTS.csvFile),
    analysisJsonFile: normalizeLegacyRootPath(
      config.analysisJsonFile,
      DEFAULTS.analysisJsonFile
    ),
    analysisTrackCsvFile:
      normalizeLegacyRootPath(
        config.analysisTrackCsvFile,
        DEFAULTS.analysisTrackCsvFile
      ),
    analysisSummaryCsvFile:
      normalizeLegacyRootPath(
        config.analysisSummaryCsvFile,
        DEFAULTS.analysisSummaryCsvFile
      ),
    deepAnalysis: config.deepAnalysis !== false,
    sidebarScrollStep: toInt(
      config.sidebarScrollStep,
      DEFAULTS.sidebarScrollStep
    ),
    deepAnalysisWaitMs: toInt(
      config.deepAnalysisWaitMs,
      DEFAULTS.deepAnalysisWaitMs
    ),
    analysisMethod:
      normalizePathInput(config.analysisMethod) || DEFAULTS.analysisMethod,
    preferServerData:
      typeof config.preferServerData === "boolean"
        ? config.preferServerData
        : DEFAULTS.preferServerData,
    hostAppPath: config.hostAppPath || DEFAULTS.hostAppPath,
    launchApp:
      typeof config.launchApp === "boolean"
        ? config.launchApp
        : DEFAULTS.launchApp,
    autoRecoverCdp:
      typeof config.autoRecoverCdp === "boolean"
        ? config.autoRecoverCdp
        : DEFAULTS.autoRecoverCdp,
    confirm: config.confirm,
    statePath: normalizePathInput(config.statePath),
    runId: normalizePathInput(config.runId),
    execPath: normalizePathInput(config.execPath),
    scannerAppPath: normalizePathInput(config.scannerAppPath),
    appVersion: normalizePathInput(config.appVersion),
    appBuildId: normalizePathInput(config.appBuildId),
    canonicalAppPath:
      normalizePathInput(config.canonicalAppPath) ||
      DEFAULTS.canonicalAppPath,
    userDataPath: normalizePathInput(config.userDataPath),
    authMode: normalizePathInput(config.authMode) || DEFAULTS.authMode,
    keychainEnabled:
      typeof config.keychainEnabled === "boolean"
        ? config.keychainEnabled
        : DEFAULTS.keychainEnabled,
    autoLoginEnabled:
      typeof config.autoLoginEnabled === "boolean"
        ? config.autoLoginEnabled
        : DEFAULTS.autoLoginEnabled,
    recoveryPolicy:
      normalizePathInput(config.recoveryPolicy) || DEFAULTS.recoveryPolicy,
    fallbackEnabled:
      typeof config.fallbackEnabled === "boolean"
        ? config.fallbackEnabled
        : DEFAULTS.fallbackEnabled,
    beatportSessionPartition:
      normalizePathInput(config.beatportSessionPartition) ||
      DEFAULTS.beatportSessionPartition,
    runtimeClientFactory:
      typeof config.runtimeClientFactory === "function"
        ? config.runtimeClientFactory
        : null,
    autoMigrateLegacyRuns:
      typeof config.autoMigrateLegacyRuns === "boolean"
        ? config.autoMigrateLegacyRuns
        : DEFAULTS.autoMigrateLegacyRuns,
    autoSelectLastCompatibleRun:
      typeof config.autoSelectLastCompatibleRun === "boolean"
        ? config.autoSelectLastCompatibleRun
        : DEFAULTS.autoSelectLastCompatibleRun,
    deltaDiscoveryEnabled:
      typeof config.deltaDiscoveryEnabled === "boolean"
        ? config.deltaDiscoveryEnabled
        : DEFAULTS.deltaDiscoveryEnabled,
    deltaSourceRunId: normalizePathInput(config.deltaSourceRunId),
    startupMode:
      normalizePathInput(config.startupMode) || DEFAULTS.startupMode,
    analysisPolicy:
      normalizePathInput(config.analysisPolicy) || DEFAULTS.analysisPolicy,
    parallelism: Math.min(
      6,
      Math.max(1, toInt(config.parallelism, DEFAULTS.parallelism))
    ),
    cacheEnabled:
      typeof config.cacheEnabled === "boolean"
        ? config.cacheEnabled
        : DEFAULTS.cacheEnabled,
    cacheDbPath:
      normalizePathInput(config.cacheDbPath) || resolveCacheDbPath(config),
  };
}

function resolvePath(filePath, baseDir) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  const base = baseDir || process.cwd();
  return path.resolve(base, filePath);
}

function sanitizeConfigForPersistence(config) {
  return {
    host: config.host,
    port: config.port,
    targetPattern: config.targetPattern,
    timeoutMs: config.timeoutMs,
    appPath: config.appPath,
    scannerAppPath: config.scannerAppPath,
    hostAppPath: config.hostAppPath,
    deepAnalysis: config.deepAnalysis,
    launchApp: config.launchApp,
    autoRecoverCdp: config.autoRecoverCdp,
    sidebarScrollStep: config.sidebarScrollStep,
    deepAnalysisWaitMs: config.deepAnalysisWaitMs,
    analysisMethod: config.analysisMethod,
    preferServerData: Boolean(config.preferServerData),
    stateFile: config.stateFile,
    csvFile: config.csvFile,
    analysisJsonFile: config.analysisJsonFile,
    analysisTrackCsvFile: config.analysisTrackCsvFile,
    analysisSummaryCsvFile: config.analysisSummaryCsvFile,
    archiveRootDir: config.archiveRootDir,
    exportsRootDir: config.exportsRootDir,
    authMode: config.authMode,
    keychainEnabled: Boolean(config.keychainEnabled),
    autoLoginEnabled: Boolean(config.autoLoginEnabled),
    recoveryPolicy: config.recoveryPolicy,
    fallbackEnabled: Boolean(config.fallbackEnabled),
    beatportSessionPartition: config.beatportSessionPartition,
    autoMigrateLegacyRuns: Boolean(config.autoMigrateLegacyRuns),
    autoSelectLastCompatibleRun: Boolean(config.autoSelectLastCompatibleRun),
    deltaDiscoveryEnabled: Boolean(config.deltaDiscoveryEnabled),
    deltaSourceRunId: config.deltaSourceRunId,
    startupMode: config.startupMode,
    analysisPolicy: config.analysisPolicy,
    parallelism: config.parallelism,
    cacheEnabled: Boolean(config.cacheEnabled),
    cacheDbPath: config.cacheDbPath,
  };
}

function sanitizeSensitiveText(value) {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(
      /\b(access_token|refresh_token|id_token|token|authorization|cookie|password)=([^&\s]+)/gi,
      "$1=[redacted]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [redacted]");
}

function sanitizeSensitiveValue(value, depth = 0) {
  if (depth > 6) {
    return "[redacted-depth-limit]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSensitiveValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/password|token|cookie|authorization|secret/i.test(key)) {
        clone[key] = "[redacted]";
        continue;
      }
      clone[key] = sanitizeSensitiveValue(entry, depth + 1);
    }
    return clone;
  }
  if (typeof value === "string") {
    return sanitizeSensitiveText(value);
  }
  return value;
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}`;
}

function parseVersionParts(version) {
  return String(version ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

function resolveStorageRoots(config) {
  const archiveRootDir = resolvePath(
    config.archiveRootDir ||
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Beatport Playlist Scanner",
        "runs"
      )
  );
  const exportsRootDir = resolvePath(
    config.exportsRootDir ||
      config.outputDir ||
      path.join(os.homedir(), "Downloads", "Beatport-Scanner-Exports")
  );
  return { archiveRootDir, exportsRootDir };
}

function resolveCacheRoots(config) {
  const exportsRootDir = resolveStorageRoots(config).exportsRootDir;
  const cacheDbPath = resolvePath(
    config.cacheDbPath || resolveCacheDbPath(config)
  );
  const cacheExportDir = path.join(exportsRootDir, "_cache");
  return {
    cacheDbPath,
    cacheExportDir,
  };
}

function resolveRunPaths(config, runId) {
  const roots = resolveStorageRoots(config);
  const archiveDir = path.join(roots.archiveRootDir, runId);
  const exportDir = path.join(roots.exportsRootDir, runId);
  const stateFileName = path.basename(config.stateFile || DEFAULTS.stateFile);
  const csvFileName = path.basename(config.csvFile || DEFAULTS.csvFile);
  const analysisJsonFileName = path.basename(
    config.analysisJsonFile || DEFAULTS.analysisJsonFile
  );
  const analysisTrackCsvFileName = path.basename(
    config.analysisTrackCsvFile || DEFAULTS.analysisTrackCsvFile
  );
  const analysisSummaryCsvFileName = path.basename(
    config.analysisSummaryCsvFile || DEFAULTS.analysisSummaryCsvFile
  );

  return {
    runId,
    archiveDir,
    exportDir,
    files: {
      manifestPath: path.join(archiveDir, "manifest.json"),
      summaryPath: path.join(archiveDir, "summary.json"),
      eventsPath: path.join(archiveDir, "events.jsonl"),
      playlistsPath: path.join(archiveDir, "playlists.jsonl"),
      duplicatesPath: path.join(archiveDir, "duplicates.jsonl"),
      trackAnalysisPath: path.join(archiveDir, "track-analysis.jsonl"),
      statePath: path.join(archiveDir, stateFileName),
      csvPath: path.join(archiveDir, csvFileName),
      analysisJsonPath: path.join(archiveDir, analysisJsonFileName),
      analysisTrackCsvPath: path.join(archiveDir, analysisTrackCsvFileName),
      analysisSummaryCsvPath: path.join(archiveDir, analysisSummaryCsvFileName),
    },
    exportFiles: {
      manifestPath: path.join(exportDir, "manifest.json"),
      summaryPath: path.join(exportDir, "summary.json"),
      eventsPath: path.join(exportDir, "events.jsonl"),
      playlistsPath: path.join(exportDir, "playlists.jsonl"),
      duplicatesPath: path.join(exportDir, "duplicates.jsonl"),
      trackAnalysisPath: path.join(exportDir, "track-analysis.jsonl"),
      statePath: path.join(exportDir, stateFileName),
      csvPath: path.join(exportDir, csvFileName),
      analysisJsonPath: path.join(exportDir, analysisJsonFileName),
      analysisTrackCsvPath: path.join(exportDir, analysisTrackCsvFileName),
      analysisSummaryCsvPath: path.join(exportDir, analysisSummaryCsvFileName),
    },
  };
}

async function createCacheStore(config = {}) {
  const cfg = resolveConfig(config);
  if (!cfg.cacheEnabled) {
    return null;
  }
  const store = new SQLiteCacheStore(cfg);
  await store.init();
  return store;
}

function buildCacheSummaryFromDetails(details = {}) {
  const playlist = details?.playlist || {};
  const trackRows = Array.isArray(details?.trackRows) ? details.trackRows : [];
  if (!playlist.playlistKey && !playlist.playlistId && !playlist.name) {
    return null;
  }
  return buildPlaylistSummaryFromTrackRows(
    {
      id: playlist.playlistId || playlist.playlistKey || "",
      name: playlist.name || "",
      tracks: playlist.tracks || "",
      key: playlist.key || playlist.playlistKey || "",
      serverTrackCount: playlist.serverTrackCount || playlist.tracks || 0,
    },
    trackRows.map((entry) => normalizeTrackRow({
      playlistId: playlist.playlistId || playlist.playlistKey || "",
      playlistName: playlist.name || "",
      playlistTracksExpected: playlist.tracks || "",
      ...entry,
    })),
    playlist.source || "cache"
  );
}

async function getCacheSnapshot(config = {}) {
  const cacheStore = await createCacheStore(config);
  if (!cacheStore) {
    return {
      cacheStore: null,
      playlists: [],
      duplicates: [],
      status: null,
    };
  }
  const rawPlaylists = await cacheStore.listPlaylists();
  const playlists = rawPlaylists.map((entry) =>
    toPlaylistRef({
      id: entry.id,
      name: entry.name,
      tracks: entry.tracks,
      key: entry.key,
      source: entry.source,
      serverTrackCount: entry.serverTrackCount,
      serverSeenAt: entry.serverSeenAt,
      discoveredAt: entry.discoveredAt,
      trackFingerprint: entry.trackFingerprint,
      syncState: entry.syncState,
      dirty: Number(entry.dirty || 0),
      isDuplicateCandidate: Number(entry.isDuplicateCandidate || 0),
      isDuplicateConfirmed: Number(entry.isDuplicateConfirmed || 0),
      lastDeepAnalyzedAt: entry.lastDeepAnalyzedAt,
      identity: entry.identity,
    })
  );
  const playlistSummaries = rawPlaylists
    .filter(
      (entry) =>
        normalizeLooseText(entry.trackFingerprint) ||
        Number(entry.isAnalyzed || 0) === 1
    )
    .map((entry) =>
      normalizePlaylistSummary({
        playlistId: entry.id || entry.identity,
        playlistName: entry.name,
        playlistTracksExpected: entry.tracks,
        analyzedTrackRows: 0,
        status: entry.syncState || "cache",
        analysisMethod: entry.source || "cache",
        source: entry.source || "cache",
        serverTrackCount: entry.serverTrackCount || entry.tracks || 0,
        trackFingerprint: entry.trackFingerprint || "",
        genreCounts: [],
        labelCounts: [],
        yearCounts: [],
      })
    );
  const duplicates = buildDuplicateEntries(playlists, playlistSummaries);
  return {
    cacheStore,
    playlists,
    duplicates,
    playlistSummaries,
    status: await cacheStore.getStatus(),
  };
}

async function ensureCacheWarm(config = {}) {
  const cfg = resolveConfig(config);
  const cacheStore = await createCacheStore(cfg);
  if (!cacheStore) {
    return null;
  }
  const status = await cacheStore.getStatus();
  if (Number(status?.counts?.playlists || 0) > 0) {
    return status;
  }
  await rebuildCacheFromRuns(cfg, { force: false });
  return await cacheStore.getStatus();
}

function createRunFileMap(config, runId) {
  return resolveRunPaths(resolveConfig(config), runId).files;
}

function derivePhaseFromStatus(status) {
  const normalized = normalizeLooseText(status).toLowerCase();
  if (!normalized) return "completed";
  if (normalized === "ready_for_analysis") return "ready_for_analysis";
  if (normalized === "paused") return "paused";
  if (normalized === "incomplete") return "incomplete";
  if (normalized === "running") return "analysis";
  return normalized;
}

function createDefaultOrigin(kind = "native") {
  return {
    kind,
    label:
      kind === "legacy-source"
        ? "Legacy-Quelle"
        : kind === "legacy-migrated"
          ? "Migrierter Run"
          : "Native",
  };
}

function isCompatibleOperationalRun(run = {}) {
  const kind = normalizeLooseText(run?.origin?.kind);
  if (!kind || kind === "legacy-source") {
    return false;
  }
  const status = normalizeLooseText(run?.status).toLowerCase();
  return (
    ["completed", "ready_for_analysis", "paused", "incomplete", "running"].includes(
      status
    ) && Number(run?.counts?.playlistsDiscovered || 0) > 0
  );
}

function pickPreferredCompatibleRun(runs = []) {
  const compatible = runs.filter((run) => isCompatibleOperationalRun(run));
  if (compatible.length === 0) {
    return null;
  }
  const scored = [...compatible].sort((left, right) => {
    const leftStatus = normalizeLooseText(left.status).toLowerCase();
    const rightStatus = normalizeLooseText(right.status).toLowerCase();
    const rank = (value) => {
      if (value === "paused") return 0;
      if (value === "ready_for_analysis") return 1;
      if (value === "completed") return 2;
      if (value === "incomplete") return 3;
      if (value === "running") return 4;
      return 5;
    };
    const rankDiff = rank(leftStatus) - rank(rightStatus);
    if (rankDiff !== 0) return rankDiff;
    return String(right.startedAt || "").localeCompare(String(left.startedAt || ""));
  });
  return scored[0] || null;
}

function normalizeMigrationPayload(migration = null) {
  if (!migration || typeof migration !== "object") {
    return null;
  }
  return {
    sourceRunId: normalizeLooseText(migration.sourceRunId),
    sourceVersion: normalizeLooseText(migration.sourceVersion),
    migratedAt: normalizeLooseText(migration.migratedAt),
    mode: normalizeLooseText(migration.mode) || "copy",
  };
}

function isLegacyRunManifest(manifest = {}) {
  if ((manifest?.origin?.kind || "") === "legacy-source") {
    return true;
  }
  if (Number(manifest?.schemaVersion || 0) < RUN_SCHEMA_VERSION) {
    return true;
  }
  if (!normalizeLooseText(manifest?.phase)) {
    return true;
  }
  const version = normalizeLooseText(manifest?.app?.version);
  if (!version) {
    return true;
  }
  return compareVersions(version, LEGACY_VERSION_CUTOFF) < 0;
}

function normalizeRunOrigin(manifest = {}) {
  const rawKind = normalizeLooseText(manifest?.origin?.kind);
  if (rawKind === "legacy-migrated" || rawKind === "native") {
    return {
      ...createDefaultOrigin(rawKind),
      ...(manifest.origin || {}),
      kind: rawKind,
    };
  }
  if (rawKind === "legacy-source") {
    return {
      ...createDefaultOrigin("legacy-source"),
      ...(manifest.origin || {}),
      kind: "legacy-source",
    };
  }
  return isLegacyRunManifest(manifest)
    ? createDefaultOrigin("legacy-source")
    : createDefaultOrigin("native");
}

function mergeRunSnapshots(...snapshots) {
  const merged = {};
  for (const snapshot of snapshots.filter(Boolean)) {
    Object.assign(merged, snapshot);
    for (const key of [
      "app",
      "config",
      "target",
      "counts",
      "selection",
      "analysisPlan",
      "networkHints",
      "files",
      "origin",
      "migration",
    ]) {
      if (
        snapshot[key] &&
        typeof snapshot[key] === "object" &&
        !Array.isArray(snapshot[key])
      ) {
        merged[key] = {
          ...(merged[key] || {}),
          ...snapshot[key],
        };
      }
    }
  }
  return merged;
}

function normalizeRunManifest(manifest = {}, runPaths, extras = {}) {
  const origin = normalizeRunOrigin(manifest);
  const migration = normalizeMigrationPayload(manifest?.migration);
  const files = {
    ...runPaths.files,
    exportManifestPath: runPaths.exportFiles.manifestPath,
    exportSummaryPath: runPaths.exportFiles.summaryPath,
    exportStatePath: runPaths.exportFiles.statePath,
    exportCsvPath: runPaths.exportFiles.csvPath,
    exportAnalysisJsonPath: runPaths.exportFiles.analysisJsonPath,
    exportAnalysisTrackCsvPath: runPaths.exportFiles.analysisTrackCsvPath,
    exportAnalysisSummaryCsvPath: runPaths.exportFiles.analysisSummaryCsvPath,
    ...manifest.files,
  };
  const playlistsCount =
    extras.playlistsCount ??
    manifest.counts?.playlistsDiscovered ??
    manifest.playlistsDiscovered ??
    manifest.playlistCount ??
    0;
  const duplicatesCount =
    extras.duplicatesCount ??
    manifest.counts?.duplicates ??
    manifest.duplicateCount ??
    (Array.isArray(manifest.duplicates) ? manifest.duplicates.length : 0);
  const analyzedPlaylists =
    extras.analyzedPlaylists ??
    manifest.counts?.analyzedPlaylists ??
    manifest.deepAnalysis?.analyzedPlaylists ??
    (Array.isArray(manifest.playlistSummaries)
      ? manifest.playlistSummaries.length
      : 0);
  const analyzedTrackRows =
    extras.analyzedTrackRows ??
    manifest.counts?.analyzedTrackRows ??
    manifest.deepAnalysis?.analyzedTrackRows ??
    0;
  const selectedPlaylists =
    manifest.counts?.selectedPlaylists ??
    manifest.selection?.selectedPlaylists?.length ??
    manifest.analysisPlan?.selectedPlaylists?.length ??
    0;

  let status = normalizeLooseText(manifest.status) || "completed";
  let phase = normalizeLooseText(manifest.phase) || derivePhaseFromStatus(status);
  if (origin.kind === "legacy-source" && status === "running") {
    status = "incomplete";
    phase = "incomplete";
  }
  const manifestRunId = normalizeLooseText(manifest.runId);
  const resolvedRunId =
    origin.kind === "legacy-migrated" &&
    runPaths?.runId &&
    (!manifestRunId || manifestRunId === migration?.sourceRunId)
      ? runPaths.runId
      : manifestRunId || runPaths.runId;

  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: resolvedRunId,
    status,
    phase,
    startedAt: normalizeLooseText(manifest.startedAt),
    finishedAt: normalizeLooseText(manifest.finishedAt),
    app: {
      ...(manifest.app || {}),
    },
    config: {
      ...(manifest.config || {}),
    },
    target: {
      ...(manifest.target || {}),
    },
    counts: {
      playlistsDiscovered: playlistsCount,
      selectedPlaylists,
      duplicates: duplicatesCount,
      analyzedPlaylists,
      analyzedTrackRows,
    },
    selection: {
      selectedPlaylists: Array.isArray(manifest.selection?.selectedPlaylists)
        ? manifest.selection.selectedPlaylists.map((entry) => toPlaylistRef(entry))
        : [],
      updatedAt: normalizeLooseText(manifest.selection?.updatedAt),
      source:
        normalizeLooseText(manifest.selection?.source) ||
        (origin.kind === "legacy-source" ? "legacy_source" : "default_all"),
    },
    analysisPlan: {
      method:
        normalizeLooseText(manifest.analysisPlan?.method) ||
        normalizeLooseText(manifest.config?.analysisMethod) ||
        DEFAULTS.analysisMethod,
      selectedPlaylists: Array.isArray(manifest.analysisPlan?.selectedPlaylists)
        ? manifest.analysisPlan.selectedPlaylists.map((entry) => toPlaylistRef(entry))
        : Array.isArray(manifest.selection?.selectedPlaylists)
          ? manifest.selection.selectedPlaylists.map((entry) => toPlaylistRef(entry))
          : [],
      completedPlaylistRefs: Array.isArray(
        manifest.analysisPlan?.completedPlaylistRefs
      )
        ? manifest.analysisPlan.completedPlaylistRefs.map((entry) =>
            toPlaylistRef(entry)
          )
        : [],
      currentPlaylistRef: manifest.analysisPlan?.currentPlaylistRef
        ? toPlaylistRef(manifest.analysisPlan.currentPlaylistRef)
        : null,
      totalSelected:
        manifest.analysisPlan?.totalSelected ??
        manifest.selection?.selectedPlaylists?.length ??
        0,
      updatedAt: normalizeLooseText(manifest.analysisPlan?.updatedAt),
    },
    networkHints: {
      ...(manifest.networkHints || {}),
    },
    files,
    duplicates: Array.isArray(manifest.duplicates) ? manifest.duplicates : [],
    playlistSummaries: Array.isArray(manifest.playlistSummaries)
      ? manifest.playlistSummaries
      : [],
    lastDeleteRun: manifest.lastDeleteRun ?? null,
    origin,
    migration,
  };
}

async function readOptionalJson(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function ensureRunDirectories(runPaths) {
  await fs.mkdir(runPaths.archiveDir, { recursive: true });
  await fs.mkdir(runPaths.exportDir, { recursive: true });
}

async function writeMirroredFile(archivePath, exportPath, content) {
  await fs.writeFile(archivePath, content, "utf8");
  await fs.writeFile(exportPath, content, "utf8");
}

async function appendMirroredFile(archivePath, exportPath, content) {
  await fs.appendFile(archivePath, content, "utf8");
  await fs.appendFile(exportPath, content, "utf8");
}

async function appendMirroredJsonLine(archivePath, exportPath, payload) {
  await appendMirroredFile(
    archivePath,
    exportPath,
    `${JSON.stringify(payload)}\n`
  );
}

function toIsoNow() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLooseText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseHumanTrackCount(value) {
  const text = normalizeLooseText(value);
  if (!text) {
    return "";
  }
  const explicitMatch = text.match(
    /(^|\b)(\d+)\s*(tracks?|songs?|titles?|titel)\b/i
  );
  if (explicitMatch) {
    return explicitMatch[2];
  }
  if (/^\d+$/.test(text)) {
    return text;
  }
  return "";
}

function normalizePlaylistImageAlt(value) {
  return normalizeLooseText(value).replace(/\s+#\d+\s*$/u, "");
}

function toPlaylistRef(entry = {}) {
  const id = normalizeLooseText(entry.id ?? entry.playlistId ?? "").replace(
    /^ref-/,
    ""
  );
  const name = normalizeLooseText(entry.name ?? entry.playlistName ?? "");
  const tracks = normalizeLooseText(
    entry.tracks ?? entry.playlistTracksExpected ?? ""
  );
  const key = normalizeLooseText(
    entry.key || (name && tracks ? `${name}_${tracks}` : "")
  );
  const source = normalizeLooseText(entry.source);
  const discoveredAt = normalizeLooseText(entry.discoveredAt);
  const serverSeenAt = normalizeLooseText(entry.serverSeenAt);
  const trackFingerprint = normalizeLooseText(entry.trackFingerprint);
  const duplicateStatus = normalizeLooseText(entry.duplicateStatus);
  const duplicateGroupKey = normalizeLooseText(entry.duplicateGroupKey);
  const serverTrackCountRaw =
    entry.serverTrackCount ??
    entry.trackCount ??
    entry.playlistTrackCount ??
    tracks;
  const serverTrackCountText = normalizeLooseText(serverTrackCountRaw);
  const serverTrackCount = Number.parseInt(
    parseHumanTrackCount(serverTrackCountText) || serverTrackCountText,
    10
  );
  return {
    ...entry,
    id,
    playlistId: id || normalizeLooseText(entry.playlistId),
    name,
    playlistName: name || normalizeLooseText(entry.playlistName),
    tracks,
    playlistTracksExpected:
      tracks || normalizeLooseText(entry.playlistTracksExpected),
    key,
    source,
    discoveredAt,
    serverSeenAt,
    serverTrackCount: Number.isFinite(serverTrackCount)
      ? serverTrackCount
      : null,
    trackFingerprint,
    duplicateStatus,
    duplicateGroupKey,
  };
}

function getPlaylistIdentity(entry = {}) {
  const ref = toPlaylistRef(entry);
  return ref.id || ref.key || (ref.name ? `${ref.name}_${ref.tracks}` : "");
}

function extractYearValue(value) {
  const hit = String(value ?? "").match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return hit ? hit[1] : "";
}

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

function fallbackValue(value, fallback = "(unbekannt)") {
  return normalizeLooseText(value) || fallback;
}

function incrementBucket(bucket, value) {
  const key = fallbackValue(value);
  bucket[key] = (bucket[key] || 0) + 1;
  return key;
}

function sortCountList(bucket = {}) {
  return Object.entries(bucket)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, count }));
}

function buildTrackFingerprint(trackRows = []) {
  const orderedIds = (Array.isArray(trackRows) ? trackRows : [])
    .slice()
    .sort(
      (left, right) =>
        Number(left.trackIndex ?? 0) - Number(right.trackIndex ?? 0) ||
        String(left.trackId ?? "").localeCompare(String(right.trackId ?? ""))
    )
    .map((entry) => normalizeLooseText(entry.trackId))
    .filter(Boolean);
  if (orderedIds.length === 0) {
    return "";
  }
  return createHash("sha1").update(orderedIds.join("|")).digest("hex");
}

function normalizeTrackRow(entry = {}) {
  const playlistId = normalizeLooseText(entry.playlistId ?? entry.id).replace(
    /^ref-/,
    ""
  );
  const playlistName = normalizeLooseText(entry.playlistName ?? entry.name);
  const playlistTracksExpected = normalizeLooseText(
    entry.playlistTracksExpected ?? entry.tracks
  );
  const trackId = normalizeLooseText(entry.trackId);
  const releaseDate = normalizeLooseText(
    entry.releaseDate ?? entry.release ?? entry.publishDate
  );
  const releaseYearValue =
    entry.releaseYear ?? entry.year ?? extractYearValue(releaseDate);
  const parsedReleaseYear = Number.parseInt(String(releaseYearValue || ""), 10);

  return {
    ...entry,
    playlistId,
    playlistName,
    playlistTracksExpected,
    trackIndex: Number(entry.trackIndex ?? 0) || 0,
    trackId,
    trackTitle: fallbackValue(entry.trackTitle),
    artists: fallbackValue(entry.artists),
    genre: fallbackValue(entry.genre),
    label: fallbackValue(entry.label),
    year: fallbackValue(releaseYearValue),
    release: fallbackValue(entry.release ?? releaseDate),
    releaseDate,
    releaseYear: Number.isFinite(parsedReleaseYear) ? parsedReleaseYear : null,
    bpm: normalizeLooseText(entry.bpm),
    key: normalizeLooseText(entry.key),
    mixName: normalizeLooseText(entry.mixName),
    source: normalizeLooseText(entry.source || "dom"),
  };
}

function normalizePlaylistSummary(summary = {}) {
  const normalizedTrackRows = Array.isArray(summary.trackRows)
    ? summary.trackRows.map((entry) => normalizeTrackRow(entry))
    : [];
  const genreBucket = {};
  const labelBucket = {};
  const yearBucket = {};
  if (normalizedTrackRows.length > 0) {
    for (const row of normalizedTrackRows) {
      incrementBucket(genreBucket, row.genre);
      incrementBucket(labelBucket, row.label);
      incrementBucket(yearBucket, row.year);
    }
  }
  return {
    ...summary,
    playlistId: normalizeLooseText(summary.playlistId).replace(/^ref-/, ""),
    playlistName: normalizeLooseText(summary.playlistName),
    playlistTracksExpected: normalizeLooseText(summary.playlistTracksExpected),
    analyzedTrackRows:
      Number(summary.analyzedTrackRows ?? normalizedTrackRows.length) || 0,
    status: normalizeLooseText(summary.status) || "unknown",
    analysisMethod:
      normalizeLooseText(summary.analysisMethod || summary.source) || "dom",
    source: normalizeLooseText(summary.source || summary.analysisMethod || "dom"),
    serverTrackCount:
      Number(summary.serverTrackCount ?? summary.playlistTrackCount) ||
      (normalizedTrackRows.length > 0 ? normalizedTrackRows.length : 0),
    trackFingerprint:
      normalizeLooseText(summary.trackFingerprint) ||
      buildTrackFingerprint(normalizedTrackRows),
    genreCounts:
      Array.isArray(summary.genreCounts) && summary.genreCounts.length > 0
        ? summary.genreCounts
        : sortCountList(genreBucket),
    labelCounts:
      Array.isArray(summary.labelCounts) && summary.labelCounts.length > 0
        ? summary.labelCounts
        : sortCountList(labelBucket),
    yearCounts:
      Array.isArray(summary.yearCounts) && summary.yearCounts.length > 0
        ? summary.yearCounts
        : sortCountList(yearBucket),
  };
}

function normalizeApiPlaylistRecord(entry = {}) {
  const name = normalizeLooseText(entry.name);
  const trackCount = Number(entry.track_count ?? entry.trackCount ?? 0) || 0;
  return toPlaylistRef({
    ...entry,
    id: normalizeLooseText(entry.id),
    playlistId: normalizeLooseText(entry.id),
    name,
    playlistName: name,
    tracks: String(trackCount),
    playlistTracksExpected: String(trackCount),
    key: name && Number.isFinite(trackCount) ? `${name}_${trackCount}` : "",
    source: "xhr",
    discoveredAt: toIsoNow(),
    serverSeenAt: toIsoNow(),
    serverTrackCount: trackCount,
  });
}

function normalizeApiTrackRecord(playlist, resultEntry = {}) {
  const track = resultEntry.track || {};
  const mixName = normalizeLooseText(track.mix_name);
  const trackTitle = [normalizeLooseText(track.name), mixName]
    .filter(Boolean)
    .join(" - ");
  const releaseDate =
    normalizeLooseText(track.publish_date) ||
    normalizeLooseText(track.new_release_date) ||
    normalizeLooseText(track.release?.publish_date);
  const artists = Array.isArray(track.artists)
    ? track.artists.map((entry) => normalizeLooseText(entry.name)).filter(Boolean)
    : [];
  return normalizeTrackRow({
    playlistId: playlist.id,
    playlistName: playlist.name,
    playlistTracksExpected: playlist.tracks,
    trackIndex: Number(resultEntry.position ?? 0) || 0,
    trackId: normalizeLooseText(track.id ?? resultEntry.id),
    trackTitle,
    artists: artists.join(", "),
    genre:
      normalizeLooseText(track.genre?.name) ||
      normalizeLooseText(track.sub_genre?.name),
    label: normalizeLooseText(track.release?.label?.name),
    release: releaseDate,
    releaseDate,
    releaseYear: extractYearValue(releaseDate),
    bpm: normalizeLooseText(track.bpm),
    key: normalizeLooseText(track.key?.name),
    mixName,
    source: "xhr",
  });
}

function buildPlaylistSummaryFromTrackRows(playlist, trackRows, analysisMethod = "xhr") {
  const normalizedRows = (Array.isArray(trackRows) ? trackRows : []).map((entry) =>
    normalizeTrackRow(entry)
  );
  const playlistTrackCount = Number(
    playlist.serverTrackCount ?? playlist.tracks ?? 0
  );
  const genreBucket = {};
  const labelBucket = {};
  const yearBucket = {};

  for (const row of normalizedRows) {
    incrementBucket(genreBucket, row.genre);
    incrementBucket(labelBucket, row.label);
    incrementBucket(yearBucket, row.year);
  }

  return normalizePlaylistSummary({
    playlistId: playlist.id,
    playlistName: playlist.name,
    playlistTracksExpected: playlist.tracks,
    analyzedTrackRows: normalizedRows.length,
    status: "ok",
    analysisMethod,
    source: analysisMethod,
    serverTrackCount:
      Number.isFinite(playlistTrackCount) && playlistTrackCount > 0
        ? playlistTrackCount
        : normalizedRows.length,
    trackFingerprint: buildTrackFingerprint(normalizedRows),
    genreCounts: sortCountList(genreBucket),
    labelCounts: sortCountList(labelBucket),
    yearCounts: sortCountList(yearBucket),
  });
}

function getPlaylistFingerprint(entry = {}, summariesByIdentity = new Map()) {
  const identity = getPlaylistIdentity(entry);
  const summary = summariesByIdentity.get(identity);
  return normalizeLooseText(entry.trackFingerprint || summary?.trackFingerprint);
}

function getPlaylistServerTrackCount(entry = {}, summariesByIdentity = new Map()) {
  const identity = getPlaylistIdentity(entry);
  const summary = summariesByIdentity.get(identity);
  const value =
    entry.serverTrackCount ??
    summary?.serverTrackCount ??
    parseHumanTrackCount(entry.tracks) ??
    entry.tracks;
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildDuplicateEntries(playlists = [], playlistSummaries = []) {
  const groups = new Map();
  const summariesByIdentity = new Map(
    (Array.isArray(playlistSummaries) ? playlistSummaries : []).map((entry) => [
      getPlaylistIdentity(entry),
      normalizePlaylistSummary(entry),
    ])
  );

  for (const rawEntry of Array.isArray(playlists) ? playlists : []) {
    const entry = toPlaylistRef(rawEntry);
    const name = normalizeLooseText(entry.name).toLowerCase();
    const tracks = parseHumanTrackCount(
      String(getPlaylistServerTrackCount(entry, summariesByIdentity) || entry.tracks)
    );
    if (!name || tracks === "") {
      continue;
    }
    const groupKey = `${name}_${tracks}`;
    const current = groups.get(groupKey) || [];
    current.push(entry);
    groups.set(groupKey, current);
  }

  const duplicates = [];
  for (const [groupKey, group] of groups.entries()) {
    if (group.length < 2) {
      continue;
    }

    const fingerprints = group
      .map((entry) => getPlaylistFingerprint(entry, summariesByIdentity))
      .filter(Boolean);
    const uniqueFingerprints = new Set(fingerprints);
    const hasEmptyTrackGroup = group.every(
      (entry) => getPlaylistServerTrackCount(entry, summariesByIdentity) === 0
    );

    if (uniqueFingerprints.size > 1) {
      continue;
    }

    const duplicateStatus =
      !hasEmptyTrackGroup &&
      fingerprints.length === group.length &&
      uniqueFingerprints.size === 1
        ? "confirmed"
        : "candidate";

    for (const entry of group) {
      duplicates.push({
        ...entry,
        source: entry.source || "xhr",
        serverTrackCount: getPlaylistServerTrackCount(entry, summariesByIdentity),
        trackFingerprint: getPlaylistFingerprint(entry, summariesByIdentity),
        duplicateStatus,
        duplicateGroupKey: groupKey,
      });
    }
  }

  return duplicates.sort(
    (left, right) =>
      String(left.name || "").localeCompare(String(right.name || "")) ||
      Number(left.serverTrackCount || left.tracks || 0) -
        Number(right.serverTrackCount || right.tracks || 0) ||
      String(left.id || "").localeCompare(String(right.id || ""))
  );
}

function buildDuplicateCsvRows(duplicates = []) {
  return rowsToCsv(
    ["Name", "Tracks", "ID", "Status", "Quelle", "Fingerprint"],
    duplicates.map((entry) => ({
      Name: entry.name ?? "",
      Tracks: entry.serverTrackCount ?? entry.tracks ?? "",
      ID: entry.id ?? "",
      Status: entry.duplicateStatus ?? "",
      Quelle: entry.source ?? "",
      Fingerprint: entry.trackFingerprint ?? "",
    }))
  );
}

function getRunControl(runId) {
  const key = normalizePathInput(runId);
  if (!key) {
    return { pauseRequested: false };
  }
  if (!RUN_CONTROLS.has(key)) {
    RUN_CONTROLS.set(key, { pauseRequested: false });
  }
  return RUN_CONTROLS.get(key);
}

function clearRunControl(runId) {
  const key = normalizePathInput(runId);
  if (key) {
    RUN_CONTROLS.delete(key);
  }
}

async function readJsonLines(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }
  const raw = await fs.readFile(filePath, "utf8");
  return String(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

async function readRunArtifacts(config = {}, runId) {
  const cfg = resolveConfig({
    ...config,
    runId: runId || config.runId || "",
  });
  const resolvedRunId = normalizePathInput(runId || cfg.runId);
  if (!resolvedRunId) {
    throw new Error("Run-ID fehlt.");
  }

  const runPaths = resolveRunPaths(cfg, resolvedRunId);
  const stateSnapshot = await readOptionalJson(runPaths.files.statePath);
  const manifestSnapshot = await readOptionalJson(runPaths.files.manifestPath);
  const summarySnapshot = await readOptionalJson(runPaths.files.summaryPath);
  const manifest = mergeRunSnapshots(
    summarySnapshot,
    manifestSnapshot,
    stateSnapshot
  );
  if (!manifest) {
    throw new Error(`Manifest für Run ${resolvedRunId} nicht gefunden.`);
  }

  const playlists = await readJsonLines(runPaths.files.playlistsPath);
  const trackRows = await readJsonLines(runPaths.files.trackAnalysisPath);
  const duplicates = await readJsonLines(runPaths.files.duplicatesPath);
  const normalized = normalizeRunManifest(manifest, runPaths, {
    playlistsCount: playlists.length || undefined,
    duplicatesCount:
      duplicates.length ||
      (Array.isArray(manifest.duplicates) ? manifest.duplicates.length : undefined),
    analyzedTrackRows: trackRows.length || undefined,
  });

  if ((!normalized.duplicates || normalized.duplicates.length === 0) && duplicates.length > 0) {
    normalized.duplicates = duplicates;
    normalized.counts.duplicates = duplicates.length;
  }
  if (
    (!normalized.playlistSummaries || normalized.playlistSummaries.length === 0) &&
    existsSync(runPaths.files.analysisJsonPath)
  ) {
    const analysisJson = await readOptionalJson(runPaths.files.analysisJsonPath);
    if (Array.isArray(analysisJson?.playlists)) {
      normalized.playlistSummaries = analysisJson.playlists;
      normalized.counts.analyzedPlaylists = analysisJson.playlists.length;
    }
  }

  return {
    cfg,
    runPaths,
    manifestRaw: manifest,
    run: normalized,
    playlists,
    duplicates,
    trackRows,
  };
}

function resolveRunZipPath(config = {}, run) {
  const cfg = resolveConfig(config);
  const { exportsRootDir } = resolveStorageRoots(cfg);
  return path.join(exportsRootDir, `${run.runId}.zip`);
}

function createArchiveZip(sourceDir, zipPath) {
  if (existsSync(zipPath)) {
    spawnSync("rm", ["-f", zipPath], { stdio: "ignore" });
  }
  const result = spawnSync(
    "ditto",
    ["-c", "-k", "--keepParent", sourceDir, zipPath],
    {
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      normalizeLooseText(result.stderr) ||
        normalizeLooseText(result.stdout) ||
        `ZIP-Export für ${sourceDir} fehlgeschlagen.`
    );
  }
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} für ${url}`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timeout beim Aufruf von ${url}`);
    }
    throw new Error(
      `CDP-Endpunkt nicht erreichbar (${url}): ${error.message ?? error}`
    );
  } finally {
    clearTimeout(timer);
  }
}

function selectTarget(targets, pattern) {
  const eligible = targets.filter(
    (target) =>
      target.webSocketDebuggerUrl &&
      target.url &&
      !target.url.startsWith("devtools://")
  );
  const preferredEligible = eligible.filter((target) => {
    const type = String(target.type || "").toLowerCase();
    return !type || type === "page";
  });
  const pool = preferredEligible.length > 0 ? preferredEligible : eligible;

  if (pool.length === 0) {
    throw new Error("Kein CDP-Target gefunden.");
  }

  const normalizedPattern = (pattern ?? "").toLowerCase().trim();
  if (!normalizedPattern) {
    return pool[0];
  }

  const matches = pool.filter((target) => {
    const haystack = `${target.title ?? ""} ${target.url ?? ""}`.toLowerCase();
    return haystack.includes(normalizedPattern);
  });
  if (matches.length > 0) {
    return matches[0];
  }

  const preview = pool
    .slice(0, 5)
    .map((target) => `${target.title || "(ohne Titel)"} <${target.url || "-"}>`)
    .join("; ");
  throw new Error(
    `Kein CDP-Target passt zu target-pattern "${pattern}". Verfügbare Targets: ${preview}`
  );
}

function launchMacApp(appPath, args = []) {
  if (!appPath || !existsSync(appPath)) {
    return false;
  }
  const openArgs = ["-na", appPath];
  if (args.length > 0) {
    openArgs.push("--args", ...args);
  }
  const child = spawn("open", openArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}

function launchHostBrowserApp(hostAppPath, port) {
  return launchMacApp(hostAppPath, [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
  ]);
}

function launchBeatportApp(appPath, port) {
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
  ];
  return launchMacApp(appPath, args);
}

function readPlistValue(appPath, key) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(plistPath)) {
    return "";
  }

  const result = spawnSync("plutil", ["-extract", key, "raw", plistPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "";
  }
  return String(result.stdout || "").trim();
}

function findAppByBundleId(bundleId) {
  if (!bundleId) {
    return "";
  }

  const result = spawnSync(
    "mdfind",
    [`kMDItemCFBundleIdentifier == "${bundleId}"`],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    return "";
  }

  const candidates = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".app") && existsSync(line));

  if (candidates.length === 0) {
    return "";
  }

  const inApplications = candidates.find((item) => item.startsWith("/Applications/"));
  return inApplications || candidates[0];
}

function detectHostAppPath(shortcutAppPath, fallbackPath) {
  if (fallbackPath && existsSync(fallbackPath)) {
    return fallbackPath;
  }

  const knownMap = {
    "net.imput.helium": "/Applications/Helium.app",
    "com.google.Chrome": "/Applications/Google Chrome.app",
    "org.chromium.Chromium": "/Applications/Chromium.app",
  };

  const bundleId = readPlistValue(shortcutAppPath, "CrBundleIdentifier");
  if (bundleId) {
    const discovered = findAppByBundleId(bundleId);
    if (discovered) {
      return discovered;
    }
    if (knownMap[bundleId] && existsSync(knownMap[bundleId])) {
      return knownMap[bundleId];
    }
  }

  if (existsSync(DEFAULTS.hostAppPath)) {
    return DEFAULTS.hostAppPath;
  }
  return "";
}

function quitMacAppByBundleId(bundleId) {
  if (!bundleId) {
    return;
  }
  spawnSync("osascript", ["-e", `tell application id "${bundleId}" to quit`], {
    stdio: "ignore",
  });
}

async function cdpEndpointReachable(config) {
  const listUrl = `http://${config.host}:${config.port}/json/list`;
  try {
    await fetchJson(listUrl, Math.max(1000, Math.min(config.timeoutMs, 6000)));
    return { ok: true, url: listUrl };
  } catch (error) {
    return { ok: false, url: listUrl, error };
  }
}

async function waitForCdpEndpoint(config, attempts, delayMs) {
  for (let i = 0; i < attempts; i += 1) {
    const status = await cdpEndpointReachable(config);
    if (status.ok) {
      return status;
    }
    if (i < attempts - 1) {
      await sleep(delayMs);
    } else {
      return status;
    }
  }
  return { ok: false, url: `http://${config.host}:${config.port}/json/list` };
}

function buildCdpUnavailableMessage(config, extra = "") {
  const listUrl = `http://${config.host}:${config.port}/json/list`;
  const lines = [
    `CDP-Endpunkt nicht erreichbar (${listUrl}).`,
    "Bitte starte den Host-Browser mit aktivem Remote-Debugging-Port.",
    `Empfohlener Host-Browser: ${config.hostAppPath || "(nicht erkannt)"}`,
  ];
  if (extra) {
    lines.push(extra);
  }
  return lines.join(" ");
}

async function ensureCdpEndpoint(config) {
  const initial = await waitForCdpEndpoint(config, 2, 350);
  if (initial.ok) {
    return;
  }

  if (!config.launchApp) {
    throw new Error(
      buildCdpUnavailableMessage(
        config,
        'Setze in der UI "App vor Scan starten" auf aktiv.'
      )
    );
  }

  launchBeatportApp(config.appPath, config.port);
  let status = await waitForCdpEndpoint(config, 8, 700);
  if (status.ok) {
    return;
  }

  if (process.platform !== "darwin" || !config.autoRecoverCdp) {
    throw new Error(buildCdpUnavailableMessage(config));
  }

  const hostAppPath = detectHostAppPath(config.appPath, config.hostAppPath);
  if (!hostAppPath) {
    throw new Error(
      buildCdpUnavailableMessage(
        config,
        "Host-Browserpfad konnte nicht erkannt werden."
      )
    );
  }
  config.hostAppPath = hostAppPath;

  const hostBundleId = readPlistValue(hostAppPath, "CFBundleIdentifier");
  const shortcutBundleId = readPlistValue(config.appPath, "CFBundleIdentifier");
  quitMacAppByBundleId(shortcutBundleId);
  quitMacAppByBundleId(hostBundleId);
  await sleep(1400);

  launchHostBrowserApp(hostAppPath, config.port);
  await sleep(3200);
  launchBeatportApp(config.appPath, config.port);
  status = await waitForCdpEndpoint(config, 12, 850);
  if (status.ok) {
    return;
  }

  throw new Error(
    buildCdpUnavailableMessage(
      config,
      "Automatische Recovery war erfolglos. Bitte Host-Browser manuell neu starten."
    )
  );
}

class CDPClient {
  constructor({ host, port, targetPattern, timeoutMs }) {
    this.host = host;
    this.port = port;
    this.targetPattern = targetPattern;
    this.timeoutMs = timeoutMs;
    this.ws = null;
    this.target = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    const listUrl = `http://${this.host}:${this.port}/json/list`;
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const targets = await fetchJson(listUrl, this.timeoutMs);
        this.target = selectTarget(targets, this.targetPattern);

        await this.openSocket(this.target.webSocketDebuggerUrl);
        return this.target;
      } catch (error) {
        lastError = error;
        await this.close().catch(() => {});
        if (attempt < 2) {
          await sleep(900);
        }
      }
    }

    throw lastError || new Error("CDP-Verbindung konnte nicht aufgebaut werden.");
  }

  async openSocket(wsUrl) {
    await new Promise((resolve, reject) => {
      const ws = new RuntimeWebSocket(wsUrl);
      this.ws = ws;

      const openHandler = () => {
        cleanup();
        resolve();
      };

      const errorHandler = (error) => {
        cleanup();
        reject(error);
      };

      const closeHandler = () => {
        this.rejectAllPending(new Error("CDP-Socket wurde geschlossen."));
      };

      const messageHandler = (event) => {
        this.handleMessage(event.data);
      };

      const cleanup = () => {
        ws.removeEventListener("open", openHandler);
        ws.removeEventListener("error", errorHandler);
      };

      ws.addEventListener("open", openHandler);
      ws.addEventListener("error", errorHandler);
      ws.addEventListener("close", closeHandler);
      ws.addEventListener("message", messageHandler);
    });
  }

  handleMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (!payload.id) {
      return;
    }

    const entry = this.pending.get(payload.id);
    if (!entry) {
      return;
    }

    this.pending.delete(payload.id);
    clearTimeout(entry.timer);

    if (payload.error) {
      entry.reject(
        new Error(
          `CDP Fehler ${payload.error.code}: ${payload.error.message ?? "Unbekannt"}`
        )
      );
      return;
    }

    entry.resolve(payload.result);
  }

  rejectAllPending(error) {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  async send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== RuntimeWebSocket.OPEN) {
      throw new Error("CDP-Socket ist nicht verbunden.");
    }

    const id = ++this.nextId;
    const packet = { id, method, params };

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout bei CDP-Aufruf ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(packet));
    });
  }

  async evaluate(expression, returnByValue = true) {
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await this.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue,
        });

        if (result.exceptionDetails) {
          const exception = result.exceptionDetails.exception?.description;
          throw new Error(
            `Fehler in Runtime.evaluate: ${exception ?? result.exceptionDetails.text}`
          );
        }

        return returnByValue ? result.result?.value : result.result;
      } catch (error) {
        const message = String(error?.message || error);
        lastError = error;
        if (
          attempt < 3 &&
          /Execution context was destroyed|Cannot find context with specified id/i.test(
            message
          )
        ) {
          await sleep(450);
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error("Runtime.evaluate fehlgeschlagen.");
  }

  async close() {
    if (!this.ws) {
      return;
    }
    if (this.ws.readyState === RuntimeWebSocket.OPEN) {
      this.ws.close();
      await sleep(100);
    }
    this.ws = null;
    this.rejectAllPending(new Error("CDP-Client beendet."));
  }
}

async function createScannerClientConnection(config) {
  const cfg = resolveConfig(config);
  const preferInternal =
    cfg.authMode === "internal" && typeof cfg.runtimeClientFactory === "function";
  let internalError = null;

  if (preferInternal) {
    try {
      const client = await cfg.runtimeClientFactory(cfg);
      const target = await client.connect();
      return {
        client,
        target: {
          id: target?.id ?? "internal",
          title: target?.title ?? "Beatport Internal Session",
          url: target?.url ?? "",
          mode: "internal",
        },
        mode: "internal",
      };
    } catch (error) {
      internalError = error;
      if (!cfg.fallbackEnabled) {
        throw error;
      }
    }
  }

  await ensureCdpEndpoint(cfg);
  const client = new CDPClient(cfg);
  const target = await client.connect();
  return {
    client,
    target: {
      ...target,
      mode: "external-fallback",
      internalFallbackReason: internalError
        ? sanitizeSensitiveText(String(internalError.message || internalError))
        : "",
    },
    mode: "external-fallback",
  };
}

function fillUrlTemplate(template, replacements = {}) {
  return Object.entries(replacements).reduce(
    (url, [key, value]) =>
      url.replace(new RegExp(`\\{${key}\\}`, "g"), encodeURIComponent(String(value))),
    template
  );
}

class BeatportApiClient {
  constructor(runtimeClient, context, options = {}) {
    this.runtimeClient = runtimeClient;
    this.context = context;
    this.preferServerData = options.preferServerData !== false;
  }

  static async create(runtimeClient, cfg, options = {}) {
    if (typeof runtimeClient?.resolveBeatportApiContext !== "function") {
      return null;
    }
    const context = await runtimeClient.resolveBeatportApiContext({
      playlistId: options.playlistId || "",
      forceRefresh: Boolean(options.forceRefresh),
    });
    if (!context?.authorization) {
      return null;
    }
    return new BeatportApiClient(runtimeClient, context, options);
  }

  async refreshContext(options = {}) {
    if (typeof this.runtimeClient?.resolveBeatportApiContext !== "function") {
      return this.context;
    }
    this.context = await this.runtimeClient.resolveBeatportApiContext({
      playlistId: options.playlistId || "",
      forceRefresh: true,
    });
    return this.context;
  }

  async fetchJson(url, options = {}, retry = true) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        accept: this.context.accept || "application/json, text/plain, */*",
        authorization: this.context.authorization,
        referer: this.context.referer || "https://dj.beatport.com/",
        "user-agent": this.context.userAgent || "",
        ...(options.headers || {}),
      },
    });

    if ((response.status === 401 || response.status === 403) && retry) {
      await this.refreshContext({
        playlistId: options.playlistId || "",
      });
      return await this.fetchJson(url, options, false);
    }
    if (!response.ok) {
      throw new Error(`Beatport API ${response.status} für ${url}`);
    }
    return await response.json();
  }

  buildDiscoveryUrl(page = 1, perPage = PLAYLIST_DISCOVERY_PER_PAGE) {
    return fillUrlTemplate(
      this.context.discoveryTemplate ||
        "https://api.beatport.com/v4/my/playlists/?per_page={perPage}&page={page}",
      {
        page,
        perPage,
      }
    );
  }

  buildPlaylistUrl(playlistId) {
    return fillUrlTemplate(
      this.context.playlistTemplate ||
        "https://api.beatport.com/v4/my/playlists/{playlistId}/",
      {
        playlistId,
      }
    );
  }

  buildTracksUrl(playlistId, page = 1, perPage = PLAYLIST_TRACKS_PER_PAGE) {
    return fillUrlTemplate(
      this.context.tracksTemplate ||
        "https://api.beatport.com/v4/my/playlists/{playlistId}/tracks/?per_page={perPage}&page={page}",
      {
        playlistId,
        page,
        perPage,
      }
    );
  }

  async discoverPlaylists() {
    const playlists = [];
    let nextUrl = this.buildDiscoveryUrl(1, PLAYLIST_DISCOVERY_PER_PAGE);
    let page = 1;
    while (nextUrl) {
      const payload = await this.fetchJson(nextUrl);
      const results = Array.isArray(payload?.results) ? payload.results : [];
      playlists.push(...results.map((entry) => normalizeApiPlaylistRecord(entry)));
      if (payload?.next) {
        nextUrl = String(payload.next);
      } else if (results.length === PLAYLIST_DISCOVERY_PER_PAGE) {
        page += 1;
        nextUrl = this.buildDiscoveryUrl(page, PLAYLIST_DISCOVERY_PER_PAGE);
      } else {
        nextUrl = "";
      }
    }
    return playlists;
  }

  async fetchPlaylistMeta(playlistId) {
    return await this.fetchJson(this.buildPlaylistUrl(playlistId), {
      playlistId,
    });
  }

  async fetchPlaylistTracks(playlistId) {
    const rows = [];
    let nextUrl = this.buildTracksUrl(playlistId, 1, PLAYLIST_TRACKS_PER_PAGE);
    let page = 1;

    while (nextUrl) {
      const payload = await this.fetchJson(nextUrl, { playlistId });
      const results = Array.isArray(payload?.results) ? payload.results : [];
      rows.push(...results);
      if (payload?.next) {
        nextUrl = String(payload.next);
      } else if (results.length === PLAYLIST_TRACKS_PER_PAGE) {
        page += 1;
        nextUrl = this.buildTracksUrl(playlistId, page, PLAYLIST_TRACKS_PER_PAGE);
      } else {
        nextUrl = "";
      }
    }

    return rows;
  }

  async analyzePlaylist(playlist) {
    const meta = await this.fetchPlaylistMeta(playlist.id);
    const playlistRecord = {
      ...playlist,
      ...normalizeApiPlaylistRecord(meta),
      tracks: String(meta?.track_count ?? playlist.serverTrackCount ?? playlist.tracks ?? ""),
      serverTrackCount:
        Number(meta?.track_count ?? playlist.serverTrackCount ?? playlist.tracks ?? 0) || 0,
    };
    const trackPayloads = await this.fetchPlaylistTracks(playlistRecord.id);
    const trackRows = trackPayloads.map((entry) =>
      normalizeApiTrackRecord(playlistRecord, entry)
    );
    const summary = buildPlaylistSummaryFromTrackRows(
      playlistRecord,
      trackRows,
      "xhr"
    );
    return {
      ...summary,
      trackRows,
      playlistId: playlistRecord.id,
      playlistName: playlistRecord.name,
      playlistTracksExpected: playlistRecord.tracks,
      status: "ok",
      analysisMethod: "xhr",
      source: "xhr",
    };
  }
}

function buildPageHelperSource(config) {
  const payload = JSON.stringify({
    sidebarScrollStep: toInt(config.sidebarScrollStep, DEFAULTS.sidebarScrollStep),
    deepAnalysisWaitMs: toInt(config.deepAnalysisWaitMs, DEFAULTS.deepAnalysisWaitMs),
  });

  return String.raw`
  const cfg = ${payload};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const parseTrackCount = (value) => {
    const text = normalize(value);
    if (!text) return "";
    const match = text.match(/(^|\b)(\d+)\s*(tracks?|songs?|titles?|titel)\b/i);
    if (match) return match[2];
    return /^\d+$/.test(text) ? text : "";
  };
  const normalizePlaylistImageAlt = (value) =>
    normalize(value).replace(/\s+#\d+\s*$/u, "");
  const extractYear = (value) => {
    const hit = String(value ?? "").match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
    return hit ? hit[1] : "";
  };
  const toCountList = (mapObject) =>
    Object.entries(mapObject)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));
  const playlistRowSelector = [
    'div.menu-left-container',
    'div.playlist-container',
    'div[data-testid="playlist-row"]',
    'div[data-testid*="playlist-row"]',
    '[data-testid*="playlistRow"]',
    '[data-playlist-id]',
  ].join(", ");
  const isVisible = (node) => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(node.getClientRects().length || node.offsetHeight || node.offsetWidth);
  };
  const getPlaylistRows = () => {
    const dedupe = new Map();
    [...document.querySelectorAll(playlistRowSelector)].forEach((row) => {
      if (!(row instanceof Element)) return;
      const resolved = row.closest('.menu-left-container') || row;
      const hasPlaylistId = normalize(resolved.getAttribute("data-playlist-id"));
      const testId = normalize(resolved.getAttribute("data-testid")).toLowerCase();
      const className = String(resolved.className || "").toLowerCase();
      const text = normalize(resolved.innerText || resolved.textContent);
      const looksLikePlaylist =
        hasPlaylistId ||
        testId.includes("playlist") ||
        className.includes("menu-left-container") ||
        className.includes("playlist-container");
      if (!looksLikePlaylist) return;
      if (!/tracks?/i.test(text) && !hasPlaylistId) return;
      const key = resolved.id || (className + "|" + text);
      if (!dedupe.has(key)) {
        dedupe.set(key, resolved);
      }
    });
    return [...dedupe.values()];
  };
  const findScrollableAncestor = (node) => {
    let current = node;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY || "";
      if (/(auto|scroll)/i.test(overflowY) && current.scrollHeight > current.clientHeight + 20) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };
  const findPlaylistContainer = () => {
    const explicit =
      document.querySelector('#my-playlists') ||
      document.querySelector('div[aria-label="Playlists"]');
    if (explicit) {
      const explicitContainer = findScrollableAncestor(explicit) || explicit;
      if (
        getPlaylistRows().length > 0 ||
        explicitContainer.scrollHeight > explicitContainer.clientHeight + 20
      ) {
        return explicitContainer;
      }
    }
    const rows = getPlaylistRows();
    if (rows.length > 0) {
      const rowContainer = findScrollableAncestor(rows[0]);
      return rowContainer || rows[0].parentElement || document.scrollingElement || document.documentElement;
    }
    const fallbackCandidates = [
      ...document.querySelectorAll('[aria-label*="Playlist"], [data-testid*="playlists"]'),
    ].filter((node) => {
      if (!(node instanceof Element)) return false;
      if (!isVisible(node)) return false;
      const text = normalize(node.innerText || node.textContent);
      return /playlist/i.test(text);
    });
    for (const candidate of fallbackCandidates) {
      const container = findScrollableAncestor(candidate) || candidate;
      if (
        container.querySelector?.(playlistRowSelector) ||
        container.scrollHeight > container.clientHeight + 20
      ) {
        return container;
      }
    }
    return null;
  };
  const ensurePlaylistContainer = async () => {
    let scrollContainer = findPlaylistContainer();
    for (let i = 0; !scrollContainer && i < 20; i += 1) {
      await sleep(350);
      scrollContainer = findPlaylistContainer();
    }
    if (!scrollContainer) {
      const navCandidate = [...document.querySelectorAll('a, button, [role="button"]')].find((node) =>
        /playlist/i.test((node.innerText || node.textContent || "").trim())
      );
      if (navCandidate) {
        navCandidate.click();
        await sleep(1200);
        for (let i = 0; !scrollContainer && i < 20; i += 1) {
          await sleep(350);
          scrollContainer = findPlaylistContainer();
        }
      }
    }
    return scrollContainer;
  };
  const readPlaylistRow = (row) => {
    const rowText = normalize(row.innerText || row.textContent);
    const infoText = normalize(
      row.querySelector('.playlist-menu-infos')?.innerText ||
      row.querySelector('.playlist-container')?.innerText
    );
    const infoLines = String(
      row.querySelector('.playlist-menu-infos')?.innerText ||
        row.querySelector('.playlist-container')?.innerText ||
        row.innerText ||
        row.textContent ||
        ""
    )
      .split("\n")
      .map((line) => normalize(line))
      .filter(Boolean);
    const visibleName =
      normalize(
        row.querySelector('.playlist-title, .playlist-name, .type-medium.fz13, .type-medium.fz14')?.innerText
      ) ||
      infoLines.find((line) => !/tracks?\b/i.test(line)) ||
      normalize(row.querySelector('span[class*="name"]')?.innerText) ||
      normalize(row.getAttribute("data-playlist-name")) ||
      normalize(rowText.split("\n")[0]);
    const imageName = normalizePlaylistImageAlt(
      row.querySelector('img[alt]')?.getAttribute("alt")
    );
    const visibleNameBase = visibleName.replace(/[.…]+$/u, "").trim();
    const name =
      (imageName &&
      (!visibleName ||
        /[.…]{1,3}\s*$/u.test(visibleName) ||
        (visibleNameBase &&
          imageName.toLowerCase().startsWith(visibleNameBase.toLowerCase()))))
        ? imageName
        : visibleName || imageName;
    const tracks =
      parseTrackCount(row.querySelector('.playlist-menu-owner')?.innerText) ||
      parseTrackCount(row.querySelector('span[class*="tracks"]')?.innerText) ||
      parseTrackCount(row.getAttribute("data-track-count")) ||
      (() => {
        const match = infoText.match(/(^|\b)(\d+)\s*(tracks?|songs?|titles?|titel)\b/i);
        return match ? match[2] : "";
      })() ||
      (() => {
        const match = rowText.match(/(^|\b)(\d+)\s*(tracks?|songs?|titles?|titel)\b/i);
        return match ? match[2] : "";
      })();
    const rawId =
      normalize(row.getAttribute("data-playlist-id")) ||
      normalize(row.querySelector('.playlist-container')?.getAttribute("data-playlist-id")) ||
      normalize(row.querySelector('.playlist-container')?.id) ||
      normalize(row.querySelector('[id^="ref-"]')?.id);
    const id = rawId.replace(/^ref-/, "");
    const key = name + "_" + tracks;
    return { id, name, tracks, key };
  };
  const applyDuplicateMarkers = () => {
    const keySet = window.__codexBeatportDuplicateKeys;
    if (!(keySet instanceof Set)) return;
    getPlaylistRows().forEach((row) => {
      const info = readPlaylistRow(row);
      const isDuplicate = Boolean(info.key && keySet.has(info.key));
      if (!isDuplicate) {
        if (row.dataset.codexDuplicateMarked === "1") {
          delete row.dataset.codexDuplicateMarked;
          delete row.dataset.codexDuplicateKey;
          row.style.outline = "";
          row.style.outlineOffset = "";
          row.style.backgroundColor = "";
        }
        return;
      }
      if (
        row.dataset.codexDuplicateMarked === "1" &&
        row.dataset.codexDuplicateKey === info.key
      ) {
        return;
      }
      row.dataset.codexDuplicateMarked = "1";
      row.dataset.codexDuplicateKey = info.key;
      row.style.outline = "3px solid #FFD400";
      row.style.outlineOffset = "-2px";
      row.style.backgroundColor = "rgba(255, 212, 0, 0.15)";
    });
  };
  const installDuplicateMarker = (duplicateKeys) => {
    if (window.__codexDuplicateMarkerInterval) {
      window.clearInterval(window.__codexDuplicateMarkerInterval);
      window.__codexDuplicateMarkerInterval = null;
    }
    if (window.__codexDuplicateMarkerObserver) {
      window.__codexDuplicateMarkerObserver.disconnect();
      window.__codexDuplicateMarkerObserver = null;
    }
    window.__codexBeatportDuplicateKeys = new Set(duplicateKeys || []);
    applyDuplicateMarkers();
    window.__codexDuplicateMarkerInterval = window.setInterval(
      applyDuplicateMarkers,
      800
    );
    if (document.body) {
      const observer = new MutationObserver(() => applyDuplicateMarkers());
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      window.__codexDuplicateMarkerObserver = observer;
    }
  };
  `;
}

function buildDiscoveryStepExpression(config) {
  return String.raw`(async () => {
${buildPageHelperSource(config)}
  const scrollContainer = await ensurePlaylistContainer();
  if (!scrollContainer) {
    return {
      error:
        'Playlist-Container nicht gefunden (div[aria-label="Playlists"]). Bitte Beatport DJ Playlists-Ansicht öffnen.',
    };
  }

  const rows = getPlaylistRows()
    .map((row) => readPlaylistRow(row))
    .filter((entry) => entry.name && entry.tracks);
  const beforeTop = scrollContainer.scrollTop;
  const beforeHeight = scrollContainer.scrollHeight;
  const step = cfg.sidebarScrollStep > 0 ? cfg.sidebarScrollStep : 900;

  scrollContainer.scrollTop = Math.min(
    scrollContainer.scrollTop + step,
    Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
  );
  await sleep(700);

  const afterTop = scrollContainer.scrollTop;
  const afterHeight = scrollContainer.scrollHeight;
  return {
    rows,
    beforeTop,
    afterTop,
    beforeHeight,
    afterHeight,
    clientHeight: scrollContainer.clientHeight,
    stagnant:
      beforeTop === afterTop && beforeHeight === afterHeight,
  };
})()`;
}

function buildFinalizeDiscoveryExpression(duplicates, csvContent, config) {
  const payload = JSON.stringify({
    duplicateKeys: duplicates.map((entry) => entry.key),
    csvContent,
  });

  return String.raw`(async () => {
${buildPageHelperSource(config)}
  const scrollContainer = await ensurePlaylistContainer();
  if (!scrollContainer) {
    return { downloadLinkId: "" };
  }

  const payload = ${payload};
  installDuplicateMarker(payload.duplicateKeys);

  let link = document.getElementById("codex-beatport-csv-download");
  if (!link) {
    link = document.createElement("a");
    link.id = "codex-beatport-csv-download";
    document.body.appendChild(link);
  }

  const oldObjectUrl = link.dataset.codexObjectUrl;
  if (oldObjectUrl) URL.revokeObjectURL(oldObjectUrl);

  const blob = new Blob([payload.csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.dataset.codexObjectUrl = objectUrl;
  link.download = "beatport_duplicates_backup.csv";
  link.textContent = "beatport_duplicates_backup.csv herunterladen";

  Object.assign(link.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    padding: "10px 12px",
    borderRadius: "8px",
    background: "#FFD400",
    color: "#1B1B1B",
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    fontWeight: "700",
    fontSize: "12px",
    lineHeight: "1.2",
    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
    textDecoration: "none",
  });

  return { downloadLinkId: link.id };
})()`;
}

function buildAnalyzePlaylistExpression(config, playlist) {
  const payload = JSON.stringify({
    playlist,
    sidebarScrollStep: toInt(config.sidebarScrollStep, DEFAULTS.sidebarScrollStep),
    deepAnalysisWaitMs: toInt(
      config.deepAnalysisWaitMs,
      DEFAULTS.deepAnalysisWaitMs
    ),
  });

  return String.raw`(async () => {
${buildPageHelperSource(config)}
  const payload = ${payload};
  const scrollContainer = await ensurePlaylistContainer();
  if (!scrollContainer) {
    return {
      playlistId: payload.playlist.id,
      playlistName: payload.playlist.name,
      playlistTracksExpected: payload.playlist.tracks,
      analyzedTrackRows: 0,
      status: "playlist_container_not_found",
      genreCounts: [],
      labelCounts: [],
      yearCounts: [],
      trackRows: [],
    };
  }

  const escapedId = (value) => {
    const raw = String(value ?? "");
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(raw);
    }
    return raw.replace(/"/g, '\\"');
  };
  const rowIsVisible = (node) => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(node.getClientRects().length || node.offsetHeight || node.offsetWidth);
  };
  const fallbackValue = (value) => (normalize(value) ? normalize(value) : "(unbekannt)");
  const incCount = (bucket, value) => {
    const key = fallbackValue(value);
    bucket[key] = (bucket[key] || 0) + 1;
    return key;
  };
  const readBySelectors = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (!node) continue;
      const text = normalize(node.innerText || node.textContent);
      if (text) return text;
    }
    return "";
  };
  const readByAttributeHint = (node, hints) => {
    const attrs = node.getAttributeNames ? node.getAttributeNames() : [];
    for (const attrName of attrs) {
      const lowered = attrName.toLowerCase();
      if (!hints.some((hint) => lowered.includes(hint))) continue;
      const value = normalize(node.getAttribute(attrName));
      if (value) return value;
    }
    return "";
  };
  const readPlaylistRowByEntry = (entry) => {
    if (entry.id) {
      const candidate = document.querySelector(
        '[data-playlist-id="' + escapedId(entry.id) + '"]'
      );
      if (candidate) return candidate;
    }
    const rows = getPlaylistRows();
    return (
      rows.find((row) => {
        const info = readPlaylistRow(row);
        return info.name === entry.name && info.tracks === entry.tracks;
      }) || null
    );
  };
  const locatePlaylistRow = async (entry) => {
    let row = readPlaylistRowByEntry(entry);
    if (row) return row;
    scrollContainer.scrollTop = 0;
    await sleep(180);
    const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    let rounds = 0;
    while (rounds < 220) {
      row = readPlaylistRowByEntry(entry);
      if (row) return row;
      const nextTop = Math.min(
        scrollContainer.scrollTop + payload.sidebarScrollStep,
        maxTop
      );
      if (nextTop === scrollContainer.scrollTop) break;
      scrollContainer.scrollTop = nextTop;
      rounds += 1;
      await sleep(180);
    }
    return null;
  };
  const getTrackRows = () => {
    const primaryTrackContainer =
      document.querySelector('#ref-list > div[id^="FSL-"]:not([id*="recommended"])') ||
      document.querySelector('.content-playlist-v2 #ref-list > div[id^="FSL-"]:not([id*="recommended"])') ||
      document.querySelector('.content-playlist-v2 [id^="FSL-"]:not([id*="recommended"])');
    if (primaryTrackContainer) {
      const primaryRows = [...primaryTrackContainer.querySelectorAll('div[id^="DI-"][id$="-TRACK"]')].filter(
        (row) => rowIsVisible(row)
      );
      if (primaryRows.length > 0) return primaryRows;
    }

    const selectors = [
      'div[id^="DI-"][id$="-TRACK"]',
      'div[data-testid="track-row"]',
      'div[data-testid*="track-row"]',
      'div[data-testid*="trackRow"]',
      'tr[data-testid*="track"]',
      '[role="row"][data-testid*="track"]',
      '[role="row"]',
    ];
    for (const selector of selectors) {
      const rows = [...document.querySelectorAll(selector)].filter((row) => {
        if (row.matches(playlistRowSelector)) return false;
        if (
          scrollContainer &&
          scrollContainer.contains(row) &&
          row.matches('[data-playlist-id], [data-testid*="playlist"]')
        ) {
          return false;
        }
        if (!rowIsVisible(row)) return false;
        const text = normalize(row.innerText || row.textContent);
        return Boolean(text);
      });
      if (rows.length > 0) return rows;
    }
    return [];
  };
  const getCells = (row) => {
    const directChildren = [...row.children].filter((node) =>
      normalize(node.innerText || node.textContent)
    );
    if (directChildren.length >= 2) return directChildren;
    const semantic = [...row.querySelectorAll('[role="gridcell"], td')].filter(
      (node) => normalize(node.innerText || node.textContent)
    );
    if (semantic.length >= 2) return semantic;
    return directChildren.length ? directChildren : [row];
  };
  const readCellByIndex = (cells, index) => {
    if (typeof index !== "number") return "";
    const cell = cells[index];
    return normalize(cell?.innerText || cell?.textContent);
  };
  const getHeaderIndexes = (rows) => {
    const firstRow = rows[0];
    if (!firstRow) return {};
    const root =
      firstRow.closest(
        '[role="grid"], table, [data-testid*="track-list"], [data-testid*="tracks-table"], [class*="track-list"], [class*="tracks-table"], main'
      ) ||
      document.querySelector('.content-playlist-v2, #ref-list') ||
      document;
    const headers = [
      ...root.querySelectorAll('.list-header, [role="columnheader"], thead th, [data-testid*="header"]'),
    ];
    const indexes = {};
    headers.forEach((header, idx) => {
      const text = normalize(header.innerText || header.textContent).toLowerCase();
      if (!text) return;
      if (indexes.genre === undefined && /genre/.test(text)) indexes.genre = idx;
      if (indexes.label === undefined && /(label|imprint)/.test(text)) indexes.label = idx;
      if (indexes.release === undefined && /(release|released|date|jahr|year)/.test(text)) {
        indexes.release = idx;
      }
      if (indexes.title === undefined && /(title|track|song|titel)/.test(text)) {
        indexes.title = idx;
      }
    });
    return indexes;
  };

  const targetRow = await locatePlaylistRow(payload.playlist);
  if (!targetRow) {
    return {
      playlistId: payload.playlist.id,
      playlistName: payload.playlist.name,
      playlistTracksExpected: payload.playlist.tracks,
      analyzedTrackRows: 0,
      status: "playlist_not_found",
      genreCounts: [],
      labelCounts: [],
      yearCounts: [],
      trackRows: [],
    };
  }

  targetRow.scrollIntoView({ block: "center" });
  targetRow.click();
  await sleep(payload.deepAnalysisWaitMs > 0 ? payload.deepAnalysisWaitMs : 850);

  let trackRows = [];
  for (let waitRound = 0; waitRound < 24; waitRound += 1) {
    trackRows = getTrackRows();
    if (trackRows.length > 0) break;
    const emptyNode = document.querySelector(
      '[data-testid*="empty"], [class*="empty"], [aria-label*="No tracks"], [aria-label*="Keine Tracks"]'
    );
    if (emptyNode && normalize(emptyNode.innerText || emptyNode.textContent)) break;
    await sleep(220);
  }

  const headerIndexes = getHeaderIndexes(trackRows);
  const genreCounts = {};
  const labelCounts = {};
  const yearCounts = {};
  const analysisRows = [];

  trackRows.forEach((trackRow, index) => {
    const cells = getCells(trackRow);
    const rowText = normalize(trackRow.innerText || trackRow.textContent);
    const placeholderValues = [...trackRow.querySelectorAll('.type-placeholder')]
      .map((node) => normalize(node.innerText || node.textContent))
      .filter(Boolean);
    const trackTitle =
      readBySelectors(trackRow, [
        '.track-name',
        '[data-testid*="track-name"]',
        '[data-testid*="track-title"]',
        '[class*="track-name"]',
        '[class*="track-title"]',
        'a[href*="/track/"]',
      ]) ||
      readCellByIndex(cells, headerIndexes.title) ||
      normalize(cells[0]?.innerText || cells[0]?.textContent) ||
      ("Track " + String(index + 1));
    const genreRaw =
      readBySelectors(trackRow, [
        '.track-genre',
        '[data-testid*="genre"]',
        '[class*="genre"]',
        '[aria-label*="Genre"]',
      ]) ||
      readCellByIndex(cells, headerIndexes.genre) ||
      readByAttributeHint(trackRow, ["genre"]);
    const labelRaw =
      readBySelectors(trackRow, [
        '.track-label',
        '[data-testid*="label"]',
        '[class*="label"]',
        '[aria-label*="Label"]',
        '[data-testid*="imprint"]',
      ]) ||
      readCellByIndex(cells, headerIndexes.label) ||
      readByAttributeHint(trackRow, ["label", "imprint"]);
    let releaseRaw =
      readBySelectors(trackRow, [
        '[data-testid*="release"]',
        '[data-testid*="date"]',
        '.type-placeholder',
        '[class*="release"]',
        '[class*="date"]',
        '[aria-label*="Released"]',
        '[aria-label*="Date"]',
      ]) ||
      placeholderValues.find((value) =>
        /\b(19\d{2}|20\d{2}|21\d{2})\b/.test(value) ||
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(value)
      ) ||
      readCellByIndex(cells, headerIndexes.release) ||
      readByAttributeHint(trackRow, ["release", "date", "year", "released"]);
    if (!releaseRaw) {
      releaseRaw = rowText;
    }
    const yearRaw = extractYear(releaseRaw) || extractYear(rowText);
    const genre = incCount(genreCounts, genreRaw);
    const label = incCount(labelCounts, labelRaw);
    const year = incCount(yearCounts, yearRaw);

    analysisRows.push({
      playlistId: payload.playlist.id,
      playlistName: payload.playlist.name,
      playlistTracksExpected: payload.playlist.tracks,
      trackIndex: index + 1,
      trackTitle: fallbackValue(trackTitle),
      genre,
      label,
      year,
      release: fallbackValue(releaseRaw),
    });
  });

  return {
    playlistId: payload.playlist.id,
    playlistName: payload.playlist.name,
    playlistTracksExpected: payload.playlist.tracks,
    analyzedTrackRows: trackRows.length,
    status: "ok",
    genreCounts: toCountList(genreCounts),
    labelCounts: toCountList(labelCounts),
    yearCounts: toCountList(yearCounts),
    trackRows: analysisRows,
  };
})()`;
}

function buildReadCurrentPlaylistExpression(config, playlist) {
  const payload = JSON.stringify({
    playlist,
    deepAnalysisWaitMs: toInt(
      config.deepAnalysisWaitMs,
      DEFAULTS.deepAnalysisWaitMs
    ),
  });

  return String.raw`(async () => {
${buildPageHelperSource(config)}
  const payload = ${payload};
  const sleepMs = payload.deepAnalysisWaitMs > 0 ? payload.deepAnalysisWaitMs : 850;
  await sleep(sleepMs);

  const rowIsVisible = (node) => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(node.getClientRects().length || node.offsetHeight || node.offsetWidth);
  };
  const fallbackValue = (value) => (normalize(value) ? normalize(value) : "(unbekannt)");
  const incCount = (bucket, value) => {
    const key = fallbackValue(value);
    bucket[key] = (bucket[key] || 0) + 1;
    return key;
  };
  const readBySelectors = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (!node) continue;
      const text = normalize(node.innerText || node.textContent);
      if (text) return text;
    }
    return "";
  };
  const readByAttributeHint = (node, hints) => {
    const attrs = node.getAttributeNames ? node.getAttributeNames() : [];
    for (const attrName of attrs) {
      const lowered = attrName.toLowerCase();
      if (!hints.some((hint) => lowered.includes(hint))) continue;
      const value = normalize(node.getAttribute(attrName));
      if (value) return value;
    }
    return "";
  };
  const getTrackRows = () => {
    const primaryTrackContainer =
      document.querySelector('#ref-list > div[id^="FSL-"]:not([id*="recommended"])') ||
      document.querySelector('.content-playlist-v2 #ref-list > div[id^="FSL-"]:not([id*="recommended"])') ||
      document.querySelector('.content-playlist-v2 [id^="FSL-"]:not([id*="recommended"])');
    if (primaryTrackContainer) {
      const primaryRows = [...primaryTrackContainer.querySelectorAll('div[id^="DI-"][id$="-TRACK"]')].filter(
        (row) => rowIsVisible(row)
      );
      if (primaryRows.length > 0) return primaryRows;
    }

    const selectors = [
      'div[id^="DI-"][id$="-TRACK"]',
      'div[data-testid="track-row"]',
      'div[data-testid*="track-row"]',
      'div[data-testid*="trackRow"]',
      'tr[data-testid*="track"]',
      '[role="row"][data-testid*="track"]',
      '[role="row"]',
    ];
    for (const selector of selectors) {
      const rows = [...document.querySelectorAll(selector)].filter((row) => {
        if (!rowIsVisible(row)) return false;
        if (row.matches(playlistRowSelector)) return false;
        const text = normalize(row.innerText || row.textContent);
        return Boolean(text);
      });
      if (rows.length > 0) return rows;
    }
    return [];
  };
  const getCells = (row) => {
    const directChildren = [...row.children].filter((node) =>
      normalize(node.innerText || node.textContent)
    );
    if (directChildren.length >= 2) return directChildren;
    const semantic = [...row.querySelectorAll('[role="gridcell"], td')].filter(
      (node) => normalize(node.innerText || node.textContent)
    );
    if (semantic.length >= 2) return semantic;
    return directChildren.length ? directChildren : [row];
  };
  const readCellByIndex = (cells, index) => {
    if (typeof index !== "number") return "";
    const cell = cells[index];
    return normalize(cell?.innerText || cell?.textContent);
  };
  const getHeaderIndexes = (rows) => {
    const firstRow = rows[0];
    if (!firstRow) return {};
    const root =
      firstRow.closest(
        '[role="grid"], table, [data-testid*="track-list"], [data-testid*="tracks-table"], [class*="track-list"], [class*="tracks-table"], main'
      ) ||
      document.querySelector('.content-playlist-v2, #ref-list') ||
      document;
    const headers = [
      ...root.querySelectorAll('.list-header, [role="columnheader"], thead th, [data-testid*="header"]'),
    ];
    const indexes = {};
    headers.forEach((header, idx) => {
      const text = normalize(header.innerText || header.textContent).toLowerCase();
      if (!text) return;
      if (indexes.genre === undefined && /genre/.test(text)) indexes.genre = idx;
      if (indexes.label === undefined && /(label|imprint)/.test(text)) indexes.label = idx;
      if (indexes.release === undefined && /(release|released|date|jahr|year)/.test(text)) indexes.release = idx;
      if (indexes.title === undefined && /(title|track|song|titel)/.test(text)) indexes.title = idx;
    });
    return indexes;
  };

  const expectedPath = payload.playlist.id ? '/playlists/' + payload.playlist.id : '';
  const routeMatches = expectedPath ? location.pathname.includes(expectedPath) : true;
  let trackRows = [];
  for (let waitRound = 0; waitRound < 24; waitRound += 1) {
    trackRows = getTrackRows();
    if (trackRows.length > 0) break;
    const emptyNode = document.querySelector(
      '[data-testid*="empty"], [class*="empty"], [aria-label*="No tracks"], [aria-label*="Keine Tracks"]'
    );
    if (emptyNode && normalize(emptyNode.innerText || emptyNode.textContent)) break;
    await sleep(220);
  }

  if (!routeMatches && trackRows.length === 0) {
    return {
      playlistId: payload.playlist.id,
      playlistName: payload.playlist.name,
      playlistTracksExpected: payload.playlist.tracks,
      analyzedTrackRows: 0,
      status: "route_not_loaded",
      genreCounts: [],
      labelCounts: [],
      yearCounts: [],
      trackRows: [],
    };
  }

  const headerIndexes = getHeaderIndexes(trackRows);
  const genreCounts = {};
  const labelCounts = {};
  const yearCounts = {};
  const analysisRows = [];

  trackRows.forEach((trackRow, index) => {
    const cells = getCells(trackRow);
    const rowText = normalize(trackRow.innerText || trackRow.textContent);
    const placeholderValues = [...trackRow.querySelectorAll('.type-placeholder')]
      .map((node) => normalize(node.innerText || node.textContent))
      .filter(Boolean);
    const trackTitle =
      readBySelectors(trackRow, [
        '.track-name',
        '[data-testid*="track-name"]',
        '[data-testid*="track-title"]',
        '[class*="track-name"]',
        '[class*="track-title"]',
        'a[href*="/track/"]',
      ]) ||
      readCellByIndex(cells, headerIndexes.title) ||
      normalize(cells[0]?.innerText || cells[0]?.textContent) ||
      ("Track " + String(index + 1));
    const genreRaw =
      readBySelectors(trackRow, [
        '.track-genre',
        '[data-testid*="genre"]',
        '[class*="genre"]',
        '[aria-label*="Genre"]',
      ]) ||
      readCellByIndex(cells, headerIndexes.genre) ||
      readByAttributeHint(trackRow, ["genre"]);
    const labelRaw =
      readBySelectors(trackRow, [
        '.track-label',
        '[data-testid*="label"]',
        '[class*="label"]',
        '[aria-label*="Label"]',
        '[data-testid*="imprint"]',
      ]) ||
      readCellByIndex(cells, headerIndexes.label) ||
      readByAttributeHint(trackRow, ["label", "imprint"]);
    let releaseRaw =
      readBySelectors(trackRow, [
        '[data-testid*="release"]',
        '[data-testid*="date"]',
        '.type-placeholder',
        '[class*="release"]',
        '[class*="date"]',
        '[aria-label*="Released"]',
        '[aria-label*="Date"]',
      ]) ||
      placeholderValues.find((value) =>
        /\b(19\d{2}|20\d{2}|21\d{2})\b/.test(value) ||
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(value)
      ) ||
      readCellByIndex(cells, headerIndexes.release) ||
      readByAttributeHint(trackRow, ["release", "date", "year", "released"]);
    if (!releaseRaw) {
      releaseRaw = rowText;
    }
    const yearRaw = extractYear(releaseRaw) || extractYear(rowText);
    const genre = incCount(genreCounts, genreRaw);
    const label = incCount(labelCounts, labelRaw);
    const year = incCount(yearCounts, yearRaw);

    analysisRows.push({
      playlistId: payload.playlist.id,
      playlistName: payload.playlist.name,
      playlistTracksExpected: payload.playlist.tracks,
      trackIndex: index + 1,
      trackTitle: fallbackValue(trackTitle),
      genre,
      label,
      year,
      release: fallbackValue(releaseRaw),
    });
  });

  return {
    playlistId: payload.playlist.id,
    playlistName: payload.playlist.name,
    playlistTracksExpected: payload.playlist.tracks,
    analyzedTrackRows: trackRows.length,
    status: "ok",
    genreCounts: toCountList(genreCounts),
    labelCounts: toCountList(labelCounts),
    yearCounts: toCountList(yearCounts),
    trackRows: analysisRows,
  };
})()`;
}

function buildScanExpression(config) {
  const payload = JSON.stringify({
    deepAnalysis: Boolean(config.deepAnalysis),
    sidebarScrollStep: toInt(config.sidebarScrollStep, DEFAULTS.sidebarScrollStep),
    deepAnalysisWaitMs: toInt(config.deepAnalysisWaitMs, DEFAULTS.deepAnalysisWaitMs),
  });

  return String.raw`(async () => {
  const cfg = ${payload};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) =>
    String(value ?? "").replace(/\s+/g, " ").trim();
  const parseTrackCount = (value) => {
    const text = normalize(value);
    if (!text) return "";
    const match = text.match(/(^|\b)(\d+)\s*(tracks?|songs?|titles?|titel)\b/i);
    if (match) return match[2];
    return /^\d+$/.test(text) ? text : "";
  };
  const normalizePlaylistImageAlt = (value) =>
    normalize(value).replace(/\s+#\d+\s*$/u, "");
  const extractYear = (value) => {
    const hit = String(value ?? "").match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
    return hit ? hit[1] : "";
  };
  const toCountList = (mapObject) =>
    Object.entries(mapObject)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));

  const playlistRowSelector = [
    'div.menu-left-container',
    'div.playlist-container',
    'div[data-testid="playlist-row"]',
    'div[data-testid*="playlist-row"]',
    '[data-testid*="playlistRow"]',
    '[data-playlist-id]',
  ].join(", ");
  const getPlaylistRows = () => {
    const dedupe = new Map();
    [...document.querySelectorAll(playlistRowSelector)].forEach((row) => {
      if (!(row instanceof Element)) return;
      const resolved = row.closest('.menu-left-container') || row;
      const hasPlaylistId = normalize(resolved.getAttribute("data-playlist-id"));
      const testId = normalize(resolved.getAttribute("data-testid")).toLowerCase();
      const className = String(resolved.className || "").toLowerCase();
      const text = normalize(resolved.innerText || resolved.textContent);
      const looksLikePlaylist =
        hasPlaylistId ||
        testId.includes("playlist") ||
        className.includes("menu-left-container") ||
        className.includes("playlist-container");
      if (!looksLikePlaylist) return;
      if (!/tracks?/i.test(text) && !hasPlaylistId) return;
      const key = resolved.id || (className + "|" + text);
      if (!dedupe.has(key)) {
        dedupe.set(key, resolved);
      }
    });
    return [...dedupe.values()];
  };
  const findScrollableAncestor = (node) => {
    let current = node;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY || "";
      if (/(auto|scroll)/i.test(overflowY) && current.scrollHeight > current.clientHeight + 20) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };
  const findPlaylistContainer = () => {
    const direct =
      document.querySelector('#my-playlists') ||
      document.querySelector('div[aria-label="Playlists"]') ||
      document.querySelector('[aria-label*="Playlist"], [data-testid*="playlists"], [class*="playlist"]');
    if (direct) {
      return findScrollableAncestor(direct) || direct;
    }

    const rows = getPlaylistRows();
    if (rows.length > 0) {
      const rowContainer = findScrollableAncestor(rows[0]);
      return rowContainer || rows[0].parentElement || document.scrollingElement || document.documentElement;
    }
    return null;
  };

  let scrollContainer = findPlaylistContainer();
  for (let i = 0; !scrollContainer && i < 20; i += 1) {
    await sleep(350);
    scrollContainer = findPlaylistContainer();
  }

  if (!scrollContainer) {
    const navCandidate = [...document.querySelectorAll('a, button, [role="button"]')].find((node) =>
      /playlist/i.test((node.innerText || node.textContent || "").trim())
    );
    if (navCandidate) {
      navCandidate.click();
      await sleep(1200);
      for (let i = 0; !scrollContainer && i < 20; i += 1) {
        await sleep(350);
        scrollContainer = findPlaylistContainer();
      }
    }
  }

  if (!scrollContainer) {
    return { error: 'Playlist-Container nicht gefunden. Bitte Beatport DJ Playlists-Ansicht öffnen.' };
  }

  const seen = new Map();
  const duplicates = [];
  const csvRows = ["Name,Tracks,ID"];
  const playlists = [];
  const seenPlaylists = new Set();
  let lastHeight = 0;
  let stagnantRounds = 0;
  const sidebarStep = cfg.sidebarScrollStep > 0 ? cfg.sidebarScrollStep : 900;

  const readPlaylistRow = (row) => {
    const rowText = normalize(row.innerText || row.textContent);
    const visibleName =
      normalize(
        row.querySelector('.playlist-title, .playlist-name, .type-medium.fz13, .type-medium.fz14')?.innerText
      ) ||
      normalize(row.querySelector('span[class*="name"]')?.innerText) ||
      normalize(row.getAttribute("data-playlist-name")) ||
      normalize(rowText.split("\n")[0]);
    const imageName = normalizePlaylistImageAlt(
      row.querySelector('img[alt]')?.getAttribute("alt")
    );
    const visibleNameBase = visibleName.replace(/[.…]+$/u, "").trim();
    const name =
      (imageName &&
      (!visibleName ||
        /[.…]{1,3}\s*$/u.test(visibleName) ||
        (visibleNameBase &&
          imageName.toLowerCase().startsWith(visibleNameBase.toLowerCase()))))
        ? imageName
        : visibleName || imageName;
    const tracks =
      parseTrackCount(row.querySelector('.playlist-menu-owner')?.innerText) ||
      parseTrackCount(row.querySelector('span[class*="tracks"]')?.innerText) ||
      parseTrackCount(row.getAttribute("data-track-count")) ||
      (() => {
        const match = rowText.match(/(^|\b)(\d+)\s*(tracks?|songs?|titles?|titel)\b/i);
        return match ? match[2] : "";
      })();
    const rawId =
      normalize(row.getAttribute("data-playlist-id")) ||
      normalize(row.querySelector('.playlist-container')?.getAttribute("data-playlist-id")) ||
      normalize(row.querySelector('.playlist-container')?.id) ||
      normalize(row.querySelector('[id^="ref-"]')?.id);
    const id = rawId.replace(/^ref-/, "");
    const key = name + "_" + tracks;
    return { id, name, tracks, key };
  };

  while (true) {
    const rows = getPlaylistRows();
    rows.forEach((row) => {
      const info = readPlaylistRow(row);
      if (!info.name || !info.tracks) return;

      const playlistIdentity = info.id || ("keyless:" + info.key);
      if (!seenPlaylists.has(playlistIdentity)) {
        seenPlaylists.add(playlistIdentity);
        playlists.push({
          id: info.id,
          name: info.name,
          tracks: info.tracks,
          key: info.key,
        });
      }

      if (seen.has(info.key)) {
        if (!row.dataset.codexDuplicateMarked) {
          row.dataset.codexDuplicateMarked = "1";
          row.dataset.codexDuplicateKey = info.key;
          row.style.outline = "3px solid #FFD400";
          row.style.outlineOffset = "-2px";
          row.style.backgroundColor = "rgba(255, 212, 0, 0.15)";
        }

        const alreadyAdded = duplicates.some(
          (entry) => entry.id === info.id && entry.key === info.key
        );
        if (!alreadyAdded) {
          duplicates.push({
            name: info.name,
            tracks: info.tracks,
            id: info.id,
            key: info.key,
          });
          const escapedName = info.name.replace(/"/g, '""');
          csvRows.push('"' + escapedName + '",' + info.tracks + "," + info.id);
        }
      } else {
        seen.set(info.key, info.id || playlistIdentity);
      }
    });

    scrollContainer.scrollTop += sidebarStep;
    await sleep(700);

    if (scrollContainer.scrollHeight === lastHeight) {
      stagnantRounds += 1;
      if (stagnantRounds >= 2) break;
    } else {
      stagnantRounds = 0;
    }
    lastHeight = scrollContainer.scrollHeight;
  }

  const csv = csvRows.join("\n");
  let link = document.getElementById("codex-beatport-csv-download");
  if (!link) {
    link = document.createElement("a");
    link.id = "codex-beatport-csv-download";
    document.body.appendChild(link);
  }

  const oldObjectUrl = link.dataset.codexObjectUrl;
  if (oldObjectUrl) URL.revokeObjectURL(oldObjectUrl);

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.dataset.codexObjectUrl = objectUrl;
  link.download = "beatport_duplicates_backup.csv";
  link.textContent = "beatport_duplicates_backup.csv herunterladen";

  Object.assign(link.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    padding: "10px 12px",
    borderRadius: "8px",
    background: "#FFD400",
    color: "#1B1B1B",
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    fontWeight: "700",
    fontSize: "12px",
    lineHeight: "1.2",
    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
    textDecoration: "none",
  });

  const deepAnalysis = [];
  const deepTrackRows = [];

  if (cfg.deepAnalysis) {
    const escapedId = (value) => {
      const raw = String(value ?? "");
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(raw);
      }
      return raw.replace(/"/g, '\\"');
    };
    const rowIsVisible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return !!(node.getClientRects().length || node.offsetHeight || node.offsetWidth);
    };
    const fallbackValue = (value) => (normalize(value) ? normalize(value) : "(unbekannt)");
    const incCount = (bucket, value) => {
      const key = fallbackValue(value);
      bucket[key] = (bucket[key] || 0) + 1;
      return key;
    };
    const readBySelectors = (root, selectors) => {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        if (!node) continue;
        const text = normalize(node.innerText || node.textContent);
        if (text) return text;
      }
      return "";
    };
    const readByAttributeHint = (node, hints) => {
      const attrs = node.getAttributeNames ? node.getAttributeNames() : [];
      for (const attrName of attrs) {
        const lowered = attrName.toLowerCase();
        if (!hints.some((hint) => lowered.includes(hint))) continue;
        const value = normalize(node.getAttribute(attrName));
        if (value) return value;
      }
      return "";
    };
    const readPlaylistRowByEntry = (entry) => {
      if (entry.id) {
        const candidate = document.querySelector(
          '[data-playlist-id="' + escapedId(entry.id) + '"]'
        );
        if (candidate) return candidate;
      }
      const rows = getPlaylistRows();
      return (
        rows.find((row) => {
          const info = readPlaylistRow(row);
          return info.name === entry.name && info.tracks === entry.tracks;
        }) || null
      );
    };
    const locatePlaylistRow = async (entry) => {
      let row = readPlaylistRowByEntry(entry);
      if (row) return row;

      scrollContainer.scrollTop = 0;
      await sleep(180);

      const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      let rounds = 0;
      while (rounds < 220) {
        row = readPlaylistRowByEntry(entry);
        if (row) return row;

        const nextTop = Math.min(scrollContainer.scrollTop + sidebarStep, maxTop);
        if (nextTop === scrollContainer.scrollTop) break;
        scrollContainer.scrollTop = nextTop;
        rounds += 1;
        await sleep(180);
      }
      return null;
    };
    const getTrackRows = () => {
      const selectors = [
        'div[data-testid="track-row"]',
        'div[data-testid*="track-row"]',
        'div[data-testid*="trackRow"]',
        'tr[data-testid*="track"]',
        '[role="row"][data-testid*="track"]',
        '[role="row"]',
      ];

      for (const selector of selectors) {
        const rows = [...document.querySelectorAll(selector)].filter((row) => {
          if (row.matches(playlistRowSelector)) return false;
          if (scrollContainer && scrollContainer.contains(row) && row.matches('[data-playlist-id], [data-testid*="playlist"]')) return false;
          if (!rowIsVisible(row)) return false;
          const text = normalize(row.innerText || row.textContent);
          if (!text) return false;
          return true;
        });
        if (rows.length > 0) return rows;
      }
      return [];
    };
    const getCells = (row) => {
      const directChildren = [...row.children].filter((node) =>
        normalize(node.innerText || node.textContent)
      );
      if (directChildren.length >= 2) return directChildren;
      const semantic = [...row.querySelectorAll('[role="gridcell"], td')].filter((node) =>
        normalize(node.innerText || node.textContent)
      );
      if (semantic.length >= 2) return semantic;
      return directChildren.length ? directChildren : [row];
    };
    const readCellByIndex = (cells, index) => {
      if (typeof index !== "number") return "";
      const cell = cells[index];
      return normalize(cell?.innerText || cell?.textContent);
    };
    const getHeaderIndexes = (rows) => {
      const firstRow = rows[0];
      if (!firstRow) return {};
      const root =
        firstRow.closest(
          '[role="grid"], table, [data-testid*="track-list"], [data-testid*="tracks-table"], [class*="track-list"], [class*="tracks-table"], main'
        ) || document;
      const headers = [...root.querySelectorAll('[role="columnheader"], thead th, [data-testid*="header"]')];
      const indexes = {};
      headers.forEach((header, idx) => {
        const text = normalize(header.innerText || header.textContent).toLowerCase();
        if (!text) return;
        if (indexes.genre === undefined && /genre/.test(text)) indexes.genre = idx;
        if (indexes.label === undefined && /(label|imprint)/.test(text)) indexes.label = idx;
        if (indexes.release === undefined && /(release|released|date|jahr|year)/.test(text)) indexes.release = idx;
        if (indexes.title === undefined && /(title|track|song|titel)/.test(text)) indexes.title = idx;
      });
      return indexes;
    };

    for (const playlist of playlists) {
      const targetRow = await locatePlaylistRow(playlist);
      if (!targetRow) {
        deepAnalysis.push({
          playlistId: playlist.id,
          playlistName: playlist.name,
          playlistTracksExpected: playlist.tracks,
          analyzedTrackRows: 0,
          status: "playlist_not_found",
          genreCounts: [],
          labelCounts: [],
          yearCounts: [],
        });
        continue;
      }

      targetRow.scrollIntoView({ block: "center" });
      targetRow.click();
      await sleep(cfg.deepAnalysisWaitMs > 0 ? cfg.deepAnalysisWaitMs : 850);

      let trackRows = [];
      for (let waitRound = 0; waitRound < 24; waitRound += 1) {
        trackRows = getTrackRows();
        if (trackRows.length > 0) break;
        const emptyNode = document.querySelector('[data-testid*="empty"], [class*="empty"], [aria-label*="No tracks"], [aria-label*="Keine Tracks"]');
        if (emptyNode && normalize(emptyNode.innerText || emptyNode.textContent)) break;
        await sleep(220);
      }

      const headerIndexes = getHeaderIndexes(trackRows);
      const genreCounts = {};
      const labelCounts = {};
      const yearCounts = {};

      trackRows.forEach((trackRow, index) => {
        const cells = getCells(trackRow);
        const rowText = normalize(trackRow.innerText || trackRow.textContent);

        const trackTitle =
          readBySelectors(trackRow, [
            '[data-testid*="track-name"]',
            '[data-testid*="track-title"]',
            '[class*="track-name"]',
            '[class*="track-title"]',
            'a[href*="/track/"]',
          ]) ||
          readCellByIndex(cells, headerIndexes.title) ||
          normalize(cells[0]?.innerText || cells[0]?.textContent) ||
          ("Track " + String(index + 1));

        const genreRaw =
          readBySelectors(trackRow, [
            '[data-testid*="genre"]',
            '[class*="genre"]',
            '[aria-label*="Genre"]',
          ]) ||
          readCellByIndex(cells, headerIndexes.genre) ||
          readByAttributeHint(trackRow, ["genre"]);

        const labelRaw =
          readBySelectors(trackRow, [
            '[data-testid*="label"]',
            '[class*="label"]',
            '[aria-label*="Label"]',
            '[data-testid*="imprint"]',
          ]) ||
          readCellByIndex(cells, headerIndexes.label) ||
          readByAttributeHint(trackRow, ["label", "imprint"]);

        let releaseRaw =
          readBySelectors(trackRow, [
            '[data-testid*="release"]',
            '[data-testid*="date"]',
            '[class*="release"]',
            '[class*="date"]',
            '[aria-label*="Released"]',
            '[aria-label*="Date"]',
          ]) ||
          readCellByIndex(cells, headerIndexes.release) ||
          readByAttributeHint(trackRow, ["release", "date", "year", "released"]);

        if (!releaseRaw) {
          releaseRaw = rowText;
        }

        const yearRaw = extractYear(releaseRaw) || extractYear(rowText);
        const genre = incCount(genreCounts, genreRaw);
        const label = incCount(labelCounts, labelRaw);
        const year = incCount(yearCounts, yearRaw);

        deepTrackRows.push({
          playlistId: playlist.id,
          playlistName: playlist.name,
          playlistTracksExpected: playlist.tracks,
          trackIndex: index + 1,
          trackTitle: fallbackValue(trackTitle),
          genre,
          label,
          year,
          release: fallbackValue(releaseRaw),
        });
      });

      deepAnalysis.push({
        playlistId: playlist.id,
        playlistName: playlist.name,
        playlistTracksExpected: playlist.tracks,
        analyzedTrackRows: trackRows.length,
        status: "ok",
        genreCounts: toCountList(genreCounts),
        labelCounts: toCountList(labelCounts),
        yearCounts: toCountList(yearCounts),
      });
    }
  }

  return {
    duplicates,
    csv,
    scannedKeys: seen.size,
    duplicateCount: duplicates.length,
    downloadLinkId: link.id,
    playlistCount: playlists.length,
    playlists,
    deepAnalysisEnabled: Boolean(cfg.deepAnalysis),
    deepAnalysis,
    deepTrackRows,
  };
})()`;
}

function buildDeleteExpression(duplicates) {
  const payload = JSON.stringify(duplicates);
  return String.raw`(async () => {
  const duplicates = ${payload};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isVisible = (node) => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(node.getClientRects().length || node.offsetWidth || node.offsetHeight);
  };

  const textOf = (node) => (node?.innerText || node?.textContent || "").trim();
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const parseTrackCount = (value) => {
    const text = normalize(value);
    if (!text) return "";
    const match = text.match(/(^|\b)(\d+)\s*(tracks?|songs?|titles?|titel)\b/i);
    if (match) return match[2];
    return /^\d+$/.test(text) ? text : "";
  };
  const normalizePlaylistImageAlt = (value) =>
    normalize(value).replace(/\s+#\d+\s*$/u, "");
  const playlistRowSelector = [
    'div[data-testid="playlist-row"]',
    'div[data-testid*="playlist-row"]',
    '[data-testid*="playlistRow"]',
    '[data-playlist-id]',
  ].join(", ");
  const getPlaylistRows = () =>
    [...document.querySelectorAll(playlistRowSelector)].filter((row) => {
      if (!(row instanceof Element)) return false;
      const hasPlaylistId = normalize(row.getAttribute("data-playlist-id"));
      const testId = normalize(row.getAttribute("data-testid")).toLowerCase();
      if (hasPlaylistId) return true;
      return testId.includes("playlist");
    });

  const findByText = (root, selector, includeRegex, excludeRegex) => {
    const all = [...root.querySelectorAll(selector)];
    for (const candidate of all) {
      if (!isVisible(candidate)) continue;
      const text = textOf(candidate);
      if (!text) continue;
      if (excludeRegex && excludeRegex.test(text)) continue;
      if (includeRegex.test(text)) return candidate;
    }
    return null;
  };

  const findPlaylistRow = (entry) => {
    if (entry.id) {
      const refId = String(entry.id).startsWith("ref-")
        ? String(entry.id)
        : "ref-" + String(entry.id);
      const byRef = document.getElementById(refId);
      if (byRef) {
        return byRef.closest('.menu-left-container') || byRef;
      }
      const escapedId = CSS.escape(String(entry.id));
      const byId = document.querySelector(
        '[data-playlist-id="' + escapedId + '"]'
      );
      if (byId) return byId.closest('.menu-left-container') || byId;
    }

    const rows = getPlaylistRows();
    return rows.find((row) => {
      const rowText = normalize(row.innerText || row.textContent);
      const rowRefId =
        row.querySelector('.playlist-container')?.id ||
        row.querySelector('[id^="ref-"]')?.id ||
        "";
      if (entry.id && rowRefId.replace(/^ref-/, "") === String(entry.id).replace(/^ref-/, "")) {
        return true;
      }
      const visibleName = normalize(
        row.querySelector('.playlist-title, .playlist-name, .type-medium.fz13, .type-medium.fz14')?.innerText ||
        row.querySelector('span[class*="name"]')?.innerText ||
          row.getAttribute("data-playlist-name") ||
          rowText.split("\n")[0]
      );
      const imageName = normalizePlaylistImageAlt(
        row.querySelector('img[alt]')?.getAttribute("alt")
      );
      const visibleNameBase = visibleName.replace(/[.…]+$/u, "").trim();
      const name =
        (imageName &&
        (!visibleName ||
          /[.…]{1,3}\s*$/u.test(visibleName) ||
          (visibleNameBase &&
            imageName.toLowerCase().startsWith(visibleNameBase.toLowerCase()))))
          ? imageName
          : visibleName || imageName;
      const tracksText =
        row.querySelector('.playlist-menu-owner')?.innerText ??
        row.querySelector('span[class*="tracks"]')?.innerText ??
        row.getAttribute("data-track-count") ??
        rowText;
      const tracks = parseTrackCount(tracksText);
      return name === entry.name && tracks === entry.tracks;
    }) || null;
  };

  const actionSelectors = [
    '.playlist-more',
    '[class*="playlist-more"]',
    'button[data-testid*="playlist"][data-testid*="action"]',
    'button[data-testid*="actions"]',
    'button[aria-label*="Action"]',
    'button[aria-label*="More"]',
    'button[aria-label*="Option"]',
    'button[aria-haspopup="menu"]',
    '[data-testid*="context-menu"]',
    'button',
  ];

  const results = [];
  for (const entry of duplicates) {
    const row = findPlaylistRow(entry);
    if (!row) {
      results.push({ ...entry, status: "playlist_row_not_found" });
      continue;
    }

    row.scrollIntoView({ block: "center" });
    row.style.outline = "3px solid #FF9800";
    row.style.outlineOffset = "-2px";
    await sleep(250);

    let actionButton = null;
    for (const selector of actionSelectors) {
      const candidate = row.querySelector(selector);
      if (!candidate) continue;
      if (selector === "button") {
        const allButtons = [...row.querySelectorAll("button")];
        actionButton = allButtons[allButtons.length - 1] ?? candidate;
      } else {
        actionButton = candidate;
      }
      if (actionButton) break;
    }

    if (!actionButton || !isVisible(actionButton)) {
      results.push({ ...entry, status: "action_menu_button_not_found" });
      continue;
    }

    actionButton.click();
    await sleep(350);

    const menuRoot =
      [...document.querySelectorAll('[role="menu"], [data-testid*="menu"], [class*="menu"]')]
        .filter((node) => isVisible(node))
        .at(-1) || document;

    const deleteMenuItem = findByText(
      menuRoot,
      '[role="menuitem"], [role="button"], button, li, div',
      /(delete|l[oö]schen|entfernen|remove)/i,
      /(cancel|abbrechen|schlie[ßs]en|close)/i
    );

    if (!deleteMenuItem) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      results.push({ ...entry, status: "delete_menu_item_not_found" });
      continue;
    }

    deleteMenuItem.click();
    await sleep(500);

    const dialog =
      [...document.querySelectorAll('[role="dialog"], [data-testid*="modal"], [class*="modal"]')]
        .filter((node) => isVisible(node))
        .at(-1) || document;

    const confirmButton = findByText(
      dialog,
      'button, [role="button"]',
      /(delete|l[oö]schen|entfernen|confirm|best[aä]tigen|remove)/i,
      /(cancel|abbrechen|keep|behalten)/i
    );

    if (!confirmButton) {
      results.push({ ...entry, status: "delete_confirm_button_not_found" });
      continue;
    }

    confirmButton.click();
    await sleep(900);

    const stillExists = findPlaylistRow(entry);
    results.push({
      ...entry,
      status: stillExists ? "delete_not_confirmed" : "deleted",
    });
  }

  return { total: duplicates.length, results };
})()`;
}

function tableFromRows(rows) {
  if (!rows || rows.length === 0) {
    return "Keine Einträge.";
  }

  const columns = Object.keys(rows[0]);
  const widths = {};
  for (const column of columns) {
    widths[column] = column.length;
  }
  for (const row of rows) {
    for (const column of columns) {
      widths[column] = Math.max(widths[column], String(row[column] ?? "").length);
    }
  }

  const formatRow = (row) =>
    `| ${columns
      .map((column) => String(row[column] ?? "").padEnd(widths[column], " "))
      .join(" | ")} |`;

  const header = formatRow(
    columns.reduce((acc, column) => ({ ...acc, [column]: column }), {})
  );
  const separator = `| ${columns
    .map((column) => "-".repeat(widths[column]))
    .join(" | ")} |`;

  return [header, separator, ...rows.map(formatRow)].join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  return lines.join("\n");
}

function countListToString(list, maxItems = 6) {
  if (!Array.isArray(list) || list.length === 0) {
    return "";
  }
  return list
    .slice(0, maxItems)
    .map((entry) => `${entry.value}:${entry.count}`)
    .join(" | ");
}

const TRACK_CSV_HEADERS = [
  "playlistId",
  "playlistName",
  "playlistTracksExpected",
  "trackIndex",
  "trackId",
  "trackTitle",
  "artists",
  "genre",
  "label",
  "year",
  "release",
  "releaseDate",
  "releaseYear",
  "bpm",
  "key",
  "mixName",
  "source",
];

const SUMMARY_CSV_HEADERS = [
  "playlistId",
  "playlistName",
  "playlistTracksExpected",
  "analyzedTrackRows",
  "status",
  "analysisMethod",
  "source",
  "trackFingerprint",
  "dimension",
  "value",
  "count",
];

function createSummaryRowsForPlaylist(playlist) {
  const dimensions = [
    ["Genre", playlist.genreCounts],
    ["Label", playlist.labelCounts],
    ["Jahr", playlist.yearCounts],
  ];
  const rows = [];

  for (const [dimension, list] of dimensions) {
    if (!Array.isArray(list) || list.length === 0) {
      rows.push({
        playlistId: playlist.playlistId ?? "",
        playlistName: playlist.playlistName ?? "",
        playlistTracksExpected: playlist.playlistTracksExpected ?? "",
        analyzedTrackRows: playlist.analyzedTrackRows ?? "",
        status: playlist.status ?? "",
        analysisMethod: playlist.analysisMethod ?? "",
        source: playlist.source ?? playlist.analysisMethod ?? "",
        trackFingerprint: playlist.trackFingerprint ?? "",
        dimension,
        value: "(unbekannt)",
        count: 0,
      });
      continue;
    }

    for (const entry of list) {
      rows.push({
        playlistId: playlist.playlistId ?? "",
        playlistName: playlist.playlistName ?? "",
        playlistTracksExpected: playlist.playlistTracksExpected ?? "",
        analyzedTrackRows: playlist.analyzedTrackRows ?? "",
        status: playlist.status ?? "",
        analysisMethod: playlist.analysisMethod ?? "",
        source: playlist.source ?? playlist.analysisMethod ?? "",
        trackFingerprint: playlist.trackFingerprint ?? "",
        dimension,
        value: entry.value ?? "(unbekannt)",
        count: entry.count ?? 0,
      });
    }
  }

  return rows;
}

async function overwriteMirroredJsonLines(archivePath, exportPath, rows) {
  const body = (Array.isArray(rows) ? rows : [])
    .map((row) => JSON.stringify(row))
    .join("\n");
  const content = body ? `${body}\n` : "";
  await writeMirroredFile(archivePath, exportPath, content);
}

async function ensureDerivedRunArtifacts(run, runPaths, playlists, trackRows) {
  const playlistRows = Array.isArray(playlists) ? playlists : [];
  const duplicateRows = Array.isArray(run.duplicates) ? run.duplicates : [];
  const analysisRows = Array.isArray(trackRows) ? trackRows : [];
  const playlistSummaries = Array.isArray(run.playlistSummaries)
    ? run.playlistSummaries
    : [];
  const summaryRows = playlistSummaries.flatMap((entry) =>
    createSummaryRowsForPlaylist(entry)
  );

  await overwriteMirroredJsonLines(
    runPaths.files.playlistsPath,
    runPaths.exportFiles.playlistsPath,
    playlistRows.map((entry) => ({
      ...toPlaylistRef(entry),
      discoveredAt:
        normalizeLooseText(entry.discoveredAt) || run.startedAt || toIsoNow(),
      serverSeenAt:
        normalizeLooseText(entry.serverSeenAt) ||
        normalizeLooseText(entry.discoveredAt) ||
        run.startedAt ||
        toIsoNow(),
    }))
  );
  await overwriteMirroredJsonLines(
    runPaths.files.duplicatesPath,
    runPaths.exportFiles.duplicatesPath,
    duplicateRows.map((entry) => ({
      ...toPlaylistRef(entry),
      discoveredAt:
        normalizeLooseText(entry.discoveredAt) || run.startedAt || toIsoNow(),
      duplicateStatus: normalizeLooseText(entry.duplicateStatus) || "candidate",
      source: normalizeLooseText(entry.source),
      trackFingerprint: normalizeLooseText(entry.trackFingerprint),
    }))
  );
  await overwriteMirroredJsonLines(
    runPaths.files.trackAnalysisPath,
    runPaths.exportFiles.trackAnalysisPath,
    analysisRows.map((entry) => normalizeTrackRow(entry))
  );

  const duplicateCsv = duplicateRows.length
    ? buildDuplicateCsvRows(duplicateRows)
    : "Name,Tracks,ID,Status,Quelle,Fingerprint\n";
  await writeMirroredFile(
    runPaths.files.csvPath,
    runPaths.exportFiles.csvPath,
    duplicateCsv
  );

  const trackCsv = analysisRows.length
    ? rowsToCsv(
        TRACK_CSV_HEADERS,
        analysisRows.map((entry) => normalizeTrackRow(entry))
      )
    : `${TRACK_CSV_HEADERS.join(",")}\n`;
  await writeMirroredFile(
    runPaths.files.analysisTrackCsvPath,
    runPaths.exportFiles.analysisTrackCsvPath,
    trackCsv
  );

  const summaryCsv = summaryRows.length
    ? rowsToCsv(SUMMARY_CSV_HEADERS, summaryRows)
    : `${SUMMARY_CSV_HEADERS.join(",")}\n`;
  await writeMirroredFile(
    runPaths.files.analysisSummaryCsvPath,
    runPaths.exportFiles.analysisSummaryCsvPath,
    summaryCsv
  );

  await writeMirroredFile(
    runPaths.files.analysisJsonPath,
    runPaths.exportFiles.analysisJsonPath,
    JSON.stringify(
      {
        generatedAt: toIsoNow(),
        target: run.target || {},
        playlistCount: playlistRows.length,
        analyzedPlaylistCount: playlistSummaries.length,
        analyzedTrackRows: analysisRows.length,
        playlists: playlistSummaries,
      },
      null,
      2
    )
  );
}

/**
 * Verwaltet die on-disk Repräsentation eines Scanner-Laufs.
 * Jeder Statuswechsel wird sofort in Archiv und Export-Spiegel persistiert.
 */
class RunStore {
  constructor(config, runPaths) {
    this.config = config;
    this.runPaths = runPaths;
    this.run = {
      schemaVersion: RUN_SCHEMA_VERSION,
      runId: runPaths.runId,
      status: "running",
      phase: "discovery",
      startedAt: toIsoNow(),
      finishedAt: "",
      app: {
        appPath: config.scannerAppPath,
        beatportAppPath: config.appPath,
        execPath: config.execPath,
        version: config.appVersion,
        buildId: config.appBuildId,
        canonicalAppPath: config.canonicalAppPath,
        userDataPath: config.userDataPath,
      },
      config: sanitizeConfigForPersistence(config),
      target: {
        id: "",
        title: "",
        url: "",
      },
      counts: {
        playlistsDiscovered: 0,
        selectedPlaylists: 0,
        duplicates: 0,
        analyzedPlaylists: 0,
        analyzedTrackRows: 0,
      },
      selection: {
        selectedPlaylists: [],
        updatedAt: "",
        source: "default_all",
      },
      analysisPlan: {
        method: config.analysisMethod || DEFAULTS.analysisMethod,
        selectedPlaylists: [],
        completedPlaylistRefs: [],
        currentPlaylistRef: null,
        totalSelected: 0,
        updatedAt: "",
      },
      networkHints: {
        preferredMethod: config.analysisMethod || DEFAULTS.analysisMethod,
        directRouteEnabled: true,
      },
      files: {
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
      },
      duplicates: [],
      playlistSummaries: [],
      lastDeleteRun: null,
      origin: createDefaultOrigin("native"),
      migration: null,
    };
    this.playlists = [];
    this.deepTrackRows = [];
    this.summaryRows = [];
  }

  async initialize() {
    await ensureRunDirectories(this.runPaths);
    await writeMirroredFile(
      this.runPaths.files.csvPath,
      this.runPaths.exportFiles.csvPath,
      "Name,Tracks,ID\n"
    );
    await writeMirroredFile(
      this.runPaths.files.analysisTrackCsvPath,
      this.runPaths.exportFiles.analysisTrackCsvPath,
      `${TRACK_CSV_HEADERS.join(",")}\n`
    );
    await writeMirroredFile(
      this.runPaths.files.analysisSummaryCsvPath,
      this.runPaths.exportFiles.analysisSummaryCsvPath,
      `${SUMMARY_CSV_HEADERS.join(",")}\n`
    );
    await writeMirroredFile(
      this.runPaths.files.analysisJsonPath,
      this.runPaths.exportFiles.analysisJsonPath,
      JSON.stringify(
        {
          generatedAt: this.run.startedAt,
          playlistCount: 0,
          analyzedPlaylistCount: 0,
          analyzedTrackRows: 0,
          playlists: [],
        },
        null,
        2
      )
    );
    await writeMirroredFile(
      this.runPaths.files.playlistsPath,
      this.runPaths.exportFiles.playlistsPath,
      ""
    );
    await writeMirroredFile(
      this.runPaths.files.duplicatesPath,
      this.runPaths.exportFiles.duplicatesPath,
      ""
    );
    await writeMirroredFile(
      this.runPaths.files.trackAnalysisPath,
      this.runPaths.exportFiles.trackAnalysisPath,
      ""
    );
    await writeMirroredFile(
      this.runPaths.files.eventsPath,
      this.runPaths.exportFiles.eventsPath,
      ""
    );
    await this.updateSnapshots();
    await this.appendEvent("run_started", {
      archiveDir: this.runPaths.archiveDir,
      exportDir: this.runPaths.exportDir,
      phase: this.run.phase,
    });
  }

  hydrateFromExisting(manifest, playlists = [], trackRows = []) {
    const normalized = normalizeRunManifest(manifest, this.runPaths, {
      playlistsCount: playlists.length,
      analyzedTrackRows: trackRows.length,
    });
    this.run = {
      ...this.run,
      ...normalized,
    };
    this.playlists = Array.isArray(playlists)
      ? playlists.map((entry) => toPlaylistRef(entry))
      : [];
    this.deepTrackRows = Array.isArray(trackRows)
      ? trackRows.map((entry) => normalizeTrackRow(entry))
      : [];
    this.run.playlistSummaries = Array.isArray(this.run.playlistSummaries)
      ? this.run.playlistSummaries.map((entry) => normalizePlaylistSummary(entry))
      : [];
    this.summaryRows = this.run.playlistSummaries.flatMap((entry) =>
      createSummaryRowsForPlaylist(entry)
    );
    this.run.counts.playlistsDiscovered =
      this.run.counts.playlistsDiscovered || this.playlists.length;
    this.run.counts.analyzedPlaylists =
      this.run.counts.analyzedPlaylists || this.run.playlistSummaries.length;
    this.run.counts.analyzedTrackRows =
      this.run.counts.analyzedTrackRows || this.deepTrackRows.length;
  }

  setTarget(target) {
    this.run.target = {
      id: sanitizeSensitiveText(target?.id ?? ""),
      title: sanitizeSensitiveText(target?.title ?? ""),
      url: sanitizeSensitiveText(target?.url ?? ""),
    };
  }

  async setNetworkHints(payload = {}) {
    this.run.networkHints = {
      ...this.run.networkHints,
      ...sanitizeSensitiveValue(payload),
    };
    await this.updateSnapshots();
  }

  async appendEvent(type, payload = {}) {
    await appendMirroredJsonLine(
      this.runPaths.files.eventsPath,
      this.runPaths.exportFiles.eventsPath,
      {
        at: toIsoNow(),
        type,
        payload: sanitizeSensitiveValue(payload),
      }
    );
  }

  async addPlaylists(playlists, meta = {}) {
    if (!Array.isArray(playlists) || playlists.length === 0) {
      return;
    }
    const byIdentity = new Map(
      this.playlists.map((entry) => [getPlaylistIdentity(entry), toPlaylistRef(entry)])
    );
    let added = 0;
    let updated = 0;
    for (const playlist of playlists) {
      const normalized = toPlaylistRef(playlist);
      const identity = getPlaylistIdentity(normalized);
      if (!identity) continue;
      const existing = byIdentity.get(identity);
      const merged = {
        ...(existing || {}),
        ...normalized,
        discoveredAt:
          normalizeLooseText(existing?.discoveredAt) ||
          normalizeLooseText(normalized.discoveredAt) ||
          toIsoNow(),
        serverSeenAt:
          normalizeLooseText(normalized.serverSeenAt) ||
          normalizeLooseText(existing?.serverSeenAt) ||
          toIsoNow(),
      };
      if (existing) {
        updated += 1;
      } else {
        added += 1;
      }
      byIdentity.set(identity, merged);
    }
    this.playlists = [...byIdentity.values()];
    this.run.counts.playlistsDiscovered = this.playlists.length;
    await overwriteMirroredJsonLines(
      this.runPaths.files.playlistsPath,
      this.runPaths.exportFiles.playlistsPath,
      this.playlists
    );
    await this.appendEvent("playlists_discovered", {
      added,
      updated,
      total: this.playlists.length,
      ...meta,
    });
    await this.updateSnapshots();
  }

  async setSelection(selectedPlaylists, source = "manual") {
    const normalized = Array.isArray(selectedPlaylists)
      ? selectedPlaylists.map((entry) => toPlaylistRef(entry))
      : [];
    this.run.selection = {
      selectedPlaylists: normalized,
      updatedAt: toIsoNow(),
      source,
    };
    this.run.analysisPlan = {
      ...this.run.analysisPlan,
      selectedPlaylists: normalized,
      totalSelected: normalized.length,
      updatedAt: toIsoNow(),
    };
    this.run.counts.selectedPlaylists = normalized.length;
    await this.appendEvent("selection_updated", {
      selected: normalized.length,
      source,
    });
    await this.updateSnapshots();
  }

  async addDuplicates(duplicates, meta = {}) {
    if (!Array.isArray(duplicates) || duplicates.length === 0) {
      return;
    }
    await this.replaceDuplicates(
      [...(this.run.duplicates || []), ...duplicates],
      meta
    );
  }

  async replaceDuplicates(duplicates, meta = {}) {
    this.run.duplicates = Array.isArray(duplicates)
      ? duplicates.map((entry) => toPlaylistRef(entry))
      : [];
    this.run.counts.duplicates = this.run.duplicates.length;
    await overwriteMirroredJsonLines(
      this.runPaths.files.duplicatesPath,
      this.runPaths.exportFiles.duplicatesPath,
      this.run.duplicates.map((entry) => ({
        ...entry,
        discoveredAt: normalizeLooseText(entry.discoveredAt) || toIsoNow(),
      }))
    );
    await writeMirroredFile(
      this.runPaths.files.csvPath,
      this.runPaths.exportFiles.csvPath,
      this.run.duplicates.length
        ? buildDuplicateCsvRows(this.run.duplicates)
        : "Name,Tracks,ID,Status,Quelle,Fingerprint\n"
    );
    await this.appendEvent("duplicates_found", {
      added: Array.isArray(duplicates) ? duplicates.length : 0,
      total: this.run.duplicates.length,
      ...meta,
    });
    await this.updateSnapshots();
  }

  async importBaseline(sourceRun, playlists = [], duplicates = []) {
    const normalizedPlaylists = Array.isArray(playlists)
      ? playlists.map((entry) => toPlaylistRef(entry)).filter((entry) => entry.name || entry.id)
      : [];
    const normalizedDuplicates = Array.isArray(duplicates)
      ? duplicates.map((entry) => toPlaylistRef(entry)).filter((entry) => entry.name || entry.id)
      : [];
    const importedAt = toIsoNow();

    const uniquePlaylists = [];
    const seenPlaylistIdentities = new Set(
      this.playlists.map((entry) => getPlaylistIdentity(entry))
    );
    for (const playlist of normalizedPlaylists) {
      const identity = getPlaylistIdentity(playlist);
      if (!identity || seenPlaylistIdentities.has(identity)) continue;
      seenPlaylistIdentities.add(identity);
      uniquePlaylists.push(playlist);
    }

    const uniqueDuplicates = [];
    const seenDuplicateIdentities = new Set(
      (this.run.duplicates || []).map((entry) => getPlaylistIdentity(entry))
    );
    for (const duplicate of normalizedDuplicates) {
      const identity = getPlaylistIdentity(duplicate);
      if (!identity || seenDuplicateIdentities.has(identity)) continue;
      seenDuplicateIdentities.add(identity);
      uniqueDuplicates.push(duplicate);
    }

    if (uniquePlaylists.length > 0) {
      await this.addPlaylists(uniquePlaylists, {
        importedAt,
        importedFromRunId: sourceRun?.runId || "",
        source: "delta_seed",
      });
    }
    if (uniqueDuplicates.length > 0) {
      await this.addDuplicates(uniqueDuplicates, {
        importedAt,
        importedFromRunId: sourceRun?.runId || "",
        source: "delta_seed",
      });
    }

    this.run.networkHints = {
      ...this.run.networkHints,
      deltaSeedRunId: normalizeLooseText(sourceRun?.runId),
      deltaSeedStartedAt: normalizeLooseText(sourceRun?.startedAt),
    };
    await this.appendEvent("baseline_imported", {
      sourceRunId: sourceRun?.runId || "",
      sourceStatus: sourceRun?.status || "",
      importedPlaylists: uniquePlaylists.length,
      importedDuplicates: uniqueDuplicates.length,
    });
    await this.updateSnapshots();
  }

  async addPlaylistAnalysis(summary, trackRows) {
    const normalizedSummary = normalizePlaylistSummary({
      ...summary,
      trackRows,
    });
    const normalizedTrackRows = (Array.isArray(trackRows) ? trackRows : []).map((entry) =>
      normalizeTrackRow(entry)
    );
    this.run.playlistSummaries.push(normalizedSummary);
    this.deepTrackRows.push(...normalizedTrackRows);
    this.summaryRows.push(...createSummaryRowsForPlaylist(normalizedSummary));
    this.run.counts.analyzedPlaylists = this.run.playlistSummaries.length;
    this.run.counts.analyzedTrackRows = this.deepTrackRows.length;

    for (const trackRow of normalizedTrackRows) {
      await appendMirroredJsonLine(
        this.runPaths.files.trackAnalysisPath,
        this.runPaths.exportFiles.trackAnalysisPath,
        trackRow
      );
    }

    if (trackRows.length > 0) {
      const trackCsv =
        this.deepTrackRows.length > 0
          ? rowsToCsv(TRACK_CSV_HEADERS, this.deepTrackRows)
          : `${TRACK_CSV_HEADERS.join(",")}\n`;
      await writeMirroredFile(
        this.runPaths.files.analysisTrackCsvPath,
        this.runPaths.exportFiles.analysisTrackCsvPath,
        trackCsv
      );
    }

    const summaryCsv =
      this.summaryRows.length > 0
        ? rowsToCsv(SUMMARY_CSV_HEADERS, this.summaryRows)
        : `${SUMMARY_CSV_HEADERS.join(",")}\n`;
    await writeMirroredFile(
      this.runPaths.files.analysisSummaryCsvPath,
      this.runPaths.exportFiles.analysisSummaryCsvPath,
      summaryCsv
    );

    await writeMirroredFile(
      this.runPaths.files.analysisJsonPath,
      this.runPaths.exportFiles.analysisJsonPath,
      JSON.stringify(
        {
          generatedAt: toIsoNow(),
          target: this.run.target,
          playlistCount: this.playlists.length,
          analyzedPlaylistCount: this.run.playlistSummaries.length,
          analyzedTrackRows: this.deepTrackRows.length,
          playlists: this.run.playlistSummaries,
        },
        null,
        2
      )
    );

    await this.appendEvent("playlist_analyzed", {
      playlistId: normalizedSummary.playlistId ?? "",
      playlistName: normalizedSummary.playlistName ?? "",
      analyzedTrackRows: normalizedSummary.analyzedTrackRows ?? 0,
      status: normalizedSummary.status ?? "",
      trackFingerprint: normalizedSummary.trackFingerprint ?? "",
    });
    await this.replaceDuplicates(
      buildDuplicateEntries(this.playlists, this.run.playlistSummaries),
      {
        source: normalizedSummary.analysisMethod || normalizedSummary.source,
        playlistId: normalizedSummary.playlistId,
        playlistName: normalizedSummary.playlistName,
      }
    );
    await this.updateSnapshots();
  }

  async markDiscoveryComplete(selectedPlaylists = this.playlists) {
    await this.setSelection(selectedPlaylists, "default_all");
    this.run.status = "ready_for_analysis";
    this.run.phase = "ready_for_analysis";
    this.run.finishedAt = "";
    await this.appendEvent("discovery_completed", {
      playlistsDiscovered: this.run.counts.playlistsDiscovered,
      duplicates: this.run.counts.duplicates,
      selectedPlaylists: this.run.counts.selectedPlaylists,
    });
    await this.updateSnapshots();
  }

  async beginAnalysis(selectedPlaylists, method, mode = "start") {
    const normalized = Array.isArray(selectedPlaylists)
      ? selectedPlaylists.map((entry) => toPlaylistRef(entry))
      : [];
    this.run.config = {
      ...this.run.config,
      deepAnalysis: true,
      analysisMethod:
        method || this.run.analysisPlan.method || DEFAULTS.analysisMethod,
    };
    this.run.status = "running";
    this.run.phase = "analysis";
    this.run.analysisPlan = {
      ...this.run.analysisPlan,
      method: method || this.run.analysisPlan.method || DEFAULTS.analysisMethod,
      selectedPlaylists: normalized,
      totalSelected: normalized.length,
      currentPlaylistRef: null,
      updatedAt: toIsoNow(),
    };
    this.run.selection = {
      selectedPlaylists: normalized,
      updatedAt: toIsoNow(),
      source: mode === "resume" ? "resume" : "manual",
    };
    this.run.counts.selectedPlaylists = normalized.length;
    await this.appendEvent(mode === "resume" ? "analysis_resumed" : "analysis_started", {
      selectedPlaylists: normalized.length,
      method: this.run.analysisPlan.method,
    });
    await this.updateSnapshots();
  }

  async setCurrentPlaylist(entry, index, total) {
    const ref = toPlaylistRef(entry);
    this.run.analysisPlan = {
      ...this.run.analysisPlan,
      currentPlaylistRef: ref,
      totalSelected: total,
      updatedAt: toIsoNow(),
    };
    await this.appendEvent("analysis_target", {
      playlistId: ref.id,
      playlistName: ref.name,
      playlistIndex: index,
      totalSelected: total,
    });
    await this.updateSnapshots();
  }

  async markPlaylistCompleted(entry, method) {
    const ref = toPlaylistRef(entry);
    const existing = Array.isArray(this.run.analysisPlan.completedPlaylistRefs)
      ? this.run.analysisPlan.completedPlaylistRefs
      : [];
    const identity = getPlaylistIdentity(ref);
    if (!existing.some((item) => getPlaylistIdentity(item) === identity)) {
      existing.push(ref);
    }
    this.run.analysisPlan = {
      ...this.run.analysisPlan,
      completedPlaylistRefs: existing,
      currentPlaylistRef: null,
      updatedAt: toIsoNow(),
    };
    await this.appendEvent("analysis_target_completed", {
      playlistId: ref.id,
      playlistName: ref.name,
      method,
      completed: existing.length,
      totalSelected: this.run.analysisPlan.totalSelected || 0,
    });
    await this.updateSnapshots();
  }

  async markPaused(reason = "pause_requested") {
    this.run.status = "paused";
    this.run.phase = "paused";
    this.run.finishedAt = "";
    this.run.analysisPlan = {
      ...this.run.analysisPlan,
      currentPlaylistRef: null,
      updatedAt: toIsoNow(),
    };
    await this.appendEvent("analysis_paused", { reason });
    await this.updateSnapshots();
  }

  async updateSnapshots() {
    const payload = {
      schemaVersion: this.run.schemaVersion,
      runId: this.run.runId,
      status: this.run.status,
      phase: this.run.phase,
      startedAt: this.run.startedAt,
      finishedAt: this.run.finishedAt,
      app: this.run.app,
      config: this.run.config,
      target: this.run.target,
      counts: this.run.counts,
      selection: this.run.selection,
      analysisPlan: this.run.analysisPlan,
      networkHints: this.run.networkHints,
      files: this.run.files,
      duplicates: this.run.duplicates,
      playlistSummaries: this.run.playlistSummaries,
      lastDeleteRun: this.run.lastDeleteRun,
      origin: this.run.origin,
      migration: this.run.migration,
    };

    await writeMirroredFile(
      this.runPaths.files.summaryPath,
      this.runPaths.exportFiles.summaryPath,
      JSON.stringify(payload, null, 2)
    );
    await writeMirroredFile(
      this.runPaths.files.manifestPath,
      this.runPaths.exportFiles.manifestPath,
      JSON.stringify(
        {
          ...payload,
          playlistsDiscovered: this.playlists.length,
        },
        null,
        2
      )
    );
    await writeMirroredFile(
      this.runPaths.files.statePath,
      this.runPaths.exportFiles.statePath,
      JSON.stringify(
        {
          generatedAt: toIsoNow(),
          runId: this.run.runId,
          status: this.run.status,
          phase: this.run.phase,
          target: this.run.target,
          playlistCount: this.playlists.length,
          duplicateCount: this.run.duplicates.length,
          duplicates: this.run.duplicates,
          selection: this.run.selection,
          analysisPlan: this.run.analysisPlan,
          networkHints: this.run.networkHints,
          csvFile: this.run.files.csvPath,
          deepAnalysisEnabled: Boolean(this.config.deepAnalysis),
          deepAnalysis: {
            analyzedPlaylists: this.run.playlistSummaries.length,
            analyzedTrackRows: this.deepTrackRows.length,
            analysisJsonFile: this.run.files.analysisJsonPath,
            analysisTrackCsvFile: this.run.files.analysisTrackCsvPath,
            analysisSummaryCsvFile: this.run.files.analysisSummaryCsvPath,
          },
          playlistSummaries: this.run.playlistSummaries,
          files: this.run.files,
          lastDeleteRun: this.run.lastDeleteRun,
          schemaVersion: this.run.schemaVersion,
          origin: this.run.origin,
          migration: this.run.migration,
        },
        null,
        2
      )
    );
  }

  async finalize() {
    this.run.status = "completed";
    this.run.phase = "completed";
    this.run.finishedAt = toIsoNow();
    this.run.analysisPlan = {
      ...this.run.analysisPlan,
      currentPlaylistRef: null,
      updatedAt: toIsoNow(),
    };
    await this.appendEvent("run_completed", {
      duplicates: this.run.counts.duplicates,
      analyzedPlaylists: this.run.counts.analyzedPlaylists,
      analyzedTrackRows: this.run.counts.analyzedTrackRows,
    });
    await this.updateSnapshots();
  }

  async markIncomplete(error) {
    this.run.status = "incomplete";
    this.run.phase = "incomplete";
    this.run.finishedAt = toIsoNow();
    await this.appendEvent("run_incomplete", {
      message: sanitizeSensitiveText(
        String(error?.message ?? error ?? "Unbekannter Fehler")
      ),
    });
    await this.updateSnapshots();
  }

  async recordDeleteRun(requested, deleted, rows) {
    this.run.lastDeleteRun = {
      ranAt: toIsoNow(),
      requested,
      deleted,
      resultRows: rows,
    };
    await this.appendEvent("delete_completed", {
      requested,
      deleted,
    });
    await this.updateSnapshots();
  }
}

/**
 * Liest alle gespeicherten Runs aus dem Archiv und normalisiert sie auf Schema v2.
 */
async function listStoredRuns(config = {}) {
  const cfg = resolveConfig(config);
  const { archiveRootDir } = resolveStorageRoots(cfg);
  await fs.mkdir(archiveRootDir, { recursive: true });
  const entries = await fs.readdir(archiveRootDir, { withFileTypes: true });
  const runs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const artifacts = await readRunArtifacts(cfg, entry.name);
      runs.push(artifacts.run);
    } catch {
      continue;
    }
  }

  runs.sort((a, b) =>
    String(b.startedAt || "").localeCompare(String(a.startedAt || ""))
  );

  return {
    runs,
    preferredRun: pickPreferredCompatibleRun(runs),
    lastSuccessfulRun:
      runs.find((run) => String(run.status).toLowerCase() === "completed") ||
      null,
    lastPausedRun:
      runs.find((run) => String(run.status).toLowerCase() === "paused") || null,
    lastReadyRun:
      runs.find(
        (run) => String(run.status).toLowerCase() === "ready_for_analysis"
      ) || null,
    lastLegacyRun:
      runs.find((run) => run.origin?.kind === "legacy-source") || null,
    lastMigratedRun:
      runs.find((run) => run.origin?.kind === "legacy-migrated") || null,
    lastIncompleteRun:
      runs.find((run) => String(run.status).toLowerCase() === "incomplete") ||
      null,
  };
}

/**
 * Liefert nur die Legacy-Quellen aus dem Run-Archiv.
 */
async function listLegacyRuns(config = {}) {
  const listing = await listStoredRuns(config);
  const legacyRuns = listing.runs.filter(
    (run) => run.origin?.kind === "legacy-source"
  );
  return {
    runs: legacyRuns,
    total: legacyRuns.length,
  };
}

async function rebuildCacheFromRuns(config = {}, query = {}) {
  const cfg = resolveConfig(config);
  const cacheStore = await createCacheStore(cfg);
  if (!cacheStore) {
    throw new Error("Cache ist deaktiviert.");
  }
  await cacheStore.clearAll();

  const listing = await listStoredRuns(cfg);
  const compatibleRuns = listing.runs
    .filter(
      (run) =>
        Number(run.counts?.playlistsDiscovered || 0) > 0 ||
        Number(run.counts?.analyzedPlaylists || 0) > 0
    )
    .sort((a, b) =>
      String(a.startedAt || "").localeCompare(String(b.startedAt || ""))
    );

  for (const run of compatibleRuns) {
    const artifacts = await readRunArtifacts(cfg, run.runId);
    const summaryMap = new Map(
      (artifacts.run.playlistSummaries || []).map((entry) => [
        getPlaylistIdentity(entry),
        normalizePlaylistSummary(entry),
      ])
    );
    const groupedTracks = new Map();
    for (const trackRow of artifacts.trackRows.map((entry) => normalizeTrackRow(entry))) {
      const identity = getPlaylistIdentity(trackRow);
      if (!identity) continue;
      const bucket = groupedTracks.get(identity) || [];
      bucket.push(trackRow);
      groupedTracks.set(identity, bucket);
    }

    const playlistRows = artifacts.playlists.map((entry) => {
      const identity = getPlaylistIdentity(entry);
      const summary = summaryMap.get(identity);
      return {
        ...toPlaylistRef(entry),
        syncState: summary ? "current" : "needs_analysis",
        dirty: summary ? 0 : 1,
        lastRunId: run.runId,
        source: summary?.source || entry.source || entry.analysisMethod || "run-import",
        trackFingerprint: summary?.trackFingerprint || entry.trackFingerprint || "",
        lastDeepAnalyzedAt: summary ? run.finishedAt || run.startedAt || toIsoNow() : "",
      };
    });
    await cacheStore.upsertPlaylists(playlistRows, {
      source: "run-import",
      lastRunId: run.runId,
    });

    for (const summary of summaryMap.values()) {
      const identity = getPlaylistIdentity(summary);
      const tracks = groupedTracks.get(identity) || [];
      await cacheStore.replacePlaylistAnalysis(summary, tracks, {
        lastRunId: run.runId,
        syncState: "current",
      });
    }
  }

  const snapshot = await getCacheSnapshot(cfg);
  if (snapshot.cacheStore) {
    await snapshot.cacheStore.applyDuplicateEntries(snapshot.duplicates);
    await snapshot.cacheStore.setSyncState("last_rebuild_at", toIsoNow());
    await snapshot.cacheStore.setSyncState(
      "last_rebuild_run_count",
      String(compatibleRuns.length)
    );
    if (listing.preferredRun?.runId) {
      await snapshot.cacheStore.setSyncState(
        "preferred_source_run_id",
        listing.preferredRun.runId
      );
    }
  }
  return {
    rebuiltFromRuns: compatibleRuns.length,
    preferredRunId: listing.preferredRun?.runId || "",
    status: snapshot.status || (await cacheStore.getStatus()),
  };
}

async function getCacheStatus(config = {}) {
  const cfg = resolveConfig(config);
  const status = await ensureCacheWarm(cfg);
  return status || {
    dbPath: resolveCacheDbPath(cfg),
    exists: false,
    counts: {
      playlists: 0,
      tracks: 0,
      duplicateCandidates: 0,
      duplicateConfirmed: 0,
      dirtyPlaylists: 0,
      analyzedPlaylists: 0,
    },
    syncState: [],
    exports: [],
  };
}

async function readCachedPlaylists(config = {}) {
  const cfg = resolveConfig(config);
  await ensureCacheWarm(cfg);
  const cacheStore = await createCacheStore(cfg);
  if (!cacheStore) {
    return {
      total: 0,
      playlists: [],
      status: null,
    };
  }
  const rows = await cacheStore.listPlaylists();
  return {
    total: rows.length,
    playlists: rows.map((entry) => ({
      identity: entry.identity,
      cacheKey: entry.cacheKey || entry.identity,
      id: entry.id || "",
      name: entry.name || "",
      tracks: entry.tracks || "",
      key: entry.key || "",
      source: entry.source || "",
      serverTrackCount: entry.serverTrackCount || 0,
      syncState: entry.syncState || "current",
      dirty: Number(entry.dirty || 0),
      isDuplicate: Boolean(Number(entry.isDuplicate || 0)),
      isDuplicateCandidate: Boolean(Number(entry.isDuplicateCandidate || 0)),
      isDuplicateConfirmed: Boolean(Number(entry.isDuplicateConfirmed || 0)),
      isAnalyzed: Boolean(Number(entry.isAnalyzed || 0)),
      trackFingerprint: entry.trackFingerprint || "",
      lastSeenAt: entry.lastSeenAt || "",
      lastDeepAnalyzedAt: entry.lastDeepAnalyzedAt || "",
    })),
    status: await cacheStore.getStatus(),
  };
}

async function readCachedPlaylistDetails(config = {}, query = {}) {
  const cfg = resolveConfig(config);
  await ensureCacheWarm(cfg);
  const cacheStore = await createCacheStore(cfg);
  if (!cacheStore) {
    throw new Error("Cache ist deaktiviert.");
  }
  const details = await cacheStore.getPlaylistDetails(query);
  if (!details?.playlist) {
    throw new Error("Playlist nicht im Cache gefunden.");
  }
  const summary = buildCacheSummaryFromDetails(details);
  return {
    runId: "cache",
    runStatus: "cache",
    playlistId: details.playlist.playlistId || details.playlist.playlistKey || "",
    playlistName: details.playlist.name || "",
    playlistTracksExpected: details.playlist.tracks || "",
    summary: summary
      ? {
          ...summary,
          status: details.playlist.syncState || summary.status || "cache",
          source: details.playlist.source || summary.source || "cache",
          syncState: details.playlist.syncState || "current",
          dirty: Number(details.playlist.dirty || 0),
        }
      : {
          playlistId: details.playlist.playlistId || details.playlist.playlistKey || "",
          playlistName: details.playlist.name || "",
          playlistTracksExpected: details.playlist.tracks || "",
          analyzedTrackRows: details.trackRows.length,
          status: details.playlist.syncState || "cache",
          source: details.playlist.source || "cache",
          trackFingerprint: details.playlist.trackFingerprint || "",
          genreCounts: [],
          labelCounts: [],
          yearCounts: [],
          syncState: details.playlist.syncState || "current",
          dirty: Number(details.playlist.dirty || 0),
        },
    duplicate: null,
    trackRows: details.trackRows.map((entry) =>
      normalizeTrackRow({
        playlistId: details.playlist.playlistId || details.playlist.playlistKey || "",
        playlistName: details.playlist.name || "",
        playlistTracksExpected: details.playlist.tracks || "",
        ...entry,
      })
    ),
    files: {
      cacheDbPath: cacheStore.dbPath,
    },
    origin: createDefaultOrigin("native"),
    migration: null,
  };
}

async function exportCsvFromCache(config = {}, query = {}) {
  const cfg = resolveConfig(config);
  await ensureCacheWarm(cfg);
  const cacheStore = await createCacheStore(cfg);
  if (!cacheStore) {
    throw new Error("Cache ist deaktiviert.");
  }
  const snapshot = await readCachedPlaylists(cfg);
  const selectedKeys = Array.isArray(query.selectedPlaylistKeys)
    ? new Set(query.selectedPlaylistKeys.map((value) => normalizePathInput(value)).filter(Boolean))
    : null;
  const playlists = selectedKeys
    ? snapshot.playlists.filter((entry) => selectedKeys.has(entry.cacheKey || entry.identity))
    : snapshot.playlists;

  const detailsRows = [];
  const summaryRows = [];
  for (const playlist of playlists) {
    const details = await readCachedPlaylistDetails(cfg, {
      playlistId: playlist.id,
      cacheKey: playlist.cacheKey,
      key: playlist.key,
    });
    const trackRows = Array.isArray(details.trackRows) ? details.trackRows : [];
    detailsRows.push(...trackRows);
    summaryRows.push(...createSummaryRowsForPlaylist(details.summary || {}));
  }

  const { cacheExportDir } = resolveCacheRoots(cfg);
  await fs.mkdir(cacheExportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const playlistsPath = path.join(cacheExportDir, `${stamp}-playlists.csv`);
  const tracksPath = path.join(cacheExportDir, `${stamp}-playlist_tracks.csv`);
  const dimensionsPath = path.join(cacheExportDir, `${stamp}-playlist_dimensions.csv`);

  const playlistCsvRows = playlists.map((entry) => ({
    playlistId: entry.id || "",
    cacheKey: entry.cacheKey || entry.identity || "",
    name: entry.name || "",
    tracks: entry.tracks || "",
    source: entry.source || "",
    syncState: entry.syncState || "",
    dirty: entry.dirty ? 1 : 0,
    duplicateStatus: entry.isDuplicateConfirmed
      ? "confirmed"
      : entry.isDuplicateCandidate
        ? "candidate"
        : "",
    trackFingerprint: entry.trackFingerprint || "",
    lastSeenAt: entry.lastSeenAt || "",
    lastDeepAnalyzedAt: entry.lastDeepAnalyzedAt || "",
  }));

  await fs.writeFile(
    playlistsPath,
    rowsToCsv(
      [
        "playlistId",
        "cacheKey",
        "name",
        "tracks",
        "source",
        "syncState",
        "dirty",
        "duplicateStatus",
        "trackFingerprint",
        "lastSeenAt",
        "lastDeepAnalyzedAt",
      ],
      playlistCsvRows
    ),
    "utf8"
  );
  await fs.writeFile(
    tracksPath,
    detailsRows.length
      ? rowsToCsv(
          TRACK_CSV_HEADERS,
          detailsRows.map((entry) => normalizeTrackRow(entry))
        )
      : `${TRACK_CSV_HEADERS.join(",")}\n`,
    "utf8"
  );
  await fs.writeFile(
    dimensionsPath,
    summaryRows.length
      ? rowsToCsv(SUMMARY_CSV_HEADERS, summaryRows)
      : `${SUMMARY_CSV_HEADERS.join(",")}\n`,
    "utf8"
  );

  await cacheStore.writeExportRecord("playlists", playlistsPath, playlistCsvRows.length);
  await cacheStore.writeExportRecord("tracks", tracksPath, detailsRows.length);
  await cacheStore.writeExportRecord("dimensions", dimensionsPath, summaryRows.length);

  return {
    playlistsPath,
    tracksPath,
    dimensionsPath,
    playlistCount: playlistCsvRows.length,
    trackCount: detailsRows.length,
    dimensionCount: summaryRows.length,
  };
}

async function loadRunStore(config = {}, runId) {
  const { cfg, runPaths, run, manifestRaw, playlists: playlistEntries, trackRows } =
    await readRunArtifacts(config, runId || config.runId);
  const dedupe = new Map();
  for (const entry of playlistEntries) {
    const ref = toPlaylistRef(entry);
    const identity = getPlaylistIdentity(ref);
    if (!identity || dedupe.has(identity)) continue;
    dedupe.set(identity, ref);
  }
  const store = new RunStore({ ...cfg, runId: run.runId }, runPaths);
  store.hydrateFromExisting(
    run,
    [...dedupe.values()],
    trackRows.map((entry) => normalizeTrackRow(entry))
  );
  return { cfg, store, manifestRaw };
}

/**
 * Liefert alle Playlist-Kandidaten eines Runs für Auswahl und Vergleich.
 */
async function readRunPlaylists(config = {}, query = {}) {
  const { store } = await loadRunStore(config, query.runId || config.runId);
  const duplicateSet = new Set(
    (store.run.duplicates || []).map((entry) => getPlaylistIdentity(entry))
  );
  const selectedRefs = Array.isArray(store.run.analysisPlan?.selectedPlaylists)
    ? store.run.analysisPlan.selectedPlaylists
    : Array.isArray(store.run.selection?.selectedPlaylists)
      ? store.run.selection.selectedPlaylists
      : [];
  const selectedSet = new Set(selectedRefs.map((entry) => getPlaylistIdentity(entry)));
  const analyzedSet = new Set(
    [
      ...(store.run.analysisPlan?.completedPlaylistRefs || []),
      ...(store.run.playlistSummaries || []),
    ].map((entry) => getPlaylistIdentity(entry))
  );

  return {
    runId: store.run.runId,
    status: store.run.status,
    phase: store.run.phase || "",
    origin: store.run.origin || createDefaultOrigin("native"),
    migration: store.run.migration || null,
    total: store.playlists.length,
    playlists: store.playlists.map((entry) => {
      const identity = getPlaylistIdentity(entry);
      return {
        ...entry,
        identity,
        isDuplicate: duplicateSet.has(identity),
        isSelected: selectedSet.size > 0 ? selectedSet.has(identity) : true,
        isAnalyzed: analyzedSet.has(identity),
      };
    }),
    selection: store.run.selection || {},
    analysisPlan: store.run.analysisPlan || {},
  };
}

/**
 * Gibt die Migrations-Herkunft eines Runs zurück.
 */
async function getRunMigrationInfo(config = {}, query = {}) {
  const { run } = await readRunArtifacts(config, query.runId || config.runId);
  return {
    runId: run.runId,
    schemaVersion: run.schemaVersion,
    origin: run.origin,
    migration: run.migration,
    files: run.files,
  };
}

async function probePageCapabilities(client) {
  try {
    return await client.evaluate(`(() => {
      const user = JSON.parse(localStorage.getItem("bp_user") || "{}");
      const performanceEntries = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => /playlists|tracks|api\\.beatport\\.com|uplaylists/i.test(name))
        .slice(0, 40);
      const sessionKeys = Object.keys(sessionStorage).filter((key) =>
        /playlists|tracks|auth|token/i.test(key)
      );
      return {
        userId: user.id || null,
        userName: user.name || "",
        performanceEntries,
        sessionKeys,
      };
    })()`);
  } catch (error) {
    return {
      error: String(error?.message || error),
    };
  }
}

function hasPlaylistSummaryChanged(cached = {}, live = {}) {
  const cachedName = normalizeLooseText(cached.name || cached.playlistName);
  const liveName = normalizeLooseText(live.name || live.playlistName);
  const cachedTracks = normalizeLooseText(cached.tracks || cached.playlistTracksExpected);
  const liveTracks = normalizeLooseText(live.tracks || live.playlistTracksExpected);
  const cachedCount = Number(cached.serverTrackCount || cachedTracks || 0) || 0;
  const liveCount = Number(live.serverTrackCount || liveTracks || 0) || 0;
  return (
    cachedName !== liveName ||
    cachedTracks !== liveTracks ||
    cachedCount !== liveCount
  );
}

function mergeLivePlaylistsWithCache(discoveredPlaylists = [], cachedPlaylists = []) {
  const byKey = new Map();
  for (const entry of Array.isArray(cachedPlaylists) ? cachedPlaylists : []) {
    const identity = normalizePlaylistKey(entry);
    if (!identity) continue;
    byKey.set(identity, entry);
  }
  return (Array.isArray(discoveredPlaylists) ? discoveredPlaylists : []).map((entry) => {
    const identity = normalizePlaylistKey(entry);
    const cached = byKey.get(identity) || null;
    const changed = cached ? hasPlaylistSummaryChanged(cached, entry) : true;
    const hasDeepData = Boolean(
      normalizeLooseText(cached?.trackFingerprint) ||
        normalizeLooseText(cached?.lastDeepAnalyzedAt)
    );
    return {
      ...entry,
      syncState: cached
        ? changed
          ? "dirty"
          : hasDeepData
            ? "current"
            : "needs_analysis"
        : "needs_analysis",
      dirty: changed || !hasDeepData ? 1 : 0,
      lastDeepAnalyzedAt: normalizeLooseText(cached?.lastDeepAnalyzedAt),
      trackFingerprint: normalizeLooseText(cached?.trackFingerprint),
      isDuplicateCandidate: Number(cached?.isDuplicateCandidate || 0),
      isDuplicateConfirmed: Number(cached?.isDuplicateConfirmed || 0),
    };
  });
}

async function resolveDiscoveryBaseline(config = {}) {
  const cfg = resolveConfig(config);
  if (!cfg.deltaDiscoveryEnabled) {
    return null;
  }
  const listing = await listStoredRuns(cfg);
  const preferredRunId =
    normalizePathInput(cfg.deltaSourceRunId) ||
    normalizePathInput(listing.preferredRun?.runId);
  if (!preferredRunId) {
    return null;
  }
  const artifacts = await readRunArtifacts(cfg, preferredRunId);
  if (!isCompatibleOperationalRun(artifacts.run)) {
    return null;
  }
  if (artifacts.run.runId === cfg.runId) {
    return null;
  }
  return artifacts;
}

async function performDiscovery(client, cfg, runStore, options = {}) {
  const cacheStore =
    options.cacheStore || (cfg.cacheEnabled ? await createCacheStore(cfg) : null);
  const pageProbe = await probePageCapabilities(client);
  await runStore.setNetworkHints({
    ...pageProbe,
    preferredMethod: cfg.analysisMethod || DEFAULTS.analysisMethod,
    preferServerData: cfg.preferServerData !== false,
    directRouteEnabled: true,
  });

  const preferredMethod = String(
    cfg.analysisMethod || DEFAULTS.analysisMethod
  ).toLowerCase();
  if (preferredMethod !== "route" && preferredMethod !== "dom") {
    try {
      const apiClient = await BeatportApiClient.create(client, cfg);
      if (apiClient) {
        const discoveredPlaylists = await apiClient.discoverPlaylists();
        let runPlaylists = discoveredPlaylists;
        let duplicates = buildDuplicateEntries(
          discoveredPlaylists,
          runStore.run.playlistSummaries
        );

        if (cacheStore) {
          const cachedPlaylists = await cacheStore.listPlaylists();
          const merged = mergeLivePlaylistsWithCache(
            discoveredPlaylists,
            cachedPlaylists
          );
          await cacheStore.upsertPlaylists(merged, {
            source: "xhr",
            lastRunId: runStore.run.runId,
          });
          await cacheStore.markMissingPlaylists(
            merged.map((entry) => normalizePlaylistKey(entry)),
            toIsoNow()
          );
          const snapshot = await getCacheSnapshot(cfg);
          if (snapshot.cacheStore) {
            await snapshot.cacheStore.applyDuplicateEntries(snapshot.duplicates);
            await snapshot.cacheStore.setSyncState("last_delta_sync_at", toIsoNow());
            await snapshot.cacheStore.setSyncState(
              "last_delta_sync_run_id",
              runStore.run.runId
            );
          }
          runPlaylists = snapshot.playlists;
          duplicates = snapshot.duplicates;
        }

        await runStore.addPlaylists(runPlaylists, {
          source: "xhr",
          method: "xhr",
          pageCount: Math.ceil(
            discoveredPlaylists.length / PLAYLIST_DISCOVERY_PER_PAGE
          ),
        });
        await runStore.replaceDuplicates(duplicates, {
          source: cacheStore ? "cache" : "xhr",
          method: "xhr",
        });
        const duplicateCsv = duplicates.length
          ? buildDuplicateCsvRows(duplicates)
          : "Name,Tracks,ID,Status,Quelle,Fingerprint\n";
        const finalizeUiResult = await client.evaluate(
          buildFinalizeDiscoveryExpression(duplicates, duplicateCsv, cfg)
        );
        await runStore.setNetworkHints({
          ...runStore.run.networkHints,
          xhrEnabled: true,
          discoverySource: "xhr",
          authHeaderPresent: true,
          discoveryTemplate: apiClient.context.discoveryTemplate,
          playlistTemplate: apiClient.context.playlistTemplate,
          tracksTemplate: apiClient.context.tracksTemplate,
        });
        await runStore.appendEvent("discovery_completed_via_xhr", {
          playlistsDiscovered: runStore.playlists.length,
          duplicates: duplicates.length,
        });
        return {
          playlists: runPlaylists,
          duplicates,
          duplicateCsv,
          finalizeUiResult,
        };
      }
    } catch (error) {
      await runStore.appendEvent("xhr_discovery_failed", {
        message: sanitizeSensitiveText(String(error?.message || error)),
      });
      if (preferredMethod === "xhr") {
        throw error;
      }
    }
  }

  const seenKeys = new Map();
  const seenPlaylists = new Set();
  const playlists = [...(runStore.playlists || [])];
  for (const entry of playlists) {
    const identity = entry.id || `keyless:${entry.key}`;
    if (identity) {
      seenPlaylists.add(identity);
    }
    if (entry.key && !seenKeys.has(entry.key)) {
      seenKeys.set(entry.key, entry.id || identity);
    }
  }
  let stagnantRounds = 0;
  let stepIndex = 0;

  while (true) {
    const stepResult = await client.evaluate(buildDiscoveryStepExpression(cfg));
    if (!stepResult || stepResult.error) {
      throw new Error(stepResult?.error ?? "Unbekannter Discovery-Fehler.");
    }

    const visibleRows = Array.isArray(stepResult.rows) ? stepResult.rows : [];
    const newPlaylists = [];

    for (const info of visibleRows) {
      if (!info?.name || !info?.tracks) continue;
      const playlistIdentity = info.id || `keyless:${info.key}`;
      if (!seenPlaylists.has(playlistIdentity)) {
        seenPlaylists.add(playlistIdentity);
        playlists.push(info);
        newPlaylists.push(info);
      }
      if (!seenKeys.has(info.key)) {
        seenKeys.set(info.key, info.id || playlistIdentity);
      }
    }

    if (newPlaylists.length > 0) {
      await runStore.addPlaylists(newPlaylists, { stepIndex });
    }
    const duplicates = buildDuplicateEntries(
      runStore.playlists || [],
      runStore.run.playlistSummaries
    );
    await runStore.replaceDuplicates(duplicates, {
      stepIndex,
      source: "dom",
      method: "dom",
    });

    await runStore.appendEvent("sidebar_step", {
      stepIndex,
      visibleRows: visibleRows.length,
      scrollTop: stepResult.afterTop,
      scrollHeight: stepResult.afterHeight,
      stagnant: Boolean(stepResult.stagnant),
      playlistsDiscovered: playlists.length,
      duplicates: runStore.run.duplicates.length,
    });

    if (stepResult.stagnant) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }

    if (stagnantRounds >= 2) {
      break;
    }

    stepIndex += 1;
  }

  const duplicates = buildDuplicateEntries(
    playlists,
    runStore.run.playlistSummaries
  );
  if (cacheStore) {
    const merged = mergeLivePlaylistsWithCache(playlists, await cacheStore.listPlaylists());
    await cacheStore.upsertPlaylists(merged, {
      source: "dom",
      lastRunId: runStore.run.runId,
    });
    await cacheStore.markMissingPlaylists(
      merged.map((entry) => normalizePlaylistKey(entry)),
      toIsoNow()
    );
    const snapshot = await getCacheSnapshot(cfg);
    if (snapshot.cacheStore) {
      await snapshot.cacheStore.applyDuplicateEntries(snapshot.duplicates);
    }
  }
  await runStore.replaceDuplicates(duplicates, {
    source: "dom",
    method: "dom",
    finalized: true,
  });
  const duplicateCsv = duplicates.length
    ? buildDuplicateCsvRows(duplicates)
    : "Name,Tracks,ID,Status,Quelle,Fingerprint\n";
  const finalizeUiResult = await client.evaluate(
    buildFinalizeDiscoveryExpression(duplicates, duplicateCsv, cfg)
  );
  await runStore.appendEvent("duplicates_marked", {
    downloadLinkId: finalizeUiResult?.downloadLinkId ?? "",
    duplicates: duplicates.length,
  });

  return {
    playlists,
    duplicates,
    duplicateCsv,
    finalizeUiResult,
  };
}

async function analyzePlaylistWithMethod(client, cfg, playlist, apiClient = null) {
  const preferred = String(cfg.analysisMethod || DEFAULTS.analysisMethod).toLowerCase();
  let xhrError = "";
  let directRouteError = "";

  if (preferred !== "route" && preferred !== "dom" && playlist.id && apiClient) {
    try {
      return await apiClient.analyzePlaylist(playlist);
    } catch (error) {
      xhrError = String(error?.message || error);
      if (preferred === "xhr") {
        throw error;
      }
    }
  }

  if (preferred !== "dom" && playlist.id) {
    try {
      await client.send("Page.navigate", {
        url: `https://dj.beatport.com/playlists/${playlist.id}`,
      });
      await sleep(Math.max(900, cfg.deepAnalysisWaitMs || 0));
      const directResult = await client.evaluate(
        buildReadCurrentPlaylistExpression(cfg, playlist)
      );
      if (directResult?.status === "ok") {
        return {
          ...directResult,
          analysisMethod: "route",
        };
      }
      directRouteError = directResult?.status || "route_not_loaded";
    } catch (error) {
      directRouteError = String(error?.message || error);
    }
  }

  const domResult = await client.evaluate(
    buildAnalyzePlaylistExpression(cfg, playlist)
  );
  return {
    ...domResult,
    analysisMethod: "dom",
    xhrError,
    routeError: directRouteError,
  };
}

async function readPlaylistAnalysisFromCache(cacheStore, playlist) {
  if (!cacheStore) {
    return null;
  }
  const details = await cacheStore.getPlaylistDetails({
    playlistId: playlist.id,
    key: playlist.key,
    cacheKey: normalizePlaylistKey(playlist),
  });
  if (!details?.playlist) {
    return null;
  }
  const syncState = normalizeLooseText(details.playlist.syncState).toLowerCase();
  const dirty = Number(details.playlist.dirty || 0) > 0;
  if (dirty || (syncState && syncState !== "current")) {
    return null;
  }
  if (!Array.isArray(details.trackRows) || details.trackRows.length === 0) {
    return null;
  }
  const summary = buildCacheSummaryFromDetails(details);
  if (!summary || summary.analyzedTrackRows === 0) {
    return null;
  }
  return {
    ...summary,
    trackRows: details.trackRows.map((entry) =>
      normalizeTrackRow({
        playlistId: summary.playlistId,
        playlistName: summary.playlistName,
        playlistTracksExpected: summary.playlistTracksExpected,
        ...entry,
      })
    ),
    status: "ok",
    analysisMethod: "cache",
    source: "cache",
  };
}

async function performAnalysis(
  client,
  cfg,
  runStore,
  selectedPlaylists,
  mode = "start",
  options = {}
) {
  const allPlaylists =
    Array.isArray(runStore.playlists) && runStore.playlists.length > 0
      ? runStore.playlists
      : [];
  const normalizedSelection =
    Array.isArray(selectedPlaylists) && selectedPlaylists.length > 0
      ? selectedPlaylists.map((entry) => toPlaylistRef(entry))
      : allPlaylists.map((entry) => toPlaylistRef(entry));

  const completedSet = new Set(
    (runStore.run.analysisPlan?.completedPlaylistRefs || []).map((entry) =>
      getPlaylistIdentity(entry)
    )
  );
  const pendingPlaylists = normalizedSelection.filter(
    (entry) => !completedSet.has(getPlaylistIdentity(entry))
  );

  await runStore.beginAnalysis(
    normalizedSelection,
    cfg.analysisMethod || DEFAULTS.analysisMethod,
    mode
  );

  const cacheStore =
    options.cacheStore || (cfg.cacheEnabled ? await createCacheStore(cfg) : null);
  let apiClient = null;
  const preferredMethod = String(
    cfg.analysisMethod || DEFAULTS.analysisMethod
  ).toLowerCase();
  if (
    preferredMethod !== "route" &&
    preferredMethod !== "dom" &&
    pendingPlaylists.some((entry) => entry.id)
  ) {
    try {
      apiClient = await BeatportApiClient.create(client, cfg, {
        playlistId: pendingPlaylists.find((entry) => entry.id)?.id || "",
      });
      if (apiClient) {
        await runStore.setNetworkHints({
          ...runStore.run.networkHints,
          xhrEnabled: true,
          detailSource: "xhr",
          authHeaderPresent: true,
          discoveryTemplate: apiClient.context.discoveryTemplate,
          playlistTemplate: apiClient.context.playlistTemplate,
          tracksTemplate: apiClient.context.tracksTemplate,
        });
      }
    } catch (error) {
      await runStore.appendEvent("xhr_context_failed", {
        message: sanitizeSensitiveText(String(error?.message || error)),
      });
      if (preferredMethod === "xhr") {
        throw error;
      }
    }
  }

  const deepAnalysis = new Array(pendingPlaylists.length);
  const deepTrackRows = new Array(pendingPlaylists.length);
  const control = getRunControl(runStore.run.runId);
  const parallelism = Math.min(6, Math.max(1, toInt(cfg.parallelism, DEFAULTS.parallelism)));
  let nextIndex = 0;
  let commitChain = Promise.resolve();

  const worker = async () => {
    while (nextIndex < pendingPlaylists.length) {
      if (control.pauseRequested) {
        return;
      }

      const playlistIndex = nextIndex;
      nextIndex += 1;
      const playlist = pendingPlaylists[playlistIndex];
      await runStore.setCurrentPlaylist(
        playlist,
        playlistIndex + 1,
        normalizedSelection.length
      );

      let analysis = await readPlaylistAnalysisFromCache(cacheStore, playlist);
      if (analysis) {
        await runStore.appendEvent("playlist_analysis_cache_hit", {
          playlistId: analysis.playlistId,
          playlistName: analysis.playlistName,
          playlistIndex,
        });
      } else {
        try {
          analysis = await analyzePlaylistWithMethod(
            client,
            cfg,
            playlist,
            apiClient
          );
        } catch (error) {
          if (cacheStore) {
            await cacheStore.markPlaylistDeferred(playlist, "deferred");
          }
          throw error;
        }
      }

      const trackRows = Array.isArray(analysis?.trackRows) ? analysis.trackRows : [];
      const summary = {
        playlistId: analysis?.playlistId ?? playlist.id ?? "",
        playlistName: analysis?.playlistName ?? playlist.name ?? "",
        playlistTracksExpected:
          analysis?.playlistTracksExpected ?? playlist.tracks ?? "",
        analyzedTrackRows: analysis?.analyzedTrackRows ?? trackRows.length ?? 0,
        status: analysis?.status ?? "unknown",
        analysisMethod: analysis?.analysisMethod ?? "dom",
        source: analysis?.source ?? analysis?.analysisMethod ?? "dom",
        serverTrackCount:
          analysis?.serverTrackCount ??
          playlist.serverTrackCount ??
          playlist.tracks ??
          0,
        trackFingerprint: analysis?.trackFingerprint ?? "",
        genreCounts: Array.isArray(analysis?.genreCounts) ? analysis.genreCounts : [],
        labelCounts: Array.isArray(analysis?.labelCounts) ? analysis.labelCounts : [],
        yearCounts: Array.isArray(analysis?.yearCounts) ? analysis.yearCounts : [],
      };

      deepAnalysis[playlistIndex] = summary;
      deepTrackRows[playlistIndex] = trackRows;

      commitChain = commitChain.then(async () => {
        await runStore.addPlaylistAnalysis(summary, trackRows);
        await runStore.markPlaylistCompleted(playlist, summary.analysisMethod);
        if (cacheStore && summary.analysisMethod !== "cache") {
          await cacheStore.replacePlaylistAnalysis(summary, trackRows, {
            lastRunId: runStore.run.runId,
            syncState: "current",
          });
        }
        await runStore.appendEvent("playlist_analysis_progress", {
          playlistIndex,
          totalPlaylists: normalizedSelection.length,
          playlistId: summary.playlistId,
          playlistName: summary.playlistName,
          analysisMethod: summary.analysisMethod,
        });
      });
      await commitChain;
    }
  };

  const workers = Array.from(
    { length: Math.min(parallelism, pendingPlaylists.length || 1) },
    () => worker()
  );
  await Promise.all(workers);
  await commitChain;

  if (cacheStore) {
    const snapshot = await getCacheSnapshot(cfg);
    if (snapshot.cacheStore) {
      await snapshot.cacheStore.applyDuplicateEntries(snapshot.duplicates);
      await snapshot.cacheStore.setSyncState("last_analysis_at", toIsoNow());
      await snapshot.cacheStore.setSyncState(
        "last_analysis_run_id",
        runStore.run.runId
      );
    }
  }

  if (control.pauseRequested && nextIndex < pendingPlaylists.length) {
    await runStore.markPaused("pause_requested");
    return {
      paused: true,
      deepAnalysis: deepAnalysis.filter(Boolean),
      deepTrackRows: deepTrackRows.flat(),
    };
  }

  await runStore.finalize();
  return {
    paused: false,
    deepAnalysis: deepAnalysis.filter(Boolean),
    deepTrackRows: deepTrackRows.flat(),
  };
}

/**
 * Führt nur die Discovery aus und beendet den Run als ready_for_analysis.
 */
async function runDiscover(config) {
  const cfg = resolveConfig(config);
  await ensureCacheWarm(cfg);
  const runId = cfg.runId || createRunId();
  const runPaths = resolveRunPaths(cfg, runId);
  const runStore = new RunStore({ ...cfg, runId }, runPaths);
  await runStore.initialize();
  const cacheSnapshot = cfg.cacheEnabled ? await getCacheSnapshot(cfg) : null;
  if (cacheSnapshot?.playlists?.length) {
    await runStore.importBaseline(
      { runId: "cache", startedAt: toIsoNow(), status: "cache" },
      cacheSnapshot.playlists,
      cacheSnapshot.duplicates
    );
  } else {
    const baseline = await resolveDiscoveryBaseline({ ...cfg, runId });
    if (baseline) {
      await runStore.importBaseline(
        baseline.run,
        baseline.playlists,
        baseline.duplicates
      );
    }
  }

  let cacheStore = null;
  if (cfg.cacheEnabled) {
    cacheStore = cacheSnapshot?.cacheStore || (await createCacheStore(cfg));
  }

  let client = null;
  let target = null;
  try {
    clearRunControl(runId);
    const connection = await createScannerClientConnection(cfg);
    client = connection.client;
    target = connection.target;
    runStore.setTarget(target);
    await runStore.appendEvent("cdp_connected", {
      targetId: target.id,
      targetTitle: target.title,
      targetUrl: target.url,
      mode: target.mode || "external-fallback",
    });
    const discovery = await performDiscovery(client, cfg, runStore, {
      cacheStore,
    });
    await runStore.markDiscoveryComplete(discovery.playlists);

    return {
      target,
      duplicates: discovery.duplicates,
      playlists: discovery.playlists,
      deepAnalysisEnabled: Boolean(cfg.deepAnalysis),
      deepAnalysis: [],
      deepTrackRows: [],
      files: runStore.run.files,
      run: runStore.run,
      state: runStore.run,
      cacheStatus: cfg.cacheEnabled ? await getCacheStatus(cfg) : null,
    };
  } catch (error) {
    try {
      await runStore.markIncomplete(error);
    } catch {
      // Persistenzfehler nicht maskieren.
    }
    throw error;
  } finally {
    clearRunControl(runId);
    if (client) {
      await client.close();
    }
  }
}

async function runDeltaSync(config = {}) {
  return await runDiscover({
    ...config,
    deepAnalysis: false,
  });
}

/**
 * Analysiert eine explizite Playlist-Auswahl oder setzt einen pausierten Run fort.
 */
async function runAnalyzeSelection(config) {
  const cfg = resolveConfig(config);
  await ensureCacheWarm(cfg);
  let runId = normalizePathInput(cfg.runId);
  let runStore = null;

  if (runId) {
    ({ store: runStore } = await loadRunStore(cfg, runId));
  } else {
    runId = createRunId();
    const runPaths = resolveRunPaths(cfg, runId);
    runStore = new RunStore({ ...cfg, runId }, runPaths);
    await runStore.initialize();
    const cacheSnapshot = cfg.cacheEnabled ? await getCacheSnapshot(cfg) : null;
    if (cacheSnapshot?.playlists?.length) {
      await runStore.importBaseline(
        { runId: "cache", startedAt: toIsoNow(), status: "cache" },
        cacheSnapshot.playlists,
        cacheSnapshot.duplicates
      );
    }
    await runStore.markDiscoveryComplete(runStore.playlists);
  }

  const selectedPlaylists =
    Array.isArray(config.selectedPlaylists) && config.selectedPlaylists.length > 0
      ? config.selectedPlaylists.map((entry) => toPlaylistRef(entry))
      : runStore.run.analysisPlan?.selectedPlaylists?.length
        ? runStore.run.analysisPlan.selectedPlaylists
        : runStore.playlists;

  if (!Array.isArray(selectedPlaylists) || selectedPlaylists.length === 0) {
    throw new Error("Keine Playlists zur Analyse ausgewählt.");
  }

  let client = null;
  let target = null;
  const cacheStore = cfg.cacheEnabled ? await createCacheStore(cfg) : null;
  try {
    clearRunControl(runId);
    const connection = await createScannerClientConnection(cfg);
    client = connection.client;
    target = connection.target;
    runStore.setTarget(target);
    await runStore.appendEvent("cdp_connected", {
      targetId: target.id,
      targetTitle: target.title,
      targetUrl: target.url,
      mode: target.mode || "external-fallback",
    });
    const pageProbe = await probePageCapabilities(client);
    await runStore.setNetworkHints({
      ...runStore.run.networkHints,
      ...pageProbe,
      preferredMethod: cfg.analysisMethod || DEFAULTS.analysisMethod,
      directRouteEnabled: true,
    });

    const mode =
      runStore.run.status === "paused" || runStore.run.status === "incomplete"
        ? "resume"
        : "start";
    const result = await performAnalysis(
      client,
      cfg,
      runStore,
      selectedPlaylists,
      mode,
      { cacheStore }
    );

    return {
      target,
      duplicates: runStore.run.duplicates || [],
      playlists: runStore.playlists || [],
      deepAnalysisEnabled: true,
      deepAnalysis: runStore.run.playlistSummaries || [],
      deepTrackRows: runStore.deepTrackRows || [],
      paused: Boolean(result.paused),
      files: runStore.run.files,
      run: runStore.run,
      state: runStore.run,
      cacheStatus: cfg.cacheEnabled ? await getCacheStatus(cfg) : null,
    };
  } catch (error) {
    if (getRunControl(runId).pauseRequested) {
      await runStore.markPaused("pause_requested");
      return {
        target,
        duplicates: runStore.run.duplicates || [],
        playlists: runStore.playlists || [],
        deepAnalysisEnabled: true,
        deepAnalysis: runStore.run.playlistSummaries || [],
        deepTrackRows: runStore.deepTrackRows || [],
        paused: true,
        files: runStore.run.files,
        run: runStore.run,
        state: runStore.run,
        cacheStatus: cfg.cacheEnabled ? await getCacheStatus(cfg) : null,
      };
    }
    try {
      await runStore.markIncomplete(error);
    } catch {
      // Persistenzfehler nicht maskieren.
    }
    throw error;
  } finally {
    clearRunControl(runId);
    if (client) {
      await client.close();
    }
  }
}

/**
 * Markiert einen laufenden Analyseprozess zur sicheren Pause nach der aktuellen Playlist.
 */
async function requestRunPause(runId) {
  const key = normalizePathInput(runId);
  if (!key) {
    throw new Error("Run-ID für Pause fehlt.");
  }
  const control = getRunControl(key);
  control.pauseRequested = true;
  return {
    ok: true,
    runId: key,
    message: "Pause angefordert. Lauf stoppt nach der aktuellen Playlist.",
  };
}

/**
 * Liest die Trackdetails einer Playlist aus einem gespeicherten Run.
 */
async function readRunPlaylistDetails(config = {}, query = {}) {
  const cfg = resolveConfig({
    ...config,
    runId: query.runId || config.runId || "",
  });
  const runId = normalizePathInput(query.runId || cfg.runId);
  let artifacts = null;
  if (runId) {
    artifacts = await readRunArtifacts(cfg, runId);
  } else {
    const listing = await listStoredRuns(cfg);
    const fallbackRun = listing.lastSuccessfulRun || listing.runs[0] || null;
    if (!fallbackRun?.runId) {
      throw new Error("Gewählter Run nicht gefunden.");
    }
    artifacts = await readRunArtifacts(cfg, fallbackRun.runId);
  }
  const run = artifacts.run;

  const requestedId = normalizeLooseText(query.playlistId).replace(/^ref-/, "");
  const requestedName = normalizeLooseText(query.playlistName);
  const requestedTracks = normalizeLooseText(
    query.playlistTracksExpected || query.tracks
  );

  const matchesPlaylist = (entry) => {
    const entryId = normalizeLooseText(
      entry?.playlistId ?? entry?.id ?? ""
    ).replace(/^ref-/, "");
    const entryName = normalizeLooseText(entry?.playlistName ?? entry?.name ?? "");
    const entryTracks = normalizeLooseText(
      entry?.playlistTracksExpected ?? entry?.tracks ?? ""
    );

    if (requestedId && entryId) {
      return entryId === requestedId;
    }
    if (requestedName && entryName !== requestedName) {
      return false;
    }
    if (requestedTracks && entryTracks !== requestedTracks) {
      return false;
    }
    return Boolean(entryName || entryId);
  };

  const summary =
    (Array.isArray(run.playlistSummaries)
      ? run.playlistSummaries.map((entry) => normalizePlaylistSummary(entry)).find(matchesPlaylist)
      : null) || null;
  const duplicate =
    (Array.isArray(run.duplicates)
      ? run.duplicates.map((entry) => toPlaylistRef(entry)).find(matchesPlaylist)
      : null) ||
    null;
  const playlistRows = artifacts.trackRows;
  const trackRows = playlistRows
    .map((entry) => normalizeTrackRow(entry))
    .filter(matchesPlaylist)
    .sort(
      (a, b) =>
        Number(a.trackIndex ?? 0) - Number(b.trackIndex ?? 0) ||
        String(a.trackTitle ?? "").localeCompare(String(b.trackTitle ?? ""))
    );

  return {
    runId: run.runId,
    runStatus: run.status,
    playlistId:
      normalizeLooseText(summary?.playlistId ?? duplicate?.id ?? requestedId) ||
      "",
    playlistName:
      normalizeLooseText(summary?.playlistName ?? duplicate?.name ?? requestedName) ||
      "",
    playlistTracksExpected:
      normalizeLooseText(
        summary?.playlistTracksExpected ?? duplicate?.tracks ?? requestedTracks
      ) || "",
    summary,
    duplicate,
    trackRows,
    files: {
      trackAnalysisPath: run.files?.trackAnalysisPath ?? "",
      analysisJsonPath: run.files?.analysisJsonPath ?? "",
    },
    origin: run.origin || createDefaultOrigin("native"),
    migration: run.migration || null,
  };
}

async function persistExistingRunState(state, statePath) {
  const archiveStatePath = statePath;
  const exportStatePath = state?.files?.exportStatePath;
  const summaryPath = state?.files?.summaryPath;
  const exportSummaryPath = state?.files?.exportSummaryPath;
  const manifestPath = state?.files?.manifestPath;
  const exportManifestPath = state?.files?.exportManifestPath;
  const stateJson = JSON.stringify(state, null, 2);

  await fs.writeFile(archiveStatePath, stateJson, "utf8");
  if (exportStatePath) {
    await fs.writeFile(exportStatePath, stateJson, "utf8");
  }

  if (summaryPath) {
    const summaryPayload = {
      schemaVersion: state.schemaVersion ?? RUN_SCHEMA_VERSION,
      runId: state.runId ?? "",
      status: state.status ?? "",
      phase: state.phase ?? "",
      startedAt: state.startedAt ?? "",
      finishedAt: state.finishedAt ?? "",
      app: state.app ?? {},
      config: state.config ?? {},
      target: state.target ?? {},
      counts: state.counts ?? {
        playlistsDiscovered: state.playlistCount ?? 0,
        selectedPlaylists: state.selection?.selectedPlaylists?.length ?? 0,
        duplicates: state.duplicateCount ?? 0,
        analyzedPlaylists: state.deepAnalysis?.analyzedPlaylists ?? 0,
        analyzedTrackRows: state.deepAnalysis?.analyzedTrackRows ?? 0,
      },
      selection: state.selection ?? {},
      analysisPlan: state.analysisPlan ?? {},
      networkHints: state.networkHints ?? {},
      files: state.files ?? {},
      duplicates: state.duplicates ?? [],
      playlistSummaries: state.playlistSummaries ?? [],
      lastDeleteRun: state.lastDeleteRun ?? null,
      origin: state.origin ?? createDefaultOrigin("native"),
      migration: state.migration ?? null,
    };
    const summaryJson = JSON.stringify(summaryPayload, null, 2);
    await fs.writeFile(summaryPath, summaryJson, "utf8");
    if (exportSummaryPath) {
      await fs.writeFile(exportSummaryPath, summaryJson, "utf8");
    }
    if (manifestPath) {
      await fs.writeFile(manifestPath, summaryJson, "utf8");
    }
    if (exportManifestPath) {
      await fs.writeFile(exportManifestPath, summaryJson, "utf8");
    }
  }
}

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

  normalized.schemaVersion = RUN_SCHEMA_VERSION;
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
async function migrateLegacyRuns(config = {}, query = {}) {
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

/**
 * Erstellt ein ZIP-Archiv eines vollständigen Runs.
 */
async function exportRunZip(config = {}, query = {}) {
  const { cfg, run } = await readRunArtifacts(config, query.runId || config.runId);
  const zipPath = resolveRunZipPath(cfg, run);
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  createArchiveZip(run.files.archiveDir, zipPath);
  return {
    runId: run.runId,
    zipPath,
    sourceDir: run.files.archiveDir,
  };
}

function printHelp() {
  const text = `
Beatport CDP Tool (ohne Screenshot-Backend)

Nutzung:
  node tools/beatport_cdp_tool.mjs scan [Optionen]
  node tools/beatport_cdp_tool.mjs discover [Optionen]
  node tools/beatport_cdp_tool.mjs analyze --run-id <id> [Optionen]
  node tools/beatport_cdp_tool.mjs pause --run-id <id>
  node tools/beatport_cdp_tool.mjs list-legacy [Optionen]
  node tools/beatport_cdp_tool.mjs migrate-legacy [--run-id <id>] [Optionen]
  node tools/beatport_cdp_tool.mjs export-zip --run-id <id> [Optionen]
  node tools/beatport_cdp_tool.mjs delete --confirm "${CONFIRM_TEXT}" [Optionen]

Optionen:
  --host <host>                 CDP Host (Default: ${DEFAULTS.host})
  --port <port>                 CDP Port (Default: ${DEFAULTS.port})
  --timeout <ms>                Timeout je CDP-Aufruf (Default: ${DEFAULTS.timeoutMs})
  --target-pattern <text>       Target-Match über title/url (Default: ${DEFAULTS.targetPattern})
  --state-file <pfad>           JSON-Statusdatei (Default: ${DEFAULTS.stateFile})
  --csv-file <pfad>             Lokale CSV-Datei (Default: ${DEFAULTS.csvFile})
  --analysis-json-file <pfad>   Tiefenanalyse JSON (Default: ${DEFAULTS.analysisJsonFile})
  --analysis-track-csv-file <pfad>
                                Track-Level CSV (Default: ${DEFAULTS.analysisTrackCsvFile})
  --analysis-summary-csv-file <pfad>
                                Aggregierte Dimensionen (Default: ${DEFAULTS.analysisSummaryCsvFile})
  --output-dir <pfad>           Basisordner für sichtbare Export-Kopien
  --run-id <id>                Bestehenden Run für delete explizit wählen
  --state-path <pfad>          Absolute State-Datei für delete/scoped Läufe
  --no-deep-analysis            Nur Duplikat-Scan (ohne Playlist-Tiefenanalyse)
  --sidebar-step <px>           Scroll-Schritt Sidebar (Default: ${DEFAULTS.sidebarScrollStep})
  --deep-analysis-wait <ms>     Wartezeit nach Playlist-Klick (Default: ${DEFAULTS.deepAnalysisWaitMs})
  --analysis-method <mode>      auto | xhr | route | dom (Default: ${DEFAULTS.analysisMethod})
  --host-app-path <pfad>        Host-Browser App (Default: ${DEFAULTS.hostAppPath})
  --app-path <pfad>             Pfad zur Beatport-App
  --launch-app                  App/Host via open -na ... mit remote-debugging-port starten
  --no-launch-app               Kein Auto-Start, nur bestehendes CDP nutzen
  --no-auto-recover-cdp         Keine automatische Host-Recovery bei CDP-Fehler
  --confirm <text>              Pflicht bei delete (muss exakt "${CONFIRM_TEXT}" sein)

Ablauf:
  1) Scan legt sofort einen Run-Ordner im Archiv und eine Export-Kopie an.
  2) Discovery, Duplikate und Tiefenanalyse werden fortlaufend auf Platte geschrieben.
  3) Delete läuft nur mit exakter Bestätigung und nutzt die State-Datei eines expliziten Runs.
`;
  process.stdout.write(`${text.trim()}\n`);
}

/**
 * Führt Discovery und optional die komplette Tiefenanalyse in einem Lauf aus.
 */
async function runScan(config) {
  const cfg = resolveConfig(config);
  await ensureCacheWarm(cfg);
  const runId = cfg.runId || createRunId();
  const runPaths = resolveRunPaths(cfg, runId);
  const runStore = new RunStore({ ...cfg, runId }, runPaths);
  await runStore.initialize();
  const cacheSnapshot = cfg.cacheEnabled ? await getCacheSnapshot(cfg) : null;
  if (cacheSnapshot?.playlists?.length) {
    await runStore.importBaseline(
      { runId: "cache", startedAt: toIsoNow(), status: "cache" },
      cacheSnapshot.playlists,
      cacheSnapshot.duplicates
    );
  } else {
    const baseline = await resolveDiscoveryBaseline({ ...cfg, runId });
    if (baseline) {
      await runStore.importBaseline(
        baseline.run,
        baseline.playlists,
        baseline.duplicates
      );
    }
  }

  let cacheStore = null;
  if (cfg.cacheEnabled) {
    cacheStore = cacheSnapshot?.cacheStore || (await createCacheStore(cfg));
  }

  let client = null;
  let target = null;
  try {
    clearRunControl(runId);
    const connection = await createScannerClientConnection(cfg);
    client = connection.client;
    target = connection.target;
    runStore.setTarget(target);
    await runStore.appendEvent("cdp_connected", {
      targetId: target.id,
      targetTitle: target.title,
      targetUrl: target.url,
      mode: target.mode || "external-fallback",
    });
    const discovery = await performDiscovery(client, cfg, runStore, {
      cacheStore,
    });

    if (!cfg.deepAnalysis) {
      await runStore.markDiscoveryComplete(discovery.playlists);
      return {
        target,
        duplicates: runStore.run.duplicates || discovery.duplicates,
        playlists: runStore.playlists || discovery.playlists,
        deepAnalysisEnabled: false,
        deepAnalysis: [],
        deepTrackRows: [],
        paused: false,
        files: runStore.run.files,
        run: runStore.run,
        state: runStore.run,
        cacheStatus: cfg.cacheEnabled ? await getCacheStatus(cfg) : null,
      };
    }

    const analysis = await performAnalysis(
      client,
      cfg,
      runStore,
      discovery.playlists,
      "start",
      { cacheStore }
    );

    return {
      target,
      duplicates: runStore.run.duplicates || discovery.duplicates,
      playlists: runStore.playlists || discovery.playlists,
      deepAnalysisEnabled: true,
      deepAnalysis: runStore.run.playlistSummaries || [],
      deepTrackRows: runStore.deepTrackRows || [],
      paused: Boolean(analysis.paused),
      files: runStore.run.files,
      run: runStore.run,
      state: runStore.run,
      cacheStatus: cfg.cacheEnabled ? await getCacheStatus(cfg) : null,
    };
  } catch (error) {
    if (getRunControl(runId).pauseRequested) {
      await runStore.markPaused("pause_requested");
      return {
        target,
        duplicates: runStore.run.duplicates || [],
        playlists: runStore.playlists || [],
        deepAnalysisEnabled: Boolean(cfg.deepAnalysis),
        deepAnalysis: runStore.run.playlistSummaries || [],
        deepTrackRows: runStore.deepTrackRows || [],
        paused: true,
        files: runStore.run.files,
        run: runStore.run,
        state: runStore.run,
        cacheStatus: cfg.cacheEnabled ? await getCacheStatus(cfg) : null,
      };
    }
    try {
      await runStore.markIncomplete(error);
    } catch {
      // Persistenzfehler hier nicht maskieren.
    }
    throw error;
  } finally {
    clearRunControl(runId);
    if (client) {
      await client.close();
    }
  }
}

/**
 * Führt die Batch-Löschung anhand eines gespeicherten Runs aus.
 */
async function runDelete(config) {
  const cfg = resolveConfig(config);
  const confirm = typeof cfg.confirm === "string" ? cfg.confirm.trim() : "";
  if (confirm !== CONFIRM_TEXT) {
    throw new Error(
      `Löschung blockiert: --confirm muss exakt "${CONFIRM_TEXT}" sein.`
    );
  }

  let statePath = cfg.statePath;
  if (!statePath && cfg.runId) {
    statePath = resolveRunPaths(cfg, cfg.runId).files.statePath;
  }
  if (!statePath) {
    const runListing = await listStoredRuns(cfg);
    const fallbackRun = runListing.lastSuccessfulRun;
    if (!fallbackRun?.files?.statePath) {
      throw new Error("Kein abgeschlossener Run mit State-Datei gefunden.");
    }
    statePath = fallbackRun.files.statePath;
  }
  if (!path.isAbsolute(statePath)) {
    statePath = resolvePath(statePath);
  }

  const stateRaw = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(stateRaw);
  let effectiveOriginKind = normalizeLooseText(state?.origin?.kind);
  if (!effectiveOriginKind && state?.runId) {
    try {
      const artifacts = await readRunArtifacts(cfg, state.runId);
      effectiveOriginKind = normalizeLooseText(artifacts.run.origin?.kind);
    } catch {
      // Fallback auf Rohzustand.
    }
  }
  if (effectiveOriginKind === "legacy-source") {
    throw new Error(
      "Löschung ist für Legacy-Quellen blockiert. Bitte zuerst einen migrierten Run verwenden."
    );
  }
  const duplicatesRaw = Array.isArray(state.duplicates) ? state.duplicates : [];
  const confirmedOnly = duplicatesRaw.filter((entry) => {
    const status = normalizeLooseText(entry.duplicateStatus).toLowerCase();
    if (!status) {
      return true;
    }
    return status === "confirmed";
  });
  const uniqueById = new Map();
  for (const entry of confirmedOnly) {
    const id = String(entry.id ?? "").trim();
    if (!id) continue;
    if (!uniqueById.has(id)) uniqueById.set(id, entry);
  }
  const duplicates = [...uniqueById.values()];

  if (duplicates.length === 0) {
    throw new Error(
      `Keine bestätigten löschbaren Duplikate mit ID in ${statePath} gefunden.`
    );
  }

  const connection = await createScannerClientConnection(cfg);
  const client = connection.client;
  try {
    const target = connection.target;
    console.log(`Löschlauf gestartet auf Target: ${target.title} (${target.url})`);

    const result = await client.evaluate(buildDeleteExpression(duplicates));
    const rows = Array.isArray(result?.results) ? result.results : [];
    const successCount = rows.filter((row) => row.status === "deleted").length;

    console.log(`Bearbeitet: ${rows.length}`);
    console.log(`Erfolgreich gelöscht: ${successCount}`);
    console.log("\nLösch-Ergebnis:");
    console.log(
      tableFromRows(
        rows.map((row, index) => ({
          "#": index + 1,
          Name: row.name ?? "",
          Tracks: row.tracks ?? "",
          ID: row.id ?? "",
          Status: row.status ?? "",
        }))
      )
    );

    state.lastDeleteRun = {
      ranAt: new Date().toISOString(),
      requested: duplicates.length,
      deleted: successCount,
      resultRows: rows,
    };
    await persistExistingRunState(state, statePath);

    return {
      target,
      requested: duplicates.length,
      deleted: successCount,
      rows,
      statePath,
      runId: state.runId ?? "",
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command || command === "help" || command === "--help" || options.help) {
    printHelp();
    return;
  }

  const config = resolveConfig({
    host: options.host,
    port: options.port,
    targetPattern: options["target-pattern"],
    timeoutMs: options.timeout,
    outputDir: options["output-dir"],
    runId: options["run-id"],
    statePath: options["state-path"],
    hostAppPath: options["host-app-path"],
    appPath: options["app-path"],
    stateFile: options["state-file"],
    csvFile: options["csv-file"],
    analysisJsonFile: options["analysis-json-file"],
    analysisTrackCsvFile: options["analysis-track-csv-file"],
    analysisSummaryCsvFile: options["analysis-summary-csv-file"],
    deepAnalysis: !Boolean(options["no-deep-analysis"]),
    sidebarScrollStep: options["sidebar-step"],
    deepAnalysisWaitMs: options["deep-analysis-wait"],
    analysisMethod: options["analysis-method"],
    launchApp: options["no-launch-app"]
      ? false
      : options["launch-app"]
        ? true
        : undefined,
    autoRecoverCdp: options["no-auto-recover-cdp"] ? false : undefined,
    confirm: options.confirm,
  });

  if (command === "scan") {
    await runScan(config);
    return;
  }

  if (command === "discover") {
    await runDiscover({
      ...config,
      deepAnalysis: false,
    });
    return;
  }

  if (command === "analyze") {
    await runAnalyzeSelection(config);
    return;
  }

  if (command === "pause") {
    await requestRunPause(config.runId);
    return;
  }

  if (command === "list-legacy") {
    const result = await listLegacyRuns(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "migrate-legacy") {
    const result = await migrateLegacyRuns(config, {
      runIds: config.runId ? [config.runId] : [],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "export-zip") {
    const result = await exportRunZip(config, {
      runId: config.runId,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "delete") {
    await runDelete(config);
    return;
  }

  throw new Error(`Unbekannter Befehl: ${command}`);
}

function isDirectCliExecution() {
  const entryFile = process.argv[1];
  if (!entryFile) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryFile).href;
}

if (isDirectCliExecution()) {
  main().catch((error) => {
    console.error(`Fehler: ${error.message}`);
    if (String(error.message).includes("CDP-Endpunkt nicht erreichbar")) {
      console.error(
        "Hinweis: App-Shortcuts (Chromium/Helium) benötigen ggf. den Host-Browser mit aktivem --remote-debugging-port."
      );
    }
    process.exitCode = 1;
  });
}

export {
  main,
  CONFIRM_TEXT,
  DEFAULTS,
  getCacheStatus,
  rebuildCacheFromRuns,
  readCachedPlaylists,
  readCachedPlaylistDetails,
  exportCsvFromCache,
  listStoredRuns,
  listLegacyRuns,
  readRunPlaylists,
  readRunPlaylistDetails,
  requestRunPause,
  resolveConfig,
  resolveRunPaths,
  resolveStorageRoots,
  getRunMigrationInfo,
  exportRunZip,
  migrateLegacyRuns,
  runAnalyzeSelection,
  runDeltaSync,
  runDiscover,
  runScan,
  runDelete,
  compareVersions,
  isLegacyRunManifest,
  normalizeRunManifest,
  RunStore,
  parseHumanTrackCount,
  normalizeApiPlaylistRecord,
  normalizeApiTrackRecord,
  buildPlaylistSummaryFromTrackRows,
  buildDuplicateEntries,
  buildTrackFingerprint,
  sanitizeSensitiveText,
};
