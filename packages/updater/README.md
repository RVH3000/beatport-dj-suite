# @bpdjs/updater

Auto-Update-Logik der Beatport DJ Suite. **Reine Logik ohne Netz-IO** — der Konsument liefert Release-Daten via Fetcher rein, das Paket entscheidet.

## Module

### `version` — Semver-Light
```js
import { parseVersion, compareVersions, isNewer } from "@bpdjs/updater/version";

isNewer("4.2.8", "4.2.7"); // true
compareVersions("4.2.7-beta", "4.2.7"); // -1 (Prerelease < Release)
```

### `channels` — Release-Channels
Drei Stufen in absteigender Stabilität: `stable` < `beta` < `alpha`.

```js
import { detectChannel, filterReleasesByChannel } from "@bpdjs/updater/channels";

detectChannel("4.2.7-beta.1"); // "beta"
filterReleasesByChannel(releases, "beta"); // stable + beta, kein alpha
```

### `update-check` — Versions-Check
```js
import { checkForUpdate, createUpdateChecker } from "@bpdjs/updater/update-check";

// Pure function:
const result = checkForUpdate({
  current: "4.2.7",
  channel: "stable",
  releases: [{ version: "4.2.8" }, { version: "4.2.9-beta.1" }]
});
// → { updateAvailable: true, latest: { version: "4.2.8" }, currentChannel, requestedChannel, fromReleases }

// Mit injizierbarem Fetcher (Netz-IO bleibt beim Konsumenten):
const checker = createUpdateChecker({
  fetchReleases: async () => fetchFromGitHub()
});
const r = await checker.check({ current: "4.2.7", channel: "stable" });
```
