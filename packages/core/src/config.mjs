function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = clone(v);
  return out;
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] && typeof target[k] === "object" ? target[k] : {}, v);
    } else {
      target[k] = clone(v);
    }
  }
  return target;
}

function getPath(obj, dottedKey) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  const last = parts.pop();
  let cur = obj;
  for (const p of parts) {
    if (!cur[p] || typeof cur[p] !== "object" || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[last] = clone(value);
}

export class ConfigStore {
  constructor(defaults = {}) {
    this._values = clone(defaults);
    this._defaults = clone(defaults);
  }

  get(key, fallback) {
    if (!key) return clone(this._values);
    const v = getPath(this._values, key);
    return v === undefined ? fallback : clone(v);
  }

  set(key, value) {
    setPath(this._values, key, value);
    return this;
  }

  merge(obj) {
    deepMerge(this._values, obj);
    return this;
  }

  has(key) {
    return getPath(this._values, key) !== undefined;
  }

  reset(key) {
    if (key) {
      const def = getPath(this._defaults, key);
      if (def === undefined) {
        const parts = key.split(".");
        const last = parts.pop();
        let cur = this._values;
        for (const p of parts) {
          if (!cur || typeof cur !== "object") return this;
          cur = cur[p];
        }
        if (cur && typeof cur === "object") delete cur[last];
      } else {
        setPath(this._values, key, def);
      }
    } else {
      this._values = clone(this._defaults);
    }
    return this;
  }

  toJSON() {
    return clone(this._values);
  }
}

export function createConfig(defaults = {}) {
  return new ConfigStore(defaults);
}
