// @bpdjs/core/paths — Electron-Pfad-Helper als Pure-Functions + Factories.
//
// Die Helpers selbst kennen kein Electron-Objekt — sie nehmen Argumente
// rein. Factories kapseln Runtime-Bindings (app.isPackaged etc.) in einer
// Closure, damit der Hauptprozess sie einmal initialisiert und überall
// als Funktion nutzen kann.

import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Aus einem Electron-execPath den .app-Bundle-Pfad ableiten.
 * Outside-of-Bundle (z.B. Dev-Mode) liefert das Verzeichnis des execPath.
 */
export function deriveAppBundlePath(execPath) {
  const marker = ".app/Contents/MacOS/";
  const index = execPath.indexOf(marker);
  if (index === -1) {
    return path.dirname(execPath);
  }
  return execPath.slice(0, index + 4);
}

/**
 * Factory für resolveBundledPath. Erzeugt eine Funktion, die relative
 * Pfade entweder aus dem app.asar.unpacked-Resource-Pfad (packaged)
 * oder aus repoRoot (dev) auflöst.
 *
 * @param {{ isPackaged: boolean, resourcesPath: string, repoRoot: string }} opts
 * @returns {(relativePath: string) => string}
 */
export function createBundledPathResolver({ isPackaged, resourcesPath, repoRoot }) {
  return function resolveBundledPath(relativePath) {
    if (isPackaged) {
      return path.join(resourcesPath, "app.asar.unpacked", relativePath);
    }
    return path.join(repoRoot, relativePath);
  };
}

/**
 * Factory für computeBuildId. Erzeugt eine async Funktion, die einen
 * 12-Hex-Char SHA-256-Hash des app.asar oder fallback appPath liefert.
 * Wird für eindeutige Build-Erkennung in Settings/Telemetry genutzt.
 *
 * Fallback "dev-build" wenn weder app.asar noch appPath lesbar sind
 * (z.B. im Dev-Mode aus Source).
 *
 * @param {{ resourcesPath: string, appPath: string, fallback?: string }} opts
 * @returns {() => Promise<string>}
 */
export function createBuildIdComputer({ resourcesPath, appPath, fallback = "dev-build" }) {
  return async function computeBuildId() {
    const candidates = [
      path.join(resourcesPath, "app.asar"),
      appPath,
    ];

    for (const candidate of candidates) {
      try {
        if (!candidate || !existsSync(candidate)) continue;
        const buffer = await fs.readFile(candidate);
        return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
      } catch {
        continue;
      }
    }

    return fallback;
  };
}
