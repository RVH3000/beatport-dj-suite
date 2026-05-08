import { logger as defaultLogger } from "@bpdjs/core";
import { compareVersions, isNewer, parseVersion } from "./version.mjs";
import { detectChannel, filterReleasesByChannel, isValidChannel } from "./channels.mjs";

/**
 * Reine Update-Check-Funktion. Erhält:
 * - current: aktuell installierte Version (String, z. B. "4.2.7")
 * - releases: Array { version, url?, notes?, publishedAt? }
 * - channel: "stable" | "beta" | "alpha" (default "stable")
 *
 * Liefert:
 * - { updateAvailable, current, latest, currentChannel, fromReleases }
 */
export function checkForUpdate({ current, releases, channel = "stable" } = {}) {
  if (!current) throw new Error("checkForUpdate: current erforderlich");
  if (!Array.isArray(releases)) throw new Error("checkForUpdate: releases muss Array sein");
  if (!isValidChannel(channel)) throw new Error(`checkForUpdate: ungültiger channel "${channel}"`);

  const currentParsed = parseVersion(current);
  const currentChannel = detectChannel(currentParsed);

  const eligible = filterReleasesByChannel(releases, channel);
  const sorted = [...eligible].sort((a, b) => compareVersions(b.version, a.version));
  const latest = sorted[0] ?? null;

  const updateAvailable = latest ? isNewer(latest.version, currentParsed) : false;

  return {
    updateAvailable,
    current,
    currentChannel,
    requestedChannel: channel,
    latest,
    fromReleases: sorted.length
  };
}

/**
 * Höhere Stufe: nimmt einen `fetchReleases`-Provider entgegen, der ein
 * Promise<Release[]> liefert. Trennt Netz-IO vom Paket — das Paket selbst
 * macht keine HTTP-Calls.
 */
export function createUpdateChecker({ fetchReleases, logger = defaultLogger } = {}) {
  if (typeof fetchReleases !== "function") {
    throw new Error("createUpdateChecker: fetchReleases muss Funktion sein");
  }
  const log = logger.tag ? logger.tag("updater") : logger;

  return {
    async check({ current, channel = "stable" }) {
      const releases = await fetchReleases();
      const result = checkForUpdate({ current, releases, channel });
      if (result.updateAvailable) {
        log.info(`Update verfügbar: ${current} → ${result.latest.version} (${channel})`);
      } else {
        log.debug?.(`Kein Update — current=${current}, channel=${channel}`);
      }
      return result;
    }
  };
}
