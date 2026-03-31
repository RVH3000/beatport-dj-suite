/**
 * export.js — Export-Tab Logik
 *
 * Unterstützte Formate: Rekordbox XML, Traktor NML, JSON, JSONL.
 * CSV-Export läuft weiterhin über den Scanner-Tab.
 */

const FORMATS = [
  {
    id: "rekordbox",
    label: "Rekordbox XML",
    desc: "Pioneer Rekordbox — Playlists + Tracks mit BPM, Key, Genre, Label. Lexicon-kompatibel.",
    ext: ".xml",
    icon: "🎛",
    defaultName: "beatport-rekordbox",
    lexicon: true,
  },
  {
    id: "traktor",
    label: "Traktor NML",
    desc: "Native Instruments Traktor — Collection + Playlists mit BPM, Key, Genre. Lexicon-kompatibel.",
    ext: ".nml",
    icon: "🎚",
    defaultName: "beatport-traktor",
    lexicon: true,
  },
  {
    id: "csv",
    label: "CSV",
    desc: "Tabelle mit allen Tracks — Title, Artist, BPM, Key, Genre, Label. Lexicon-kompatibel.",
    ext: ".csv",
    icon: "📊",
    defaultName: "beatport-tracks",
    lexicon: true,
  },
  {
    id: "json",
    label: "JSON",
    desc: "Strukturiertes JSON — alle Playlists mit verschachtelten Tracks. Fuer CLI/Entwicklung.",
    ext: ".json",
    icon: "{ }",
    defaultName: "beatport-export",
    lexicon: false,
  },
];

let exporting = false;
let lastResult = null;
let lastError = "";
let cacheSummary = null;
let cacheStatusError = "";
let cacheStatusLoading = false;
let lastConfigJson = "";

function getCurrentConfig() {
  return typeof window.getCurrentConfig === "function"
    ? window.getCurrentConfig()
    : {};
}

function canExport() {
  return (
    !exporting &&
    !cacheStatusLoading &&
    !cacheStatusError &&
    Number(cacheSummary?.trackCount || 0) > 0
  );
}

async function ensureCacheSummary(config) {
  const configJson = JSON.stringify(config || {});
  if (cacheStatusLoading || configJson === lastConfigJson) {
    return;
  }

  cacheStatusLoading = true;
  cacheStatusError = "";
  renderMarkup();

  try {
    const status = await window.scannerApi.getCacheStatus(config);
    const counts = status?.counts || {};
    cacheSummary = {
      playlistCount: counts.playlists ?? 0,
      trackCount: counts.tracks ?? 0,
      analyzedPlaylistCount: counts.analyzedPlaylists ?? 0,
      dirtyPlaylistCount: counts.dirtyPlaylists ?? 0,
    };
    lastConfigJson = configJson;
  } catch (err) {
    cacheSummary = null;
    cacheStatusError =
      err.message || "Cache-Status konnte nicht geladen werden.";
  } finally {
    cacheStatusLoading = false;
  }
}

export async function renderExportTab() {
  const container = document.getElementById("export-content");
  if (!container) return;

  renderMarkup();
  await ensureCacheSummary(getCurrentConfig());
  renderMarkup();
}

export function forceReload() {
  cacheSummary = null;
  cacheStatusError = "";
  cacheStatusLoading = false;
  lastConfigJson = "";
  lastError = "";
}

async function runExport(format) {
  if (!canExport()) {
    lastError =
      cacheStatusError ||
      "Keine Cache-Trackdaten vorhanden. Führe zuerst Delta-Sync oder Analyse aus.";
    renderMarkup();
    return;
  }

  exporting = true;
  lastResult = null;
  lastError = "";
  renderMarkup();

  try {
    const saveResult = await window.exportApi.chooseSavePath({
      title: `${format.label} exportieren`,
      defaultName: format.defaultName,
      format: format.id,
    });

    if (saveResult.canceled) {
      return;
    }

    lastResult = await window.exportApi.generate(getCurrentConfig(), {
      format: format.id,
      outputPath: saveResult.filePath,
    });
  } catch (err) {
    lastError = err.message || "Export fehlgeschlagen.";
  } finally {
    exporting = false;
  }

  renderMarkup();
}

function renderCacheCallout() {
  if (cacheStatusLoading) {
    return '<div class="callout">Prüfe lokalen Arbeitsbestand ...</div>';
  }
  if (cacheStatusError) {
    return `<div class="callout warning">${escapeHtml(cacheStatusError)}</div>`;
  }
  if (!cacheSummary || cacheSummary.trackCount === 0) {
    return `
      <div class="callout warning">
        Keine Cache-Trackdaten vorhanden. Führe zuerst Delta-Sync oder eine Analyse aus.
      </div>
    `;
  }
  return `
    <div class="callout success">
      Cache bereit: ${cacheSummary.playlistCount} Playlists, ${cacheSummary.trackCount.toLocaleString(
        "de-AT"
      )} Tracks, ${cacheSummary.analyzedPlaylistCount} analysiert, ${cacheSummary.dirtyPlaylistCount} dirty.
    </div>
  `;
}

function renderMarkup() {
  const container = document.getElementById("export-content");
  if (!container) return;

  const exportEnabled = canExport();
  container.innerHTML = `
    <section class="panel span-full">
      <h2>DJ-Software Export</h2>
      <p style="color:var(--muted);margin:0 0 14px">
        Exportiert alle analysierten Playlists und Tracks aus dem lokalen Cache
        in das gewählte Format. Der bestehende CSV-Export bleibt im Scanner-Tab.
      </p>
      ${renderCacheCallout()}
      <div class="export-grid" id="export-format-grid">
        ${FORMATS.map(
          (format) => `
            <button
              class="export-card"
              data-format="${format.id}"
              ${exportEnabled ? "" : "disabled"}
            >
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="export-icon">${format.icon}</span>
                ${format.lexicon ? '<span class="pill success" style="font-size:0.55rem">Lexicon</span>' : ""}
              </div>
              <strong>${format.label}</strong>
              <span class="export-ext">${format.ext}</span>
              <p>${format.desc}</p>
            </button>
          `
        ).join("")}
      </div>
    </section>

    <section class="panel span-full">
      <div class="section-head">
        <h2>Lexicon Komplett-Export</h2>
        <button type="button" id="lexiconFullExportBtn" title="Alle Tracks und Playlists aus Lexicon lesen und als CSV + JSON auf den Desktop exportieren" style="padding:4px 10px;font-size:0.68rem">Lexicon auslesen</button>
      </div>
      <p style="color:var(--muted);font-size:0.7rem;margin:2px 0 6px">
        Liest <b>alle</b> Tracks mit saemtlichen Metadaten aus Lexicon (playCount, energy, cuepoints, tags, etc.) und exportiert als CSV + JSON auf den Desktop. Lexicon muss laufen.
      </p>
      <div id="lexicon-export-result"></div>
    </section>

    <section class="panel span-full" id="export-result-panel" ${
      lastResult || lastError ? "" : "hidden"
    }>
      <h2>Letzter Export</h2>
      <div id="export-result"></div>
    </section>
  `;

  container
    .querySelector("#export-format-grid")
    ?.addEventListener("click", (event) => {
      const card = event.target.closest(".export-card");
      if (!card || !exportEnabled) return;
      const format = FORMATS.find((entry) => entry.id === card.dataset.format);
      if (format) {
        runExport(format);
      }
    });

  // Lexicon Full Export
  container.querySelector("#lexiconFullExportBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("lexiconFullExportBtn");
    const result = document.getElementById("lexicon-export-result");
    btn.disabled = true;
    btn.textContent = "Lese Lexicon...";
    result.innerHTML = '<span style="color:var(--muted);font-size:0.72rem">Lade alle Tracks aus Lexicon...</span>';

    try {
      const data = await window.unifiedApi.lexiconFullExport({});
      result.innerHTML = `
        <div class="callout success" style="font-size:0.72rem">
          <strong>&check; Export erfolgreich!</strong><br>
          <b>${data.trackCount.toLocaleString("de-DE")}</b> Tracks + <b>${data.playlistCount}</b> Playlists exportiert.<br>
          Felder: ${data.fields.join(", ")}<br><br>
          <code style="font-size:0.65rem">${data.csvPath}</code><br>
          <code style="font-size:0.65rem">${data.jsonPath}</code>
        </div>`;
      btn.textContent = "Fertig!";
    } catch (err) {
      result.innerHTML = `<div class="callout warning" style="font-size:0.72rem">${err.message || String(err)}<br><small>Ist Lexicon gestartet? (Port 48624)</small></div>`;
      btn.textContent = "Lexicon auslesen";
      btn.disabled = false;
    }
  });

  if (lastResult || lastError) {
    renderResult();
  }
}

function renderResult() {
  const panel = document.getElementById("export-result-panel");
  const container = document.getElementById("export-result");
  if (!panel || !container) return;

  panel.hidden = false;

  if (lastError) {
    container.innerHTML = `<div class="callout warning">${escapeHtml(
      lastError
    )}</div>`;
    return;
  }

  if (!lastResult) return;

  const sizeKb = (lastResult.size / 1024).toFixed(1);
  container.innerHTML = `
    <div class="callout success">Export erfolgreich gespeichert.</div>
    <div class="export-result-grid">
      <div class="stat-card">
        <span class="stat-label">Format</span>
        <strong class="stat-value">${lastResult.format}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">Playlists</span>
        <strong class="stat-value">${lastResult.playlistCount}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">Tracks</span>
        <strong class="stat-value">${lastResult.trackCount.toLocaleString(
          "de-AT"
        )}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">Größe</span>
        <strong class="stat-value">${sizeKb} KB</strong>
      </div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button id="export-open-btn" type="button">Im Finder anzeigen</button>
    </div>
  `;

  container.querySelector("#export-open-btn")?.addEventListener("click", () => {
    window.scannerApi.openPath(lastResult.path);
  });
}

function escapeHtml(str) {
  const node = document.createElement("div");
  node.textContent = str || "";
  return node.innerHTML;
}
