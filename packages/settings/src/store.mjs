import { ConfigStore, eventBus as defaultBus, logger as defaultLogger } from "@bpdjs/core";
import { writeJsonAtomic, readJsonOptional } from "@bpdjs/file-manager";

export const SETTINGS_CHANGED = "settings:changed";
export const SETTINGS_LOADED = "settings:loaded";
export const SETTINGS_RESET = "settings:reset";

export class SettingsStore {
  constructor({ filePath, defaults = {}, eventBus = defaultBus, logger = defaultLogger } = {}) {
    if (!filePath) throw new Error("SettingsStore: filePath erforderlich");
    this._filePath = filePath;
    this._config = new ConfigStore(defaults);
    this._eventBus = eventBus;
    this._logger = logger.tag ? logger.tag("settings") : logger;
    this._loaded = false;
    this._writeQueue = Promise.resolve();
  }

  get filePath() { return this._filePath; }
  get isLoaded() { return this._loaded; }

  async load() {
    const data = await readJsonOptional(this._filePath);
    if (data && typeof data === "object") {
      this._config.merge(data);
      this._logger.info(`Settings geladen aus ${this._filePath}`);
    } else {
      this._logger.info(`Keine Settings-Datei (verwende Defaults): ${this._filePath}`);
    }
    this._loaded = true;
    this._eventBus.emit(SETTINGS_LOADED, { values: this._config.toJSON() });
    return this;
  }

  get(key, fallback) { return this._config.get(key, fallback); }
  has(key) { return this._config.has(key); }
  toJSON() { return this._config.toJSON(); }

  async set(key, value) {
    this._config.set(key, value);
    this._logger.info(`set ${key}=${JSON.stringify(value)}`);
    this._eventBus.emit(SETTINGS_CHANGED, { key, value });
    await this._persist();
    return this;
  }

  async merge(obj) {
    this._config.merge(obj);
    this._logger.info(`merge ${Object.keys(obj || {}).join(",")}`);
    for (const [key, value] of Object.entries(obj || {})) {
      this._eventBus.emit(SETTINGS_CHANGED, { key, value });
    }
    await this._persist();
    return this;
  }

  async reset(key) {
    this._config.reset(key);
    this._logger.info(`reset ${key || "<all>"}`);
    this._eventBus.emit(SETTINGS_RESET, { key: key || null });
    await this._persist();
    return this;
  }

  _persist() {
    this._writeQueue = this._writeQueue.then(async () => {
      try {
        await writeJsonAtomic(this._filePath, this._config.toJSON());
      } catch (err) {
        this._logger.error(`persist failed: ${err.message}`);
        throw err;
      }
    });
    return this._writeQueue;
  }
}

export function createSettings(opts) {
  return new SettingsStore(opts);
}
