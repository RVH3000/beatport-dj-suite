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
  renderManualImportInstructions({
    title: "Sync fehlgeschlagen — Endpoint nicht erreichbar",
    candidates,
  });
}

// Plan C (v4.6.2): klare Schritt-fuer-Schritt-Anleitung + Auto-Detect-Button.
// Wenn ~/_handoff/bp_artists_response.json bereits existiert: 1-Klick-Import.
async function renderManualImportInstructions(opts = {}) {
  const grid = document.getElementById("artistsGrid");
  const stats = document.getElementById("artistsStats");
  if (stats) {
    stats.classList.add("empty");
    stats.innerHTML = `<strong style="color:var(--accent-warn,#E8A040);">⚠ ${esc(opts.title || "Manueller JSON-Import noetig")}</strong>`;
  }
  if (!grid) return;

  // Auto-Detect: existiert die Datei schon?
  let handoffInfo = null;
  try {
    handoffInfo = await window.artistsApi?.checkHandoffJson?.();
  } catch { /* ignore */ }

  const fileReady = handoffInfo?.exists && !handoffInfo?.empty && !handoffInfo?.invalid_json;
  const fileItems = handoffInfo?.item_count || 0;

  grid.innerHTML = `
    <div class="callout warn" style="grid-column:1/-1;padding:1rem;">
      <p><strong style="font-size:1.05em;">${esc(opts.title || "Manueller JSON-Import noetig")}</strong></p>

      ${fileReady ? `
        <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.3);border-radius:6px;padding:.8rem;margin:.8rem 0;">
          <p style="margin:0 0 .4rem;color:var(--success,#4ade80);">
            ✓ Datei gefunden: <code>${esc(handoffInfo.path)}</code>
          </p>
          <p style="margin:.2rem 0;opacity:.85;font-size:.88em;">
            ${fmt(fileItems)} Artists in der JSON-Datei.
            Letzte Aenderung: ${esc(handoffInfo.mtime ? new Date(handoffInfo.mtime).toLocaleString("de-DE") : "?")}
          </p>
          <button id="artistsImportHandoffBtn" type="button" class="primary" style="margin-top:.5rem;">
            Jetzt importieren (${fmt(fileItems)} Artists)
          </button>
        </div>
      ` : ""}

      <p style="opacity:.92;margin-top:.6rem;font-size:.94em;">
        ${fileReady ? "<strong>Oder:</strong> JSON-Datei neu holen:" : "<strong>JSON-Datei holen (einmalig):</strong>"}
      </p>
      <ol style="opacity:.92;font-size:.92em;margin:.5rem 0 .8rem 1.4rem;line-height:1.7;">
        <li>Im normalen Browser <a href="https://my.beatport.com/artists" target="_blank">my.beatport.com/artists</a> oeffnen (eingeloggt)</li>
        <li>DevTools oeffnen: <code>Cmd+Option+I</code> → Tab <strong>Network</strong></li>
        <li>Filter-Feld: <code>artists</code> eintippen, dann <code>Cmd+R</code> (Reload)</li>
        <li>Den Request auf <code>api.beatport.com/v4/my/beatport/artists/</code> anklicken</li>
        <li>Tab <strong>Response</strong> → Rechtsklick aufs JSON → <strong>Copy Response</strong></li>
        <li>In Terminal:
          <pre style="font-size:.78em;background:rgba(255,255,255,.05);padding:.5rem;border-radius:4px;margin-top:.3rem;overflow-x:auto;">mkdir -p ~/_handoff && pbpaste > ~/_handoff/bp_artists_response.json</pre>
        </li>
        <li>Danach: hier auf "↻ Neu laden" klicken — der Import-Button erscheint automatisch</li>
      </ol>

      ${opts.candidates && opts.candidates.length > 0 ? `
        <details style="margin-top:.8rem;">
          <summary style="opacity:.7;cursor:pointer;font-size:.82em;">Details: probierte API-URLs (${opts.candidates.length})</summary>
          <ul style="opacity:.75;font-size:.8em;margin:.3rem 0 0 1.2rem;">
            ${opts.candidates.map((c) => `<li><code>${esc(c)}</code></li>`).join("")}
          </ul>
        </details>
      ` : ""}

      <p style="opacity:.65;font-size:.8em;margin-top:.8rem;">
        Hintergrund: der automatische Sync via API funktioniert aktuell nicht zuverlaessig
        (NextAuth-Cookies fehlen in der App-Webview). Manueller Import ist der etablierte Pfad
        analog Labels. Plan C v4.6.2.
      </p>
    </div>
  `;

  // Auto-Import-Button binden
  if (fileReady) {
    document.getElementById("artistsImportHandoffBtn")?.addEventListener("click", async () => {
      const btn = document.getElementById("artistsImportHandoffBtn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Importiere...";
      }
      try {
        const result = await window.artistsApi.importFromHandoff({ driftDetect: false });
        if (result?.ok) {
          // Erfolg — Tab neu laden
          await fetchAndRender();
        } else {
          renderError(`Import fehlgeschlagen: ${result?.message || "unbekannt"}`, "");
        }
      } catch (err) {
        renderError("Import-Fehler", String(err?.message || err));
      }
    });
  }
}

function renderAuthExpired() {
  const grid = document.getElementById("artistsGrid");
  const stats = document.getElementById("artistsStats");
  if (stats) {
    stats.classList.add("empty");
    stats.innerHTML = `<strong style="color:var(--accent-warn,#E8A040);">⚠ Beatport-Token abgelaufen</strong>`;
  }
  if (grid) {
    grid.innerHTML = `
      <div class="callout warn" style="grid-column:1/-1;padding:1rem;">
        <p><strong style="font-size:1.05em;">🔐 Auth-Token ist abgelaufen — der Sync funktioniert nicht mehr.</strong></p>
        <p style="opacity:.92;margin-top:.6rem;font-size:.94em;">
          So holst du dir einen frischen Token:
        </p>
        <ol style="opacity:.92;font-size:.92em;margin:.5rem 0 .8rem 1.4rem;line-height:1.7;">
          <li>Stelle sicher, dass du bei <a href="https://www.beatport.com/" target="_blank">beatport.com</a>
              im Browser eingeloggt bist (zur Sicherheit dort einmal die Seite öffnen).</li>
          <li>In <strong>dieser App</strong> oben in der <strong>Statusbar</strong> auf
              den Button <code style="background:rgba(255,255,255,.08);padding:1px 6px;border-radius:3px;">⇪ API-Kontext</code> klicken.</li>
          <li>Eine kurze Bestätigung erscheint („API-Kontext exportiert").</li>
          <li>Hier zurück und nochmals auf
              <code style="background:rgba(255,255,255,.08);padding:1px 6px;border-radius:3px;">Aus Beatport synchronisieren</code> klicken.</li>
        </ol>
        <p style="opacity:.75;font-size:.85em;margin-top:.5rem;">
          Hintergrund: Beatport-Tokens leben max. 1 Stunde. Die App liest den aktuellen Token
          aus deiner Beatport-Browser-Session.
        </p>
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
    if (result?.code === "auth-expired") {
      renderAuthExpired();
      return;
    }
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
