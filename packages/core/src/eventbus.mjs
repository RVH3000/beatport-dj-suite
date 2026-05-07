import { EventEmitter } from "node:events";

export class EventBus {
  constructor({ maxListeners = 100 } = {}) {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(maxListeners);
  }

  on(event, listener) {
    this._emitter.on(event, listener);
    return () => this.off(event, listener);
  }

  once(event, listener) {
    this._emitter.once(event, listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    this._emitter.off(event, listener);
    return this;
  }

  emit(event, payload) {
    return this._emitter.emit(event, payload);
  }

  listenerCount(event) {
    return this._emitter.listenerCount(event);
  }

  clear(event) {
    if (event) this._emitter.removeAllListeners(event);
    else this._emitter.removeAllListeners();
    return this;
  }
}

export const eventBus = new EventBus();

export function createEventBus(opts = {}) {
  return new EventBus(opts);
}
