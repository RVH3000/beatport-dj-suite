import { logger as defaultLogger } from "@bpdjs/core";

/**
 * Smoke-Test-Runner für die Beatport DJ Suite.
 * Sammelt benannte Checks und führt sie sequentiell aus, mit klarer
 * Ergebnis-Tabelle: pass/fail + Dauer pro Check.
 *
 * Verwendung im Dev-Mode oder beim Release-Smoke-Test.
 */

export class SmokeRunner {
  constructor({ logger = defaultLogger } = {}) {
    this._checks = [];
    this._logger = logger.tag ? logger.tag("smoke") : logger;
  }

  add(name, fn) {
    if (!name) throw new Error("SmokeRunner.add: name erforderlich");
    if (typeof fn !== "function") throw new Error("SmokeRunner.add: fn muss Funktion sein");
    this._checks.push({ name, fn });
    return this;
  }

  async run({ stopOnFail = false } = {}) {
    const results = [];
    let allOk = true;
    for (const { name, fn } of this._checks) {
      const start = Date.now();
      try {
        const out = await fn();
        const ms = Date.now() - start;
        results.push({ name, ok: true, durationMs: ms, value: out });
        this._logger.info(`✓ ${name} (${ms}ms)`);
      } catch (err) {
        const ms = Date.now() - start;
        results.push({ name, ok: false, durationMs: ms, error: err.message });
        this._logger.error(`✗ ${name} (${ms}ms): ${err.message}`);
        allOk = false;
        if (stopOnFail) break;
      }
    }
    return {
      ok: allOk,
      total: this._checks.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results
    };
  }

  get checkCount() { return this._checks.length; }
}

export function createSmokeRunner(opts) {
  return new SmokeRunner(opts);
}
