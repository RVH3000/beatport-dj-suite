/**
 * playlist-wiz.js — Playlist WIZ Tab
 *
 * Live-Verbindung zur Beatport API über den XHR-Client.
 * Playlists anzeigen, erstellen, umbenennen, löschen.
 * Tracks anzeigen, hinzufügen, entfernen.
 *
 * Benötigt gültigen API-Kontext (im Scanner-Tab exportieren).
 */

const PLAYLIST_WIZ_MUTATION_EVENT = "beatport-suite:playlist-wiz-mutated";

let playlists = [];
let selectedPlaylist = null;
let tracks = [];
let selectedTrackIds = new Set();
let loading = false;
let tracksLoading = false;
let mutationBusy = false;
let forceReloadRequested = false;
let staleReason = "";
let error = "";
let tracksError = "";
let filterText = "";
let actionMessage = "";
let actionLevel = "";

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
  tracksLoading = true;
  tracksError = "";
  tracks = [];
  if (!options.silent) {
    render();
  }

  try {
    const nextTracks = await window.playlistApi.tracks(playlist.id);
    tracks = Array.isArray(nextTracks) ? nextTracks : [];
  } catch (err) {
    tracksError = err.message || "Tracks konnten nicht geladen werden.";
    tracks = [];
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
              <div class="wiz-select-bar">
                <label class="check" style="font-size:0.82rem">
                  <input
                    type="checkbox"
                    id="wiz-select-all"
                    ${
                      selectedTrackIds.size === tracks.length && tracks.length > 0
                        ? "checked"
                        : ""
                    }
                    ${disableTrackActions ? "disabled" : ""}
                  />
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
                    ${tracks
                      .map(
                        (track, index) => `
                          <tr
                            class="selection-row ${
                              selectedTrackIds.has(track.trackId) ? "is-focused" : ""
                            }"
                            data-track-id="${esc(track.trackId)}"
                          >
                            <td class="selection-checkbox">
                              <input
                                type="checkbox"
                                class="wiz-track-cb"
                                data-track-id="${esc(track.trackId)}"
                                ${
                                  selectedTrackIds.has(track.trackId) ? "checked" : ""
                                }
                                ${disableTrackActions ? "disabled" : ""}
                              />
                            </td>
                            <td>${index + 1}</td>
                            <td class="wrap-cell">
                              ${esc(track.title)}
                              ${
                                track.mixName
                                  ? `<span style="color:var(--muted)">(${esc(
                                      track.mixName
                                    )})</span>`
                                  : ""
                              }
                            </td>
                            <td class="wrap-cell">${esc(track.artists)}</td>
                            <td>${esc(track.genre)}</td>
                            <td>${track.bpm || ""}</td>
                            <td>${esc(track.key || "")}</td>
                            <td>${esc(track.label)}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
    }
  `;
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
    render();
    document.getElementById("wiz-filter")?.focus();
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

  for (const checkbox of container.querySelectorAll(".wiz-track-cb")) {
    checkbox.addEventListener("change", (event) => {
      const trackId = event.target.dataset.trackId;
      if (event.target.checked) {
        selectedTrackIds.add(trackId);
      } else {
        selectedTrackIds.delete(trackId);
      }
      render();
    });
  }

  container.querySelector("#wiz-select-all")?.addEventListener("change", (event) => {
    if (event.target.checked) {
      for (const track of tracks) {
        selectedTrackIds.add(track.trackId);
      }
    } else {
      selectedTrackIds.clear();
    }
    render();
  });
}

function esc(str) {
  const node = document.createElement("div");
  node.textContent = str || "";
  return node.innerHTML;
}
