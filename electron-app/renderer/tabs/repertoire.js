/**
 * Repertoire-Tab (v4.6.0) — Artists aus dem Scanner-Universum
 * (scoring-data.json, lokal aggregiert).
 *
 * Semantik: alle Artists deren Tracks in deinen 1.580 gescanten Playlists
 * vorkommen (Charts, gefolgte Playlists, Editorial). ~25.000 Eintraege.
 * Im Gegensatz zum Artists-Tab (myBeatport-Followed via API) ist das eine
 * analytische Uebersicht — KEINE Cover-Bilder, daher dichte Listen-Ansicht
 * mit Initial-Bubbles + reichen Metadaten (Track-Count, Plays, Genres, Labels,
 * Year-Range, BPM-Range).
 *
 * Daten-Quelle: bp_repertoire_artists Tabelle in suite.db, gefuellt via
 * scripts/import_scoring_repertoire.py. UI ruft IPC repertoire:* fuer
 * Stats, Filter-Optionen, List (paginiert) und Sync.
 */

import { esc, fmt, debounce } from "../lib/track-utils.js";

const PAGE_SIZE = 200;

let state = {
  total: 0,
  totalFiltered: 0,
  page: 0,
  order: "track_count",
  q: "",
  yearMin: null,
  yearMax: null,
  minTracks: null,
  syncBusy: false,
  loadBusy: false,
};

let initialized = false;

// Deterministische Pastel-Farbe aus Artist-Name fuer Initial-Bubble.
function bubbleColor(name) {
  let h = 0;
  for (const ch of String(name || "")) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 40%)`;
}

function setStatus(text, level = "info") {
  const el = document.getElementById("repertoireStatus");
  if (!el) return;
  el.textContent = text;
  el.dataset.level = level;
}

function setLoading(loading) {
  state.loadBusy = loading;
  const grid = document.getElementById("repertoireList");
  if (grid && loading) {
    grid.classList.add("loading");
  } else if (grid) {
    grid.classList.remove("loading");
  }
}

async function refreshStats() {
  const api = window.repertoireApi;
  if (!api) return;
  const result = await api.stats();
  const el = document.getElementById("repertoireStats");
  if (!el) return;
  if (result?.missing_table) {
    el.classList.add("empty");
    el.innerHTML = `
      <strong style="color:var(--accent-warn,#E8A040);">
        ⚠ Noch keine Daten — bitte unten auf <em>„Aus scoring-data importieren"</em> klicken.
      </strong>`;
    return;
  }
  if (!result?.ok) {
    el.innerHTML = `<strong style="color:var(--danger,#dc2626);">Fehler: ${esc(result?.error || "unbekannt")}</strong>`;
    return;
  }
  state.total = result.total_artists;
  el.classList.remove("empty");
  const ys = result.year_range || [];
  const last = result.last_synced_at
    ? new Date(result.last_synced_at).toLocaleString("de-DE")
    : "nie";
  el.innerHTML = `
    <strong>${fmt(result.total_artists)}</strong> Artists ·
    <strong>${fmt(result.total_tracks)}</strong> Tracks ·
    <strong>${fmt(result.total_plays)}</strong> Plays gesamt ·
    Aktiv ${ys[0] || "?"}–${ys[1] || "?"} ·
    Stand: ${esc(last)}
  `;
}

async function refreshList() {
  const api = window.repertoireApi;
  if (!api) return;
  setLoading(true);
  try {
    const offset = state.page * PAGE_SIZE;
    const result = await api.list({
      order: state.order,
      limit: PAGE_SIZE,
      offset,
      q: state.q,
      yearMin: state.yearMin,
      yearMax: state.yearMax,
      minTracks: state.minTracks,
    });
    if (result?.missing_table) {
      renderEmptyState();
      return;
    }
    if (!result?.ok) {
      renderError(result?.error || "Artists-Liste konnte nicht geladen werden");
      return;
    }
    state.totalFiltered = result.total_filtered;
    renderList(result.artists || []);
    renderPagination();
  } catch (err) {
    renderError(String(err?.message || err));
  } finally {
    setLoading(false);
  }
}

function renderEmptyState() {
  const list = document.getElementById("repertoireList");
  if (!list) return;
  list.innerHTML = `
    <div class="callout" style="padding:1.5rem;text-align:center;">
      <p style="opacity:.9;font-size:1em;">
        🎼 Repertoire-Tab ist leer.
      </p>
      <p style="opacity:.75;font-size:.92em;margin-top:.5rem;">
        Klick auf <strong>„Aus scoring-data importieren"</strong> oben rechts.
        Dauert ~2 Sekunden für 99k Tracks / 25k Artists.
      </p>
      <p style="opacity:.6;font-size:.82em;margin-top:.8rem;">
        Quelle: <code>~/Documents/Claude/Projects/Beatport PL WIZ/scoring-data.json</code>
      </p>
    </div>
  `;
}

function renderError(detail) {
  const list = document.getElementById("repertoireList");
  if (!list) return;
  list.innerHTML = `
    <div class="callout warn" style="padding:1rem;">
      <p><strong>Fehler beim Laden</strong></p>
      <p style="opacity:.8;font-size:.9em;margin-top:.5rem;">${esc(detail)}</p>
    </div>
  `;
}

function renderList(artists) {
  const list = document.getElementById("repertoireList");
  if (!list) return;

  if (artists.length === 0) {
    list.innerHTML = `<p class="placeholder-text" style="padding:1.5rem;">Keine Treffer.</p>`;
    return;
  }

  list.innerHTML = artists.map((a) => {
    const initial = esc((a.name || "?")[0].toUpperCase());
    const color = bubbleColor(a.name);
    const genres = Array.isArray(a.genres) ? a.genres : [];
    const labels = Array.isArray(a.labels) ? a.labels : [];
    const yearRange = (a.year_min || a.year_max)
      ? `${a.year_min || "?"}–${a.year_max || "?"}`
      : "—";
    const bpmRange = (a.bpm_min && a.bpm_max)
      ? `${a.bpm_min}–${a.bpm_max} BPM`
      : "";
    const topGenres = genres.slice(0, 3).map((g) => `<span class="rep-tag">${esc(g)}</span>`).join("");
    const topLabels = labels.slice(0, 3).map((l) => `<span class="rep-tag rep-tag-label">${esc(l)}</span>`).join("");
    return `
      <div class="rep-row" data-id="${a.id}">
        <div class="rep-bubble" style="background:${color}" title="${esc(a.name)}">${initial}</div>
        <div class="rep-main">
          <div class="rep-name">${esc(a.name)}</div>
          <div class="rep-meta">
            <strong>${fmt(a.track_count)}</strong> Tracks
            ${a.plays_total ? ` · <strong>${fmt(a.plays_total)}</strong> Plays` : ""}
            · ${esc(yearRange)}
            ${bpmRange ? ` · ${esc(bpmRange)}` : ""}
          </div>
          ${topGenres || topLabels ? `<div class="rep-tags">${topGenres}${topLabels}</div>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderPagination() {
  const el = document.getElementById("repertoirePagination");
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(state.totalFiltered / PAGE_SIZE));
  const start = state.page * PAGE_SIZE + 1;
  const end = Math.min((state.page + 1) * PAGE_SIZE, state.totalFiltered);
  if (state.totalFiltered === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <button id="rep-prev" type="button" ${state.page === 0 ? "disabled" : ""}>← Zurück</button>
    <span class="rep-page-info">
      ${fmt(start)}–${fmt(end)} von <strong>${fmt(state.totalFiltered)}</strong>
      (Seite ${state.page + 1} / ${totalPages})
    </span>
    <button id="rep-next" type="button" ${state.page >= totalPages - 1 ? "disabled" : ""}>Weiter →</button>
  `;
  el.querySelector("#rep-prev")?.addEventListener("click", () => {
    if (state.page > 0) {
      state.page--;
      refreshList();
    }
  });
  el.querySelector("#rep-next")?.addEventListener("click", () => {
    if (state.page < totalPages - 1) {
      state.page++;
      refreshList();
    }
  });
}

async function doSync() {
  if (state.syncBusy) return;
  const api = window.repertoireApi;
  if (!api) return;
  state.syncBusy = true;
  setStatus("Importiere scoring-data.json …", "info");
  const btn = document.getElementById("repertoireSyncBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Importiere…";
  }
  try {
    const result = await api.sync({});
    if (result?.code === "scoring-data-missing") {
      setStatus(`⚠ ${result.message}`, "error");
      return;
    }
    if (!result?.ok) {
      setStatus(`Fehler: ${result?.error || "unbekannt"}`, "error");
      return;
    }
    const importInfo = result.importResult || {};
    setStatus(
      `✓ ${fmt(importInfo.db_total_tracks || 0)} Tracks, ${fmt(importInfo.db_total_artists || 0)} Artists importiert.`,
      "success"
    );
    await refreshStats();
    state.page = 0;
    await refreshList();
  } catch (err) {
    setStatus(`Fehler: ${err.message || err}`, "error");
  } finally {
    state.syncBusy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Aus scoring-data importieren";
    }
  }
}

function bindEvents() {
  const orderSel = document.getElementById("repertoireOrder");
  orderSel?.addEventListener("change", (e) => {
    state.order = e.target.value;
    state.page = 0;
    refreshList();
  });

  // Such-Input: debounced 250ms — kein Cursor-Sprung (inkrementelles Update
  // nur der Liste, nicht des Inputs).
  const searchInput = document.getElementById("repertoireSearch");
  const debouncedSearch = debounce((value) => {
    state.q = value;
    state.page = 0;
    refreshList();
  }, 250);
  searchInput?.addEventListener("input", (e) => debouncedSearch(e.target.value));

  const minTracksInput = document.getElementById("repertoireMinTracks");
  const debouncedMinTracks = debounce((value) => {
    const n = parseInt(value, 10);
    state.minTracks = Number.isFinite(n) && n > 0 ? n : null;
    state.page = 0;
    refreshList();
  }, 250);
  minTracksInput?.addEventListener("input", (e) => debouncedMinTracks(e.target.value));

  const yearMinInput = document.getElementById("repertoireYearMin");
  const yearMaxInput = document.getElementById("repertoireYearMax");
  const debouncedYearMin = debounce((value) => {
    const n = parseInt(value, 10);
    state.yearMin = Number.isFinite(n) && n > 1900 ? n : null;
    state.page = 0;
    refreshList();
  }, 250);
  const debouncedYearMax = debounce((value) => {
    const n = parseInt(value, 10);
    state.yearMax = Number.isFinite(n) && n > 1900 ? n : null;
    state.page = 0;
    refreshList();
  }, 250);
  yearMinInput?.addEventListener("input", (e) => debouncedYearMin(e.target.value));
  yearMaxInput?.addEventListener("input", (e) => debouncedYearMax(e.target.value));

  document.getElementById("repertoireResetBtn")?.addEventListener("click", () => {
    state.q = "";
    state.yearMin = null;
    state.yearMax = null;
    state.minTracks = null;
    state.page = 0;
    if (searchInput) searchInput.value = "";
    if (minTracksInput) minTracksInput.value = "";
    if (yearMinInput) yearMinInput.value = "";
    if (yearMaxInput) yearMaxInput.value = "";
    refreshList();
  });

  document.getElementById("repertoireSyncBtn")?.addEventListener("click", doSync);
  document.getElementById("repertoireRefreshBtn")?.addEventListener("click", async () => {
    await refreshStats();
    await refreshList();
  });
}

export async function initRepertoireTab() {
  if (!initialized) {
    initialized = true;
    bindEvents();
  }
  await refreshStats();
  await refreshList();
}
