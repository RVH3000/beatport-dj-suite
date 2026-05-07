import { logger as defaultLogger } from "@bpdjs/core";

export const BOOT_PHASES = ["pre-init", "config-load", "ipc-bind", "ui-mount", "ready"];

/**
 * Pure-JS Boot-Sequenz-Tracker. Hilft die App-Initialisierung zu strukturieren
 * und Logs/Events pro Boot-Phase zu emittieren. Tests prüfen Reihenfolge
 * und Error-Behavior.
 *
 * Verwendung:
 *   const boot = createBootSequence({ logger });
 *   boot.add("config-load", async () => { ... });
 *   boot.add("ipc-bind", async () => { ... });
 *   const result = await boot.run();
 */
export class BootSequence {
  constructor({ logger = defaultLogger } = {}) {
    this._steps = [];
    this._logger = logger.tag ? logger.tag("boot") : logger;
    this._completed = [];
    this._currentPhase = null;
  }

  get currentPhase() { return this._currentPhase; }
  get completedPhases() { return [...this._completed]; }

  add(phase, fn) {
    if (!BOOT_PHASES.includes(phase)) {
      throw new Error(`BootSequence.add: unbekannte Phase "${phase}" (erlaubt: ${BOOT_PHASES.join(", ")})`);
    }
    if (typeof fn !== "function") {
      throw new Error("BootSequence.add: fn muss Funktion sein");
    }
    this._steps.push({ phase, fn });
    return this;
  }

  async run() {
    const sortedSteps = [];
    for (const phase of BOOT_PHASES) {
      for (const step of this._steps) {
        if (step.phase === phase) sortedSteps.push(step);
      }
    }

    const results = [];
    for (const { phase, fn } of sortedSteps) {
      this._currentPhase = phase;
      this._logger.info(`Phase: ${phase}`);
      try {
        const result = await fn();
        results.push({ phase, ok: true, result });
        if (!this._completed.includes(phase)) this._completed.push(phase);
      } catch (err) {
        this._logger.error(`Phase ${phase} fehlgeschlagen: ${err.message}`);
        results.push({ phase, ok: false, error: err.message });
        this._currentPhase = null;
        return { ok: false, results, failedAt: phase };
      }
    }
    this._currentPhase = null;
    return { ok: true, results };
  }
}

export function createBootSequence(opts) {
  return new BootSequence(opts);
}
