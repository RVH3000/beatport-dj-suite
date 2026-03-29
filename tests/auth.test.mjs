/**
 * auth.test.mjs
 * Tests für das session-probe Modul mit Node.js native test runner
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  detectBeatportSessionState,
  DJ_HOME_URL,
  SESSION_PARTITION,
  buildSessionProbeExpression,
  buildPrepareLoginExpression,
} from "../electron-app/auth/session-probe.mjs";

// ─── detectBeatportSessionState Tests ────────────────────────────────────────

test("detectBeatportSessionState: Erkennt forgot-password Seite als invalid", () => {
  const snapshot = {
    host: "account.beatport.com",
    pathname: "/forgot-password",
    hasPasswordField: false,
    hasUsernameField: false,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

test("detectBeatportSessionState: Erkennt account.beatport.com ohne Felder als unknown", () => {
  const snapshot = {
    host: "account.beatport.com",
    pathname: "/account",
    hasPasswordField: false,
    hasUsernameField: false,
    hasLoginTrigger: false,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "unknown");
});

test("detectBeatportSessionState: Erkennt dj.beatport.com mit userId als valid", () => {
  const snapshot = {
    host: "dj.beatport.com",
    pathname: "/home",
    bpUserId: 12345,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "valid");
});

test("detectBeatportSessionState: Erkennt dj.beatport.com mit hasPlaylistUi als valid", () => {
  const snapshot = {
    host: "dj.beatport.com",
    pathname: "/playlists",
    hasPlaylistUi: true,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "valid");
});

test("detectBeatportSessionState: Erkennt dj.beatport.com mit hasMyLibraryText als valid", () => {
  const snapshot = {
    host: "dj.beatport.com",
    pathname: "/home",
    hasMyLibraryText: true,
    bodyText: "My Library",
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "valid");
});

test("detectBeatportSessionState: Erkennt dj.beatport.com mit Login-Trigger als invalid", () => {
  const snapshot = {
    host: "dj.beatport.com",
    pathname: "/home",
    hasLoginTrigger: true,
    bodyText: "log in",
    bpUserId: null,
    hasPlaylistUi: false,
    hasMyLibraryText: false,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

test("detectBeatportSessionState: Erkennt dj.beatport.com mit 'sign up' als Login-Trigger", () => {
  const snapshot = {
    host: "dj.beatport.com",
    pathname: "/home",
    hasLoginTrigger: true,
    bodyText: "sign up",
    bpUserId: null,
    hasPlaylistUi: false,
    hasMyLibraryText: false,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

test("detectBeatportSessionState: Erkennt fremde Domain mit Password-Feld als invalid", () => {
  const snapshot = {
    host: "example.com",
    pathname: "/login",
    hasPasswordField: true,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

test("detectBeatportSessionState: Erkennt fremde Domain mit Username-Feld als invalid", () => {
  const snapshot = {
    host: "example.com",
    pathname: "/login",
    hasUsernameField: true,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

test("detectBeatportSessionState: Erkennt fremde Domain ohne Login-Marker als unknown", () => {
  const snapshot = {
    host: "example.com",
    pathname: "/home",
    hasPasswordField: false,
    hasUsernameField: false,
    hasLoginTrigger: false,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "unknown");
});

test("detectBeatportSessionState: Leeres Snapshot-Objekt gibt unknown zurück", () => {
  const result = detectBeatportSessionState({});
  assert.strictEqual(result, "unknown");
});

test("detectBeatportSessionState: Leeres Snapshot-Objekt (undefined) gibt unknown zurück", () => {
  const result = detectBeatportSessionState(undefined);
  assert.strictEqual(result, "unknown");
});

test("detectBeatportSessionState: account.beatport.com mit Password-Feld als invalid", () => {
  const snapshot = {
    host: "account.beatport.com",
    pathname: "/signin",
    hasPasswordField: true,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

test("detectBeatportSessionState: account.beatport.com mit Username-Feld als invalid", () => {
  const snapshot = {
    host: "account.beatport.com",
    pathname: "/signin",
    hasUsernameField: true,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

test("detectBeatportSessionState: Case-insensitive Host-Matching", () => {
  const snapshot1 = {
    host: "DJ.BEATPORT.COM",
    pathname: "/home",
    bpUserId: 123,
  };

  const snapshot2 = {
    host: "Account.Beatport.Com",
    pathname: "/forgot-password",
  };

  assert.strictEqual(detectBeatportSessionState(snapshot1), "valid");
  assert.strictEqual(detectBeatportSessionState(snapshot2), "invalid");
});

test("detectBeatportSessionState: Whitespace-Handling im Host", () => {
  const snapshot = {
    host: "  dj.beatport.com  ",
    pathname: "/home",
    bpUserId: 456,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "valid");
});

test("detectBeatportSessionState: Beide Login-Marker (Username + Password)", () => {
  const snapshot = {
    host: "example.com",
    pathname: "/auth",
    hasUsernameField: true,
    hasPasswordField: true,
  };

  const result = detectBeatportSessionState(snapshot);
  assert.strictEqual(result, "invalid");
});

// ─── Konstanten Tests ────────────────────────────────────────────────────────

test("Konstanten: DJ_HOME_URL ist korrekt", () => {
  assert.strictEqual(DJ_HOME_URL, "https://dj.beatport.com/home");
});

test("Konstanten: SESSION_PARTITION ist korrekt", () => {
  assert.strictEqual(SESSION_PARTITION, "persist:beatport-auth-v1");
});

// ─── Probe-Expression Tests ─────────────────────────────────────────────────

test("buildSessionProbeExpression: Gibt String zurück", () => {
  const result = buildSessionProbeExpression();
  assert.strictEqual(typeof result, "string");
  assert.ok(result.length > 0);
});

test("buildSessionProbeExpression: Enthält IIFE-Pattern", () => {
  const result = buildSessionProbeExpression();
  assert.ok(result.includes("(() => {"));
  assert.ok(result.includes("})()"));
});

test("buildSessionProbeExpression: Enthält DOM-Selektoren für Password-Feld", () => {
  const result = buildSessionProbeExpression();
  assert.ok(result.includes('input[type="password"]'));
  assert.ok(result.includes('input[name="password"]'));
});

test("buildSessionProbeExpression: Enthält DOM-Selektoren für Username-Feld", () => {
  const result = buildSessionProbeExpression();
  assert.ok(result.includes('input[name="username"]'));
  assert.ok(result.includes('input[type="email"]'));
});

test("buildSessionProbeExpression: Enthält Playlist-UI-Selektoren", () => {
  const result = buildSessionProbeExpression();
  assert.ok(result.includes("my-playlists"));
  assert.ok(result.includes("data-playlist-id"));
});

test("buildSessionProbeExpression: Enthält localStorage/sessionStorage-Zugriff", () => {
  const result = buildSessionProbeExpression();
  assert.ok(result.includes("localStorage.getItem"));
  assert.ok(result.includes("sessionStorage.getItem"));
  assert.ok(result.includes("bp_user"));
});

test("buildSessionProbeExpression: Enthält Fehlerbehandlung für JSON.parse", () => {
  const result = buildSessionProbeExpression();
  assert.ok(result.includes("try"));
  assert.ok(result.includes("catch"));
});

test("buildSessionProbeExpression: Gibt vollständiges Objekt zurück", () => {
  const result = buildSessionProbeExpression();
  assert.ok(result.includes("url: location.href"));
  assert.ok(result.includes("host: location.host"));
  assert.ok(result.includes("pathname: location.pathname"));
  assert.ok(result.includes("title: document.title"));
  assert.ok(result.includes("bodyText"));
  assert.ok(result.includes("hasPasswordField"));
  assert.ok(result.includes("hasUsernameField"));
  assert.ok(result.includes("hasLoginTrigger"));
  assert.ok(result.includes("hasPlaylistUi"));
  assert.ok(result.includes("hasMyLibraryText"));
  assert.ok(result.includes("bpUserId"));
  assert.ok(result.includes("bpUserName"));
});

// ─── Prepare-Login-Expression Tests ─────────────────────────────────────────

test("buildPrepareLoginExpression: Gibt String zurück", () => {
  const result = buildPrepareLoginExpression();
  assert.strictEqual(typeof result, "string");
  assert.ok(result.length > 0);
});

test("buildPrepareLoginExpression: Enthält async IIFE-Pattern", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("(async () => {"));
  assert.ok(result.includes("})()"));
});

test("buildPrepareLoginExpression: Enthält Cookie-Accept-Logik", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("i accept"));
  assert.ok(result.includes("accept all"));
  assert.ok(result.includes("accept"));
});

test("buildPrepareLoginExpression: Enthält Login-Click-Logik", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("log in"));
});

test("buildPrepareLoginExpression: Enthält Sleep/Timeout-Funktion", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("sleep"));
  assert.ok(result.includes("setTimeout"));
});

test("buildPrepareLoginExpression: Enthält account.beatport.com-Check", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("account.beatport.com"));
});

test("buildPrepareLoginExpression: Enthält normalize-Funktion", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("normalize = "));
  assert.ok(result.includes("replace(/\\s+/g, \" \")"));
});

test("buildPrepareLoginExpression: Gibt return-Objekt mit erforderlichen Feldern", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("stage:"));
  assert.ok(result.includes("acceptedCookies"));
  assert.ok(result.includes("url:"));
  assert.ok(result.includes("clickedLogin"));
});

test("buildPrepareLoginExpression: Enthält Regex für Case-insensitive Pattern-Matching", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("/i"));
});

test("buildPrepareLoginExpression: Verwendet document.querySelectorAll", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("document.querySelectorAll"));
});

test("buildPrepareLoginExpression: Enthält location.host-Check", () => {
  const result = buildPrepareLoginExpression();
  assert.ok(result.includes("location.host"));
  assert.ok(result.includes("location.href"));
});

// ─── Integrations Tests ──────────────────────────────────────────────────────

test("detectBeatportSessionState + buildSessionProbeExpression: Zusammenspiel", () => {
  // Der Probe-Ausdruck würde folgende Struktur zurückgeben
  const probeOutput = {
    url: "https://dj.beatport.com/home",
    host: "dj.beatport.com",
    pathname: "/home",
    title: "Beatport DJ",
    bodyText: "My Library Playlists",
    hasPasswordField: false,
    hasUsernameField: false,
    hasLoginTrigger: false,
    hasPlaylistUi: true,
    hasMyLibraryText: true,
    bpUserId: 123456,
    bpUserName: "DJName",
  };

  const state = detectBeatportSessionState(probeOutput);
  assert.strictEqual(state, "valid");
});

test("detectBeatportSessionState: Login-erforderlich-Szenario", () => {
  const snapshot = {
    url: "https://dj.beatport.com/home",
    host: "dj.beatport.com",
    pathname: "/home",
    title: "Beatport DJ - Log In",
    bodyText: "Please log in to continue",
    hasPasswordField: false,
    hasUsernameField: false,
    hasLoginTrigger: true,
    hasPlaylistUi: false,
    hasMyLibraryText: false,
    bpUserId: null,
    bpUserName: "",
  };

  const state = detectBeatportSessionState(snapshot);
  assert.strictEqual(state, "invalid");
});

test("detectBeatportSessionState: Account-Setup-Szenario", () => {
  const snapshot = {
    url: "https://account.beatport.com/setup",
    host: "account.beatport.com",
    pathname: "/setup",
    title: "Setup",
    bodyText: "Enter your details",
    hasPasswordField: true,
    hasUsernameField: false,
    hasLoginTrigger: false,
  };

  const state = detectBeatportSessionState(snapshot);
  assert.strictEqual(state, "invalid");
});

test("detectBeatportSessionState: Unbekannte Seite außerhalb Beatport", () => {
  const snapshot = {
    url: "https://soundcloud.com/user",
    host: "soundcloud.com",
    pathname: "/user",
    title: "User Profile",
    bodyText: "Some content",
    hasPasswordField: false,
    hasUsernameField: false,
    hasLoginTrigger: false,
  };

  const state = detectBeatportSessionState(snapshot);
  assert.strictEqual(state, "unknown");
});

test("buildSessionProbeExpression & buildPrepareLoginExpression: Beide sind evaluierbar", () => {
  const probeExpr = buildSessionProbeExpression();
  const prepareExpr = buildPrepareLoginExpression();

  // Beide sollten syntaktisch gültiges JavaScript sein
  assert.strictEqual(typeof probeExpr, "string");
  assert.strictEqual(typeof prepareExpr, "string");

  // Überprüfen auf grundlegende Syntaxelemente
  assert.ok(probeExpr.includes("return"));
  assert.ok(prepareExpr.includes("return"));
});
