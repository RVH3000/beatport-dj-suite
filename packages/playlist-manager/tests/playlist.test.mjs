import { test } from "node:test";
import assert from "node:assert/strict";
import { Playlist, createPlaylist, normalizeTrack, PLAYLIST_CHANGED } from "../src/playlist.mjs";
import { createEventBus } from "@bpdjs/core";

function tk(id, extra = {}) {
  return { id, title: `Track ${id}`, ...extra };
}

test("normalizeTrack: setzt Defaults und derived camelot", () => {
  const t = normalizeTrack({ id: "x", key: "Am" });
  assert.equal(t.id, "x");
  assert.equal(t.camelot, "8A");
  assert.deepEqual(t.artists, []);
  assert.equal(t.bpm, null);
});

test("normalizeTrack: behält explizites camelot über key", () => {
  const t = normalizeTrack({ id: "x", key: "Am", camelot: "12B" });
  assert.equal(t.camelot, "12B");
});

test("normalizeTrack: wirft AppError bei fehlender id", () => {
  assert.throws(() => normalizeTrack({ title: "x" }), /Track\.id/);
});

test("Playlist: wirft ohne id", () => {
  assert.throws(() => new Playlist({}), /Playlist\.id/);
});

test("Playlist: addTrack hängt am Ende an", () => {
  const p = createPlaylist({ id: "pl", eventBus: createEventBus() });
  p.addTrack(tk("a"));
  p.addTrack(tk("b"));
  assert.equal(p.length, 2);
  assert.equal(p.trackAt(0).id, "a");
  assert.equal(p.trackAt(1).id, "b");
});

test("Playlist: addTrack mit at fügt an Position ein", () => {
  const p = createPlaylist({ id: "pl", eventBus: createEventBus() });
  p.addTrack(tk("a"));
  p.addTrack(tk("c"));
  p.addTrack(tk("b"), { at: 1 });
  assert.deepEqual(p.tracks.map((t) => t.id), ["a", "b", "c"]);
});

test("Playlist: removeTrack entfernt und meldet true/false", () => {
  const p = createPlaylist({ id: "pl", eventBus: createEventBus() });
  p.addTrack(tk("a"));
  p.addTrack(tk("b"));
  assert.equal(p.removeTrack("a"), true);
  assert.equal(p.length, 1);
  assert.equal(p.removeTrack("missing"), false);
});

test("Playlist: moveTrack verschiebt", () => {
  const p = createPlaylist({ id: "pl", eventBus: createEventBus() });
  p.addTrack(tk("a"));
  p.addTrack(tk("b"));
  p.addTrack(tk("c"));
  p.moveTrack("a", 2);
  assert.deepEqual(p.tracks.map((t) => t.id), ["b", "c", "a"]);
});

test("Playlist: rename + Events", () => {
  const bus = createEventBus();
  const events = [];
  bus.on(PLAYLIST_CHANGED, (e) => events.push(e));
  const p = createPlaylist({ id: "pl", eventBus: bus });
  p.rename("Sommer 2026");
  p.addTrack(tk("a"));
  p.removeTrack("a");
  assert.equal(p.name, "Sommer 2026");
  assert.equal(events[0].action, "rename");
  assert.equal(events[1].action, "add");
  assert.equal(events[2].action, "remove");
});

test("Playlist: tracks-Getter liefert Kopie (kein Original-Mutate)", () => {
  const p = createPlaylist({ id: "pl", eventBus: createEventBus() });
  p.addTrack(tk("a"));
  const tracks = p.tracks;
  tracks[0].id = "evil";
  assert.equal(p.trackAt(0).id, "a");
});

test("Playlist: toJSON liefert serialisierbares Objekt", () => {
  const p = createPlaylist({ id: "pl", name: "Test", eventBus: createEventBus() });
  p.addTrack(tk("a", { bpm: 120 }));
  const json = p.toJSON();
  assert.equal(json.id, "pl");
  assert.equal(json.name, "Test");
  assert.equal(json.tracks.length, 1);
  // serialisierbar?
  JSON.stringify(json);
});

test("Playlist: findTrack liefert Kopie oder null", () => {
  const p = createPlaylist({ id: "pl", eventBus: createEventBus() });
  p.addTrack(tk("a"));
  assert.equal(p.findTrack("a").id, "a");
  assert.equal(p.findTrack("missing"), null);
});
