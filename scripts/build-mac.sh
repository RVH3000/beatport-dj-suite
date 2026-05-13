#!/bin/bash
# build-mac.sh — Wrapper um electron-builder mit esbuild-Pre-Build.
#
# Ablauf:
#   1. npm run prebuild    -> tsc (engine-db-core) + esbuild (main.bundle.mjs)
#   2. electron-builder    -> packt das Bundle in DMG + ZIP
#
# Hintergrund: Workspace-Symlinks unter node_modules/@bpdjs/ wuerden vom
# electron-builder nicht ins asar-Bundle gepackt. esbuild bundelt main.mjs
# zusammen mit allen @bpdjs/*-Imports in eine einzige Datei
# (electron-app/main.bundle.mjs), die ueber build.extraMetadata.main als
# Entry-Point des packaged App-Bundles dient. Der Dev-Modus (npm run
# desktop:dev) nutzt weiterhin Root-main = electron-app/main.mjs ohne Bundle.
#
# Ersetzt den frueheren Symlink-Deref-Workaround (v4.2.15 - v4.2.17). Die
# Workspace-Symlinks unter node_modules/@bpdjs/ bleiben jetzt unangetastet.
set -e
cd "$(dirname "$0")/.."

echo "[build-mac] Pre-Build: tsc (engine-db-core) + esbuild (main bundle)..."
npm run prebuild

echo "[build-mac] electron-builder laeuft..."
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg zip
echo "[build-mac] Build erfolgreich."
