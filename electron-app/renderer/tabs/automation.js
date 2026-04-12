import { loadUnifiedSettings, saveUnifiedSettings } from "./unified-settings.js";

const state = {
  initialized: false,
  discovery: null,
  components: [],
  engineSummary: null,
  enginePlaylists: [],
  engineHistorySessions: [],
  selectedPlaylistId: "",
  selectedSessionId: "",
  lastLoadedTracks: [],
  lastLoadedName: "",
  classifier: null,
  lastM3uResult: null,
  lastOscResult: null,
  message: "",
  tone: "info",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setMessage(text, tone = "info") {
  state.message = text;
  state.tone = tone;
}

function parseScanRoots(settings) {
  return String(settings.scanRoots || "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readSettingsFromDom() {
  return saveUnifiedSettings({
    scanRoots: document.getElementById("autoScanRoots")?.value ?? "",
    engineDatabaseFolder:
      document.getElementById("autoEngineDatabaseFolder")?.value ?? "",
    pythonCommand: document.getElementById("autoPythonCommand")?.value ?? "python3",
    oscHost: document.getElementById("autoOscHost")?.value ?? "127.0.0.1",
    oscPort: Number(document.getElementById("autoOscPort")?.value ?? 9000),
    oscAddressPrefix:
      document.getElementById("autoOscAddressPrefix")?.value ?? "/beatport-suite",
  });
}

function renderComponentCards() {
  if (!state.discovery) {
    return '<div class="detail-summary empty">Noch kein Projektscan ausgeführt.</div>';
  }

  return `
    <div class="automation-grid two">
      ${state.components
        .map(
          (component) => `
            <article class="automation-card">
              <div class="automation-card-head">
                <strong>${esc(component.label)}</strong>
                <span class="pill ${
                  component.status === "linked" || component.status === "bundled"
                    ? "success"
                    : component.status === "not-linked"
                      ? "warning"
                      : "neutral"
                }">${esc(component.status)}</span>
              </div>
              <p class="automation-path">${esc(component.path || "–")}</p>
              <p class="automation-subtle">Quellen: ${component.sourcePaths?.length || 0}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderEngineSelectors() {
  return `
    <div class="field-grid compact-grid">
      <label>
        Engine-Playlist
        <select id="autoEnginePlaylistSelect">
          <option value="">Bitte laden …</option>
          ${state.enginePlaylists
            .map(
              (playlist) => `
                <option value="${playlist.id}" ${
                  String(playlist.id) === String(state.selectedPlaylistId) ? "selected" : ""
                }>
                  ${esc(playlist.title)} (${playlist.trackCount ?? 0})
                </option>
              `
            )
            .join("")}
        </select>
      </label>
      <label>
        History-Session
        <select id="autoEngineSessionSelect">
          <option value="">Bitte laden …</option>
          ${state.engineHistorySessions
            .map(
              (session) => `
                <option value="${session.id}" ${
                  String(session.id) === String(state.selectedSessionId) ? "selected" : ""
                }>
                  ${esc(session.title)} — ${esc(session.startTime)}
                </option>
              `
            )
            .join("")}
        </select>
      </label>
    </div>
  `;
}

function renderClassifierSummary() {
  if (!state.classifier) {
    return '<div class="detail-summary empty">Noch keine Performance-Klassifikation berechnet.</div>';
  }

  const summary = state.classifier.summary || {};
  const topTracks = state.classifier.topTracks || [];

  return `
    <div class="automation-stats">
      <div class="stat-card">
        <span class="stat-label">Tracks</span>
        <strong class="stat-value">${summary.count ?? 0}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">Ø Energy</span>
        <strong class="stat-value">${summary.avgEnergy ?? 0}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">Ø Danceability</span>
        <strong class="stat-value">${summary.avgDanceability ?? 0}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">Ø Intensity</span>
        <strong class="stat-value">${summary.avgIntensity ?? 0}</strong>
      </div>
    </div>
    <div class="table-wrap" style="max-height:320px">
      <table class="data-table">
        <thead>
          <tr><th>Track</th><th>Artist</th><th>BPM</th><th>Stage</th><th>Intensity</th></tr>
        </thead>
        <tbody>
          ${topTracks
            .map(
              (track) => `
                <tr>
                  <td>${esc(track.title)}</td>
                  <td>${esc(track.artist)}</td>
                  <td>${esc(track.bpm)}</td>
                  <td>${esc(track.stage)}</td>
                  <td>${esc(track.intensity)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAutomationTab() {
  const container = document.getElementById("automation-content");
  if (!container) return;

  const settings = loadUnifiedSettings();
  const discoverySummary = state.discovery?.summary || {};
  const engineSummary = state.engineSummary || {};

  container.innerHTML = `
    <section class="panel span-full">
      <div class="section-head">
        <h2>Unified App Build</h2>
        <div class="actions compact">
          <button id="autoScanBtn" type="button">Projektteile scannen</button>
          <button id="autoEngineSummaryBtn" type="button">Engine Status laden</button>
          <button id="autoClassifierBtn" class="primary" type="button">Cache klassifizieren</button>
        </div>
      </div>
      <p class="detail-summary">
        Diese Oberfläche verbindet die gefundenen Beatport-, Engine-, Ableton- und Max/MSP-Bausteine
        direkt in der Desktop-App.
      </p>
      ${
        state.message
          ? `<div class="callout ${state.tone}">${esc(state.message)}</div>`
          : ""
      }
    </section>

    <section class="panel">
      <h2>Projekt-Discovery</h2>
      <div class="field-grid">
        <label class="wide">
          Scan-Roots
          <textarea id="autoScanRoots" rows="4">${esc(settings.scanRoots)}</textarea>
        </label>
      </div>
      <div class="detail-summary">
        Treffer: Verzeichnisse ${discoverySummary.directoryMatches ?? 0},
        Dateien ${discoverySummary.fileMatches ?? 0},
        eindeutige Pfade ${discoverySummary.uniquePaths ?? 0}
      </div>
      ${renderComponentCards()}
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Engine / Denon Tools</h2>
        <div class="actions compact">
          <button id="autoEnginePlaylistsBtn" type="button">Playlists laden</button>
          <button id="autoEngineHistoryBtn" type="button">History laden</button>
          <button id="autoExportM3uBtn" type="button">M3U8 exportieren</button>
        </div>
      </div>
      <div class="field-grid">
        <label>
          Engine Database Folder
          <input id="autoEngineDatabaseFolder" type="text" value="${esc(
            settings.engineDatabaseFolder
          )}" placeholder="~/Music/Engine Library/Database2" />
        </label>
        <label>
          Python Command
          <input id="autoPythonCommand" type="text" value="${esc(
            settings.pythonCommand
          )}" />
        </label>
      </div>
      <div class="detail-summary">
        Datenbankordner: ${esc(engineSummary.databaseFolder || "noch nicht aufgelöst")} |
        Playlists: ${engineSummary.playlistCount ?? 0} |
        History-Sessions: ${engineSummary.historySessionCount ?? 0} |
        Rekordbox-Tracks: ${engineSummary.rekordboxTrackCount ?? 0}${
          (() => {
            const mainDb = (engineSummary.databases || []).find(d => d.id === "main");
            return mainDb?.withCues != null
              ? ` | Tracks mit Cues: ${mainDb.withCues} | Tracks mit TrackData: ${mainDb.withTrackdata ?? 0}`
              : "";
          })()
        }
      </div>
      ${renderEngineSelectors()}
    </section>

    <section class="panel span-full">
      <h2>Performance Classifier</h2>
      ${renderClassifierSummary()}
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>OSC → Max/MSP / VJ</h2>
        <div class="actions compact">
          <button id="autoSendOscBtn" type="button">Snapshot senden</button>
        </div>
      </div>
      <div class="field-grid">
        <label>
          Host
          <input id="autoOscHost" type="text" value="${esc(settings.oscHost)}" />
        </label>
        <label>
          Port
          <input id="autoOscPort" type="number" min="1" max="65535" value="${esc(
            settings.oscPort
          )}" />
        </label>
        <label class="wide">
          Address Prefix
          <input id="autoOscAddressPrefix" type="text" value="${esc(
            settings.oscAddressPrefix
          )}" />
        </label>
      </div>
      <div class="detail-summary">
        Letzter OSC-Status: ${
          state.lastOscResult
            ? `${state.lastOscResult.sentMessages} Nachrichten an ${state.lastOscResult.host}:${state.lastOscResult.port}`
            : "noch nichts gesendet"
        }
      </div>
    </section>
  `;

  bindAutomationEvents();
}

function bindAutomationEvents() {
  document.getElementById("autoScanBtn")?.addEventListener("click", runProjectScan);
  document
    .getElementById("autoEngineSummaryBtn")
    ?.addEventListener("click", loadEngineSummary);
  document
    .getElementById("autoEnginePlaylistsBtn")
    ?.addEventListener("click", loadEnginePlaylists);
  document
    .getElementById("autoEngineHistoryBtn")
    ?.addEventListener("click", loadEngineHistory);
  document
    .getElementById("autoExportM3uBtn")
    ?.addEventListener("click", exportSelectedM3u);
  document
    .getElementById("autoClassifierBtn")
    ?.addEventListener("click", runCacheClassifier);
  document
    .getElementById("autoSendOscBtn")
    ?.addEventListener("click", sendOscSnapshot);

  document.getElementById("autoEnginePlaylistSelect")?.addEventListener("change", (event) => {
    state.selectedPlaylistId = event.target.value;
  });
  document.getElementById("autoEngineSessionSelect")?.addEventListener("change", (event) => {
    state.selectedSessionId = event.target.value;
  });

  [
    "autoScanRoots",
    "autoEngineDatabaseFolder",
    "autoPythonCommand",
    "autoOscHost",
    "autoOscPort",
    "autoOscAddressPrefix",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      readSettingsFromDom();
    });
  });
}

async function runProjectScan() {
  const settings = readSettingsFromDom();
  const discovery = await window.unifiedApi.discoverProjects({
    roots: parseScanRoots(settings),
  });
  state.discovery = discovery;
  state.components = discovery.components || [];
  setMessage("Projektteile erfolgreich kartiert.", "success");
  renderAutomationTab();
}

async function loadEngineSummary() {
  const settings = readSettingsFromDom();
  state.engineSummary = await window.unifiedApi.engineSummary(settings);
  setMessage("Engine-Status geladen.", "success");
  renderAutomationTab();
}

async function loadEnginePlaylists() {
  const settings = readSettingsFromDom();
  const result = await window.unifiedApi.enginePlaylists(settings);
  state.enginePlaylists = result.playlists || [];
  state.selectedPlaylistId = state.enginePlaylists[0]?.id
    ? String(state.enginePlaylists[0].id)
    : "";
  setMessage("Engine-Playlists geladen.", "success");
  renderAutomationTab();
}

async function loadEngineHistory() {
  const settings = readSettingsFromDom();
  const result = await window.unifiedApi.engineHistorySessions(settings);
  state.engineHistorySessions = result.sessions || [];
  state.selectedSessionId = state.engineHistorySessions[0]?.id
    ? String(state.engineHistorySessions[0].id)
    : "";
  setMessage("Denon-History geladen.", "success");
  renderAutomationTab();
}

async function exportSelectedM3u() {
  const settings = readSettingsFromDom();
  let trackResult = null;

  if (state.selectedSessionId) {
    trackResult = await window.unifiedApi.engineHistoryTracks({
      ...settings,
      sessionId: Number(state.selectedSessionId),
    });
    state.lastLoadedName = `engine-history-${state.selectedSessionId}`;
  } else if (state.selectedPlaylistId) {
    trackResult = await window.unifiedApi.enginePlaylistTracks({
      ...settings,
      playlistId: Number(state.selectedPlaylistId),
    });
    state.lastLoadedName = `engine-playlist-${state.selectedPlaylistId}`;
  } else {
    setMessage("Bitte zuerst eine Playlist oder History-Session laden.", "warning");
    renderAutomationTab();
    return;
  }

  state.lastLoadedTracks = trackResult.tracks || [];
  const saveResult = await window.exportApi.chooseSavePath({
    title: "Engine / Denon M3U8 exportieren",
    defaultName: state.lastLoadedName,
    format: "m3u8",
  });

  if (saveResult?.canceled) {
    setMessage("M3U8-Export abgebrochen.", "info");
    renderAutomationTab();
    return;
  }

  state.lastM3uResult = await window.unifiedApi.exportM3u({
    name: state.lastLoadedName,
    tracks: state.lastLoadedTracks,
    outputPath: saveResult.filePath,
  });
  setMessage(`M3U8 exportiert: ${state.lastM3uResult.path}`, "success");
  renderAutomationTab();
}

async function runCacheClassifier() {
  state.classifier = await window.unifiedApi.classifyCache(window.getCurrentConfig());
  setMessage("Performance-Klassifikation aus dem Cache berechnet.", "success");
  renderAutomationTab();
}

async function sendOscSnapshot() {
  if (!state.classifier) {
    setMessage("Bitte zuerst eine Performance-Klassifikation berechnen.", "warning");
    renderAutomationTab();
    return;
  }

  const settings = readSettingsFromDom();
  state.lastOscResult = await window.unifiedApi.sendOscSnapshot({
    host: settings.oscHost,
    port: Number(settings.oscPort),
    addressPrefix: settings.oscAddressPrefix,
    summary: state.classifier.summary,
    tracks: state.classifier.topTracks,
  });
  setMessage("OSC-Snapshot an Max/MSP / VJ gesendet.", "success");
  renderAutomationTab();
}

export async function initAutomationTab() {
  renderAutomationTab();

  if (!state.initialized) {
    state.initialized = true;
    try {
      await runProjectScan();
      await loadEngineSummary();
    } catch (error) {
      setMessage(String(error.message || error), "warning");
      renderAutomationTab();
    }
  }
}

export function forceReload() {
  state.classifier = null;
}
