// tooltip-positioner.js — Auto-Positioner für .help-icon Tooltips.
// Misst bei Hover/Focus die freie Fläche um das Icon und setzt
// passende Klassen, damit Tooltips nicht aus dem Fenster ragen.
//
// Tooltip-Default: zentriert unter dem Icon (CSS: top:100%+10px, left:50%).
// Wenn rechts <200px Platz → .tip-right (rechts-bündig).
// Wenn links <200px Platz → .tip-left (links-bündig).
// Wenn unten <80px Platz → .tip-up (Tooltip nach oben).
//
// Pure JS, keine Frameworks. Wird einmal bei DOMContentLoaded initialisiert
// und reagiert auf alle .help-icon-Elemente, auch dynamisch hinzugefügte
// (MutationObserver).

(function () {
  const TOOLTIP_WIDTH = 360;       // matches CSS max-width
  const TOOLTIP_HEIGHT_EST = 80;   // generous estimate for multi-line tips
  const MARGIN = 16;               // safety margin to viewport edge

  function positionTooltip(icon) {
    icon.classList.remove("tip-right", "tip-left", "tip-up");

    const rect = icon.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const iconCenterX = rect.left + rect.width / 2;
    const spaceRight = vw - iconCenterX;
    const spaceLeft = iconCenterX;
    const spaceBelow = vh - rect.bottom;

    // Horizontal placement
    if (spaceRight < TOOLTIP_WIDTH / 2 + MARGIN) {
      icon.classList.add("tip-right");
    } else if (spaceLeft < TOOLTIP_WIDTH / 2 + MARGIN) {
      icon.classList.add("tip-left");
    }

    // Vertical placement
    if (spaceBelow < TOOLTIP_HEIGHT_EST + MARGIN) {
      icon.classList.add("tip-up");
    }
  }

  function bindIcon(icon) {
    if (icon.dataset.tipPositionerBound === "1") return;
    icon.dataset.tipPositionerBound = "1";
    // mousenter + focus, weil Tooltips per :hover und :focus-visible kommen
    icon.addEventListener("mouseenter", () => positionTooltip(icon));
    icon.addEventListener("focus", () => positionTooltip(icon));
  }

  function bindAll(root = document) {
    root.querySelectorAll(".help-icon").forEach(bindIcon);
  }

  function init() {
    bindAll();

    // Reagiert auf dynamisch hinzugefügte Icons (Tab-Wechsel rendert HTML neu)
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.classList?.contains("help-icon")) bindIcon(node);
          if (node.querySelectorAll) bindAll(node);
        });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
