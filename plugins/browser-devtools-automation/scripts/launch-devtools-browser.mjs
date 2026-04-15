#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const options = {
    url: "about:blank",
    port: 9222,
    browserPath: null,
    profileDir: null
  };

  const rest = [...argv];

  while (rest.length > 0) {
    const token = rest.shift();

    if (token === "--port") {
      options.port = Number.parseInt(rest.shift() ?? "", 10);
      continue;
    }

    if (token === "--browser") {
      options.browserPath = rest.shift() ?? null;
      continue;
    }

    if (token === "--profile-dir") {
      options.profileDir = rest.shift() ?? null;
      continue;
    }

    if (!token.startsWith("--")) {
      options.url = token;
      continue;
    }

    throw new Error(`Unbekannte Option: ${token}`);
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("Bitte einen gueltigen Port ueber --port angeben.");
  }

  return options;
}

function browserCandidates() {
  const home = os.homedir();

  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    path.join(home, "Applications/Chromium.app/Contents/MacOS/Chromium"),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    path.join(home, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    path.join(home, "Applications/Brave Browser.app/Contents/MacOS/Brave Browser")
  ];
}

function resolveBrowserPath(explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Browser nicht gefunden: ${explicitPath}`);
    }

    return explicitPath;
  }

  const found = browserCandidates().find((candidate) => fs.existsSync(candidate));

  if (!found) {
    throw new Error(
      "Kein unterstuetzter Chromium-Browser gefunden. Verwende --browser <pfad>."
    );
  }

  return found;
}

function ensureProfileDir(profileDir) {
  if (profileDir) {
    fs.mkdirSync(profileDir, { recursive: true });
    return profileDir;
  }

  return fs.mkdtempSync(path.join(os.tmpdir(), "browser-devtools-automation-"));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const browserPath = resolveBrowserPath(options.browserPath);
  const profileDir = ensureProfileDir(options.profileDir);
  const args = [
    `--remote-debugging-port=${options.port}`,
    "--auto-open-devtools-for-tabs",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    options.url
  ];

  const child = spawn(browserPath, args, {
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        browserPath,
        port: options.port,
        profileDir,
        url: options.url
      },
      null,
      2
    )}\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
