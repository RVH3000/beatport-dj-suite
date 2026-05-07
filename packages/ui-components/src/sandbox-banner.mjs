import { escapeHtml } from "./escape.mjs";

/**
 * Sandbox-Banner: visueller Marker, dass die App auf einer Sandbox-DB
 * arbeitet (kein Schreibzugriff auf Production). Wichtige UX-Hilfe für
 * Engine-DB-Operationen, damit der User nicht versehentlich denkt er sei
 * auf der echten Library.
 */
export function buildSandboxBanner({ active = false, label = null } = {}) {
  return {
    active: Boolean(active),
    label: label ? String(label) : (active ? "SANDBOX-MODUS" : null),
    cssClass: active ? "bpdjs-banner--sandbox" : "bpdjs-banner--hidden",
    ariaLabel: active ? "Sandbox-Modus aktiv — Änderungen wirken nicht auf Produktions-DB" : null
  };
}

export function renderSandboxBannerHtml(banner) {
  if (!banner.active) {
    return `<div class="bpdjs-banner ${banner.cssClass}" aria-hidden="true"></div>`;
  }
  const label = escapeHtml(banner.label);
  const aria = escapeHtml(banner.ariaLabel);
  return `<div class="bpdjs-banner ${banner.cssClass}" role="alert" aria-label="${aria}">${label}</div>`;
}
