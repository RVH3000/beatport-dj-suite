/**
 * Beatport-API-Konstanten — eingefroren auf v4.1-Werte.
 * Diese sind reine Daten (keine Logik), daher hier kopiert statt re-exportiert.
 */

export const BEATPORT_API_BASE = "https://api.beatport.com/v4";
export const BEATPORT_PER_PAGE = 100;
export const BEATPORT_TRACKS_PER_PAGE = 100;
export const BEATPORT_DEFAULT_CONCURRENCY = 3;
export const BEATPORT_REQUEST_DELAY_MS = 200;
export const BEATPORT_MAX_RETRIES = 3;
export const BEATPORT_RETRY_DELAY_MS = 2000;

export const BEATPORT_USER_DATA_PATHS = Object.freeze([
  "Library/Application Support/Beatport/Beatport",
  ".config/Beatport/Beatport"
]);
