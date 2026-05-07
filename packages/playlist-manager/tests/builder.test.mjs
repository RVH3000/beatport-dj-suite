import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMixOrder, suggestNextTracks } from "../src/builder.mjs";

function pl(tracks) {
  return { tracks };
}

test("validateMixOrder: leere Playlist ist ok", () => {
  const r = validateMixOrder(pl([]));
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 0);
});

test("validateMixOrder: harmonisch korrekte Reihenfolge", () => {
  const r = validateMixOrder(pl([
    { id: "a", camelot: "8A", bpm: 120 },
    { id: "b", camelot: "9A", bpm: 122 },
    { id: "c", camelot: "9B", bpm: 124 }
  ]));
  assert.equal(r.ok, true);
});

test("validateMixOrder: inkompatible Tonarten erzeugen Warning", () => {
  const r = validateMixOrder(pl([
    { id: "a", camelot: "8A", bpm: 120 },
    { id: "b", camelot: "3B", bpm: 120 }
  ]));
  assert.equal(r.ok, false);
  assert.equal(r.warnings[0].reason, "key-incompatible");
  assert.equal(r.warnings[0].fromCamelot, "8A");
});

test("validateMixOrder: BPM-Sprung über Schwelle wird gemeldet", () => {
  const r = validateMixOrder(pl([
    { id: "a", camelot: "8A", bpm: 120 },
    { id: "b", camelot: "8A", bpm: 140 }
  ]));
  const bpmWarning = r.warnings.find((w) => w.reason === "bpm-jump");
  assert.ok(bpmWarning);
  assert.equal(bpmWarning.fromBpm, 120);
  assert.equal(bpmWarning.toBpm, 140);
});

test("validateMixOrder: Tracks ohne Camelot werden übersprungen", () => {
  const r = validateMixOrder(pl([
    { id: "a", bpm: 120 },
    { id: "b", camelot: "8A", bpm: 120 },
    { id: "c", bpm: 120 }
  ]));
  assert.equal(r.ok, true);
});

test("suggestNextTracks: liefert harmonische Kandidaten sortiert", () => {
  const cur = { id: "x", camelot: "8A", bpm: 120 };
  const cands = [
    { id: "match-1", camelot: "8A", bpm: 122 },   // identisch → top
    { id: "match-2", camelot: "9A", bpm: 121 },   // ±1
    { id: "match-3", camelot: "8B", bpm: 121 },   // innen↔außen
    { id: "far", camelot: "3B", bpm: 121 }        // weit weg → ausgeschlossen
  ];
  const result = suggestNextTracks(cur, cands);
  assert.equal(result.length, 3);
  assert.equal(result[0].track.id, "match-1");
  assert.equal(result.find((r) => r.track.id === "far"), undefined);
});

test("suggestNextTracks: bestraft große BPM-Abweichungen", () => {
  const cur = { id: "x", camelot: "8A", bpm: 120 };
  const cands = [
    { id: "near-bpm", camelot: "9A", bpm: 121 },
    { id: "far-bpm", camelot: "9A", bpm: 145 }
  ];
  const result = suggestNextTracks(cur, cands);
  assert.equal(result[0].track.id, "near-bpm");
  assert.ok(result[0].score < result[1].score);
});

test("suggestNextTracks: Track ohne Camelot wird ignoriert", () => {
  const cur = { id: "x", camelot: "8A", bpm: 120 };
  const cands = [{ id: "no-key", bpm: 120 }];
  assert.equal(suggestNextTracks(cur, cands).length, 0);
});

test("suggestNextTracks: ohne currentTrack-Camelot leere Liste", () => {
  assert.deepEqual(suggestNextTracks({ id: "x" }, [{ id: "y", camelot: "8A" }]), []);
});

test("suggestNextTracks: limit begrenzt Ergebnis", () => {
  const cur = { id: "x", camelot: "8A" };
  const cands = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, camelot: "8A" }));
  assert.equal(suggestNextTracks(cur, cands, { limit: 5 }).length, 5);
});

test("suggestNextTracks: schließt currentTrack selbst aus", () => {
  const cur = { id: "self", camelot: "8A" };
  const cands = [{ id: "self", camelot: "8A" }, { id: "other", camelot: "8A" }];
  const result = suggestNextTracks(cur, cands);
  assert.equal(result.length, 1);
  assert.equal(result[0].track.id, "other");
});
