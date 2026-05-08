export {
  parseVersion,
  compareVersions,
  isNewer,
  formatVersion
} from "./src/version.mjs";

export {
  CHANNELS,
  isValidChannel,
  detectChannel,
  channelAccepts,
  filterReleasesByChannel
} from "./src/channels.mjs";

export {
  checkForUpdate,
  createUpdateChecker
} from "./src/update-check.mjs";
