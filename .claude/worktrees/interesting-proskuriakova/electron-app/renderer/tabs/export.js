/**
 * export.js — Export-Tab Logik
 *
 * Unterstützte Formate: Rekordbox XML, Traktor NML, JSON, JSONL.
 * CSV-Export läuft weiterhin über den Scanner-Tab (existierende Logik).
 */

const FORMATS = [
  {
    id: "rekordbox",
    label: "Rekordbox XML",
    desc: "Pioneer Rekordbox — Playlists + Tracks mit BPM, Key, Genre, Label.",
    ext: ".xml",
    icon: "🎛",
    defaultName: "beatport-rekordbox",
  },
  {
    id: "traktor",
    label: "Traktor NML",
    desc: "Native Instruments Traktor — Collection + Playlists mit BPM, Key, Genre.",
    ext: ".nml",
    icon: "🎚",
    defaultName: "beatport-traktor",
  },
  {
    id: "json",
    label: "JSON",
    desc: "Strukturiertes JSON — alle Playlists mit verschachtelten Tracks.",
    ext: ".json",
    icon: "{ }",
    defaultName: "beatport-export",
  },
  {
    id: "jsonl",
    label: "JSON Lines",
    desc: "Eine Playlist pro Zeile — ideal für Streaming-Verarbeitung und CLI-Tools.",
    ext: ".jsonl",
    icon: "⤓",
    defaultName: "beatport-export",
  },
];

let exporting = false;
let lastResult = null;
let lastError = "";

export function renderExportTab() {
  const container = document.getElementById("export-content");
  if (!container) return;

  container.innerHTML = `
    <section class="panel span-full">
      <h2>DJ-Software Export</h2>
      <p style="color:var(--muted);margin:0 0 14px">
        Exportiert alle analysierten Playlists und Tracks aus dem lokalen Cache
        in das gewählte Format. Der bestehende CSV-Export ist weiterhin im Scanner-Tab verfügbar.
      </p>
      <div class="export-grid" id="export-format-grid">
        ${FORMATS.map((f) => `
          <button class="export-card" data-format="${f.id}" ${exporting ? "disabled" : ""}>
            <span class="export-icon">${f.icon}</span>
            <strong>${f.label}</strong>
            <span class="export-ext">${f.ext}</span>
            <p>${f.desc}</p>
          </button>
        `).join("")}
      </div>
    </section>

    <section class="panel span-full" id="export-result-panel" ${lastResult || lastError ? "" : "hidden"}>
      <h2>Letzter Export</h2>
      <div id="export-result"></div>
    </section>
  `;

  // Event-Listener
  container.querySelector("#export-format-grid").addEventListener("click", (e) => {
    const card = e.target.closest(".export-card");
    if (!card || exporting) return;
    const formatId = card.dataset.format;
    const format = FORMATS.find((f) => f.id === formatId);
    if (format) runExport(format);
  });

  if (lastResult || lastError) {
    renderResult();
  }
}

async function runExport(format) {
  if (exporting) return;
  exporting = true;
  lastResult = null;
  lastError = "";
  renderExportTab();

  try {
    // Speicherpfad wählen
    const saveResult = await window.exportApi.chooseSavePath({
      title: `${format.label} exportieren`,
      defaultName: format.defaultName,
      format: format.id,
    });

    if (saveResult.canceled) {
      exporting = false;
      renderExportTab();
      return;
    }

    // Config aus Scanner-Tab lesen (getCurrentConfig wird global bereitgestellt)
    const config = typeof window.getCurrentConfig === "function" ? window.getCurrentConfig() : {};

    lastResult = await window.exportApi.generate(config, {
      format: format.id,
      outputPath: saveResult.filePath,
    });
  } catch (err) {
    lastError = err.message || "Export fehlgeschlagen.";
  } finally {
    exporting = false;
  }

  renderExportTab();
}

function renderResult() {
  const panel = document.getElementById("export-result-panel");
  const container = document.getElementById("export-result");
  if (!panel || !container) return;

  panel.hidden = false;

  if (lastError) {
    container.innerHTML = `<div class="callout warning">${escapeHtml(lastError)}</div>`;
    return;
  }

  if (!lastResult) return;

  const sizeKb = (lastResult.size / 1024).toFixed(1);
  container.innerHTML = `
    <div class="callout success">
      Export erfolgreich gespeichert.
    </div>
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
        <strong class="stat-value">${lastResult.trackCount.toLocaleString("de")}</strong>
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
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}
