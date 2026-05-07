import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @bpdjs/beatport-connection ist eine **Übergangs-Schnittstelle**.
 *
 * Der eigentliche Beatport-Code (BeatportXhrClient, loadApiContext, ...)
 * bleibt in `electron-app/scanner/xhr-scanner.mjs` (v4.1 — als „heiliger
 * Code" markiert, wird nicht angefasst). Dieses Paket lädt ihn lazy
 * und stabilisiert das Import-Pfad-Schema (`@bpdjs/beatport-connection`)
 * für künftige Konsumenten.
 *
 * In M5 (Final-Migration) wird der Lazy-Import durch direkte Re-Exports
 * ersetzt, sobald der Beatport-Code in dieses Paket umgezogen ist.
 *
 * Tests können die Loader-Funktion via Override (`__setLoader`) mocken.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCANNER_MODULE_PATH = path.join(REPO_ROOT, "electron-app", "scanner", "xhr-scanner.mjs");

let _loader = async () => import(SCANNER_MODULE_PATH);

export function __setLoader(fn) {
  _loader = fn;
}

export function __resetLoader() {
  _loader = async () => import(SCANNER_MODULE_PATH);
}

export async function loadScannerModule() {
  return _loader();
}

export async function createBeatportClient(opts = {}) {
  const mod = await loadScannerModule();
  if (!mod || typeof mod.BeatportXhrClient !== "function") {
    throw new Error("BeatportXhrClient nicht im Scanner-Modul gefunden");
  }
  return new mod.BeatportXhrClient(opts);
}

export async function loadApiContext(...args) {
  const mod = await loadScannerModule();
  if (!mod || typeof mod.loadApiContext !== "function") {
    throw new Error("loadApiContext nicht im Scanner-Modul gefunden");
  }
  return mod.loadApiContext(...args);
}

export async function normalizePlaylist(...args) {
  const mod = await loadScannerModule();
  return mod.normalizePlaylist(...args);
}

export async function normalizeTrack(...args) {
  const mod = await loadScannerModule();
  return mod.normalizeTrack(...args);
}

/**
 * Pfad zum Quellmodul — nur informativ, z. B. für Diagnose oder Logs.
 */
export function getScannerModulePath() {
  return SCANNER_MODULE_PATH;
}
