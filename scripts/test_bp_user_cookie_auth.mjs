#!/usr/bin/env node
/**
 * Pre-Flight-Test Option F:
 * Funktioniert das vorhandene bp_user-Cookie (gueltig bis 2027) selbst
 * als Auth fuer myBeatport-API-Calls — ohne expliziten Bearer-Token?
 *
 * Hypothese: dj.beatport.com nutzt cookie-basierte Auth. Wenn wir von
 * dort aus fetch() mit credentials:'include' machen, sendet der Browser
 * automatisch alle relevanten Cookies. Vielleicht akzeptiert die API
 * das ohne Bearer-Header.
 *
 * Ausfuehrung:
 *   cd ~/Projects/_local/beatport-dj-suite.worktrees/v4.2
 *   ./node_modules/.bin/electron scripts/test_bp_user_cookie_auth.mjs
 *
 * Read-only Test: KEINE Aenderungen an der App-Installation.
 */

import { app, BrowserWindow } from "electron";

const PARTITION = "persist:beatport-auth-v1";
const DJ_HOME = "https://dj.beatport.com/home";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    process.stderr.write(`[F1] Lade ${DJ_HOME}...\n`);
    await win.loadURL(DJ_HOME);
    await new Promise((r) => setTimeout(r, 2500));

    const pageTitle = await win.webContents.executeJavaScript("document.title");
    const currentUrl = win.webContents.getURL();
    process.stderr.write(`[F1] title="${pageTitle}" url=${currentUrl}\n`);

    // Test A: cookie-only Auth gegen /v4/my/beatport/artists/
    process.stderr.write(`[F2] Test A: API-Call mit nur Cookies (kein Bearer)...\n`);
    const testA = await win.webContents.executeJavaScript(`(async () => {
      try {
        const r = await fetch('https://api.beatport.com/v4/my/beatport/artists/?per_page=5&page=1', {
          credentials: 'include',
        });
        const ct = r.headers.get('content-type') || '';
        let body = '';
        let json = null;
        if (ct.includes('application/json')) json = await r.json();
        else body = (await r.text()).slice(0, 200);
        return { status: r.status, contentType: ct, json, body };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    })()`, true);
    process.stderr.write(`[F2] Test A status=${testA?.status}\n`);

    // Test B: NextAuth-Endpoint auf dj.beatport.com (vermutlich 404, aber zur Sicherheit)
    process.stderr.write(`[F3] Test B: /api/auth/session auf dj.beatport.com...\n`);
    const testB = await win.webContents.executeJavaScript(`(async () => {
      try {
        const r = await fetch('/api/auth/session', { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        return { status: r.status, contentType: ct, body: (await r.text()).slice(0, 200) };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    })()`, true);
    process.stderr.write(`[F3] Test B status=${testB?.status}\n`);

    // Test C: Suche nach anderen Auth-Endpoints im dj.beatport.com SPA
    // Was tut das SPA wenn man /api/auth/refresh oder /api/auth/token aufruft?
    process.stderr.write(`[F4] Test C: alternative Auth-Endpoints auf dj.beatport.com...\n`);
    const testC = await win.webContents.executeJavaScript(`(async () => {
      const candidates = [
        '/api/auth/refresh',
        '/api/auth/token',
        '/api/v4/auth/token',
        '/auth/token',
        '/api/user/me',
      ];
      const results = {};
      for (const p of candidates) {
        try {
          const r = await fetch(p, { credentials: 'include' });
          results[p] = r.status;
        } catch (e) {
          results[p] = 'error:' + e.message;
        }
      }
      return results;
    })()`, true);

    // Test D: Welche Cookies sind aktuell verfuegbar von der dj.beatport.com-Origin?
    process.stderr.write(`[F5] Test D: document.cookie auf dj.beatport.com...\n`);
    const testD = await win.webContents.executeJavaScript(`document.cookie`);

    emit({
      page: { title: pageTitle, url: currentUrl },
      testA_cookie_only_api_call: testA,
      testB_nextauth_on_dj: testB,
      testC_other_auth_endpoints: testC,
      testD_visible_cookies: testD || "(empty — HttpOnly cookies not visible to JS)",
      conclusion: {
        cookie_auth_works: testA?.status === 200,
        suggestion: testA?.status === 200
          ? "Plan F gruen — bp_user-Cookie reicht. Patch: fetch() ohne explizites Bearer von dj.beatport.com-Origin"
          : "Plan F rot — Cookie reicht nicht. Plan C oder E.",
      },
    });
  } catch (error) {
    emit({ ok: false, phase: "exception", error: error.message });
  } finally {
    setTimeout(() => {
      win?.close();
      app.quit();
    }, 100);
  }
});

app.on("window-all-closed", () => app.quit());
