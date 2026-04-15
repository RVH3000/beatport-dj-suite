import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const preloadPath = path.join(__dirname, "preload.mjs");
const indexPath = path.join(__dirname, "index.html");
const iconPath = path.join(repoRoot, "assets", "icon.png");
const nodeBinary = process.env.npm_node_execpath || "node";

let mainWindow = null;
let observerProcess = null;
let observerState = {
  running: false,
  pid: null,
  startedAt: null,
  outputDir: "",
  memoryPath: "",
  stopReason: "",
  lastError: ""
};

function emitToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

function setObserverState(patch) {
  observerState = {
    ...observerState,
    ...patch
  };
  emitToRenderer("observer:state", observerState);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 880,
    minHeight: 700,
    autoHideMenuBar: true,
    title: "Browser DevTools Automation",
    icon: iconPath,
    backgroundColor: "#0f1320",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(indexPath);
}

function splitLines(chunk) {
  return String(chunk ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function handleObserverOutput(kind, chunk) {
  for (const line of splitLines(chunk)) {
    emitToRenderer("observer:log", {
      kind,
      line,
      at: new Date().toISOString()
    });

    const parsed = tryParseJsonLine(line);
    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    if (parsed.outputDir || parsed.memoryPath) {
      setObserverState({
        outputDir: parsed.outputDir || observerState.outputDir,
        memoryPath: parsed.memoryPath || observerState.memoryPath
      });
    }

    if (parsed.mode === "attached") {
      setObserverState({
        running: true,
        startedAt: new Date().toISOString(),
        lastError: ""
      });
    }

    if (parsed.stopReason) {
      setObserverState({
        running: false,
        stopReason: parsed.stopReason,
        pid: null
      });
    }
  }
}

function buildObserverArgs(options) {
  const scriptPath = path.join(pluginRoot, "scripts", "observe-djplaylists-session.mjs");
  const args = [scriptPath];

  if (options.host) args.push("--host", String(options.host));
  if (options.port) args.push("--port", String(options.port));
  if (options.urlPattern) args.push("--url-pattern", String(options.urlPattern));
  if (options.titlePattern) args.push("--title-pattern", String(options.titlePattern));
  if (options.startAt) args.push("--start-at", String(options.startAt));
  if (options.waitMs !== undefined && options.waitMs !== null) {
    args.push("--wait-ms", String(options.waitMs));
  }
  if (options.durationSec) args.push("--duration-sec", String(options.durationSec));
  if (options.outDir) args.push("--out-dir", String(options.outDir));
  if (options.memoryPath) args.push("--memory-path", String(options.memoryPath));

  return args;
}

function buildBrowserArgs(options) {
  const scriptPath = path.join(pluginRoot, "scripts", "launch-devtools-browser.mjs");
  const args = [scriptPath];

  if (options.url) args.push(String(options.url));
  if (options.port) args.push("--port", String(options.port));
  if (options.browserPath) args.push("--browser", String(options.browserPath));
  if (options.profileDir) args.push("--profile-dir", String(options.profileDir));

  return args;
}

function spawnShortLivedProcess(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

async function startObserver(_event, options = {}) {
  if (observerProcess) {
    return {
      ok: false,
      error: "Observer laeuft bereits."
    };
  }

  const args = buildObserverArgs(options);
  observerProcess = spawn(nodeBinary, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  setObserverState({
    running: true,
    pid: observerProcess.pid,
    startedAt: new Date().toISOString(),
    stopReason: "",
    lastError: ""
  });

  observerProcess.stdout.on("data", (chunk) => handleObserverOutput("stdout", chunk));
  observerProcess.stderr.on("data", (chunk) => handleObserverOutput("stderr", chunk));

  observerProcess.on("error", (error) => {
    setObserverState({
      running: false,
      pid: null,
      lastError: String(error.message || error)
    });
    emitToRenderer("observer:log", {
      kind: "stderr",
      line: String(error.message || error),
      at: new Date().toISOString()
    });
    observerProcess = null;
  });

  observerProcess.on("close", (code, signal) => {
    setObserverState({
      running: false,
      pid: null,
      stopReason: signal || (code === 0 ? "beendet" : `exit-${code ?? "unknown"}`)
    });
    observerProcess = null;
  });

  return {
    ok: true,
    pid: observerProcess.pid
  };
}

async function stopObserver() {
  if (!observerProcess) {
    return {
      ok: false,
      error: "Kein Observer aktiv."
    };
  }

  observerProcess.kill("SIGINT");
  return { ok: true };
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("launcher:get-state", () => observerState);

  ipcMain.handle("launcher:start-observer", startObserver);

  ipcMain.handle("launcher:stop-observer", stopObserver);

  ipcMain.handle("launcher:launch-browser", async (_event, options = {}) => {
    const result = await spawnShortLivedProcess(nodeBinary, buildBrowserArgs(options));
    return result;
  });

  ipcMain.handle("launcher:open-path", async (_event, targetPath) => {
    if (!targetPath) {
      return { ok: false, error: "Kein Pfad angegeben." };
    }

    const error = await shell.openPath(String(targetPath));
    return {
      ok: !error,
      error: error || ""
    };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (observerProcess) {
    observerProcess.kill("SIGINT");
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
