#!/bin/bash
# build-mac.sh — Wrapper um electron-builder, der die @bpdjs/*-Workspace-Symlinks
# vor dem Build durch echte Kopien ersetzt und danach wieder Symlinks herstellt.
#
# Hintergrund: electron-builder packt Symlinks zu Verzeichnissen ausserhalb
# von node_modules/<name>/ nicht ins asar-Bundle. Workspace-Symlinks
# (node_modules/@bpdjs/X -> ../../packages/X) werden daher übersprungen,
# und die gebaute App findet '@bpdjs/core' beim Start nicht.
set -e
cd "$(dirname "$0")/.."

BPDJS_DIR="node_modules/@bpdjs"

echo "[build-mac] Dereferenziere @bpdjs/* Symlinks..."
DEREF_COUNT=0
for link in "$BPDJS_DIR"/*; do
  [ -e "$link" ] || continue
  if [ -L "$link" ]; then
    target=$(readlink -f "$link")
    name=$(basename "$link")
    rm "$link"
    cp -RL "$target" "$BPDJS_DIR/$name"
    DEREF_COUNT=$((DEREF_COUNT + 1))
  fi
done
echo "[build-mac] $DEREF_COUNT Symlinks dereferenziert."

# Restore-Trap: auch bei Build-Fehler zurück zu Symlinks
trap 'echo "[build-mac] Stelle Symlinks wieder her..."; rm -rf "$BPDJS_DIR"/*; npm install --no-audit --no-fund --prefer-offline --silent >/dev/null 2>&1 || npm install --no-audit --no-fund --silent; echo "[build-mac] Symlinks wiederhergestellt."' EXIT

echo "[build-mac] electron-builder läuft..."
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg zip
echo "[build-mac] Build erfolgreich."
