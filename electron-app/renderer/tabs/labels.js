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

async function fetchAndRender() {
  const api = window.labelsApi;
  if (!api) {
    console.error("[labels] labelsApi nicht verfügbar");
    return;
  }
  try {
    const statsResult = await api.stats();
    if (statsResult?.ok) renderStats(statsResult);

    const listResult = await api.list({ order: currentOrder, limit: 2000 });
    if (listResult?.ok) {
      allLabels = listResult.labels || [];
      renderGrid();
    } else {
      console.error("[labels] list fehlgeschlagen:", listResult?.error);
    }
  } catch (err) {
    console.error("[labels] fetchAndRender fehler:", err);
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
