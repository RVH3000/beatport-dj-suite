// ─── Tab-Module (lazy-loaded) ────────────────────────────────────────────────
let analysisModule = null;
let exportModule = null;
let playlistWizModule = null;
let syncModule = null;
let searchModule = null;
let automationModule = null;
let settingsModule = null;
let labelsModule = null;
let engineAnalyzeModule = null;
const PLAYLIST_WIZ_MUTATION_EVENT = "beatport-suite:playlist-wiz-mutated";

// ─── Tab-Navigation ─────────────────────────────────────────────────────────
(function initTabs() {
  const tabBar = document.querySelector(".tab-bar");
  if (!tabBar) return;

  tabBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;

    const targetId = btn.getAttribute("aria-controls");
    if (!targetId) return;

    // Deactivate all tabs + panels
    for (const tab of tabBar.querySelectorAll(".tab")) {
      tab.classList.remove("active");
      tab.setAttribute("aria-selected", "false");
    }
    for (const panel of document.querySelectorAll(".tab-panel")) {
      panel.classList.remove("active");
      panel.hidden = true;
    }

    // Activate selected
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    const panel = document.getElementById(targetId);
    if (panel) {
      panel.classList.add("active");
      panel.hidden = false;
    }

    // Lazy-load Tab-Module
    if (targetId === "tab-analyse") {
      loadAnalysisTab();
    } else if (targetId === "tab-export") {
      loadExportTab();
    } else if (targetId === "tab-playlist") {
      loadPlaylistWizTab();
    } else if (targetId === "tab-sync") {
      loadSyncTab();
    } else if (targetId === "tab-search") {
      loadSearchTab();
    } else if (targetId === "tab-automation") {
      loadAutomationTab();
    } else if (targetId === "tab-labels") {
      loadLabelsTab();
    } else if (targetId === "tab-engine-analyze") {
      loadEngineAnalyzeTab();
    } else if (targetId === "tab-settings") {
      loadSettingsTab();
    }
  });

  // Keyboard navigation (arrow keys within tab bar)
  tabBar.addEventListener("keydown", (e) => {
    const tabs = [...tabBar.querySelectorAll(".tab")];
    const idx = tabs.indexOf(e.target);
    if (idx === -1) return;

    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;

    if (next >= 0) {
      e.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    }
  });
})();

// ─── Workflow-Gruppen (Phase 1: 8 Tabs → 5 Gruppen) ──────────────────────────
(function initGroups() {
  const groupBar = document.querySelector(".group-bar");
  const tabBar = document.querySelector(".tab-bar");
  if (!groupBar || !tabBar) return;

  function showGroup(groupName) {
    // Group-Buttons aktualisieren
    for (const g of groupBar.querySelectorAll(".group")) {
      const active = g.dataset.group === groupName;
      g.classList.toggle("active", active);
      g.setAttribute("aria-selected", active ? "true" : "false");
    }
    // Sub-Tabs ein-/ausblenden + ersten der Gruppe aktivieren
    let firstVisible = null;
    for (const tab of tabBar.querySelectorAll(".tab")) {
      const inGroup = tab.dataset.group === groupName;
      tab.hidden = !inGroup;
      if (inGroup && !firstVisible) firstVisible = tab;
    }
    // Wenn aktuell aktiver Tab nicht in der Gruppe → ersten der Gruppe klicken
    const activeTab = tabBar.querySelector(".tab.active");
    if (!activeTab || activeTab.dataset.group !== groupName) {
      if (firstVisible) firstVisible.click();
    }
  }

  groupBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".group");
    if (!btn) return;
    showGroup(btn.dataset.group);
  });

  // Initial: Library-Gruppe
  showGroup("library");

  // Build → Builder: navigiert zu Explore → Suche → Builder Sub-Tab
  document.getElementById("buildSubBuilder")?.addEventListener("click", () => {
    showGroup("explore");
    setTimeout(() => {
      document.querySelector('.tab-bar .tab[data-tab="search"]')?.click();
      setTimeout(() => {
        document.querySelector('.srch-subtab[data-stab="srch-builder"]')?.click();
      }, 300);
    }, 100);
  });
})();

// ─── Library Sub-Tabs (v3.5.2) ───────────────────────────────────────────────
(function initLibrarySubTabs() {
  const nav = document.querySelector(".library-subnav");
  if (!nav) return;
  const scanner = document.getElementById("tab-scanner");
  if (!scanner) return;

  function show(name) {
    for (const btn of nav.querySelectorAll(".sub-tab")) {
      btn.classList.toggle("active", btn.dataset.libsub === name);
    }
    for (const sc of scanner.querySelectorAll(":scope > .sub-content")) {
      sc.classList.toggle("active", sc.dataset.libsub === name);
    }
  }

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".sub-tab");
    if (btn) show(btn.dataset.libsub);
  });

  show("scan");
})();

// ─── Scanner Tab Logic ──────────────────────────────────────────────────────
const STORAGE_KEYS = [
  "beatport-scanner-ui-config-v3",
  "beatport-scanner-ui-config-v2",
];
const STORAGE_KEY_WRITE = STORAGE_KEYS[0];

const state = {
  defaults: null,
  appInfo: null,
  authStatus: null,
  runs: [],
  filteredRuns: [],
  lastListing: null,
  lastScan: null,
  selectedRunId: "",
  runFilter: "all",
  activity: null,
  cacheStatus: null,
  cacheListing: null,
  cachePlaylists: [],
  cachePlaylistsLoading: false,
  cachePlaylistsError: "",
  cacheSyncPendingReason: "",
  cacheSelectedPlaylistIdentities: new Set(),
  pauseRequested: false,
  pollTimer: null,
  pollInFlight: false,
  runPlaylistsListing: null,
  runPlaylists: [],
  runPlaylistsLoading: false,
  runPlaylistsError: "",
  runPlaylistsToken: 0,
  playlistFilter: "",
  selectionDrafts: new Map(),
  selectedPlaylistIdentities: new Set(),
  selectedPlaylistRef: null,
  selectedPlaylistDetails: null,
  playlistDetailsLoading: false,
  playlistDetailsError: "",
  playlistDetailsToken: 0,
  runMigrationInfo: null,
  lastMigrationResult: null,
};

const els = {
  host: document.getElementById("host"),
  port: document.getElementById("port"),
  targetPattern: document.getElementById("targetPattern"),
  timeoutMs: document.getElementById("timeoutMs"),
  appPath: document.getElementById("appPath"),
  hostAppPath: document.getElementById("hostAppPath"),
  authMode: document.getElementById("authMode"),
  recoveryPolicy: document.getElementById("recoveryPolicy"),
  fallbackEnabled: document.getElementById("fallbackEnabled"),
  launchApp: document.getElementById("launchApp"),
  autoRecoverCdp: document.getElementById("autoRecoverCdp"),
  analysisMethod: document.getElementById("analysisMethod"),
  sidebarScrollStep: document.getElementById("sidebarScrollStep"),
  deepAnalysisWaitMs: document.getElementById("deepAnalysisWaitMs"),
  stateFile: document.getElementById("stateFile"),
  csvFile: document.getElementById("csvFile"),
  analysisJsonFile: document.getElementById("analysisJsonFile"),
  analysisTrackCsvFile: document.getElementById("analysisTrackCsvFile"),
  analysisSummaryCsvFile: document.getElementById("analysisSummaryCsvFile"),
  discoverBtn: document.getElementById("discoverBtn"),
  quickScanBtn: document.getElementById("quickScanBtn"),
  rebuildCacheBtn: document.getElementById("rebuildCacheBtn"),
  exportCacheCsvBtn: document.getElementById("exportCacheCsvBtn"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  resetBtn: document.getElementById("resetBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  refreshRunsBtn: document.getElementById("refreshRunsBtn"),
  migrateLegacyBtn: document.getElementById("migrateLegacyBtn"),
  exportZipBtn: document.getElementById("exportZipBtn"),
  openArchiveDirBtn: document.getElementById("openArchiveDirBtn"),
  openExportDirBtn: document.getElementById("openExportDirBtn"),
  openBeatportWindowBtn: document.getElementById("openBeatportWindowBtn"),
  authTestBtn: document.getElementById("authTestBtn"),
  authReconnectBtn: document.getElementById("authReconnectBtn"),
  authExportContextBtn: document.getElementById("authExportContextBtn"),
  runFilter: document.getElementById("runFilter"),
  selectionAllBtn: document.getElementById("selectionAllBtn"),
  selectionNoneBtn: document.getElementById("selectionNoneBtn"),
  selectionDuplicatesBtn: document.getElementById("selectionDuplicatesBtn"),
  selectionPendingBtn: document.getElementById("selectionPendingBtn"),
  playlistFilter: document.getElementById("playlistFilter"),
  confirmText: document.getElementById("confirmText"),
  status: document.getElementById("status"),
  cacheStatus: document.getElementById("cacheStatus"),
  appInfo: document.getElementById("appInfo"),
  authMeta: document.getElementById("authMeta"),
  authCallouts: document.getElementById("authCallouts"),
  appWarnings: document.getElementById("appWarnings"),
  appCopies: document.getElementById("appCopies"),
  runSelect: document.getElementById("runSelect"),
  runOverview: document.getElementById("runOverview"),
  runMeta: document.getElementById("runMeta"),
  outputFiles: document.getElementById("outputFiles"),
  migrationResult: document.getElementById("migrationResult"),
  selectionSummary: document.getElementById("selectionSummary"),
  selectionTableWrap: document.getElementById("selectionTableWrap"),
  duplicateTableWrap: document.getElementById("duplicateTableWrap"),
  analysisTableWrap: document.getElementById("analysisTableWrap"),
  playlistDetailSummary: document.getElementById("playlistDetailSummary"),
  playlistDetailMeta: document.getElementById("playlistDetailMeta"),
  playlistDetailTableWrap: document.getElementById("playlistDetailTableWrap"),
  deleteResultWrap: document.getElementById("deleteResultWrap"),
};

function readPersistedConfig() {
  for (const key of STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function writePersistedConfig(config) {
  localStorage.setItem(STORAGE_KEY_WRITE, JSON.stringify(config));
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-AT");
}

function setStatus(text, level = "idle") {
  els.status.textContent = text;
  els.status.className = `status ${level}`;
  persistLiveStatus(text, level);
}

function persistLiveStatus(text, level = "idle") {
  if (!window.scannerApi?.writeLiveStatus) {
    return;
  }
  const payload = {
    text: String(text ?? ""),
    level: String(level ?? "idle"),
    selectedRunId: state.selectedRunId || "",
    activityKind: state.activity?.kind || "",
    activityRunId: state.activity?.runId || "",
    sessionState: state.authStatus?.sessionState || "",
    currentUrl: state.authStatus?.currentUrl || "",
    cacheCounts: state.cacheStatus?.counts || null,
  };
  Promise.resolve(window.scannerApi.writeLiveStatus(payload)).catch(() => {});
}

function clearNode(node, message) {
  node.innerHTML = "";
  if (message) {
    node.classList.add("empty");
    node.textContent = message;
  } else {
    node.classList.remove("empty");
  }
}

function toTop(list, limit = 3) {
  if (!Array.isArray(list) || list.length === 0) return "";
  return list
    .slice(0, limit)
    .map((item) => `${item.value}:${item.count}`)
    .join(" | ");
}

function statusLabel(status, phase = "") {
  const normalized = normalizeText(status).toLowerCase();
  const normalizedPhase = normalizeText(phase).toLowerCase();
  if (normalized === "ready_for_analysis" || normalizedPhase === "ready_for_analysis") {
    return "bereit für Analyse";
  }
  if (normalized === "paused" || normalizedPhase === "paused") {
    return "pausiert";
  }
  if (normalized === "incomplete" || normalizedPhase === "incomplete") {
    return "unvollständig";
  }
  if (normalized === "completed" || normalizedPhase === "completed") {
    return "abgeschlossen";
  }
  if (normalized === "running" && normalizedPhase === "analysis") {
    return "Analyse läuft";
  }
  if (normalized === "running") {
    return "läuft";
  }
  return normalized || "–";
}

function originLabel(run) {
  const kind = normalizeText(run?.origin?.kind).toLowerCase();
  if (kind === "legacy-source") return "Legacy-Quelle";
  if (kind === "legacy-migrated") return "Migriert";
  return "Native";
}

function applyRunFilter(runs, filter) {
  const normalized = normalizeText(filter).toLowerCase() || "all";
  if (normalized === "all") return runs;
  if (normalized === "legacy") {
    return runs.filter((run) => run.origin?.kind === "legacy-source");
  }
  if (normalized === "migrated") {
    return runs.filter((run) => run.origin?.kind === "legacy-migrated");
  }
  if (normalized === "completed") {
    return runs.filter((run) => run.status === "completed");
  }
  if (normalized === "active") {
    return runs.filter((run) =>
      ["running", "paused", "ready_for_analysis", "incomplete"].includes(
        run.status
      )
    );
  }
  return runs;
}

function getSelectedRun() {
  return state.runs.find((run) => run.runId === state.selectedRunId) || null;
}

function getPlaylistIdentity(entry = {}) {
  const identity = normalizeText(entry.identity ?? "");
  if (identity) return identity;
  const id = normalizeText(entry.playlistId ?? entry.id ?? "").replace(/^ref-/, "");
  if (id) return id;
  const key = normalizeText(entry.key ?? "");
  if (key) return key;
  const name = normalizeText(entry.playlistName ?? entry.name ?? "");
  const tracks = normalizeText(
    entry.playlistTracksExpected ?? entry.tracks ?? ""
  );
  return name ? `${name}_${tracks}` : "";
}

function samePlaylistRef(left, right) {
  if (!left || !right) return false;
  if (normalizeText(left.runId) !== normalizeText(right.runId)) return false;
  const leftIdentity = getPlaylistIdentity(left);
  const rightIdentity = getPlaylistIdentity(right);
  if (leftIdentity && rightIdentity) {
    return leftIdentity === rightIdentity;
  }
  return (
    normalizeText(left.playlistName) === normalizeText(right.playlistName) &&
    normalizeText(left.playlistTracksExpected) ===
      normalizeText(right.playlistTracksExpected)
  );
}

function buildPlaylistRef(entry, runId, source) {
  return {
    runId: runId || "",
    source: source || "",
    identity: getPlaylistIdentity(entry),
    playlistId: normalizeText(entry?.playlistId ?? entry?.id ?? ""),
    playlistName: normalizeText(entry?.playlistName ?? entry?.name ?? ""),
    playlistTracksExpected: normalizeText(
      entry?.playlistTracksExpected ?? entry?.tracks ?? ""
    ),
    key: normalizeText(entry?.key ?? ""),
    cacheKey: normalizeText(entry?.cacheKey ?? ""),
    dataSource: normalizeText(entry?.source ?? entry?.analysisMethod ?? ""),
    trackFingerprint: normalizeText(entry?.trackFingerprint ?? ""),
    serverTrackCount: normalizeText(entry?.serverTrackCount ?? ""),
    syncState: normalizeText(entry?.syncState ?? ""),
    dirty: Number(entry?.dirty ?? 0) || 0,
  };
}

function getCurrentConfig() {
  const defaults = state.defaults;
  return {
    host: els.host.value.trim() || defaults.host,
    port: toInt(els.port.value, defaults.port),
    targetPattern: els.targetPattern.value.trim() || defaults.targetPattern,
    timeoutMs: toInt(els.timeoutMs.value, defaults.timeoutMs),
    appPath: els.appPath.value.trim() || defaults.appPath,
    hostAppPath: els.hostAppPath.value.trim() || defaults.hostAppPath,
    authMode: els.authMode.value.trim() || defaults.authMode || "internal",
    recoveryPolicy:
      els.recoveryPolicy.value.trim() ||
      defaults.recoveryPolicy ||
      "aggressive",
    fallbackEnabled: Boolean(els.fallbackEnabled.checked),
    keychainEnabled: false,
    autoLoginEnabled: false,
    beatportSessionPartition:
      defaults.beatportSessionPartition || "persist:beatport-auth-v1",
    launchApp: Boolean(els.launchApp.checked),
    autoRecoverCdp: Boolean(els.autoRecoverCdp.checked),
    analysisMethod:
      els.analysisMethod.value.trim() || defaults.analysisMethod || "auto",
    preferServerData: true,
    startupMode: "delta-live",
    analysisPolicy: "selected-only",
    parallelism: defaults.parallelism || 4,
    cacheEnabled: true,
    cacheDbPath: defaults.cacheDbPath || "",
    sidebarScrollStep: toInt(
      els.sidebarScrollStep.value,
      defaults.sidebarScrollStep
    ),
    deepAnalysisWaitMs: toInt(
      els.deepAnalysisWaitMs.value,
      defaults.deepAnalysisWaitMs
    ),
    stateFile: els.stateFile.value.trim() || defaults.stateFile,
    csvFile: els.csvFile.value.trim() || defaults.csvFile,
    analysisJsonFile:
      els.analysisJsonFile.value.trim() || defaults.analysisJsonFile,
    analysisTrackCsvFile:
      els.analysisTrackCsvFile.value.trim() || defaults.analysisTrackCsvFile,
    analysisSummaryCsvFile:
      els.analysisSummaryCsvFile.value.trim() || defaults.analysisSummaryCsvFile,
  };
}

function applyConfig(config) {
  els.host.value = config.host ?? "";
  els.port.value = String(config.port ?? "");
  els.targetPattern.value = config.targetPattern ?? "";
  els.timeoutMs.value = String(config.timeoutMs ?? "");
  els.appPath.value = config.appPath ?? "";
  els.hostAppPath.value = config.hostAppPath ?? "";
  els.authMode.value = config.authMode ?? "internal";
  els.recoveryPolicy.value = config.recoveryPolicy ?? "aggressive";
  els.fallbackEnabled.checked = config.fallbackEnabled !== false;
  els.launchApp.checked = config.launchApp !== false;
  els.autoRecoverCdp.checked = config.autoRecoverCdp !== false;
  els.analysisMethod.value = config.analysisMethod ?? "auto";
  els.sidebarScrollStep.value = String(config.sidebarScrollStep ?? "");
  els.deepAnalysisWaitMs.value = String(config.deepAnalysisWaitMs ?? "");
  els.stateFile.value = config.stateFile ?? "";
  els.csvFile.value = config.csvFile ?? "";
  els.analysisJsonFile.value = config.analysisJsonFile ?? "";
  els.analysisTrackCsvFile.value = config.analysisTrackCsvFile ?? "";
  els.analysisSummaryCsvFile.value = config.analysisSummaryCsvFile ?? "";
}

function getSelectionDraft(runId) {
  const stored = state.selectionDrafts.get(runId);
  return new Set(Array.isArray(stored) ? stored : []);
}

function persistSelectionDraft(runId, identities) {
  state.selectionDrafts.set(runId, [...new Set(identities.filter(Boolean))]);
}

function setCurrentSelectionDraft(identities) {
  const run = getSelectedRun();
  state.selectedPlaylistIdentities = new Set(
    [...new Set((identities || []).filter(Boolean))]
  );
  if (run?.runId) {
    persistSelectionDraft(run.runId, [...state.selectedPlaylistIdentities]);
  }
}

function getVisibleRunPlaylists() {
  const filter = normalizeText(state.playlistFilter).toLowerCase();
  if (!filter) return state.cachePlaylists;
  return state.cachePlaylists.filter((entry) => {
    const haystack = [
      entry.name,
      entry.id,
      entry.tracks,
      entry.source,
      entry.syncState,
      entry.identity,
      entry.key,
    ]
      .map((value) => normalizeText(value).toLowerCase())
      .join(" ");
    return haystack.includes(filter);
  });
}

function makeBadge(label, tone) {
  const span = document.createElement("span");
  span.className = `pill ${tone}`;
  span.textContent = label;
  return span;
}

function renderTable(node, rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    clearNode(node, options.emptyMessage || "Keine Einträge");
    return;
  }

  node.classList.remove("empty");
  const columns =
    Array.isArray(options.columns) && options.columns.length > 0
      ? options.columns
      : Object.keys(rows[0]).filter((column) => !column.startsWith("__"));
  const wrapColumns = new Set(options.wrapColumns || []);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const rowClickable = typeof options.onRowClick === "function";
    if (rowClickable) {
      tr.classList.add("table-row-clickable");
      tr.tabIndex = 0;
      tr.addEventListener("click", () => options.onRowClick(row, index));
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          options.onRowClick(row, index);
        }
      });
    }
    if (typeof options.isSelected === "function" && options.isSelected(row, index)) {
      tr.classList.add("is-selected");
    }

    columns.forEach((column) => {
      const td = document.createElement("td");
      const text = String(row[column] ?? "");
      td.textContent = text;
      td.title = text;
      if (
        wrapColumns.has(column) ||
        /^(Name|Playlist|Titel|Track|TopGenre|TopLabel|TopJahre|Release|Status)$/i.test(
          column
        )
      ) {
        td.classList.add("wrap-cell");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  node.innerHTML = "";
  node.appendChild(table);
}

function renderAppInfo(info) {
  state.appInfo = info;
  const items = [
    ["Version", info.version],
    ["Build-ID", info.buildId],
    ["App-Pfad", info.appPath],
    ["Exec-Pfad", info.execPath],
    ["Canonical", info.canonicalAppPath],
    ["User-Data", info.userDataPath],
    ["Live-Status", info.liveStatusPath],
  ];

  els.appInfo.innerHTML = items
    .map(
      ([label, value]) =>
        `<div><dt>${label}</dt><dd>${value ? String(value) : "–"}</dd></div>`
    )
    .join("");

  if (Array.isArray(info.warnings) && info.warnings.length > 0) {
    els.appWarnings.innerHTML = info.warnings
      .map((warning) => `<div class="callout warning">${warning}</div>`)
      .join("");
  } else {
    els.appWarnings.innerHTML =
      '<div class="callout success">Aktive Installation entspricht der aktuellen App.</div>';
  }

  if (Array.isArray(info.copies) && info.copies.length > 0) {
    els.appCopies.classList.remove("empty");
    els.appCopies.innerHTML = info.copies
      .map((entry) => `<div class="stack-item"><code>${entry}</code></div>`)
      .join("");
  } else {
    clearNode(els.appCopies, "Keine weiteren Installationen gefunden");
  }
}

function authModeLabel(value) {
  return normalizeText(value) === "external-fallback"
    ? "Externer Fallback"
    : "Interne Beatport-Session";
}

function sessionStateLabel(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "valid") return "angemeldet";
  if (normalized === "invalid") return "nicht angemeldet";
  if (normalized === "expired") return "Session abgelaufen";
  if (normalized === "recovering") return "Recovery läuft";
  return normalized || "unbekannt";
}

function renderAuthStatus(status = null) {
  state.authStatus = status;
  const items = [
    ["Modus", authModeLabel(status?.mode)],
    ["Session", sessionStateLabel(status?.sessionState)],
    ["Letzter Check", formatDate(status?.lastValidatedAt)],
    ["Passwortspeicherung", status?.passwordStorageEnabled ? "aktiv" : "deaktiviert"],
    ["Recovery", normalizeText(status?.recoveryPolicy) || "aggressive"],
    ["Fallback", status?.fallbackEnabled === false ? "aus" : "an"],
    ["Profil", normalizeText(status?.beatportSessionPartition) || "–"],
    ["Aktive URL", normalizeText(status?.currentUrl) || "–"],
  ];

  els.authMeta.innerHTML = items
    .map(
      ([label, value]) =>
        `<div><dt>${label}</dt><dd>${value ? String(value) : "–"}</dd></div>`
    )
    .join("");

  const callouts = [
    status?.sessionState === "valid"
      ? { tone: "success", text: "Interne Beatport-Session ist gültig und kann direkt für Scans verwendet werden." }
      : { tone: "warning", text: "Wenn die Session ungültig ist, öffnet die App nur das interne Beatport-Fenster zur Anmeldung. Die Scanner-App selbst wird dabei nicht neu gestartet." },
  ];
  if (normalizeText(status?.lastError)) {
    callouts.push({
      tone: "warning",
      text: `Letzter Hinweis: ${status.lastError}`,
    });
  }
  els.authCallouts.innerHTML = callouts
    .map((entry) => `<div class="callout ${entry.tone}">${entry.text}</div>`)
    .join("");
}

function renderCacheStatus() {
  if (!els.cacheStatus) return;
  if (state.cachePlaylistsLoading) {
    els.cacheStatus.classList.remove("empty");
    els.cacheStatus.textContent = "Lokaler Arbeitsbestand wird geladen ...";
    return;
  }
  if (state.cachePlaylistsError) {
    els.cacheStatus.classList.remove("empty");
    els.cacheStatus.textContent = `Cache-Fehler: ${state.cachePlaylistsError}`;
    return;
  }
  const counts = state.cacheStatus?.counts || {};
  const syncRows = Array.isArray(state.cacheStatus?.syncState)
    ? state.cacheStatus.syncState
    : [];
  const lastDeltaSync = syncRows.find((entry) => entry.key === "last_delta_sync_at");
  const lastRebuild = syncRows.find((entry) => entry.key === "last_rebuild_at");
  els.cacheStatus.classList.remove("empty");
  const parts = [
    `Cache Playlists ${counts.playlists ?? 0}`,
    `Tracks ${counts.tracks ?? 0}`,
    `Dirty ${counts.dirtyPlaylists ?? 0}`,
    `Analysiert ${counts.analyzedPlaylists ?? 0}`,
    `Kandidaten ${counts.duplicateCandidates ?? 0}`,
    `Bestätigt ${counts.duplicateConfirmed ?? 0}`,
    `Delta ${formatDate(lastDeltaSync?.value || "")}`,
    `Rebuild ${formatDate(lastRebuild?.value || "")}`,
  ];
  if (state.cacheSyncPendingReason) {
    parts.push(`Sync ausstehend ${state.cacheSyncPendingReason}`);
  }
  els.cacheStatus.textContent = parts.join(" | ");
}

function getActiveTabId() {
  return document.querySelector(".tab-panel.active")?.id || "";
}

function markCacheSyncPending(reason = "") {
  state.cacheSyncPendingReason = normalizeText(reason);
  renderCacheStatus();
}

function clearCacheSyncPending() {
  if (!state.cacheSyncPendingReason) {
    return;
  }
  state.cacheSyncPendingReason = "";
  renderCacheStatus();
}

function invalidateLazyTabData(reason = "", options = {}) {
  analysisModule?.forceReload?.(reason);
  exportModule?.forceReload?.(reason);
  if (options.includePlaylistWiz) {
    playlistWizModule?.forceReload?.(reason);
  }
}

async function reloadActiveLazyTab() {
  const activeTabId = getActiveTabId();
  if (activeTabId === "tab-analyse") {
    await loadAnalysisTab();
  } else if (activeTabId === "tab-export") {
    await loadExportTab();
  } else if (activeTabId === "tab-playlist") {
    await loadPlaylistWizTab();
  }
}

async function refreshDataViews(options = {}) {
  invalidateLazyTabData(options.reason || "", {
    includePlaylistWiz: options.includePlaylistWiz === true,
  });
  await refreshCacheStatus();
  await refreshCachePlaylists();
  await refreshRuns(options.preferredRunId ?? state.selectedRunId, {
    preserveDraft: options.preserveDraft !== false,
  });
  if (options.reloadActiveTab !== false) {
    await reloadActiveLazyTab();
  }
}

async function handlePlaylistWizMutation(detail = {}) {
  const reason =
    normalizeText(detail.summary || detail.reason) || "Playlist-Wiz Änderung";
  markCacheSyncPending(reason);
  invalidateLazyTabData(reason, { includePlaylistWiz: true });

  if (state.activity) {
    await reloadActiveLazyTab();
    setStatus(
      `${reason}. Lokaler Cache wird nach Abschluss der aktuellen Aktion aktualisiert.`,
      "idle"
    );
    return;
  }

  if (state.authStatus?.sessionState === "valid") {
    await runDiscovery();
    return;
  }

  await reloadActiveLazyTab();
  setStatus(
    `${reason}. Lokaler Cache ist veraltet; führe einen Delta-Sync aus, sobald die interne Session gültig ist.`,
    "idle"
  );
}

window.addEventListener(PLAYLIST_WIZ_MUTATION_EVENT, (event) => {
  handlePlaylistWizMutation(event.detail || {}).catch((error) => {
    console.error("[playlist-wiz] Sync-Folgefehler:", error);
    setStatus(
      `Playlist-Wiz Aktualisierung fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  });
});

function renderRunSelect() {
  els.runSelect.innerHTML = "";
  if (state.filteredRuns.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Keine Runs im aktuellen Filter";
    els.runSelect.appendChild(option);
    els.runSelect.disabled = true;
    return;
  }

  els.runSelect.disabled = false;
  state.filteredRuns.forEach((run) => {
    const option = document.createElement("option");
    option.value = run.runId;
    option.textContent = [
      formatDate(run.startedAt),
      originLabel(run),
      statusLabel(run.status, run.phase),
      `Playlists ${run.counts?.playlistsDiscovered ?? 0}`,
      `Duplikate ${run.counts?.duplicates ?? 0}`,
      `Analysiert ${run.counts?.analyzedPlaylists ?? 0}`,
    ].join(" | ");
    els.runSelect.appendChild(option);
  });

  if (
    !state.selectedRunId ||
    !state.filteredRuns.some((run) => run.runId === state.selectedRunId)
  ) {
    const preferredRunId = normalizeText(state.lastListing?.preferredRun?.runId);
    const preferredCompatible =
      state.filteredRuns.find((run) => run.runId === preferredRunId) || null;
    const preferred =
      preferredCompatible ||
      state.filteredRuns.find((run) =>
        ["running", "paused", "ready_for_analysis"].includes(run.status)
      ) ||
      state.filteredRuns.find((run) => run.status === "completed") ||
      state.filteredRuns[0];
    state.selectedRunId = preferred?.runId ?? "";
  }

  els.runSelect.value = state.selectedRunId;
}

function renderRunOverview() {
  const listing = state.lastListing || {};
  const current = getSelectedRun();
  const cards = [
    {
      label: "Letzter erfolgreicher Run",
      value: listing.lastSuccessfulRun
        ? `${formatDate(listing.lastSuccessfulRun.startedAt)} | ${listing.lastSuccessfulRun.runId}`
        : "–",
    },
    {
      label: "Letzter pausierter Run",
      value: listing.lastPausedRun
        ? `${formatDate(listing.lastPausedRun.startedAt)} | ${listing.lastPausedRun.runId}`
        : "–",
    },
    {
      label: "Letzter Legacy-Run",
      value: listing.lastLegacyRun
        ? `${formatDate(listing.lastLegacyRun.startedAt)} | ${listing.lastLegacyRun.runId}`
        : "–",
    },
    {
      label: "Letzter migrierter Run",
      value: listing.lastMigratedRun
        ? `${formatDate(listing.lastMigratedRun.startedAt)} | ${listing.lastMigratedRun.runId}`
        : "–",
    },
    {
      label: "Letzter unvollständiger Run",
      value: listing.lastIncompleteRun
        ? `${formatDate(listing.lastIncompleteRun.startedAt)} | ${listing.lastIncompleteRun.runId}`
        : "–",
    },
    {
      label: "Aktiver Run",
      value: current
        ? `${current.runId} | ${statusLabel(current.status, current.phase)} | ${current.files?.archiveDir ?? "–"}`
        : "–",
    },
  ];

  // Aktiver Run separat oben anzeigen
  const activeCard = cards.pop(); // letztes Element = "Aktiver Run"
  const activeEl = document.getElementById("activeRunSummary");
  if (activeEl) {
    activeEl.innerHTML = `<article class="run-card active"><h3>${activeCard.label}</h3><p>${activeCard.value}</p></article>`;
  }

  // History-Karten ins Accordion
  els.runOverview.innerHTML = cards
    .map(
      (entry) =>
        `<article class="run-card"><h3>${entry.label}</h3><p>${entry.value}</p></article>`
    )
    .join("");
}

function renderRunMeta() {
  const run = getSelectedRun();
  if (!run) {
    clearNode(els.runMeta, "Noch kein Run ausgewählt");
    return;
  }
  const migrationInfo = state.runMigrationInfo || {};

  const items = [
    ["Schema", String(migrationInfo.schemaVersion ?? run.schemaVersion ?? "–")],
    ["Herkunft", originLabel({ origin: migrationInfo.origin || run.origin })],
    ["Status", statusLabel(run.status, run.phase)],
    [
      "Discovery-Quelle",
      run.networkHints?.discoverySource ||
        run.networkHints?.detailSource ||
        run.analysisPlan?.method ||
        "–",
    ],
    ["Quell-Run", migrationInfo.migration?.sourceRunId || run.migration?.sourceRunId || "–"],
    ["Quell-Version", migrationInfo.migration?.sourceVersion || run.migration?.sourceVersion || "–"],
    ["Migriert am", (migrationInfo.migration?.migratedAt || run.migration?.migratedAt) ? formatDate(migrationInfo.migration?.migratedAt || run.migration?.migratedAt) : "–"],
    ["Export ZIP", run.files?.zipPath || migrationInfo.files?.zipPath || "noch nicht erstellt"],
  ];
  els.runMeta.classList.remove("empty");
  els.runMeta.innerHTML = "";

  const grid = document.createElement("dl");
  grid.className = "detail-grid";
  items.forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "detail-item";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "–";
    wrapper.append(dt, dd);
    grid.appendChild(wrapper);
  });
  els.runMeta.appendChild(grid);
}

function renderOutputFiles() {
  const run = getSelectedRun() || state.lastScan?.run || null;
  if (!run?.files) {
    els.outputFiles.innerHTML = "";
    els.openArchiveDirBtn.disabled = true;
    els.openExportDirBtn.disabled = true;
    return;
  }
  const zipPath = run.files.zipPath || state.runMigrationInfo?.files?.zipPath || "";

  const entries = [
    ["Archiv-Ordner", run.files.archiveDir, "folder"],
    ["Export-Ordner", run.files.exportDir, "folder"],
    ["Manifest", run.files.manifestPath, "file"],
    ["Summary", run.files.summaryPath, "file"],
    ["Events JSONL", run.files.eventsPath, "file"],
    ["Playlists JSONL", run.files.playlistsPath, "file"],
    ["Duplikate JSONL", run.files.duplicatesPath, "file"],
    ["Track-Analyse JSONL", run.files.trackAnalysisPath, "file"],
    ["State", run.files.statePath, "file"],
    ["Duplikat-CSV", run.files.csvPath, "file"],
    ["Analyse-JSON", run.files.analysisJsonPath, "file"],
    ["Track-CSV", run.files.analysisTrackCsvPath, "file"],
    ["Dimensionen-CSV", run.files.analysisSummaryCsvPath, "file"],
    ["Run-ZIP", zipPath, "file"],
  ].filter((entry) => entry[1]);

  els.outputFiles.innerHTML = "";
  entries.forEach(([label, filePath, kind]) => {
    const row = document.createElement("div");
    row.className = "file-item";

    const left = document.createElement("div");
    left.innerHTML = `<strong>${label}</strong><br /><code>${filePath}</code>`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent =
      kind === "folder" ? "Ordner öffnen" : "Im Finder zeigen";
    button.addEventListener("click", async () => {
      if (kind === "folder") {
        await window.scannerApi.openRunFolder(filePath);
      } else {
        await window.scannerApi.openPath(filePath);
      }
    });

    row.append(left, button);
    els.outputFiles.appendChild(row);
  });

  els.openArchiveDirBtn.disabled = !run.files.archiveDir;
  els.openExportDirBtn.disabled = !run.files.exportDir;
}

function renderPlaylistDetailSummary(title, subtitle) {
  els.playlistDetailSummary.classList.remove("empty");
  els.playlistDetailSummary.innerHTML = "";

  const card = document.createElement("div");
  card.className = "detail-card";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = subtitle;
  card.append(strong, paragraph);
  els.playlistDetailSummary.appendChild(card);
}

function renderPlaylistDetailMeta(items) {
  if (!Array.isArray(items) || items.length === 0) {
    clearNode(els.playlistDetailMeta, "");
    return;
  }

  els.playlistDetailMeta.classList.remove("empty");
  els.playlistDetailMeta.innerHTML = "";

  const grid = document.createElement("dl");
  grid.className = "detail-grid";
  items.forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "detail-item";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "–";
    wrapper.append(dt, dd);
    grid.appendChild(wrapper);
  });
  els.playlistDetailMeta.appendChild(grid);
}

function renderPlaylistDetailsPlaceholder(message) {
  clearNode(
    els.playlistDetailSummary,
    message || "Playlist anklicken, um den Inhalt zu sehen."
  );
  clearNode(els.playlistDetailMeta, "");
  clearNode(els.playlistDetailTableWrap, "Noch keine Playlist ausgewählt");
}

function renderPlaylistDetails() {
  if (!state.selectedPlaylistRef) {
    renderPlaylistDetailsPlaceholder(
      "Playlist in Discovery, Duplikaten oder Analyse anklicken, um den Inhalt zu sehen."
    );
    return;
  }

  const name =
    state.selectedPlaylistDetails?.playlistName ||
    state.selectedPlaylistRef.playlistName ||
    "Playlist";

  if (state.playlistDetailsLoading) {
    renderPlaylistDetailSummary(name, "Inhalt wird geladen ...");
    clearNode(els.playlistDetailMeta, "");
    clearNode(els.playlistDetailTableWrap, "Lade Playlist-Inhalt ...");
    return;
  }

  if (state.playlistDetailsError) {
    renderPlaylistDetailSummary(name, state.playlistDetailsError);
    clearNode(els.playlistDetailMeta, "");
    clearNode(
      els.playlistDetailTableWrap,
      "Playlist-Inhalt konnte nicht geladen werden"
    );
    return;
  }

  const details = state.selectedPlaylistDetails;
  const trackRows = Array.isArray(details?.trackRows) ? details.trackRows : [];
  const subtitle = [
    `Run ${details?.runId || state.selectedPlaylistRef.runId || "–"}`,
    `${statusLabel(details?.runStatus, "")}`,
    `Track-Zeilen ${trackRows.length}`,
  ].join(" | ");
  renderPlaylistDetailSummary(name, subtitle);

  renderPlaylistDetailMeta([
    ["Playlist-ID", details?.playlistId || state.selectedPlaylistRef.playlistId],
    [
      "Tracks Soll",
      details?.playlistTracksExpected ||
        state.selectedPlaylistRef.playlistTracksExpected,
    ],
    [
      "Tracks Ist",
      String(details?.summary?.analyzedTrackRows ?? trackRows.length ?? 0),
    ],
    ["Status", details?.summary?.status || (trackRows.length > 0 ? "ok" : "–")],
    ["Cache-Status", details?.summary?.syncState || state.selectedPlaylistRef.syncState || "–"],
    ["Dirty", String(details?.summary?.dirty ?? state.selectedPlaylistRef.dirty ?? 0)],
    ["Quelle", details?.summary?.source || details?.summary?.analysisMethod || state.selectedPlaylistRef.dataSource || "–"],
    ["Fingerprint", details?.summary?.trackFingerprint || state.selectedPlaylistRef.trackFingerprint || "–"],
    ["Top Genre", toTop(details?.summary?.genreCounts, 5) || "–"],
    ["Top Label", toTop(details?.summary?.labelCounts, 5) || "–"],
    ["Top Jahre", toTop(details?.summary?.yearCounts, 6) || "–"],
  ]);

  const rows = trackRows.map((entry) => ({
    "#": entry.trackIndex ?? "",
    TrackID: entry.trackId ?? "",
    Titel: entry.trackTitle ?? "",
    Artist: entry.artists ?? "",
    Genre: entry.genre ?? "",
    Label: entry.label ?? "",
    Jahr: entry.year ?? "",
    Release: entry.release ?? "",
    BPM: entry.bpm ?? "",
    Key: entry.key ?? "",
    Quelle: entry.source ?? "",
  }));
  renderTable(els.playlistDetailTableWrap, rows, {
    columns: [
      "#",
      "TrackID",
      "Titel",
      "Artist",
      "Genre",
      "Label",
      "Jahr",
      "Release",
      "BPM",
      "Key",
      "Quelle",
    ],
    wrapColumns: ["Titel", "Artist", "Genre", "Label", "Release"],
    emptyMessage:
      "Für diese Playlist liegen in diesem Run keine Trackdetails vor.",
  });
}

function renderRunResults() {
  const run = getSelectedRun();
  if (!run) {
    clearNode(els.duplicateTableWrap, "Noch kein Run");
    clearNode(els.analysisTableWrap, "Noch keine Analyse");
    if (state.selectedPlaylistRef?.runId === "cache") {
      renderPlaylistDetails();
    } else {
      renderPlaylistDetailsPlaceholder(
        "Playlist in Discovery, Duplikaten oder Analyse anklicken, um den Inhalt zu sehen."
      );
    }
    return;
  }

  const duplicateRows = (run.duplicates || []).map((entry, index) => ({
    "#": index + 1,
    Name: entry.name ?? "",
    Tracks: entry.serverTrackCount ?? entry.tracks ?? "",
    ID: entry.id ?? "",
    Status: entry.duplicateStatus ?? "",
    Quelle: entry.source ?? "",
    Fingerprint: entry.trackFingerprint ?? "",
    __playlistRef: buildPlaylistRef(entry, run.runId, "duplicate"),
  }));
  renderTable(els.duplicateTableWrap, duplicateRows, {
    columns: ["#", "Name", "Tracks", "ID", "Status", "Quelle", "Fingerprint"],
    wrapColumns: ["Name", "Fingerprint"],
    emptyMessage: "Keine Duplikate in diesem Run",
    onRowClick: (row) => selectPlaylist(row.__playlistRef),
    isSelected: (row) => samePlaylistRef(row.__playlistRef, state.selectedPlaylistRef),
  });

  const summaries = Array.isArray(run.playlistSummaries) ? run.playlistSummaries : [];
  if (summaries.length === 0) {
    let message = "Noch keine Analyse";
    if (run.status === "ready_for_analysis") {
      message = "Discovery abgeschlossen. Tiefenanalyse noch nicht gestartet.";
    } else if (run.status === "paused") {
      message = "Analyse pausiert. Resume oder neue Auswahl starten.";
    } else if (run.status === "running") {
      message = "Analyse läuft. Ergebnisse werden fortlaufend ergänzt.";
    } else if (run.status === "incomplete") {
      message = "Lauf unvollständig. Bereits erfasste Daten bleiben erhalten.";
    }
    clearNode(els.analysisTableWrap, message);
  } else {
    const analysisRows = summaries.map((entry, index) => ({
      "#": index + 1,
      Playlist: entry.playlistName ?? "",
      TracksSoll: entry.playlistTracksExpected ?? "",
      TracksIst: entry.analyzedTrackRows ?? "",
      Genres: Array.isArray(entry.genreCounts) ? entry.genreCounts.length : 0,
      Labels: Array.isArray(entry.labelCounts) ? entry.labelCounts.length : 0,
      Jahre: Array.isArray(entry.yearCounts) ? entry.yearCounts.length : 0,
      TopGenre: toTop(entry.genreCounts, 3),
      TopLabel: toTop(entry.labelCounts, 3),
      TopJahre: toTop(entry.yearCounts, 4),
      Fingerprint: entry.trackFingerprint ?? "",
      Methode: entry.analysisMethod ?? "–",
      Status: entry.status ?? "",
      __playlistRef: buildPlaylistRef(entry, run.runId, "analysis"),
    }));
    renderTable(els.analysisTableWrap, analysisRows, {
      columns: [
        "#",
        "Playlist",
        "TracksSoll",
        "TracksIst",
        "Genres",
        "Labels",
        "Jahre",
        "TopGenre",
        "TopLabel",
        "TopJahre",
        "Fingerprint",
        "Methode",
        "Status",
      ],
      wrapColumns: [
        "Playlist",
        "TopGenre",
        "TopLabel",
        "TopJahre",
        "Fingerprint",
        "Status",
      ],
      onRowClick: (row) => selectPlaylist(row.__playlistRef),
      isSelected: (row) => samePlaylistRef(row.__playlistRef, state.selectedPlaylistRef),
    });
  }

  if (
    !state.selectedPlaylistRef ||
    (state.selectedPlaylistRef.runId !== run.runId &&
      state.selectedPlaylistRef.runId !== "cache")
  ) {
    renderPlaylistDetailsPlaceholder(
      "Playlist in Discovery, Duplikaten oder Analyse anklicken, um den Inhalt zu sehen."
    );
    return;
  }

  renderPlaylistDetails();
}

function renderDeleteResult(result) {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const displayRows = rows.map((entry, index) => ({
    "#": index + 1,
    Name: entry.name ?? "",
    Tracks: entry.tracks ?? "",
    ID: entry.id ?? "",
    Status: entry.status ?? "",
  }));
  renderTable(els.deleteResultWrap, displayRows, {
    columns: ["#", "Name", "Tracks", "ID", "Status"],
    wrapColumns: ["Name", "Status"],
    emptyMessage: "Keine Löschaktionen protokolliert",
  });
}

function renderMigrationResult() {
  const result = state.lastMigrationResult;
  if (!result) {
    clearNode(els.migrationResult, "Noch keine Migration ausgeführt");
    return;
  }

  const rows = (result.results || []).map((entry, index) => ({
    "#": index + 1,
    Quelle: entry.sourceRunId ?? "",
    Ziel: entry.migratedRunId ?? "",
    Status: entry.status ?? "",
  }));
  renderTable(els.migrationResult, rows, {
    columns: ["#", "Quelle", "Ziel", "Status"],
    wrapColumns: ["Quelle", "Ziel", "Status"],
    emptyMessage: "Keine Migrationsergebnisse vorhanden",
  });
}

function renderSelectionSummary(visibleRows) {
  if (!state.cacheStatus && state.cachePlaylists.length === 0) {
    clearNode(
      els.selectionSummary,
      "Cache laden, um Playlists für die Tiefenanalyse auszuwählen."
    );
    return;
  }

  const selectedCount = visibleRows.filter((entry) =>
    state.cacheSelectedPlaylistIdentities.has(entry.identity || entry.cacheKey)
  ).length;
  const counts = state.cacheStatus?.counts || {};
  const summaryCards = [
    ["Quelle", "Cache"],
    ["Playlists gesamt", String(state.cachePlaylists.length)],
    ["Sichtbar", String(visibleRows.length)],
    [
      "Ausgewählt",
      `${state.cacheSelectedPlaylistIdentities.size} gesamt / ${selectedCount} sichtbar`,
    ],
    [
      "Dirty",
      String(counts.dirtyPlaylists ?? 0),
    ],
    [
      "Analysiert",
      String(counts.analyzedPlaylists ?? 0),
    ],
    [
      "Kandidaten",
      String(counts.duplicateCandidates ?? 0),
    ],
    [
      "Bestätigt",
      String(counts.duplicateConfirmed ?? 0),
    ],
    [
      "Methode",
      state.defaults?.analysisMethod || "auto",
    ],
  ];

  els.selectionSummary.classList.remove("empty");
  els.selectionSummary.innerHTML =
    '<div class="selection-summary-grid"></div>';
  const grid = els.selectionSummary.querySelector(".selection-summary-grid");
  summaryCards.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "selection-summary-card";
    card.innerHTML = `<span class="pill-label">${label}</span><strong>${value || "–"}</strong>`;
    grid.appendChild(card);
  });
}

function renderPlaylistSelection() {
  if (state.cachePlaylistsLoading) {
    renderSelectionSummary([]);
    clearNode(els.selectionTableWrap, "Playlistliste wird geladen ...");
    return;
  }

  if (state.cachePlaylistsError) {
    renderSelectionSummary([]);
    clearNode(
      els.selectionTableWrap,
      `Playlists konnten nicht geladen werden: ${state.cachePlaylistsError}`
    );
    return;
  }

  if (state.cachePlaylists.length === 0) {
    renderSelectionSummary([]);
    clearNode(
      els.selectionTableWrap,
      "Der Cache enthält noch keine Playlists."
    );
    return;
  }

  const visibleRows = getVisibleRunPlaylists();
  renderSelectionSummary(visibleRows);

  if (visibleRows.length === 0) {
    clearNode(
      els.selectionTableWrap,
      "Keine Playlists passen auf den aktuellen Filter."
    );
    return;
  }

  const disableSelection = Boolean(state.activity);

  els.selectionTableWrap.classList.remove("empty");
  els.selectionTableWrap.innerHTML = "";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["", "Name", "Tracks", "ID", "Quelle", "Status"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  visibleRows.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.className = "selection-row";
    const cacheIdentity = entry.identity || entry.cacheKey;
    const isSelected = state.cacheSelectedPlaylistIdentities.has(cacheIdentity);
    if (entry.isAnalyzed) tr.classList.add("is-analyzed");
    if (normalizeText(entry.syncState).toLowerCase() === "current") tr.classList.add("is-current");
    if (entry.isDuplicate) tr.classList.add("is-duplicate");
    if (
      samePlaylistRef(
        buildPlaylistRef(entry, "cache", "cache-selection"),
        state.selectedPlaylistRef
      )
    ) {
      tr.classList.add("is-focused");
    }

    tr.tabIndex = 0;
    tr.addEventListener("click", () =>
      selectPlaylist(buildPlaylistRef(entry, "cache", "cache-selection"))
    );
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPlaylist(buildPlaylistRef(entry, "cache", "cache-selection"));
      }
    });

    const tdCheckbox = document.createElement("td");
    tdCheckbox.className = "selection-checkbox";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isSelected;
    checkbox.disabled = disableSelection;
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", (event) => {
      const next = new Set(state.cacheSelectedPlaylistIdentities);
      if (event.target.checked) {
        next.add(cacheIdentity);
      } else {
        next.delete(cacheIdentity);
      }
      state.cacheSelectedPlaylistIdentities = new Set(next);
      renderPlaylistSelection();
      updateActionButtons();
    });
    tdCheckbox.appendChild(checkbox);

    const tdName = document.createElement("td");
    tdName.className = "selection-name";
    tdName.textContent = entry.name || "(ohne Namen)";
    tdName.title = entry.name || "";

    const tdTracks = document.createElement("td");
    tdTracks.textContent = entry.tracks || "";

    const tdId = document.createElement("td");
    tdId.textContent = entry.id || "";
    tdId.title = entry.id || "";

    const tdSource = document.createElement("td");
    tdSource.textContent = normalizeText(entry.source || "–");

    const tdStatus = document.createElement("td");
    const statusWrap = document.createElement("div");
    statusWrap.className = "selection-status";
    statusWrap.appendChild(makeBadge(isSelected ? "ausgewählt" : "nicht gewählt", "pending"));
    if (entry.isDuplicate) statusWrap.appendChild(makeBadge("Duplikat", "duplicate"));
    if (entry.isAnalyzed) statusWrap.appendChild(makeBadge("analysiert", "analyzed"));
    if (entry.syncState) {
      statusWrap.appendChild(makeBadge(entry.syncState, "current"));
    }
    if (normalizeText(entry.source)) {
      statusWrap.appendChild(makeBadge(entry.source, "current"));
    }
    tdStatus.appendChild(statusWrap);

    tr.append(tdCheckbox, tdName, tdTracks, tdId, tdSource, tdStatus);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  els.selectionTableWrap.appendChild(table);
}

function updateDeleteButtonState() {
  const defaults = state.defaults;
  const selectedRun = getSelectedRun();
  if (!defaults) {
    els.deleteBtn.disabled = true;
    return;
  }

  const hasConfirm =
    els.confirmText.value.trim() === (defaults.confirmText || "LÖSCHEN BESTÄTIGT");
  const isCompleted = selectedRun?.status === "completed";
  const isLegacySource = selectedRun?.origin?.kind === "legacy-source";
  const isBusy = Boolean(state.activity);
  els.deleteBtn.disabled = !isCompleted || !hasConfirm || isBusy || isLegacySource;
}

function updateActionButtons() {
  const selectedRun = getSelectedRun();
  const isBusy = Boolean(state.activity);
  const hasLegacyRuns = state.runs.some((run) => run.origin?.kind === "legacy-source");
  const selectedRows = state.cachePlaylists.filter((entry) =>
    state.cacheSelectedPlaylistIdentities.has(entry.identity || entry.cacheKey)
  );
  const hasSelected = selectedRows.length > 0;
  const hasPendingSelection = selectedRows.some(
    (entry) => !entry.isAnalyzed || Number(entry.dirty || 0) > 0
  );
  const canAnalyze =
    hasSelected &&
    (hasPendingSelection || Boolean(selectedRun?.status === "paused"));

  els.discoverBtn.disabled = isBusy;
  els.quickScanBtn.disabled = isBusy;
  els.rebuildCacheBtn.disabled = isBusy;
  els.exportCacheCsvBtn.disabled = isBusy || state.cachePlaylists.length === 0;
  els.analyzeBtn.disabled = isBusy || !canAnalyze;
  els.resumeBtn.disabled = isBusy || selectedRun?.status !== "paused";
  els.pauseBtn.disabled =
    !(state.activity?.kind === "analysis") || state.pauseRequested;
  els.resetBtn.disabled = false;
  els.openBeatportWindowBtn.disabled = isBusy;
  els.authTestBtn.disabled = isBusy;
  els.authReconnectBtn.disabled = isBusy;
  els.authExportContextBtn.disabled = isBusy;
  els.migrateLegacyBtn.disabled = isBusy || !hasLegacyRuns;
  els.exportZipBtn.disabled = isBusy || !selectedRun?.runId;
  els.selectionAllBtn.disabled = isBusy || state.cachePlaylists.length === 0;
  els.selectionNoneBtn.disabled = isBusy || state.cachePlaylists.length === 0;
  els.selectionDuplicatesBtn.disabled =
    isBusy || state.cachePlaylists.length === 0;
  els.selectionPendingBtn.disabled = isBusy || state.cachePlaylists.length === 0;

  updateDeleteButtonState();
}

function stopRunPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function describeRunProgress(run) {
  if (!run) {
    return "Run wird gestartet ...";
  }
  const parts = [
    `Run ${run.runId}`,
    statusLabel(run.status, run.phase),
    `Playlists ${run.counts?.playlistsDiscovered ?? 0}`,
    `Duplikate ${run.counts?.duplicates ?? 0}`,
    `Analysiert ${run.counts?.analyzedPlaylists ?? 0}`,
    `Track-Zeilen ${run.counts?.analyzedTrackRows ?? 0}`,
  ];
  if (run.analysisPlan?.currentPlaylistRef?.name) {
    parts.push(`Aktuell ${run.analysisPlan.currentPlaylistRef.name}`);
  }
  if (state.pauseRequested) {
    parts.push("Pause angefordert");
  }
  return parts.join(" | ");
}

function startRunPolling() {
  stopRunPolling();
  state.pollTimer = window.setInterval(async () => {
    if (!state.activity) {
      stopRunPolling();
      return;
    }
    if (state.pollInFlight) {
      return;
    }
    state.pollInFlight = true;
    try {
      await refreshRuns(state.activity.runId || state.selectedRunId, {
        preserveDraft: true,
      });
      const run =
        state.runs.find((entry) => entry.runId === state.activity?.runId) ||
        state.runs.find((entry) => entry.status === "running") ||
        getSelectedRun();
      setStatus(describeRunProgress(run), "running");
    } catch {
      // Polling darf den eigentlichen Lauf nicht stören.
    } finally {
      state.pollInFlight = false;
    }
  }, 2000);
}

async function refreshAuthStatus() {
  if (!window.authApi) {
    return;
  }
  const status = await window.authApi.getStatus(getCurrentConfig());
  renderAuthStatus(status);
}

async function refreshCacheStatus() {
  const status = await window.scannerApi.getCacheStatus(getCurrentConfig());
  state.cacheStatus = status;
  renderCacheStatus();
}

async function refreshCachePlaylists(options = {}) {
  state.cachePlaylistsLoading = true;
  state.cachePlaylistsError = "";
  renderCacheStatus();
  renderPlaylistSelection();
  updateActionButtons();
  try {
    const listing = await window.scannerApi.listCachedPlaylists(getCurrentConfig());
    state.cacheListing = listing;
    state.cachePlaylists = Array.isArray(listing.playlists) ? listing.playlists : [];
    state.cacheStatus = listing.status || state.cacheStatus;
    const available = new Set(
      state.cachePlaylists.map((entry) => entry.identity || entry.cacheKey)
    );
    const nextSelection = [...state.cacheSelectedPlaylistIdentities].filter((entry) =>
      available.has(entry)
    );
    if (nextSelection.length === 0) {
      const pending = state.cachePlaylists
        .filter((entry) => !entry.isAnalyzed || Number(entry.dirty || 0) > 0)
        .map((entry) => entry.identity || entry.cacheKey);
      const fallback = pending.length
        ? pending
        : state.cachePlaylists.map((entry) => entry.identity || entry.cacheKey);
      state.cacheSelectedPlaylistIdentities = new Set(fallback);
    } else {
      state.cacheSelectedPlaylistIdentities = new Set(nextSelection);
    }
  } catch (error) {
    state.cacheListing = null;
    state.cachePlaylists = [];
    state.cachePlaylistsError = String(error.message || error);
  } finally {
    state.cachePlaylistsLoading = false;
    renderCacheStatus();
    renderPlaylistSelection();
    updateActionButtons();
  }
}

async function refreshAppInfo() {
  const info = await window.scannerApi.getAppInfo();
  renderAppInfo(info);
}

async function refreshRunMigrationInfo(runId) {
  if (!runId) {
    state.runMigrationInfo = null;
    renderRunMeta();
    return;
  }
  try {
    state.runMigrationInfo = await window.scannerApi.getRunMigrationInfo(
      getCurrentConfig(),
      { runId }
    );
  } catch {
    state.runMigrationInfo = null;
  }
  renderRunMeta();
}

async function loadRunPlaylists(runId, options = {}) {
  const preserveDraft = options.preserveDraft !== false;
  state.runPlaylistsToken += 1;
  const requestToken = state.runPlaylistsToken;

  if (!runId) {
    state.runPlaylistsListing = null;
    state.runPlaylists = [];
    state.runPlaylistsError = "";
    state.runPlaylistsLoading = false;
    state.selectedPlaylistIdentities = new Set();
    renderPlaylistSelection();
    updateActionButtons();
    return;
  }

  state.runPlaylistsLoading = true;
  state.runPlaylistsError = "";
  renderPlaylistSelection();
  updateActionButtons();

  try {
    const listing = await window.scannerApi.getRunPlaylists(getCurrentConfig(), {
      runId,
    });
    if (requestToken !== state.runPlaylistsToken) {
      return;
    }
    state.runPlaylistsListing = listing;
    state.runPlaylists = Array.isArray(listing.playlists) ? listing.playlists : [];

    const available = new Set(state.runPlaylists.map((entry) => entry.identity));
    let selected = [];
    if (preserveDraft && state.selectionDrafts.has(runId)) {
      selected = state.selectionDrafts
        .get(runId)
        .filter((identity) => available.has(identity));
    } else {
      selected = state.runPlaylists
        .filter((entry) => entry.isSelected)
        .map((entry) => entry.identity);
      if (selected.length === 0) {
        selected = state.runPlaylists.map((entry) => entry.identity);
      }
    }

    setCurrentSelectionDraft(selected);
  } catch (error) {
    if (requestToken !== state.runPlaylistsToken) {
      return;
    }
    state.runPlaylistsListing = null;
    state.runPlaylists = [];
    state.runPlaylistsError = String(error.message || error);
    state.selectedPlaylistIdentities = new Set();
  } finally {
    if (requestToken === state.runPlaylistsToken) {
      state.runPlaylistsLoading = false;
      renderPlaylistSelection();
      updateActionButtons();
    }
  }
}

async function refreshRuns(preferredRunId = "", options = {}) {
  const listing = await window.scannerApi.listRuns(getCurrentConfig());
  state.lastListing = listing;
  state.runs = Array.isArray(listing.runs) ? listing.runs : [];
  state.filteredRuns = applyRunFilter(state.runs, state.runFilter);

  if (preferredRunId) {
    state.selectedRunId = preferredRunId;
  }

  if (
    state.selectedPlaylistRef &&
    !state.runs.some((run) => run.runId === state.selectedPlaylistRef.runId)
  ) {
    state.selectedPlaylistRef = null;
    state.selectedPlaylistDetails = null;
    state.playlistDetailsError = "";
    state.playlistDetailsLoading = false;
  }

  renderRunSelect();
  renderRunOverview();
  await refreshRunMigrationInfo(state.selectedRunId);
  renderOutputFiles();
  renderMigrationResult();
  renderRunResults();
  renderOutputFiles();
  renderRunResults();
  updateActionButtons();
}

async function autoPrepareRunsOnStartup() {
  const config = getCurrentConfig();
  let migrationResult = null;
  if (config.autoMigrateLegacyRuns !== false) {
    const legacyListing = await window.scannerApi.listLegacyRuns(config);
    if (legacyListing.total > 0) {
      migrationResult = await window.scannerApi.migrateLegacyRuns(config, {});
      state.lastMigrationResult = migrationResult;
    }
  }
  const listing = await window.scannerApi.listRuns(config);
  const preferredRunId = normalizeText(listing.preferredRun?.runId);
  return {
    listing,
    preferredRunId,
    migrationResult,
  };
}

async function selectPlaylist(playlistRef) {
  if (!playlistRef?.runId) {
    return;
  }

  state.selectedPlaylistRef = playlistRef;
  state.selectedPlaylistDetails = null;
  state.playlistDetailsError = "";
  state.playlistDetailsLoading = true;
  state.playlistDetailsToken += 1;
  const requestToken = state.playlistDetailsToken;

  renderRunResults();
  renderPlaylistSelection();

  try {
    const details =
      playlistRef.runId === "cache"
        ? await window.scannerApi.getCachedPlaylistDetails(getCurrentConfig(), playlistRef)
        : await window.scannerApi.getPlaylistDetails(getCurrentConfig(), playlistRef);
    if (requestToken !== state.playlistDetailsToken) {
      return;
    }
    state.selectedPlaylistDetails = details;
    state.playlistDetailsError = "";
  } catch (error) {
    if (requestToken !== state.playlistDetailsToken) {
      return;
    }
    state.selectedPlaylistDetails = null;
    state.playlistDetailsError = String(error.message || error);
  } finally {
    if (requestToken === state.playlistDetailsToken) {
      state.playlistDetailsLoading = false;
      renderRunResults();
      renderPlaylistSelection();
    }
  }
}

function setActivity(kind, runId = "") {
  state.activity = { kind, runId };
  state.pauseRequested = false;
  startRunPolling();
  updateActionButtons();
  showScanProgress(kind);
}

function clearActivity() {
  state.activity = null;
  state.pauseRequested = false;
  stopRunPolling();
  updateActionButtons();
  hideScanProgress();
}

function showScanProgress(kind) {
  const wrap = document.getElementById("scanProgress");
  const fill = document.getElementById("scanProgressFill");
  const text = document.getElementById("scanProgressText");
  if (!wrap) return;
  const labels = { "delta-sync": "Delta-Sync", quickscan: "Komplettlauf", "cache-rebuild": "Cache-Rebuild" };
  wrap.style.display = "";
  fill.style.width = "100%";
  fill.style.animation = "scanPulse 1.5s ease-in-out infinite";
  text.textContent = `${labels[kind] || kind} läuft ...`;
}

function hideScanProgress() {
  const wrap = document.getElementById("scanProgress");
  const fill = document.getElementById("scanProgressFill");
  if (!wrap) return;
  fill.style.animation = "";
  fill.style.width = "100%";
  setTimeout(() => { wrap.style.display = "none"; }, 600);
}

function currentSelectionPayload() {
  const selected = state.cachePlaylists
    .filter((entry) =>
      state.cacheSelectedPlaylistIdentities.has(entry.identity || entry.cacheKey)
    )
    .map((entry) => ({
      id: entry.id ?? "",
      name: entry.name ?? "",
      tracks: entry.tracks ?? "",
      key: entry.key ?? "",
    }));
  return selected;
}

async function runDiscovery() {
  if (state.activity) return;

  const config = {
    ...getCurrentConfig(),
    deepAnalysis: false,
  };
  writePersistedConfig(config);
  setActivity("delta-sync");
  setStatus("Delta-Sync läuft. Cache und Archiv werden fortlaufend aktualisiert ...", "running");

  try {
    const result = await window.scannerApi.deltaSync(config);
    state.lastScan = result;
    state.selectedRunId = result.run?.runId ?? state.selectedRunId;
    if (state.activity) {
      state.activity.runId = state.selectedRunId;
    }
    state.selectedPlaylistRef = null;
    state.selectedPlaylistDetails = null;
    state.playlistDetailsError = "";
    state.playlistDetailsLoading = false;
    await refreshAppInfo();
    clearCacheSyncPending();
    await refreshDataViews({
      reason: "delta-sync",
      preferredRunId: state.selectedRunId,
      preserveDraft: false,
    });
    setStatus(
      [
        "Delta-Sync abgeschlossen.",
        `Run ${result.run?.runId ?? "–"}`,
        `Cache Playlists ${result.cacheStatus?.counts?.playlists ?? state.cacheStatus?.counts?.playlists ?? 0}`,
        `Dirty ${result.cacheStatus?.counts?.dirtyPlaylists ?? state.cacheStatus?.counts?.dirtyPlaylists ?? 0}`,
        `Duplikate ${result.run?.counts?.duplicates ?? result.duplicates?.length ?? 0}`,
      ].join(" | "),
      "success"
    );
  } catch (error) {
    setStatus(
      `Delta-Sync fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
    await refreshRuns(state.selectedRunId, { preserveDraft: true });
  } finally {
    clearActivity();
  }
}

async function runQuickScan() {
  if (state.activity) return;

  const config = {
    ...getCurrentConfig(),
    deepAnalysis: true,
  };
  writePersistedConfig(config);
  setActivity("quickscan");
  setStatus("Komplettlauf läuft. Discovery und Tiefenanalyse schreiben live in den Run-Ordner ...", "running");

  try {
    const result = await window.scannerApi.scan(config);
    state.lastScan = result;
    state.selectedRunId = result.run?.runId ?? state.selectedRunId;
    if (state.activity) {
      state.activity.runId = state.selectedRunId;
    }
    state.selectedPlaylistRef = null;
    state.selectedPlaylistDetails = null;
    state.playlistDetailsError = "";
    state.playlistDetailsLoading = false;
    await refreshAppInfo();
    clearCacheSyncPending();
    await refreshDataViews({
      reason: "quick-scan",
      preferredRunId: state.selectedRunId,
      preserveDraft: false,
    });

    if (result.paused) {
      setStatus(
        [
          "Komplettlauf pausiert.",
          `Run ${result.run?.runId ?? "–"}`,
          `Analysiert ${result.run?.counts?.analyzedPlaylists ?? 0}`,
          `Track-Zeilen ${result.run?.counts?.analyzedTrackRows ?? 0}`,
        ].join(" | "),
        "running"
      );
      return;
    }

    setStatus(
      [
        "Komplettlauf abgeschlossen.",
        `Run ${result.run?.runId ?? "–"}`,
        `Playlists ${result.run?.counts?.playlistsDiscovered ?? result.playlists?.length ?? 0}`,
        `Duplikate ${result.run?.counts?.duplicates ?? result.duplicates?.length ?? 0}`,
        `Analysiert ${result.run?.counts?.analyzedPlaylists ?? 0}`,
        `Track-Zeilen ${result.run?.counts?.analyzedTrackRows ?? 0}`,
      ].join(" | "),
      "success"
    );
  } catch (error) {
    setStatus(
      `Komplettlauf fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
    await refreshDataViews({
      reason: "quick-scan-error",
      preferredRunId: state.selectedRunId,
      preserveDraft: true,
    });
  } finally {
    clearActivity();
  }
}

async function runAnalyzeSelection(options = {}) {
  if (state.activity) return;

  const selectedRun = getSelectedRun();
  if (options.resume && !selectedRun?.runId) {
    setStatus("Resume blockiert: Kein pausierter Run ausgewählt.", "error");
    return;
  }
  if (options.resume && selectedRun.origin?.kind === "legacy-source") {
    setStatus(
      "Analyse blockiert: Legacy-Quellen zuerst migrieren.",
      "error"
    );
    return;
  }

  const selection = options.resume ? [] : currentSelectionPayload();
  if (!options.resume && selection.length === 0) {
    setStatus("Analyse blockiert: Keine Playlists ausgewählt.", "error");
    return;
  }

  const config = {
    ...getCurrentConfig(),
    deepAnalysis: true,
  };
  if (options.resume) {
    config.runId = selectedRun.runId;
  }
  if (!options.resume) {
    config.selectedPlaylists = selection;
  }

  writePersistedConfig(config);
  setActivity("analysis", selectedRun.runId);
  setStatus(
    [
      options.resume ? "Analyse wird fortgesetzt." : "Analyse läuft.",
      options.resume ? `Run ${selectedRun.runId}` : "Neuer Run aus Cache-Auswahl",
      `Auswahl ${options.resume ? selectedRun.counts?.selectedPlaylists ?? selection.length : selection.length}`,
    ].join(" | "),
    "running"
  );

  try {
    const result = options.resume
      ? await window.scannerApi.analyzeRun(config)
      : await window.scannerApi.analyzeSelected(config);
    state.lastScan = result;
    state.selectedRunId = result.run?.runId ?? state.selectedRunId;
    clearCacheSyncPending();
    await refreshDataViews({
      reason: options.resume ? "analysis-resume" : "analysis",
      preferredRunId: state.selectedRunId,
      preserveDraft: false,
    });

    if (result.paused || result.run?.status === "paused") {
      setStatus(
        [
          "Analyse pausiert.",
          `Run ${result.run?.runId ?? selectedRun.runId}`,
          `Analysiert ${result.run?.counts?.analyzedPlaylists ?? 0}`,
          `Track-Zeilen ${result.run?.counts?.analyzedTrackRows ?? 0}`,
        ].join(" | "),
        "running"
      );
      return;
    }

    setStatus(
      [
        "Analyse abgeschlossen.",
        `Run ${result.run?.runId ?? selectedRun.runId}`,
        `Analysiert ${result.run?.counts?.analyzedPlaylists ?? 0}`,
        `Track-Zeilen ${result.run?.counts?.analyzedTrackRows ?? 0}`,
      ].join(" | "),
      "success"
    );
  } catch (error) {
    setStatus(
      `Analyse fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
    await refreshDataViews({
      reason: "analysis-error",
      preferredRunId: state.selectedRunId,
      preserveDraft: true,
    });
  } finally {
    clearActivity();
  }
}

async function runRebuildCache() {
  if (state.activity) return;
  setActivity("cache-rebuild");
  setStatus("Cache wird aus vorhandenen Runs neu aufgebaut ...", "running");
  try {
    const result = await window.scannerApi.rebuildCacheFromRuns(getCurrentConfig());
    clearCacheSyncPending();
    await refreshDataViews({
      reason: "cache-rebuild",
      preserveDraft: true,
    });
    setStatus(
      `Cache-Rebuild abgeschlossen. Quellen ${result.rebuiltFromRuns ?? 0}, bevorzugter Run ${result.preferredRunId || "–"}`,
      "success"
    );
  } catch (error) {
    setStatus(
      `Cache-Rebuild fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  } finally {
    clearActivity();
  }
}

async function runExportCacheCsv() {
  if (state.activity) return;
  setActivity("cache-export");
  setStatus("CSV-Export aus lokalem Arbeitsbestand läuft ...", "running");
  try {
    const selectedPlaylistKeys = [...state.cacheSelectedPlaylistIdentities];
    const result = await window.scannerApi.exportCsvFromCache(getCurrentConfig(), {
      selectedPlaylistKeys: selectedPlaylistKeys.length > 0 ? selectedPlaylistKeys : undefined,
    });
    await refreshCacheStatus();
    setStatus(
      `CSV exportiert. Playlists ${result.playlistCount ?? 0}, Tracks ${result.trackCount ?? 0}`,
      "success"
    );
    await window.scannerApi.openPath(result.playlistsPath);
  } catch (error) {
    setStatus(
      `CSV-Export fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  } finally {
    clearActivity();
  }
}

async function requestPause() {
  const runId = state.activity?.runId || getSelectedRun()?.runId || "";
  if (!runId) {
    setStatus("Pause blockiert: Kein aktiver Analyselauf gefunden.", "error");
    return;
  }

  try {
    const result = await window.scannerApi.pauseRun(getCurrentConfig(), runId);
    state.pauseRequested = true;
    setStatus(result.message || "Pause angefordert.", "running");
    updateActionButtons();
  } catch (error) {
    setStatus(
      `Pause fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  }
}

async function openBeatportWindow() {
  if (state.activity) return;
  try {
    setStatus("Öffne internes Beatport-Fenster ...", "running");
    const status = await window.authApi.openLoginWindow(getCurrentConfig());
    renderAuthStatus(status);
    setStatus("Interne Beatport-Session wurde geöffnet.", "success");
  } catch (error) {
    setStatus(
      `Beatport-Fenster konnte nicht geöffnet werden: ${String(error.message || error)}`,
      "error"
    );
  }
}

async function testBeatportSession() {
  if (state.activity) return;
  try {
    setStatus("Prüfe interne Beatport-Session ...", "running");
    const status = await window.authApi.testSession(getCurrentConfig());
    renderAuthStatus(status);
    setStatus(
      `Session-Test: ${sessionStateLabel(status.sessionState)}`,
      status.sessionState === "valid" ? "success" : "idle"
    );
  } catch (error) {
    setStatus(
      `Session-Test fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  }
}

async function exportApiContext() {
  if (state.activity) return;
  try {
    setStatus("Exportiere API-Kontext für XHR-Tool ...", "running");
    const result = await window.authApi.exportApiContext(getCurrentConfig());
    if (result?.ok) {
      invalidateLazyTabData("api-context-export", { includePlaylistWiz: true });
      await reloadActiveLazyTab();
      setStatus(
        `✓ API-Kontext exportiert: ${result.path}`,
        "success"
      );
    } else {
      setStatus("API-Kontext-Export fehlgeschlagen.", "error");
    }
  } catch (error) {
    setStatus(
      `API-Kontext-Export fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  }
}

async function reconnectBeatportSession() {
  if (state.activity) return;
  try {
    setStatus("Verbinde interne Beatport-Session neu ...", "running");
    const status = await window.authApi.reauthenticate(getCurrentConfig());
    renderAuthStatus(status);
    setStatus(
      status.sessionState === "valid"
        ? "Interne Beatport-Session ist wieder bereit."
        : "Beatport-Fenster wurde geöffnet. Bitte dort anmelden und danach den Scan erneut starten.",
      status.sessionState === "valid" ? "success" : "idle"
    );
  } catch (error) {
    setStatus(
      `Neuverbinden fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  }
}

async function runMigrateLegacyRuns() {
  if (state.activity) return;

  const legacyRunIds = state.runs
    .filter((run) => run.origin?.kind === "legacy-source")
    .map((run) => run.runId);
  if (legacyRunIds.length === 0) {
    setStatus("Keine Legacy-Runs zur Migration gefunden.", "idle");
    return;
  }

  setActivity("migrate");
  setStatus(`Migriere ${legacyRunIds.length} Legacy-Run(s) kopierend ...`, "running");

  try {
    const result = await window.scannerApi.migrateLegacyRuns(getCurrentConfig(), {
      runIds: legacyRunIds,
    });
    state.lastMigrationResult = result;
    const firstMigrated = result.migrated?.[0]?.migratedRunId || "";
    await refreshRuns(firstMigrated || state.selectedRunId, {
      preserveDraft: false,
    });
    setStatus(
      `Migration abgeschlossen. Migriert: ${result.migrated?.length ?? 0}, übersprungen: ${result.skipped?.length ?? 0}`,
      "success"
    );
  } catch (error) {
    setStatus(
      `Migration fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
    await refreshRuns(state.selectedRunId, { preserveDraft: true });
  } finally {
    clearActivity();
  }
}

async function runExportZip() {
  if (state.activity) return;

  const selectedRun = getSelectedRun();
  if (!selectedRun?.runId) {
    setStatus("ZIP-Export blockiert: Kein Run ausgewählt.", "error");
    return;
  }

  setActivity("zip", selectedRun.runId);
  setStatus(`Erzeuge ZIP für Run ${selectedRun.runId} ...`, "running");

  try {
    const result = await window.scannerApi.exportRunZip(getCurrentConfig(), {
      runId: selectedRun.runId,
    });
    const run = state.runs.find((entry) => entry.runId === selectedRun.runId);
    if (run?.files) {
      run.files.zipPath = result.zipPath;
    }
    state.runMigrationInfo = {
      ...(state.runMigrationInfo || {}),
      files: {
        ...(state.runMigrationInfo?.files || {}),
        zipPath: result.zipPath,
      },
    };
    renderRunMeta();
    renderOutputFiles();
    setStatus(`ZIP erstellt: ${result.zipPath}`, "success");
    await window.scannerApi.openPath(result.zipPath);
  } catch (error) {
    setStatus(
      `ZIP-Export fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  } finally {
    clearActivity();
  }
}

async function runDelete() {
  if (state.activity) return;

  const selectedRun = getSelectedRun();
  if (!selectedRun?.files?.statePath) {
    setStatus(
      "Löschlauf blockiert: Kein abgeschlossener Run ausgewählt.",
      "error"
    );
    return;
  }

  const config = getCurrentConfig();
  config.confirm = els.confirmText.value.trim();
  config.statePath = selectedRun.files.statePath;
  config.runId = selectedRun.runId;
  writePersistedConfig(config);

  setActivity("delete", selectedRun.runId);
  setStatus(`Löschlauf läuft für Run ${selectedRun.runId} ...`, "running");

  try {
    const result = await window.scannerApi.deleteDuplicates(config);
    renderDeleteResult(result);
    await refreshRuns(selectedRun.runId, { preserveDraft: true });
    setStatus(
      `Löschlauf beendet. Angefordert: ${result.requested}, gelöscht: ${result.deleted}`,
      "success"
    );
  } catch (error) {
    setStatus(
      `Löschlauf fehlgeschlagen: ${String(error.message || error)}`,
      "error"
    );
  } finally {
    clearActivity();
  }
}

function applySelectionPreset(mode) {
  if (state.activity || state.cachePlaylists.length === 0) {
    return;
  }

  const visible = getVisibleRunPlaylists();
  let next = [];
  if (mode === "all") {
    next = visible.map((entry) => entry.identity);
  } else if (mode === "none") {
    next = [];
  } else if (mode === "duplicates") {
    next = visible
      .filter((entry) => entry.isDuplicate)
      .map((entry) => entry.identity);
  } else if (mode === "pending") {
    next = visible
      .filter((entry) => !entry.isAnalyzed)
      .map((entry) => entry.identity);
  }

  state.cacheSelectedPlaylistIdentities = new Set(next);
  renderPlaylistSelection();
  updateActionButtons();
}

async function bootstrap() {
  if (!window.scannerApi || !window.authApi) {
    setStatus("Fehler: scannerApi/authApi nicht verfügbar", "error");
    return;
  }

  state.defaults = await window.scannerApi.getDefaults();
  const persisted = readPersistedConfig();
  const mergedConfig = {
    ...state.defaults,
    ...(persisted || {}),
  };
  applyConfig(mergedConfig);
  writePersistedConfig(getCurrentConfig());

  clearNode(els.duplicateTableWrap, "Noch kein Run");
  clearNode(els.analysisTableWrap, "Noch keine Analyse");
  clearNode(els.selectionTableWrap, "Noch keine Cache-Daten geladen");
  clearNode(
    els.selectionSummary,
    "Cache laden, um Playlists für die Tiefenanalyse auszuwählen."
  );
  clearNode(els.runMeta, "Noch kein Run ausgewählt");
  renderPlaylistDetailsPlaceholder(
    "Playlist in Discovery, Duplikaten oder Analyse anklicken, um den Inhalt zu sehen."
  );
  clearNode(els.deleteResultWrap, "Noch kein Löschlauf");
  clearNode(els.migrationResult, "Noch keine Migration ausgeführt");
  persistLiveStatus(els.status.textContent || "Bereit", "idle");

  await refreshAppInfo();
  await refreshAuthStatus();
  await refreshCacheStatus();
  await refreshCachePlaylists();
  const startup = await autoPrepareRunsOnStartup();
  if (startup.migrationResult) {
    renderMigrationResult();
  }
  await refreshRuns(startup.preferredRunId, { preserveDraft: false });
  if (startup.migrationResult?.migrated?.length) {
    setStatus(
      `Legacy-Runs automatisch migriert. Aktiver Datenstand: ${startup.preferredRunId || "kein kompatibler Run"}`,
      "success"
    );
  } else if (startup.preferredRunId) {
    setStatus(
      `Letzter kompatibler Run automatisch geladen: ${startup.preferredRunId}`,
      "success"
    );
  } else if (state.cacheStatus?.counts?.playlists > 0) {
    setStatus(
      `Cache geladen: ${state.cacheStatus.counts.playlists} Playlists, ${state.cacheStatus.counts.dirtyPlaylists ?? 0} dirty`,
      "success"
    );
  }

  els.discoverBtn.addEventListener("click", runDiscovery);
  els.quickScanBtn.addEventListener("click", runQuickScan);
  els.rebuildCacheBtn.addEventListener("click", runRebuildCache);
  els.exportCacheCsvBtn.addEventListener("click", runExportCacheCsv);
  els.analyzeBtn.addEventListener("click", () => runAnalyzeSelection());
  els.resumeBtn.addEventListener("click", () =>
    runAnalyzeSelection({ resume: true })
  );
  els.pauseBtn.addEventListener("click", requestPause);
  els.openBeatportWindowBtn.addEventListener("click", openBeatportWindow);
  els.authTestBtn.addEventListener("click", testBeatportSession);
  els.authReconnectBtn.addEventListener("click", reconnectBeatportSession);
  els.authExportContextBtn.addEventListener("click", exportApiContext);
  els.migrateLegacyBtn.addEventListener("click", runMigrateLegacyRuns);
  els.exportZipBtn.addEventListener("click", runExportZip);
  els.resetBtn.addEventListener("click", () => {
    applyConfig(state.defaults);
    writePersistedConfig(getCurrentConfig());
  });
  els.deleteBtn.addEventListener("click", runDelete);
  els.refreshRunsBtn.addEventListener("click", () =>
    refreshRuns(state.selectedRunId, { preserveDraft: true })
  );
  els.openArchiveDirBtn.addEventListener("click", async () => {
    const run = getSelectedRun();
    if (run?.files?.archiveDir) {
      await window.scannerApi.openRunFolder(run.files.archiveDir);
    }
  });
  els.openExportDirBtn.addEventListener("click", async () => {
    const run = getSelectedRun();
    if (run?.files?.exportDir) {
      await window.scannerApi.openRunFolder(run.files.exportDir);
    }
  });
  // Workflow-Dialog
  const wfDialog = document.getElementById("workflowDialog");
  document.getElementById("workflowBtn")?.addEventListener("click", () => wfDialog?.showModal());
  document.getElementById("workflowCloseBtn")?.addEventListener("click", () => wfDialog?.close());
  wfDialog?.addEventListener("click", (e) => { if (e.target === wfDialog) wfDialog.close(); });
  els.runSelect.addEventListener("change", async () => {
    state.selectedRunId = els.runSelect.value;
    if (state.selectedPlaylistRef?.runId !== "cache") {
      state.selectedPlaylistRef = null;
      state.selectedPlaylistDetails = null;
      state.playlistDetailsError = "";
      state.playlistDetailsLoading = false;
    }
    renderRunResults();
    await refreshRunMigrationInfo(state.selectedRunId);
    renderRunMeta();
    renderOutputFiles();
    renderRunResults();
    updateActionButtons();
  });
  els.runFilter.addEventListener("change", async () => {
    state.runFilter = els.runFilter.value;
    await refreshRuns("", { preserveDraft: true });
  });
  els.playlistFilter.addEventListener("input", () => {
    state.playlistFilter = els.playlistFilter.value;
    renderPlaylistSelection();
    updateActionButtons();
  });
  els.authMode.addEventListener("change", async () => {
    writePersistedConfig(getCurrentConfig());
    const status = await window.authApi.setMode(getCurrentConfig(), els.authMode.value);
    renderAuthStatus(status);
  });
  [els.recoveryPolicy, els.fallbackEnabled].forEach((node) => {
    node.addEventListener("change", async () => {
      writePersistedConfig(getCurrentConfig());
      await refreshAuthStatus();
    });
  });
  els.selectionAllBtn.addEventListener("click", () => applySelectionPreset("all"));
  els.selectionNoneBtn.addEventListener("click", () => applySelectionPreset("none"));
  els.selectionDuplicatesBtn.addEventListener("click", () =>
    applySelectionPreset("duplicates")
  );
  els.selectionPendingBtn.addEventListener("click", () =>
    applySelectionPreset("pending")
  );
  els.confirmText.addEventListener("input", updateDeleteButtonState);

  [
    els.host,
    els.port,
    els.targetPattern,
    els.timeoutMs,
    els.appPath,
    els.hostAppPath,
    els.authMode,
    els.recoveryPolicy,
    els.fallbackEnabled,
    els.launchApp,
    els.autoRecoverCdp,
    els.analysisMethod,
    els.sidebarScrollStep,
    els.deepAnalysisWaitMs,
    els.stateFile,
    els.csvFile,
    els.analysisJsonFile,
    els.analysisTrackCsvFile,
    els.analysisSummaryCsvFile,
  ].forEach((node) => {
    node.addEventListener("change", () => writePersistedConfig(getCurrentConfig()));
  });

  updateActionButtons();

  if (
    state.authStatus?.sessionState === "valid" &&
    state.cacheStatus?.counts?.playlists >= 0
  ) {
    window.setTimeout(() => {
      if (!state.activity) {
        runDiscovery().catch(() => {});
      }
    }, 250);
  }
}

// ─── Analyse-Tab Lazy-Loader ────────────────────────────────────────────────
async function loadAnalysisTab() {
  try {
    if (!analysisModule) {
      analysisModule = await import("./tabs/analysis.js");
    }
    const config = getCurrentConfig();
    await analysisModule.loadAnalysisData(config);
  } catch (err) {
    console.error("[analysis] Laden fehlgeschlagen:", err);
  }
}

// getCurrentConfig global bereitstellen für Tab-Module (export.js etc.)
window.getCurrentConfig = getCurrentConfig;

async function loadPlaylistWizTab() {
  try {
    if (!playlistWizModule) {
      playlistWizModule = await import("./tabs/playlist-wiz.js");
    }
    await playlistWizModule.initPlaylistWiz();
  } catch (err) {
    console.error("[playlist-wiz] Laden fehlgeschlagen:", err);
  }
}

async function loadSyncTab() {
  try {
    if (!syncModule) {
      syncModule = await import("./tabs/sync.js");
    }
    await syncModule.initSyncTab();
  } catch (err) {
    console.error("[sync] Laden fehlgeschlagen:", err);
  }
}

async function loadSearchTab() {
  try {
    if (!searchModule) {
      searchModule = await import("./tabs/search.js");
    }
    await searchModule.initSearchTab();
  } catch (err) {
    console.error("[search] Laden fehlgeschlagen:", err);
  }
}

async function loadExportTab() {
  try {
    if (!exportModule) {
      exportModule = await import("./tabs/export.js");
    }
    await exportModule.renderExportTab();
  } catch (err) {
    console.error("[export] Laden fehlgeschlagen:", err);
  }
}

async function loadAutomationTab() {
  try {
    if (!automationModule) {
      automationModule = await import("./tabs/automation.js");
    }
    await automationModule.initAutomationTab();
  } catch (err) {
    console.error("[automation] Laden fehlgeschlagen:", err);
  }
}

async function loadSettingsTab() {
  try {
    if (!settingsModule) {
      settingsModule = await import("./tabs/settings.js");
    }
    await settingsModule.initSettingsTab();
  } catch (err) {
    console.error("[settings] Laden fehlgeschlagen:", err);
  }
}

async function loadLabelsTab() {
  try {
    if (!labelsModule) {
      labelsModule = await import("./tabs/labels.js");
    }
    await labelsModule.initLabelsTab();
  } catch (err) {
    console.error("[labels] Laden fehlgeschlagen:", err);
  }
}

async function loadEngineAnalyzeTab() {
  try {
    if (!engineAnalyzeModule) {
      engineAnalyzeModule = await import("./tabs/engine-analyze.js");
    }
    await engineAnalyzeModule.initEngineAnalyzeTab();
  } catch (err) {
    console.error("[engine-analyze] Laden fehlgeschlagen:", err);
  }
}

// ─── Playlist Builder Drawer ─────────────────────────────────────────────────

let builderModule = null;

function toggleBuilderDrawer() {
  const drawer = document.getElementById("builder-drawer");
  if (!drawer) return;
  const isOpen = drawer.classList.contains("open");
  if (isOpen) {
    drawer.classList.remove("open");
    document.body.classList.remove("builder-open");
  } else {
    openBuilderDrawer();
  }
}

async function openBuilderDrawer() {
  const drawer = document.getElementById("builder-drawer");
  if (!drawer) return;
  if (!builderModule) {
    builderModule = await import("./components/playlist-builder.js");
    const content = document.getElementById("builderDrawerContent");
    if (content) builderModule.renderBuilder(content);
  }
  drawer.classList.add("open");
  document.body.classList.add("builder-open");
}

document.getElementById("builderToggle")?.addEventListener("click", toggleBuilderDrawer);
document.getElementById("builderDrawerClose")?.addEventListener("click", toggleBuilderDrawer);

window.addEventListener("builder:add-tracks", async (e) => {
  const { tracks } = e.detail || {};
  if (!Array.isArray(tracks) || tracks.length === 0) return;
  await openBuilderDrawer();
  if (builderModule) {
    const added = builderModule.addTracksToPool(tracks);
  }
});

// ─── Cross-Tab Events ────────────────────────────────────────────────────────

window.addEventListener("engine-analyze:load-in-search", async (e) => {
  const { tracks, source } = e.detail || {};
  if (!Array.isArray(tracks) || tracks.length === 0) return;

  // Search-Tab aktivieren
  const searchBtn = document.querySelector('.tab[aria-controls="tab-search"]');
  if (searchBtn) searchBtn.click();

  // Search-Modul laden falls nötig, dann Tracks übergeben
  if (!searchModule) {
    searchModule = await import("./tabs/search.js");
  }
  await searchModule.initSearchTab();
  searchModule.loadExternalTracks(tracks, source || "Engine-Analyse");
});

bootstrap().catch((error) => {
  stopRunPolling();
  setStatus(
    `Initialisierung fehlgeschlagen: ${String(error.message || error)}`,
    "error"
  );
});

// ─── Engine-Import Sub-Tab (v3.5.4) ──────────────────────────────────────────
(function initEngineImport() {
  let currentPreview = null;
  const resolutions = new Map(); // "trackId|field" → "old"|"new"|"skip"

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) { return new Intl.NumberFormat("de-DE").format(n || 0); }

  function renderStats(preview) {
    const s = preview.stats || {};
    const host = el("engMergeStats");
    if (!host) return;
    host.hidden = false;
    host.innerHTML = `
      <div class="eng-stat"><span class="n">${fmt(s.scoring_track_count)}</span><span class="l">Scoring-Tracks</span></div>
      <div class="eng-stat"><span class="n">${fmt(s.engine_track_count)}</span><span class="l">Engine-Tracks</span></div>
      <div class="eng-stat ok"><span class="n">${fmt(s.matched)}</span><span class="l">Matches (${fmt(s.matched_by_id)} via BP-ID)</span></div>
      <div class="eng-stat ok"><span class="n">${fmt(s.enrich_actions)}</span><span class="l">Anreicherungen</span></div>
      <div class="eng-stat warn"><span class="n">${fmt(s.conflicts)}</span><span class="l">echte Konflikte</span></div>
      <div class="eng-stat muted"><span class="n">${fmt(s.unmatched_with_bp_id)}</span><span class="l">Engine BP-Tracks ohne Scoring-Match</span></div>
      <div class="eng-stat muted"><span class="n">${fmt(s.local_only)}</span><span class="l">lokale Engine-Tracks (ohne BP-ID)</span></div>
    `;
  }

  function renderEnrichments(list) {
    const host = el("engEnrichList");
    const det = el("engMergeEnrichments");
    const cnt = el("engEnrichCount");
    if (!host || !det || !cnt) return;
    cnt.textContent = fmt(list.length);
    det.hidden = list.length === 0;
    // Nur die ersten 500 darstellen — sonst DOM-Explosion
    const shown = list.slice(0, 500);
    host.innerHTML = shown.map((e) => `
      <div class="eng-row">
        <span class="eng-field">${esc(e.field)}</span>
        <span class="eng-title">${esc(e.title)}</span>
        <span class="eng-val new">${esc(JSON.stringify(e.value))}</span>
      </div>
    `).join("") + (list.length > 500 ? `<p class="acc-hint">… ${fmt(list.length - 500)} weitere</p>` : "");
  }

  function renderConflicts(list) {
    const host = el("engConflictList");
    const det = el("engMergeConflicts");
    const cnt = el("engConflictCount");
    if (!host || !det || !cnt) return;
    cnt.textContent = fmt(list.length);
    det.hidden = list.length === 0;
    const shown = list.slice(0, 500);
    host.innerHTML = shown.map((c) => {
      const key = `${c.track_id}|${c.field}`;
      const res = resolutions.get(key) || "skip";
      return `
        <div class="eng-row conflict" data-key="${esc(key)}">
          <span class="eng-field">${esc(c.field)}</span>
          <span class="eng-title">${esc(c.title)}</span>
          <span class="eng-val old">alt: ${esc(JSON.stringify(c.old))}</span>
          <span class="eng-val new">neu: ${esc(JSON.stringify(c.new))}</span>
          <span class="eng-resolve">
            <label><input type="radio" name="r-${esc(key)}" value="old"  ${res==="old"?"checked":""}> alt</label>
            <label><input type="radio" name="r-${esc(key)}" value="new"  ${res==="new"?"checked":""}> neu</label>
            <label><input type="radio" name="r-${esc(key)}" value="skip" ${res==="skip"?"checked":""}> skip</label>
          </span>
        </div>
      `;
    }).join("") + (list.length > 500 ? `<p class="acc-hint">… ${fmt(list.length - 500)} weitere (nur erste 500 auflösbar im UI, Rest wird übersprungen)</p>` : "");
  }

  function renderUnmatched(list) {
    const host = el("engUnmatchedList");
    const det = el("engMergeUnmatched");
    const cnt = el("engUnmatchedCount");
    if (!host || !det || !cnt) return;
    cnt.textContent = fmt(list.length);
    det.hidden = list.length === 0;
    const shown = list.slice(0, 200);
    host.innerHTML = shown.map((u) => `
      <div class="eng-row">
        <span class="eng-field">bp: ${esc(u.beatport_id)}</span>
        <span class="eng-title">${esc(u.title)} — <em>${esc(u.artists)}</em></span>
      </div>
    `).join("") + (list.length > 200 ? `<p class="acc-hint">… ${fmt(list.length - 200)} weitere</p>` : "");
  }

  async function loadPreview() {
    const api = window.scoringMergeApi;
    if (!api) { alert("scoringMergeApi nicht verfügbar"); return; }
    const status = el("engMergeStatus");
    const dbSource = document.getElementById("engDbSource")?.value || "auto";
    status.textContent = `Preview wird erstellt (DB: ${dbSource === "auto" ? "Auto-Detect" : dbSource}) — kann mehrere Sekunden dauern …`;
    el("engMergeApplyBtn").disabled = true;
    resolutions.clear();
    try {
      const summary = await api.preview(dbSource !== "auto" ? dbSource : undefined);
      if (!summary?.ok) throw new Error(summary?.error || "Preview fehlgeschlagen");
      const full = await api.readPreview();
      if (!full?.ok) throw new Error(full?.error || "Preview-Datei kaputt");
      currentPreview = full;
      renderStats(full);
      renderEnrichments(full.enrichments || []);
      renderConflicts(full.conflicts || []);
      renderUnmatched(full.new_track_candidates || []);
      status.textContent = `Preview bereit. ${fmt(full.stats.matched)} Tracks gematcht, ${fmt(full.stats.enrich_actions)} Anreicherungen, ${fmt(full.stats.conflicts)} Konflikte.`;
      el("engMergeApplyBtn").disabled = false;
    } catch (err) {
      status.textContent = `Fehler: ${err.message}`;
      status.classList.add("error");
    }
  }

  async function applyChanges() {
    if (!currentPreview) return;
    const ok = confirm(`Änderungen anwenden?\n\n${fmt(currentPreview.stats.enrich_actions)} Anreicherungen werden geschrieben.\nKonflikte: nur die, die du auf "neu" gesetzt hast.\n\nVorher wird ein Backup von scoring-data.json angelegt.`);
    if (!ok) return;

    // Resolutions aus DOM lesen (falls User geklickt hat)
    for (const row of document.querySelectorAll("#engConflictList .eng-row.conflict")) {
      const key = row.dataset.key;
      const checked = row.querySelector('input[type="radio"]:checked');
      if (checked) resolutions.set(key, checked.value);
    }

    const conflictResolutions = {};
    for (const [k, v] of resolutions.entries()) conflictResolutions[k] = v;

    try {
      const result = await window.scoringMergeApi.apply({
        enrichments: true,
        overwrites: false,
        conflictResolutions,
      });
      const res = el("engMergeResult");
      res.hidden = false;
      res.classList.remove("empty", "error");
      res.innerHTML = `✔ Geschrieben: ${result.applied.enrich} Anreicherungen, ${result.applied.conflict} Konflikte (neu gewählt), ${result.applied.skipped} übersprungen.<br>Backup: <code>${esc(result.backup)}</code><br>Log-Einträge: ${result.log_entries}`;
      el("engMergeApplyBtn").disabled = true;
    } catch (err) {
      const res = el("engMergeResult");
      res.hidden = false;
      res.classList.add("error");
      res.textContent = `Apply fehlgeschlagen: ${err.message}`;
    }
  }

  // Conflict-Radio-Tracking
  document.addEventListener("change", (e) => {
    if (e.target.matches('#engConflictList input[type="radio"]')) {
      const row = e.target.closest(".eng-row.conflict");
      if (row) resolutions.set(row.dataset.key, e.target.value);
    }
  });

  // Bulk-Buttons
  document.addEventListener("click", (e) => {
    const bulk = { engConflictsAllOld: "old", engConflictsAllNew: "new", engConflictsAllSkip: "skip" }[e.target.id];
    if (!bulk) return;
    for (const row of document.querySelectorAll("#engConflictList .eng-row.conflict")) {
      const key = row.dataset.key;
      resolutions.set(key, bulk);
      const radio = row.querySelector(`input[value="${bulk}"]`);
      if (radio) radio.checked = true;
    }
  });

  const previewBtn = document.getElementById("engMergePreviewBtn");
  const applyBtn = document.getElementById("engMergeApplyBtn");
  if (previewBtn) previewBtn.addEventListener("click", loadPreview);
  if (applyBtn) applyBtn.addEventListener("click", applyChanges);

  // DB-Quellen erkennen
  async function refreshDbSources() {
    const sel = document.getElementById("engDbSource");
    if (!sel || !window.engineApi?.discoverAllDatabases) return;
    try {
      const result = await window.engineApi.discoverAllDatabases();
      if (result?.ok && Array.isArray(result.databases)) {
        sel.innerHTML = '<option value="auto">Automatisch erkennen</option>';
        for (const db of result.databases) {
          const label = db.source === "usb" ? `USB: ${db.volume}` : `Lokal (${db.volume})`;
          const dbs = db.databases.filter((d) => d.exists).map((d) => d.name).join(", ");
          const opt = document.createElement("option");
          opt.value = db.path;
          opt.textContent = `${label} — ${dbs}`;
          sel.appendChild(opt);
        }
      }
    } catch { /* silent */ }
  }
  document.getElementById("engRefreshDbsBtn")?.addEventListener("click", refreshDbSources);
  refreshDbSources();

  // Unmatched: zum Scanner wechseln
  document.getElementById("engUnmatchedScanBtn")?.addEventListener("click", () => {
    document.querySelector('.group-bar .group[data-group="library"]')?.click();
    setTimeout(() => {
      document.querySelector('.library-subnav .sub-tab[data-libsub="scan"]')?.click();
    }, 100);
  });

  // Unmatched: CSV exportieren
  document.getElementById("engUnmatchedExportBtn")?.addEventListener("click", () => {
    if (!currentPreview?.new_track_candidates?.length) return;
    const header = "beatport_id,title,artists\n";
    const rows = currentPreview.new_track_candidates.map((u) =>
      `${u.beatport_id || ""},"${(u.title || "").replace(/"/g, '""')}","${(u.artists || "").replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `engine-unmatched-tracks-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
