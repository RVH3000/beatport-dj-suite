#!/usr/bin/env node
/**
 * Pre-Flight-Test fuer Plan v4.6.2:
 * Kann eine Electron-Instanz mit der bestehenden Auth-Partition
 * zu www.beatport.com navigieren und ueber /api/auth/session einen
 * frischen JWT holen?
 *
 * Ausfuehrung:
 *   cd ~/Projects/_local/beatport-dj-suite.worktrees/v4.2
 *   ./node_modules/.bin/electron scripts/test_nextauth_endpoint.mjs
 *
 * Output JSON nach stderr:
 *   {ok: true, token_length: N, source: "www.beatport.com"}  → Plan B aktiv
 *   {ok: false, status, body_preview}                        → Plan C
 *
 * Read-only Test: KEINE Aenderungen an der App-Installation, keine
 * Token-Files geschrieben. Nur Webview + JS + Beenden.
 */

import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PARTITION = "persist:beatport-auth-v1";
const TARGET_URL = "https://www.beatport.com/";
const TEST_ENDPOINT = "/api/auth/session";

function logResult(obj) {
  // Output auf stdout, leicht parsebar
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
    // Schritt 1: Navigation zu www.beatport.com
    // Mit cf_clearance-Cookie sollte Cloudflare durchlassen
    process.stderr.write(`[test] Lade ${TARGET_URL}...\n`);
    await win.loadURL(TARGET_URL);

    // Schritt 2: Auf Page-Ready warten + ggf. Cloudflare-Challenge-Resolution
    await new Promise((r) => setTimeout(r, 2500));

    // Schritt 3: Aktuelle URL pruefen
    const currentUrl = win.webContents.getURL();
    process.stderr.write(`[test] currentUrl nach Load: ${currentUrl}\n`);

    // Schritt 4: Cloudflare-Challenge?
    const pageTitle = await win.webContents.executeJavaScript("document.title");
    process.stderr.write(`[test] document.title: ${pageTitle}\n`);

    if (/Just a moment/i.test(pageTitle) || /Cloudflare/i.test(pageTitle)) {
      logResult({
        ok: false,
        phase: "cloudflare-challenge",
        message: "Cloudflare zeigt noch Challenge — cf_clearance reicht nicht",
        pageTitle,
        currentUrl,
      });
      win.close();
      app.quit();
      return;
    }

    // Schritt 5: NextAuth-Endpoint aufrufen
    process.stderr.write(`[test] Hole ${TEST_ENDPOINT}...\n`);
    const code = `(async () => {
      try {
        const r = await fetch('${TEST_ENDPOINT}', { credentials: 'include' });
        const status = r.status;
        const contentType = r.headers.get('content-type') || '';
        let body = '';
        let json = null;
        if (contentType.includes('application/json')) {
          json = await r.json();
        } else {
          body = (await r.text()).slice(0, 300);
        }
        return { status, contentType, json, body };
      } catch (e) {
        return { error: String(e && e.message || e) };
      }
    })()`;
    const result = await win.webContents.executeJavaScript(code, true);
    process.stderr.write(`[test] Response: status=${result?.status}, contentType=${result?.contentType}\n`);

    if (result?.error) {
      logResult({ ok: false, phase: "executeJavaScript-error", error: result.error });
    } else if (result?.status === 200 && result?.json) {
      // Erfolg — pruefe ob ein Token im JSON ist
      const j = result.json;
      const tokenCandidates = [
        j?.token?.accessToken,
        j?.accessToken,
        j?.user?.accessToken,
        j?.access_token,
      ].filter(Boolean);
      const tokenLength = tokenCandidates[0]?.length || 0;
      logResult({
        ok: tokenLength > 0,
        phase: "nextauth-response",
        status: 200,
        token_length: tokenLength,
        token_preview: tokenCandidates[0] ? `${tokenCandidates[0].slice(0, 30)}...` : null,
        json_keys: Object.keys(j || {}),
        raw_keys_token: j?.token ? Object.keys(j.token) : null,
        currentUrl,
      });
    } else {
      logResult({
        ok: false,
        phase: "non-200",
        status: result?.status,
        contentType: result?.contentType,
        body_preview: (result?.body || "").slice(0, 200),
        currentUrl,
      });
    }
  } catch (error) {
    logResult({ ok: false, phase: "exception", error: error.message, stack: error.stack });
  } finally {
    setTimeout(() => {
      win?.close();
      app.quit();
    }, 100);
  }
});

app.on("window-all-closed", () => app.quit());
