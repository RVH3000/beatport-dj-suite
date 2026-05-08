/**
 * Labels-Tab — read-only Ansicht der gefolgten Beatport-Labels.
 * Daten kommen aus data/suite.db (Tabelle bp_labels) via window.labelsApi.
 */

let allLabels = [];
let currentOrder = "count";
let currentFilter = "";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(n) {
  return new Intl.NumberFormat("de-DE").format(n || 0);
}

function thumbUrl(label, size = 120) {
  if (label.image_dynamic) {
    return label.image_dynamic.replace("{w}", size).replace("{h}", size);
  }
  return label.image_uri || "";
}

function renderStats(stats) {
  const el = document.getElementById("labelsStats");
  if (!el) return;
  const last = stats.last_synced_at ? new Date(stats.last_synced_at).toLocaleString("de-DE") : "nie";
  el.classList.remove("empty");
  el.innerHTML = `
    <strong>${fmt(stats.total)}</strong> Labels gefolgt ·
    <strong>${fmt(stats.total_releases)}</strong> Releases gesamt ·
    ${fmt(stats.zero_release_count)} ohne aktuellen Release ·
    letzter Sync: ${esc(last)}
  `;
}

function matchesFilter(label) {
  if (!currentFilter) return true;
  return (label.name || "").toLowerCase().includes(currentFilter.toLowerCase());
}

function renderGrid() {
  const grid = document.getElementById("labelsGrid");
  if (!grid) return;

  const filtered = allLabels.filter(matchesFilter);
  if (filtered.length === 0) {
    grid.innerHTML = `<p class="placeholder-text">Keine Labels (Filter: "${esc(currentFilter)}").</p>`;
    return;
  }

  grid.innerHTML = filtered.map((l) => `
    <div class="label-card" data-id="${l.id}">
      <div class="label-thumb">
        ${l.image_dynamic || l.image_uri
          ? `<img src="${esc(thumbUrl(l, 120))}" alt="${esc(l.name)}" loading="lazy" />`
          : `<div class="label-thumb-empty">${esc((l.name || "?")[0])}</div>`}
      </div>
      <div class="label-meta">
        <div class="label-name" title="${esc(l.name)}">${esc(l.name)}</div>
        <div class="label-count">${fmt(l.release_count)} Releases</div>
      </div>
    </div>
  `).join("");
}

function renderError(message, detail) {
  const grid = document.getElementById("labelsGrid");
  const stats = document.getElementById("labelsStats");
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
          Die App nutzt <code>~/Library/Application Support/beatport-dj-suite/suite.db</code>
          (auto-initialisiert beim ersten Start). Tabelle <code>bp_labels</code> wird vom
          Re-Import-Script angelegt:
        </p>
        <pre style="font-size:.8em;background:rgba(255,255,255,.05);padding:.5rem;border-radius:4px;margin-top:.5rem;overflow-x:auto;">python3 scripts/import_beatport_labels.py \\
    --db "$HOME/Library/Application Support/beatport-dj-suite/suite.db" \\
    --input ~/_handoff/bp_labels_response.json</pre>
        <p style="opacity:.7;font-size:.8em;margin-top:.5rem;">
          Quelle: <code>GET /v4/my/beatport/labels/</code> (eigener Account, Beatport-API).
        </p>
      </div>
    `;
  }
}

async function fetchAndRender() {
  const api = window.labelsApi;
  if (!api) {
    renderError("labelsApi nicht verfügbar", "Die Renderer-Bridge fehlt — App-Start fehlerhaft?");
    return;
  }
  try {
    const statsResult = await api.stats();
    const listResult = await api.list({ order: currentOrder, limit: 2000 });

    if (!statsResult?.ok && !listResult?.ok) {
      const errMsg = listResult?.error || statsResult?.error || "unbekannter Fehler";
      renderError("Keine Labels-Daten verfügbar", String(errMsg));
      return;
    }

    if (statsResult?.ok) renderStats(statsResult);
    if (listResult?.ok) {
      allLabels = listResult.labels || [];
      if (allLabels.length === 0) {
        renderError("Labels-DB leer oder nicht initialisiert", "Tabelle bp_labels hat 0 Einträge.");
      } else {
        renderGrid();
      }
    } else {
      renderError("Labels-Liste konnte nicht geladen werden", String(listResult?.error || ""));
    }
  } catch (err) {
    renderError("Fehler beim Laden der Labels", String(err?.message || err));
  }
}

let initialized = false;

export async function initLabelsTab() {
  if (!initialized) {
    initialized = true;
    const filter = document.getElementById("labelsFilter");
    const order = document.getElementById("labelsOrder");
    const refresh = document.getElementById("labelsRefreshBtn");

    if (filter) {
      filter.addEventListener("input", (e) => {
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
  }
  await fetchAndRender();
}
