#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import * as scanner from "../electron-app/scanner/cdp-scanner.mjs";

const __filename = fileURLToPath(import.meta.url);

function isDirectCliExecution() {
  const entryFile = process.argv[1];
  if (!entryFile) {
    return false;
  }
  return path.resolve(entryFile) === __filename;
}

if (isDirectCliExecution()) {
  scanner.main().catch((error) => {
    console.error(`Fehler: ${error.message}`);
    if (String(error.message).includes("CDP-Endpunkt nicht erreichbar")) {
      console.error(
        "Hinweis: App-Shortcuts (Chromium/Helium) benötigen ggf. den Host-Browser mit aktivem --remote-debugging-port."
      );
    }
    process.exitCode = 1;
  });
}

export * from "../electron-app/scanner/cdp-scanner.mjs";
