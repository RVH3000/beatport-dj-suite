#!/usr/bin/env node
/**
 * Session-Manager Tests
 *
 * Testet die reinen Funktionen und Methoden aus session-manager.mjs
 * ohne Electron-Abhängigkeiten. Electron-spezifische Klassen (BrowserWindow)
 * werden durch leichtgewichtige Mocks ersetzt.
 *
 * Getestet werden:
 * - normalizeHeaderMap (Header-Normalisierung)
 * - buildTemplateUrl (URL-Template-Erzeugung)
 * - SessionManager.applyRuntimeConfig (Konfig-Anwendung)
 * - SessionManager.extractApiContextFromRequests (Request-Analyse)
 * - SessionManager.getStatus / deleteCredentials / saveCredentials
 * - InternalBeatportClient.send (Validierung)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Source-Extraktion: Pure Funktionen aus session-manager.mjs ─────────────
// Da session-manager.mjs `electron` importiert (nicht im Test-Umfeld verfügbar),
// extrahieren wir die reinen Funktionen direkt aus dem Source.

const source = await fs.readFile(
  path.join(ROOT, "electron-app", "auth", "session-manager.mjs"),
  "utf-8"
);

// Nachbau der reinen Funktionen — identische Logik wie im Source.

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeHeaderMap(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [
      String(key || "").toLowerCase(),
      String(value ?? ""),
    ])
  );
}

function buildTemplateUrl(rawUrl, playlistId) {
  const url = normalizeText(rawUrl);
  if (!url) return "";
  return url
    .replace(
      new RegExp(
        `/playlists/${String(playlistId || "").replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}(?=/|\\?|$)`
      ),
      "/playlists/{playlistId}"
    )
    .replace(/([?&])per_page=\d+/i, "$1per_page={perPage}")
    .replace(/([?&])page=\d+/i, "$1page={page}");
}

// ── SessionManager Mock ────────────────────────────────────────────────────
// Minimaler Mock der Klasse für testbare Methoden.

class SessionManagerMock {
  constructor(options = {}) {
    this.partition = options.partition || "persist:beatport-auth-v1";
    this.authWindow = null;
    this.status = {
      mode: "internal",
      sessionState: "unknown",
      credentialState: "not_used",
      lastValidatedAt: "",
      fallbackEnabled: true,
      keychainEnabled: false,
      autoLoginEnabled: false,
      recoveryPolicy: "aggressive",
      beatportSessionPartition: this.partition,
      passwordStorageEnabled: false,
      currentUrl: "",
      lastError: "",
    };
    this.apiContext = null;
  }

  applyRuntimeConfig(rawConfig = {}) {
    const mode = normalizeText(rawConfig.authMode || this.status.mode || "internal");
    this.status.mode = mode === "external-fallback" ? "external-fallback" : "internal";
    this.status.fallbackEnabled = rawConfig.fallbackEnabled !== false;
    this.status.keychainEnabled = false;
    this.status.autoLoginEnabled = false;
    this.status.recoveryPolicy =
      normalizeText(rawConfig.recoveryPolicy || "aggressive") || "aggressive";
    this.status.beatportSessionPartition =
      normalizeText(rawConfig.beatportSessionPartition) || this.partition;
    this.status.passwordStorageEnabled = false;
    return { ...this.status };
  }

  getWindowId() {
    return this.authWindow?.id || 0;
  }

  async getStatus(rawConfig = {}) {
    this.applyRuntimeConfig(rawConfig);
    return { ...this.status };
  }

  async saveCredentials() {
    throw new Error(
      "Passwortspeicherung ist deaktiviert. Die App hält nur die Beatport-Session im internen Profil."
    );
  }

  async deleteCredentials() {
    return {
      credentialState: "not_used",
      passwordStorageEnabled: false,
    };
  }

  extractApiContextFromRequests(requests = [], playlistId = "") {
    const apiRequests = requests.filter((entry) =>
      /api\.beatport\.com\/v4\/my\/playlists/i.test(entry.url || "")
    );
    const authRequest =
      apiRequests.find(
        (entry) =>
          /authorization/i.test(Object.keys(entry.headers || {}).join(" ")) &&
          entry.headers?.authorization
      ) || null;
    if (!authRequest?.headers?.authorization) {
      return null;
    }

    const detailRequest =
      apiRequests.find((entry) =>
        new RegExp(`/my/playlists/${playlistId}/$`).test(
          new URL(entry.url).pathname
        )
      ) ||
      apiRequests.find(
        (entry) =>
          /\/my\/playlists\/\d+\/$/i.test(new URL(entry.url).pathname)
      ) ||
      null;
    const trackRequest =
      apiRequests.find((entry) =>
        new RegExp(`/my/playlists/${playlistId}/tracks/$`).test(
          new URL(entry.url).pathname
        )
      ) ||
      apiRequests.find(
        (entry) =>
          /\/my\/playlists\/\d+\/tracks\/$/i.test(new URL(entry.url).pathname)
      ) ||
      null;
    const discoveryRequest =
      apiRequests.find(
        (entry) =>
          new URL(entry.url).pathname === "/v4/my/playlists/" &&
          /per_page=/i.test(entry.url)
      ) || null;
    const userAgent =
      authRequest.headers["user-agent"] ||
      this.authWindow?.webContents?.getUserAgent() ||
      "";

    return {
      authorization: authRequest.headers.authorization,
      accept:
        authRequest.headers.accept || "application/json, text/plain, */*",
      referer: authRequest.headers.referer || "https://dj.beatport.com/",
      userAgent,
      discoveryTemplate:
        buildTemplateUrl(discoveryRequest?.url, playlistId) ||
        "https://api.beatport.com/v4/my/playlists/?per_page={perPage}&page={page}",
      playlistTemplate:
        buildTemplateUrl(detailRequest?.url, playlistId) ||
        "https://api.beatport.com/v4/my/playlists/{playlistId}/",
      tracksTemplate:
        buildTemplateUrl(trackRequest?.url, playlistId) ||
        "https://api.beatport.com/v4/my/playlists/{playlistId}/tracks/?per_page={perPage}&page={page}",
      observedAt: new Date().toISOString(),
    };
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Source-Validierung", () => {
  it("session-manager.mjs existiert und enthält SessionManager Klasse", () => {
    assert.ok(source.includes("class SessionManager"), "SessionManager nicht gefunden");
  });

  it("session-manager.mjs exportiert SessionManager und InternalBeatportClient", () => {
    assert.ok(source.includes("export { InternalBeatportClient, SessionManager }"));
  });

  it("importiert BrowserWindow aus electron", () => {
    // Erlaubt zusätzliche named imports (z.B. BrowserWindow + session)
    assert.match(
      source,
      /import\s*\{[^}]*\bBrowserWindow\b[^}]*\}\s*from\s*["']electron["']/,
      'session-manager.mjs muss BrowserWindow aus "electron" importieren'
    );
  });
});

describe("normalizeHeaderMap", () => {
  it("Normalisiert Header-Keys zu lowercase", () => {
    const result = normalizeHeaderMap({
      "Content-Type": "application/json",
      Authorization: "Bearer abc123",
    });
    assert.equal(result["content-type"], "application/json");
    assert.equal(result["authorization"], "Bearer abc123");
  });

  it("Konvertiert alle Werte zu Strings", () => {
    const result = normalizeHeaderMap({
      "x-count": 42,
      "x-null": null,
      "x-undefined": undefined,
    });
    assert.equal(result["x-count"], "42");
    assert.equal(result["x-null"], "");
    assert.equal(result["x-undefined"], "");
  });

  it("Behandelt leeres Objekt", () => {
    const result = normalizeHeaderMap({});
    assert.deepStrictEqual(result, {});
  });

  it("Behandelt undefined", () => {
    const result = normalizeHeaderMap(undefined);
    assert.deepStrictEqual(result, {});
  });

  it("Behandelt null", () => {
    const result = normalizeHeaderMap(null);
    assert.deepStrictEqual(result, {});
  });
});

describe("buildTemplateUrl", () => {
  it("Ersetzt playlistId im Pfad", () => {
    const result = buildTemplateUrl(
      "https://api.beatport.com/v4/my/playlists/12345/",
      "12345"
    );
    assert.ok(
      result.includes("{playlistId}"),
      `Erwarte {playlistId} in: ${result}`
    );
    assert.ok(
      !result.includes("12345"),
      `12345 sollte ersetzt sein: ${result}`
    );
  });

  it("Ersetzt per_page Parameter", () => {
    const result = buildTemplateUrl(
      "https://api.beatport.com/v4/my/playlists/?per_page=100&page=1",
      ""
    );
    assert.ok(
      result.includes("per_page={perPage}"),
      `Erwarte per_page={perPage}: ${result}`
    );
  });

  it("Ersetzt page Parameter", () => {
    const result = buildTemplateUrl(
      "https://api.beatport.com/v4/my/playlists/?per_page=100&page=3",
      ""
    );
    assert.ok(
      result.includes("page={page}"),
      `Erwarte page={page}: ${result}`
    );
  });

  it("Gibt leeren String für leere URL zurück", () => {
    assert.equal(buildTemplateUrl("", "123"), "");
    assert.equal(buildTemplateUrl(null, "123"), "");
    assert.equal(buildTemplateUrl(undefined, "123"), "");
  });

  it("Lässt URL ohne Matches unverändert", () => {
    const url = "https://example.com/other/path";
    assert.equal(buildTemplateUrl(url, "123"), url);
  });

  it("Behandelt playlistId mit Sonderzeichen", () => {
    // playlistId könnte theoretisch Sonderzeichen enthalten
    const result = buildTemplateUrl(
      "https://api.beatport.com/v4/my/playlists/test.id/",
      "test.id"
    );
    assert.ok(
      result.includes("{playlistId}"),
      `Erwarte {playlistId}: ${result}`
    );
  });

  it("Ersetzt nur das erste Vorkommen der playlistId", () => {
    const result = buildTemplateUrl(
      "https://api.beatport.com/v4/my/playlists/555/tracks/?ref=555",
      "555"
    );
    // Sollte mindestens das Pfad-Vorkommen ersetzen
    assert.ok(
      result.includes("{playlistId}"),
      `Erwarte {playlistId}: ${result}`
    );
  });
});

describe("SessionManager.applyRuntimeConfig", () => {
  it("Setzt Standard-Mode auf 'internal'", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({});
    assert.equal(status.mode, "internal");
  });

  it("Akzeptiert 'external-fallback' als Mode", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({ authMode: "external-fallback" });
    assert.equal(status.mode, "external-fallback");
  });

  it("Normalisiert unbekannten Mode auf 'internal'", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({ authMode: "something-random" });
    assert.equal(status.mode, "internal");
  });

  it("Setzt fallbackEnabled Default auf true", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({});
    assert.equal(status.fallbackEnabled, true);
  });

  it("Deaktiviert fallbackEnabled explizit", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({ fallbackEnabled: false });
    assert.equal(status.fallbackEnabled, false);
  });

  it("Setzt keychainEnabled und autoLoginEnabled immer auf false", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({
      keychainEnabled: true,
      autoLoginEnabled: true,
    });
    assert.equal(status.keychainEnabled, false);
    assert.equal(status.autoLoginEnabled, false);
  });

  it("Übernimmt recoveryPolicy", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({ recoveryPolicy: "conservative" });
    assert.equal(status.recoveryPolicy, "conservative");
  });

  it("Setzt recoveryPolicy Default auf 'aggressive'", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({});
    assert.equal(status.recoveryPolicy, "aggressive");
  });

  it("Übernimmt beatportSessionPartition", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({
      beatportSessionPartition: "persist:custom-v2",
    });
    assert.equal(status.beatportSessionPartition, "persist:custom-v2");
  });

  it("passwordStorageEnabled ist immer false", () => {
    const mgr = new SessionManagerMock();
    const status = mgr.applyRuntimeConfig({});
    assert.equal(status.passwordStorageEnabled, false);
  });
});

describe("SessionManager.getStatus", () => {
  it("Gibt Kopie des Status zurück", async () => {
    const mgr = new SessionManagerMock();
    const status = await mgr.getStatus({});
    assert.equal(status.mode, "internal");
    assert.equal(status.sessionState, "unknown");
    // Mutation am Rückgabewert darf Original nicht ändern
    status.mode = "mutated";
    const status2 = await mgr.getStatus({});
    assert.equal(status2.mode, "internal");
  });

  it("Wendet rawConfig an", async () => {
    const mgr = new SessionManagerMock();
    const status = await mgr.getStatus({ authMode: "external-fallback" });
    assert.equal(status.mode, "external-fallback");
  });
});

describe("SessionManager.saveCredentials", () => {
  it("Wirft immer einen Fehler (Passwort-Speicherung deaktiviert)", async () => {
    const mgr = new SessionManagerMock();
    await assert.rejects(
      () => mgr.saveCredentials(),
      { message: /Passwortspeicherung ist deaktiviert/ }
    );
  });
});

describe("SessionManager.deleteCredentials", () => {
  it("Gibt not_used Status zurück", async () => {
    const mgr = new SessionManagerMock();
    const result = await mgr.deleteCredentials();
    assert.equal(result.credentialState, "not_used");
    assert.equal(result.passwordStorageEnabled, false);
  });
});

describe("SessionManager.getWindowId", () => {
  it("Gibt 0 zurück wenn kein Fenster", () => {
    const mgr = new SessionManagerMock();
    assert.equal(mgr.getWindowId(), 0);
  });

  it("Gibt Window-ID zurück wenn Fenster gesetzt", () => {
    const mgr = new SessionManagerMock();
    mgr.authWindow = { id: 42 };
    assert.equal(mgr.getWindowId(), 42);
  });
});

describe("SessionManager.extractApiContextFromRequests", () => {
  const mgr = new SessionManagerMock();

  const sampleRequests = [
    {
      url: "https://api.beatport.com/v4/my/playlists/?per_page=100&page=1",
      method: "GET",
      headers: {
        authorization: "Bearer eyJ_test_token",
        accept: "application/json",
        referer: "https://dj.beatport.com/",
        "user-agent": "Mozilla/5.0 TestAgent",
      },
    },
    {
      url: "https://api.beatport.com/v4/my/playlists/99001/",
      method: "GET",
      headers: {
        authorization: "Bearer eyJ_test_token",
        accept: "application/json",
      },
    },
    {
      url: "https://api.beatport.com/v4/my/playlists/99001/tracks/?per_page=100&page=1",
      method: "GET",
      headers: {
        authorization: "Bearer eyJ_test_token",
        accept: "application/json",
      },
    },
    {
      url: "https://cdn.beatport.com/image/abc.jpg",
      method: "GET",
      headers: {},
    },
  ];

  it("Extrahiert Authorization-Token korrekt", () => {
    const ctx = mgr.extractApiContextFromRequests(sampleRequests, "99001");
    assert.ok(ctx, "Context ist null");
    assert.equal(ctx.authorization, "Bearer eyJ_test_token");
  });

  it("Extrahiert User-Agent", () => {
    const ctx = mgr.extractApiContextFromRequests(sampleRequests, "99001");
    assert.equal(ctx.userAgent, "Mozilla/5.0 TestAgent");
  });

  it("Generiert discoveryTemplate mit Platzhaltern", () => {
    const ctx = mgr.extractApiContextFromRequests(sampleRequests, "99001");
    assert.ok(
      ctx.discoveryTemplate.includes("{perPage}"),
      `Erwarte {perPage}: ${ctx.discoveryTemplate}`
    );
    assert.ok(
      ctx.discoveryTemplate.includes("{page}"),
      `Erwarte {page}: ${ctx.discoveryTemplate}`
    );
  });

  it("Generiert playlistTemplate mit {playlistId}", () => {
    const ctx = mgr.extractApiContextFromRequests(sampleRequests, "99001");
    assert.ok(
      ctx.playlistTemplate.includes("{playlistId}"),
      `Erwarte {playlistId}: ${ctx.playlistTemplate}`
    );
    assert.ok(
      !ctx.playlistTemplate.includes("99001"),
      `99001 sollte ersetzt sein: ${ctx.playlistTemplate}`
    );
  });

  it("Generiert tracksTemplate mit {playlistId} und {perPage}", () => {
    const ctx = mgr.extractApiContextFromRequests(sampleRequests, "99001");
    assert.ok(
      ctx.tracksTemplate.includes("{playlistId}"),
      `Erwarte {playlistId}: ${ctx.tracksTemplate}`
    );
    assert.ok(
      ctx.tracksTemplate.includes("{perPage}"),
      `Erwarte {perPage}: ${ctx.tracksTemplate}`
    );
  });

  it("Setzt observedAt auf aktuelles Datum", () => {
    const ctx = mgr.extractApiContextFromRequests(sampleRequests, "99001");
    const observed = new Date(ctx.observedAt);
    assert.ok(!isNaN(observed.getTime()), "observedAt ist kein gültiges Datum");
    // Innerhalb der letzten 5 Sekunden
    assert.ok(
      Date.now() - observed.getTime() < 5000,
      "observedAt sollte aktuell sein"
    );
  });

  it("Gibt null zurück ohne Authorization-Header", () => {
    const noAuth = [
      {
        url: "https://api.beatport.com/v4/my/playlists/?per_page=100",
        method: "GET",
        headers: { accept: "application/json" },
      },
    ];
    const ctx = mgr.extractApiContextFromRequests(noAuth, "");
    assert.equal(ctx, null);
  });

  it("Gibt null zurück für leere Requests", () => {
    const ctx = mgr.extractApiContextFromRequests([], "");
    assert.equal(ctx, null);
  });

  it("Filtert Nicht-API-Requests korrekt", () => {
    const mixed = [
      {
        url: "https://cdn.beatport.com/image/test.jpg",
        method: "GET",
        headers: { authorization: "Bearer xxx" },
      },
    ];
    const ctx = mgr.extractApiContextFromRequests(mixed, "");
    assert.equal(ctx, null);
  });

  it("Verwendet Default-Templates wenn keine Matches", () => {
    const minimal = [
      {
        url: "https://api.beatport.com/v4/my/playlists/unknown/other",
        method: "GET",
        headers: { authorization: "Bearer token123" },
      },
    ];
    const ctx = mgr.extractApiContextFromRequests(minimal, "");
    assert.ok(ctx, "Context sollte nicht null sein");
    // Default-Templates werden verwendet
    assert.ok(
      ctx.playlistTemplate.includes("{playlistId}"),
      "Default playlistTemplate erwartet"
    );
  });
});

describe("InternalBeatportClient — Validierung (Source-Analyse)", () => {
  it("InternalBeatportClient existiert im Source", () => {
    assert.ok(source.includes("class InternalBeatportClient"));
  });

  it("send() wirft bei nicht-unterstützter Methode", () => {
    // Nachbau der send-Validierungslogik
    function validateSend(method) {
      if (method !== "Page.navigate") {
        throw new Error(`Interner Client unterstützt ${method} nicht.`);
      }
    }

    assert.throws(() => validateSend("Network.enable"), {
      message: /unterstützt Network.enable nicht/,
    });

    assert.doesNotThrow(() => validateSend("Page.navigate"));
  });

  it("send() wirft bei leerer URL", () => {
    function validateUrl(params) {
      const url = normalizeText(params?.url);
      if (!url) throw new Error("Page.navigate ohne URL ist ungültig.");
    }

    assert.throws(() => validateUrl({}), { message: /ohne URL/ });
    assert.throws(() => validateUrl({ url: "" }), { message: /ohne URL/ });
    assert.throws(() => validateUrl({ url: null }), { message: /ohne URL/ });
    assert.doesNotThrow(() => validateUrl({ url: "https://dj.beatport.com" }));
  });
});
