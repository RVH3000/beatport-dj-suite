# @bpdjs/dev-tools

Entwicklerwerkzeuge der Beatport DJ Suite: Smoke-Test-Runner und Diagnostics-Collector für Dev-Mode und Release-Checks.

## Module

### `smoke` — `SmokeRunner`
Sequentieller Pass/Fail-Runner mit Dauer pro Check.

```js
import { createSmokeRunner } from "@bpdjs/dev-tools/smoke";

const runner = createSmokeRunner()
  .add("db-reachable", async () => { /* ... */ })
  .add("login-cookie-set", async () => { /* ... */ });

const result = await runner.run({ stopOnFail: false });
// { ok, total, passed, failed, results: [{ name, ok, durationMs, value | error }] }
```

### `diagnostics` — `DiagnosticsCollector`
Sammelt strukturierte Diagnose-Daten (Environment + benannte Checks). Kein Pass/Fail — jeder Check liefert JSON-Werte für einen Report.

```js
import { createDiagnosticsCollector, formatDiagnosticsReport } from "@bpdjs/dev-tools/diagnostics";

const dc = createDiagnosticsCollector()
  .register("engine-db-path", () => existsSync(path) ? path : null)
  .register("track-count", async () => await countTracks());

const report = await dc.run();
console.log(formatDiagnosticsReport(report));
```

Report-Struktur:
```
{ startedAt, finishedAt, environment: { node, platform, memory, os }, checks: { <name>: { ok, durationMs, value | error } } }
```
