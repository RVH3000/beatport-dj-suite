#!/usr/bin/env node
/**
 * Pre-Flight Test G: Tiefe Inspektion von dj.beatport.com/auth/token
 *
 * Test C im bp_user_cookie_auth-Test zeigte: /auth/token → status 200.
 * Pruefe was die Response enthaelt: Token? JSON? HTML? Refresh-Mechanik?
 *
 * Read-only.
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
    await win.loadURL(DJ_HOME);
    await new Promise((r) => setTimeout(r, 2500));
    process.stderr.write(`[G1] dj.beatport.com geladen\n`);

    // Test G: /auth/token tiefer
    const testG = await win.webContents.executeJavaScript(`(async () => {
      const results = {};
      // GET ohne Headers
      try {
        const r = await fetch('/auth/token', { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        let body = '';
        let json = null;
        if (ct.includes('application/json')) {
          json = await r.json();
        } else {
          body = (await r.text()).slice(0, 800);
        }
        results.GET = { status: r.status, contentType: ct, json, body };
      } catch (e) {
        results.GET = { error: String(e?.message || e) };
      }
      // POST ohne Body
      try {
        const r = await fetch('/auth/token', { method: 'POST', credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        let body = '';
        let json = null;
        if (ct.includes('application/json')) {
          json = await r.json();
        } else {
          body = (await r.text()).slice(0, 500);
        }
        results.POST = { status: r.status, contentType: ct, json, body };
      } catch (e) {
        results.POST = { error: String(e?.message || e) };
      }
      return results;
    })()`, true);
    process.stderr.write(`[G2] /auth/token getestet\n`);

    // Test H: Wenn /auth/token JSON liefert mit Token → API-Call testen
    let bearerCandidate = null;
    if (testG?.GET?.json) {
      const j = testG.GET.json;
      bearerCandidate =
        j?.token?.accessToken ||
        j?.accessToken ||
        j?.access_token ||
        j?.token ||
        null;
    }
    if (typeof bearerCandidate === "string" && bearerCandidate.length > 50) {
      process.stderr.write(`[G3] Bearer-Candidate gefunden (length ${bearerCandidate.length}), teste API...\n`);
      const testH = await win.webContents.executeJavaScript(`(async () => {
        try {
          const r = await fetch('https://api.beatport.com/v4/my/beatport/artists/?per_page=3&page=1', {
            headers: { 'Authorization': 'Bearer ' + ${JSON.stringify(bearerCandidate)} },
            credentials: 'include',
          });
          let ct = r.headers.get('content-type') || '';
          let body = '';
          let json = null;
          if (ct.includes('application/json')) json = await r.json();
          else body = (await r.text()).slice(0, 200);
          return { status: r.status, contentType: ct, count: json?.count, results_len: json?.results?.length, body };
        } catch (e) {
          return { error: String(e?.message || e) };
        }
      })()`, true);
      emit({
        auth_token_response: testG,
        bearer_candidate_length: bearerCandidate.length,
        api_call_with_new_token: testH,
        conclusion: testH?.status === 200
          ? "PLAN G GRUEN: /auth/token liefert Token, API-Call funktioniert!"
          : `Token wurde geholt aber API gibt ${testH?.status} — anderer Mechanismus`,
      });
    } else {
      emit({
        auth_token_response: testG,
        bearer_candidate_length: 0,
        conclusion: "/auth/token Response enthaelt keinen Token im erwarteten Format",
      });
    }
  } catch (error) {
    emit({ ok: false, phase: "exception", error: error.message, stack: error.stack });
  } finally {
    setTimeout(() => { win?.close(); app.quit(); }, 100);
  }
});

app.on("window-all-closed", () => app.quit());
