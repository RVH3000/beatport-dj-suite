import { test } from "node:test";
import assert from "node:assert/strict";
import { EventBus, createEventBus, eventBus } from "../src/eventbus.mjs";

test("EventBus: on/emit liefert Payload an Listener", () => {
  const bus = new EventBus();
  let received = null;
  bus.on("ping", (payload) => { received = payload; });
  bus.emit("ping", { ok: true });
  assert.deepEqual(received, { ok: true });
});

test("EventBus: on() gibt Unsubscribe-Funktion zurück", () => {
  const bus = new EventBus();
  let count = 0;
  const unsub = bus.on("tick", () => { count++; });
  bus.emit("tick");
  unsub();
  bus.emit("tick");
  assert.equal(count, 1);
});

test("EventBus: once feuert nur einmal", () => {
  const bus = new EventBus();
  let count = 0;
  bus.once("hello", () => { count++; });
  bus.emit("hello");
  bus.emit("hello");
  bus.emit("hello");
  assert.equal(count, 1);
});

test("EventBus: off entfernt Listener gezielt", () => {
  const bus = new EventBus();
  let a = 0, b = 0;
  const fnA = () => { a++; };
  const fnB = () => { b++; };
  bus.on("e", fnA);
  bus.on("e", fnB);
  bus.off("e", fnA);
  bus.emit("e");
  assert.equal(a, 0);
  assert.equal(b, 1);
});

test("EventBus: clear(event) entfernt alle Listener für ein Event", () => {
  const bus = new EventBus();
  let count = 0;
  bus.on("x", () => count++);
  bus.on("x", () => count++);
  bus.clear("x");
  bus.emit("x");
  assert.equal(count, 0);
});

test("EventBus: clear() ohne Argument leert alles", () => {
  const bus = new EventBus();
  let count = 0;
  bus.on("a", () => count++);
  bus.on("b", () => count++);
  bus.clear();
  bus.emit("a");
  bus.emit("b");
  assert.equal(count, 0);
});

test("EventBus: listenerCount liefert korrekte Anzahl", () => {
  const bus = new EventBus();
  bus.on("z", () => {});
  bus.on("z", () => {});
  assert.equal(bus.listenerCount("z"), 2);
});

test("createEventBus: liefert eigenständige Instanz (kein Shared State)", () => {
  const a = createEventBus();
  const b = createEventBus();
  let aHits = 0;
  a.on("ping", () => aHits++);
  b.emit("ping");
  assert.equal(aHits, 0);
});

test("eventBus: Default-Singleton ist EventBus-Instanz", () => {
  assert.ok(eventBus instanceof EventBus);
});
