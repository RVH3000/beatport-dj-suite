#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";

const INJECT_SOURCE = String.raw`
(() => {
  if (window.__codexDjObserverInstalled) {
    return;
  }

  window.__codexDjObserverInstalled = true;

  const cleanText = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();

  const shorten = (value, max = 240) => {
    const text = cleanText(value);
    return text.length > max ? text.slice(0, max - 3) + "..." : text;
  };

  const send = (payload) => {
    try {
      if (typeof window.__codexObserver === "function") {
        window.__codexObserver(
          JSON.stringify({
            ts: new Date().toISOString(),
            ...payload
          })
        );
      }
    } catch (_) {}
  };

  const selectorFor = (element) => {
    if (!element || !element.tagName) {
      return null;
    }

    const parts = [];
    let current = element;
    let depth = 0;

    while (current && current.nodeType === Node.ELEMENT_NODE && depth < 6) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        part += "#" + current.id;
        parts.unshift(part);
        break;
      }

      if (current.classList && current.classList.length) {
        part += "." + Array.from(current.classList).slice(0, 3).join(".");
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (candidate) => candidate.tagName === current.tagName
        );
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }

    return parts.join(" > ");
  };

  const labelFor = (element) => {
    if (!element) {
      return "";
    }

    const aria = cleanText(element.getAttribute?.("aria-label"));
    const text = cleanText(element.innerText || element.textContent);
    const title = cleanText(element.getAttribute?.("title"));
    const placeholder = cleanText(element.getAttribute?.("placeholder"));
    const name = cleanText(element.getAttribute?.("name"));

    return shorten(aria || text || title || placeholder || name || element.tagName);
  };

  const collectButtons = () =>
    Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .map((element) => labelFor(element))
      .filter(Boolean)
      .slice(0, 20);

  const tableHeaders = () =>
    Array.from(document.querySelectorAll("table thead th"))
      .map((header) => cleanText(header.innerText))
      .filter(Boolean);

  const collectPlaylistTitles = () => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    const titles = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (!cells.length) {
        continue;
      }

      const title = cleanText(cells[0]?.innerText);
      if (title) {
        titles.push(title);
      }
    }

    return Array.from(new Set(titles));
  };

  const detectStep = () => {
    const url = location.href;
    const text = cleanText(document.body?.innerText);

    if (/my playlists/i.test(text) || /\/playlists/i.test(url)) {
      return "my-playlists";
    }

    if (/import streaming playlist/i.test(text)) {
      return "import-streaming-playlist";
    }

    if (/finalize your playlist/i.test(text)) {
      return "finalize-playlist";
    }

    if (/save to lexicon/i.test(text) || /playlist sent to lexicon/i.test(text)) {
      return "save-to-lexicon";
    }

    if (/submit playlist/i.test(text)) {
      return "submit-playlist";
    }

    return "unknown";
  };

  const emitSnapshot = (reason) => {
    send({
      kind: "page-snapshot",
      reason,
      url: location.href,
      documentTitle: document.title,
      heading: shorten(document.querySelector("h1, h2")?.innerText || ""),
      step: detectStep(),
      headers: tableHeaders(),
      buttons: collectButtons(),
      playlistTitles: collectPlaylistTitles().slice(0, 500)
    });
  };

  document.addEventListener(
    "click",
    (event) => {
      const element = event.target?.closest?.(
        'button, a, [role="button"], input[type="checkbox"], label'
      );
      if (!element) {
        return;
      }

      send({
        kind: "ui-click",
        url: location.href,
        label: labelFor(element),
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase()
      });

      setTimeout(() => emitSnapshot("click"), 350);
    },
    true
  );

  document.addEventListener(
    "change",
    (event) => {
      const element = event.target;
      if (!element || !element.tagName) {
        return;
      }

      const tagName = element.tagName.toLowerCase();
      if (!["input", "select", "textarea"].includes(tagName)) {
        return;
      }

      send({
        kind: "ui-change",
        url: location.href,
        label: labelFor(element),
        selector: selectorFor(element),
        fieldName: cleanText(element.name),
        type: cleanText(element.type || tagName),
        checked: Boolean(element.checked),
        value: shorten(element.value)
      });

      setTimeout(() => emitSnapshot("change"), 250);
    },
    true
  );

  document.addEventListener(
    "submit",
    (event) => {
      const element = event.target;
      send({
        kind: "form-submit",
        url: location.href,
        selector: selectorFor(element),
        label: labelFor(element)
      });
      setTimeout(() => emitSnapshot("submit"), 250);
    },
    true
  );

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function codexObservedFetch(input, init) {
      const url = typeof input === "string" ? input : input?.url;
      const method = init?.method || input?.method || "GET";
      send({
        kind: "fetch-call",
        url: String(url || ""),
        method: String(method || "GET"),
        pageURL: location.href,
        stack: String(new Error().stack || "")
      });
      return originalFetch.apply(this, arguments);
    };
  }

  if (window.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function codexObservedOpen(method, url) {
      this.__codexRequestInfo = {
        method: String(method || "GET"),
        url: String(url || ""),
        stack: String(new Error().stack || "")
      };
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function codexObservedSend() {
      send({
        kind: "xhr-call",
        pageURL: location.href,
        ...(this.__codexRequestInfo || {})
      });
      return originalSend.apply(this, arguments);
    };
  }

  const originalPushState = history.pushState;
  history.pushState = function codexObservedPushState() {
    const result = originalPushState.apply(this, arguments);
    setTimeout(() => emitSnapshot("pushState"), 100);
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function codexObservedReplaceState() {
    const result = originalReplaceState.apply(this, arguments);
    setTimeout(() => emitSnapshot("replaceState"), 100);
    return result;
  };

  window.addEventListener("popstate", () => setTimeout(() => emitSnapshot("popstate"), 100));
  window.addEventListener("load", () => emitSnapshot("load"));
  window.addEventListener("DOMContentLoaded", () => emitSnapshot("dom-content-loaded"));

  setTimeout(() => emitSnapshot("init"), 1200);
  setInterval(() => emitSnapshot("interval"), 5000);
})();
`;

function printHelp() {
  process.stdout.write(`Browser DevTools Automation Observer

Verwendung:
  node ./plugins/browser-devtools-automation/scripts/observe-djplaylists-session.mjs [optionen]

Optionen:
  --host <host>             CDP-Host (Standard: 127.0.0.1)
  --port <port>             CDP-Port (Standard: 9222)
  --url-pattern <text>      Zieltab ueber URL filtern (Standard: djplaylists.fm)
  --title-pattern <text>    Zieltab optional ueber Titel filtern
  --start-at <zeitpunkt>    Startet die Beobachtung erst ab diesem ISO-Zeitpunkt
  --wait-ms <ms>            Wie lange auf einen passenden Tab gewartet wird (Standard: 30000)
  --duration-sec <sek>      Optional nach N Sekunden automatisch beenden
  --out-dir <pfad>          Ausgabeverzeichnis fuer Session-Dateien
  --memory-path <pfad>      JSON-Datei fuer bekannte Playlist-Titel
  --quiet                   Weniger Terminal-Ausgabe
  --help                    Diese Hilfe anzeigen
`);
}

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 9222,
    urlPattern: "djplaylists.fm",
    titlePattern: "",
    startAt: "",
    waitMs: 30_000,
    durationSec: 0,
    outDir: "",
    memoryPath: "",
    quiet: false,
    help: false
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift();

    if (token === "--host") {
      options.host = rest.shift() ?? options.host;
      continue;
    }

    if (token === "--port") {
      options.port = Number.parseInt(rest.shift() ?? "", 10);
      continue;
    }

    if (token === "--url-pattern") {
      options.urlPattern = rest.shift() ?? options.urlPattern;
      continue;
    }

    if (token === "--title-pattern") {
      options.titlePattern = rest.shift() ?? options.titlePattern;
      continue;
    }

    if (token === "--start-at") {
      options.startAt = rest.shift() ?? "";
      continue;
    }

    if (token === "--wait-ms") {
      options.waitMs = Number.parseInt(rest.shift() ?? "", 10);
      continue;
    }

    if (token === "--duration-sec") {
      options.durationSec = Number.parseInt(rest.shift() ?? "", 10);
      continue;
    }

    if (token === "--out-dir") {
      options.outDir = rest.shift() ?? "";
      continue;
    }

    if (token === "--memory-path") {
      options.memoryPath = rest.shift() ?? "";
      continue;
    }

    if (token === "--quiet") {
      options.quiet = true;
      continue;
    }

    if (token === "--help") {
      options.help = true;
      continue;
    }

    throw new Error(`Unbekannte Option: ${token}`);
  }

  if (options.help) {
    return options;
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("Bitte einen gueltigen --port angeben.");
  }

  if (!Number.isInteger(options.waitMs) || options.waitMs < 0) {
    throw new Error("Bitte einen gueltigen --wait-ms Wert angeben.");
  }

  if (!Number.isInteger(options.durationSec) || options.durationSec < 0) {
    throw new Error("Bitte einen gueltigen --duration-sec Wert angeben.");
  }

  if (options.startAt) {
    const parsed = new Date(options.startAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        "Bitte --start-at als gueltigen ISO-Zeitpunkt angeben, z. B. 2026-04-14T09:30:00+02:00."
      );
    }
  }

  return options;
}

function appSupportBase() {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "beatport-dj-suite",
    "browser-devtools-automation"
  );
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
}

function resolveOutputPaths(options) {
  const base = appSupportBase();
  const outDir =
    options.outDir || path.join(base, "runs", timestampForPath(new Date()));
  const memoryPath = options.memoryPath || path.join(base, "known-playlists.json");

  ensureDir(outDir);
  ensureDir(path.dirname(memoryPath));

  return { outDir, memoryPath };
}

function normalizeTitle(title) {
  return String(title ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("de-DE");
}

function readKnownPlaylists(memoryPath) {
  if (!fs.existsSync(memoryPath)) {
    return {
      titles: [],
      index: new Map()
    };
  }

  const raw = JSON.parse(fs.readFileSync(memoryPath, "utf8"));
  const titles = Array.isArray(raw.titles) ? raw.titles : [];
  const index = new Map();

  for (const title of titles) {
    const normalized = normalizeTitle(title);
    if (normalized) {
      index.set(normalized, title);
    }
  }

  return { titles: [...index.values()], index };
}

function writeKnownPlaylists(memoryPath, memory) {
  const titles = [...memory.index.values()].sort((left, right) =>
    left.localeCompare(right, "de")
  );

  fs.writeFileSync(
    memoryPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        total: titles.length,
        titles
      },
      null,
      2
    )
  );
}

function mergeKnownPlaylists(memory, titles) {
  const newlyAdded = [];

  for (const title of titles) {
    const clean = String(title ?? "").trim().replace(/\s+/g, " ");
    const normalized = normalizeTitle(clean);

    if (!clean || !normalized || memory.index.has(normalized)) {
      continue;
    }

    memory.index.set(normalized, clean);
    newlyAdded.push(clean);
  }

  return newlyAdded;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fuer ${url}`);
  }

  return response.json();
}

async function discoverTarget(options) {
  const deadline = Date.now() + options.waitMs;
  const matcher = (candidate) => {
    const urlMatches = options.urlPattern
      ? String(candidate.url || "")
          .toLowerCase()
          .includes(options.urlPattern.toLowerCase())
      : true;
    const titleMatches = options.titlePattern
      ? String(candidate.title || "")
          .toLowerCase()
          .includes(options.titlePattern.toLowerCase())
      : true;

    return candidate.type === "page" && urlMatches && titleMatches;
  };

  while (Date.now() <= deadline) {
    const targets = await fetchJson(
      `http://${options.host}:${options.port}/json/list`
    );
    const match = targets.find(matcher);

    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(
    `Kein passender CDP-Tab gefunden fuer url-pattern="${options.urlPattern}"` +
      (options.titlePattern
        ? ` und title-pattern="${options.titlePattern}".`
        : ".")
  );
}

class CDPClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.webSocketUrl);

    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });

    this.ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));

      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }

        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }

      if (message.method) {
        const handlers = this.eventHandlers.get(message.method) ?? [];
        for (const handler of handlers) {
          handler(message.params ?? {});
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload), (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  on(method, handler) {
    const list = this.eventHandlers.get(method) ?? [];
    list.push(handler);
    this.eventHandlers.set(method, list);
  }

  async close() {
    if (!this.ws) {
      return;
    }

    await new Promise((resolve) => {
      this.ws.once("close", resolve);
      this.ws.close();
    });
  }
}

function appendJsonl(stream, payload) {
  stream.write(`${JSON.stringify(payload)}\n`);
}

function stackFrameStrings(stack) {
  const frames = [];
  let current = stack;

  while (current) {
    for (const frame of current.callFrames ?? []) {
      frames.push(
        `${frame.functionName || "<anonymous>"} @ ${frame.url || "<inline>"}:${
          Number(frame.lineNumber ?? 0) + 1
        }`
      );
    }
    current = current.parent;
  }

  return frames;
}

function stackFunctionNamesFromString(stackText) {
  if (!stackText) {
    return [];
  }

  const names = [];
  const lines = String(stackText).split("\n");

  for (const line of lines) {
    const match =
      line.match(/at\s+([A-Za-z0-9_$<>.]+)\s+\(/) ||
      line.match(/at\s+([A-Za-z0-9_$<>.]+)\s+@/);
    const name = match?.[1];
    if (name && name !== "Error") {
      names.push(name);
    }
  }

  return names;
}

function summarizeState(state) {
  const topEndpoints = [...state.endpointCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20)
    .map(([endpoint, count]) => ({ endpoint, count }));

  const candidateFunctions = [...state.functionCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  return {
    startedAt: state.startedAt,
    requestedStartAt: state.requestedStartAt,
    finishedAt: new Date().toISOString(),
    target: state.target,
    counts: {
      uiClicks: state.uiClicks,
      uiChanges: state.uiChanges,
      formSubmits: state.formSubmits,
      fetchCalls: state.fetchCalls,
      xhrCalls: state.xhrCalls,
      networkRequests: state.networkRequests,
      consoleEvents: state.consoleEvents,
      exceptions: state.exceptions
    },
    stepsSeen: [...state.stepsSeen],
    pagesSeen: [...state.pagesSeen],
    topEndpoints,
    candidateFunctions,
    playlistMemory: {
      totalKnown: state.memory.index.size,
      newTitlesThisRun: [...state.newTitlesThisRun],
      titlesSeenThisRun: [...state.titlesSeenThisRun]
    }
  };
}

function renderSummary(summary) {
  const lines = [];

  lines.push("# DJPlaylists Session Summary");
  lines.push("");
  lines.push(`- Started: ${summary.startedAt}`);
  if (summary.requestedStartAt) {
    lines.push(`- Requested start: ${summary.requestedStartAt}`);
  }
  lines.push(`- Finished: ${summary.finishedAt}`);
  lines.push(`- Target URL: ${summary.target.url}`);
  lines.push(`- Known playlists total: ${summary.playlistMemory.totalKnown}`);
  lines.push(
    `- New playlist titles this run: ${summary.playlistMemory.newTitlesThisRun.length}`
  );
  lines.push("");
  lines.push("## Event Counts");
  lines.push("");
  for (const [key, value] of Object.entries(summary.counts)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push("");
  lines.push("## Steps Seen");
  lines.push("");
  for (const step of summary.stepsSeen) {
    lines.push(`- ${step}`);
  }

  lines.push("");
  lines.push("## Top Endpoints");
  lines.push("");
  for (const item of summary.topEndpoints) {
    lines.push(`- ${item.count}x ${item.endpoint}`);
  }

  lines.push("");
  lines.push("## Candidate Functions");
  lines.push("");
  for (const item of summary.candidateFunctions) {
    lines.push(`- ${item.count}x ${item.name}`);
  }

  lines.push("");
  lines.push("## New Titles");
  lines.push("");
  for (const title of summary.playlistMemory.newTitlesThisRun) {
    lines.push(`- ${title}`);
  }

  return `${lines.join("\n")}\n`;
}

function endpointLabel(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

async function waitUntilStart(options) {
  if (!options.startAt) {
    return null;
  }

  const startAt = new Date(options.startAt);
  const diffMs = startAt.getTime() - Date.now();

  if (diffMs <= 0) {
    return startAt.toISOString();
  }

  if (!options.quiet) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: "scheduled",
          startAt: startAt.toISOString(),
          waitMs: diffMs
        },
        null,
        2
      )}\n`
    );
  }

  await new Promise((resolve) => setTimeout(resolve, diffMs));
  return startAt.toISOString();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const requestedStartAt = await waitUntilStart(options);
  const { outDir, memoryPath } = resolveOutputPaths(options);
  const target = await discoverTarget(options);
  const client = new CDPClient(target.webSocketDebuggerUrl);
  const memory = readKnownPlaylists(memoryPath);
  const eventsPath = path.join(outDir, "events.jsonl");
  const networkPath = path.join(outDir, "network.jsonl");
  const eventsStream = fs.createWriteStream(eventsPath, { flags: "a" });
  const networkStream = fs.createWriteStream(networkPath, { flags: "a" });

  const state = {
    startedAt: new Date().toISOString(),
    requestedStartAt,
    target: {
      id: target.id,
      title: target.title,
      url: target.url
    },
    memory,
    newTitlesThisRun: new Set(),
    titlesSeenThisRun: new Set(),
    pagesSeen: new Set(),
    stepsSeen: new Set(),
    endpointCounts: new Map(),
    functionCounts: new Map(),
    requestMeta: new Map(),
    uiClicks: 0,
    uiChanges: 0,
    formSubmits: 0,
    fetchCalls: 0,
    xhrCalls: 0,
    networkRequests: 0,
    consoleEvents: 0,
    exceptions: 0
  };

  const rememberFunctions = (names) => {
    for (const name of names) {
      if (!name || name === "<anonymous>" || /^codexObserved/.test(name)) {
        continue;
      }

      state.functionCounts.set(name, (state.functionCounts.get(name) ?? 0) + 1);
    }
  };

  const rememberEndpoint = (url) => {
    if (!url) {
      return;
    }

    const label = endpointLabel(url);
    state.endpointCounts.set(label, (state.endpointCounts.get(label) ?? 0) + 1);
  };

  const registerSnapshot = (payload) => {
    if (payload.url) {
      state.pagesSeen.add(payload.url);
    }
    if (payload.step) {
      state.stepsSeen.add(payload.step);
    }

    const titles = Array.isArray(payload.playlistTitles)
      ? payload.playlistTitles.filter(Boolean)
      : [];

    for (const title of titles) {
      state.titlesSeenThisRun.add(title);
    }

    const newlyAdded = mergeKnownPlaylists(state.memory, titles);
    for (const title of newlyAdded) {
      state.newTitlesThisRun.add(title);
    }

    if (newlyAdded.length > 0) {
      writeKnownPlaylists(memoryPath, state.memory);
    }
  };

  const finalize = async (reason) => {
  const summary = summarizeState(state);
    summary.stopReason = reason;

    writeKnownPlaylists(memoryPath, state.memory);
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(outDir, "summary.md"), renderSummary(summary));

    await Promise.all([
      new Promise((resolve) => eventsStream.end(resolve)),
      new Promise((resolve) => networkStream.end(resolve))
    ]);

    await client.close().catch(() => {});

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          stopReason: reason,
          requestedStartAt,
          outputDir: outDir,
          memoryPath,
          summaryPath: path.join(outDir, "summary.json"),
          newTitlesThisRun: summary.playlistMemory.newTitlesThisRun.length,
          knownPlaylistsTotal: summary.playlistMemory.totalKnown
        },
        null,
        2
      )}\n`
    );
  };

  let stopping = false;
  const stopOnce = async (reason) => {
    if (stopping) {
      return;
    }
    stopping = true;
    await finalize(reason);
    process.exit(0);
  };

  await client.connect();

  client.on("Runtime.bindingCalled", (params) => {
    if (params.name !== "__codexObserver") {
      return;
    }

    const payload = JSON.parse(params.payload);
    appendJsonl(eventsStream, payload);

    if (payload.kind === "ui-click") {
      state.uiClicks += 1;
    } else if (payload.kind === "ui-change") {
      state.uiChanges += 1;
    } else if (payload.kind === "form-submit") {
      state.formSubmits += 1;
    } else if (payload.kind === "fetch-call") {
      state.fetchCalls += 1;
      rememberEndpoint(payload.url);
      rememberFunctions(stackFunctionNamesFromString(payload.stack));
    } else if (payload.kind === "xhr-call") {
      state.xhrCalls += 1;
      rememberEndpoint(payload.url);
      rememberFunctions(stackFunctionNamesFromString(payload.stack));
    } else if (payload.kind === "page-snapshot") {
      registerSnapshot(payload);
    }
  });

  client.on("Runtime.consoleAPICalled", (params) => {
    const payload = {
      kind: "console",
      ts: new Date().toISOString(),
      type: params.type,
      args: (params.args ?? []).map(
        (arg) => arg.value ?? arg.unserializableValue ?? arg.description ?? "<unserializable>"
      )
    };
    state.consoleEvents += 1;
    appendJsonl(eventsStream, payload);
  });

  client.on("Runtime.exceptionThrown", (params) => {
    state.exceptions += 1;
    appendJsonl(eventsStream, {
      kind: "exception",
      ts: new Date().toISOString(),
      text: params.exceptionDetails?.text,
      url: params.exceptionDetails?.url,
      lineNumber: params.exceptionDetails?.lineNumber
    });
  });

  client.on("Network.requestWillBeSent", (params) => {
    state.networkRequests += 1;
    rememberEndpoint(params.request?.url);
    rememberFunctions(stackFrameStrings(params.initiator?.stack).map((line) => line.split(" @ ")[0]));

    state.requestMeta.set(params.requestId, {
      url: params.request?.url,
      method: params.request?.method,
      resourceType: params.type
    });

    appendJsonl(networkStream, {
      kind: "request",
      ts: new Date().toISOString(),
      requestId: params.requestId,
      documentURL: params.documentURL,
      resourceType: params.type,
      method: params.request?.method,
      url: params.request?.url,
      initiatorType: params.initiator?.type,
      stack: stackFrameStrings(params.initiator?.stack)
    });
  });

  client.on("Network.responseReceived", (params) => {
    const requestMeta = state.requestMeta.get(params.requestId) ?? {};
    appendJsonl(networkStream, {
      kind: "response",
      ts: new Date().toISOString(),
      requestId: params.requestId,
      url: requestMeta.url,
      method: requestMeta.method,
      resourceType: requestMeta.resourceType,
      status: params.response?.status,
      mimeType: params.response?.mimeType,
      remoteIPAddress: params.response?.remoteIPAddress
    });
  });

  client.on("Network.loadingFailed", (params) => {
    appendJsonl(networkStream, {
      kind: "loading-failed",
      ts: new Date().toISOString(),
      requestId: params.requestId,
      errorText: params.errorText,
      canceled: params.canceled
    });
  });

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Log.enable");
  await client.send("Runtime.addBinding", { name: "__codexObserver" });
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT_SOURCE });
  await client.send("Runtime.evaluate", {
    expression: INJECT_SOURCE,
    awaitPromise: false
  });

  registerSnapshot({
    kind: "page-snapshot",
    reason: "start",
    url: target.url,
    step: "attached",
    playlistTitles: []
  });

  if (!options.quiet) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: "attached",
          requestedStartAt,
          target: {
            title: target.title,
            url: target.url
          },
          outputDir: outDir,
          memoryPath
        },
        null,
        2
      )}\n`
    );
  }

  process.once("SIGINT", () => {
    stopOnce("sigint").catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
  });

  process.once("SIGTERM", () => {
    stopOnce("sigterm").catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
  });

  if (options.durationSec > 0) {
    setTimeout(() => {
      stopOnce("duration-reached").catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
      });
    }, options.durationSec * 1000);
  }

  await new Promise(() => {});
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
