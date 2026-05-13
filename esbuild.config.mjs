// esbuild Pre-Build-Bundler für electron-app/main.mjs
//
// Zweck: Workspace-Symlinks (node_modules/@bpdjs/*) werden vom electron-builder
// nicht ins asar-Bundle gepackt. esbuild bündelt main.mjs + alle @bpdjs/*-Imports
// in eine einzelne electron-app/main.bundle.mjs, die electron-builder dann packt.
//
// Externals: electron, electron-reload, better-sqlite3, alle node:*-Imports,
//            alle relativen ./-Sibling-Imports aus electron-app/*.mjs.
// Gebündelt: @bpdjs/*-Pakete (via ../packages/*-Pfad oder node_modules/@bpdjs/*-Symlink).

import esbuild from "esbuild";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsDistIndex = path.join(__dirname, "packages/engine-db-core/dist/index.js");

if (!existsSync(tsDistIndex)) {
  console.error(
    "[esbuild] packages/engine-db-core/dist/index.js fehlt.\n" +
    "          Bitte zuerst `npm run build:ts-packages` ausfuehren."
  );
  process.exit(1);
}

const entryPoint = "electron-app/main.mjs";
const outfile = "electron-app/main.bundle.mjs";

// Plugin: relative Sibling-Imports aus electron-app/*.mjs als external markieren.
// So bleibt cache/, auth/, data/, api/, integrations/ ungebundelt und wird vom
// electron-builder via electron-app/**/* ausgeliefert. ../packages/* wird gebündelt.
const electronAppRelativeExternalsPlugin = {
  name: "externalize-electron-app-siblings",
  setup(build) {
    // node:*-Imports sind keine echten Pakete — esbuild kann sie nicht auflösen.
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      external: true,
    }));

    // ./Sibling-Imports aus electron-app/*.mjs (Top-Level Dateien wie main.mjs)
    // bleiben external. Tieferere ./-Imports (z.B. innerhalb von packages/) werden
    // weiterhin via Default-Resolver aufgelöst und gebündelt.
    build.onResolve({ filter: /^\.\// }, (args) => {
      if (args.importer && /\/electron-app\/[^/]+\.mjs$/.test(args.importer)) {
        return { path: args.path, external: true };
      }
      return null;
    });
  },
};

await esbuild.build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  external: [
    "electron",
    "electron-reload",
    "better-sqlite3",
  ],
  plugins: [electronAppRelativeExternalsPlugin],
});

console.log(`[esbuild] OK: ${outfile} (+ sourcemap)`);
