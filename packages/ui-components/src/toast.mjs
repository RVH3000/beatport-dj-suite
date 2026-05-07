import { escapeHtml } from "./escape.mjs";

export const TOAST_TYPES = ["info", "success", "warn", "error"];

/**
 * Liefert ein Plain-Object mit Toast-Daten (testbar ohne DOM).
 * Default-Dauer: 3 Sekunden, error-Toasts sticky (duration=null).
 */
export function buildToast({ message, type = "info", duration } = {}) {
  if (!message) throw new Error("buildToast: message erforderlich");
  if (!TOAST_TYPES.includes(type)) {
    throw new Error(`buildToast: unbekannter type ${type} (erlaubt: ${TOAST_TYPES.join(", ")})`);
  }
  const finalDuration = duration === undefined ? (type === "error" ? null : 3000) : duration;
  return {
    message: String(message),
    type,
    duration: finalDuration,
    sticky: finalDuration === null,
    timestamp: Date.now()
  };
}

/**
 * Rendert einen Toast als HTML-String — DOM-frei.
 */
export function renderToastHtml(toast) {
  const safeMsg = escapeHtml(toast.message);
  const sticky = toast.sticky ? ' data-sticky="true"' : "";
  const duration = toast.duration ? ` data-duration="${toast.duration}"` : "";
  return `<div class="bpdjs-toast bpdjs-toast--${toast.type}"${sticky}${duration} role="status">${safeMsg}</div>`;
}

/**
 * Mountet einen Toast ins DOM. Nur im Browser nutzbar — Tests sollen
 * stattdessen buildToast + renderToastHtml prüfen.
 */
export function attachToast(parent, opts) {
  if (!parent || typeof parent.insertAdjacentHTML !== "function") {
    throw new Error("attachToast: parent benötigt insertAdjacentHTML (DOM-Element)");
  }
  const toast = buildToast(opts);
  parent.insertAdjacentHTML("beforeend", renderToastHtml(toast));
  const el = parent.lastElementChild;
  if (toast.duration && typeof setTimeout === "function") {
    setTimeout(() => { try { el.remove(); } catch { /* noop */ } }, toast.duration);
  }
  return el;
}
