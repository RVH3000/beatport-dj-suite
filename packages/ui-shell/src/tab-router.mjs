import { eventBus as defaultBus } from "@bpdjs/core";

export const TAB_CHANGED = "shell:tab-changed";

/**
 * Pure-JS Tab-Router. Verwaltet eine Liste von Tabs (id, label, optional
 * mode-Filter) und einen aktiven Tab. Feuert TAB_CHANGED via core/eventbus
 * beim Wechsel.
 *
 * DOM-Anbindung erfolgt im Renderer; dieser Router ist test- und main-prozess-tauglich.
 *
 * Tab-Format:
 *   { id, label, requiresMode? }
 *     requiresMode optional: nur sichtbar wenn aktueller Mode === requiresMode
 *     (z. B. "developer" für Debug-Tab)
 */
export class TabRouter {
  constructor({ tabs = [], initial = null, mode = "standard", eventBus = defaultBus } = {}) {
    this._tabs = tabs.map((t) => ({ ...t }));
    this._mode = mode;
    this._active = null;
    this._eventBus = eventBus;
    if (initial) this._setActive(initial, { silent: true });
    else if (this._tabs.length > 0) {
      const firstVisible = this.visibleTabs()[0];
      if (firstVisible) this._setActive(firstVisible.id, { silent: true });
    }
  }

  get active() { return this._active; }
  get mode() { return this._mode; }
  get tabs() { return this._tabs.map((t) => ({ ...t })); }

  visibleTabs() {
    return this._tabs
      .filter((t) => !t.requiresMode || t.requiresMode === this._mode)
      .map((t) => ({ ...t }));
  }

  hasTab(id) {
    return this._tabs.some((t) => t.id === id);
  }

  isVisible(id) {
    return this.visibleTabs().some((t) => t.id === id);
  }

  setMode(newMode) {
    if (this._mode === newMode) return this;
    this._mode = newMode;
    // Wenn der aktive Tab durch den Mode-Wechsel unsichtbar wird,
    // springe auf den ersten verfügbaren
    if (this._active && !this.isVisible(this._active)) {
      const fallback = this.visibleTabs()[0];
      this._setActive(fallback ? fallback.id : null);
    }
    return this;
  }

  switchTo(id) {
    if (!this.hasTab(id)) {
      throw new Error(`TabRouter: unbekannter Tab ${id}`);
    }
    if (!this.isVisible(id)) {
      throw new Error(`TabRouter: Tab ${id} ist im aktuellen Mode "${this._mode}" nicht sichtbar`);
    }
    this._setActive(id);
    return this;
  }

  _setActive(id, { silent = false } = {}) {
    const previous = this._active;
    this._active = id;
    if (!silent && previous !== id) {
      this._eventBus.emit(TAB_CHANGED, { from: previous, to: id });
    }
  }

  addTab(tab, { activate = false } = {}) {
    if (!tab || !tab.id) throw new Error("TabRouter.addTab: tab.id erforderlich");
    if (this.hasTab(tab.id)) throw new Error(`TabRouter.addTab: Tab ${tab.id} existiert bereits`);
    this._tabs.push({ ...tab });
    if (activate) this.switchTo(tab.id);
    return this;
  }

  removeTab(id) {
    const idx = this._tabs.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this._tabs.splice(idx, 1);
    if (this._active === id) {
      const fallback = this.visibleTabs()[0];
      this._setActive(fallback ? fallback.id : null);
    }
    return true;
  }
}

export function createTabRouter(opts) {
  return new TabRouter(opts);
}
