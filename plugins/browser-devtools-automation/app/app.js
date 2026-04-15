const form = document.querySelector("#observer-form");
const browserForm = document.querySelector("#browser-form");
const logOutput = document.querySelector("#log-output");
const clearLogButton = document.querySelector("#clear-log");
const openOutputButton = document.querySelector("#open-output");
const stopObserverButton = document.querySelector("#stop-observer");
const statusBadge = document.querySelector("#observer-status-badge");
const pidEl = document.querySelector("#observer-pid");
const outputEl = document.querySelector("#observer-output");
const memoryEl = document.querySelector("#observer-memory");
const stopReasonEl = document.querySelector("#observer-stop-reason");

const STORAGE_KEY = "browser-devtools-automation-launcher";
const maxLines = 250;
let logLines = [];
let currentState = null;

function appendLog(line) {
  const timestamp = new Date().toLocaleTimeString("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  logLines.push(`[${timestamp}] ${line}`);
  if (logLines.length > maxLines) {
    logLines = logLines.slice(logLines.length - maxLines);
  }
  logOutput.textContent = logLines.join("\n");
  logOutput.scrollTop = logOutput.scrollHeight;
}

function saveFormState() {
  const payload = {
    startAt: document.querySelector("#start-at").value,
    port: document.querySelector("#port").value,
    urlPattern: document.querySelector("#url-pattern").value,
    titlePattern: document.querySelector("#title-pattern").value,
    waitMs: document.querySelector("#wait-ms").value,
    durationSec: document.querySelector("#duration-sec").value,
    browserUrl: document.querySelector("#browser-url").value,
    browserPort: document.querySelector("#browser-port").value,
    browserPath: document.querySelector("#browser-path").value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreFormState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const payload = JSON.parse(raw);
    document.querySelector("#start-at").value = payload.startAt || "";
    document.querySelector("#port").value = payload.port || "9222";
    document.querySelector("#url-pattern").value = payload.urlPattern || "djplaylists.fm";
    document.querySelector("#title-pattern").value = payload.titlePattern || "";
    document.querySelector("#wait-ms").value = payload.waitMs || "30000";
    document.querySelector("#duration-sec").value = payload.durationSec || "0";
    document.querySelector("#browser-url").value =
      payload.browserUrl || "https://www.djplaylists.fm/";
    document.querySelector("#browser-port").value = payload.browserPort || "9222";
    document.querySelector("#browser-path").value = payload.browserPath || "";
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function localDateTimeToIso(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function updateState(state) {
  currentState = state;
  const running = Boolean(state?.running);

  statusBadge.textContent = running ? "Aktiv" : "Inaktiv";
  statusBadge.classList.toggle("badge-active", running);
  pidEl.textContent = state?.pid ? String(state.pid) : "-";
  outputEl.textContent = state?.outputDir || "-";
  memoryEl.textContent = state?.memoryPath || "-";
  stopReasonEl.textContent = state?.stopReason || state?.lastError || "-";
  stopObserverButton.disabled = !running;
  openOutputButton.disabled = !state?.outputDir;
}

function observerPayloadFromForm() {
  return {
    startAt: localDateTimeToIso(document.querySelector("#start-at").value),
    host: "127.0.0.1",
    port: Number.parseInt(document.querySelector("#port").value || "9222", 10),
    urlPattern: document.querySelector("#url-pattern").value.trim(),
    titlePattern: document.querySelector("#title-pattern").value.trim(),
    waitMs: Number.parseInt(document.querySelector("#wait-ms").value || "30000", 10),
    durationSec: Number.parseInt(document.querySelector("#duration-sec").value || "0", 10)
  };
}

function browserPayloadFromForm() {
  return {
    url: document.querySelector("#browser-url").value.trim(),
    port: Number.parseInt(document.querySelector("#browser-port").value || "9222", 10),
    browserPath: document.querySelector("#browser-path").value.trim()
  };
}

async function initialize() {
  restoreFormState();
  updateState(await window.observerLauncher.getState());

  window.observerLauncher.onState((state) => {
    updateState(state);
  });

  window.observerLauncher.onLog((entry) => {
    appendLog(`${entry.kind}: ${entry.line}`);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveFormState();

  const payload = observerPayloadFromForm();
  appendLog(`Observer wird gestartet${payload.startAt ? ` ab ${payload.startAt}` : ""}.`);
  const result = await window.observerLauncher.startObserver(payload);

  if (!result.ok) {
    appendLog(`Fehler: ${result.error}`);
    return;
  }

  appendLog(`Observer gestartet mit PID ${result.pid}.`);
});

browserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveFormState();

  const payload = browserPayloadFromForm();
  appendLog(`Browser-Launcher startet ${payload.url || "about:blank"}.`);
  const result = await window.observerLauncher.launchBrowser(payload);

  if (!result.ok) {
    appendLog(`Browser-Start fehlgeschlagen: ${result.stderr || result.stdout || "Unbekannter Fehler"}`);
    return;
  }

  if (result.stdout) {
    appendLog(result.stdout);
  } else {
    appendLog("Browser gestartet.");
  }
});

stopObserverButton.addEventListener("click", async () => {
  const result = await window.observerLauncher.stopObserver();
  appendLog(result.ok ? "Stop-Signal an Observer gesendet." : `Stop fehlgeschlagen: ${result.error}`);
});

openOutputButton.addEventListener("click", async () => {
  if (!currentState?.outputDir) {
    appendLog("Noch kein Output-Verzeichnis bekannt.");
    return;
  }

  const result = await window.observerLauncher.openPath(currentState.outputDir);
  appendLog(result.ok ? `Output geoeffnet: ${currentState.outputDir}` : `Konnte Output nicht oeffnen: ${result.error}`);
});

clearLogButton.addEventListener("click", () => {
  logLines = [];
  logOutput.textContent = "";
});

for (const input of document.querySelectorAll("input")) {
  input.addEventListener("change", saveFormState);
}

initialize().catch((error) => {
  appendLog(`Initialisierung fehlgeschlagen: ${error.message || error}`);
});
