import fs from "node:fs/promises";

function resolveTrackLocation(track = {}) {
  return String(track.location ?? track.filename ?? track.path ?? "").trim();
}

function toDurationSeconds(track = {}) {
  const duration = Number(track.duration ?? track.durationMs ?? track.lengthMs);
  if (!Number.isFinite(duration) || duration <= 0) {
    return -1;
  }
  if (duration > 10_000) {
    return Math.round(duration / 1000);
  }
  return Math.round(duration);
}

function escapeLine(text) {
  return String(text ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function buildM3uContent(name, tracks = []) {
  const lines = ["#EXTM3U", `#PLAYLIST:${escapeLine(name || "Beatport DJ Suite")}`];

  for (const track of tracks) {
    const location = resolveTrackLocation(track);
    if (!location) continue;
    const artist = escapeLine(track.artist ?? track.artists ?? "Unknown Artist");
    const title = escapeLine(track.title ?? track.name ?? "Untitled");
    const duration = toDurationSeconds(track);
    lines.push(`#EXTINF:${duration},${artist} - ${title}`);
    if (track.genre) {
      lines.push(`#EXTGENRE:${escapeLine(track.genre)}`);
    }
    lines.push(location);
  }

  return `${lines.join("\n")}\n`;
}

export async function exportM3uPlaylist({ name, tracks = [], outputPath }) {
  if (!outputPath) {
    throw new Error("outputPath ist erforderlich.");
  }
  const content = buildM3uContent(name, tracks);
  await fs.writeFile(outputPath, content, "utf8");
  const writtenCount = tracks.filter((track) => Boolean(resolveTrackLocation(track))).length;
  return {
    ok: true,
    path: outputPath,
    name: name || "Beatport DJ Suite",
    trackCount: tracks.length,
    writtenCount,
    format: outputPath.toLowerCase().endsWith(".m3u8") ? "m3u8" : "m3u",
  };
}
