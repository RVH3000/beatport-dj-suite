/**
 * playlist-wiz.js — Playlist WIZ Tab
 *
 * Live-Verbindung zur Beatport API über den XHR-Client.
 * Playlists anzeigen, erstellen, umbenennen, löschen.
 * Tracks anzeigen, hinzufügen, entfernen.
 *
 * Benötigt gültigen API-Kontext (im Scanner-Tab exportieren).
 */

// ─── State ──────────────────────────────────────────────────────────────────────

let playlists = [];
let selectedPlaylist = null;
let tracks = [];
let selectedTrackIds = new Set();
let loading = false;
let tracksLoading = false;
let error = "";
let tracksError = "";
let filterText = "";
let actionMessage = "";
let actionLevel = ""; // "success" | "error"

// ─── Initialisierung ────────────────────────────────────────────────────────────

export async function initPlaylistWiz() {
  render();
  if (playlists.length === 0) {
    await refreshPlaylists();
  } else {
    render();
  }
}

// ─── Daten laden ────────────────────────────────────────────────────────────────

async function refreshPlaylists() {
  if (loading) return;
  loading = true;
  error = "";
  actionMessage = "";
  render();

  try {
    playlists = await window.playlistApi.list();
  } catch (err) {
    error = err.message || "Playlists konnten nicht geladen werden.";
    playlists = [];
  } finally {
    loading = false;
  }
  render();
}

async function loadTracks(playlist) {
  if (tracksLoading) return;
  selectedPlaylist = playlist;
  selectedTrackIds.clear();
  tracksLoading = true;
  tracksError = "";
  tracks = [];
  render();

  try {
    tracks = await window.playlistApi.tracks(playlist.id);
  } catch (err) {
    tracksError = err.message || "Tracks konnten nicht geladen werden.";
    tracks = [];
  } finally {
    tracksLoading = false;
  }
  render();
}

// ─── Aktionen ───────────────────────────────────────────────────────────────────

async function doCreatePlaylist() {
  const name = prompt("Name der neuen Playlist:");
  if (!name || !name.trim()) return;

  try {
    const result = await window.playlistApi.create(name.trim());
    setAction(`Playlist „${result.name}" erstellt (ID: ${result.id}).`, "success");
    await refreshPlaylists();
  } catch (err) {
    setAction(`Fehler: ${err.message}`, "error");
  }
}

async function doRenamePlaylist() {
  if (!selectedPlaylist) return;
  const newName = prompt("Neuer Name:", selectedPlaylist.name);
  if (!newName || !newName.trim() || newName.trim() === selectedPlaylist.name) return;

  try {
    await window.playlistApi.rename(selectedPlaylist.id, newName.trim());
    setAction(`Playlist umbenannt zu „${newName.trim()}".`, "success");
    selectedPlaylist.name = newName.trim();
    await refreshPlaylists();
  } catch (err) {
    setAction(`Fehler: ${err.message}`, "error");
  }
}

async function doDeletePlaylist() {
  if (!selectedPlaylist) return;
  const confirmed = confirm(
    `Playlist „${selectedPlaylist.name}" (${selectedPlaylist.trackCount} Tracks) ` +
    `unwiderruflich löschen?`
  );
  if (!confirmed) return;

  try {
    await window.playlistApi.remove(selectedPlaylist.id);
    setAction(`Playlist „${selectedPlaylist.name}" gelöscht.`, "success");
    selectedPlaylist = null;
    tracks = [];
    selectedTrackIds.clear();
    await refreshPlaylists();
  } catch (err) {
    setAction(`Fehler: ${err.message}`, "error");
  }
}

async function doAddTracks() {
  if (!selectedPlaylist) return;
  const input = prompt("Track-IDs (kommasepariert):");
  if (!input) return;
  const ids = input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return;

  try {
    const results = await window.playlistApi.addTracks(selectedPlaylist.id, ids);
    const ok = results.filter((r) => r.status === "added").length;
    const fail = results.filter((r) => r.status === "error").length;
    setAction(`${ok} Track(s) hinzugefügt${fail ? `, ${fail} fehlgeschlagen` : ""}.`, fail ? "error" : "success");
    await loadTracks(selectedPlaylist);
  } catch (err) {
    setAction(`Fehler: ${err.message}`, "error");
  }
}

async function doRemoveSelectedTracks() {
  if (!selectedPlaylist || selectedTrackIds.size === 0) return;
  const confirmed = confirm(`${selectedTrackIds.size} Track(s) aus der Playlist entfernen?`);
  if (!confirmed) return;

  try {
    const ids = [...selectedTrackIds];
    const results = await window.playlistApi.removeTracks(selectedPlaylist.id, ids);
    const ok = results.filter((r) => r.status === "removed").length;
    setAction(`${ok} Track(s) entfernt.`, "success");
    selectedTrackIds.clear();
    await loadTracks(selectedPlaylist);
  } catch (err) {
    setAction(`Fehler: ${err.message}`, "error");
  }
}

function setAction(msg, level) {
  actionMessage = msg;
  actionLevel = level;
}

// ─── Render ─────────────────────────────────────────────────────────────────────

function render() {
  const container = document.getElementById("playlist-wiz-content");
  if (!container) return;

  const filteredPlaylists = filterText
    ? playlists.filter((p) =>
        p.name.toLowerCase().includes(filterText.toLowerCase()) ||
        p.id.includes(filterText)
      )
    : playlists;

  container.innerHTML = `
    ${actionMessage ? `
      <section class="panel span-full">
        <div class="callout ${actionLevel === "error" ? "warning" : "success"}">${esc(actionMessage)}</div>
      </section>
    ` : ""}

    ${error ? `
      <section class="panel span-full">
        <div class="callout warning">${esc(error)}</div>
        <p style="margin:8px 0 0;color:var(--muted);font-size:0.88rem">
          Stelle sicher, dass du im Scanner-Tab unter Auth → „API-Kontext exportieren" geklickt hast.
        </p>
      </section>
    ` : ""}

    <section class="panel wiz-sidebar">
      <div class="section-head">
        <h2>Playlists ${!loading ? `<span class="pill">${playlists.length}</span>` : ""}</h2>
        <div class="actions compact">
          <button id="wiz-refresh" type="button" ${loading ? "disabled" : ""}>Laden</button>
          <button id="wiz-create" type="button" class="primary">+ Neu</button>
        </div>
      </div>

      <div class="field-grid" style="margin-top:8px">
        <label class="wide">
          <input id="wiz-filter" type="text" placeholder="Playlist suchen…" value="${esc(filterText)}" />
        </label>
      </div>

      <div class="wiz-playlist-list" id="wiz-playlist-list">
        ${loading ? '<p class="placeholder-text">Lade Playlists…</p>' :
          filteredPlaylists.length === 0 ? '<p class="placeholder-text">Keine Playlists gefunden</p>' :
          filteredPlaylists.map((p) => `
            <div class="wiz-playlist-item ${selectedPlaylist?.id === p.id ? "is-selected" : ""}" data-id="${esc(p.id)}">
              <strong>${esc(p.name)}</strong>
              <span class="wiz-track-count">${p.trackCount} Tracks</span>
            </div>
          `).join("")
        }
      </div>
    </section>

    <section class="panel wiz-main">
      ${selectedPlaylist ? renderTrackPanel() : `
        <div class="placeholder-panel" style="min-height:400px">
          <p class="placeholder-text">Wähle eine Playlist aus der Liste, um ihre Tracks zu sehen und zu bearbeiten.</p>
        </div>
      `}
    </section>
  `;

  bindEvents(container);
}

function renderTrackPanel() {
  const sel = selectedPlaylist;
  return `
    <div class="section-head">
      <div>
        <h2>${esc(sel.name)}</h2>
        <p style="margin:0;color:var(--muted);font-size:0.84rem">
          ID: ${sel.id} · ${sel.trackCount} Tracks · ${sel.isPublic ? "Öffentlich" : "Privat"}
        </p>
      </div>
      <div class="actions compact">
        <button id="wiz-rename" type="button">Umbenennen</button>
        <button id="wiz-add-tracks" type="button" class="primary">+ Tracks</button>
        <button id="wiz-remove-tracks" type="button" ${selectedTrackIds.size === 0 ? "disabled" : ""}>${selectedTrackIds.size > 0 ? `${selectedTrackIds.size} entfernen` : "Entfernen"}</button>
        <button id="wiz-delete-playlist" type="button" class="danger">Löschen</button>
      </div>
    </div>

    ${tracksLoading ? '<p class="placeholder-text" style="padding:20px">Lade Tracks…</p>' :
      tracksError ? `<div class="callout warning" style="margin-top:10px">${esc(tracksError)}</div>` :
      tracks.length === 0 ? '<p class="placeholder-text" style="padding:20px">Keine Tracks in dieser Playlist</p>' : `
      <div class="wiz-select-bar">
        <label class="check" style="font-size:0.82rem">
          <input type="checkbox" id="wiz-select-all" ${selectedTrackIds.size === tracks.length && tracks.length > 0 ? "checked" : ""} />
          Alle auswählen (${selectedTrackIds.size}/${tracks.length})
        </label>
      </div>
      <div class="table-wrap" style="max-height:520px;margin-top:8px">
        <table>
          <thead>
            <tr>
              <th style="width:40px"></th>
              <th>#</th>
              <th>Titel</th>
              <th>Artist</th>
              <th>Genre</th>
              <th>BPM</th>
              <th>Key</th>
              <th>Label</th>
            </tr>
          </thead>
          <tbody>
            ${tracks.map((t, i) => `
              <tr class="selection-row ${selectedTrackIds.has(t.trackId) ? "is-focused" : ""}" data-track-id="${esc(t.trackId)}">
                <td class="selection-checkbox">
                  <input type="checkbox" class="wiz-track-cb" data-track-id="${esc(t.trackId)}" ${selectedTrackIds.has(t.trackId) ? "checked" : ""} />
                </td>
                <td>${i + 1}</td>
                <td class="wrap-cell">${esc(t.title)} ${t.mixName ? `<span style="color:var(--muted)">(${esc(t.mixName)})</span>` : ""}</td>
                <td class="wrap-cell">${esc(t.artists)}</td>
                <td>${esc(t.genre)}</td>
                <td>${t.bpm || ""}</td>
                <td>${esc(t.key || "")}</td>
                <td>${esc(t.label)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `}
  `;
}

// ─── Event-Binding ──────────────────────────────────────────────────────────────

function bindEvents(container) {
  container.querySelector("#wiz-refresh")?.addEventListener("click", () => refreshPlaylists());
  container.querySelector("#wiz-create")?.addEventListener("click", () => doCreatePlaylist());
  container.querySelector("#wiz-rename")?.addEventListener("click", () => doRenamePlaylist());
  container.querySelector("#wiz-delete-playlist")?.addEventListener("click", () => doDeletePlaylist());
  container.querySelector("#wiz-add-tracks")?.addEventListener("click", () => doAddTracks());
  container.querySelector("#wiz-remove-tracks")?.addEventListener("click", () => doRemoveSelectedTracks());

  // Filter
  container.querySelector("#wiz-filter")?.addEventListener("input", (e) => {
    filterText = e.target.value;
    render();
    // Re-focus filter input
    document.getElementById("wiz-filter")?.focus();
  });

  // Playlist-Auswahl (Event-Delegation)
  container.querySelector("#wiz-playlist-list")?.addEventListener("click", (e) => {
    const item = e.target.closest(".wiz-playlist-item");
    if (!item) return;
    const id = item.dataset.id;
    const playlist = playlists.find((p) => p.id === id);
    if (playlist) loadTracks(playlist);
  });

  // Track-Checkboxen
  for (const cb of container.querySelectorAll(".wiz-track-cb")) {
    cb.addEventListener("change", (e) => {
      const tid = e.target.dataset.trackId;
      if (e.target.checked) {
        selectedTrackIds.add(tid);
      } else {
        selectedTrackIds.delete(tid);
      }
      render();
    });
  }

  // Alle auswählen
  container.querySelector("#wiz-select-all")?.addEventListener("change", (e) => {
    if (e.target.checked) {
      for (const t of tracks) selectedTrackIds.add(t.trackId);
    } else {
      selectedTrackIds.clear();
    }
    render();
  });
}

// ─── Hilfsfunktionen ────────────────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}
