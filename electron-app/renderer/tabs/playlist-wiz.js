/**
 * playlist-wiz.js — Playlist WIZ Tab
 *
 * Live-Verbindung zur Beatport API über den XHR-Client.
 * Playlists anzeigen, erstellen, umbenennen, löschen.
 * Tracks anzeigen, hinzufügen, entfernen.
 *
 * Backlog-Punkt 33 (v4.4.0): Track-Filter mit Suche, Genre-Chips, BPM-Range,
 * Camelot-Chips, Jahr-Range und mehrstufiger Lock-Sortierung. Adapter aus
 * lib/wiz-track-adapter.js liefert Explore-kompatibles Schema. Inkrementelles
 * Re-Render der Track-Tabelle vermeidet Cursor-Sprung in den Filter-Inputs.
 *
 * Benötigt gültigen API-Kontext (im Scanner-Tab exportieren).
 */

import {
  camelotSortVal,
  buildQueryMatcher,
  dramaColor,
} from "../lib/track-utils.js";
import { wizTracksToFilterable } from "../lib/wiz-track-adapter.js";

const PLAYLIST_WIZ_MUTATION_EVENT = "beatport-suite:playlist-wiz-mutated";

let playlists = [];
let selectedPlaylist = null;
let tracks = [];                  // Rohe Tracks aus Beatport-API
let adaptedTracks = [];           // Via Adapter Explore-kompatibel gemacht
let wizFilteredTracks = [];       // Aktuell sichtbare nach Filter+Sort
let selectedTrackIds = new Set();
let loading = false;
let tracksLoading = false;
let mutationBusy = false;
let forceReloadRequested = false;
let staleReason = "";
let error = "";
let tracksError = "";
let filterText = "";              // Playlist-Suche in der Sidebar
let actionMessage = "";
let actionLevel = "";

// Track-Filter-States (werden bei loadTracks() resettet)
let wizQuery = "";                // Wildcards * ?
let wizBpmMin = "";               // String fuer Input, parseInt bei Anwendung
let wizBpmMax = "";
let wizYearMin = "";
let wizYearMax = "";
let wizSelectedGenres = new Set();
let wizSelectedCamelot = new Set();
let wizLockedSorts = [];          // [{col:'bpm', dir:1}, {col:'camelot', dir:1}]

// Sortier-Spalten (eingaengig fuer Lock-System)
const WIZ_SORT_COLS = ["title", "artists", "genre", "bpm", "key", "camelot", "drama", "year", "label"];

function resetWizFilters() {
  wizQuery = "";
  wizBpmMin = "";
  wizBpmMax = "";
  wizYearMin = "";
  wizYearMax = "";
  wizSelectedGenres = new Set();
  wizSelectedCamelot = new Set();
  wizLockedSorts = [];
}

export async function initPlaylistWiz() {
  render();
  if (forceReloadRequested || playlists.length === 0) {
    await refreshPlaylists({
      preferredPlaylistId: selectedPlaylist?.id || "",
      reloadTracks: Boolean(selectedPlaylist),
    });
    return;
  }
  render();
}

export function forceReload(reason = "") {
  forceReloadRequested = true;
  staleReason =
    reason || staleReason || "Scanner-Daten müssen mit Beatport abgeglichen werden.";
}

async function refreshPlaylists(options = {}) {
  if (loading) return;

  const preferredPlaylistId =
    options.preferredPlaylistId || selectedPlaylist?.id || "";

  loading = true;
  error = "";
  if (!options.preserveAction) {
    actionMessage = "";
  }
  render();

  try {
    const nextPlaylists = await window.playlistApi.list();
    playlists = Array.isArray(nextPlaylists) ? nextPlaylists : [];
    staleReason = "";
    forceReloadRequested = false;

    const nextSelected = preferredPlaylistId
      ? playlists.find((entry) => entry.id === preferredPlaylistId) || null
      : null;

    if (!nextSelected) {
      selectedPlaylist = null;
      tracks = [];
      tracksError = "";
      selectedTrackIds.clear();
    } else {
      selectedPlaylist = nextSelected;
      if (options.reloadTracks) {
        await loadTracks(nextSelected, { silent: true });
      }
    }
  } catch (err) {
    error = err.message || "Playlists konnten nicht geladen werden.";
    playlists = [];
    selectedPlaylist = null;
    tracks = [];
    tracksError = "";
    selectedTrackIds.clear();
  } finally {
    loading = false;
    render();
  }
}

async function loadTracks(playlist, options = {}) {
  if (tracksLoading) return;

  selectedPlaylist = playlist;
  selectedTrackIds.clear();
  // Pflicht-Condition (Reviewer): Filter-States zuruecksetzen bei jedem
  // Playlist-Wechsel, sonst landen Locks/Filter aus alter Playlist auf den
  // neuen Tracks (z.B. Camelot-Filter "8A" zeigt 0 Tracks weil neue Playlist
  // andere Tonarten hat).
  resetWizFilters();
  tracksLoading = true;
  tracksError = "";
  tracks = [];
  adaptedTracks = [];
  wizFilteredTracks = [];
  if (!options.silent) {
    render();
  }

  try {
    const nextTracks = await window.playlistApi.tracks(playlist.id);
    tracks = Array.isArray(nextTracks) ? nextTracks : [];
    adaptedTracks = wizTracksToFilterable(tracks);
    wizFilteredTracks = applyWizFilters();
  } catch (err) {
    tracksError = err.message || "Tracks konnten nicht geladen werden.";
    tracks = [];
    adaptedTracks = [];
    wizFilteredTracks = [];
  } finally {
    tracksLoading = false;
    if (!options.silent) {
      render();
    }
  }
}

async function withMutation(task) {
  if (mutationBusy) return;
  mutationBusy = true;
  render();
  try {
    await task();
  } finally {
    mutationBusy = false;
    render();
  }
}

function notifyPlaylistMutation(summary) {
  window.dispatchEvent(
    new CustomEvent(PLAYLIST_WIZ_MUTATION_EVENT, {
      detail: { summary },
    })
  );
}

async function doCreatePlaylist() {
  const name = prompt("Name der neuen Playlist:");
  if (!name || !name.trim()) return;

  await withMutation(async () => {
    try {
      const result = await window.playlistApi.create(name.trim());
      await refreshPlaylists({
        preferredPlaylistId: result.id,
        reloadTracks: true,
        preserveAction: true,
      });
      setAction(`Playlist "${result.name}" erstellt (ID: ${result.id}).`, "success");
      notifyPlaylistMutation(`Playlist erstellt: ${result.name}`);
    } catch (err) {
      setAction(`Fehler: ${err.message}`, "error");
    }
  });
}

async function doRenamePlaylist() {
  if (!selectedPlaylist) return;
  const newName = prompt("Neuer Name:", selectedPlaylist.name);
  if (!newName || !newName.trim() || newName.trim() === selectedPlaylist.name) {
    return;
  }

  await withMutation(async () => {
    try {
      await window.playlistApi.rename(selectedPlaylist.id, newName.trim());
      await refreshPlaylists({
        preferredPlaylistId: selectedPlaylist.id,
        reloadTracks: true,
        preserveAction: true,
      });
      setAction(`Playlist umbenannt zu "${newName.trim()}".`, "success");
      notifyPlaylistMutation(`Playlist umbenannt: ${newName.trim()}`);
    } catch (err) {
      setAction(`Fehler: ${err.message}`, "error");
    }
  });
}

async function doDeletePlaylist() {
  if (!selectedPlaylist) return;
  const confirmed = confirm(
    `Playlist "${selectedPlaylist.name}" (${selectedPlaylist.trackCount} Tracks) unwiderruflich löschen?`
  );
  if (!confirmed) return;

  const deletedName = selectedPlaylist.name;
  await withMutation(async () => {
    try {
      await window.playlistApi.remove(selectedPlaylist.id);
      selectedPlaylist = null;
      tracks = [];
      tracksError = "";
      selectedTrackIds.clear();
      await refreshPlaylists({ preserveAction: true });
      setAction(`Playlist "${deletedName}" gelöscht.`, "success");
      notifyPlaylistMutation(`Playlist gelöscht: ${deletedName}`);
    } catch (err) {
      setAction(`Fehler: ${err.message}`, "error");
    }
  });
}

async function doAddTracks() {
  if (!selectedPlaylist) return;
  const input = prompt("Track-IDs (kommasepariert):");
  if (!input) return;
  const ids = input
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.length === 0) return;

  const playlistId = selectedPlaylist.id;
  const playlistName = selectedPlaylist.name;
  await withMutation(async () => {
    try {
      const results = await window.playlistApi.addTracks(playlistId, ids);
      const ok = results.filter((entry) => entry.status === "added").length;
      const fail = results.filter((entry) => entry.status === "error").length;
      await refreshPlaylists({
        preferredPlaylistId: playlistId,
        reloadTracks: true,
        preserveAction: true,
      });
      setAction(
        `${ok} Track(s) hinzugefügt${fail ? `, ${fail} fehlgeschlagen` : ""}.`,
        fail ? "error" : "success"
      );
      notifyPlaylistMutation(`Tracks geändert in Playlist: ${playlistName}`);
    } catch (err) {
      setAction(`Fehler: ${err.message}`, "error");
    }
  });
}

async function doRemoveSelectedTracks() {
  if (!selectedPlaylist || selectedTrackIds.size === 0) return;
  const confirmed = confirm(
    `${selectedTrackIds.size} Track(s) aus der Playlist entfernen?`
  );
  if (!confirmed) return;

  const playlistId = selectedPlaylist.id;
  const playlistName = selectedPlaylist.name;
  await withMutation(async () => {
    try {
      const ids = [...selectedTrackIds];
      const results = await window.playlistApi.removeTracks(playlistId, ids);
      const ok = results.filter((entry) => entry.status === "removed").length;
      await refreshPlaylists({
        preferredPlaylistId: playlistId,
        reloadTracks: true,
        preserveAction: true,
      });
      setAction(`${ok} Track(s) entfernt.`, "success");
      notifyPlaylistMutation(`Tracks entfernt aus Playlist: ${playlistName}`);
    } catch (err) {
      setAction(`Fehler: ${err.message}`, "error");
    }
  });
}

function setAction(msg, level) {
  actionMessage = msg;
  actionLevel = level;
}

// ─── Filter + Sort (Backlog-Punkt 33) ──────────────────────────────────────

function applyWizFilters() {
  if (!adaptedTracks.length) return [];

  const qMatch = wizQuery ? buildQueryMatcher(wizQuery) : null;
  const bpmMin = parseInt(wizBpmMin, 10);
  const bpmMax = parseInt(wizBpmMax, 10);
  const yearMin = parseInt(wizYearMin, 10);
  const yearMax = parseInt(wizYearMax, 10);
  const useGenre = wizSelectedGenres.size > 0;
  const useCamelot = wizSelectedCamelot.size > 0;

  const filtered = adaptedTracks.filter((t) => {
    if (qMatch) {
      const haystack = `${t.title} ${t.mix_name} ${t.artists} ${t.label} ${t.genre}`;
      if (!qMatch(haystack)) return false;
    }
    if (useGenre && !wizSelectedGenres.has(t.genre)) return false;
    if (useCamelot && !wizSelectedCamelot.has(t.camelot)) return false;
    if (Number.isFinite(bpmMin) && t.bpm < bpmMin) return false;
    if (Number.isFinite(bpmMax) && bpmMax > 0 && t.bpm > bpmMax) return false;
    if (Number.isFinite(yearMin) && (t.year == null || t.year < yearMin)) return false;
    if (Number.isFinite(yearMax) && yearMax > 0 && (t.year == null || t.year > yearMax)) return false;
    return true;
  });

  return sortWizTracks(filtered);
}

function sortWizTracks(arr) {
  if (!wizLockedSorts.length) return arr;
  const chain = wizLockedSorts;
  return [...arr].sort((a, b) => {
    for (const { col, dir } of chain) {
      const av = getWizSortVal(a, col);
      const bv = getWizSortVal(b, col);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}

function getWizSortVal(t, col) {
  switch (col) {
    case "title":   return (t.title || "").toLowerCase();
    case "artists": return (t.artists || "").toLowerCase();
    case "genre":   return (t.genre || "").toLowerCase();
    case "bpm":     return t.bpm || 0;
    case "key":     return (t.key || "").toLowerCase();
    case "camelot": return camelotSortVal(t.camelot);
    case "drama":   return t.drama || 0;
    case "year":    return t.year || 0;
    case "label":   return (t.label || "").toLowerCase();
    default:        return 0;
  }
}

function toggleWizLock(col) {
  if (!WIZ_SORT_COLS.includes(col)) return;
  const existing = wizLockedSorts.findIndex((entry) => entry.col === col);
  if (existing >= 0) {
    // Toggle ASC → DESC → entfernt
    if (wizLockedSorts[existing].dir === 1) {
      wizLockedSorts[existing].dir = -1;
    } else {
      wizLockedSorts.splice(existing, 1);
    }
  } else {
    wizLockedSorts.push({ col, dir: 1 });
  }
}

function clearWizLocks() {
  wizLockedSorts = [];
}

// Sammelt alle in den geladenen Tracks vorhandenen Genres bzw. Camelot-Werte
// — Filter-Chips zeigen nur Werte die tatsaechlich in der Playlist vorkommen.
function getWizGenreOptions() {
  const set = new Set();
  for (const t of adaptedTracks) {
    if (t.genre) set.add(t.genre);
  }
  return [...set].sort();
}

function getWizCamelotOptions() {
  const set = new Set();
  for (const t of adaptedTracks) {
    if (t.camelot) set.add(t.camelot);
  }
  return [...set].sort((a, b) => camelotSortVal(a) - camelotSortVal(b));
}

// Inkrementelles Re-Render: tauscht NUR die Track-Tabelle aus, laesst die
// Filter-Inputs und alle anderen DOM-Elemente unangetastet. Verhindert
// Cursor-Sprung der bei v4.3.4 nur fuer #wiz-filter (Playlist-Suche) gefixt
// wurde — Track-Filter-Inputs brauchen kein per-Input setSelectionRange,
// weil sie nicht neu erstellt werden.
function rerenderWizTrackArea() {
  wizFilteredTracks = applyWizFilters();
  const tbody = document.getElementById("wiz-tracks-tbody");
  if (tbody) {
    tbody.innerHTML = renderWizTrackRows();
  }
  const countEl = document.getElementById("wiz-filter-count");
  if (countEl) {
    countEl.textContent = `${wizFilteredTracks.length} von ${adaptedTracks.length}`;
  }
  // Lock-Indikatoren auf den th-Headern aktualisieren
  updateWizLockUI();
  // Select-All-Checkbox-Status
  const selectAll = document.getElementById("wiz-select-all");
  if (selectAll) {
    const visibleIds = new Set(wizFilteredTracks.map((t) => t.track_id));
    const visibleSelectedCount = [...selectedTrackIds].filter((id) => visibleIds.has(id)).length;
    selectAll.checked = visibleSelectedCount === wizFilteredTracks.length && wizFilteredTracks.length > 0;
  }
  // Remove-Button Beschriftung
  const removeBtn = document.getElementById("wiz-remove-tracks");
  if (removeBtn) {
    removeBtn.textContent = selectedTrackIds.size > 0
      ? `${selectedTrackIds.size} entfernen`
      : "Entfernen";
    removeBtn.disabled = selectedTrackIds.size === 0 || mutationBusy || tracksLoading;
  }
}

function updateWizLockUI() {
  const ths = document.querySelectorAll("[data-wiz-sort]");
  ths.forEach((th) => {
    const col = th.dataset.wizSort;
    const idx = wizLockedSorts.findIndex((entry) => entry.col === col);
    const indicator = th.querySelector(".wiz-lock-indicator");
    if (indicator) {
      if (idx >= 0) {
        const { dir } = wizLockedSorts[idx];
        indicator.textContent = ` ${idx + 1}${dir === 1 ? " ↑" : " ↓"}`;
        th.classList.add("locked");
      } else {
        indicator.textContent = "";
        th.classList.remove("locked");
      }
    }
  });
}

function render() {
  const container = document.getElementById("playlist-wiz-content");
  if (!container) return;

  const filteredPlaylists = filterText
    ? playlists.filter(
        (entry) =>
          entry.name.toLowerCase().includes(filterText.toLowerCase()) ||
          entry.id.includes(filterText)
      )
    : playlists;
  const disableSidebarActions = loading || mutationBusy;

  container.innerHTML = `
    ${actionMessage ? `
      <section class="panel span-full">
        <div class="callout ${
          actionLevel === "error" ? "warning" : "success"
        }">${esc(actionMessage)}</div>
      </section>
    ` : ""}

    ${staleReason ? `
      <section class="panel span-full">
        <div class="callout warning">
          Lokaler Scanner-Cache wartet auf Delta-Sync: ${esc(staleReason)}
        </div>
      </section>
    ` : ""}

    ${error ? `
      <section class="panel span-full">
        <div class="callout warning">${esc(error)}</div>
        <p style="margin:8px 0 0;color:var(--muted);font-size:0.88rem">
          Stelle sicher, dass du im Scanner-Tab unter Auth → "API-Kontext exportieren" geklickt hast.
        </p>
      </section>
    ` : ""}

    <section class="panel wiz-sidebar">
      <div class="section-head">
        <h2>Playlists ${!loading ? `<span class="pill">${playlists.length}</span>` : ""}</h2>
        <div class="actions compact">
          <button id="wiz-refresh" type="button" ${
            disableSidebarActions ? "disabled" : ""
          }>Laden</button>
          <button id="wiz-create" type="button" class="primary" ${
            disableSidebarActions ? "disabled" : ""
          }>+ Neu</button>
        </div>
      </div>

      <div class="field-grid" style="margin-top:8px">
        <label class="wide">
          <input
            id="wiz-filter"
            type="text"
            placeholder="Playlist suchen…"
            value="${esc(filterText)}"
            ${disableSidebarActions ? "disabled" : ""}
          />
        </label>
      </div>

      <div class="wiz-playlist-list" id="wiz-playlist-list">
        ${
          loading
            ? '<p class="placeholder-text">Lade Playlists…</p>'
            : filteredPlaylists.length === 0
              ? '<p class="placeholder-text">Keine Playlists gefunden</p>'
              : filteredPlaylists.map(
                  (playlist) => `
                    <div
                      class="wiz-playlist-item ${
                        selectedPlaylist?.id === playlist.id ? "is-selected" : ""
                      }"
                      data-id="${esc(playlist.id)}"
                    >
                      <strong>${esc(playlist.name)}</strong>
                      <span class="wiz-track-count">${playlist.trackCount} Tracks</span>
                    </div>
                  `
                ).join("")
        }
      </div>
    </section>

    <section class="panel wiz-main">
      ${
        selectedPlaylist
          ? renderTrackPanel()
          : `
            <div class="placeholder-panel" style="min-height:400px">
              <p class="placeholder-text">
                Wähle eine Playlist aus der Liste, um ihre Tracks zu sehen und zu bearbeiten.
              </p>
            </div>
          `
      }
    </section>
  `;

  bindEvents(container);
}

function renderTrackPanel() {
  const disableTrackActions = mutationBusy || tracksLoading;
  return `
    <div class="section-head">
      <div>
        <h2>${esc(selectedPlaylist.name)}</h2>
        <p style="margin:0;color:var(--muted);font-size:0.84rem">
          ID: ${selectedPlaylist.id} · ${selectedPlaylist.trackCount} Tracks · ${
            selectedPlaylist.isPublic ? "Öffentlich" : "Privat"
          }
        </p>
      </div>
      <div class="actions compact">
        <button id="wiz-rename" type="button" ${
          disableTrackActions ? "disabled" : ""
        }>Umbenennen</button>
        <button id="wiz-add-tracks" type="button" class="primary" ${
          disableTrackActions ? "disabled" : ""
        }>+ Tracks</button>
        <button
          id="wiz-remove-tracks"
          type="button"
          ${
            disableTrackActions || selectedTrackIds.size === 0 ? "disabled" : ""
          }
        >
          ${
            selectedTrackIds.size > 0
              ? `${selectedTrackIds.size} entfernen`
              : "Entfernen"
          }
        </button>
        <button id="wiz-delete-playlist" type="button" class="danger" ${
          disableTrackActions ? "disabled" : ""
        }>Löschen</button>
      </div>
    </div>

    ${
      tracksLoading
        ? '<p class="placeholder-text" style="padding:20px">Lade Tracks…</p>'
        : tracksError
          ? `<div class="callout warning" style="margin-top:10px">${esc(
              tracksError
            )}</div>`
          : tracks.length === 0
            ? '<p class="placeholder-text" style="padding:20px">Keine Tracks in dieser Playlist</p>'
            : `
              ${renderWizFilterPanel()}
              <div class="wiz-select-bar">
                <label class="check" style="font-size:0.82rem">
                  <input
                    type="checkbox"
                    id="wiz-select-all"
                    ${
                      computeAllVisibleSelected()
                        ? "checked"
                        : ""
                    }
                    ${disableTrackActions ? "disabled" : ""}
                  />
                  Alle sichtbaren auswählen (<span id="wiz-select-count">${selectedTrackIds.size}/${wizFilteredTracks.length}</span>)
                </label>
              </div>
              <div class="table-wrap" style="max-height:520px;margin-top:8px">
                <table>
                  <thead>
                    <tr>
                      <th style="width:40px"></th>
                      <th>#</th>
                      <th data-wiz-sort="title" class="wiz-sort-th">Titel<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="artists" class="wiz-sort-th">Artist<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="genre" class="wiz-sort-th">Genre<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="bpm" class="wiz-sort-th">BPM<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="key" class="wiz-sort-th">Key<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="camelot" class="wiz-sort-th">Camelot<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="drama" class="wiz-sort-th">Drama<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="year" class="wiz-sort-th">Jahr<span class="wiz-lock-indicator"></span></th>
                      <th data-wiz-sort="label" class="wiz-sort-th">Label<span class="wiz-lock-indicator"></span></th>
                    </tr>
                  </thead>
                  <tbody id="wiz-tracks-tbody">
                    ${renderWizTrackRows()}
                  </tbody>
                </table>
              </div>
            `
    }
  `;
}

function computeAllVisibleSelected() {
  if (!wizFilteredTracks.length) return false;
  return wizFilteredTracks.every((t) => selectedTrackIds.has(t.track_id));
}

function renderWizFilterPanel() {
  const genres = getWizGenreOptions();
  const camelots = getWizCamelotOptions();
  return `
    <div class="wiz-filter-panel">
      <div class="wiz-filter-row">
        <input
          type="text"
          id="wiz-q"
          class="wiz-filter-input"
          placeholder="Track, Artist, Label suchen (Wildcards * ?)"
          value="${esc(wizQuery)}"
        />
        <span class="wiz-filter-count" id="wiz-filter-count">${wizFilteredTracks.length} von ${adaptedTracks.length}</span>
        <button type="button" id="wiz-filter-reset" class="wiz-filter-reset">Reset</button>
      </div>
      <div class="wiz-filter-row wiz-filter-ranges">
        <label class="wiz-filter-label">
          BPM
          <input type="number" id="wiz-bpm-min" class="wiz-filter-num" placeholder="Min" value="${esc(wizBpmMin)}" min="0" max="999" />
          <input type="number" id="wiz-bpm-max" class="wiz-filter-num" placeholder="Max" value="${esc(wizBpmMax)}" min="0" max="999" />
        </label>
        <label class="wiz-filter-label">
          Jahr
          <input type="number" id="wiz-year-min" class="wiz-filter-num" placeholder="von" value="${esc(wizYearMin)}" min="1900" max="2100" />
          <input type="number" id="wiz-year-max" class="wiz-filter-num" placeholder="bis" value="${esc(wizYearMax)}" min="1900" max="2100" />
        </label>
      </div>
      ${genres.length > 0 ? `
        <div class="wiz-filter-row wiz-filter-chips-row">
          <span class="wiz-filter-chip-label">Genre:</span>
          <div class="wiz-filter-chips">
            ${genres.map((g) => `
              <button
                type="button"
                class="wiz-filter-chip${wizSelectedGenres.has(g) ? " active" : ""}"
                data-wiz-genre="${esc(g)}"
              >${esc(g)}</button>
            `).join("")}
          </div>
        </div>
      ` : ""}
      ${camelots.length > 0 ? `
        <div class="wiz-filter-row wiz-filter-chips-row">
          <span class="wiz-filter-chip-label">Camelot:</span>
          <div class="wiz-filter-chips">
            ${camelots.map((c) => `
              <button
                type="button"
                class="wiz-filter-chip${wizSelectedCamelot.has(c) ? " active" : ""}"
                data-wiz-camelot="${esc(c)}"
              >${esc(c)}</button>
            `).join("")}
          </div>
        </div>
      ` : ""}
      <div class="wiz-filter-row wiz-filter-locks">
        <span class="wiz-filter-chip-label">Sortierung:</span>
        <span class="wiz-filter-hint">Klick auf Spaltenheader (Titel, BPM, Camelot…) = mehrstufige Sortierung mit Priorität.</span>
        <button type="button" id="wiz-clear-locks" class="wiz-filter-reset">Locks löschen</button>
      </div>
    </div>
  `;
}

function renderWizTrackRows() {
  const disableTrackActions = mutationBusy || tracksLoading;
  if (!wizFilteredTracks.length) {
    return `
      <tr>
        <td colspan="11" class="placeholder-text" style="padding:16px;text-align:center;">
          Keine Tracks entsprechen dem Filter.
        </td>
      </tr>
    `;
  }
  return wizFilteredTracks
    .map((track, index) => `
      <tr
        class="selection-row ${selectedTrackIds.has(track.track_id) ? "is-focused" : ""}"
        data-track-id="${esc(track.track_id)}"
      >
        <td class="selection-checkbox">
          <input
            type="checkbox"
            class="wiz-track-cb"
            data-track-id="${esc(track.track_id)}"
            ${selectedTrackIds.has(track.track_id) ? "checked" : ""}
            ${disableTrackActions ? "disabled" : ""}
          />
        </td>
        <td>${index + 1}</td>
        <td class="wrap-cell">
          ${esc(track.title)}
          ${track.mix_name ? `<span style="color:var(--muted)">(${esc(track.mix_name)})</span>` : ""}
        </td>
        <td class="wrap-cell">${esc(track.artists)}</td>
        <td>${esc(track.genre)}</td>
        <td>${track.bpm || ""}</td>
        <td>${esc(track.key || "")}</td>
        <td>${esc(track.camelot)}</td>
        <td style="color:${dramaColor(track.drama)};font-weight:600">${track.drama || ""}</td>
        <td>${track.year ?? ""}</td>
        <td>${esc(track.label)}</td>
      </tr>
    `)
    .join("");
}

function bindEvents(container) {
  container
    .querySelector("#wiz-refresh")
    ?.addEventListener("click", () => refreshPlaylists({ reloadTracks: true }));
  container
    .querySelector("#wiz-create")
    ?.addEventListener("click", () => doCreatePlaylist());
  container
    .querySelector("#wiz-rename")
    ?.addEventListener("click", () => doRenamePlaylist());
  container
    .querySelector("#wiz-delete-playlist")
    ?.addEventListener("click", () => doDeletePlaylist());
  container
    .querySelector("#wiz-add-tracks")
    ?.addEventListener("click", () => doAddTracks());
  container
    .querySelector("#wiz-remove-tracks")
    ?.addEventListener("click", () => doRemoveSelectedTracks());

  container.querySelector("#wiz-filter")?.addEventListener("input", (event) => {
    filterText = event.target.value;
    // Cursor-Position vor dem re-render speichern. render() ersetzt das
    // gesamte Panel-innerHTML, das <input>-Element wird neu erstellt;
    // ohne setSelectionRange landet der Cursor am Anfang.
    const cursorPos = event.target.selectionStart;
    render();
    const restoredInput = document.getElementById("wiz-filter");
    if (restoredInput) {
      restoredInput.focus();
      try {
        restoredInput.setSelectionRange(cursorPos, cursorPos);
      } catch { /* setSelectionRange wirft bei manchen Input-Types, hier irrelevant */ }
    }
  });

  container
    .querySelector("#wiz-playlist-list")
    ?.addEventListener("click", (event) => {
      if (loading || mutationBusy) return;
      const item = event.target.closest(".wiz-playlist-item");
      if (!item) return;
      const playlist = playlists.find((entry) => entry.id === item.dataset.id);
      if (playlist) {
        loadTracks(playlist);
      }
    });

  // Track-Checkboxen via Event-Delegation am tbody — neue Rows nach
  // inkrementellem Re-Render brauchen keine erneute Bindung.
  const tbody = container.querySelector("#wiz-tracks-tbody");
  tbody?.addEventListener("change", (event) => {
    if (!event.target.classList.contains("wiz-track-cb")) return;
    const trackId = event.target.dataset.trackId;
    if (event.target.checked) {
      selectedTrackIds.add(trackId);
    } else {
      selectedTrackIds.delete(trackId);
    }
    // Inkrementell statt full render — Filter-Inputs bleiben unangetastet.
    rerenderWizTrackArea();
  });

  container.querySelector("#wiz-select-all")?.addEventListener("change", (event) => {
    if (event.target.checked) {
      // Nur sichtbare (gefilterte) Tracks auswaehlen — bewusst, nicht alle.
      for (const track of wizFilteredTracks) {
        selectedTrackIds.add(track.track_id);
      }
    } else {
      for (const track of wizFilteredTracks) {
        selectedTrackIds.delete(track.track_id);
      }
    }
    rerenderWizTrackArea();
  });

  bindWizFilterEvents(container);
}

// Event-Bindings fuer Track-Filter-Inputs (Backlog-Punkt 33).
// Inkrementelles Re-Render: rerenderWizTrackArea() ersetzt NUR tbody +
// Counter/Lock-UI — die Filter-Inputs bleiben im DOM und behalten ihren
// Cursor/Fokus.
function bindWizFilterEvents(container) {
  container.querySelector("#wiz-q")?.addEventListener("input", (event) => {
    wizQuery = event.target.value;
    rerenderWizTrackArea();
  });
  container.querySelector("#wiz-bpm-min")?.addEventListener("input", (event) => {
    wizBpmMin = event.target.value;
    rerenderWizTrackArea();
  });
  container.querySelector("#wiz-bpm-max")?.addEventListener("input", (event) => {
    wizBpmMax = event.target.value;
    rerenderWizTrackArea();
  });
  container.querySelector("#wiz-year-min")?.addEventListener("input", (event) => {
    wizYearMin = event.target.value;
    rerenderWizTrackArea();
  });
  container.querySelector("#wiz-year-max")?.addEventListener("input", (event) => {
    wizYearMax = event.target.value;
    rerenderWizTrackArea();
  });

  // Genre-Chips — Event-Delegation auf dem Chips-Container.
  for (const chip of container.querySelectorAll(".wiz-filter-chip[data-wiz-genre]")) {
    chip.addEventListener("click", () => {
      const g = chip.dataset.wizGenre;
      if (wizSelectedGenres.has(g)) wizSelectedGenres.delete(g);
      else wizSelectedGenres.add(g);
      chip.classList.toggle("active");
      rerenderWizTrackArea();
    });
  }
  for (const chip of container.querySelectorAll(".wiz-filter-chip[data-wiz-camelot]")) {
    chip.addEventListener("click", () => {
      const c = chip.dataset.wizCamelot;
      if (wizSelectedCamelot.has(c)) wizSelectedCamelot.delete(c);
      else wizSelectedCamelot.add(c);
      chip.classList.toggle("active");
      rerenderWizTrackArea();
    });
  }

  // Sortier-Header (Lock-System)
  for (const th of container.querySelectorAll("[data-wiz-sort]")) {
    th.addEventListener("click", () => {
      toggleWizLock(th.dataset.wizSort);
      rerenderWizTrackArea();
    });
  }

  // Reset-Buttons
  container.querySelector("#wiz-filter-reset")?.addEventListener("click", () => {
    resetWizFilters();
    render(); // hier full render, weil Chips-Set komplett zurueck muss
  });
  container.querySelector("#wiz-clear-locks")?.addEventListener("click", () => {
    clearWizLocks();
    rerenderWizTrackArea();
  });
}

function esc(str) {
  const node = document.createElement("div");
  node.textContent = str || "";
  return node.innerHTML;
}
