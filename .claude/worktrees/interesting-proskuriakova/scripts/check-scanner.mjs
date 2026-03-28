#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REQUIRED_DOCS = [
  "README.md",
  "docs/USER_GUIDE.md",
  "docs/TROUBLESHOOTING.md",
  "docs/ARCHITECTURE.md",
  "docs/MIGRATION.md",
  "docs/RELEASE_CHECKLIST.md",
];
const REQUIRED_FILES = [
  "tools/beatport_cdp_tool.mjs",
  "electron-app/auth/session-probe.mjs",
  "electron-app/auth/session-manager.mjs",
  "electron-app/cache/sqlite-cache.mjs",
  "electron-app/main.mjs",
  "electron-app/preload.mjs",
  "electron-app/renderer/app.js",
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} fehlgeschlagen.\n${result.stdout}\n${result.stderr}`
    );
  }
}

async function main() {
  for (const file of REQUIRED_DOCS) {
    if (!existsSync(path.join(ROOT, file))) {
      throw new Error(`Dokumentation fehlt: ${file}`);
    }
  }

  const packageJson = JSON.parse(
    await fs.readFile(path.join(ROOT, "package.json"), "utf8")
  );
  const requiredScripts = ["test", "check", "desktop:dist:mac", "smoke:beatport"];
  for (const scriptName of requiredScripts) {
    if (!packageJson.scripts?.[scriptName]) {
      throw new Error(`package.json Script fehlt: ${scriptName}`);
    }
  }
  if (!packageJson.build?.files?.includes("electron-app/**/*")) {
    throw new Error("electron-builder Konfiguration enthält electron-app/**/* nicht.");
  }

  for (const file of REQUIRED_FILES) {
    run("node", ["--check", file]);
  }

  run("npm", ["test"]);
  process.stdout.write("check erfolgreich\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error.message || error)}\n`);
  process.exitCode = 1;
});
