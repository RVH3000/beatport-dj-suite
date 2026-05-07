import { ConfigStore, eventBus as defaultBus } from "@bpdjs/core";

export const FEATURE_FLAG_CHANGED = "mode:flag-changed";

/**
 * Feature-Flag-Layer auf Basis von ConfigStore aus @bpdjs/core.
 * Wrappt Boolesche Flags und feuert Events bei Änderung — andere Module
 * (UI, Scanner, etc.) können sich anhören und ihr Verhalten umschalten.
 *
 * Beispiel:
 *   const flags = createFeatureFlags({ defaults: { fuzzyDupes: false } });
 *   flags.enable("fuzzyDupes");
 *   if (flags.isEnabled("fuzzyDupes")) { ... }
 */
export class FeatureFlags {
  constructor({ defaults = {}, eventBus = defaultBus } = {}) {
    this._store = new ConfigStore(this._normalizeDefaults(defaults));
    this._eventBus = eventBus;
  }

  _normalizeDefaults(defaults) {
    const out = {};
    for (const [k, v] of Object.entries(defaults || {})) {
      out[k] = Boolean(v);
    }
    return out;
  }

  isEnabled(flag) {
    return Boolean(this._store.get(flag));
  }

  enable(flag) { return this.set(flag, true); }
  disable(flag) { return this.set(flag, false); }

  set(flag, value) {
    const next = Boolean(value);
    const prev = Boolean(this._store.get(flag));
    if (prev === next) return this;
    this._store.set(flag, next);
    this._eventBus.emit(FEATURE_FLAG_CHANGED, { flag, value: next, previous: prev });
    return this;
  }

  toggle(flag) {
    return this.set(flag, !this.isEnabled(flag));
  }

  toJSON() {
    return this._store.toJSON();
  }

  reset() {
    this._store.reset();
    return this;
  }

  list() {
    return Object.keys(this._store.toJSON());
  }
}

export function createFeatureFlags(opts) {
  return new FeatureFlags(opts);
}
