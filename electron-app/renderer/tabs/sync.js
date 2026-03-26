/**
 * Sync-Tab — Pipeline: Beatport → DJPlaylists.fm → Lexicon → Engine DJ → USB/Prime 4+
 *
 * Dieses Modul rendert den Sync-Tab und steuert die vollständige Sync-Pipeline.
 * Kommuniziert über window.syncApi (IPC via preload.mjs) mit dem Main-Prozess.
 */

// ─── State ───────────────────────────────────────────────────────────────────

const syncState = {
  lexiconStatus: null,      // { connected, endpoint, version }
  djplStatus: null,         // { reachable, authenticated, username }
  presets: null,            // { playlists: [...], config: {...} }
  pipelineRunning: false,
  pipelineLog: [],
  apiKey: "",
  sessionCookie: "",
};

// ─── Haupteinstieg ───────────────────────────────────────────────────────────

let syncInitialized = false;

export async function initSyncTab() {
  if (syncInitialized) {
    await refreshStatuses();
    return;
  }
  syncInitialized = true;

  const container = document.getElementById("sync-content");
  if (!container) return;

  container.innerHTML = buildSyncTabHtml();
  bindEvents();
  await loadPresets();
  await refreshStatuses();
}

// ─── HTML-Gerüst ─────────────────────────────────────────────────────────────

function buildSyncTabHtml() {
  return `
    <!-- Pipeline-Visualisierung -->
    <section class="panel span-full pipeline-section">
      <h2>Sync-Pipeline</h2>
      <div class="pipeline-flow">
        <div class="pipeline-node" id="pnode-beatport">
          <div class="pipeline-icon">🎵</div>
          <div class="pipeline-label">Beatport</div>
          <div class="pipeline-sub">Streaming Playlists</div>
          <div class="pipeline-badge idle" id="badge-beatport">–</div>
        </div>
        <div class="pipeline-arrow" id="parrow-1">→</div>
        <div class="pipeline-node" id="pnode-djpl">
          <div class="pipeline-icon">🌐</div>
          <div class="pipeline-label">DJPlaylists.fm</div>
          <div class="pipeline-sub">Brücke & Konvertierung</div>
          <div class="pipeline-badge idle" id="badge-djpl">Prüfen…</div>
        </div>
        <div class="pipeline-arrow" id="parrow-2">→</div>
        <div class="pipeline-node" id="pnode-lexicon">
          <div class="pipeline-icon">📚</div>
          <div class="pipeline-label">Lexicon DJ</div>
          <div class="pipeline-sub">Library-Management</div>
          <div class="pipeline-badge idle" id="badge-lexicon">Prüfen…</div>
        </div>
        <div class="pipeline-arrow" id="parrow-3">→</div>
        <div class="pipeline-node" id="pnode-engine">
          <div class="pipeline-icon">💿</div>
          <div class="pipeline-label">Engine DJ</div>
          <div class="pipeline-sub">Lokale Library</div>
          <div class="pipeline-badge idle" id="badge-engine">–</div>
        </div>
        <div class="pipeline-arrow" id="parrow-4">→</div>
        <div class="pipeline-node" id="pnode-usb">
          <div class="pipeline-icon">🖲</div>
          <div class="pipeline-label">USB / Prime 4+</div>
          <div class="pipeline-sub">Denon Hardware</div>
          <div class="pipeline-badge idle" id="badge-usb">Manuell</div>
        </div>
      </div>
    </section>

    <!-- Verbindungsstatus -->
    <section class="panel">
      <div class="section-head">
        <h2>Verbindungsstatus</h2>
        <div class="actions compact">
          <button id="syncRefreshStatusBtn" type="button">Status aktualisieren</button>
        </div>
      </div>
      <div id="sync-connection-details" class="meta-list-wrap">
        <p class="detail-summary">Verbindungen werden geprüft…</p>
      </div>
    </section>

    <!-- DJPlaylists.fm Authentifizierung -->
    <section class="panel">
      <h2>DJPlaylists.fm Konfiguration</h2>
      <p class="callout info" style="margin-bottom:0.75rem">
        DJPlaylists.fm ist die Brücke, die Beatport Streaming Playlists in Lexicon-kompatible Playlists konvertiert.
        Trage hier deinen API-Key ein (Account → API Key auf djplaylists.fm).
      </p>
      <div class="field-grid">
        <label class="wide">
          API-Key (djplaylists.fm)
          <input id="syncDjplApiKey" type="password" placeholder="dein-api-key-hier" autocomplete="off" />
        </label>
        <label class="wide">
          Session-Cookie (optional, falls kein API-Key)
          <input id="syncDjplSessionCookie" type="password" placeholder="_session=..." autocomplete="off" />
        </label>
      </div>
      <div class="actions compact">
        <button id="syncSaveAuthBtn" type="button">Speichern &amp; testen</button>
        <button id="syncExploreApiBtn" type="button">API erkunden</button>
      </div>
      <div id="syncAuthResult" class="detail-summary empty"></div>
    </section>

    <!-- Beatport URL Import -->
    <section class="panel">
      <div class="section-head">
        <h2>Beatport Playlists importieren</h2>
        <div class="actions compact">
          <button id="syncImportBtn" class="primary" type="button">Importieren &amp; Sync starten</button>
        </div>
      </div>
      <p class="callout info" style="margin-bottom:0.75rem">
        Füge eine oder mehrere Beatport Streaming Playlist-URLs ein.
        Format: <code>https://www.beatport.com/playlists/…</code> oder
        <code>https://streaming.beatport.com/playlists/…</code>
      </p>
      <div class="field-grid">
        <label class="wide">
          Beatport Playlist-URL(s) — eine pro Zeile
          <textarea id="syncBeatportUrls" rows="4" placeholder="https://www.beatport.com/playlists/my-playlist/123456&#10;https://streaming.beatport.com/playlists/456789" style="font-family:monospace;font-size:0.8rem"></textarea>
        </label>
        <label>
          Zielordner in Lexicon
          <input id="syncTargetFolder" type="text" value="Beatport Sync" />
        </label>
        <label class="check">
          <input id="syncAutoEngineExport" type="checkbox" checked />
          Nach Lexicon-Import automatisch Engine DJ exportieren
        </label>
      </div>
    </section>

    <!-- Presets (gespeicherte Playlists) -->
    <section class="panel">
      <div class="section-head">
        <h2>Gespeicherte Playlist-Presets</h2>
        <div class="actions compact">
          <button id="syncSavePresetBtn" type="button">Aktuelle URLs als Preset speichern</button>
          <button id="syncRunPresetBtn" type="button">Preset ausführen</button>
        </div>
      </div>
      <div id="syncPresetList" class="table-wrap empty">Keine Presets gespeichert.</div>
    </section>

    <!-- Pipeline-Log -->
    <section class="panel span-full">
      <div class="section-head">
        <h2>Pipeline-Log</h2>
        <div class="actions compact">
          <button id="syncClearLogBtn" type="button">Log leeren</button>
        </div>
      </div>
      <div id="syncLogWrap" class="sync-log" aria-live="polite">
        <p class="log-entry info">Bereit. Beatport-URLs eingeben und „Importieren &amp; Sync starten" klicken.</p>
      </div>
    </section>

    <!-- Engine DJ Export -->
    <section class="panel">
      <div class="section-head">
        <h2>Engine DJ Export</h2>
        <div class="actions compact">
          <button id="syncEngineExportBtn" type="button">Jetzt zu Engine DJ exportieren</button>
        </div>
      </div>
      <p class="callout info" style="margin-bottom:0.75rem">
        Exportiert alle synchronisierten Playlists aus Lexicon in die Engine DJ Library auf dem Mac.
        Danach USB-Sync in Engine DJ oder Denon Engine OS selbst starten.
      </p>
      <div class="field-grid">
        <label class="check">
          <input id="syncExportAll" type="checkbox" checked />
          Alle Playlists exportieren (nicht nur neue)
        </label>
      </div>
      <div id="syncEngineResult" class="detail-summary empty"></div>
    </section>
  `;
}

// ─── Event-Binding ────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById("syncRefreshStatusBtn")?.addEventListener("click", refreshStatuses);
  document.getElementById("syncImportBtn")?.addEventListener("click", runImportPipeline);
  document.getElementById("syncSaveAuthBtn")?.addEventListener("click", saveAndTestAuth);
  document.getElementById("syncExploreApiBtn")?.addEventListener("click", exploreApis);
  document.getElementById("syncClearLogBtn")?.addEventListener("click", clearLog);
  document.getElementById("syncEngineExportBtn")?.addEventListener("click", runEngineExport);
  document.getElementById("syncSavePresetBtn")?.addEventListener("click", saveCurrentAsPreset);
  document.getElementById("syncRunPresetBtn")?.addEventListener("click", runPreset);
}

// ─── Status-Refresh ───────────────────────────────────────────────────────────

async function refreshStatuses() {
  const details = document.getElementById("sync-connection-details");
  if (details) details.innerHTML = '<p class="detail-summary">Prüfe Verbindungen…</p>';

  setPipelineBadge("lexicon", "idle", "Prüfen…");
  setPipelineBadge("djpl", "idle", "Prüfen…");

  const [lexResult, djplResult, sampleResult] = await Promise.allSettled([
    window.syncApi.checkLexicon(),
    window.syncApi.checkDjplaylists(),
    window.syncApi.getLexiconTracksSample(5),
  ]);

  syncState.lexiconStatus = lexResult.status === "fulfilled"
    ? lexResult.value
    : { connected: false, error: String(lexResult.reason) };

  syncState.djplStatus = djplResult.status === "fulfilled"
    ? djplResult.value
    : { reachable: false, error: String(djplResult.reason) };

  syncState.lexiconSample = sampleResult.status === "fulfilled" ? sampleResult.value : null;

  renderConnectionDetails();
}

function renderConnectionDetails() {
  const { lexiconStatus: lex, djplStatus: djpl, lexiconSample: sample } = syncState;
  const details = document.getElementById("sync-connection-details");
  if (!details) return;

  const lexOk = lex?.connected;
  const djplOk = djpl?.reachable;
  const djplAuth = djpl?.authenticated;

  // Pipeline-Badges aktualisieren
  if (lexOk) {
    const plCount = lex.playlistCount != null ? ` — ${lex.playlistCount} Playlists` : "";
    const tracks = sample?.total != null ? `, ${sample.total.toLocaleString("de-DE")} Tracks` : "";
    setPipelineBadge("lexicon", "ok", `✓ Port 48624${plCount}${tracks}`);
  } else {
    setPipelineBadge("lexicon", "error", "Offline");
  }

  setPipelineBadge("djpl",
    djplOk ? (djplAuth ? "ok" : "warn") : "error",
    djplOk ? (djplAuth ? "Eingeloggt" : "Kein Auth") : "Offline"
  );

  // Beispiel-Tracks aus Lexicon anzeigen
  let sampleHtml = "";
  if (sample?.tracks?.length > 0) {
    sampleHtml = `
      <dt>Lexicon Library (Vorschau)</dt>
      <dd>
        <ul class="track-sample-list">
          ${sample.tracks.slice(0, 5).map((t) =>
            `<li>${esc(t.title)} — ${esc(t.artist)}${t.bpm ? ` <span class="status-info">${t.bpm} BPM</span>` : ""}${t.key ? ` <span class="status-info">${t.key}</span>` : ""}</li>`
          ).join("")}
        </ul>
        ${sample.total > 5 ? `<span class="status-info">… und ${(sample.total - 5).toLocaleString("de-DE")} weitere</span>` : ""}
      </dd>
    `;
  }

  details.innerHTML = `
    <dl class="meta-list">
      <dt>Lexicon DJ (Port 48624)</dt>
      <dd class="${lexOk ? "status-ok" : "status-err"}">
        ${lexOk
          ? `✓ Verbunden via /v1/playlists${lex.playlistCount != null ? ` — ${lex.playlistCount} Playlists` : ""}${sample?.total != null ? `, ${sample.total.toLocaleString("de-DE")} Tracks` : ""}`
          : `✗ ${lex?.error ?? "Nicht erreichbar — Lexicon starten?"}`}
      </dd>
      ${sampleHtml}
      <dt>DJPlaylists.fm</dt>
      <dd class="${djplOk ? "status-ok" : "status-err"}">
        ${djplOk
          ? `✓ Erreichbar — ${djplAuth ? `Eingeloggt${djpl.username ? ` als ${djpl.username}` : ""}` : "Nicht authentifiziert (API-Key unter Konfiguration eingeben)"}`
          : `✗ ${djpl?.error ?? "Nicht erreichbar"}`}
      </dd>
      <dt>Engine DJ</dt>
      <dd class="status-info">Wird über Lexicon /v1/sync-Endpoints angesteuert</dd>
      <dt>USB / Denon Prime 4+</dt>
      <dd class="status-info">Nach Engine-DJ-Export: USB einstecken → in Engine OS synchronisieren</dd>
    </dl>
  `;
}

// ─── Auth speichern & testen ─────────────────────────────────────────────────

async function saveAndTestAuth() {
  const apiKey = document.getElementById("syncDjplApiKey")?.value.trim() ?? "";
  const sessionCookie = document.getElementById("syncDjplSessionCookie")?.value.trim() ?? "";
  const resultEl = document.getElementById("syncAuthResult");

  syncState.apiKey = apiKey;
  syncState.sessionCookie = sessionCookie;

  if (resultEl) resultEl.innerHTML = '<span class="status-info">Speichern und testen…</span>';

  try {
    const result = await window.syncApi.saveAuth({ apiKey, sessionCookie });
    if (resultEl) {
      resultEl.innerHTML = result.ok
        ? '<span class="status-ok">✓ Gespeichert. DJPlaylists.fm-Verbindung wird geprüft…</span>'
        : `<span class="status-err">✗ ${result.error ?? "Fehler beim Speichern"}</span>`;
    }
    await refreshStatuses();
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<span class="status-err">✗ ${err.message}</span>`;
  }
}

// ─── API-Explorer ─────────────────────────────────────────────────────────────

async function exploreApis() {
  addLog("info", "Erkunde Lexicon- und DJPlaylists.fm-APIs…");
  try {
    const result = await window.syncApi.exploreApis();

    const lexOk = Object.entries(result.lexicon ?? {}).filter(([, v]) => v.ok).map(([k]) => k);
    const djplOk = Object.entries(result.djplaylists ?? {}).filter(([, v]) => v.ok).map(([k]) => k);

    addLog("info", `Lexicon: ${lexOk.length} erreichbare Endpunkte → ${lexOk.join(", ") || "keine"}`);
    addLog("info", `DJPlaylists.fm: ${djplOk.length} erreichbare Endpunkte → ${djplOk.join(", ") || "keine"}`);

    if (lexOk.length === 0) {
      addLog("warn", "Lexicon-API: Keine Endpunkte gefunden. Ist Lexicon gestartet?");
    }
    if (djplOk.length === 0) {
      addLog("warn", "DJPlaylists.fm: Keine API-Endpunkte gefunden. API-Key fehlt möglicherweise.");
    }
  } catch (err) {
    addLog("error", `API-Explorer: ${err.message}`);
  }
}

// ─── Import-Pipeline ─────────────────────────────────────────────────────────

async function runImportPipeline() {
  if (syncState.pipelineRunning) {
    addLog("warn", "Pipeline läuft bereits.");
    return;
  }

  const rawUrls = document.getElementById("syncBeatportUrls")?.value ?? "";
  const urls = rawUrls.split("\n").map((u) => u.trim()).filter(Boolean);

  if (urls.length === 0) {
    addLog("error", "Keine Beatport-URLs eingegeben.");
    return;
  }

  const targetFolder = document.getElementById("syncTargetFolder")?.value.trim() || "Beatport Sync";
  const autoEngineExport = document.getElementById("syncAutoEngineExport")?.checked ?? true;

  syncState.pipelineRunning = true;
  setPipelineRunning(true);

  addLog("info", `━━━ Pipeline Start: ${urls.length} Playlist(s) ━━━`);
  addLog("info", `Zielordner in Lexicon: „${targetFolder}"`);

  const importedIds = [];

  for (const url of urls) {
    addLog("step", `[1/3] Beatport → DJPlaylists.fm: ${url}`);
    setPipelineNodeActive("djpl");

    try {
      const djplResult = await window.syncApi.importToDjplaylists({ beatportUrl: url, targetFolder });

      if (!djplResult.ok) {
        addLog("error", `DJPlaylists.fm Import fehlgeschlagen: ${djplResult.error}`);
        continue;
      }

      const plName = djplResult.name ?? djplResult.playlistId ?? url;
      addLog("ok", `✓ DJPlaylists.fm: „${plName}" importiert (ID: ${djplResult.playlistId ?? "?"})`);
      setPipelineNodeDone("djpl");

      // Schritt 2: Lexicon Import
      addLog("step", `[2/3] DJPlaylists.fm → Lexicon: „${plName}"`);
      setPipelineNodeActive("lexicon");

      const lexResult = await window.syncApi.importToLexicon({
        djplaylistsId: djplResult.playlistId,
        djplaylistsUrl: djplResult.playlistUrl,
        targetFolder,
      });

      if (!lexResult.ok) {
        addLog("warn", `Lexicon Import: ${lexResult.error ?? "Fehlgeschlagen"}`);
        addLog("info", "Tipp: Manuell in Lexicon → Integrations → DJPlaylists.fm importieren.");
      } else {
        addLog("ok", `✓ Lexicon: Playlist importiert${lexResult.trackCount ? ` (${lexResult.trackCount} Tracks)` : ""}`);
        setPipelineNodeDone("lexicon");
        if (lexResult.playlistId) importedIds.push(lexResult.playlistId);
      }
    } catch (err) {
      addLog("error", `Pipeline-Fehler bei ${url}: ${err.message}`);
      setPipelineNodeError("djpl");
    }
  }

  // Schritt 3: Engine DJ Export (optional)
  if (autoEngineExport && importedIds.length > 0) {
    await _runEngineExport(importedIds);
  } else if (autoEngineExport && importedIds.length === 0) {
    addLog("warn", "Engine-DJ-Export übersprungen: Kein Lexicon-Import erfolgreich.");
  }

  addLog("info", "━━━ Pipeline abgeschlossen ━━━");
  syncState.pipelineRunning = false;
  setPipelineRunning(false);
}

// ─── Engine DJ Export ─────────────────────────────────────────────────────────

async function runEngineExport() {
  if (syncState.pipelineRunning) return;
  const exportAll = document.getElementById("syncExportAll")?.checked ?? true;
  syncState.pipelineRunning = true;
  setPipelineRunning(true);
  await _runEngineExport([], exportAll);
  syncState.pipelineRunning = false;
  setPipelineRunning(false);
}

async function _runEngineExport(playlistIds = [], exportAll = false) {
  const resultEl = document.getElementById("syncEngineResult");
  addLog("step", `[3/3] Lexicon → Engine DJ${exportAll ? " (alle Playlists)" : ` (${playlistIds.length} Playlists)`}`);
  setPipelineNodeActive("engine");

  if (resultEl) resultEl.innerHTML = '<span class="status-info">Engine DJ Export läuft…</span>';

  try {
    const result = await window.syncApi.triggerEngineExport({ playlistIds, exportAll });

    if (result.ok) {
      addLog("ok", `✓ Engine DJ Export abgeschlossen${result.exportedCount != null ? ` (${result.exportedCount} Tracks)` : ""}`);
      setPipelineNodeDone("engine");
      setPipelineBadge("usb", "ok", "Bereit");
      if (resultEl) resultEl.innerHTML = '<span class="status-ok">✓ Export abgeschlossen. USB einstecken → in Engine DJ oder Denon Prime 4+ synchronisieren.</span>';
    } else {
      addLog("warn", `Engine DJ Export: ${result.error ?? result.note ?? "Kein Endpunkt gefunden"}`);
      addLog("info", "Tipp: Manuell in Lexicon → Sync → Engine DJ exportieren.");
      setPipelineNodeError("engine");
      if (resultEl) resultEl.innerHTML = `<span class="status-warn">⚠ ${result.error ?? "Manueller Export in Lexicon erforderlich."}</span>`;
    }
  } catch (err) {
    addLog("error", `Engine DJ Export-Fehler: ${err.message}`);
    addLog("info", "Tipp: Manuell in Lexicon → Sync → Engine DJ exportieren.");
    setPipelineNodeError("engine");
    if (resultEl) resultEl.innerHTML = `<span class="status-err">✗ ${err.message}</span>`;
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────────

async function loadPresets() {
  try {
    syncState.presets = await window.syncApi.getPresets();
  } catch {
    syncState.presets = { playlists: [], config: {} };
  }
  renderPresets();
}

function renderPresets() {
  const wrap = document.getElementById("syncPresetList");
  if (!wrap) return;

  const presets = syncState.presets?.playlists ?? [];
  if (presets.length === 0) {
    wrap.className = "table-wrap empty";
    wrap.textContent = "Keine Presets gespeichert.";
    return;
  }

  wrap.className = "table-wrap";
  wrap.innerHTML = `
    <table>
      <thead>
        <tr><th>Name</th><th>Beatport-URL</th><th>Zielordner</th><th>Zuletzt gesynced</th><th></th></tr>
      </thead>
      <tbody>
        ${presets.map((p, i) => `
          <tr>
            <td>${esc(p.name ?? "Unbenannt")}</td>
            <td style="font-size:0.75rem;word-break:break-all">${esc(p.beatportUrl ?? "–")}</td>
            <td>${esc(p.targetFolder ?? "Beatport Sync")}</td>
            <td>${p.lastSyncedAt ? new Date(p.lastSyncedAt).toLocaleString("de-DE") : "–"}</td>
            <td><button class="btn-sm" data-preset-index="${i}" data-action="delete-preset">✕</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-action='delete-preset']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.presetIndex);
      syncState.presets.playlists.splice(idx, 1);
      await window.syncApi.savePresets(syncState.presets);
      renderPresets();
    });
  });
}

async function saveCurrentAsPreset() {
  const rawUrls = document.getElementById("syncBeatportUrls")?.value ?? "";
  const urls = rawUrls.split("\n").map((u) => u.trim()).filter(Boolean);
  const targetFolder = document.getElementById("syncTargetFolder")?.value.trim() || "Beatport Sync";

  if (urls.length === 0) {
    addLog("warn", "Keine URLs zum Speichern eingegeben.");
    return;
  }

  const name = prompt("Preset-Name:", urls[0].split("/").pop() || "Mein Preset");
  if (!name) return;

  if (!syncState.presets) syncState.presets = { playlists: [], config: {} };
  syncState.presets.playlists.push({
    name,
    beatportUrl: urls.join("\n"),
    targetFolder,
    lastSyncedAt: null,
  });

  try {
    await window.syncApi.savePresets(syncState.presets);
    addLog("ok", `✓ Preset „${name}" gespeichert.`);
    renderPresets();
  } catch (err) {
    addLog("error", `Preset speichern fehlgeschlagen: ${err.message}`);
  }
}

async function runPreset() {
  if (!syncState.presets?.playlists?.length) {
    addLog("warn", "Keine Presets vorhanden.");
    return;
  }

  // Alle Preset-URLs in das Textfeld laden
  const allUrls = syncState.presets.playlists
    .flatMap((p) => (p.beatportUrl ?? "").split("\n"))
    .filter(Boolean);

  const urlField = document.getElementById("syncBeatportUrls");
  if (urlField) urlField.value = allUrls.join("\n");

  addLog("info", `${allUrls.length} URLs aus Presets geladen.`);
  await runImportPipeline();

  // lastSyncedAt aktualisieren
  const now = new Date().toISOString();
  syncState.presets.playlists.forEach((p) => (p.lastSyncedAt = now));
  await window.syncApi.savePresets(syncState.presets).catch(() => {});
  renderPresets();
}

// ─── Log-Funktionen ───────────────────────────────────────────────────────────

function addLog(type, message) {
  const wrap = document.getElementById("syncLogWrap");
  if (!wrap) return;

  const entry = document.createElement("p");
  entry.className = `log-entry ${type}`;
  const ts = new Date().toLocaleTimeString("de-DE");
  entry.textContent = `[${ts}] ${message}`;
  wrap.appendChild(entry);
  wrap.scrollTop = wrap.scrollHeight;

  syncState.pipelineLog.push({ ts, type, message });
}

function clearLog() {
  const wrap = document.getElementById("syncLogWrap");
  if (wrap) wrap.innerHTML = "";
  syncState.pipelineLog = [];
}

// ─── Pipeline-Visualisierung ──────────────────────────────────────────────────

function setPipelineBadge(nodeId, state, text) {
  const badge = document.getElementById(`badge-${nodeId}`);
  if (!badge) return;
  badge.className = `pipeline-badge ${state}`;
  badge.textContent = text;
}

function setPipelineNodeActive(nodeId) {
  const node = document.getElementById(`pnode-${nodeId}`);
  if (node) node.classList.add("pipeline-node--active");
  setPipelineBadge(nodeId, "running", "Läuft…");
}

function setPipelineNodeDone(nodeId) {
  const node = document.getElementById(`pnode-${nodeId}`);
  if (node) {
    node.classList.remove("pipeline-node--active");
    node.classList.add("pipeline-node--done");
  }
  setPipelineBadge(nodeId, "ok", "✓ OK");
}

function setPipelineNodeError(nodeId) {
  const node = document.getElementById(`pnode-${nodeId}`);
  if (node) {
    node.classList.remove("pipeline-node--active");
    node.classList.add("pipeline-node--error");
  }
  setPipelineBadge(nodeId, "error", "Fehler");
}

function setPipelineRunning(running) {
  const btn = document.getElementById("syncImportBtn");
  if (btn) {
    btn.disabled = running;
    btn.textContent = running ? "Pipeline läuft…" : "Importieren & Sync starten";
  }
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
