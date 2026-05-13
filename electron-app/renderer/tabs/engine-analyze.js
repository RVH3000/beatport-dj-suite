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
  sourceMode: "playlists", // "playlists" | "history" | "stats"
  historySort: "desc",     // "asc" (alt→neu) | "desc" (neu→alt)
  analysisResults: [],     // Verlauf: [{source, sourceMode, result, timestamp}]
  analysisResult: null,    // aktive Anzeige
  trackStats: null,        // Ergebnis von aggregate_track_stats()
  statsSortKey: "total_plays",
  statsSortAsc: false,
  statsFilter: "all",      // "all" | "streaming" | "local" | "duplicates"
  sortKey: "title",
  sortAsc: true,
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
// esc + camelotSortVal aus konsolidierter Lib (Phase 1 Backlog-Punkt 33).

import { esc, camelotSortVal } from "../lib/track-utils.js";

function setMessage(text, tone = "info") {
  state.message = text;
  state.tone = tone;
}

function formatTimestamp(val) {
  if (!val) return "";
  // Unix-Timestamp (Sekunden oder Millisekunden)
  let ts = Number(val);
  if (isNaN(ts)) {
    // Schon ein Datums-String (z.B. "2025-10-31 17:21:57")
    return String(val);
  }
  if (ts > 1e12) ts = ts / 1000; // ms → s
  if (ts < 1e8) return String(val); // zu klein, kein Timestamp
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Key → Camelot Mapping ──────────────────────────────────────────────────

const KEY_TO_CAMELOT = {
  "C": "8B", "Am": "8A", "Cm": "5A", "C#": "3B", "Db": "3B", "C#m": "12A", "Dbm": "12A",
  "D": "10B", "Dm": "7A", "D#": "5B", "Eb": "5B", "D#m": "2A", "Ebm": "2A",
  "E": "12B", "Em": "9A", "F": "7B", "Fm": "4A",
  "F#": "2B", "Gb": "2B", "F#m": "11A", "Gbm": "11A",
  "G": "9B", "Gm": "6A", "G#": "4B", "Ab": "4B", "G#m": "1A", "Abm": "1A",
  "A": "11B", "Bb": "6B", "A#": "6B", "A#m": "3A", "Bbm": "3A",
  "B": "1B", "Bm": "10A",
  // Engine DJ speichert numerisch (0-23)
  "0": "8B", "1": "8A", "2": "3B", "3": "12A", "4": "10B", "5": "7A",
  "6": "5B", "7": "2A", "8": "12B", "9": "9A", "10": "7B", "11": "4A",
  "12": "2B", "13": "11A", "14": "9B", "15": "6A", "16": "4B", "17": "1A",
  "18": "11B", "19": "10A", "20": "6B", "21": "3A", "22": "1B", "23": "10A",
};

function toCamelot(key) {
  if (!key && key !== 0) return "";
  const k = String(key).trim();
  // Schon Camelot-Format (z.B. "8A", "11B")
  if (/^\d{1,2}[AB]$/i.test(k)) return k.toUpperCase();
  return KEY_TO_CAMELOT[k] || k;
}

// ─── Result Columns ─────────────────────────────────────────────────────────

function getResultColumns() {
  const base = [
    { key: "title",       label: "Title" },
    { key: "artists",     label: "Artist" },
    { key: "bpm",         label: "BPM",     numeric: true },
    { key: "camelot",     label: "Camelot" },
    { key: "genre",       label: "Genre" },
    { key: "rating",      label: "Rating",  numeric: true },
    { key: "plays_total", label: "Plays",   numeric: true },
    { key: "matchType",   label: "Match" },
  ];
  // History: Spielzeit-Spalte einfügen nach Plays
  if (state.sourceMode === "history") {
    base.splice(7, 0, { key: "startTime", label: "Gespielt" });
  }
  return base;
}

function sortArrow(key) {
  if (state.sortKey !== key) return "";
  return state.sortAsc ? " \u25B2" : " \u25BC";
}

function getSortedTracks() {
  const tracks = state.analysisResult?.tracks || [];
  if (!tracks.length) return tracks;
  const cols = getResultColumns();
  const col = cols.find(c => c.key === state.sortKey);
  const sorted = [...tracks].sort((a, b) => {
    let va = a[state.sortKey] ?? "";
    let vb = b[state.sortKey] ?? "";
    if (state.sortKey === "camelot") return camelotSortVal(va) - camelotSortVal(vb);
    if (col?.numeric) return (Number(va) || 0) - (Number(vb) || 0);
    return String(va).localeCompare(String(vb), "de", { sensitivity: "base" });
  });
  return state.sortAsc ? sorted : sorted.reverse();
}

function renderTrackCell(t, colKey) {
  switch (colKey) {
    case "title": return esc(t.title);
    case "artists": return esc(t.artists);
    case "bpm": return t.bpm ?? "";
    case "camelot": return `<span style="color:#b197fc;font-weight:700">${esc(t.camelot || "")}</span>`;
    case "genre": return esc(t.genre || "");
    case "rating": return t.rating ? "\u2605".repeat(t.rating) : "";
    case "plays_total": return t.plays_total || 0;
    case "startTime": return esc(formatTimestamp(t.startTime || t.last_played));
    case "matchType": return `<span class="match-badge match-${t.matchType || "none"}">${t.matchType || "\u2014"}</span>`;
    default: return esc(t[colKey] ?? "");
  }
}

// ─── Stats Columns & Rendering ──────────────────────────────────────────────

function getStatsColumns() {
  return [
    { key: "title",                label: "Title" },
    { key: "artists",              label: "Artist" },
    { key: "total_plays",          label: "Plays",     numeric: true },
    { key: "unique_sessions",      label: "Sessions",  numeric: true },
    { key: "duplicates_in_sessions", label: "Dupes",   numeric: true },
    { key: "bpm",                  label: "BPM",       numeric: true },
    { key: "camelot",              label: "Camelot" },
    { key: "genre",                label: "Genre" },
    { key: "rating",               label: "Rating",    numeric: true },
    { key: "last_played",          label: "Zuletzt" },
  ];
}

function getFilteredStatsTracks() {
  const tracks = state.trackStats?.tracks || [];
  if (state.statsFilter === "streaming") return tracks.filter(t => t.is_streaming);
  if (state.statsFilter === "local") return tracks.filter(t => !t.is_streaming);
  if (state.statsFilter === "duplicates") return tracks.filter(t => t.duplicates_in_sessions > 0);
  return tracks;
}

function getSortedStatsTracks() {
  const tracks = getFilteredStatsTracks();
  if (!tracks.length) return tracks;
  const cols = getStatsColumns();
  const col = cols.find(c => c.key === state.statsSortKey);
  const sorted = [...tracks].sort((a, b) => {
    let va = a[state.statsSortKey] ?? "";
    let vb = b[state.statsSortKey] ?? "";
    if (state.statsSortKey === "camelot") return camelotSortVal(toCamelot(va)) - camelotSortVal(toCamelot(vb));
    if (col?.numeric) return (Number(va) || 0) - (Number(vb) || 0);
    return String(va).localeCompare(String(vb), "de", { sensitivity: "base" });
  });
  return state.statsSortAsc ? sorted : sorted.reverse();
}

function statsSortArrow(key) {
  if (state.statsSortKey !== key) return "";
  return state.statsSortAsc ? " \u25B2" : " \u25BC";
}

function renderStatsCell(t, colKey) {
  switch (colKey) {
    case "title": {
      const icon = t.is_streaming ? '<span title="Beatport Streaming">\uD83C\uDF10</span> ' : "";
      return icon + esc(t.title || "");
    }
    case "artists": return esc(t.artists || "");
    case "total_plays": return `<strong>${t.total_plays || 0}</strong>`;
    case "unique_sessions": return t.unique_sessions || 0;
    case "duplicates_in_sessions": return t.duplicates_in_sessions > 0
      ? `<span style="color:#e5534b">${t.duplicates_in_sessions}</span>` : "\u2014";
    case "bpm": return t.bpm ?? "";
    case "camelot": return `<span style="color:#b197fc;font-weight:700">${esc(toCamelot(t.key) || "")}</span>`;
    case "genre": return esc(t.genre || "");
    case "rating": return t.rating ? "\u2605".repeat(t.rating) : "";
    case "last_played": return esc(formatTimestamp(t.last_played));
    default: return esc(t[colKey] ?? "");
  }
}

function renderStatsView() {
  const s = state.trackStats;
  if (!s) return "";
  const cols = getStatsColumns();
  const filtered = getFilteredStatsTracks();
  const sorted = getSortedStatsTracks();

  return `
    <section class="panel">
      <div class="section-head">
        <h2>Track-Statistik</h2>
        <div class="actions compact">
          <button id="eaStatsToBuilderBtn" class="primary" type="button"
                  title="Gefilterte Tracks zum Playlist Builder hinzuf\u00fcgen">Zum Builder</button>
          <button id="eaSaveAsPlaylistBtn" type="button"
                  title="Gefilterte Tracks als neue Engine-DJ-Playlist speichern">Als Playlist speichern</button>
          <button id="eaStatsExportBtn" type="button">CSV Export</button>
        </div>
      </div>

      <div class="automation-stats">
        <div class="stat-card">
          <span class="stat-label">Sessions</span>
          <strong class="stat-value">${s.total_sessions}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Unique Tracks</span>
          <strong class="stat-value">${s.total_unique_tracks}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total Plays</span>
          <strong class="stat-value">${s.total_plays}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Duplikate</span>
          <strong class="stat-value" ${s.total_duplicates > 0 ? 'style="color:#e5534b"' : ""}>${s.total_duplicates}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Streaming</span>
          <strong class="stat-value">${s.streaming_tracks}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Lokal</span>
          <strong class="stat-value">${s.local_tracks}</strong>
        </div>
      </div>

      <div class="actions compact" style="margin:10px 0">
        <button class="ea-stats-filter ${state.statsFilter === "all" ? "primary" : ""}" data-filter="all" type="button">
          Alle (${s.total_unique_tracks})
        </button>
        <button class="ea-stats-filter ${state.statsFilter === "streaming" ? "primary" : ""}" data-filter="streaming" type="button">
          Streaming (${s.streaming_tracks})
        </button>
        <button class="ea-stats-filter ${state.statsFilter === "local" ? "primary" : ""}" data-filter="local" type="button">
          Lokal (${s.local_tracks})
        </button>
        <button class="ea-stats-filter ${state.statsFilter === "duplicates" ? "primary" : ""}" data-filter="duplicates" type="button">
          Mit Duplikaten (${s.total_duplicates > 0 ? s.tracks.filter(t => t.duplicates_in_sessions > 0).length : 0})
        </button>
      </div>

      <div class="table-wrap" style="max-height:500px">
        <table class="data-table">
          <thead>
            <tr>${cols.map(c =>
              `<th class="ea-stats-sortable" data-sort="${c.key}" style="cursor:pointer;user-select:none">${c.label}${statsSortArrow(c.key)}</th>`
            ).join("")}</tr>
          </thead>
          <tbody>
            ${sorted.slice(0, 300).map(t => `
              <tr>
                ${cols.map(c => `<td${c.key === "title" || c.key === "artists" ? ' class="wrap-cell"' : ""}>${renderStatsCell(t, c.key)}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${filtered.length > 300 ? `<p style="color:var(--muted);font-size:12px;margin-top:4px">Zeige 300 von ${filtered.length} Tracks</p>` : ""}
    </section>`;
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
          <button id="eaModeStatsBtn" type="button" class="${state.sourceMode === "stats" ? "primary" : ""}"
                  title="Aggregierte Track-Statistiken \u00fcber alle History-Sessions">
            \uD83D\uDCCA Stats
          </button>
        </div>
      </div>

      ${state.sourceMode === "stats" ? `
        <!-- Stats-Modus: kein Picker n\u00f6tig, l\u00e4dt alle Sessions -->
        <p class="detail-summary" style="margin:0 0 10px">
          L\u00e4dt <strong>alle</strong> History-Sessions und aggregiert Plays, Duplikate und Session-Vorkommen pro Track.
        </p>
      ` : state.sourceMode === "playlists" ? `
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
              ${state.playlists.map(pl => {
                const sel = state.selectedPlaylistIds.has(String(pl.id));
                return `
                <tr class="ea-pick-row table-row-clickable${sel ? " is-selected" : ""}" data-id="${pl.id}">
                  <td><input type="checkbox" value="${pl.id}" ${sel ? "checked" : ""} /></td>
                  <td>${pl.isPersisted === 0 ? "\uD83D\uDEAB " : ""}${esc(pl.title)}</td>
                  <td style="text-align:right;color:var(--muted)">${pl.trackCount ?? 0}</td>
                </tr>`;
              }).join("")}
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
            <thead><tr>
              <th style="width:32px"></th>
              <th>Session</th>
              <th id="eaHistSortBtn" style="cursor:pointer;user-select:none" title="Klick zum Sortieren">
                Datum ${state.historySort === "asc" ? "\u25B2" : "\u25BC"}
              </th>
            </tr></thead>
            <tbody>
              ${[...state.historySessions]
                .sort((a, b) => state.historySort === "asc"
                  ? String(a.startTime).localeCompare(String(b.startTime))
                  : String(b.startTime).localeCompare(String(a.startTime))
                )
                .map(s => {
                const sel = state.selectedSessionIds.has(String(s.id));
                return `
                <tr class="ea-pick-row table-row-clickable${sel ? " is-selected" : ""}" data-id="${s.id}" data-type="session">
                  <td><input type="checkbox" value="${s.id}" data-type="session" ${sel ? "checked" : ""} /></td>
                  <td>${esc(s.title || `Session #${s.id}`)}</td>
                  <td style="color:var(--muted)">${esc(formatTimestamp(s.startTime))}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      `}
    </section>

    <!-- Analyse starten -->
    <section class="panel">
      <div class="section-head">
        <h2>3 \u2014 ${state.sourceMode === "stats" ? "Track-Statistik" : "Analysieren"}</h2>
        <div class="actions compact">
          ${state.sourceMode === "stats" ? `
          <button id="eaStatsBtn" class="primary" type="button">
            \uD83D\uDCCA Track-Stats laden
          </button>
          ` : `
          <button id="eaAnalyzeBtn" class="primary" type="button"
                  ${totalSelected === 0 ? "disabled" : ""}>
            ${totalSelected} ${state.sourceMode === "playlists" ? "Playlisten" : "Sessions"} analysieren
          </button>
          `}
        </div>
      </div>
      <p class="detail-summary" style="margin:0">
        ${state.sourceMode === "stats"
          ? "Aggregiert Plays, Duplikate und Session-Vorkommen \u00fcber alle History-Sessions."
          : "Tracks werden extrahiert, gegen scoring-data.json gematcht und durch den Performance-Classifier geschickt."}
      </p>
    </section>
    ` : ""}

    <!-- Analyse-Verlauf (Tabs fuer mehrere Ergebnisse) -->
    ${state.analysisResults.length > 0 ? `
    <section class="panel">
      <div class="section-head">
        <h2>4 \u2014 Ergebnisse</h2>
        <div class="actions compact">
          <button id="eaToBuilderBtn" class="primary" type="button" title="Alle Tracks zum Playlist Builder hinzuf\u00fcgen">Zum Builder</button>
          <button id="eaLoadInSearchBtn" type="button">In Suche laden</button>
          <button id="eaExportCsvBtn" type="button">CSV Export</button>
        </div>
      </div>

      ${state.analysisResults.length > 1 ? `
      <div class="actions compact" style="margin-bottom:10px">
        ${state.analysisResults.map((entry, idx) => `
          <button class="ea-result-tab ${state.analysisResult === entry.result ? "primary" : ""}"
                  data-result-idx="${idx}" type="button">
            ${entry.sourceMode === "history" ? "\uD83D\uDCCA" : "\uD83C\uDFB5"} ${esc(entry.label)}
          </button>
        `).join("")}
      </div>
      ` : ""}

      ${state.analysisResult ? (() => {
        const r = state.analysisResult;
        const activeEntry = state.analysisResults.find(e => e.result === r);
        const isHistory = activeEntry?.sourceMode === "history";
        const cols = getResultColumns();
        return `
      <div class="detail-summary">
        <strong>${isHistory ? "\uD83D\uDCCA History" : "\uD83C\uDFB5 Playlist"}:</strong>
        ${r.matchStats ? `
          ${r.matchStats.total} Tracks |
          Gematcht: ${r.matchStats.total - (r.matchStats.none || 0)}
          (${r.matchStats.matchRate}%) |
          <span class="match-exact">${r.matchStats.exact_id || 0} Beatport-ID</span> |
          <span class="match-title">${r.matchStats.title_artist || 0} Title/Artist</span> |
          <span class="match-fuzzy">${r.matchStats.fuzzy || 0} Fuzzy</span> |
          <span class="match-none">${r.matchStats.none || 0} kein Match</span>
        ` : `${r.totalTracks} Tracks (kein Scoring-Data)`}
      </div>

      ${r.classifierSummary?.summary ? `
      <div class="automation-stats">
        ${["count", "avgEnergy", "avgDanceability", "avgIntensity"].map(key => `
          <div class="stat-card">
            <span class="stat-label">${key === "count" ? "Tracks" : key.replace("avg", "\u00D8 ")}</span>
            <strong class="stat-value">${r.classifierSummary.summary[key] ?? 0}</strong>
          </div>
        `).join("")}
      </div>
      ` : ""}

      <div class="table-wrap" style="max-height:500px">
        <table class="data-table">
          <thead>
            <tr>${cols.map(c =>
              `<th class="ea-sortable" data-sort="${c.key}" style="cursor:pointer;user-select:none">${c.label}${sortArrow(c.key)}</th>`
            ).join("")}</tr>
          </thead>
          <tbody>
            ${getSortedTracks().slice(0, 200).map(t => `
              <tr>
                ${cols.map(c => `<td${c.key === "title" || c.key === "artists" ? ' class="wrap-cell"' : ""}>${renderTrackCell(t, c.key)}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
      })() : ""}
    </section>
    ` : ""}

    ${state.trackStats ? renderStatsView() : ""}

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
  document.getElementById("eaModeStatsBtn")?.addEventListener("click", () => {
    state.sourceMode = "stats";
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaStatsBtn")?.addEventListener("click", loadTrackStats);
  document.getElementById("eaHistSortBtn")?.addEventListener("click", () => {
    state.historySort = state.historySort === "asc" ? "desc" : "asc";
    renderEngineAnalyzeTab();
  });
  document.getElementById("eaToBuilderBtn")?.addEventListener("click", sendToBuilder);
  document.getElementById("eaLoadInSearchBtn")?.addEventListener("click", loadInSearch);
  document.getElementById("eaExportCsvBtn")?.addEventListener("click", exportCsv);

  // Ergebnis-Tabs umschalten
  document.querySelectorAll(".ea-result-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.resultIdx);
      const entry = state.analysisResults[idx];
      if (entry) {
        state.analysisResult = entry.result;
        state.sourceMode = entry.sourceMode;
        renderEngineAnalyzeTab();
      }
    });
  });

  // Stats: Filter-Buttons
  document.querySelectorAll(".ea-stats-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      state.statsFilter = btn.dataset.filter;
      renderEngineAnalyzeTab();
    });
  });

  // Stats: Sortierbare Spalten-Header
  document.querySelectorAll(".ea-stats-sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.statsSortKey === key) { state.statsSortAsc = !state.statsSortAsc; }
      else { state.statsSortKey = key; state.statsSortAsc = false; }
      renderEngineAnalyzeTab();
    });
  });

  // Stats: Builder + CSV-Export + Playlist speichern
  document.getElementById("eaStatsToBuilderBtn")?.addEventListener("click", sendStatsToBuilder);
  document.getElementById("eaStatsExportBtn")?.addEventListener("click", exportStatsCsv);
  document.getElementById("eaSaveAsPlaylistBtn")?.addEventListener("click", saveStatsAsPlaylist);

  // Sortierbare Spalten-Header
  document.querySelectorAll(".ea-sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) { state.sortAsc = !state.sortAsc; }
      else { state.sortKey = key; state.sortAsc = true; }
      renderEngineAnalyzeTab();
    });
  });

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
      sourceMode: state.sourceMode,
      playlistIds: state.sourceMode === "playlists" ? Array.from(state.selectedPlaylistIds).join(",") : "",
      sessionIds: state.sourceMode === "history" ? Array.from(state.selectedSessionIds).join(",") : "",
      scoringDataPath: "",
    });

    // Camelot-Konvertierung fuer alle Tracks
    if (result?.tracks) {
      for (const t of result.tracks) {
        t.camelot = toCamelot(t.key);
      }
    }

    // History: Default-Sortierung nach Spielzeit
    if (state.sourceMode === "history") {
      state.sortKey = "startTime";
      state.sortAsc = true;
    }

    state.analysisResult = result;

    // In Verlauf speichern
    const label = state.sourceMode === "history"
      ? `History (${result?.totalTracks || 0})`
      : `Playlist (${result?.totalTracks || 0})`;
    state.analysisResults.push({
      label,
      sourceMode: state.sourceMode,
      result,
      timestamp: new Date().toISOString(),
    });

    setMessage(`${result?.totalTracks || 0} Tracks analysiert`, "success");
  } catch (error) {
    setMessage(String(error.message || error), "warning");
  }
  state.loading = false;
  renderEngineAnalyzeTab();
}

function sendToBuilder() {
  const tracks = state.analysisResult?.tracks || [];
  if (tracks.length === 0) {
    setMessage("Keine Tracks vorhanden.", "warning");
    return;
  }
  window.dispatchEvent(new CustomEvent("builder:add-tracks", { detail: { tracks } }));
  setMessage(`${tracks.length} Tracks zum Builder gesendet`, "success");
}

function sendStatsToBuilder() {
  const tracks = getFilteredStatsTracks();
  if (tracks.length === 0) {
    setMessage("Keine Tracks vorhanden.", "warning");
    return;
  }
  window.dispatchEvent(new CustomEvent("builder:add-tracks", { detail: { tracks } }));
  setMessage(`${tracks.length} Tracks zum Builder gesendet`, "success");
}

async function loadTrackStats() {
  state.loading = true;
  setMessage("Track-Statistik wird geladen\u2026", "info");
  renderEngineAnalyzeTab();
  try {
    const result = await window.engineAnalyzeApi.trackStats({
      databaseFolder: state.databaseFolder,
    });
    if (!result?.ok) {
      setMessage(result?.error || "Fehler beim Laden", "warning");
    } else {
      state.trackStats = result;
      setMessage(
        `${result.total_unique_tracks} Tracks, ${result.total_plays} Plays, ${result.total_sessions} Sessions`,
        "success"
      );
    }
  } catch (error) {
    setMessage(String(error.message || error), "warning");
  }
  state.loading = false;
  renderEngineAnalyzeTab();
}

async function saveStatsAsPlaylist() {
  const tracks = getFilteredStatsTracks();
  if (tracks.length === 0) {
    setMessage("Keine Tracks zum Speichern.", "warning");
    return;
  }

  // Nur Streaming-Tracks k\u00f6nnen als Streaming-Playlist geschrieben werden
  const streamingTracks = tracks.filter(t => t.beatport_id);
  if (streamingTracks.length === 0) {
    setMessage("Keine Streaming-Tracks mit Beatport-ID vorhanden. Nur Beatport-Streaming-Tracks k\u00f6nnen als Playlist geschrieben werden.", "warning");
    return;
  }

  const name = prompt(
    `Playlist-Name f\u00fcr ${streamingTracks.length} Streaming-Tracks:`,
    `Stats Top ${Math.min(streamingTracks.length, 50)} \u2014 ${new Date().toISOString().slice(0, 10)}`
  );
  if (!name) return;

  state.loading = true;
  setMessage(`Playlist "${name}" wird geschrieben\u2026`, "info");
  renderEngineAnalyzeTab();

  try {
    // Tracks im scoring-data Format aufbereiten
    const importTracks = streamingTracks.map(t => ({
      track_id: t.beatport_id,
      title: t.title || "",
      artists: t.artists || "",
      genre: t.genre || "",
      bpm: t.bpm || 0,
      label: t.label || "",
      year: t.year || 0,
      length_ms: t.length_ms || 0,
    }));

    const result = await window.engineAnalyzeApi.saveAsPlaylist({
      tracks: importTracks,
      playlistTitle: name,
      databaseFolder: state.databaseFolder,
    });

    if (result?.ok) {
      const msg = [
        `Playlist "${name}" gespeichert!`,
        `${result.tracksCreated || 0} neu`,
        `${result.tracksExisted || 0} existierten`,
        `${result.entityCount || 0} Playlist-Eintr\u00e4ge`,
      ];
      if (result.backupPath) msg.push(`Backup: ${result.backupPath}`);
      setMessage(msg.join(" \u2014 "), "success");
    } else {
      setMessage(result?.error || "Fehler beim Schreiben", "warning");
    }
  } catch (error) {
    setMessage(String(error.message || error), "warning");
  }
  state.loading = false;
  renderEngineAnalyzeTab();
}

async function exportStatsCsv() {
  const tracks = getFilteredStatsTracks();
  if (tracks.length === 0) {
    setMessage("Keine Tracks zum Exportieren.", "warning");
    return;
  }
  const header = "Title;Artist;Plays;Sessions;Duplikate;BPM;Key;Genre;Rating;Streaming;Zuletzt gespielt";
  const rows = tracks.map(t =>
    [
      t.title, t.artists, t.total_plays, t.unique_sessions,
      t.duplicates_in_sessions, t.bpm ?? "", t.key ?? "",
      t.genre || "", t.rating || "", t.is_streaming ? "Ja" : "Nein",
      formatTimestamp(t.last_played),
    ]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(";")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `engine-track-stats-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  setMessage(`${tracks.length} Tracks exportiert`, "success");
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
  const header = "Title;Artist;BPM;Key;Camelot;Genre;Rating;Plays;MatchType";
  const rows = tracks.map(t =>
    [t.title, t.artists, t.bpm ?? "", t.key ?? "", t.camelot || "", t.genre || "", t.rating || "", t.plays_total || 0, t.matchType || ""]
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
