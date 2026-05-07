import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Logger, createLogger } from "../src/logger.mjs";

function captureConsole(method, fn) {
  const captured = [];
  const original = console[method];
  console[method] = (line) => captured.push(line);
  try { fn(); } finally { console[method] = original; }
  return captured;
}

test("Logger: respektiert Level (info filtert debug aus)", () => {
  const log = new Logger({ level: "info" });
  const debugLines = captureConsole("debug", () => log.debug("nope"));
  const infoLines = captureConsole("info", () => log.info("yes"));
  assert.equal(debugLines.length, 0);
  assert.equal(infoLines.length, 1);
  assert.match(infoLines[0], /INFO/);
  assert.match(infoLines[0], /yes/);
});

test("Logger: tag erzeugt Sub-Logger mit Tag im Output", () => {
  const log = new Logger({ level: "info" });
  const tagged = log.tag("scanner");
  const lines = captureConsole("info", () => tagged.info("hello"));
  assert.match(lines[0], /\[scanner\]/);
});

test("Logger: setLevel ändert Level zur Laufzeit", () => {
  const log = new Logger({ level: "error" });
  let lines = captureConsole("warn", () => log.warn("low"));
  assert.equal(lines.length, 0);
  log.setLevel("warn");
  lines = captureConsole("warn", () => log.warn("now"));
  assert.equal(lines.length, 1);
});

test("Logger: setLevel wirft bei unbekanntem Level", () => {
  const log = new Logger();
  assert.throws(() => log.setLevel("loud"), /Unknown log level/);
});

test("Logger: addFileSink schreibt in Datei", () => {
  const tmp = path.join(os.tmpdir(), `bpdjs-log-${Date.now()}.log`);
  const log = createLogger({ level: "info" }).addFileSink(tmp);
  captureConsole("info", () => log.info("disk-test"));
  // sync flush via stream end
  return new Promise((resolve) => {
    setTimeout(() => {
      const content = fs.readFileSync(tmp, "utf8");
      assert.match(content, /disk-test/);
      fs.unlinkSync(tmp);
      resolve();
    }, 50);
  });
});

test("Logger: silent unterdrückt alle Levels", () => {
  const log = new Logger({ level: "silent" });
  const lines = captureConsole("error", () => log.error("hidden"));
  assert.equal(lines.length, 0);
});
