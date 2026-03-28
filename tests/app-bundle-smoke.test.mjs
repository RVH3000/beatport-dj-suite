#!/usr/bin/env node
/**
 * App-Bundle Smoke-Tests
 *
 * Verifiziert die Integrität des Electron-Projekts und der Build-Konfiguration
 * ohne tatsächlich zu bauen. Prüft:
 *
 * 1. package.json Konsistenz (scripts, dependencies, build config)
 * 2. Alle referenzierten Dateien existieren
 * 3. Main-Entry-Point ist korrekt konfiguriert
 * 4. Preload-Datei existiert
 * 5. Renderer-Dateien existieren
 * 6. Importierbare Module laden korrekt
 * 7. Falls Build vorhanden: .app Bundle-Struktur prüfen
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── package.json Konsistenz ────────────────────────────────────────────────

describe("package.json Konsistenz", () => {
  let pkg;

  it("package.json ist lesbar und valides JSON", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.ok(pkg.name, "name fehlt");
  });

  it("type ist 'module' (ESM)", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.equal(pkg.type, "module");
  });

  it("main zeigt auf electron-app/main.mjs", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.equal(pkg.main, "electron-app/main.mjs");
    assert.ok(
      existsSync(path.join(ROOT, pkg.main)),
      `Main entry ${pkg.main} existiert nicht`
    );
  });

  it("hat test-Skript", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.ok(pkg.scripts?.test, "test-Skript fehlt");
    assert.ok(
      pkg.scripts.test.includes("node --test"),
      `test-Skript sollte 'node --test' verwenden: ${pkg.scripts.test}`
    );
  });

  it("hat desktop:dev und desktop:dist:mac Skripte", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.ok(pkg.scripts["desktop:dev"], "desktop:dev fehlt");
    assert.ok(pkg.scripts["desktop:dist:mac"], "desktop:dist:mac fehlt");
  });

  it("electron ist als devDependency konfiguriert", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.ok(pkg.devDependencies?.electron, "electron fehlt in devDependencies");
  });

  it("electron-builder ist als devDependency konfiguriert", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.ok(
      pkg.devDependencies?.["electron-builder"],
      "electron-builder fehlt in devDependencies"
    );
  });

  it("build config hat appId und productName", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.ok(pkg.build?.appId, "build.appId fehlt");
    assert.ok(pkg.build?.productName, "build.productName fehlt");
  });

  it("ws ist als Dependency (für WebSocket in cdp-scanner)", async () => {
    const raw = await fs.readFile(path.join(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(raw);
    assert.ok(pkg.dependencies?.ws, "ws fehlt in dependencies");
  });
});

// ── Dateisystem-Struktur ───────────────────────────────────────────────────

describe("Electron-App Dateistruktur", () => {
  const requiredFiles = [
    "electron-app/main.mjs",
    "electron-app/preload.mjs",
    "electron-app/renderer/index.html",
    "electron-app/scanner/cdp-scanner.mjs",
    "electron-app/scanner/run-store.mjs",
    "electron-app/scanner/xhr-scanner.mjs",
    "electron-app/cache/sqlite-cache.mjs",
    "electron-app/auth/session-manager.mjs",
    "electron-app/auth/session-probe.mjs",
    "electron-app/data/export-formats.mjs",
    "electron-app/utils/common.mjs",
  ];

  for (const file of requiredFiles) {
    it(`${file} existiert`, () => {
      assert.ok(
        existsSync(path.join(ROOT, file)),
        `Datei ${file} existiert nicht`
      );
    });
  }
});

describe("Renderer-Dateien", () => {
  it("index.html existiert und enthält DOCTYPE", async () => {
    const htmlPath = path.join(ROOT, "electron-app", "renderer", "index.html");
    assert.ok(existsSync(htmlPath), "index.html existiert nicht");
    const html = await fs.readFile(htmlPath, "utf-8");
    assert.ok(
      html.toLowerCase().includes("<!doctype") || html.toLowerCase().includes("<html"),
      "index.html hat kein DOCTYPE oder html Tag"
    );
  });

  it("index.html referenziert app.js oder äquivalentes Script", async () => {
    const htmlPath = path.join(ROOT, "electron-app", "renderer", "index.html");
    const html = await fs.readFile(htmlPath, "utf-8");
    assert.ok(
      html.includes("<script") || html.includes("app.js") || html.includes("app.mjs"),
      "index.html enthält kein Script-Tag"
    );
  });
});

// ── Integration-Module Import-Test ─────────────────────────────────────────

describe("Integration-Module sind importierbar", () => {
  it("project-discovery.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "integrations", "project-discovery.mjs")
    );
    assert.ok(mod.discoverProjectParts, "discoverProjectParts fehlt");
    assert.ok(mod.buildUnifiedComponentMap, "buildUnifiedComponentMap fehlt");
  });

  it("performance-classifier.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "integrations", "performance-classifier.mjs")
    );
    assert.ok(mod.classifyTrackBatch, "classifyTrackBatch fehlt");
  });

  it("m3u-exporter.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "integrations", "m3u-exporter.mjs")
    );
    assert.ok(mod.exportM3uPlaylist, "exportM3uPlaylist fehlt");
  });

  it("osc-bridge.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "integrations", "osc-bridge.mjs")
    );
    assert.ok(mod.sendOscSnapshot, "sendOscSnapshot fehlt");
  });

  it("cdp-scanner.mjs importierbar (Haupt-Scanner-Modul)", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "scanner", "cdp-scanner.mjs")
    );
    assert.ok(mod.resolveConfig, "resolveConfig fehlt");
    assert.ok(mod.DEFAULTS, "DEFAULTS fehlt");
    assert.ok(mod.main, "main fehlt");
  });

  it("run-store.mjs importierbar (Kernfunktionen)", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "scanner", "run-store.mjs")
    );
    assert.ok(mod.RunStore, "RunStore fehlt");
    assert.ok(mod.compareVersions, "compareVersions fehlt");
    assert.ok(mod.buildTrackFingerprint, "buildTrackFingerprint fehlt");
  });

  it("xhr-scanner.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "scanner", "xhr-scanner.mjs")
    );
    assert.ok(mod.BeatportXhrClient, "BeatportXhrClient fehlt");
    assert.ok(mod.normalizePlaylist, "normalizePlaylist fehlt");
  });

  it("sqlite-cache.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "cache", "sqlite-cache.mjs")
    );
    assert.ok(mod.SQLiteCacheStore, "SQLiteCacheStore fehlt");
    assert.ok(mod.normalizePlaylistKey, "normalizePlaylistKey fehlt");
  });

  it("export-formats.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "data", "export-formats.mjs")
    );
    assert.ok(mod.generateExport, "generateExport fehlt");
  });

  it("session-probe.mjs importierbar", async () => {
    const mod = await import(
      path.join(ROOT, "electron-app", "auth", "session-probe.mjs")
    );
    assert.ok(mod.detectBeatportSessionState, "detectBeatportSessionState fehlt");
    assert.ok(mod.buildSessionProbeExpression, "buildSessionProbeExpression fehlt");
  });
});

// ── Build-Output prüfen (falls vorhanden) ──────────────────────────────────

describe("Build-Output (falls vorhanden)", () => {
  const distDir = path.join(ROOT, "dist-electron");
  const hasDist = existsSync(distDir);

  it(`dist-electron/ ${hasDist ? "existiert" : "fehlt (Build noch nicht ausgeführt)"}`, () => {
    // Info-Test — kein Fail wenn Build nicht vorhanden
    if (!hasDist) {
      console.log("  ℹ Build-Output nicht vorhanden. Überspringe Build-Checks.");
    }
    assert.ok(true);
  });

  if (hasDist) {
    it("Enthält mac-arm64 Verzeichnis", async () => {
      const entries = await fs.readdir(distDir);
      const hasMacArm = entries.some((e) =>
        e.includes("mac-arm64") || e.includes("mac")
      );
      assert.ok(hasMacArm, `Kein mac-Verzeichnis in dist-electron/: ${entries.join(", ")}`);
    });

    it("App-Bundle hat erwartete Struktur", async () => {
      const macDir = path.join(distDir, "mac-arm64");
      if (!existsSync(macDir)) return;

      const entries = await fs.readdir(macDir);
      const appBundle = entries.find((e) => e.endsWith(".app"));
      assert.ok(appBundle, `Kein .app Bundle in ${macDir}`);

      const contentsDir = path.join(macDir, appBundle, "Contents");
      assert.ok(
        existsSync(contentsDir),
        `Contents/ fehlt in ${appBundle}`
      );

      const infoPlist = path.join(contentsDir, "Info.plist");
      assert.ok(
        existsSync(infoPlist),
        "Info.plist fehlt im App-Bundle"
      );
    });
  }
});

// ── Abhängigkeiten ─────────────────────────────────────────────────────────

describe("Abhängigkeiten", () => {
  it("node_modules existiert", () => {
    assert.ok(
      existsSync(path.join(ROOT, "node_modules")),
      "node_modules fehlt — 'npm install' ausführen"
    );
  });

  it("ws-Modul ist installiert", () => {
    assert.ok(
      existsSync(path.join(ROOT, "node_modules", "ws")),
      "ws nicht installiert — 'npm install' ausführen"
    );
  });

  it("electron ist installiert", () => {
    assert.ok(
      existsSync(path.join(ROOT, "node_modules", "electron")),
      "electron nicht installiert — 'npm install' ausführen"
    );
  });
});

// ── Cross-File Import-Konsistenz ───────────────────────────────────────────

describe("Cross-File Import-Konsistenz", () => {
  it("cdp-scanner.mjs importiert alle genutzten run-store Funktionen", async () => {
    const cdpSource = await fs.readFile(
      path.join(ROOT, "electron-app", "scanner", "cdp-scanner.mjs"),
      "utf-8"
    );
    // Prüfe dass die gefixten Imports vorhanden sind
    assert.ok(
      cdpSource.includes("extractYearValue"),
      "extractYearValue Import fehlt in cdp-scanner.mjs"
    );
    assert.ok(
      cdpSource.includes("incrementBucket"),
      "incrementBucket Import fehlt in cdp-scanner.mjs"
    );
    assert.ok(
      cdpSource.includes("sortCountList"),
      "sortCountList Import fehlt in cdp-scanner.mjs"
    );
  });

  it("run-store.mjs exportiert alle von cdp-scanner.mjs importierten Funktionen", async () => {
    const runStoreSource = await fs.readFile(
      path.join(ROOT, "electron-app", "scanner", "run-store.mjs"),
      "utf-8"
    );
    const requiredExports = [
      "extractYearValue",
      "incrementBucket",
      "sortCountList",
      "normalizeTrackRow",
      "normalizePlaylistSummary",
      "buildTrackFingerprint",
    ];
    for (const name of requiredExports) {
      assert.ok(
        runStoreSource.includes(name),
        `${name} nicht in run-store.mjs gefunden`
      );
    }
  });
});
