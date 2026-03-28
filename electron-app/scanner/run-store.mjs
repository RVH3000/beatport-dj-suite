import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const RUN_SCHEMA_VERSION = 2;
const LEGACY_VERSION_CUTOFF = "1.1.0";
const RUN_CONTROLS = new Map();

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

function normalizeLooseText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePathInput(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const trimmed = String(value).trim();
  return trimmed.replace(/^['"]+|['"]+$/g, "");
}

function toIsoNow() {
  return new Date().toISOString();
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

function createRunId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}`;
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
        "auto",
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

async function overwriteMirroredJsonLines(archivePath, exportPath, rows) {
  const body = (Array.isArray(rows) ? rows : [])
    .map((row) => JSON.stringify(row))
    .join("\n");
  const content = body ? `${body}\n` : "";
  await writeMirroredFile(archivePath, exportPath, content);
}

async function ensureRunDirectories(runPaths) {
  await fs.mkdir(runPaths.archiveDir, { recursive: true });
  await fs.mkdir(runPaths.exportDir, { recursive: true });
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
        method: config.analysisMethod || "auto",
        selectedPlaylists: [],
        completedPlaylistRefs: [],
        currentPlaylistRef: null,
        totalSelected: 0,
        updatedAt: "",
      },
      networkHints: {
        preferredMethod: config.analysisMethod || "auto",
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
        method || this.run.analysisPlan.method || "auto",
    };
    this.run.status = "running";
    this.run.phase = "analysis";
    this.run.analysisPlan = {
      ...this.run.analysisPlan,
      method: method || this.run.analysisPlan.method || "auto",
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

export {
  RUN_SCHEMA_VERSION,
  LEGACY_VERSION_CUTOFF,
  RUN_CONTROLS,
  TRACK_CSV_HEADERS,
  SUMMARY_CSV_HEADERS,
  RunStore,
  compareVersions,
  createRunId,
  createDefaultOrigin,
  isCompatibleOperationalRun,
  pickPreferredCompatibleRun,
  isLegacyRunManifest,
  normalizeMigrationPayload,
  normalizeRunOrigin,
  mergeRunSnapshots,
  normalizeRunManifest,
  toPlaylistRef,
  getPlaylistIdentity,
  parseHumanTrackCount,
  normalizeLooseText,
  normalizePathInput,
  toIsoNow,
  derivePhaseFromStatus,
  getRunControl,
  clearRunControl,
  sanitizeSensitiveText,
  sanitizeSensitiveValue,
  sanitizeConfigForPersistence,
  normalizeTrackRow,
  normalizePlaylistSummary,
  buildTrackFingerprint,
  buildDuplicateEntries,
  buildDuplicateCsvRows,
  csvEscape,
  rowsToCsv,
  countListToString,
  createSummaryRowsForPlaylist,
  overwriteMirroredJsonLines,
  writeMirroredFile,
  appendMirroredFile,
  appendMirroredJsonLine,
  ensureRunDirectories,
  ensureDerivedRunArtifacts,
};
