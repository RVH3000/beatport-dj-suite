import { Track } from './engine-db.js';
import { engineKeyToTonality } from './export-rekordbox.js';

const BOM = '﻿';
const SEP = ',';
const EOL = '\r\n';

function csvCell(v: string | number | null | undefined): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(SEP) || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function ratingToStars(rating: number | null | undefined): string {
    const s = Math.max(0, Math.min(5, Math.round(((rating || 0) / 10) * 2) / 2));
    return s.toFixed(1).replace('.', ',');
}

function secondsToMmSs(total: number | null | undefined): string {
    if (!total || total <= 0) return '';
    const m = Math.floor(total / 60);
    const s = Math.round(total - m * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function lastPlayedIso(unixSec: number | null | undefined): string {
    if (!unixSec) return '';
    const d = new Date(unixSec * 1000);
    return isNaN(d.valueOf()) ? '' : d.toISOString();
}

const HEADERS = [
    'Title',
    'Artist',
    'Album',
    'Genre',
    'Label',
    'Year',
    'BPM',
    'Key',
    'Rating (0-5)',
    'Length (s)',
    'Length (mm:ss)',
    'Path',
    'Comment',
    'Streaming-Source',
    'Last-Played',
];

export function buildTracksCsv(tracks: Track[]): string {
    const rows: string[] = [];
    rows.push(HEADERS.map(csvCell).join(SEP));
    for (const t of tracks) {
        rows.push([
            csvCell(t.title),
            csvCell(t.artist),
            csvCell(t.album),
            csvCell(t.genre),
            csvCell(t.label),
            csvCell(t.year || ''),
            csvCell(t.bpm ? t.bpm.toFixed(2).replace('.', ',') : ''),
            csvCell(engineKeyToTonality(t.key as unknown as number)),
            csvCell(ratingToStars(t.rating)),
            csvCell(t.length || ''),
            csvCell(secondsToMmSs(t.length)),
            csvCell(t.path || t.uri || ''),
            csvCell(t.comment),
            csvCell(t.streamingSource || ''),
            csvCell(lastPlayedIso(t.timeLastPlayed)),
        ].join(SEP));
    }
    return BOM + rows.join(EOL) + EOL;
}
