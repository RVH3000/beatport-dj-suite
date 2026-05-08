import os from "node:os";
import process from "node:process";
import { logger as defaultLogger } from "@bpdjs/core";

/**
 * Diagnostics-Collector für die Beatport DJ Suite.
 * Sammelt strukturierte Diagnose-Daten: Umgebung (Node, Plattform, Speicher)
 * + benannte Checks, die beliebige JSON-Werte zurückgeben.
 *
 * Im Unterschied zum SmokeRunner gibt es kein pass/fail — jeder Check liefert
 * Daten, die in einem Report gesammelt werden. Fehler werden als
 * `{ error: <message> }` festgehalten, ohne den Lauf abzubrechen.
 */

export function collectEnvironment() {
  const mem = process.memoryUsage();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    cwd: process.cwd(),
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
    },
    os: {
      release: os.release(),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      cpuCount: os.cpus().length
    }
  };
}

export class DiagnosticsCollector {
  constructor({ logger = defaultLogger, includeEnvironment = true } = {}) {
    this._checks = [];
    this._includeEnvironment = includeEnvironment;
    this._logger = logger.tag ? logger.tag("diagnostics") : logger;
  }

  register(name, fn) {
    if (!name) throw new Error("DiagnosticsCollector.register: name erforderlich");
    if (typeof fn !== "function") {
      throw new Error("DiagnosticsCollector.register: fn muss Funktion sein");
    }
    this._checks.push({ name, fn });
    return this;
  }

  async run() {
    const startedAt = new Date().toISOString();
    const checks = {};
    for (const { name, fn } of this._checks) {
      const start = Date.now();
      try {
        const value = await fn();
        checks[name] = { ok: true, durationMs: Date.now() - start, value };
      } catch (err) {
        checks[name] = { ok: false, durationMs: Date.now() - start, error: err.message };
        this._logger.warn(`diagnostics check "${name}" failed: ${err.message}`);
      }
    }
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      checks
    };
    if (this._includeEnvironment) {
      report.environment = collectEnvironment();
    }
    return report;
  }

  get checkCount() { return this._checks.length; }
}

export function createDiagnosticsCollector(opts) {
  return new DiagnosticsCollector(opts);
}

/**
 * Formatiert einen Diagnostics-Report als menschenlesbaren Text-Block.
 * Praktisch für Konsolen-Output oder Bug-Reports.
 */
export function formatDiagnosticsReport(report) {
  const lines = [];
  lines.push(`Diagnostics-Report (${report.startedAt} → ${report.finishedAt})`);
  if (report.environment) {
    const env = report.environment;
    lines.push("");
    lines.push("Umgebung:");
    lines.push(`  Node:     ${env.node} (${env.platform}/${env.arch})`);
    lines.push(`  Memory:   rss=${env.memory.rssMb}MB heap=${env.memory.heapUsedMb}/${env.memory.heapTotalMb}MB`);
    lines.push(`  OS:       ${env.os.release}, ${env.os.cpuCount} CPUs, ${env.os.freeMemMb}/${env.os.totalMemMb}MB frei`);
  }
  const entries = Object.entries(report.checks);
  if (entries.length) {
    lines.push("");
    lines.push("Checks:");
    for (const [name, result] of entries) {
      const marker = result.ok ? "✓" : "✗";
      const detail = result.ok
        ? JSON.stringify(result.value)
        : `error: ${result.error}`;
      lines.push(`  ${marker} ${name} (${result.durationMs}ms) — ${detail}`);
    }
  }
  return lines.join("\n");
}
