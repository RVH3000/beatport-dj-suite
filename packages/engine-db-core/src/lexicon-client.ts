const DEFAULT_BASE = process.env.LEXICON_API_BASE || 'http://localhost:48624';

export interface LexiconPlaylistNode {
    id: number;
    name: string;
    type: string;         // "1" = folder, "2" = playlist, "3" = smartlist
    folderType?: string | null;
    parentId: number | null;
    position: number;
    playlists?: LexiconPlaylistNode[];
    smartlist?: unknown;
}

export interface FlatLexiconPlaylist {
    id: number;
    name: string;
    type: 'folder' | 'playlist' | 'smartlist' | 'unknown';
    pathParts: string[];  // e.g. ["ROOT", "Beatport", "Dec 11"]
    parentId: number | null;
}

function typeLabel(type: string): FlatLexiconPlaylist['type'] {
    if (type === '1') return 'folder';
    if (type === '2') return 'playlist';
    if (type === '3') return 'smartlist';
    return 'unknown';
}

function flatten(
    nodes: LexiconPlaylistNode[],
    parentPath: string[],
    out: FlatLexiconPlaylist[]
): void {
    for (const n of nodes) {
        const path = [...parentPath, n.name];
        out.push({
            id: n.id,
            name: n.name,
            type: typeLabel(n.type),
            pathParts: path,
            parentId: n.parentId,
        });
        if (n.playlists && n.playlists.length > 0) {
            flatten(n.playlists, path, out);
        }
    }
}

export async function fetchLexiconPlaylists(base: string = DEFAULT_BASE): Promise<FlatLexiconPlaylist[]> {
    const res = await fetch(`${base}/v1/playlists`);
    if (!res.ok) {
        throw new Error(`Lexicon API ${res.status}: ${res.statusText}`);
    }
    const body = await res.json() as { data: { playlists: LexiconPlaylistNode[] } };
    const roots = body?.data?.playlists ?? [];
    const flat: FlatLexiconPlaylist[] = [];
    flatten(roots, [], flat);
    return flat;
}

export interface PlaylistMatch {
    name: string;
    existsInLexicon: boolean;
    matchedIds: number[];
    matchedPaths: string[][];
}

/**
 * For each name, check whether a Lexicon playlist (or folder/smartlist) with that exact name exists.
 * Returns full match info including path so the caller can disambiguate duplicates.
 */
export async function checkNamesAgainstLexicon(
    names: string[],
    base: string = DEFAULT_BASE,
): Promise<PlaylistMatch[]> {
    const flat = await fetchLexiconPlaylists(base);
    const byName = new Map<string, FlatLexiconPlaylist[]>();
    for (const p of flat) {
        const key = p.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key)!.push(p);
    }
    return names.map(name => {
        const matches = byName.get(name.toLowerCase()) ?? [];
        return {
            name,
            existsInLexicon: matches.length > 0,
            matchedIds: matches.map(m => m.id),
            matchedPaths: matches.map(m => m.pathParts),
        };
    });
}
