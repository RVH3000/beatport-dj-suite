import { eventBus as defaultBus, AppError } from "@bpdjs/core";
import { normalizeKey } from "./camelot.mjs";

export const PLAYLIST_CHANGED = "playlist:changed";

/**
 * Ein Track ist ein Plain-Object mit folgenden Pflicht-/Optional-Feldern:
 *  id      — eindeutig (string)
 *  title   — Track-Titel (string)
 *  artists — Array<string> oder String
 *  bpm     — Number (optional)
 *  key     — String (z. B. "Am", "8A", "C# min") (optional)
 *  camelot — bevorzugter Camelot-String (optional, wird sonst aus key abgeleitet)
 *  durationMs — Number (optional)
 */

export function normalizeTrack(input = {}) {
  if (!input.id) throw new AppError("Track.id erforderlich", { code: "E_TRACK_NO_ID" });
  const camelot = input.camelot ? String(input.camelot).toUpperCase() : normalizeKey(input.key);
  return {
    id: String(input.id),
    title: input.title ? String(input.title) : "",
    artists: Array.isArray(input.artists) ? [...input.artists] : (input.artists ? [String(input.artists)] : []),
    bpm: typeof input.bpm === "number" ? input.bpm : null,
    key: input.key ? String(input.key) : null,
    camelot: camelot || null,
    durationMs: typeof input.durationMs === "number" ? input.durationMs : null
  };
}

export class Playlist {
  constructor({ id, name = "Untitled", tracks = [], eventBus = defaultBus } = {}) {
    if (!id) throw new AppError("Playlist.id erforderlich", { code: "E_PLAYLIST_NO_ID" });
    this._id = String(id);
    this._name = String(name);
    this._tracks = tracks.map(normalizeTrack);
    this._eventBus = eventBus;
  }

  get id() { return this._id; }
  get name() { return this._name; }
  get tracks() { return this._tracks.map((t) => ({ ...t })); }
  get length() { return this._tracks.length; }

  rename(newName) {
    this._name = String(newName);
    this._emit("rename");
    return this;
  }

  addTrack(track, { at = -1 } = {}) {
    const t = normalizeTrack(track);
    const idx = at < 0 ? this._tracks.length : Math.min(at, this._tracks.length);
    this._tracks.splice(idx, 0, t);
    this._emit("add", { trackId: t.id, position: idx });
    return this;
  }

  removeTrack(trackId) {
    const idx = this._tracks.findIndex((t) => t.id === String(trackId));
    if (idx === -1) return false;
    this._tracks.splice(idx, 1);
    this._emit("remove", { trackId: String(trackId), position: idx });
    return true;
  }

  moveTrack(trackId, newPosition) {
    const idx = this._tracks.findIndex((t) => t.id === String(trackId));
    if (idx === -1) return false;
    const [track] = this._tracks.splice(idx, 1);
    const target = Math.max(0, Math.min(newPosition, this._tracks.length));
    this._tracks.splice(target, 0, track);
    this._emit("move", { trackId: String(trackId), from: idx, to: target });
    return true;
  }

  trackAt(index) {
    return this._tracks[index] ? { ...this._tracks[index] } : null;
  }

  findTrack(trackId) {
    const t = this._tracks.find((x) => x.id === String(trackId));
    return t ? { ...t } : null;
  }

  toJSON() {
    return {
      id: this._id,
      name: this._name,
      tracks: this.tracks
    };
  }

  _emit(action, payload = {}) {
    this._eventBus.emit(PLAYLIST_CHANGED, { playlistId: this._id, action, ...payload });
  }
}

export function createPlaylist(opts) {
  return new Playlist(opts);
}
