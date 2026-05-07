import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEATPORT_API_BASE,
  BEATPORT_PER_PAGE,
  BEATPORT_TRACKS_PER_PAGE,
  BEATPORT_DEFAULT_CONCURRENCY,
  BEATPORT_REQUEST_DELAY_MS,
  BEATPORT_MAX_RETRIES,
  BEATPORT_RETRY_DELAY_MS,
  BEATPORT_USER_DATA_PATHS
} from "../src/constants.mjs";

test("API_BASE zeigt auf v4-Endpoint", () => {
  assert.equal(BEATPORT_API_BASE, "https://api.beatport.com/v4");
});

test("Pagination-Konstanten haben sinnvolle Werte", () => {
  assert.equal(BEATPORT_PER_PAGE, 100);
  assert.equal(BEATPORT_TRACKS_PER_PAGE, 100);
});

test("Concurrency + Delay + Retries sind gesetzt", () => {
  assert.equal(BEATPORT_DEFAULT_CONCURRENCY, 3);
  assert.equal(BEATPORT_REQUEST_DELAY_MS, 200);
  assert.equal(BEATPORT_MAX_RETRIES, 3);
  assert.equal(BEATPORT_RETRY_DELAY_MS, 2000);
});

test("USER_DATA_PATHS ist nicht leer und frozen", () => {
  assert.ok(BEATPORT_USER_DATA_PATHS.length >= 1);
  assert.ok(Object.isFrozen(BEATPORT_USER_DATA_PATHS));
});
