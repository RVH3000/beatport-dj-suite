import { test } from "node:test";
import assert from "node:assert/strict";
import { sendProgress, createProgressSender, bridgeEventToIpc } from "../src/progress.mjs";
import { createEventBus } from "@bpdjs/core";

function captureSender() {
  const log = [];
  return {
    log,
    eventLike: { sender: { send: (ch, p) => log.push({ via: "sender", ch, p }) } },
    windowLike: { webContents: { send: (ch, p) => log.push({ via: "webContents", ch, p }) } },
    plain: { send: (ch, p) => log.push({ via: "plain", ch, p }) }
  };
}

test("sendProgress: schickt über event.sender", () => {
  const cap = captureSender();
  const ok = sendProgress(cap.eventLike, "ch", { x: 1 });
  assert.equal(ok, true);
  assert.deepEqual(cap.log[0], { via: "sender", ch: "ch", p: { x: 1 } });
});

test("sendProgress: schickt über window.webContents", () => {
  const cap = captureSender();
  const ok = sendProgress(cap.windowLike, "ch", { y: 2 });
  assert.equal(ok, true);
  assert.deepEqual(cap.log[0], { via: "webContents", ch: "ch", p: { y: 2 } });
});

test("sendProgress: fällt auf target.send zurück", () => {
  const cap = captureSender();
  const ok = sendProgress(cap.plain, "ch", "hi");
  assert.equal(ok, true);
  assert.deepEqual(cap.log[0], { via: "plain", ch: "ch", p: "hi" });
});

test("sendProgress: gibt false bei null/ungeeignetem target", () => {
  assert.equal(sendProgress(null, "x"), false);
  assert.equal(sendProgress({}, "x"), false);
});

test("createProgressSender: Pre-binds target", () => {
  const cap = captureSender();
  const send = createProgressSender(cap.eventLike);
  send("a", 1);
  send("b", 2);
  assert.equal(cap.log.length, 2);
  assert.equal(cap.log[0].ch, "a");
  assert.equal(cap.log[1].ch, "b");
});

test("bridgeEventToIpc: leitet EventBus-Event als IPC weiter", () => {
  const cap = captureSender();
  const bus = createEventBus();
  const unsub = bridgeEventToIpc(bus, "settings:changed", cap.eventLike);
  bus.emit("settings:changed", { key: "ui.theme", value: "dark" });
  assert.deepEqual(cap.log[0], {
    via: "sender",
    ch: "settings:changed",
    p: { key: "ui.theme", value: "dark" }
  });
  unsub();
  bus.emit("settings:changed", { key: "x", value: "y" });
  assert.equal(cap.log.length, 1, "Nach unsub kein weiterer Send");
});

test("bridgeEventToIpc: erlaubt eigenen Channel-Namen", () => {
  const cap = captureSender();
  const bus = createEventBus();
  bridgeEventToIpc(bus, "internal:foo", cap.eventLike, "ipc:foo");
  bus.emit("internal:foo", { a: 1 });
  assert.equal(cap.log[0].ch, "ipc:foo");
});
