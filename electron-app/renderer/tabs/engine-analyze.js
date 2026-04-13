// ─── Engine-Analyse Tab ──────────────────────────────────────────────────────
// Lädt Engine-DJ-Playlisten + History, matcht gegen Beatport-Scoring-Data
// und klassifiziert Tracks nach Energy/Danceability/Intensity.
// ─────────────────────────────────────────────────────────────────────────────

const EA_STORAGE_KEY = "beatport-suite-engine-analyze-v1";

const state = {
  initialized: false,
  databaseFolder: "",
  recentPaths: [],       // zuletzt verwendete DB-Pfade
  discoveredDbs: [],
  playlists: [],
  smartlists: [],
  historySessions: [],
  selectedPlaylistIds: new Set(),
  selectedSessionIds: new Set(),
  sourceMode: "playlists", // "playlists" | "history"
  analysisResult: null,
  loading: false,
  message: "",
  tone: "info",
};

// ─── Persistence ────────────────────────────────────────────────────────────

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(EA_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.databaseFolder = saved.databaseFolder || "";
    state.recentPaths = Array.isArray(saved.recentPaths) ? saved.recentPaths : [];
  } catch { /* ignore */ }
}

function persistState() {
  const toSave = {
    databaseFolder: state.databaseFolder,
    recentPaths: state.recentPaths.slice(0, 10),
  };
  localStorage.setItem(EA_STORAGE_KEY, JSON.stringify(toSave));
}

function addRecentPath(path) {
  if (!path) return;
  state.recentPaths = [path, ...state.recentPaths.filter(p => p !== path)].slice(0, 10);
  persistState();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Render ─────────────────────────────────────────────────────────────────

function renderEngineAnalyzeTab() {
  const container = document.getElementById("engine-analyze-content");
  if (!container) return;

  const hasData = state.playlists.length > 0 || state.historySessions.length > 0;
  const totalSelected = state.sourceMode === "playlists"
    ? state.selectedPlaylistIds.size
    : state.selectedSessionIds.size;

  container.innerHTML = `
    <!-- Workflow-Hinweis -->
    <section class="panel">
      <p class="detail-summary" style="margin:0">
        <strong>Workflow:</strong>
        1. Datenbank w\u00e4hlen (USB, Backup, lokal)
        \u2192 2. Playlisten oder History-Sessions laden
        \u2192 3. Ausw\u00e4hlen + Analysieren
        \u2192 4. Ergebnisse in Suche laden oder exportieren
      </p>
    </section>

    <!-- Section 1: DB-Auswahl -->
    <section class="panel">
      <div class="section-head">
        <h2>1 \u2014 Engine-Datenbank</h2>
        <div class="actions compact">
          <button id="eaDiscoverBtn" type="button" title="USB-Sticks und lokale Engine-Datenbanken automatisch finden">Erkennen</button>
        </div>
      </div>
      ${state.message ? `<div class="callout ${state.tone}">${esc(state.message)}</div>` : ""}
      <div class="field-grid">
        <label class="wide">
          Datenbankpfad
          <input id="eaDatabaseFolder" type="text" value="${esc(state.databaseFolder)}"
                 placeholder="/Volumes/USB/Engine Library/Database2" />
        </label>
      </div>
      ${state.recentPaths.length > 0 ? `
        <details class="cockpit-acc" style="margin-top:8px">
          <summary>Zuletzt verwendet (${state.recentPaths.length})</summary>
          <div class="acc-body">
            ${state.recentPaths.map(p => `
              <div class="ea-recent-path" data-path="${esc(p)}">${esc(p)}</div>
            `).join("")}
          </div>
        </details>
      ` : ""}
      ${state.discoveredDbs.length > 0 ? `
        <select id="eaDbSelect" style="margin-top:8px">
          <option value="">Gefundene Datenbank w\u00e4hlen\u2026</option>
          ${state.discoveredDbs.map(db => `
            <option value="${esc(db.path)}" ${db.path === state.databaseFolder ? "selected" : ""}>
              ${esc(db.volume)} (${db.source}) \u2014 ${esc(db.path)}
            </option>
          `).join("")}
        </select>
      ` : ""}
      <div class="actions compact" style="margin-top:10px">
        <button id="eaLoadDataBtn" class="primary" type="button" ${!state.databaseFolder ? "disabled" : ""}>
          Playlisten + History laden
        </button>
      </div>
    </section>

    <!-- Section 2: Quellen-Auswahl (Playlisten / History) -->
    ${hasData ? `
    <section class="panel">
      <div class="section-head">
        <h2>2 \u2014 Quelle ausw\u00e4hlen</h2>
        <div class="actions compact">
          <button id="eaModePlaylistsBtn" type="button" class="${state.sourceMode === "playlists" ? "primary" : ""}">
            Playlisten (${state.playlists.length})
          </button>
          <button id="eaModeHistoryBtn" type="button" class="${state.sourceMode === "history" ? "primary" : ""}">
            History (${state.historySessions.length})
          </button>
        </div>
      </div>

      ${state.sourceMode === "playlists" ? `
        <!-- Playlist-Picker -->
        <div class="actions compact" style="margin-bottom:8px">
          <button id="eaSelectAllBtn" type="button">Alle</button>
          <button id="eaSelectNoneBtn" type="button">Keine</button>
          <span style="color:var(--muted);font-size:12px;margin-left:8px">
            ${state.selectedPlaylistIds.size} ausgew\u00e4hlt
          </span>
        </div>
        ${state.smartlists.length > 0 ? `
          <p style="font-size:11px;color:var(--muted);margin:0 0 6px">
            \u{1F4CB} ${state.smartlists.length} Smartlists vorhanden (werden nicht aufgel\u00f6st)
          </p>
        ` : ""}
        <div class="table-wrap" style="max-height:320px">
          <table class="data-table ea-pick-table">
            <thead><tr><th style="width:32px"></th><th>Playlist</th><th style="text-align:right">Tracks</th></tr></thead>
            <tbody>
              ${state.playlists.map(pl => `
                <tr class="ea-pick-row" data-id="${pl.id}">
                  <td><input type="checkbox" value="${pl.id}"
                       ${state.selectedPlaylistIds.has(String(pl.id)) ? "checked" : ""} /></td>
                  <td>${pl.isPersisted === 0 ? "\uD83D\uDEAB " : ""}${esc(pl.title)}</td>
                  <td style="text-align:right;color:var(--muted)">${pl.trackCount ?? 0}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `
        <!-- History-Session-Picker -->
        <div class="actions compact" style="margin-bottom:8px">
          <button id="eaSelectAllHistBtn" type="button">Alle</button>
          <button id="eaSelectNoneHistBtn" type="button">Keine</button>
          <span style="color:var(--muted);font-size:12px;margin-left:8px">
            ${state.selectedSessionIds.size} ausgew\u00e4hlt
          </span>
        </div>
        <div class="table-wrap" style="max-height:320px">
          <table class="data-table ea-pick-table">
            <thead><tr><th style="width:32px"></th><th>Session</th><th>Datum</th></tr></thead>
            <tbody>
              ${state.historySessions.map(s => `
                <tr class="ea-pick-row" data-id="${s.id}" data-type="session">
                  <td><input type="checkbox" value="${s.id}" data-type="session"
                       ${state.selectedSessionIds.has(String(s.id)) ? "checked" : ""} /></td>
                  <td>${esc(s.title || `Session #${s.id}`)}</td>
                  <td style="color:var(--muted)">${esc(s.startTime)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `}
    </section>

    <!-- Analyse starten -->
    <section class="panel">
      <div class="section-head">
        <h2>3 \u2014 Analysieren</h2>
        <div class="actions compact">
          <button id="eaAnalyzeBtn" class="primary" type="button"
                  ${totalSelected === 0 ? "disabled" : ""}>
            ${totalSelected} ${state.sourceMode === "playlists" ? "Playlisten" : "Sessions"} analysieren
          </button>
        </div>
      </div>
      <p class="detail-summary" style="margin:0">
        Tracks werden extrahiert, gegen scoring-data.json gematcht und durch den Performance-Classifier geschickt.
      </p>
    </section>
    ` : ""}

    <!-- Section 4: Ergebnisse -->
    ${state.analysisResult ? `
    <section class="panel">
      <div class="section-head">
        <h2>4 \u2014 Ergebnisse</h2>
        <div class="actions compact">
          <button id="eaLoadInSearchBtn" type="button">In Suche laden</button>
          <button id="eaExportCsvBtn" type="button">CSV Export</button>
        </div>
      </div>

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

// ─── Event-Binding ──────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById("eaDiscoverBtn")?.addEventListener("click", discoverDbs);
  document.getElementById("eaLoadDataBtn")?.addEventListener("click", loadAllData);
  document.getElementById("eaAnalyzeBtn")?.addEventListener("click", runAnalysis);
  document.getElementById("eaSelectAllBtn")?.addEventListener("click", () => {
    state.selectedPlaylistIds = new Set(state.playlists.map(p => String(p.id)));
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaSelectNoneBtn")?.addEventListener("click", () => {
    state.selectedPlaylistIds = new Set();
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaSelectAllHistBtn")?.addEventListener("click", () => {
    state.selectedSessionIds = new Set(state.historySessions.map(s => String(s.id)));
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaSelectNoneHistBtn")?.addEventListener("click", () => {
    state.selectedSessionIds = new Set();
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaModePlaylistsBtn")?.addEventListener("click", () => {
    state.sourceMode = "playlists";
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaModeHistoryBtn")?.addEventListener("click", () => {
    state.sourceMode = "history";
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaLoadInSearchBtn")?.addEventListener("click", loadInSearch);
  document.getElementById("eaExportCsvBtn")?.addEventListener("click", exportCsv);

  document.getElementById("eaDatabaseFolder")?.addEventListener("input", (e) => {
    state.databaseFolder = e.target.value;
    const btn = document.getElementById("eaLoadDataBtn");
    if (btn) btn.disabled = !e.target.value;
  });
  document.getElementById("eaDbSelect")?.addEventListener("change", (e) => {
    state.databaseFolder = e.target.value;
    const input = document.getElementById("eaDatabaseFolder");
    if (input) input.value = e.target.value;
  });

  // Recent paths klickbar
  document.querySelectorAll(".ea-recent-path").forEach(el => {
    el.addEventListener("click", () => {
      state.databaseFolder = el.dataset.path;
      const input = document.getElementById("eaDatabaseFolder");
      if (input) input.value = el.dataset.path;
      renderEngineAnalyzeTab();
    });
  });

  // Checkbox-Handler (Tabellen-Rows klickbar)
  document.querySelectorAll(".ea-pick-row").forEach(row => {
    const cb = row.querySelector("input[type=checkbox]");
    if (!cb) return;
    row.addEventListener("click", (e) => {
      if (e.target === cb) return; // Checkbox selbst handled sich
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
    cb.addEventListener("change", () => {
      const isSession = cb.dataset.type === "session";
      const set = isSession ? state.selectedSessionIds : state.selectedPlaylistIds;
      if (cb.checked) set.add(cb.value);
      else set.delete(cb.value);
      // Leichtgewichtiges Update: nur Counter + Button aktualisieren
      const total = state.sourceMode === "playlists" ? state.selectedPlaylistIds.size : state.selectedSessionIds.size;
      const analyzeBtn = document.getElementById("eaAnalyzeBtn");
      if (analyzeBtn) {
        analyzeBtn.disabled = total === 0;
        analyzeBtn.textContent = `${total} ${state.sourceMode === "playlists" ? "Playlisten" : "Sessions"} analysieren`;
      }
    });
  });
}

// ─── Async Actions ──────────────────────────────────────────────────────────

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

async function loadAllData() {
  const folder = document.getElementById("eaDatabaseFolder")?.value || state.databaseFolder;
  if (!folder) {
    setMessage("Bitte zuerst einen Datenbankpfad eingeben.", "warning");
    renderEngineAnalyzeTab();
    return;
  }
  state.databaseFolder = folder;
  addRecentPath(folder);

  try {
    // Playlisten + History parallel laden
    const [plResult, histResult] = await Promise.all([
      window.engineAnalyzeApi.listPlaylists({ databaseFolder: folder }),
      window.engineAnalyzeApi.listHistorySessions({ engineDatabaseFolder: folder }).catch(() => ({ sessions: [] })),
    ]);

    state.playlists = plResult?.playlists || [];
    state.smartlists = plResult?.smartlists || [];
    state.historySessions = histResult?.sessions || [];
    state.selectedPlaylistIds = new Set();
    state.selectedSessionIds = new Set();
    state.analysisResult = null;

    const parts = [`${state.playlists.length} Playlisten`];
    if (state.historySessions.length > 0) parts.push(`${state.historySessions.length} History-Sessions`);
    if (state.smartlists.length > 0) parts.push(`${state.smartlists.length} Smartlists`);
    setMessage(parts.join(", ") + " geladen", "success");
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
      scoringDataPath: "",
    });
    state.analysisResult = result;
    setMessage(`${result?.totalTracks || 0} Tracks analysiert`, "success");
  } catch (error) {
    setMessage(String(error.message || error), "warning");
  }
  state.loading = false;
  renderEngineAnalyzeTab();
}

async function loadInSearch() {
  const tracks = state.analysisResult?.tracks || [];
  window.dispatchEvent(
    new CustomEvent("engine-analyze:load-in-search", {
      detail: { tracks, source: state.databaseFolder },
    })
  );
  setMessage(`${tracks.length} Tracks werden in die Suche geladen\u2026`, "info");
}

async function exportCsv() {
  const tracks = state.analysisResult?.tracks || [];
  if (tracks.length === 0) {
    setMessage("Keine Tracks zum Exportieren.", "warning");
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

// ─── Exports ────────────────────────────────────────────────────────────────

export async function initEngineAnalyzeTab() {
  loadPersistedState();
  renderEngineAnalyzeTab();
  if (!state.initialized) {
    state.initialized = true;
  }
}

export function forceReload() {
  state.analysisResult = null;
}
