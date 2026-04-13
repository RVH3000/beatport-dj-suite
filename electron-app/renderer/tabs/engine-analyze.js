// ─── Engine-Analyse Tab ──────────────────────────────────────────────────────
// Lädt Engine-DJ-Playlisten, matcht gegen Beatport-Scoring-Data und
// klassifiziert Tracks nach Energy/Danceability/Intensity.
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  initialized: false,
  databaseFolder: "",
  discoveredDbs: [],
  playlists: [],
  selectedPlaylistIds: new Set(),
  analysisResult: null,
  loading: false,
  message: "",
  tone: "info",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Render ──────────────────────────────────────────────────────────────────

function renderEngineAnalyzeTab() {
  const container = document.getElementById("engine-analyze-content");
  if (!container) return;

  container.innerHTML = `
    <!-- Section 1: DB-Auswahl -->
    <section class="panel">
      <div class="section-head">
        <h2>Engine-Datenbank</h2>
        <div class="actions compact">
          <button id="eaDiscoverBtn" type="button">Erkennen</button>
          <button id="eaLoadPlaylistsBtn" class="primary" type="button">Playlisten laden</button>
        </div>
      </div>
      ${
        state.message
          ? `<div class="callout ${state.tone}">${esc(state.message)}</div>`
          : ""
      }
      <div class="field-grid">
        <label class="wide">
          Datenbankpfad
          <input id="eaDatabaseFolder" type="text" value="${esc(state.databaseFolder)}"
                 placeholder="/Volumes/USB/Engine Library/Database2" />
        </label>
      </div>
      ${state.discoveredDbs.length > 0 ? `
        <select id="eaDbSelect">
          <option value="">Datenbank w\u00e4hlen\u2026</option>
          ${state.discoveredDbs.map(db => `
            <option value="${esc(db.path)}">${esc(db.volume)} (${db.source}) \u2014 ${db.path}</option>
          `).join("")}
        </select>
      ` : ""}
    </section>

    <!-- Section 2: Playlist-Picker -->
    <section class="panel" ${state.playlists.length === 0 ? 'style="display:none"' : ""}>
      <div class="section-head">
        <h2>Playlisten (${state.selectedPlaylistIds.size} / ${state.playlists.length} ausgew\u00e4hlt)</h2>
        <div class="actions compact">
          <button id="eaSelectAllBtn" type="button">Alle</button>
          <button id="eaSelectNoneBtn" type="button">Keine</button>
          <button id="eaAnalyzeBtn" class="primary" type="button" ${state.selectedPlaylistIds.size === 0 ? "disabled" : ""}>
            Analysieren
          </button>
        </div>
      </div>
      <div class="ea-playlist-list" style="max-height:300px;overflow-y:auto">
        ${state.playlists.map(pl => `
          <label class="ea-playlist-item">
            <input type="checkbox" value="${pl.id}"
                   ${state.selectedPlaylistIds.has(String(pl.id)) ? "checked" : ""} />
            <span>${pl.isPersisted === 0 ? "\uD83D\uDEAB " : ""}${esc(pl.title)}</span>
            <span class="ea-track-count">${pl.trackCount ?? 0} Tracks</span>
          </label>
        `).join("")}
      </div>
    </section>

    <!-- Section 3: Ergebnisse -->
    ${state.analysisResult ? `
    <section class="panel">
      <div class="section-head">
        <h2>Ergebnisse</h2>
        <div class="actions compact">
          <button id="eaLoadInSearchBtn" type="button">In Suche laden</button>
          <button id="eaExportCsvBtn" type="button">CSV Export</button>
        </div>
      </div>

      <!-- Match-Statistik -->
      <div class="detail-summary">
        ${state.analysisResult.matchStats ? `
          ${state.analysisResult.matchStats.total} Tracks |
          Gematcht: ${state.analysisResult.matchStats.total - (state.analysisResult.matchStats.none || 0)}
          (${state.analysisResult.matchStats.matchRate}%) |
          <span class="match-exact">${state.analysisResult.matchStats.exact_id || 0} Beatport-ID</span> |
          <span class="match-title">${state.analysisResult.matchStats.title_artist || 0} Title/Artist</span> |
          <span class="match-fuzzy">${state.analysisResult.matchStats.fuzzy || 0} Fuzzy</span> |
          <span class="match-none">${state.analysisResult.matchStats.none || 0} kein Match</span>
        ` : `${state.analysisResult.totalTracks} Tracks (kein Scoring-Data zum Matchen)`}
      </div>

      <!-- Classifier Summary -->
      ${state.analysisResult.classifierSummary?.summary ? `
      <div class="automation-stats">
        ${["count", "avgEnergy", "avgDanceability", "avgIntensity"].map(key => `
          <div class="stat-card">
            <span class="stat-label">${key === "count" ? "Tracks" : key.replace("avg", "\u00D8 ")}</span>
            <strong class="stat-value">${state.analysisResult.classifierSummary.summary[key] ?? 0}</strong>
          </div>
        `).join("")}
      </div>
      ` : ""}

      <!-- Ergebnis-Tabelle -->
      <div class="table-wrap" style="max-height:500px">
        <table class="data-table">
          <thead>
            <tr><th>Title</th><th>Artist</th><th>BPM</th><th>Key</th><th>Genre</th><th>Rating</th><th>Plays</th><th>Match</th></tr>
          </thead>
          <tbody>
            ${(state.analysisResult.tracks || []).slice(0, 200).map(t => `
              <tr>
                <td>${esc(t.title)}</td>
                <td>${esc(t.artists)}</td>
                <td>${t.bpm ?? ""}</td>
                <td>${t.key ?? ""}</td>
                <td>${esc(t.genre || "")}</td>
                <td>${t.rating ? "\u2605".repeat(t.rating) : ""}</td>
                <td>${t.plays_total || 0}</td>
                <td><span class="match-badge match-${t.matchType || "none"}">${t.matchType || "\u2014"}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
    ` : ""}

    ${state.loading ? '<div class="callout info">Analyse l\u00e4uft\u2026</div>' : ""}
  `;

  bindEvents();
}

// ─── Event-Binding ───────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById("eaDiscoverBtn")?.addEventListener("click", discoverDbs);
  document.getElementById("eaLoadPlaylistsBtn")?.addEventListener("click", loadPlaylists);
  document.getElementById("eaAnalyzeBtn")?.addEventListener("click", runAnalysis);
  document.getElementById("eaSelectAllBtn")?.addEventListener("click", selectAll);
  document.getElementById("eaSelectNoneBtn")?.addEventListener("click", selectNone);
  document.getElementById("eaLoadInSearchBtn")?.addEventListener("click", loadInSearch);
  document.getElementById("eaExportCsvBtn")?.addEventListener("click", exportCsv);
  document.getElementById("eaDatabaseFolder")?.addEventListener("change", (e) => {
    state.databaseFolder = e.target.value;
  });
  document.getElementById("eaDbSelect")?.addEventListener("change", (e) => {
    state.databaseFolder = e.target.value;
    const input = document.getElementById("eaDatabaseFolder");
    if (input) input.value = e.target.value;
  });

  // Checkbox-Handler fuer Playlist-Selection
  document.querySelectorAll(".ea-playlist-item input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", (e) => {
      if (e.target.checked) state.selectedPlaylistIds.add(e.target.value);
      else state.selectedPlaylistIds.delete(e.target.value);
      renderEngineAnalyzeTab();
    });
  });
}

// ─── Async Actions ───────────────────────────────────────────────────────────

async function discoverDbs() {
  try {
    const result = await window.engineAnalyzeApi.discoverDatabases();
    state.discoveredDbs = result?.databases || [];
    setMessage(`${state.discoveredDbs.length} Datenbanken gefunden`, "success");
  } catch (error) {
    setMessage(String(error.message || error), "warning");
  }
  renderEngineAnalyzeTab();
}

async function loadPlaylists() {
  try {
    const folder = document.getElementById("eaDatabaseFolder")?.value || state.databaseFolder;
    state.databaseFolder = folder;
    const result = await window.engineAnalyzeApi.listPlaylists({ databaseFolder: folder });
    state.playlists = result?.playlists || [];
    state.selectedPlaylistIds = new Set();
    setMessage(`${state.playlists.length} Playlisten geladen`, "success");
  } catch (error) {
    setMessage(String(error.message || error), "warning");
  }
  renderEngineAnalyzeTab();
}

async function runAnalysis() {
  state.loading = true;
  setMessage("Analyse l\u00e4uft\u2026", "info");
  renderEngineAnalyzeTab();
  try {
    const result = await window.engineAnalyzeApi.loadPlaylistTracks({
      databaseFolder: state.databaseFolder,
      playlistIds: Array.from(state.selectedPlaylistIds).join(","),
      scoringDataPath: "", // TODO: aus Settings laden oder Dateiauswahl
    });
    state.analysisResult = result;
    setMessage(`${result?.totalTracks || 0} Tracks analysiert`, "success");
  } catch (error) {
    setMessage(String(error.message || error), "warning");
  }
  state.loading = false;
  renderEngineAnalyzeTab();
}

function selectAll() {
  state.selectedPlaylistIds = new Set(state.playlists.map(p => String(p.id)));
  renderEngineAnalyzeTab();
}

function selectNone() {
  state.selectedPlaylistIds = new Set();
  renderEngineAnalyzeTab();
}

async function loadInSearch() {
  // Bridge zum Search-Tab — wird in Schritt 7 implementiert
  // Vorerst: Event dispatchen
  const tracks = state.analysisResult?.tracks || [];
  window.dispatchEvent(
    new CustomEvent("engine-analyze:load-in-search", {
      detail: { tracks, source: state.databaseFolder },
    })
  );
  setMessage(`${tracks.length} Tracks werden in die Suche geladen\u2026`, "info");
}

async function exportCsv() {
  // CSV-Export — rudimentaer, wird in Schritt 7/8 erweitert
  const tracks = state.analysisResult?.tracks || [];
  if (tracks.length === 0) {
    setMessage("Keine Tracks zum Exportieren vorhanden.", "warning");
    return;
  }
  const header = "Title;Artist;BPM;Key;Genre;Rating;Plays;MatchType";
  const rows = tracks.map(t =>
    [t.title, t.artists, t.bpm ?? "", t.key ?? "", t.genre || "", t.rating || "", t.plays_total || 0, t.matchType || ""]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(";")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "engine-analyze-export.csv";
  a.click();
  URL.revokeObjectURL(url);
  setMessage(`${tracks.length} Tracks als CSV exportiert`, "success");
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export async function initEngineAnalyzeTab() {
  renderEngineAnalyzeTab();
  if (!state.initialized) {
    state.initialized = true;
  }
}

export function forceReload() {
  state.analysisResult = null;
}
