import path from "node:path";

/**
 * Pfad-Resolver für die Beatport DJ Suite. Kapselt Electron-spezifische
 * APIs (`app.getPath`, `process.resourcesPath`) hinter einer testbaren Schnittstelle.
 *
 * Beim Erzeugen wird das Electron-`app`-Objekt injiziert — kein direkter
 * import von "electron" hier, damit die Klasse auch im Test-Kontext (ohne
 * Electron-Runtime) instanziierbar ist.
 *
 * Beispiel:
 *   import { app } from "electron";
 *   const paths = createPaths({ app, repoRoot });
 *   paths.userData();    // → /Users/.../Library/Application Support/...
 *   paths.liveStatus();  // → userData/live-status.json
 *   paths.bundled("assets/icon.png");
 */
export class Paths {
  constructor({ app, repoRoot, packagedResourcesPath = null, isPackaged = null } = {}) {
    if (!app || typeof app.getPath !== "function") {
      throw new Error("Paths: app.getPath() erforderlich (Electron-App-Objekt injizieren)");
    }
    if (!repoRoot) throw new Error("Paths: repoRoot erforderlich");
    this._app = app;
    this._repoRoot = repoRoot;
    this._packagedResources = packagedResourcesPath;
    this._isPackaged = isPackaged ?? (typeof app.isPackaged === "boolean" ? app.isPackaged : false);
  }

  userData() { return this._app.getPath("userData"); }
  home() { return this._app.getPath("home"); }
  temp() { return this._app.getPath("temp"); }
  appData() { return this._app.getPath("appData"); }
  downloads() { return this._app.getPath("downloads"); }
  documents() { return this._app.getPath("documents"); }

  liveStatus() {
    return path.join(this.userData(), "live-status.json");
  }

  inUserData(...segments) {
    return path.join(this.userData(), ...segments);
  }

  inRepo(...segments) {
    return path.join(this._repoRoot, ...segments);
  }

  /**
   * Löst einen Pfad relativ zum gepackten Bundle (Production) oder Repo-Root (Dev).
   */
  bundled(relativePath) {
    if (this._isPackaged && this._packagedResources) {
      return path.join(this._packagedResources, "app.asar.unpacked", relativePath);
    }
    return path.join(this._repoRoot, relativePath);
  }
}

export function createPaths(opts) {
  return new Paths(opts);
}
