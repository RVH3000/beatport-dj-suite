import path from 'path';
import { Track } from './engine-db.js';

function escapeXml(s: string | null | undefined): string {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Engine DJ stores key as an integer (0 = none, 1–12 = major C..B, 13–24 = minor Cm..Bm)
export function engineKeyToTonality(keyRaw: string | number | null | undefined): string {
    if (keyRaw === null || keyRaw === undefined) return '';
    const k = typeof keyRaw === 'string' ? parseInt(keyRaw, 10) : keyRaw;
    if (!k || Number.isNaN(k)) return '';
    const notes = ['', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    if (k >= 1 && k <= 12) return notes[k];
    if (k >= 13 && k <= 24) return notes[k - 12] + 'm';
    return '';
}

// Engine DJ rating 0–100 in 10-unit steps → Rekordbox 0–255 in 51-unit steps
function engineRatingToRekordbox(rating: number | null | undefined): number {
    const stars = Math.round(((rating || 0) / 10));
    return Math.max(0, Math.min(5, stars)) * 51;
}

function toLocation(t: Track, musicRoot: string): string {
    if (t.path) {
        // Engine DJ paths can be relative ("../Lexicon/...") or absolute. Resolve to absolute.
        const abs = path.resolve(musicRoot, t.path);
        // file://localhost/abs-path, URI-escape the path
        return 'file://localhost' + encodeURI(abs).replace(/#/g, '%23');
    }
    if (t.uri) {
        // streaming://Beatport%20LINK/Track/1234
        return t.uri;
    }
    return '';
}

export interface RekordboxExportOptions {
    playlistName: string;
    tracks: Track[];
    musicRoot: string;
    includeStreaming?: boolean;
}

export function buildRekordboxXml({ playlistName, tracks, musicRoot, includeStreaming = true }: RekordboxExportOptions): string {
    const filtered = includeStreaming ? tracks : tracks.filter(t => !t.streamingSource);
    const collectionEntries = filtered.map(t => {
        const attrs: Record<string, string | number> = {
            TrackID: t.id,
            Name: escapeXml(t.title),
            Artist: escapeXml(t.artist),
            Album: escapeXml(t.album),
            Genre: escapeXml(t.genre),
            Kind: escapeXml(t.streamingSource || 'MP3 File'),
            TotalTime: t.length || 0,
            AverageBpm: (t.bpm || 0).toFixed(2),
            Rating: engineRatingToRekordbox(t.rating),
            Tonality: escapeXml(engineKeyToTonality(t.key as unknown as number)),
            Year: t.year || 0,
            Comments: escapeXml(t.comment),
            Label: escapeXml(t.label),
            Location: escapeXml(toLocation(t, musicRoot)),
        };
        const attrsStr = Object.entries(attrs)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ');
        return `    <TRACK ${attrsStr}/>`;
    }).join('\n');

    const playlistRefs = filtered.map(t => `      <TRACK Key="${t.id}"/>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.7.0" Company="AlphaTheta"/>
  <COLLECTION Entries="${filtered.length}">
${collectionEntries}
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Name="${escapeXml(playlistName)}" Type="1" KeyType="0" Entries="${filtered.length}">
${playlistRefs}
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>
`;
}
