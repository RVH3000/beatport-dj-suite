import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_SQLITE_BIN,
  SqliteUnavailableError,
  querySelect,
  querySelectOne,
  listTables
} from "../src/sqlite-cli.mjs";

const SQLITE_AVAILABLE = existsSync(DEFAULT_SQLITE_BIN);

function tmpDb() {
  return path.join(os.tmpdir(), `bpdjs-edb-cli-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function createTestDb(file) {
  // Sehr simples Schema: 1 Tabelle mit 3 Zeilen, via sqlite3 CLI angelegt
  const schema = `
    CREATE TABLE tracks (id INTEGER PRIMARY KEY, name TEXT, bpm INTEGER);
    INSERT INTO tracks VALUES (1, 'Track A', 120);
    INSERT INTO tracks VALUES (2, 'Track B', 128);
    INSERT INTO tracks VALUES (3, 'Track C', 140);
  `;
  spawnSync(DEFAULT_SQLITE_BIN, [file], { input: schema, encoding: "utf8" });
}

test("SqliteUnavailableError wenn binPath nicht existiert", async () => {
  await assert.rejects(
    () => querySelect("/anywhere.db", "SELECT 1", { binPath: "/nonexistent/sqlite3" }),
    SqliteUnavailableError
  );
});

test("querySelect wirft bei leerem SQL", async () => {
  await assert.rejects(() => querySelect("/some.db", "", { binPath: DEFAULT_SQLITE_BIN }), /sql erforderlich/);
});

test("querySelect wirft ohne dbPath", async () => {
  await assert.rejects(() => querySelect("", "SELECT 1", { binPath: DEFAULT_SQLITE_BIN }), /dbPath erforderlich/);
});

test("querySelect liefert Rows aus echter SQLite-DB", { skip: !SQLITE_AVAILABLE }, async () => {
  const db = tmpDb();
  createTestDb(db);
  try {
    const rows = await querySelect(db, "SELECT id, name, bpm FROM tracks ORDER BY id");
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], { id: 1, name: "Track A", bpm: 120 });
    assert.deepEqual(rows[2], { id: 3, name: "Track C", bpm: 140 });
  } finally {
    await fs.unlink(db).catch(() => {});
  }
});

test("querySelectOne liefert erste Zeile oder null", { skip: !SQLITE_AVAILABLE }, async () => {
  const db = tmpDb();
  createTestDb(db);
  try {
    const row = await querySelectOne(db, "SELECT id, name FROM tracks WHERE bpm = 128");
    assert.deepEqual(row, { id: 2, name: "Track B" });
    const none = await querySelectOne(db, "SELECT * FROM tracks WHERE bpm = 999");
    assert.equal(none, null);
  } finally {
    await fs.unlink(db).catch(() => {});
  }
});

test("listTables findet erstellte Tabelle", { skip: !SQLITE_AVAILABLE }, async () => {
  const db = tmpDb();
  createTestDb(db);
  try {
    const tables = await listTables(db);
    assert.ok(tables.includes("tracks"));
  } finally {
    await fs.unlink(db).catch(() => {});
  }
});

test("query_only mode verhindert INSERT/UPDATE", { skip: !SQLITE_AVAILABLE }, async () => {
  // Read-only-Schutz: Ein versehentliches INSERT im SQL-String muss abgewiesen werden
  const db = tmpDb();
  createTestDb(db);
  try {
    await assert.rejects(
      () => querySelect(db, "INSERT INTO tracks VALUES (99, 'evil', 0)"),
      /readonly|read-only|query_only|attempt to write/i
    );
  } finally {
    await fs.unlink(db).catch(() => {});
  }
});
