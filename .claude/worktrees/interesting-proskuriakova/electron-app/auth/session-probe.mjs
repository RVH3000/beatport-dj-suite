import { normalizeText } from "../utils/common.mjs";

const DJ_HOME_URL = "https://dj.beatport.com/home";
const SESSION_PARTITION = "persist:beatport-auth-v1";

/**
 * Pure Heuristik für Beatport-Session-Zustände. Diese Logik wird sowohl im
 * Browserkontext als auch in Tests wiederverwendet.
 * @param {{host?: string, pathname?: string, hasPasswordField?: boolean, hasUsernameField?: boolean, hasLoginTrigger?: boolean, hasPlaylistUi?: boolean, hasMyLibraryText?: boolean, bpUserId?: string | number | null, bodyText?: string}} snapshot
 * @returns {"valid" | "invalid" | "unknown"}
 */
function detectBeatportSessionState(snapshot = {}) {
  const host = normalizeText(snapshot.host).toLowerCase();
  const pathname = normalizeText(snapshot.pathname).toLowerCase();
  const bodyText = normalizeText(snapshot.bodyText).toLowerCase();
  const hasPasswordField = Boolean(snapshot.hasPasswordField);
  const hasUsernameField = Boolean(snapshot.hasUsernameField);
  const hasLoginTrigger = Boolean(snapshot.hasLoginTrigger);
  const hasPlaylistUi = Boolean(snapshot.hasPlaylistUi);
  const hasMyLibraryText = Boolean(snapshot.hasMyLibraryText);
  const hasUserId = Boolean(snapshot.bpUserId);

  if (host.includes("account.beatport.com")) {
    if (hasPasswordField || hasUsernameField || pathname.includes("forgot-password")) {
      return "invalid";
    }
  }

  if (host.includes("dj.beatport.com")) {
    if (hasPlaylistUi || hasMyLibraryText || hasUserId) {
      return "valid";
    }
    if (hasLoginTrigger && /\blog in\b|\bsign up\b/i.test(bodyText)) {
      return "invalid";
    }
  }

  if (hasPasswordField || hasUsernameField) {
    return "invalid";
  }

  return "unknown";
}

/**
 * Browserseitiger Probe-Block für den aktuellen Beatport-Session-Zustand.
 * @returns {string}
 */
function buildSessionProbeExpression() {
  return String.raw`(() => {
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const bodyText = normalize(document.body?.innerText || document.body?.textContent || "");
    const hasPasswordField = Boolean(
      document.querySelector('input[type="password"], input[name="password"], input[autocomplete="current-password"]')
    );
    const hasUsernameField = Boolean(
      document.querySelector('input[name="username"], input[type="email"], input[autocomplete="username"], input[placeholder*="Username" i]')
    );
    const loginCandidates = [...document.querySelectorAll('button, a, div, [role="button"]')];
    const hasLoginTrigger = loginCandidates.some((node) => /log in/i.test(normalize(node.innerText || node.textContent)));
    const hasPlaylistUi = Boolean(
      document.querySelector('#my-playlists, div[aria-label="Playlists"], div.menu-left-container, div.playlist-container, [data-playlist-id]')
    );
    const hasMyLibraryText = /my library/i.test(bodyText);
    let bpUserId = null;
    let bpUserName = "";
    try {
      const raw = localStorage.getItem('bp_user') || sessionStorage.getItem('bp_user') || '{}';
      const parsed = JSON.parse(raw);
      bpUserId = parsed?.id || null;
      bpUserName = normalize(parsed?.name || parsed?.username || '');
    } catch {
      bpUserId = null;
      bpUserName = "";
    }
    return {
      url: location.href,
      host: location.host,
      pathname: location.pathname,
      title: document.title,
      bodyText,
      hasPasswordField,
      hasUsernameField,
      hasLoginTrigger,
      hasPlaylistUi,
      hasMyLibraryText,
      bpUserId,
      bpUserName,
    };
  })()`;
}

/**
 * Browserseitiger Helper: Cookies akzeptieren und wenn nötig die Login-Seite öffnen.
 * @returns {string}
 */
function buildPrepareLoginExpression() {
  return String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const clickable = [...document.querySelectorAll('button, a, div, [role="button"]')];
    const clickByText = (pattern) => {
      const candidate = clickable.find((node) => {
        const text = normalize(node.innerText || node.textContent);
        if (!text) return false;
        return pattern.test(text);
      });
      if (!candidate) return false;
      candidate.click();
      return true;
    };

    const acceptedCookies = clickByText(/^(i accept|accept all|accept)$/i);
    if (acceptedCookies) {
      await sleep(350);
    }

    if (location.host.includes('account.beatport.com')) {
      return { stage: 'login_page', acceptedCookies };
    }

    const clickedLogin = clickByText(/^log in$/i);
    if (clickedLogin) {
      await sleep(1200);
    }

    return {
      stage: location.host.includes('account.beatport.com') ? 'login_page' : 'home',
      acceptedCookies,
      clickedLogin,
      url: location.href,
    };
  })()`;
}

export {
  DJ_HOME_URL,
  SESSION_PARTITION,
  buildPrepareLoginExpression,
  buildSessionProbeExpression,
  detectBeatportSessionState,
};
