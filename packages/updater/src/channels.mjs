import { parseVersion } from "./version.mjs";

/**
 * Release-Channels in absteigender Stabilität.
 * "stable" = Releases ohne Prerelease-Tag.
 * "beta" / "alpha" = Releases mit entsprechendem Prerelease-Prefix
 *  (4.2.7-beta.1, 4.2.7-alpha.3).
 */

export const CHANNELS = Object.freeze(["stable", "beta", "alpha"]);
const CHANNEL_RANK = Object.freeze({ stable: 0, beta: 1, alpha: 2 });

export function isValidChannel(channel) {
  return Object.prototype.hasOwnProperty.call(CHANNEL_RANK, channel);
}

export function detectChannel(version) {
  const parsed = typeof version === "string" ? parseVersion(version) : version;
  if (!parsed.prerelease) return "stable";
  const head = parsed.prerelease.split(".")[0].toLowerCase();
  if (head === "beta") return "beta";
  if (head === "alpha") return "alpha";
  // Unbekannte Prerelease-Labels werden konservativ als "alpha" eingestuft.
  return "alpha";
}

/**
 * Liefert true, wenn `versionChannel` mindestens so stabil ist wie `target`.
 * Beispiel: ein User auf "beta" akzeptiert "stable" und "beta", aber kein "alpha".
 */
export function channelAccepts(target, versionChannel) {
  if (!isValidChannel(target)) throw new Error(`Unknown channel: ${target}`);
  if (!isValidChannel(versionChannel)) {
    throw new Error(`Unknown channel: ${versionChannel}`);
  }
  return CHANNEL_RANK[versionChannel] <= CHANNEL_RANK[target];
}

export function filterReleasesByChannel(releases, targetChannel) {
  if (!isValidChannel(targetChannel)) {
    throw new Error(`Unknown channel: ${targetChannel}`);
  }
  return releases.filter((r) => channelAccepts(targetChannel, detectChannel(r.version)));
}
