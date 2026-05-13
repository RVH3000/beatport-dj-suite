/**
 * Artists-Tab — Ansicht der gefolgten Beatport-Artists (myBeatport).
 *
 * Daten kommen aus data/suite.db (Tabelle bp_artists) via window.artistsApi.
 *
 * Backlog-Punkt 31 (v4.5.0):
 *  - Primaerer Datenpfad: IPC-Sync (Button "Aus Beatport synchronisieren")
 *    via xhr-scanner.mjs fetchMyArtists() → import_beatport_artists.py.
 *  - Fallback bei 404 / endpoint-not-found: manueller JSON-Import-Hinweis,
 *    analog Labels.
 *  - Aufbau analog labels.js (Stats + Grid + Cover + Filter + Sort).
 */

import { esc, fmt } from "../lib/track-utils.js";

let allArtists = [];
let currentOrder = "release_count";
let currentFilter = "";
let syncBusy = false;

function thumbUrl(artist, size = 120) {
  if (artist.image_dynamic) {
    return artist.image_dynamic.replace("{w}", size).replace("{h}", size);
  }
  return artist.image_uri || "";
}

function renderStats(stats) {
  const el = document.getElementById("artistsStats");
  if (!el) return;
  const last = stats.last_synced_at
    ? new Date(stats.last_synced_at).toLocaleString("de-DE")
    : "nie";
  el.classList.remove("empty");
  el.innerHTML = `
    <strong>${fmt(stats.followed)}</strong> Artists gefolgt ·
    <strong>${fmt(stats.total_releases)}</strong> Releases gesamt ·
    <strong>${fmt(stats.total_tracks)}</strong> Tracks gesamt ·
    letzter Sync: ${esc(last)}
  `;
}

function matchesFilter(artist) {
  if (!currentFilter) return true;
  const q = currentFilter.toLowerCase();
  return (
    (artist.name || "").toLowerCase().includes(q) ||
    (artist.slug || "").toLowerCase().includes(q)
  );
}

function renderGrid() {
  const grid = document.getElementById("artistsGrid");
  if (!grid) return;

  const filtered = allArtists.filter(matchesFilter);
  if (filtered.length === 0) {
    grid.innerHTML = currentFilter
      ? `<p class="placeholder-text">Keine Artists (Filter: "${esc(currentFilter)}").</p>`
      : `<p class="placeholder-text">Noch keine Artists importiert. Klick auf „Aus Beatport synchronisieren" oben rechts.</p>`;
    return;
  }

  grid.innerHTML = filtered.map((a) => {
    const initial = esc((a.name || "?")[0]);
    const release = a.release_count || 0;
    const tracks = a.track_count || 0;
    const stats = release > 0
      ? `${fmt(release)} Releases${tracks > 0 ? ` · ${fmt(tracks)} Tracks` : ""}`
      : (tracks > 0 ? `${fmt(tracks)} Tracks` : "—");
    return `
    <div class="label-card" data-id="${a.id}">
      <div class="label-thumb">
        ${a.image_dynamic || a.image_uri
          ? `<img src="${esc(thumbUrl(a, 120))}" alt="${esc(a.name)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=&quot;label-thumb-empty&quot;>${initial}</div>'" />`
          : `<div class="label-thumb-empty">${initial}</div>`}
      </div>
      <div class="label-meta">
        <div class="label-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="label-count">${stats}</div>
      </div>
    </div>
  `;
  }).join("");
}

function renderEndpointNotFound(candidates) {
  const grid = document.getElementById("artistsGrid");
  const stats = document.getElementById("artistsStats");
  if (stats) {
    stats.classList.add("empty");
    stats.innerHTML = `<strong style="color:var(--accent-warn,#E8A040);">⚠ Beatport-API-Endpoint für Artists nicht gefunden</strong>`;
  }
  if (grid) {
    grid.innerHTML = `
      <div class="callout warn" style="grid-column:1/-1;padding:1rem;">
        <p><strong>Sync fehlgeschlagen — Endpoint nicht erreichbar</strong></p>
        <p style="opacity:.85;font-size:.92em;margin-top:.5rem;">
          Folgende URLs wurden probiert:
        </p>
        <ul style="opacity:.8;font-size:.85em;margin:.3rem 0 .8rem 1.2rem;">
          ${(candidates || []).map((c) => `<li><code>${esc(c)}</code></li>`).join("")}
        </ul>
        <p style="opacity:.85;font-size:.92em;">
          <strong>Fallback (manueller Import):</strong> JSON über
          <a href="https://my.beatport.com/artists" target="_blank">my.beatport.com/artists</a>
          via Browser-DevTools holen und ablegen unter
          <code>~/_handoff/bp_artists_response.json</code>, dann:
        </p>
        <pre style="font-size:.78em;background:rgba(255,255,255,.05);padding:.5rem;border-radius:4px;margin-top:.5rem;overflow-x:auto;">python3 scripts/import_beatport_artists.py \\
    --db "$HOME/Library/Application Support/beatport-dj-suite/suite.db" \\
    --input ~/_handoff/bp_artists_response.json</pre>
      </div>
    `;
  }
}

function renderError(message, detail) {
  const grid = document.getElementById("artistsGrid");
  const stats = document.getElementById("artistsStats");
  if (stats) {
    stats.classList.add("empty");
    stats.innerHTML = `<strong style="color:var(--accent-warn,#E8A040);">⚠ ${esc(message)}</strong>`;
  }
  if (grid) {
    grid.innerHTML = `
      <div class="callout warn" style="grid-column:1/-1;padding:1rem;">
        <p><strong>${esc(message)}</strong></p>
        ${detail ? `<p style="opacity:.8;font-size:.9em;margin-top:.5rem;">${esc(detail)}</p>` : ""}
        <p style="opacity:.7;font-size:.85em;margin-top:.75rem;">
          Klick auf „Aus Beatport synchronisieren" oben rechts startet einen neuen Sync-Versuch.
        </p>
      </div>
    `;
  }
}

async function fetchAndRender() {
  const api = window.artistsApi;
  if (!api) {
    renderError("artistsApi nicht verfügbar", "Die Renderer-Bridge fehlt — App-Start fehlerhaft?");
    return;
  }
  try {
    const statsResult = await api.stats();
    const listResult = await api.list({ order: currentOrder, limit: 5000 });

    if (!statsResult?.ok && !listResult?.ok) {
      const errMsg = listResult?.error || statsResult?.error || "unbekannter Fehler";
      renderError("Keine Artists-Daten verfügbar", String(errMsg));
      return;
    }

    if (statsResult?.ok) renderStats(statsResult);
    if (listResult?.ok) {
      allArtists = listResult.artists || [];
      renderGrid();
    } else {
      renderError("Artists-Liste konnte nicht geladen werden", String(listResult?.error || ""));
    }
  } catch (err) {
    renderError("Fehler beim Laden der Artists", String(err?.message || err));
  }
}

function setSyncButton(busy, label) {
  const btn = document.getElementById("artistsSyncBtn");
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = label || (busy ? "Synchronisiere…" : "Aus Beatport synchronisieren");
}

async function doSync() {
  if (syncBusy) return;
  const api = window.artistsApi;
  if (!api?.sync) {
    renderError("Sync-Funktion nicht verfügbar", "artistsApi.sync fehlt — App neustarten.");
    return;
  }
  syncBusy = true;
  setSyncButton(true, "Synchronisiere…");
  try {
    const result = await api.sync({ driftDetect: true });
    if (result?.code === "endpoint-not-found") {
      renderEndpointNotFound(result.candidates);
      return;
    }
    if (!result?.ok) {
      renderError("Sync fehlgeschlagen", String(result?.error || result?.message || "unbekannt"));
      return;
    }
    // Erfolg — Tab neu laden
    await fetchAndRender();
  } catch (err) {
    renderError("Sync-Fehler", String(err?.message || err));
  } finally {
    syncBusy = false;
    setSyncButton(false);
  }
}

let initialized = false;

export async function initArtistsTab() {
  if (!initialized) {
    initialized = true;
    const filter = document.getElementById("artistsFilter");
    const order = document.getElementById("artistsOrder");
    const refresh = document.getElementById("artistsRefreshBtn");
    const syncBtn = document.getElementById("artistsSyncBtn");

    if (filter) {
      filter.addEventListener("input", (e) => {
        // Cursor-Position-Erhalt (Lehre v4.3.4): wir rendern nur das Grid neu,
        // nicht das Filter-Input — kein Cursor-Sprung.
        currentFilter = e.target.value;
        renderGrid();
      });
    }
    if (order) {
      order.addEventListener("change", (e) => {
        currentOrder = e.target.value;
        fetchAndRender();
      });
    }
    if (refresh) refresh.addEventListener("click", fetchAndRender);
    if (syncBtn) syncBtn.addEventListener("click", doSync);
  }
  await fetchAndRender();
}
