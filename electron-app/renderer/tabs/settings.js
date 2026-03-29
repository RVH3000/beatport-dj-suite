import {
  DEFAULT_UNIFIED_SETTINGS,
  loadUnifiedSettings,
  saveUnifiedSettings,
} from "./unified-settings.js";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSettings() {
  const container = document.getElementById("settings-content");
  if (!container) return;
  const settings = loadUnifiedSettings();

  container.innerHTML = `
    <section class="panel span-full">
      <h2>Unified Settings</h2>
      <p class="detail-summary">
        Persistente Defaults für Discovery, Python-Tools und OSC-Bridge. Die Werte gelten
        für den Automation-Tab und werden lokal im Electron-Profil gespeichert.
      </p>
    </section>

    <section class="panel">
      <div class="field-grid">
        <label class="wide">
          Scan-Roots
          <textarea id="settingsScanRoots" rows="4">${esc(settings.scanRoots)}</textarea>
        </label>
        <label>
          Engine Database Folder
          <input id="settingsEngineDatabaseFolder" type="text" value="${esc(
            settings.engineDatabaseFolder
          )}" />
        </label>
        <label>
          Python Command
          <input id="settingsPythonCommand" type="text" value="${esc(
            settings.pythonCommand
          )}" />
        </label>
        <label>
          OSC Host
          <input id="settingsOscHost" type="text" value="${esc(settings.oscHost)}" />
        </label>
        <label>
          OSC Port
          <input id="settingsOscPort" type="number" min="1" max="65535" value="${esc(
            settings.oscPort
          )}" />
        </label>
        <label class="wide">
          OSC Address Prefix
          <input id="settingsOscAddressPrefix" type="text" value="${esc(
            settings.oscAddressPrefix
          )}" />
        </label>
      </div>
      <div class="actions">
        <button id="settingsSaveBtn" class="primary" type="button">Einstellungen speichern</button>
        <button id="settingsResetBtn" type="button">Defaults wiederherstellen</button>
      </div>
    </section>

    <section class="panel span-full">
      <h2>Start & Build</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Aktion</th><th>Befehl</th></tr></thead>
          <tbody>
            <tr><td>Dev starten</td><td><code>npm run desktop:dev</code></td></tr>
            <tr><td>Tests & Checks</td><td><code>npm test</code> / <code>npm run check</code></td></tr>
            <tr><td>macOS Build</td><td><code>npm run desktop:dir:mac</code></td></tr>
            <tr><td>Distribution</td><td><code>npm run desktop:dist:mac</code></td></tr>
          </tbody>
        </table>
      </div>
      <div class="callout info">
        Python-Teilmodule erwarten ein verfügbares <code>python3</code> im PATH.
        Die Engine-/Denon-Tools laufen read-only über SQLite.
      </div>
    </section>
  `;

  document.getElementById("settingsSaveBtn")?.addEventListener("click", () => {
    saveUnifiedSettings({
      scanRoots: document.getElementById("settingsScanRoots")?.value ?? "",
      engineDatabaseFolder:
        document.getElementById("settingsEngineDatabaseFolder")?.value ?? "",
      pythonCommand: document.getElementById("settingsPythonCommand")?.value ?? "python3",
      oscHost: document.getElementById("settingsOscHost")?.value ?? "127.0.0.1",
      oscPort: Number(document.getElementById("settingsOscPort")?.value ?? 9000),
      oscAddressPrefix:
        document.getElementById("settingsOscAddressPrefix")?.value ?? "/beatport-suite",
    });
    renderSettings();
  });

  document.getElementById("settingsResetBtn")?.addEventListener("click", () => {
    saveUnifiedSettings({ ...DEFAULT_UNIFIED_SETTINGS });
    renderSettings();
  });
}

export async function initSettingsTab() {
  renderSettings();
}
