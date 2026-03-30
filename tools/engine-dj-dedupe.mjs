#!/usr/bin/env node
/**
 * engine-dj-dedupe.mjs — Engine DJ Playlist Deduplizierung
 *
 * Findet doppelte Playlisten (gleicher Name) und behält nur die
 * Version mit den meisten Tracks. Erstellt IMMER ein Backup vorher.
 *
 * Verwendung:
 *   node tools/engine-dj-dedupe.mjs                  # Dry-Run (nur Report)
 *   node tools/engine-dj-dedupe.mjs --execute        # Tatsächlich löschen
 *   node tools/engine-dj-dedupe.mjs --csv            # Report als CSV
 *   node tools/engine-dj-dedupe.mjs --db /pfad/m.db  # Andere DB
 */

import Database from "better-sqlite3";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ── CLI Args ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const csvMode = args.includes("--csv");
const dbIdx = args.indexOf("--db");
const customDb = dbIdx >= 0 ? args[dbIdx + 1] : null;

const DEFAULT_DB = join(homedir(), "Music", "Engine Library", "Database2", "m.db");
const dbPath = customDb || DEFAULT_DB;

// ── ANSI ─────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m",
};
const color = process.stdout.isTTY;
const c = (code, text) => color ? code + text + C.reset : text;

// ── Backup ───────────────────────────────────────────────────────

function createBackup(dbPath) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(dirname(dbPath), "backups");
  mkdirSync(dir, { recursive: true });
  const backupPath = join(dir, `m.db.pre-dedupe-${ts}`);
  copyFileSync(dbPath, backupPath);

  // Auch WAL und SHM sichern falls vorhanden
  if (existsSync(dbPath + "-wal")) copyFileSync(dbPath + "-wal", backupPath + "-wal");
  if (existsSync(dbPath + "-shm")) copyFileSync(dbPath + "-shm", backupPath + "-shm");

  return backupPath;
}

// ── Analyse ──────────────────────────────────────────────────────

function analyzeDuplicates(db) {
  const playlists = db.prepare(`
    SELECT p.id, p.title, p.parentListId, p.isPersisted,
           (SELECT COUNT(*) FROM PlaylistEntity pe WHERE pe.listId = p.id) as trackCount
    FROM Playlist p
    WHERE p.isPersisted = 1
    ORDER BY p.title, p.id
  `).all();

  // Gruppiere nach Name + parentListId (gleicher Ordner)
  const groups = new Map();
  for (const p of playlists) {
    const key = p.title;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const duplicates = [];
  let totalKeep = 0;
  let totalRemove = 0;
  let totalWasteEntries = 0;

  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;

    // Behalte die mit den meisten Tracks (bei Gleichstand: niedrigste ID = älteste)
    const sorted = [...entries].sort((a, b) => b.trackCount - a.trackCount || a.id - b.id);
    const keep = sorted[0];
    const remove = sorted.slice(1);
    const wasteEntries = remove.reduce((sum, p) => sum + p.trackCount, 0);

    totalKeep++;
    totalRemove += remove.length;
    totalWasteEntries += wasteEntries;

    duplicates.push({ name: entries[0].title, parentListId: entries[0].parentListId, keep, remove, wasteEntries });
  }

  return { duplicates, totalKeep, totalRemove, totalWasteEntries, totalPlaylists: playlists.length };
}

// ── Löschung ─────────────────────────────────────────────────────

function executeDedupe(db, duplicates) {
  const removeIds = duplicates.flatMap(d => d.remove.map(r => r.id));
  if (!removeIds.length) return { deleted: 0, entriesRemoved: 0 };

  const deleteEntries = db.prepare("DELETE FROM PlaylistEntity WHERE listId = ?");
  const deletePlaylist = db.prepare("DELETE FROM Playlist WHERE id = ?");

  let entriesRemoved = 0;

  const tx = db.transaction(() => {
    for (const id of removeIds) {
      const info = deleteEntries.run(id);
      entriesRemoved += info.changes;
      deletePlaylist.run(id);
    }
  });
  tx();

  return { deleted: removeIds.length, entriesRemoved };
}

// ── CSV Export ───────────────────────────────────────────────────

function exportCsv(duplicates, outputPath) {
  const header = "Aktion,Playlist Name,ID,Tracks,Parent ID";
  const rows = [];
  for (const d of duplicates) {
    rows.push(`BEHALTEN,"${d.name.replace(/"/g, '""')}",${d.keep.id},${d.keep.trackCount},${d.keep.parentListId || 0}`);
    for (const r of d.remove) {
      rows.push(`LOESCHEN,"${d.name.replace(/"/g, '""')}",${r.id},${r.trackCount},${r.parentListId || 0}`);
    }
  }
  writeFileSync(outputPath, [header, ...rows].join("\n"), "utf-8");
  return outputPath;
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  console.log(c(C.bold, "\n═══ Engine DJ Playlist Deduplizierung ═══\n"));

  if (!existsSync(dbPath)) {
    console.error(c(C.red, "Datenbank nicht gefunden: " + dbPath));
    process.exit(1);
  }

  console.log(c(C.cyan, "DB: ") + dbPath);
  console.log(c(C.cyan, "Modus: ") + (execute ? c(C.red, "EXECUTE (Löschen!)") : c(C.green, "DRY-RUN (nur Report)")));
  console.log("");

  // Backup IMMER erstellen
  const backupPath = createBackup(dbPath);
  console.log(c(C.green, "✓ Backup: ") + backupPath);
  console.log("");

  const db = new Database(dbPath, { readonly: !execute });

  // Analyse
  const result = analyzeDuplicates(db);
  const { duplicates, totalKeep, totalRemove, totalWasteEntries, totalPlaylists } = result;

  console.log(c(C.bold, "── Analyse ──────────────────────────────"));
  console.log(`  Playlists gesamt:        ${c(C.bold, String(totalPlaylists))}`);
  console.log(`  Doppelte Gruppen:        ${c(C.yellow, String(duplicates.length))}`);
  console.log(`  Zu löschende Playlists:  ${c(C.red, String(totalRemove))}`);
  console.log(`  Überflüssige Entries:    ${c(C.red, "~" + totalWasteEntries)}`);
  console.log(`  Playlists nach Cleanup:  ${c(C.green, String(totalPlaylists - totalRemove))}`);
  console.log("");

  if (!duplicates.length) {
    console.log(c(C.green, "✓ Keine Duplikate gefunden. DB ist sauber."));
    db.close();
    return;
  }

  // Top 30 anzeigen
  console.log(c(C.bold, "── Top Duplikate ────────────────────────"));
  duplicates.sort((a, b) => b.remove.length - a.remove.length);
  duplicates.slice(0, 30).forEach((d) => {
    const keepInfo = `ID${d.keep.id}(${d.keep.trackCount} Tracks)`;
    const removeInfo = d.remove.map(r => `ID${r.id}(${r.trackCount})`).join(", ");
    console.log(`  ${c(C.yellow, "[" + (d.remove.length + 1) + "x]")} ${d.name.slice(0, 50)}`);
    console.log(`    ${c(C.green, "✓ KEEP:")} ${keepInfo}`);
    console.log(`    ${c(C.red, "✗ DEL: ")} ${removeInfo}`);
  });

  if (duplicates.length > 30) {
    console.log(c(C.dim, `  ... +${duplicates.length - 30} weitere Gruppen`));
  }
  console.log("");

  // CSV Export
  if (csvMode) {
    const csvPath = join(dirname(dbPath), "dedupe-report.csv");
    exportCsv(duplicates, csvPath);
    console.log(c(C.green, "✓ CSV Report: ") + csvPath);
    console.log("");
  }

  // Execute
  if (execute) {
    console.log(c(C.bold + C.red, "── LÖSCHUNG WIRD AUSGEFÜHRT ────────────"));
    const { deleted, entriesRemoved } = executeDedupe(db, duplicates);
    console.log(c(C.green, `✓ ${deleted} Playlists gelöscht`));
    console.log(c(C.green, `✓ ${entriesRemoved} Playlist-Entries entfernt`));

    // Verify
    const after = analyzeDuplicates(db);
    console.log("");
    console.log(c(C.bold, "── Verifizierung ───────────────────────"));
    console.log(`  Playlists jetzt:       ${after.totalPlaylists}`);
    console.log(`  Verbleibende Dupes:    ${after.duplicates.length}`);
    if (after.duplicates.length === 0) {
      console.log(c(C.green, "  ✓ SAUBER — keine Duplikate mehr!"));
    }
  } else {
    console.log(c(C.yellow, "ℹ  Dry-Run — nichts gelöscht."));
    console.log(c(C.dim, "   Zum Löschen: node tools/engine-dj-dedupe.mjs --execute"));
  }

  console.log("");
  db.close();
}

main();
