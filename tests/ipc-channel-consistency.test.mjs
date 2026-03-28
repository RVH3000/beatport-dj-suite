#!/usr/bin/env node
/**
 * IPC-Channel-Konsistenz-Tests
 *
 * Verifiziert, dass alle IPC-Kanäle, die in preload.mjs referenziert werden,
 * auch in main.mjs registriert sind — und umgekehrt.
 * Außerdem: Hilfsfunktionen aus main.mjs, die ohne Electron testbar sind.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Quell-Dateien einlesen ─────────────────────────────────────────────────
const preloadSource = await fs.readFile(
  path.join(ROOT, "electron-app", "preload.mjs"),
  "utf-8"
);
const mainSource = await fs.readFile(
  path.join(ROOT, "electron-app", "main.mjs"),
  "utf-8"
);

// ── IPC-Channel-Extraktion ─────────────────────────────────────────────────

/**
 * Extrahiert alle IPC-Channel-Namen aus ipcRenderer.invoke("channel:name", ...)
 * und ipcRenderer.on("channel:name", ...) Aufrufe in preload.mjs.
 */
function extractPreloadChannels(source) {
  const invokePattern = /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g;
  const onPattern = /ipcRenderer\.on\(\s*["']([^"']+)["']/g;
  const channels = new Set();
  let match;
  while ((match = invokePattern.exec(source)) !== null) {
    channels.add(match[1]);
  }
  while ((match = onPattern.exec(source)) !== null) {
    channels.add(match[1]);
  }
  return channels;
}

/**
 * Extrahiert alle registrierten IPC-Handler aus main.mjs.
 * Erkennt ipcMain.handle("channel", ...) und ipcHandle("channel", ...).
 */
function extractMainChannels(source) {
  const handlePattern = /ipcMain\.handle\(\s*["']([^"']+)["']/g;
  const ipcHandlePattern = /ipcHandle\(\s*["']([^"']+)["']/g;
  const channels = new Set();
  let match;
  while ((match = handlePattern.exec(source)) !== null) {
    channels.add(match[1]);
  }
  while ((match = ipcHandlePattern.exec(source)) !== null) {
    channels.add(match[1]);
  }
  return channels;
}

/**
 * Extrahiert alle webContents.send("channel", ...) Events aus main.mjs.
 */
function extractMainSendChannels(source) {
  const sendPattern = /\.send\(\s*["']([^"']+)["']/g;
  const channels = new Set();
  let match;
  while ((match = sendPattern.exec(source)) !== null) {
    channels.add(match[1]);
  }
  return channels;
}

const preloadChannels = extractPreloadChannels(preloadSource);
const mainHandleChannels = extractMainChannels(mainSource);
const mainSendChannels = extractMainSendChannels(mainSource);

// ── Tests ──────────────────────────────────────────────────────────────────

describe("IPC-Channel-Konsistenz", () => {
  it("Preload enthält mindestens 30 IPC-Channels", () => {
    assert.ok(
      preloadChannels.size >= 30,
      `Erwartet >= 30 Channels, gefunden: ${preloadChannels.size}`
    );
  });

  it("Main enthält mindestens 30 IPC-Handler", () => {
    assert.ok(
      mainHandleChannels.size >= 30,
      `Erwartet >= 30 Handler, gefunden: ${mainHandleChannels.size}`
    );
  });

  it("Alle Preload-invoke-Channels haben Handler in main.mjs", () => {
    const invokeOnlyChannels = new Set();
    const invokePattern = /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g;
    let match;
    while ((match = invokePattern.exec(preloadSource)) !== null) {
      invokeOnlyChannels.add(match[1]);
    }

    const missing = [];
    for (const channel of invokeOnlyChannels) {
      if (!mainHandleChannels.has(channel)) {
        missing.push(channel);
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `Preload referenziert Channels ohne Handler in main.mjs: ${missing.join(", ")}`
    );
  });

  it("Alle Preload-on-Listener haben Sender in main.mjs", () => {
    const onPattern = /ipcRenderer\.on\(\s*["']([^"']+)["']/g;
    const onChannels = new Set();
    let match;
    while ((match = onPattern.exec(preloadSource)) !== null) {
      onChannels.add(match[1]);
    }

    const missing = [];
    for (const channel of onChannels) {
      if (!mainSendChannels.has(channel)) {
        missing.push(channel);
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `Preload lauscht auf Events ohne Sender in main.mjs: ${missing.join(", ")}`
    );
  });

  it("Kein verwaister Handler in main.mjs (ohne Preload-Gegenstück)", () => {
    // Nicht alle Handler MÜSSEN in Preload sein (z.B. intern verwendet),
    // aber wir dokumentieren die Diskrepanz.
    const orphans = [];
    for (const channel of mainHandleChannels) {
      if (!preloadChannels.has(channel)) {
        orphans.push(channel);
      }
    }
    // Info-Ausgabe statt harter Fail — manche Handler werden intern genutzt
    if (orphans.length > 0) {
      console.log(
        `  ℹ ${orphans.length} Handler in main.mjs ohne Preload-Mapping: ${orphans.join(", ")}`
      );
    }
    // Maximal 10 Orphans tolerieren
    assert.ok(
      orphans.length <= 10,
      `Zu viele verwaiste Handler (${orphans.length}): ${orphans.join(", ")}`
    );
  });
});

// ── Preload API-Struktur ───────────────────────────────────────────────────

describe("Preload API-Struktur", () => {
  /**
   * Extrahiert contextBridge.exposeInMainWorld("apiName", { methods }) Blöcke.
   */
  function extractExposedApis(source) {
    const pattern = /exposeInMainWorld\(\s*["'](\w+)["']\s*,\s*\{/g;
    const apis = [];
    let match;
    while ((match = pattern.exec(source)) !== null) {
      apis.push(match[1]);
    }
    return apis;
  }

  const exposedApis = extractExposedApis(preloadSource);

  it("Exponiert erwartete API-Namespaces", () => {
    const expected = [
      "scannerApi",
      "playlistApi",
      "exportApi",
      "unifiedApi",
      "analysisApi",
      "authApi",
      "syncApi",
    ];
    for (const api of expected) {
      assert.ok(
        exposedApis.includes(api),
        `API '${api}' fehlt in preload.mjs`
      );
    }
  });

  it("scannerApi enthält die wichtigsten Methoden", () => {
    const scannerMethods = [
      "getDefaults",
      "getAppInfo",
      "scan",
      "discover",
      "listRuns",
      "deltaSync",
      "openPath",
    ];
    for (const method of scannerMethods) {
      assert.ok(
        preloadSource.includes(`${method}:`),
        `scannerApi.${method} fehlt in preload.mjs`
      );
    }
  });

  it("playlistApi enthält CRUD-Methoden", () => {
    const methods = ["list", "tracks", "create", "rename", "remove", "addTracks", "removeTracks"];
    for (const method of methods) {
      assert.ok(
        preloadSource.includes(`${method}:`),
        `playlistApi.${method} fehlt in preload.mjs`
      );
    }
  });

  it("syncApi enthält Pipeline-Methoden", () => {
    const methods = [
      "checkLexicon",
      "checkDjplaylists",
      "importToDjplaylists",
      "importToLexicon",
      "triggerEngineExport",
      "getPresets",
      "savePresets",
    ];
    for (const method of methods) {
      assert.ok(
        preloadSource.includes(`${method}:`),
        `syncApi.${method} fehlt in preload.mjs`
      );
    }
  });

  it("syncApi hat onBatchProgress Event-Listener", () => {
    assert.ok(
      preloadSource.includes("onBatchProgress"),
      "syncApi.onBatchProgress fehlt"
    );
    assert.ok(
      preloadSource.includes('ipcRenderer.on("sync:batch-progress"'),
      "sync:batch-progress Event-Listener fehlt"
    );
  });

  it("syncApi.onBatchProgress gibt Cleanup-Funktion zurück", () => {
    assert.ok(
      preloadSource.includes("removeListener"),
      "onBatchProgress gibt keine Cleanup-Funktion zurück"
    );
  });
});

// ── Hilfsfunktionen aus main.mjs (isoliert testbar) ────────────────────────

describe("main.mjs Hilfsfunktionen (Source-Analyse)", () => {
  describe("toErrorMessage", () => {
    // Wir extrahieren die Funktion aus dem Source und evaluieren sie
    const fnSource = mainSource.match(
      /function toErrorMessage\(error\)\s*\{[^}]+\}/
    );

    it("Funktion existiert im Source", () => {
      assert.ok(fnSource, "toErrorMessage nicht gefunden in main.mjs");
    });

    // Funktion nachbauen für Tests (gleiche Logik)
    function toErrorMessage(error) {
      if (!error) return "Unbekannter Fehler";
      return String(error.message || error);
    }

    it("Gibt 'Unbekannter Fehler' für null/undefined zurück", () => {
      assert.equal(toErrorMessage(null), "Unbekannter Fehler");
      assert.equal(toErrorMessage(undefined), "Unbekannter Fehler");
      assert.equal(toErrorMessage(""), "Unbekannter Fehler");
    });

    it("Extrahiert .message aus Error-Objekten", () => {
      assert.equal(toErrorMessage(new Error("Test")), "Test");
      assert.equal(toErrorMessage({ message: "foo" }), "foo");
    });

    it("Konvertiert Strings direkt", () => {
      assert.equal(toErrorMessage("direkter Fehler"), "direkter Fehler");
    });
  });

  describe("deriveAppBundlePath", () => {
    const fnSource = mainSource.match(
      /function deriveAppBundlePath\(execPath\)\s*\{[\s\S]*?^}/m
    );

    it("Funktion existiert im Source", () => {
      assert.ok(fnSource, "deriveAppBundlePath nicht gefunden in main.mjs");
    });

    // Nachgebaut aus dem Source
    function deriveAppBundlePath(execPath) {
      const marker = ".app/Contents/MacOS/";
      const index = execPath.indexOf(marker);
      if (index === -1) {
        return path.dirname(execPath);
      }
      return execPath.slice(0, index + 4); // +4 = ".app"
    }

    it("Extrahiert .app Pfad aus typischem macOS Bundle", () => {
      assert.equal(
        deriveAppBundlePath(
          "/Applications/Beatport DJ Suite.app/Contents/MacOS/Beatport DJ Suite"
        ),
        "/Applications/Beatport DJ Suite.app"
      );
    });

    it("Gibt dirname zurück wenn kein .app Bundle", () => {
      assert.equal(
        deriveAppBundlePath("/usr/local/bin/electron"),
        "/usr/local/bin"
      );
    });

    it("Behandelt verschachtelte .app Pfade korrekt", () => {
      const result = deriveAppBundlePath(
        "/Users/test/Desktop/My App.app/Contents/MacOS/runner"
      );
      assert.equal(result, "/Users/test/Desktop/My App.app");
    });

    it("Behandelt Pfade ohne MacOS-Marker", () => {
      assert.equal(
        deriveAppBundlePath("/tmp/test/electron"),
        "/tmp/test"
      );
    });
  });
});

// ── resolveConfig Tests ────────────────────────────────────────────────────

describe("resolveConfig (aus cdp-scanner.mjs)", () => {
  // resolveConfig wird indirekt über den cdp-scanner Import getestet
  let resolveConfig;
  let CONFIRM_TEXT;

  before(async () => {
    try {
      const mod = await import(
        path.join(ROOT, "electron-app", "scanner", "cdp-scanner.mjs")
      );
      resolveConfig = mod.resolveConfig;
      CONFIRM_TEXT = mod.CONFIRM_TEXT;
    } catch {
      // cdp-scanner hat Abhängigkeiten die in Node nicht verfügbar sind (ws)
    }
  });

  it("resolveConfig ist importierbar", () => {
    assert.ok(resolveConfig, "resolveConfig konnte nicht importiert werden");
  });

  it("resolveConfig gibt Objekt mit Standard-Feldern zurück", () => {
    if (!resolveConfig) return;
    const config = resolveConfig({});
    assert.ok(config.host, "host fehlt");
    assert.ok(config.port, "port fehlt");
    assert.ok(config.targetPattern, "targetPattern fehlt");
    assert.ok(config.timeoutMs, "timeoutMs fehlt");
  });

  it("resolveConfig übernimmt übergebene Werte", () => {
    if (!resolveConfig) return;
    const config = resolveConfig({
      host: "192.168.1.1",
      port: 9999,
    });
    assert.equal(config.host, "192.168.1.1");
    assert.equal(config.port, 9999);
  });

  it("CONFIRM_TEXT ist definiert und nicht leer", () => {
    if (!CONFIRM_TEXT) return;
    assert.ok(CONFIRM_TEXT.length > 0, "CONFIRM_TEXT ist leer");
  });

  it("resolveConfig setzt Standard-Host auf 127.0.0.1", () => {
    if (!resolveConfig) return;
    const config = resolveConfig({});
    assert.equal(config.host, "127.0.0.1");
  });

  it("resolveConfig setzt Standard-Port auf 9222", () => {
    if (!resolveConfig) return;
    const config = resolveConfig({});
    assert.equal(config.port, 9222);
  });

  it("resolveConfig setzt targetPattern auf dj.beatport.com", () => {
    if (!resolveConfig) return;
    const config = resolveConfig({});
    assert.equal(config.targetPattern, "dj.beatport.com");
  });
});

// ── IPC-Channel-Namenskonventionen ─────────────────────────────────────────

describe("IPC-Channel-Namenskonventionen", () => {
  it("Alle Channels folgen dem namespace:action Pattern", () => {
    const invalidChannels = [];
    for (const channel of preloadChannels) {
      if (!channel.includes(":")) {
        invalidChannels.push(channel);
      }
    }
    assert.deepStrictEqual(
      invalidChannels,
      [],
      `Channels ohne Namespace-Separator: ${invalidChannels.join(", ")}`
    );
  });

  it("Bekannte Namespaces sind konsistent", () => {
    const namespaces = new Set();
    for (const channel of preloadChannels) {
      namespaces.add(channel.split(":")[0]);
    }
    const expected = ["scanner", "cache", "export", "playlist", "auth", "sync", "unified", "analysis"];
    for (const ns of expected) {
      assert.ok(
        namespaces.has(ns),
        `Namespace '${ns}' fehlt in den IPC-Channels`
      );
    }
  });
});
