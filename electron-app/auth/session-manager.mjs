import { BrowserWindow, session } from "electron";
import {
  DJ_HOME_URL,
  SESSION_PARTITION,
  buildPrepareLoginExpression,
  buildSessionProbeExpression,
  detectBeatportSessionState,
} from "./session-probe.mjs";
import { normalizeText } from "../utils/common.mjs";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      new RegExp(`/playlists/${String(playlistId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=/|\\?|$)`),
      "/playlists/{playlistId}"
    )
    .replace(/([?&])per_page=\d+/i, "$1per_page={perPage}")
    .replace(/([?&])page=\d+/i, "$1page={page}");
}

/**
 * Adapter, damit der Scanner statt externer CDP-Ziele einen internen,
 * persistenten Beatport-Browserkontext nutzen kann.
 */
class InternalBeatportClient {
  /**
   * @param {SessionManager} manager
   * @param {object} config
   */
  constructor(manager, config) {
    this.manager = manager;
    this.config = config;
  }

  async connect() {
    const status = await this.manager.ensureReadyForScan(this.config);
    return {
      id: `internal:${this.manager.getWindowId()}`,
      title: status.title || "Beatport Internal Session",
      url: status.currentUrl || DJ_HOME_URL,
      type: "internal",
      mode: "internal",
    };
  }

  async evaluate(expression) {
    return await this.manager.executeJavaScript(expression, this.config);
  }

  async send(method, params = {}) {
    if (method !== "Page.navigate") {
      throw new Error(`Interner Client unterstützt ${method} nicht.`);
    }
    const url = normalizeText(params?.url);
    if (!url) {
      throw new Error("Page.navigate ohne URL ist ungültig.");
    }
    await this.manager.navigate(url, this.config, { show: false });
    return {
      frameId: `internal:${this.manager.getWindowId()}`,
      loaderId: "internal",
    };
  }

  async close() {
    return null;
  }

  async resolveBeatportApiContext(options = {}) {
    return await this.manager.resolveBeatportApiContext(this.config, options);
  }
}

/**
 * Verwaltet den persistenten Beatport-Session-Kontext innerhalb der Scanner-App.
 * Es werden bewusst keine Zugangsdaten gespeichert; der Zustand lebt allein in
 * Cookies und Storage des dedizierten Electron-Profils.
 */
class SessionManager {
  /**
   * @param {{partition?: string}} [options]
   */
  constructor(options = {}) {
    this.partition = options.partition || SESSION_PARTITION;
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
    this._capturedToken = null;
    this._capturedTokenAt = 0;
    this._tokenCaptureActive = false;
  }

  /**
   * Passiver Token-Capture: Registriert einen webRequest-Listener auf der
   * Beatport-Session-Partition, der Authorization-Header aus regulären
   * API-Calls der SPA abfängt — ohne Navigation oder Seiteneingriff.
   */
  startTokenCapture() {
    if (this._tokenCaptureActive) return;
    const ses = session.fromPartition(this.partition);
    ses.webRequest.onBeforeSendHeaders(
      { urls: ["https://api.beatport.com/*"] },
      (details, callback) => {
        const auth =
          details.requestHeaders["Authorization"] ||
          details.requestHeaders["authorization"];
        if (auth && auth.startsWith("Bearer ")) {
          this._capturedToken = auth;
          this._capturedTokenAt = Date.now();
          // Alle Header des echten SPA-Requests speichern
          this._capturedHeaders = { ...details.requestHeaders };
        }
        callback({ requestHeaders: details.requestHeaders });
      }
    );
    this._tokenCaptureActive = true;
  }

  /**
   * Gibt den passiv gecaptureten Bearer-Token zurück, wenn er frisch genug ist.
   * @param {number} [maxAgeMs=10*60*1000] Maximales Alter in ms (Standard: 10 Min)
   */
  getCapturedToken(maxAgeMs = 10 * 60 * 1000) {
    if (
      this._capturedToken &&
      Date.now() - this._capturedTokenAt < maxAgeMs
    ) {
      return this._capturedToken;
    }
    return null;
  }

  /**
   * Gibt die komplett gecaptureten Headers eines echten Beatport-API-Calls zurück.
   */
  getCapturedHeaders() {
    return this._capturedHeaders || null;
  }

  /**
   * AKTIVES Token-Refresh via NextAuth-Endpoint (v4.6.1).
   *
   * Inspiriert vom externen Projekt `~/Desktop/beatport-playlist-creator/`
   * (`bp_cdp_automation.py` get_jwt()): NextAuth-Sessions exponieren den
   * aktuellen JWT via `/api/auth/session`. Solange ein gueltiges Session-
   * Cookie existiert (User ist eingeloggt), liefert dieser Endpoint
   * AUTO-REFRESHED einen frischen Bearer-Token — keine Wartezeit auf
   * SPA-Activity, kein passives Lauschen, kein 10-Min-Timeout-Problem.
   *
   * Liest das Token via webContents.executeJavaScript() in dem Browser-
   * Fenster das auf dj.beatport.com sitzt. Falls dort kein Fenster
   * vorhanden ist (z.B. erster Aufruf): wird kein Token zurueckgegeben,
   * der Caller muss erst ensureWindow() aufrufen.
   *
   * @returns {Promise<{token: string|null, source: string, error?: string}>}
   */
  async fetchTokenViaNextAuth() {
    const win = this.authWindow;
    if (!win || win.isDestroyed()) {
      return { token: null, source: "nextauth", error: "Kein Auth-Fenster offen" };
    }
    try {
      // Inspiriert von bp_cdp_automation.py get_jwt(): NextAuth-Session-
      // Endpoint exponiert den aktuellen JWT. Wir holen ihn aktiv via
      // executeJavaScript im Beatport-Tab. Mehrere Token-Key-Pfade probieren
      // (Beatport-NextAuth hat varianten je nach Version).
      const code = `(async () => {
        try {
          const r = await fetch('/api/auth/session', { credentials: 'include' });
          if (!r.ok) return { error: 'HTTP ' + r.status };
          const d = await r.json();
          const token = d?.token?.accessToken
            || d?.accessToken
            || d?.user?.accessToken
            || '';
          return { token, raw_keys: Object.keys(d || {}) };
        } catch (e) {
          return { error: String(e && e.message || e) };
        }
      })()`;
      const result = await win.webContents.executeJavaScript(code, true);
      if (result?.error) {
        return { token: null, source: "nextauth", error: result.error };
      }
      const token = result?.token || "";
      if (!token) {
        return {
          token: null,
          source: "nextauth",
          error: `Leer/kein token-Feld im NextAuth-Response (keys: ${result?.raw_keys?.join(",") || "?"})`,
        };
      }
      const bearerToken = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
      // Cache aktualisieren — auch fuer getCapturedToken-Konsumenten
      this._capturedToken = bearerToken;
      this._capturedTokenAt = Date.now();
      return { token: bearerToken, source: "nextauth" };
    } catch (error) {
      return {
        token: null,
        source: "nextauth",
        error: `executeJavaScript fehlgeschlagen: ${error.message}`,
      };
    }
  }

  applyRuntimeConfig(rawConfig = {}) {
    const mode = normalizeText(rawConfig.authMode || this.status.mode || "internal");
    this.status.mode = mode === "external-fallback" ? "external-fallback" : "internal";
    this.status.fallbackEnabled = rawConfig.fallbackEnabled !== false;
    this.status.keychainEnabled = false;
    this.status.autoLoginEnabled = false;
    this.status.recoveryPolicy = normalizeText(rawConfig.recoveryPolicy || "aggressive") || "aggressive";
    this.status.beatportSessionPartition =
      normalizeText(rawConfig.beatportSessionPartition) || this.partition;
    this.status.passwordStorageEnabled = false;
    return { ...this.status };
  }

  getWindowId() {
    return this.authWindow?.id || 0;
  }

  attachWindowLifecycle(win) {
    win.on("closed", () => {
      if (this.authWindow === win) {
        this.authWindow = null;
      }
    });

    win.webContents.on("did-navigate", (_event, url) => {
      this.status.currentUrl = url;
      this.status.lastError = "";
    });
    win.webContents.on("did-navigate-in-page", (_event, url) => {
      this.status.currentUrl = url;
      this.status.lastError = "";
    });
    win.webContents.on("render-process-gone", async () => {
      this.status.sessionState = "recovering";
      this.status.lastError = "Interner Beatport-Kontext wurde neu gestartet.";
      if (this.authWindow === win) {
        this.authWindow = null;
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "allow" }));
  }

  async ensureWindow(options = {}) {
    const show = Boolean(options.show);
    const forceRecreate = Boolean(options.forceRecreate);
    if (forceRecreate && this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.destroy();
      this.authWindow = null;
    }

    this.startTokenCapture();

    if (!this.authWindow || this.authWindow.isDestroyed()) {
      this.authWindow = new BrowserWindow({
        width: 1360,
        height: 940,
        minWidth: 1100,
        minHeight: 760,
        show,
        autoHideMenuBar: true,
        title: "Beatport Session",
        webPreferences: {
          partition: this.partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      this.attachWindowLifecycle(this.authWindow);
      await this.authWindow.loadURL(DJ_HOME_URL);
      this.status.currentUrl = this.authWindow.webContents.getURL();
    }

    if (show) {
      this.authWindow.show();
      this.authWindow.focus();
    }

    return this.authWindow;
  }

  async withNetworkCapture(callback) {
    const win = await this.ensureWindow({ show: false });
    const { webContents } = win;
    const debuggerApi = webContents.debugger;
    const requests = [];
    let attachedHere = false;

    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3");
      attachedHere = true;
    }

    const onMessage = (_event, method, params) => {
      if (method !== "Network.requestWillBeSent") {
        return;
      }
      requests.push({
        url: params?.request?.url || "",
        method: params?.request?.method || "GET",
        headers: normalizeHeaderMap(params?.request?.headers || {}),
      });
    };

    debuggerApi.on("message", onMessage);
    await debuggerApi.sendCommand("Network.enable");

    try {
      const result = await callback(win, requests);
      return { result, requests };
    } finally {
      debuggerApi.off("message", onMessage);
      try {
        await debuggerApi.sendCommand("Network.disable");
      } catch {
        // Ignorieren: Debugger kann bereits getrennt sein.
      }
      if (attachedHere && debuggerApi.isAttached()) {
        debuggerApi.detach();
      }
    }
  }

  async navigate(url, rawConfig = {}, options = {}) {
    this.applyRuntimeConfig(rawConfig);
    const win = await this.ensureWindow({ show: Boolean(options.show) });
    const currentUrl = normalizeText(win.webContents.getURL());
    if (currentUrl !== normalizeText(url)) {
      await win.loadURL(url);
    }
    this.status.currentUrl = win.webContents.getURL();
    return win;
  }

  async executeJavaScript(script, rawConfig = {}) {
    this.applyRuntimeConfig(rawConfig);
    const win = await this.ensureWindow({ show: false });
    return await win.webContents.executeJavaScript(script, true);
  }

  async probe(rawConfig = {}, options = {}) {
    this.applyRuntimeConfig(rawConfig);
    if (options.ensureHome !== false) {
      await this.navigate(DJ_HOME_URL, rawConfig, { show: Boolean(options.show) });
    } else {
      await this.ensureWindow({ show: Boolean(options.show) });
    }
    const snapshot = await this.executeJavaScript(buildSessionProbeExpression(), rawConfig);
    const sessionState = detectBeatportSessionState(snapshot);
    if (sessionState === "valid") {
      this.status.lastValidatedAt = new Date().toISOString();
      this.status.lastError = "";
    }
    this.status.sessionState = sessionState;
    this.status.currentUrl = normalizeText(snapshot?.url || this.status.currentUrl);
    return {
      ...this.status,
      title: normalizeText(snapshot?.title || "Beatport Internal Session"),
      bpUserName: normalizeText(snapshot?.bpUserName || ""),
      bpUserId: snapshot?.bpUserId || null,
      snapshot,
    };
  }

  async getStatus(rawConfig = {}) {
    this.applyRuntimeConfig(rawConfig);
    return { ...this.status };
  }

  async openLoginWindow(rawConfig = {}) {
    this.applyRuntimeConfig(rawConfig);
    await this.navigate(DJ_HOME_URL, rawConfig, { show: true });
    try {
      await this.executeJavaScript(buildPrepareLoginExpression(), rawConfig);
    } catch {
      await wait(1200);
    }
    return await this.probe(rawConfig, { ensureHome: false, show: true });
  }

  async testSession(rawConfig = {}) {
    return await this.probe(rawConfig, { ensureHome: true, show: false });
  }

  async recover(rawConfig = {}, reason = "scanner_recovery") {
    this.applyRuntimeConfig(rawConfig);
    this.status.sessionState = "recovering";
    this.status.lastError = reason;
    await this.ensureWindow({ forceRecreate: true, show: false });
    await wait(300);
    return await this.probe(rawConfig, { ensureHome: true, show: false });
  }

  async reauthenticate(rawConfig = {}) {
    this.applyRuntimeConfig(rawConfig);
    const current = await this.probe(rawConfig, { ensureHome: true, show: false });
    if (current.sessionState === "valid") {
      return current;
    }
    await this.openLoginWindow(rawConfig);
    return await this.probe(rawConfig, { ensureHome: false, show: true });
  }

  async ensureReadyForScan(rawConfig = {}) {
    this.applyRuntimeConfig(rawConfig);
    let status = await this.probe(rawConfig, { ensureHome: true, show: false });
    if (status.sessionState === "valid") {
      return status;
    }

    if (this.status.recoveryPolicy === "aggressive") {
      status = await this.recover(rawConfig, "scanner_connect_failed");
      if (status.sessionState === "valid") {
        return status;
      }
    }

    await this.openLoginWindow(rawConfig);
    throw new Error(
      "Interne Beatport-Session ist nicht angemeldet. Bitte im geöffneten Beatport-Fenster einloggen und den Scan danach erneut starten."
    );
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
      authRequest.headers["user-agent"] || this.authWindow?.webContents.getUserAgent() || "";

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

  async resolveBeatportApiContext(rawConfig = {}, options = {}) {
    this.applyRuntimeConfig(rawConfig);
    const playlistId = normalizeText(options.playlistId || "");
    const forceRefresh = Boolean(options.forceRefresh);
    const cached = this.apiContext;
    if (
      !forceRefresh &&
      cached?.authorization &&
      cached?.tracksTemplate &&
      cached?.playlistTemplate &&
      Date.now() - new Date(cached.observedAt || 0).getTime() < 8 * 60 * 1000
    ) {
      return { ...cached };
    }

    await this.ensureReadyForScan(rawConfig);
    const { requests } = await this.withNetworkCapture(async (win) => {
      if (playlistId) {
        await win.loadURL(`https://dj.beatport.com/playlists/${playlistId}`);
      } else {
        await win.loadURL(DJ_HOME_URL);
      }
      await wait(2600);
    });

    const context = this.extractApiContextFromRequests(requests, playlistId);
    if (!context) {
      throw new Error(
        "Beatport API-Kontext konnte nicht aufgelöst werden. Bitte Session testen und erneut versuchen."
      );
    }

    this.apiContext = context;
    return { ...context };
  }

  createScannerClient(rawConfig = {}) {
    this.applyRuntimeConfig(rawConfig);
    return new InternalBeatportClient(this, rawConfig);
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

  async dispose() {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.destroy();
    }
    this.authWindow = null;
  }
}

export { InternalBeatportClient, SessionManager };
