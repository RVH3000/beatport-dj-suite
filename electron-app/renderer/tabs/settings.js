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
      <div class="section-head">
        <h2>📖 Handbuch — Beatport DJ Suite v3.6.0</h2>
      </div>
      <details class="cockpit-acc" open>
        <summary>📚 Library — Scanner, Arbeitsbestand, Engine-Import</summary>
        <div class="acc-body manual-section">
          <h3>Scanner</h3>
          <p><strong>Delta-Sync</strong> — Neuer Scan-Run via CDP/XHR. Iteriert durch alle Beatport-Playlists und holt Track-Metadaten. Alte Runs werden nie ueberschrieben.</p>
          <p><strong>Cache neu aufbauen</strong> — Verwirft den lokalen Arbeitsbestand und baut ihn aus allen Runs neu auf.</p>
          <p><strong>Diagnose-Komplettlauf</strong> — Schnelltest: prueft Verbindung, Session und eine Test-Playlist.</p>
          <p><strong>Pause/Resume</strong> — Unterbricht den laufenden Scan sicher, setzt spaeter an der letzten Position fort.</p>
          <p><strong>Status-Bar</strong> — Oben: Systemstatus + Session-Buttons (Beatport oeffnen, Test, Reconnect, API-Kontext exportieren).</p>
          <h3>Engine-Import</h3>
          <p>Non-destruktiver Import aus der lokalen Engine DJ Datenbank: <strong>Ratings (0-5 Sterne)</strong>, Play-Counts, Last-Played, File-Paths. Matching per Beatport-ID (primaer) oder Titel+Artists. Backup + Audit-Log bei jedem Apply. USB Prime 4+ wird automatisch erkannt.</p>
        </div>
      </details>
      <details class="cockpit-acc">
        <summary>🔍 Explore — Suche, Filter, Dashboard, Analyse</summary>
        <div class="acc-body manual-section">
          <h3>Suche & Filter</h3>
          <p><strong>Wildcards:</strong> <code>*</code> = beliebig viele Zeichen, <code>?</code> = ein Zeichen. Beispiel: <code>Tech*House</code> findet "Tech House", "Techno House".</p>
          <p><strong>Genre-Chips:</strong> Multi-Select (Klick aktiviert/deaktiviert). Sub-Genre-Chips kaskadieren nach gewaehlten Genres.</p>
          <p><strong>BPM-Normalisierung:</strong> Halbiert/verdoppelt BPM fuer Genre-uebergreifende Vergleiche (128 House = 64 Hip-Hop).</p>
          <p><strong>Lock-System:</strong> Klicke auf Spalten-Header in der Ergebnistabelle um mehrstufig zu sortieren. Zahl in Klammern = Prioritaet.</p>
          <p><strong>Drama-Score:</strong> 60% BPM-Abweichung + 40% Camelot-Inkompatibilitaet. Zeigt wie "dramatisch" ein Track im Kontext ist.</p>
          <p><strong>Empfehlungen:</strong> 🔮-Button pro Track holt aehnliche Tracks von Beatport-API. Wenn Groof.app laeuft, auch von api.groof.music.</p>
          <h3>Dashboard</h3>
          <p>Genre-Bars, BPM-Cluster, Tonarten-Verteilung, Timeline. Klick auf Genre-Bar springt in die Suche.</p>
        </div>
      </details>
      <details class="cockpit-acc">
        <summary>🛠 Build — Playlist WIZ</summary>
        <div class="acc-body manual-section">
          <p>Live-Management von Beatport-Playlists via XHR-API: Erstellen, Umbenennen, Loeschen, Tracks hinzufuegen/entfernen. Nutzt den Bearer-Token aus der internen Session.</p>
        </div>
      </details>
      <details class="cockpit-acc">
        <summary>🚀 Pipeline — Sync, Export, Automation</summary>
        <div class="acc-body manual-section">
          <h3>Sync-Pipeline</h3>
          <p>Beatport → DJPlaylists.fm → Lexicon DJ → Engine DJ → USB/Prime 4+</p>
          <p><strong>WICHTIG:</strong> Der Weg ueber DJPlaylists.fm → Lexicon ist der einzige funktionierende Pfad der alle Metadaten korrekt uebertraegt.</p>
          <p><strong>DJPL.fm Diff-Import:</strong> Vergleicht Beatport ↔ DJPL.fm, importiert fehlende einzeln mit Fortschrittsanzeige.</p>
          <p><strong>Batch → Lexicon:</strong> Alle DJPL.fm-Playlists sequenziell in Lexicon speichern (konfigurierbare Pause).</p>
          <h3>Export</h3>
          <p>Rekordbox XML, Traktor NML, JSON, JSONL, M3U, Engine m.db (Streaming-Tracks direkt).</p>
          <h3>Automation</h3>
          <p>OSC-Bridge (Fernsteuerung), Python-Tools (externe Scripts).</p>
        </div>
      </details>
      <details class="cockpit-acc">
        <summary>📊 Datenfluss-Diagramm</summary>
        <div class="acc-body manual-section">
          <pre style="font-size:11px;line-height:1.5;color:var(--text-secondary)">
Beatport (CDP/XHR) ──▶ scoring-data.json (99k Tracks) ──▶ Suche/Filter/Analyse
                                │
        ┌───────────────────────┼─────────────────────┐
        ▼                       ▼                     ▼
  Engine DB (m.db)      Merge/Import            Beatport Labels DB
  ├ Ratings             (396 Sterne,            (suite.db, 511 Labels)
  ├ Play-Counts          2577 Plays)
  └ History

Pipeline: Beatport → DJPL.fm → Lexicon → Engine DJ → USB/Prime 4+
                                  └──▶ Rekordbox / Traktor (via Export)</pre>
        </div>
      </details>
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
