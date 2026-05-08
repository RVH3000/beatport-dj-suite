import {
  DEFAULT_UNIFIED_SETTINGS,
  loadUnifiedSettings,
  saveUnifiedSettings,
} from "./unified-settings.js";

const FALLBACK_VERSION = "4.x";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function resolveAppVersion() {
  try {
    if (window.appApi?.getVersion) {
      const v = await window.appApi.getVersion();
      if (v) return v;
    }
  } catch { /* fallback below */ }
  return FALLBACK_VERSION;
}

function renderSettings(version) {
  const container = document.getElementById("settings-content");
  if (!container) return;
  const settings = loadUnifiedSettings();
  const versionLabel = esc(version);

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
        <label class="wide" title="Verzeichnisse die der Scanner nach Beatport-Browsern durchsucht. Eins pro Zeile.">
          Scan-Roots
          <textarea id="settingsScanRoots" rows="4">${esc(settings.scanRoots)}</textarea>
        </label>
        <label title="Pfad zur Engine DJ Library. Standard: ~/Music/Engine Library/Database2. Wird für Engine-Import und USB-Detection gebraucht.">
          Engine Database Folder
          <input id="settingsEngineDatabaseFolder" type="text" value="${esc(
            settings.engineDatabaseFolder
          )}" />
        </label>
        <label title="Pfad zum Python-Interpreter. Muss python3 mit sqlite3-Modul sein. Standard: python3 (aus PATH).">
          Python Command
          <input id="settingsPythonCommand" type="text" value="${esc(
            settings.pythonCommand
          )}" />
        </label>
        <label title="IP-Adresse des OSC-Empfängers (z.B. Ableton Live, TouchOSC). Standard: 127.0.0.1 (lokal).">
          OSC Host
          <input id="settingsOscHost" type="text" value="${esc(settings.oscHost)}" />
        </label>
        <label title="OSC-Port. Standard: 9000. Muss mit dem Empfänger-Port übereinstimmen.">
          OSC Port
          <input id="settingsOscPort" type="number" min="1" max="65535" value="${esc(
            settings.oscPort
          )}" />
        </label>
        <label class="wide" title="Präfix für alle OSC-Adressen (z.B. /beatport-suite/scan/progress). Standard: /beatport-suite.">
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
        <h2>📖 Handbuch — Beatport DJ Suite v${versionLabel}</h2>
      </div>

      <details class="cockpit-acc" open>
        <summary>✨ Was ist neu in v4.2</summary>
        <div class="acc-body manual-section">
          <p><strong>Modulare Architektur (M4 abgeschlossen):</strong> Die Suite ist auf 13 lokale npm-Pakete unter <code>@bpdjs/*</code> aufgeteilt — core, ipc-router, settings, file-manager, engine-db, playlist-manager, beatport-connection, mode-layer, ui-components, ui-shell, audio-analyzer, dev-tools, updater. Jedes Paket hat eigene Tests; aktuell 306+ Tests grün.</p>
          <p><strong>Beatport LINK → Engine Library Bridge (in Vorbereitung):</strong> Synthetische History-Einträge für LINK-Tracks, damit Playlisten in Engine DJ direkt funktionieren — ohne echte Wiedergabe, ohne Download. Schreib-Kanal über das parallele engine-dj-manager-Projekt.</p>
          <p><strong>Versions-Workflow:</strong> commit-and-tag-version + dynamische Versionsanzeige (diese Zeile liest <code>app.getVersion()</code> über <code>appApi</code>).</p>
          <p><strong>App-Installation:</strong> Builds tragen die Versionsnummer im Namen (z.B. <code>Beatport DJ Suite ${versionLabel}.app</code>) — alte Versionen bleiben parallel verfügbar für Rollbacks.</p>
        </div>
      </details>

      <details class="cockpit-acc">
        <summary>📚 Library — Scanner, Arbeitsbestand, Engine-Import</summary>
        <div class="acc-body manual-section">
          <h3>Scanner</h3>
          <p><strong>Delta-Sync</strong> — Neuer Scan-Run via CDP/XHR. Iteriert durch alle Beatport-Playlists und holt Track-Metadaten. Alte Runs werden nie überschrieben.</p>
          <p><strong>Cache neu aufbauen</strong> — Verwirft den lokalen Arbeitsbestand und baut ihn aus allen Runs neu auf.</p>
          <p><strong>Diagnose-Komplettlauf</strong> — Schnelltest: prüft Verbindung, Session und eine Test-Playlist.</p>
          <p><strong>Pause/Resume</strong> — Unterbricht den laufenden Scan sicher, setzt später an der letzten Position fort.</p>
          <p><strong>Status-Bar</strong> — Oben: Systemstatus + Session-Buttons (Beatport öffnen, Test, Reconnect, API-Kontext exportieren).</p>
          <h3>Duplikat-Tiefenanalyse</h3>
          <p>Erkennt Duplikate über Beatport-ID + Titel-/Artist-Heuristik. Vorschlags-Liste mit One-Click-Removal in Beatport-Playlisten.</p>
          <h3>Engine-Import</h3>
          <p>Non-destruktiver Import aus der lokalen Engine DJ Datenbank: <strong>Ratings (0-5 Sterne)</strong>, Play-Counts, Last-Played, File-Paths. Matching per Beatport-ID (primär) oder Titel+Artists. Backup + Audit-Log bei jedem Apply. USB Prime 4+ wird automatisch erkannt.</p>
        </div>
      </details>

      <details class="cockpit-acc">
        <summary>🔍 Explore — Suche, Filter, Dashboard, Analyse</summary>
        <div class="acc-body manual-section">
          <h3>Suche & Filter</h3>
          <p><strong>Wildcards:</strong> <code>*</code> = beliebig viele Zeichen, <code>?</code> = ein Zeichen. Beispiel: <code>Tech*House</code> findet "Tech House", "Techno House".</p>
          <p><strong>Genre-Chips:</strong> Multi-Select (Klick aktiviert/deaktiviert). Sub-Genre-Chips kaskadieren nach gewählten Genres.</p>
          <p><strong>BPM-Normalisierung:</strong> Halbiert/verdoppelt BPM für Genre-übergreifende Vergleiche (128 House = 64 Hip-Hop).</p>
          <p><strong>Lock-System:</strong> Klicke auf Spalten-Header in der Ergebnistabelle um mehrstufig zu sortieren. Zahl in Klammern = Priorität.</p>
          <p><strong>Drama-Score:</strong> 60% BPM-Abweichung + 40% Camelot-Inkompatibilität. Zeigt wie "dramatisch" ein Track im Kontext ist.</p>
          <p><strong>Performance-Score (neu in v4.2):</strong> Kombiniertes Ranking aus BPM-Fitness, Key-Fitness (Camelot/Key), Energy und Genre-Match — gewichtet (Defaults bpm:0.4 / key:0.2 / energy:0.25 / genre:0.15).</p>
          <p><strong>Empfehlungen:</strong> 🔮-Button pro Track holt ähnliche Tracks von Beatport-API. Wenn Groof.app läuft, auch von api.groof.music.</p>
          <h3>Dashboard</h3>
          <p>Genre-Bars, BPM-Cluster, Tonarten-Verteilung, Timeline. Klick auf Genre-Bar springt in die Suche.</p>
          <h3>Engine-Analyse</h3>
          <p>Read-only Auswertung der Engine DJ Datenbank: History, Duplikate, Track-Paare, Label-Kombos, Abspielstatistiken. Arbeitet auf einer Sandbox-Kopie.</p>
        </div>
      </details>

      <details class="cockpit-acc">
        <summary>🛠 Build — Playlist WIZ + Builder</summary>
        <div class="acc-body manual-section">
          <h3>Playlist WIZ (Live Beatport CRUD)</h3>
          <p>Live-Management von Beatport-Playlists via XHR-API: Erstellen, Umbenennen, Löschen, Tracks hinzufügen/entfernen. Nutzt den Bearer-Token aus der internen Session.</p>
          <h3>Playlist Builder (Camelot-Check)</h3>
          <p>Stellt Sets aus dem Arbeitsbestand zusammen, prüft Camelot-Wheel-Kompatibilität zwischen aufeinanderfolgenden Tracks und warnt bei harten Wechseln.</p>
        </div>
      </details>

      <details class="cockpit-acc">
        <summary>🚀 Pipeline — Sync, Export, Automation, Bridge</summary>
        <div class="acc-body manual-section">
          <h3>Sync-Pipeline</h3>
          <p>Beatport → DJPlaylists.fm → Lexicon DJ → Engine DJ → USB/Prime 4+</p>
          <p><strong>WICHTIG:</strong> Der Weg über DJPlaylists.fm → Lexicon ist der einzige funktionierende Pfad der alle Metadaten korrekt überträgt.</p>
          <p><strong>DJPL.fm Diff-Import:</strong> Vergleicht Beatport ↔ DJPL.fm, importiert fehlende einzeln mit Fortschrittsanzeige.</p>
          <p><strong>Batch → Lexicon:</strong> Alle DJPL.fm-Playlists sequenziell in Lexicon speichern (konfigurierbare Pause).</p>
          <h3>Export-Formate</h3>
          <p>Rekordbox XML, Traktor NML, JSON, JSONL, M3U, Engine m.db (Streaming-Tracks direkt).</p>
          <h3>OSC-Bridge / Automation</h3>
          <p>OSC-Bridge für Fernsteuerung (Ableton, TouchOSC, OBS) — Host/Port/Prefix konfigurierbar oben in den Settings. Python-Tools für externe Scripts.</p>
          <h3>Beatport LINK Bridge (v4.2-Beta)</h3>
          <p>Synthetische History-Einträge für LINK-Tracks, damit Playlisten in Engine DJ ohne manuelles Antippen funktionieren. Schreib-Kanal: <code>engine-dj-manager</code> (Next.js, localhost:3000).</p>
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
  └ History  ◀── LINK-Bridge (v4.2)

Pipeline: Beatport → DJPL.fm → Lexicon → Engine DJ → USB/Prime 4+
                                  └──▶ Rekordbox / Traktor (via Export)</pre>
        </div>
      </details>

      <details class="cockpit-acc">
        <summary>🧩 Architektur — @bpdjs/* Pakete</summary>
        <div class="acc-body manual-section">
          <p>Seit v4.2 ist die Suite in 13 lokale Pakete unter <code>packages/</code> aufgeteilt:</p>
          <ul>
            <li><code>@bpdjs/core</code> — Logger, Config, Helpers</li>
            <li><code>@bpdjs/ipc-router</code> — IPC-Channel-Wrapper für Main/Renderer</li>
            <li><code>@bpdjs/settings</code> — Persistente App-Settings</li>
            <li><code>@bpdjs/file-manager</code> — File-IO mit Backup-Logik</li>
            <li><code>@bpdjs/engine-db</code> — Read-Only-Zugriff auf Engine DJ SQLite</li>
            <li><code>@bpdjs/playlist-manager</code> — Playlist-CRUD-Logik</li>
            <li><code>@bpdjs/beatport-connection</code> — Beatport-Auth + XHR-Client</li>
            <li><code>@bpdjs/mode-layer</code> — Tabs, Routing, Mode-Filter (default/developer)</li>
            <li><code>@bpdjs/ui-components</code> — wiederverwendbare UI-Bausteine</li>
            <li><code>@bpdjs/ui-shell</code> — Boot-Sequence + Layout</li>
            <li><code>@bpdjs/audio-analyzer</code> — Performance-Score, Track-Analyse</li>
            <li><code>@bpdjs/dev-tools</code> — SmokeRunner + DiagnosticsCollector</li>
            <li><code>@bpdjs/updater</code> — Versionsvergleich + Release-Channels</li>
          </ul>
          <p class="detail-summary">M5 (Migration von <code>electron-app/main.mjs</code> auf die neuen Pakete) ist der nächste Schritt.</p>
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
            <tr><td>Tests (gesamt)</td><td><code>npm test</code></td></tr>
            <tr><td>Tests (nur Pakete)</td><td><code>npm run test:packages</code></td></tr>
            <tr><td>Coverage</td><td><code>npm run test:coverage</code></td></tr>
            <tr><td>macOS DIR-Build</td><td><code>npm run desktop:dir:mac</code></td></tr>
            <tr><td>macOS Distribution</td><td><code>npm run desktop:dist:mac</code></td></tr>
            <tr><td>Release patch</td><td><code>npm run release:patch</code></td></tr>
          </tbody>
        </table>
      </div>
      <div class="callout info">
        Python-Teilmodule erwarten ein verfügbares <code>python3</code> im PATH.
        Die Engine-/Denon-Tools laufen read-only über SQLite (Sandbox-First-Protokoll).
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
    renderSettings(version);
  });

  document.getElementById("settingsResetBtn")?.addEventListener("click", () => {
    saveUnifiedSettings({ ...DEFAULT_UNIFIED_SETTINGS });
    renderSettings(version);
  });
}

export async function initSettingsTab() {
  const version = await resolveAppVersion();
  renderSettings(version);
}
