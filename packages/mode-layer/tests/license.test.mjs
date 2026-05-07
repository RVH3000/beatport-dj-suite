import { test } from "node:test";
import assert from "node:assert/strict";
import { LicenseStub, createLicense, LICENSE_TYPE_FREE, LICENSE_TYPE_PRO } from "../src/license.mjs";

test("Default-Lizenz ist FREE", () => {
  const lic = createLicense();
  assert.equal(lic.type, LICENSE_TYPE_FREE);
  assert.equal(lic.isFree(), true);
  assert.equal(lic.isPro(), false);
});

test("Explizit PRO erstellen", () => {
  const lic = createLicense({ type: LICENSE_TYPE_PRO });
  assert.equal(lic.isPro(), true);
  assert.equal(lic.isFree(), false);
});

test("hasFeature im Stub immer true", () => {
  const lic = createLicense();
  assert.equal(lic.hasFeature("anything"), true);
  assert.equal(lic.hasFeature("scanner.advanced"), true);
});

test("toJSON liefert Stub-Marker", () => {
  const lic = createLicense({ type: LICENSE_TYPE_PRO });
  const json = lic.toJSON();
  assert.equal(json.type, LICENSE_TYPE_PRO);
  assert.equal(json.valid, true);
  assert.equal(json.mode, "stub");
});

test("createLicense liefert LicenseStub-Instanz", () => {
  assert.ok(createLicense() instanceof LicenseStub);
});
