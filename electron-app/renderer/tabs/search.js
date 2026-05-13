/**
 * Search & Filter Tab — Beatport PL WIZ v5 Integration
 *
 * Portiert die volle PL WIZ v5 Funktionalität in die Electron-App:
 * - Dashboard (Stats, Genre-Bars, BPM-Cluster, Tonarten, Timeline)
 * - Suche & Filter mit BPM-Lock, Drama-Score, Progressive Filtering
 * - Duplikate-Erkennung
 * - Playlist Builder mit Drag&Drop, Camelot-Kompatibilität, BPM-Flow
 * - Export (CSV, JSON, Snapshot)
 * - Daten-Laden (scoring-data.json via IPC oder Drag&Drop)
 */

// ─── State ────────────────────────────────────────────────────────────────────

let _initialized = false;
let allTracks = null;        // Full scoring-data.json tracks
let dashData = null;         // Dashboard data (from cache or inline)
let searchResults = [];
let selectedIds = new Set();
let playlist = [];
let currentPage = 0;
const PAGE_SIZE = 100;
let lockedSorts = [];        // [{col:'bpm',dir:1}, ...]
let sortScope = "page";      // 'global' oder 'page'
let poolFilter = "";
let poolCache = [];
let dupData = [];
let dupFiltered = [];
let playlistNameMap = new Map(); // playlist ID → name
let audioEl = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

import {
  fmt,
  esc,
  debounce,
  badgeCls,
  normBpm,
  camelotSortVal,
  camelotCompat,
  dramaScore as _dramaScorePure,
  dramaColor,
  buildQueryMatcher,
} from "../lib/track-utils.js";

const q = (s) => '"' + (s || "").replace(/"/g, '""') + '"';

// ─── BPM Normalisierung ──────────────────────────────────────────────────────
// bpmNormActive bleibt hier (DOM-gebunden, kann nicht in track-utils.js).

function bpmNormActive() {
  return document.getElementById("srchBpmNormToggle")?.checked ?? false;
}

function bpmDisplay(bpm) {
  if (!bpm) return "—";
  const norm = normBpm(bpm);
  if (Math.abs(norm - bpm) < 0.5) return `<span style="color:#ff6b35;font-weight:700">${bpm}</span>`;
  return `<span style="color:#ff6b35;font-weight:700">${bpm}</span> <span class="srch-bpm-norm">(&rarr;${Math.round(norm)})</span>`;
}

// dramaScore-Wrapper: reicht aktuellen DOM-Toggle-Status durch.
function dramaScore(bpm, camelot) {
  return _dramaScorePure(bpm, camelot, { useNorm: bpmNormActive() });
}

function getSearchSource() {
  if (!allTracks) return [];
  return allTracks.map((t) => ({
    track_id: t.i, title: t.t, mix_name: t.m || "", artists: t.a, genre: t.g,
    sub_genre: t.sg || "", bpm: t.b, bpmNorm: normBpm(t.b), key: t.k,
    camelot: t.c || "", year: t.y, label: t.l || "", release: t.r || "",
    length_ms: t.ms, count: t.p ? t.p.length : 0,
    is_hype: t.h || 0, is_dj_edit: t.dj || 0, sample_url: t.su || "",
    rating: t.rating || null, plays_total: t.plays_total || 0,
    file_path: t.file_path || "", comment: t.comment || "",
    drama: dramaScore(t.b, t.c),
  }));
}

// ─── Multi-Sort / Lock System ────────────────────────────────────────────────

function getSortVal(t, col, bucketed) {
  switch (col) {
    case "count": return t.count || 0;
    case "camelot": return camelotSortVal(t.camelot);
    case "bpm": { const v = bpmNormActive() ? (t.bpmNorm || 0) : (t.bpm || 0); return bucketed ? Math.floor(v / 5) * 5 : v; }
    case "bpmNorm": { const v = t.bpmNorm || 0; return bucketed ? Math.floor(v / 5) * 5 : v; }
    case "drama": { const v = t.drama || 0; return bucketed ? Math.floor(v / 10) * 10 : v; }
    case "year": return t.year || 0;
    case "genre": return t.genre || "";
    case "label": return t.label || "";
    case "title": return t.title || "";
    case "artist": return t.artists || "";
    default: return t.count || 0;
  }
}

function multiSort(arr, chain) {
  return arr.sort((a, b) => {
    for (const { col, dir, bucketed } of chain) {
      const va = getSortVal(a, col, bucketed);
      const vb = getSortVal(b, col, bucketed);
      let cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb) : (va || 0) - (vb || 0);
      if (cmp !== 0) return dir * cmp;
    }
    return 0;
  });
}

function buildSortChain() {
  const sv = $("srchSort")?.value ?? "count-desc";
  const [col, dir] = sv.split("-");
  const d = dir === "asc" ? 1 : -1;
  const chain = lockedSorts.map((l) => ({ col: l.col, dir: l.dir, bucketed: true }));
  if (!chain.some((l) => l.col === col)) chain.push({ col, dir: d, bucketed: false });
  return chain;
}

function sortResults(results) { return multiSort(results, buildSortChain()); }

/**
 * Pro-Seite-Modus: Verteilt Tracks per Round-Robin auf die Seiten,
 * sodass jede Seite die volle Bandbreite hat (z.B. Camelot 1A→12B,
 * Drama 0→100), statt nur einen Ausschnitt der globalen Sortierung.
 *
 * Ablauf:
 *   1. Global sortieren (z.B. nach Drama aufsteigend)
 *   2. Round-Robin: Track 0→Seite 0, Track 1→Seite 1, ... Track N→Seite 0
 *   3. Jede Seite intern nochmal sortieren
 *
 * Ergebnis: Jede Seite enthält Tracks aus dem gesamten Spektrum.
 */
let _distributedPages = null; // Cache für Round-Robin-verteilte Seiten

function distributeRoundRobin(sorted, pageSize) {
  const totalPages = Math.ceil(sorted.length / pageSize);
  const pages = Array.from({ length: totalPages }, () => []);
  sorted.forEach((track, i) => {
    pages[i % totalPages].push(track);
  });
  // Jede Seite intern sortieren
  const chain = buildSortChain();
  pages.forEach((page) => multiSort(page, chain));
  return pages;
}

function getPageTracks(pageIdx) {
  if (sortScope === "global") {
    // Klassisch: Slice aus global sortierter Liste
    const start = pageIdx * PAGE_SIZE;
    return searchResults.slice(start, Math.min(start + PAGE_SIZE, searchResults.length));
  }
  // Pro Seite: Round-Robin-verteilte Seiten
  if (!_distributedPages) {
    _distributedPages = distributeRoundRobin(searchResults, PAGE_SIZE);
  }
  return _distributedPages[pageIdx] || [];
}

// ─── DOM shorthand ───────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ─── Main Entry ──────────────────────────────────────────────────────────────

export async function initSearchTab() {
  if (_initialized) return;
  _initialized = true;

  const container = $("search-content");
  if (!container) return;

  container.innerHTML = buildSearchTabHtml();
  bindSearchEvents();

  // Try auto-loading scoring-data.json from default path
  tryAutoLoad();
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function buildSearchTabHtml() {
  return `
    <!-- Sub-Tab Navigation -->
    <div class="srch-subtabs">
      <button class="srch-subtab active" data-stab="srch-dashboard" title="Schnellüberblick: Genres, BPM-Cluster und Tonarten als Sprungpunkte in die Suche">Dashboard</button>
      <button class="srch-subtab" data-stab="srch-search" title="Trackdaten durchsuchen, filtern, sortieren und als Playlist vorbereiten">Suche & Filter</button>
      <button class="srch-subtab" data-stab="srch-duplicates" title="Tracks anzeigen, die in mehreren Playlists vorkommen">Duplikate</button>
      <button class="srch-subtab" data-stab="srch-builder" title="Playlist aus gefiltertem Track-Pool bauen und harmonisch/BPM-basiert sortieren">Playlist Builder</button>
      <button class="srch-subtab" data-stab="srch-data" title="scoring-data.json laden und Datenstatus prüfen">Daten</button>
    </div>

    <!-- SUB-TAB: DATEN -->
    <div class="srch-subcontent" id="srch-data">
      <div class="srch-howto">
        <strong>Daten laden:</strong> Die App liest die <strong>scoring-data.json</strong> (22 MB) direkt von der Festplatte.
        Default-Pfad: <kbd>~/Documents/Claude/Projects/Beatport PL WIZ/scoring-data.json</kbd>.
        Du kannst auch eine andere Datei per Drag&Drop oder Datei-Dialog laden.
      </div>
      <div class="srch-dropzone" id="srchDropZone">
        <h3>scoring-data.json laden</h3>
        <p id="srchDataStatus">Klicke hier oder ziehe die Datei hierher</p>
      </div>
      <div class="srch-stats" id="srchDataStats"></div>
    </div>

    <!-- SUB-TAB: DASHBOARD -->
    <div class="srch-subcontent active" id="srch-dashboard">
      <div class="srch-howto">
        <strong>Dashboard:</strong> Klicke auf Genres, BPM-Cluster oder Tonarten, um direkt in die Suche zu springen.
      </div>
      <div id="srchDashNoData" style="text-align:center;padding:40px;color:var(--muted)">
        Lade zuerst die <strong>scoring-data.json</strong> im <strong>Daten</strong>-Tab.
      </div>
      <div id="srchDashContent" style="display:none">
        <div class="srch-stats" id="srchStatsGrid"></div>
        <div class="srch-sec-title">Genre-Verteilung</div>
        <div id="srchGenreBars" style="margin-bottom:24px"></div>
        <div class="srch-sec-title">BPM-Cluster</div>
        <div class="srch-bpm-grid" id="srchBpmGrid" style="margin-bottom:24px"></div>
        <div class="srch-sec-title">Tonarten</div>
        <div class="srch-key-grid" id="srchKeyGrid"></div>
      </div>
    </div>

    <!-- SUB-TAB: SUCHE & FILTER -->
    <div class="srch-subcontent" id="srch-search">
      <!-- EMPFEHLUNGEN — oben, prominent, vor den Filtern -->
      <div id="srchRecoArea" class="srch-reco-top"></div>

      <div class="srch-howto">
        <strong>Suche:</strong> Wildcards <code>*</code> (beliebig) und <code>?</code> (ein Zeichen). <strong>BPM Norm</strong> normalisiert halbe/doppelte Tempi.
        <strong>Lock-System:</strong> Klick auf Spaltenheader = mehrstufige Sortierung (Zahl = Priorität).
      </div>
      <div class="srch-bar">
        <input type="text" id="srchQ" placeholder="Track, Artist, Label, Release suchen...">
        <div class="srch-toggle-wrap" title="BPM auf DJ-Range normalisieren">
          <label class="srch-toggle"><input type="checkbox" id="srchBpmNormToggle"><span class="slider"></span></label>
          <span>BPM Norm</span>
        </div>
        <button class="primary" id="srchResetBtn" type="button" title="Alle Suchfilter, Suchbegriff und Ergebnis-Auswahl zurücksetzen" style="padding:6px 12px;font-size:12px">Reset</button>
      </div>
      <div class="srch-filters">
        <div class="srch-fg srch-fg-wide"><label title="Multi-Select: Klick aktiviert/deaktiviert. Mehrere gleichzeitig moeglich. Sub-Genres filtern automatisch nach gewaehlten Genres.">Genre <span id="srchGenreCount" class="srch-chip-count"></span></label><div id="srchGenreChips" class="srch-chips"></div><select id="srchGenre" hidden><option value="">Alle</option></select></div>
        <div class="srch-fg srch-fg-wide"><label title="Nur Sub-Genres der oben gewaehlten Parent-Genres (kaskadierend). Ohne Genre-Auswahl: alle Sub-Genres.">Sub-Genre <span id="srchSubGenreCount" class="srch-chip-count"></span></label><div id="srchSubGenreChips" class="srch-chips"></div><select id="srchSubGenre" hidden><option value="">Alle</option></select></div>
        <div class="srch-fg"><label title="Untere BPM-Grenze. Mit Normalisierung (Toggle) werden Werte halbiert/verdoppelt fuer Genre-uebergreifende Vergleiche.">BPM Min</label><input type="number" id="srchBpmMin" min="60" max="200" placeholder="60"></div>
        <div class="srch-fg"><label title="Obere BPM-Grenze.">BPM Max</label><input type="number" id="srchBpmMax" min="60" max="200" placeholder="200"></div>
        <div class="srch-fg"><label title="Musikalische Tonart mit Camelot-Code. Perfect/Good/OK/Bad-Kompatibilitaet fuer harmonisches Mixing.">Tonart</label><select id="srchKey"><option value="">Alle</option></select></div>
        <div class="srch-fg"><label title="Release-Zeitraum einschraenken: fruehestes Jahr.">Jahr Min</label><input type="number" id="srchYearMin" min="1990" max="2030" placeholder="1990"></div>
        <div class="srch-fg"><label title="Release-Zeitraum einschraenken: spaetestes Jahr.">Jahr Max</label><input type="number" id="srchYearMax" min="1990" max="2030" placeholder="2026"></div>
        <div class="srch-fg"><label title="Beatport-Label filtern (Top 500, nach Haeufigkeit sortiert).">Label</label><select id="srchLabel"><option value="">Alle</option></select></div>
        <div class="srch-fg"><label title="Hype-Tracks oder DJ Edits filtern.">Flags</label><select id="srchFlags"><option value="">Alle</option><option value="hype">Nur Hype</option><option value="dj">Nur DJ Edit</option></select></div>
        <div class="srch-fg"><label title="Mindest-Rating aus Engine DJ (0-5 Sterne). Nur sichtbar nach Engine-Import.">Rating</label><select id="srchRating"><option value="">Alle</option><option value="1">★+</option><option value="2">★★+</option><option value="3">★★★+</option><option value="4">★★★★+</option><option value="5">★★★★★</option><option value="rated">Bewertet</option><option value="unrated">Unbewertet</option></select></div>
        <div class="srch-fg"><label title="Mindest-Abspielungen in Engine DJ Sessions. Nur sichtbar nach Engine-Import.">Plays</label><input type="number" id="srchPlaysMin" min="0" placeholder="0" title="Mindestens X mal in DJ-Sessions gespielt"></div>
        <div class="srch-fg"><label>Sortierung</label><select id="srchSort">
          <option value="count-desc">PLs absteigend</option><option value="count-asc">PLs aufsteigend</option>
          <option value="bpm-asc">BPM aufsteigend</option><option value="bpm-desc">BPM absteigend</option>
          <option value="bpmNorm-asc">BPM Norm aufsteigend</option><option value="bpmNorm-desc">BPM Norm absteigend</option>
          <option value="camelot-asc">Camelot aufsteigend</option><option value="camelot-desc">Camelot absteigend</option>
          <option value="drama-desc">Dramaturgie &darr;</option><option value="drama-asc">Dramaturgie &uarr;</option>
          <option value="year-desc">Jahr neueste zuerst</option><option value="year-asc">Jahr älteste</option>
          <option value="title-asc">Titel A&rarr;Z</option><option value="artist-asc">Artist A&rarr;Z</option>
          <option value="label-asc">Label A&rarr;Z</option>
        </select></div>
      </div>
      <div class="srch-lock-bar">
        <span style="font-weight:700;color:var(--text)">Fixierung:</span>
        <button class="srch-lock-btn" data-lock="bpm" title="BPM als Sortierpriorität fixieren"><span class="lk"></span> BPM</button>
        <button class="srch-lock-btn" data-lock="camelot" title="Camelot-Kompatibilität als Sortierpriorität fixieren"><span class="lk"></span> Camelot</button>
        <button class="srch-lock-btn" data-lock="drama" title="Dramaturgie-Score als Sortierpriorität fixieren"><span class="lk"></span> Dramaturgie</button>
        <button class="srch-lock-btn" data-lock="year" title="Release-Jahr als Sortierpriorität fixieren"><span class="lk"></span> Jahr</button>
        <button class="srch-lock-btn" data-lock="genre" title="Genre als Sortierpriorität fixieren"><span class="lk"></span> Genre</button>
        <button class="srch-lock-btn" data-lock="label" title="Label als Sortierpriorität fixieren"><span class="lk"></span> Label</button>
        <span style="margin-left:12px;border-left:1px solid var(--line-strong);padding-left:12px">Scope:</span>
        <button class="srch-scope-btn" id="srchScopeGlobal" title="Sortierung auf alle Treffer anwenden">Global</button>
        <button class="srch-scope-btn active" id="srchScopePage" title="Sortierung nur innerhalb der aktuell verteilten Ergebnis-Seite anwenden">Pro Seite</button>
        <button class="srch-lock-btn" id="srchLocksReset" title="Alle fixierten Sortierprioritäten löschen" style="margin-left:auto;border-color:var(--danger);color:var(--danger)">Locks Reset</button>
      </div>
      <div class="srch-result-bar">
        <span id="srchResultCount">0 Treffer</span>
        <span id="srchSelectedCount">0 ausgewählt</span>
        <span id="srchPageInfo"></span>
        <button type="button" id="srchSavePlaylist" class="srch-save-pl-btn" style="margin-left:auto;padding:5px 14px;font-size:12px;font-weight:600;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;display:none" title="Aktuelle Filteransicht als Beatport-Playlist speichern">&#9654; Als Playlist speichern</button>
      </div>
      <!-- Modal: Playlist speichern -->
      <div id="srchPlModal" class="srch-pl-modal" style="display:none">
        <div class="srch-pl-modal-content">
          <h3 style="margin:0 0 12px 0;color:var(--text)">Playlist speichern</h3>
          <label style="font-size:12px;color:var(--muted)">Ziel</label>
          <select id="srchPlModalTarget" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font-size:13px;margin:4px 0 12px 0">
            <option value="beatport">Beatport (online erstellen)</option>
            <option value="engine">Engine DJ Collection</option>
            <option value="m3u">Lokal — M3U Playlist</option>
            <option value="json">Lokal — JSON</option>
            <option value="csv">Lokal — CSV</option>
          </select>
          <div id="srchPlModalEngineDbWrap" style="display:none">
            <label style="font-size:12px;color:var(--muted)">Engine DJ Datenbank</label>
            <select id="srchPlModalEngineDb" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font-size:13px;margin:4px 0 12px 0">
              <option value="">Wird geladen...</option>
            </select>
          </div>
          <label style="font-size:12px;color:var(--muted)">Playlist-Name</label>
          <input type="text" id="srchPlModalName" placeholder="z.B. Deep House Selection" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font-size:14px;margin:4px 0 12px 0">
          <label style="font-size:12px;color:var(--muted)">Quelle</label>
          <select id="srchPlModalSource" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font-size:13px;margin:4px 0 12px 0">
            <option value="filtered">Alle gefilterten Tracks</option>
            <option value="page">Nur aktuelle Seite</option>
            <option value="selected">Nur ausgewählte Tracks</option>
          </select>
          <div id="srchPlModalLimitWrap">
            <label style="font-size:12px;color:var(--muted)">Max. Tracks <span id="srchPlModalLimitHint">(Beatport-Limit: 500)</span></label>
            <input type="number" id="srchPlModalLimit" value="100" min="1" max="500" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font-size:14px;margin:4px 0 12px 0">
          </div>
          <div id="srchPlModalInfo" style="font-size:12px;color:var(--muted);margin-bottom:12px"></div>
          <div id="srchPlModalStatus" style="font-size:12px;margin-bottom:12px;display:none"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" id="srchPlModalCancel" style="padding:8px 16px;font-size:13px;background:var(--bg-card);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);cursor:pointer">Abbrechen</button>
            <button type="button" id="srchPlModalCreate" style="padding:8px 16px;font-size:13px;font-weight:600;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer">Speichern</button>
          </div>
        </div>
      </div>
      <div class="srch-timeline-viz" id="srchTimelineViz" style="display:none">
        <h4>Track-Timeline (aktuelle Seite)</h4>
        <div class="srch-tv-row"><div class="srch-tv-label">BPM</div><div class="srch-tv-bars" id="srchTvBpm"></div></div>
        <div class="srch-tv-row"><div class="srch-tv-label">Key Match</div><div class="srch-tv-bars" id="srchTvKey"></div></div>
        <div class="srch-tv-row"><div class="srch-tv-label">Dramaturgie</div><div class="srch-tv-bars" id="srchTvDrama"></div></div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th style="width:30px"><input type="checkbox" id="srchSelAll"></th>
        <th data-col="title">Title</th><th data-col="artists">Artist</th><th data-col="genre">Genre</th>
        <th data-col="bpm">BPM</th><th data-col="key">Key</th><th data-col="camelot">Camelot</th>
        <th data-col="drama">Drama</th><th data-col="year">Jahr</th><th data-col="label">Label</th>
        <th data-col="count">PLs</th><th data-col="rating" title="Engine DJ Rating (0-5 Sterne)">★</th><th data-col="plays" title="Abspielungen in Engine DJ Sessions">▶</th><th style="width:36px"></th>
      </tr></thead><tbody id="srchBody"></tbody></table></div>
      <div class="srch-pagination" id="srchPagination"></div>
    </div>

    <!-- SUB-TAB: DUPLIKATE -->
    <div class="srch-subcontent" id="srch-duplicates">
      <div class="srch-howto">
        <strong>Duplikate:</strong> Tracks die in mehreren Playlisten vorkommen. Je höher die Zahl, desto öfter.
      </div>
      <div class="srch-stats" id="srchDupStats"></div>
      <div class="srch-bar" style="margin-bottom:12px">
        <input type="text" id="srchDupQ" placeholder="Duplikate durchsuchen..." title="Duplikate nach Track, Artist oder Genre filtern">
        <select id="srchDupSort" title="Duplikat-Liste sortieren" style="padding:8px;background:var(--bg);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font-size:12px">
          <option value="pls-desc">Meiste PLs zuerst</option><option value="pls-asc">Wenigste</option>
          <option value="bpm-asc">BPM aufsteigend</option><option value="bpm-desc">BPM absteigend</option>
          <option value="title-asc">Titel A-Z</option>
        </select>
        <span id="srchDupCount" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>#</th><th>Track</th><th>Artist</th><th>Genre</th><th>BPM</th><th>Key</th><th>Camelot</th><th>In PLs</th>
      </tr></thead><tbody id="srchDupBody"></tbody></table></div>
    </div>

    <!-- SUB-TAB: PLAYLIST BUILDER -->
    <div class="srch-subcontent" id="srch-builder">
      <div class="srch-howto">
        <strong>Playlist Builder:</strong> Links Track-Pool durchsuchen, per <strong>+</strong> hinzufügen. Rechts per Drag&Drop sortieren.
        Farbiger Punkt = Camelot-Kompatibilität. BPM-Flow zeigt den Tempoverlauf.
      </div>
      <div class="srch-builder-wrap">
        <div class="srch-builder-panel">
          <h3>Track-Pool <span style="font-size:11px;color:var(--muted);font-weight:400" id="srchPoolCount"></span></h3>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <input type="text" id="srchPoolSearch" placeholder="Track, Artist, Label…" style="flex:1;padding:6px 10px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:12px">
            <select id="srchPoolGenre" title="Genre" style="padding:6px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px;max-width:110px"><option value="">Genre</option></select>
            <select id="srchPoolLabel" title="Label" style="padding:6px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px;max-width:110px"><option value="">Label</option></select>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <input type="number" id="srchPoolBpmMin" placeholder="BPM ≥" title="BPM Minimum" min="60" max="200" style="width:65px;padding:5px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px">
            <input type="number" id="srchPoolBpmMax" placeholder="BPM ≤" title="BPM Maximum" min="60" max="200" style="width:65px;padding:5px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px">
            <select id="srchPoolKey" title="Tonart" style="padding:5px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px;max-width:90px"><option value="">Key</option></select>
            <input type="number" id="srchPoolYearMin" placeholder="Jahr ≥" title="Jahr Minimum" min="1990" max="2030" style="width:70px;padding:5px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px">
            <select id="srchPoolRating" title="Mindest-Rating (Engine DJ)" style="padding:5px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px;max-width:90px">
              <option value="">Rating</option><option value="1">★+</option><option value="2">★★+</option><option value="3">★★★+</option><option value="4">★★★★+</option><option value="5">★★★★★</option>
            </select>
          </div>
          <div class="srch-pool-list" id="srchPoolList"></div>
        </div>
        <div class="srch-builder-panel">
          <h3>Playlist <span style="font-size:11px;color:var(--muted);font-weight:400" id="srchPlCount"></span></h3>
          <input type="text" id="srchPlName" value="Neue Playlist" style="width:100%;padding:6px 10px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:13px;font-weight:600;margin-bottom:8px">
          <div class="srch-pl-meta" id="srchPlMeta"><b>0</b> Tracks &middot; <b>0:00</b> Laufzeit</div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button type="button" id="srchSortCamelot" title="Playlist nach Camelot-Reihenfolge für harmonischere Übergänge sortieren" style="padding:4px 10px;font-size:11px">Sort: Camelot</button>
            <button type="button" id="srchSortBpm" title="Playlist nach BPM aufsteigend sortieren" style="padding:4px 10px;font-size:11px">Sort: BPM</button>
            <button type="button" id="srchClearPl" class="danger" title="Aktuelle Builder-Playlist leeren; Quelldaten bleiben unverändert" style="padding:4px 10px;font-size:11px">Leeren</button>
          </div>
          <div class="srch-pl-list" id="srchPlList"></div>
          <svg class="srch-bpm-flow" id="srchBpmFlow" viewBox="0 0 400 60" preserveAspectRatio="none"></svg>
        </div>
      </div>
    </div>
  `;
}

// ─── Event Binding ───────────────────────────────────────────────────────────

function bindSearchEvents() {
  // Sub-tab navigation
  document.querySelectorAll(".srch-subtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".srch-subtab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".srch-subcontent").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.stab)?.classList.add("active");
    });
  });

  // Data loading
  const dz = $("srchDropZone");
  dz?.addEventListener("click", loadViaDialog);
  dz?.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz?.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz?.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("over");
    if (e.dataTransfer.files.length) loadFromFile(e.dataTransfer.files[0]);
  });

  // Search & Filter
  $("srchQ")?.addEventListener("input", debounce(doSearch, 200));
  for (const id of ["srchGenre", "srchSubGenre", "srchBpmMin", "srchBpmMax", "srchKey", "srchYearMin", "srchYearMax", "srchSort", "srchFlags", "srchLabel", "srchRating", "srchPlaysMin"]) {
    $(id)?.addEventListener("change", doSearch);
  }
  $("srchBpmNormToggle")?.addEventListener("change", doSearch);
  $("srchResetBtn")?.addEventListener("click", clearFilters);

  // Select all
  $("srchSelAll")?.addEventListener("change", (e) => {
    document.querySelectorAll("#srchBody input[type=checkbox]").forEach((cb) => {
      cb.checked = e.target.checked;
      const id = parseInt(cb.value);
      if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
    });
    $("srchSelectedCount").textContent = selectedIds.size + " ausgewählt";
  });

  // Column header sort
  document.querySelectorAll("#srch-search th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const map = { title: "title-asc", artists: "artist-asc", genre: "title-asc", bpm: "bpm-asc", key: "camelot-asc", camelot: "camelot-asc", drama: "drama-desc", year: "year-desc", label: "label-asc", count: "count-desc" };
      const sel = $("srchSort");
      const curVal = sel.value;
      const base = map[col] || "count-desc";
      const [baseCol] = base.split("-");
      sel.value = curVal.startsWith(baseCol) ? (curVal.endsWith("asc") ? baseCol + "-desc" : baseCol + "-asc") : base;
      doSearch();
    });
  });

  // Lock buttons
  document.querySelectorAll(".srch-lock-btn[data-lock]").forEach((btn) => {
    btn.addEventListener("click", () => toggleLock(btn.dataset.lock));
  });
  $("srchLocksReset")?.addEventListener("click", clearLocks);
  $("srchScopeGlobal")?.addEventListener("click", () => setSortScope("global"));
  $("srchScopePage")?.addEventListener("click", () => setSortScope("page"));

  // Duplicates
  $("srchDupQ")?.addEventListener("input", debounce(filterDups, 200));
  $("srchDupSort")?.addEventListener("change", filterDups);

  // Builder
  $("srchPoolSearch")?.addEventListener("input", debounce((e) => { poolFilter = e.target.value; renderPool(); }, 200));
  $("srchPoolGenre")?.addEventListener("change", () => renderPool());
  $("srchPoolLabel")?.addEventListener("change", () => renderPool());
  $("srchPoolBpmMin")?.addEventListener("input", debounce(() => renderPool(), 300));
  $("srchPoolBpmMax")?.addEventListener("input", debounce(() => renderPool(), 300));
  $("srchPoolKey")?.addEventListener("change", () => renderPool());
  $("srchPoolYearMin")?.addEventListener("input", debounce(() => renderPool(), 300));
  $("srchPoolRating")?.addEventListener("change", () => renderPool());
  // Pool-Dropdowns befüllen wenn Daten da
  if (allTracks) {
    const genres = new Set(), labels = new Set();
    allTracks.forEach((t) => { if (t.g) genres.add(t.g); if (t.l) labels.add(t.l); });
    const pg = $("srchPoolGenre"); if (pg) [...genres].sort().forEach((g) => { const o = document.createElement("option"); o.value = g; o.textContent = g; pg.appendChild(o); });
    const pl = $("srchPoolLabel"); if (pl) [...labels].sort().slice(0, 300).forEach((l) => { const o = document.createElement("option"); o.value = l; o.textContent = l; pl.appendChild(o); });
    const keys = new Set(); allTracks.forEach((t) => { if (t.k) keys.add(t.k); });
    const pk = $("srchPoolKey"); if (pk) [...keys].sort().forEach((k) => { const o = document.createElement("option"); o.value = k; o.textContent = k; pk.appendChild(o); });
  }
  $("srchSortCamelot")?.addEventListener("click", () => { playlist.sort((a, b) => camelotSortVal(a.c) - camelotSortVal(b.c)); renderPlaylist(); });
  $("srchSortBpm")?.addEventListener("click", () => { playlist.sort((a, b) => (a.b || 0) - (b.b || 0)); renderPlaylist(); });
  $("srchClearPl")?.addEventListener("click", () => { playlist = []; renderPlaylist(); });

  // ─── Playlist speichern: Modal-Events ───────────────────────────────────────
  $("srchSavePlaylist")?.addEventListener("click", () => {
    const modal = $("srchPlModal");
    const info = $("srchPlModalInfo");
    const status = $("srchPlModalStatus");
    status.style.display = "none";
    // Quelle vorbelegen je nach Kontext
    const sourceEl = $("srchPlModalSource");
    const selCount = selectedIds.size;
    if (selCount > 0) sourceEl.value = "selected";
    else sourceEl.value = "filtered";
    updatePlModalInfo();
    modal.style.display = "flex";
    $("srchPlModalName").focus();
  });

  $("srchPlModalTarget")?.addEventListener("change", updatePlModalTarget);
  $("srchPlModalSource")?.addEventListener("change", updatePlModalInfo);
  $("srchPlModalLimit")?.addEventListener("input", updatePlModalInfo);

  $("srchPlModalCancel")?.addEventListener("click", () => {
    $("srchPlModal").style.display = "none";
  });

  $("srchPlModal")?.addEventListener("click", (e) => {
    if (e.target === $("srchPlModal")) $("srchPlModal").style.display = "none";
  });

  $("srchPlModalCreate")?.addEventListener("click", savePlaylist);
}

function updatePlModalTarget() {
  const target = $("srchPlModalTarget")?.value || "beatport";
  const limitWrap = $("srchPlModalLimitWrap");
  const limitHint = $("srchPlModalLimitHint");
  const limitInput = $("srchPlModalLimit");
  const engineDbWrap = $("srchPlModalEngineDbWrap");

  // Engine-DB-Dropdown nur bei Engine-Ziel zeigen
  if (engineDbWrap) engineDbWrap.style.display = target === "engine" ? "" : "none";

  if (target === "beatport") {
    limitWrap.style.display = "";
    limitHint.textContent = "(Beatport-Limit: 500)";
    limitInput.max = 500;
  } else if (target === "engine") {
    limitWrap.style.display = "";
    limitHint.textContent = "(Engine DJ — kein hartes Limit)";
    limitInput.max = 99999;
    // Datenbanken laden
    loadEngineDatabases();
  } else {
    limitWrap.style.display = "";
    limitHint.textContent = "(kein Limit fuer lokale Dateien)";
    limitInput.max = 99999;
  }
  updatePlModalInfo();
}

async function loadEngineDatabases() {
  const sel = $("srchPlModalEngineDb");
  if (!sel || !window.engineApi?.discoverDatabases) return;
  sel.innerHTML = '<option value="">Suche Datenbanken...</option>';
  try {
    const res = await window.engineApi.discoverDatabases();
    if (!res?.ok || !res.databases?.length) {
      sel.innerHTML = '<option value="">Keine Engine DJ Datenbank gefunden</option>';
      return;
    }
    sel.innerHTML = res.databases.map((db) =>
      `<option value="${esc(db.path)}">${esc(db.label)} (${esc(db.path)})</option>`
    ).join("");
  } catch (err) {
    sel.innerHTML = `<option value="">Fehler: ${esc(err.message)}</option>`;
  }
}

function updatePlModalInfo() {
  const source = $("srchPlModalSource")?.value || "filtered";
  const target = $("srchPlModalTarget")?.value || "beatport";
  const maxLimit = target === "beatport" ? 500 : 99999;
  const limit = Math.min(maxLimit, Math.max(1, parseInt($("srchPlModalLimit")?.value) || 100));
  let count = 0;
  if (source === "filtered") count = searchResults.length;
  else if (source === "page") count = getPageTracks(currentPage).length;
  else if (source === "selected") count = selectedIds.size;
  const actual = Math.min(count, limit);
  const formatLabel = { beatport: "Beatport", engine: "Engine DJ", m3u: "M3U", json: "JSON", csv: "CSV" }[target] || target;
  $("srchPlModalInfo").innerHTML = `<strong>${fmt(count)}</strong> Tracks verfügbar → <strong>${fmt(actual)}</strong> werden als <strong>${formatLabel}</strong> gespeichert`;
}

/** Haupt-Speicherfunktion: Dispatcht je nach Ziel-Format */
async function savePlaylist() {
  const target = $("srchPlModalTarget")?.value || "beatport";
  if (target === "beatport") return saveToBeatport();
  if (target === "engine") return saveToEngineDJ();
  return saveToLocalFile(target);
}

/** Tracks aus gewählter Quelle sammeln und auf Limit kürzen */
function collectExportTracks() {
  const source = $("srchPlModalSource")?.value || "filtered";
  const target = $("srchPlModalTarget")?.value || "beatport";
  const maxLimit = target === "beatport" ? 500 : 99999;
  const limit = Math.min(maxLimit, Math.max(1, parseInt($("srchPlModalLimit")?.value) || 100));
  let tracks = [];
  if (source === "filtered") tracks = searchResults;
  else if (source === "page") tracks = getPageTracks(currentPage);
  else if (source === "selected") tracks = searchResults.filter((t) => selectedIds.has(t.track_id));
  return tracks.slice(0, limit);
}

async function saveToBeatport() {
  const name = ($("srchPlModalName")?.value || "").trim();
  if (!name) { $("srchPlModalName").focus(); return; }

  const status = $("srchPlModalStatus");
  const createBtn = $("srchPlModalCreate");
  const tracks = collectExportTracks();
  const trackIds = tracks.map((t) => t.track_id).filter(Boolean);

  if (!trackIds.length) {
    status.style.display = "block";
    status.innerHTML = '<span style="color:var(--danger)">Keine Tracks mit gültiger ID gefunden.</span>';
    return;
  }

  if (!window.playlistApi?.create) {
    status.style.display = "block";
    status.innerHTML = '<span style="color:var(--danger)">Beatport API nicht verbunden. Bitte zuerst im Scanner-Tab einloggen.</span>';
    return;
  }

  createBtn.disabled = true;
  status.style.display = "block";
  status.innerHTML = '<span style="color:var(--primary)">Erstelle Playlist auf Beatport...</span>';

  try {
    const pl = await window.playlistApi.create(name);
    if (!pl?.id) throw new Error("Playlist-Erstellung fehlgeschlagen — keine ID zurückbekommen");

    status.innerHTML = `<span style="color:var(--primary)">Playlist "${esc(name)}" erstellt (ID: ${pl.id}). Füge ${fmt(trackIds.length)} Tracks hinzu...</span>`;

    const BATCH_SIZE = 50;
    let added = 0;
    for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
      const batch = trackIds.slice(i, i + BATCH_SIZE);
      await window.playlistApi.addTracks(pl.id, batch);
      added += batch.length;
      status.innerHTML = `<span style="color:var(--primary)">${fmt(added)} / ${fmt(trackIds.length)} Tracks hinzugefügt...</span>`;
    }

    status.innerHTML = `<span style="color:var(--success)">&#10003; Playlist "${esc(name)}" mit ${fmt(trackIds.length)} Tracks auf Beatport erstellt!</span>`;
    createBtn.disabled = false;
  } catch (err) {
    status.innerHTML = `<span style="color:var(--danger)">Fehler: ${esc(err.message)}</span>`;
    createBtn.disabled = false;
  }
}

async function saveToEngineDJ() {
  const name = ($("srchPlModalName")?.value || "").trim();
  if (!name) { $("srchPlModalName").focus(); return; }

  const databaseFolder = $("srchPlModalEngineDb")?.value || "";
  if (!databaseFolder) {
    const status = $("srchPlModalStatus");
    status.style.display = "block";
    status.innerHTML = '<span style="color:var(--danger)">Bitte Engine DJ Datenbank auswaehlen.</span>';
    return;
  }

  const status = $("srchPlModalStatus");
  const createBtn = $("srchPlModalCreate");
  const tracks = collectExportTracks();

  if (!tracks.length) {
    status.style.display = "block";
    status.innerHTML = '<span style="color:var(--danger)">Keine Tracks zum Exportieren gefunden.</span>';
    return;
  }

  if (!window.engineApi?.importStreaming) {
    status.style.display = "block";
    status.innerHTML = '<span style="color:var(--danger)">Engine DJ API nicht verfuegbar.</span>';
    return;
  }

  createBtn.disabled = true;
  status.style.display = "block";
  const dbLabel = $("srchPlModalEngineDb")?.selectedOptions?.[0]?.textContent || databaseFolder;
  status.innerHTML = `<span style="color:var(--primary)">Importiere ${fmt(tracks.length)} Tracks in ${esc(dbLabel)}...</span>`;

  try {
    // Tracks in das Format bringen, das engine_tools.py erwartet
    const engineTracks = tracks.map((t) => ({
      track_id: String(t.track_id || ""),
      title: t.title || "",
      mix_name: t.mix_name || "",
      artists: t.artists || "",
      genre: t.genre || "",
      sub_genre: t.sub_genre || "",
      bpm: t.bpm || 0,
      key: t.key || "",
      camelot: t.camelot || "",
      year: t.year || 0,
      label: t.label || "",
      release: t.release || "",
      length_ms: t.length_ms || 0,
    }));

    const result = await window.engineApi.importStreaming({
      tracks: engineTracks,
      playlistTitle: name,
      databaseFolder,
    });

    if (!result.ok) throw new Error(result.error || "Import fehlgeschlagen");

    const parts = [];
    if (result.tracksCreated > 0) parts.push(`${fmt(result.tracksCreated)} neu angelegt`);
    if (result.tracksExisted > 0) parts.push(`${fmt(result.tracksExisted)} existierten bereits`);
    if (result.tracksSkipped > 0) parts.push(`${fmt(result.tracksSkipped)} uebersprungen`);
    if (result.playlistCreated) parts.push("Playlist neu erstellt");
    if (result.entityCount > 0) parts.push(`${fmt(result.entityCount)} zur Playlist hinzugefuegt`);

    status.innerHTML = `<span style="color:var(--success)">&#10003; Engine DJ Import: ${parts.join(", ")}. Backup: ${esc(result.backupPath || "")}</span>`;
    createBtn.disabled = false;
  } catch (err) {
    status.innerHTML = `<span style="color:var(--danger)">Fehler: ${esc(err.message)}</span>`;
    createBtn.disabled = false;
  }
}

async function saveToLocalFile(format) {
  const name = ($("srchPlModalName")?.value || "").trim() || "Playlist";
  const status = $("srchPlModalStatus");
  const createBtn = $("srchPlModalCreate");
  const tracks = collectExportTracks();

  if (!tracks.length) {
    status.style.display = "block";
    status.innerHTML = '<span style="color:var(--danger)">Keine Tracks zum Exportieren gefunden.</span>';
    return;
  }

  // Dateiendung und Filter für Dialog
  const extMap = { m3u: ".m3u", json: ".json", csv: ".csv" };
  const filterMap = {
    m3u:  [{ name: "M3U Playlist", extensions: ["m3u", "m3u8"] }],
    json: [{ name: "JSON", extensions: ["json"] }],
    csv:  [{ name: "CSV (Comma-separated)", extensions: ["csv"] }],
  };

  createBtn.disabled = true;
  status.style.display = "block";
  status.innerHTML = '<span style="color:var(--primary)">Speicherort wählen...</span>';

  try {
    // Speicherdialog über IPC (Main-Prozess zeigt nativen Dialog)
    const defaultName = name.replace(/[/\\:*?"<>|]/g, "_") + (extMap[format] || ".txt");
    const saveResult = await window.exportApi.chooseSavePath({
      title: `Playlist als ${format.toUpperCase()} speichern`,
      defaultPath: defaultName,
      format,
      filters: filterMap[format] || [],
    });

    if (!saveResult || saveResult.canceled) {
      // User hat Abbrechen geklickt
      status.style.display = "none";
      createBtn.disabled = false;
      return;
    }
    const savePath = saveResult.filePath;

    status.innerHTML = `<span style="color:var(--primary)">Exportiere ${fmt(tracks.length)} Tracks als ${format.toUpperCase()}...</span>`;

    // Track-Daten für Export vorbereiten (komprimierte Keys → lesbares Format)
    const exportTracks = tracks.map((t) => ({
      track_id: t.track_id || t.i || "",
      title: t.title || t.t || "",
      artists: t.artists || t.a || "",
      mix: t.mix || t.m || "",
      genre: t.genre || t.g || "",
      subgenre: t.subgenre || t.sg || "",
      bpm: t.bpm || t.b || "",
      key: t.key || t.k || "",
      camelot: t.camelot || t.c || "",
      year: t.year || t.y || "",
      label: t.label || t.l || "",
      rating: t.rating || t.r || "",
      drama_score: t.drama_score || t.ds || "",
      playlist_count: t.playlist_count || t.p || "",
    }));

    // Export per IPC an Main-Prozess senden
    const result = await window.exportApi.savePlaylistLocal({
      format,
      name,
      tracks: exportTracks,
      outputPath: savePath,
    });

    status.innerHTML = `<span style="color:var(--success)">&#10003; ${fmt(result.trackCount || tracks.length)} Tracks als ${format.toUpperCase()} gespeichert: ${esc(result.filename || savePath.split("/").pop())}</span>`;
    createBtn.disabled = false;
  } catch (err) {
    status.innerHTML = `<span style="color:var(--danger)">Fehler: ${esc(err.message)}</span>`;
    createBtn.disabled = false;
  }
}

// ─── Data Loading ────────────────────────────────────────────────────────────

async function tryAutoLoad() {
  try {
    const status = $("srchDataStatus");
    status.textContent = "Lade scoring-data.json vom Standard-Pfad...";
    const data = await window.syncApi.loadScoringData(); // default path
    processLoadedData(data);
  } catch {
    const status = $("srchDataStatus");
    status.innerHTML = 'Klicke hier oder ziehe die <strong>scoring-data.json</strong> hierher';
  }
}

async function loadViaDialog() {
  try {
    const status = $("srchDataStatus");
    status.textContent = "Datei-Dialog...";
    const data = await window.syncApi.chooseScoringFile();
    if (data) {
      processLoadedData(data);
    } else {
      status.textContent = "Abgebrochen.";
    }
  } catch (err) {
    $("srchDataStatus").innerHTML = `<span style="color:var(--danger)">Fehler: ${err.message}</span>`;
  }
}

function loadFromFile(file) {
  const status = $("srchDataStatus");
  status.textContent = `Lade ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`;
  const reader = new FileReader();
  reader.addEventListener("progress", (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      status.textContent = `${(e.loaded / 1024 / 1024).toFixed(1)} MB von ${(e.total / 1024 / 1024).toFixed(1)} MB (${pct}%)`;
    }
  });
  reader.addEventListener("load", () => {
    status.textContent = "Parsing JSON...";
    setTimeout(() => {
      try {
        const data = JSON.parse(reader.result);
        processLoadedData(data);
      } catch (err) {
        status.innerHTML = `<span style="color:var(--danger)">Parse-Fehler: ${err.message}</span>`;
      }
    }, 50);
  });
  reader.readAsText(file);
}

function processLoadedData(data) {
  const status = $("srchDataStatus");
  if (data.all_tracks && Array.isArray(data.all_tracks)) {
    allTracks = data.all_tracks;
    const n = allTracks.length;
    status.innerHTML = `<span style="color:var(--success)">&check; ${fmt(n)} Tracks geladen!</span>`;

    // Playlist-Name-Map aufbauen (für klickbare Duplikate)
    playlistNameMap.clear();
    if (Array.isArray(data.playlists)) {
      for (const pl of data.playlists) {
        if (pl.id) playlistNameMap.set(pl.id, pl.name || `Playlist ${pl.id}`);
      }
    }

    // Build dashboard data from tracks
    buildDashData();

    // Init filters
    initFilters();
    initSubGenreFilter();
    initLabelFilter();
    initChipFilters();

    // Render everything
    renderDashboard();
    doSearch();
    renderDuplicates();
    renderPool();

    // Show dashboard
    $("srchDashNoData").style.display = "none";
    $("srchDashContent").style.display = "block";

    // Stats on data tab
    $("srchDataStats").innerHTML = `
      <div class="srch-stat"><div class="v">${fmt(n)}</div><div class="l">Tracks</div></div>
      <div class="srch-stat"><div class="v">${fmt(data.playlists?.length ?? 0)}</div><div class="l">Playlisten</div></div>
    `;
  } else {
    status.innerHTML = '<span style="color:var(--danger)">Fehler: Erwartet {all_tracks: [...]}</span>';
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function buildDashData() {
  if (!allTracks) return;
  const genreMap = new Map();
  const keyMap = new Map();
  const bpmBuckets = new Map();

  allTracks.forEach((t) => {
    // Genre
    if (t.g) {
      const g = genreMap.get(t.g) || { genre: t.g, tracks: 0, totalBpm: 0, bpmCount: 0 };
      g.tracks++;
      if (t.b) { g.totalBpm += t.b; g.bpmCount++; }
      genreMap.set(t.g, g);
    }
    // Key
    if (t.k) {
      const k = keyMap.get(t.k) || { key: t.k, camelot: t.c || "", tracks: 0 };
      k.tracks++;
      keyMap.set(t.k, k);
    }
    // BPM
    if (t.b) {
      const bucket = Math.floor(t.b / 5) * 5;
      const label = `${bucket}-${bucket + 4}`;
      const b = bpmBuckets.get(label) || { range: label, tracks: 0 };
      b.tracks++;
      bpmBuckets.set(label, b);
    }
  });

  dashData = {
    genres: [...genreMap.values()].sort((a, b) => b.tracks - a.tracks),
    keys: [...keyMap.values()].sort((a, b) => camelotSortVal(a.camelot) - camelotSortVal(b.camelot)),
    bpmBuckets: [...bpmBuckets.values()].sort((a, b) => parseInt(a.range) - parseInt(b.range)),
    totalTracks: allTracks.length,
    dupsCount: allTracks.filter((t) => t.p && t.p.length > 1).length,
  };
}

function renderDashboard() {
  if (!dashData) return;
  const d = dashData;

  // Stats
  $("srchStatsGrid").innerHTML = [
    ["Tracks", fmt(d.totalTracks)],
    ["Genres", fmt(d.genres.length)],
    ["Tonarten", fmt(d.keys.length)],
    ["In 2+ PLs", fmt(d.dupsCount)],
  ].map(([l, v]) => `<div class="srch-stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  // Genre bars
  const maxG = Math.max(...d.genres.map((g) => g.tracks));
  $("srchGenreBars").innerHTML = d.genres.slice(0, 30).map((g) => {
    const w = Math.max(2, Math.round((g.tracks / maxG) * 100));
    const avgBpm = g.bpmCount ? Math.round(g.totalBpm / g.bpmCount) : "—";
    return `<div class="srch-gb-row" data-genre="${esc(g.genre)}">
      <div class="srch-gb-name">${esc(g.genre)}</div>
      <div class="srch-gb-wrap"><div class="srch-gb-fill" style="width:${w}%"><span class="srch-gb-val">${fmt(g.tracks)}</span></div></div>
      <div class="srch-gb-bpm">&Oslash; ${avgBpm}</div></div>`;
  }).join("");

  // Click genre → search
  document.querySelectorAll(".srch-gb-row[data-genre]").forEach((row) => {
    row.addEventListener("click", () => navToSearch({ genre: row.dataset.genre }));
  });

  // BPM grid
  $("srchBpmGrid").innerHTML = d.bpmBuckets.filter((b) => b.tracks > 10).map((b) => {
    const pct = ((b.tracks / d.totalTracks) * 100).toFixed(1);
    return `<div class="srch-bpm-tile" data-bpm="${b.range}">
      <div class="rng">${b.range}</div><div class="cnt">${fmt(b.tracks)}</div><div class="pct">${pct}%</div></div>`;
  }).join("");

  document.querySelectorAll(".srch-bpm-tile[data-bpm]").forEach((tile) => {
    tile.addEventListener("click", () => {
      const [min, max] = tile.dataset.bpm.split("-");
      navToSearch({ bpm_min: min, bpm_max: max });
    });
  });

  // Key grid
  $("srchKeyGrid").innerHTML = d.keys.map((k) =>
    `<div class="srch-key-card" data-key="${esc(k.key)}">
      <div class="kn">${esc(k.key)}</div><div class="cam">${esc(k.camelot)}</div><div class="kt">${fmt(k.tracks)}</div></div>`
  ).join("");

  document.querySelectorAll(".srch-key-card[data-key]").forEach((card) => {
    card.addEventListener("click", () => navToSearch({ key: card.dataset.key }));
  });
}

function navToSearch(filters) {
  // Switch to search sub-tab
  document.querySelectorAll(".srch-subtab").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".srch-subcontent").forEach((c) => c.classList.remove("active"));
  document.querySelector('[data-stab="srch-search"]')?.classList.add("active");
  $("srch-search")?.classList.add("active");

  clearFilters(false);
  if (filters.genre) $("srchGenre").value = filters.genre;
  if (filters.key) $("srchKey").value = filters.key;
  if (filters.bpm_min) $("srchBpmMin").value = filters.bpm_min;
  if (filters.bpm_max) $("srchBpmMax").value = filters.bpm_max;
  if (filters.artist) $("srchQ").value = filters.artist;
  if (filters.label) $("srchLabel").value = filters.label;
  doSearch();
}

// ─── Filter Init ─────────────────────────────────────────────────────────────

function initFilters() {
  if (!allTracks) return;
  const gs = $("srchGenre");
  if (gs.children.length <= 1) {
    const gMap = new Map();
    allTracks.forEach((t) => { if (t.g) gMap.set(t.g, (gMap.get(t.g) || 0) + 1); });
    [...gMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([g, cnt]) => {
      const o = document.createElement("option"); o.value = g; o.textContent = `${g} (${fmt(cnt)})`; gs.appendChild(o);
    });
  }
  const ks = $("srchKey");
  if (ks.children.length <= 1 && dashData?.keys) {
    dashData.keys.forEach((k) => {
      const o = document.createElement("option"); o.value = k.key; o.textContent = `${k.key} (${k.camelot}) — ${fmt(k.tracks)}`; ks.appendChild(o);
    });
  }
}

function initSubGenreFilter() {
  const sel = $("srchSubGenre");
  if (!allTracks || sel.children.length > 1) return;
  const sgs = new Map();
  allTracks.forEach((t) => { if (t.sg) sgs.set(t.sg, (sgs.get(t.sg) || 0) + 1); });
  [...sgs.entries()].sort((a, b) => b[1] - a[1]).forEach(([sg, cnt]) => {
    const o = document.createElement("option"); o.value = sg; o.textContent = `${sg} (${fmt(cnt)})`; sel.appendChild(o);
  });
}

// ─── Multi-Select Chips für Genre / Sub-Genre (v3.5.2) ───────────────────────
const selectedGenres = new Set();
const selectedSubGenres = new Set();

function renderGenreChips() {
  const host = $("srchGenreChips");
  if (!host || !allTracks) return;
  const map = new Map();    // genre → total count
  const scored = new Map(); // genre → count with rating or plays
  allTracks.forEach((t) => {
    if (!t.g) return;
    map.set(t.g, (map.get(t.g) || 0) + 1);
    if (t.rating || t.plays_total) scored.set(t.g, (scored.get(t.g) || 0) + 1);
  });
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  host.innerHTML = entries.map(([g, cnt]) => {
    const on = selectedGenres.has(g) ? "on" : "";
    const sc = scored.get(g) || 0;
    const indicator = sc > 0 ? ` <span class="chip-scored" title="${sc} Tracks mit Engine-Daten (Rating/Plays)">⚡${sc}</span>` : "";
    return `<button type="button" class="srch-chip ${on}" data-g="${esc(g)}">${esc(g)} <span class="c">${fmt(cnt)}</span>${indicator}</button>`;
  }).join("");
  const cnt = $("srchGenreCount");
  if (cnt) cnt.textContent = selectedGenres.size ? `(${selectedGenres.size} aktiv)` : "";
}

function renderSubGenreChips() {
  const host = $("srchSubGenreChips");
  if (!host || !allTracks) return;
  const map = new Map();
  allTracks.forEach((t) => {
    if (!t.sg) return;
    if (selectedGenres.size && !selectedGenres.has(t.g)) return;
    map.set(t.sg, (map.get(t.sg) || 0) + 1);
  });
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    host.innerHTML = `<span class="srch-chips-empty">${selectedGenres.size ? "Keine Sub-Genres in den gewählten Genres." : "Genre wählen, um Sub-Genres zu sehen."}</span>`;
  } else {
    host.innerHTML = entries.map(([sg, cnt]) => {
      const on = selectedSubGenres.has(sg) ? "on" : "";
      return `<button type="button" class="srch-chip ${on}" data-sg="${esc(sg)}">${esc(sg)} <span class="c">${fmt(cnt)}</span></button>`;
    }).join("");
  }
  // Remove now-invalid sub-genre selections
  for (const sg of [...selectedSubGenres]) {
    if (!map.has(sg)) selectedSubGenres.delete(sg);
  }
  const cnt = $("srchSubGenreCount");
  if (cnt) cnt.textContent = selectedSubGenres.size ? `(${selectedSubGenres.size} aktiv)` : "";
}

function initChipFilters() {
  const gh = $("srchGenreChips");
  const sh = $("srchSubGenreChips");
  if (gh && !gh.dataset.bound) {
    gh.dataset.bound = "1";
    gh.addEventListener("click", (e) => {
      const btn = e.target.closest(".srch-chip");
      if (!btn) return;
      const g = btn.dataset.g;
      if (selectedGenres.has(g)) selectedGenres.delete(g); else selectedGenres.add(g);
      renderGenreChips();
      renderSubGenreChips();
      doSearch();
    });
  }
  if (sh && !sh.dataset.bound) {
    sh.dataset.bound = "1";
    sh.addEventListener("click", (e) => {
      const btn = e.target.closest(".srch-chip");
      if (!btn) return;
      const sg = btn.dataset.sg;
      if (selectedSubGenres.has(sg)) selectedSubGenres.delete(sg); else selectedSubGenres.add(sg);
      renderSubGenreChips();
      doSearch();
    });
  }
  renderGenreChips();
  renderSubGenreChips();
}

function initLabelFilter() {
  const sel = $("srchLabel");
  if (!allTracks || sel.children.length > 1) return;
  const labels = new Map();
  allTracks.forEach((t) => { if (t.l) labels.set(t.l, (labels.get(t.l) || 0) + 1); });
  [...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 500).forEach(([lb, cnt]) => {
    const o = document.createElement("option"); o.value = lb; o.textContent = `${lb} (${fmt(cnt)})`; sel.appendChild(o);
  });
}

function clearFilters(triggerSearch = true) {
  $("srchQ").value = "";
  $("srchGenre").value = "";
  $("srchSubGenre").value = "";
  selectedGenres.clear();
  selectedSubGenres.clear();
  if (typeof renderGenreChips === "function") renderGenreChips();
  if (typeof renderSubGenreChips === "function") renderSubGenreChips();
  $("srchBpmMin").value = "";
  $("srchBpmMax").value = "";
  $("srchKey").value = "";
  $("srchYearMin").value = "";
  $("srchYearMax").value = "";
  $("srchLabel").value = "";
  $("srchFlags").value = "";
  if ($("srchRating")) $("srchRating").value = "";
  if ($("srchPlaysMin")) $("srchPlaysMin").value = "";
  $("srchSort").value = "count-desc";
  const norm = $("srchBpmNormToggle");
  if (norm) norm.checked = false;
  currentPage = 0;
  if (triggerSearch) doSearch();
}

// ─── Lock System ─────────────────────────────────────────────────────────────

const lockLabels = { bpm: "BPM", camelot: "Camelot", drama: "Dramaturgie", year: "Jahr", genre: "Genre", label: "Label" };

function toggleLock(col) {
  const idx = lockedSorts.findIndex((l) => l.col === col);
  if (idx >= 0) {
    lockedSorts.splice(idx, 1);
  } else {
    const sv = $("srchSort")?.value ?? "count-desc";
    const [curCol, curDir] = sv.split("-");
    let dir = 1;
    if (col === curCol) dir = curDir === "desc" ? -1 : 1;
    else if (col === "count" || col === "drama") dir = -1;
    lockedSorts.push({ col, dir });
  }
  updateLockUI();
  doSearch();
}

function clearLocks() {
  lockedSorts = [];
  updateLockUI();
  doSearch();
}

function updateLockUI() {
  document.querySelectorAll(".srch-lock-btn[data-lock]").forEach((btn) => {
    const col = btn.dataset.lock;
    const isLocked = lockedSorts.some((l) => l.col === col);
    btn.classList.toggle("locked", isLocked);
    const idx = lockedSorts.findIndex((l) => l.col === col);
    const base = lockLabels[col] || col;
    if (idx >= 0) {
      const arrow = lockedSorts[idx].dir === 1 ? " \u2191" : " \u2193";
      const num = lockedSorts.length > 1 ? " (" + (idx + 1) + ")" : "";
      btn.innerHTML = '<span class="lk"></span> ' + base + arrow + num;
    } else {
      btn.innerHTML = '<span class="lk"></span> ' + base;
    }
  });
}

function setSortScope(scope) {
  sortScope = scope;
  _distributedPages = null; // Cache invalidieren
  $("srchScopeGlobal")?.classList.toggle("active", scope === "global");
  $("srchScopePage")?.classList.toggle("active", scope === "page");
  renderSearchPage();
}

// ─── Search & Render ─────────────────────────────────────────────────────────

function doSearch() {
  if (!allTracks) return;
  const qVal = ($("srchQ")?.value ?? "");
  const qMatch = buildQueryMatcher(qVal);
  const genre = $("srchGenre")?.value ?? "";
  const subGenre = $("srchSubGenre")?.value ?? "";
  const useGenreSet = selectedGenres.size > 0;
  const useSubSet = selectedSubGenres.size > 0;
  const bpmMin = parseInt($("srchBpmMin")?.value) || 0;
  const bpmMax = parseInt($("srchBpmMax")?.value) || 999;
  const key = $("srchKey")?.value ?? "";
  const yearMin = parseInt($("srchYearMin")?.value) || 0;
  const yearMax = parseInt($("srchYearMax")?.value) || 9999;
  const label = $("srchLabel")?.value ?? "";
  const flags = $("srchFlags")?.value ?? "";
  const ratingFilter = $("srchRating")?.value ?? "";
  const playsMin = parseInt($("srchPlaysMin")?.value) || 0;
  const useNorm = bpmNormActive();

  const src = getSearchSource();
  searchResults = src.filter((t) => {
    if (qMatch && !(qMatch(t.title || "") || qMatch(t.artists || "") || qMatch(t.label || "") || qMatch(t.release || ""))) return false;
    if (useGenreSet) { if (!selectedGenres.has(t.genre)) return false; }
    else if (genre && t.genre !== genre) return false;
    if (useSubSet) { if (!selectedSubGenres.has(t.sub_genre)) return false; }
    else if (subGenre && t.sub_genre !== subGenre) return false;
    const effectiveBpm = useNorm ? t.bpmNorm : t.bpm;
    if (effectiveBpm && (effectiveBpm < bpmMin || effectiveBpm > bpmMax)) return false;
    if (key && t.key !== key) return false;
    if (t.year && (t.year < yearMin || t.year > yearMax)) return false;
    if (label && t.label !== label) return false;
    if (flags === "hype" && !t.is_hype) return false;
    if (flags === "dj" && !t.is_dj_edit) return false;
    if (ratingFilter === "rated" && !t.rating) return false;
    if (ratingFilter === "unrated" && t.rating) return false;
    if (ratingFilter && !isNaN(parseInt(ratingFilter)) && (t.rating || 0) < parseInt(ratingFilter)) return false;
    if (playsMin > 0 && (t.plays_total || 0) < playsMin) return false;
    return true;
  });

  sortResults(searchResults);
  _distributedPages = null; // Round-Robin-Cache invalidieren
  currentPage = 0;
  renderSearchPage();
}

function renderSearchPage() {
  const total = searchResults.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const rows = getPageTracks(currentPage);
  const start = currentPage * PAGE_SIZE;
  const end = Math.min(start + rows.length, total);

  $("srchResultCount").innerHTML = `<strong>${fmt(total)}</strong> Treffer von ${fmt(allTracks?.length ?? 0)}`;
  $("srchSelectedCount").textContent = selectedIds.size + " ausgewählt";
  $("srchPageInfo").textContent = total > 0 ? `Seite ${currentPage + 1} von ${totalPages} (${rows.length} Tracks)` : "";
  // Playlist-speichern-Button nur zeigen wenn Ergebnisse vorhanden
  const saveBtn = $("srchSavePlaylist");
  if (saveBtn) saveBtn.style.display = total > 0 ? "inline-block" : "none";

  $("srchBody").innerHTML = rows.map((t) => {
    const chk = selectedIds.has(t.track_id) ? "checked" : "";
    const dc = dramaColor(t.drama);
    const flags = [];
    if (t.is_hype) flags.push('<span class="srch-badge-hype">HYPE</span>');
    if (t.is_dj_edit) flags.push('<span class="srch-badge-dj">DJ</span>');
    return `<tr>
      <td><input type="checkbox" value="${t.track_id}" ${chk} onchange="this.checked?window._srchSelAdd(${t.track_id}):window._srchSelDel(${t.track_id})"></td>
      <td><strong>${esc(t.title)}</strong> <span style="color:var(--muted);font-size:11px">${esc(t.mix_name)}</span>${flags.join("")}</td>
      <td>${esc(t.artists) || "\u2014"}</td>
      <td>${esc(t.genre) || "\u2014"}${t.sub_genre ? ' <span style="color:var(--muted);font-size:10px">/ ' + esc(t.sub_genre) + "</span>" : ""}</td>
      <td class="srch-bpm-cell">${bpmDisplay(t.bpm)}</td>
      <td>${esc(t.key) || "\u2014"}</td>
      <td style="color:#b197fc;font-weight:700">${esc(t.camelot) || "\u2014"}</td>
      <td><span class="srch-drama" style="color:${dc}">${t.drama}</span></td>
      <td>${t.year || "\u2014"}</td>
      <td style="font-size:11px">${esc(t.label) || "\u2014"}</td>
      <td><span class="srch-badge ${badgeCls(t.count)}">${t.count}</span></td>
      <td style="color:#fbbf24;font-size:12px">${t.rating ? "★".repeat(t.rating) : "—"}</td>
      <td style="font-size:11px;color:var(--muted)">${t.plays_total || "—"}</td>
      <td><button class="srch-reco-btn" data-tid="${t.track_id}" title="Empfehlungen laden">&#x1F52E;</button></td>
    </tr>`;
  }).join("");

  // Expose selection functions to window for inline onclick
  window._srchSelAdd = (id) => { selectedIds.add(id); $("srchSelectedCount").textContent = selectedIds.size + " ausgewählt"; };
  window._srchSelDel = (id) => { selectedIds.delete(id); $("srchSelectedCount").textContent = selectedIds.size + " ausgewählt"; };

  // Pagination
  let pgHtml = "";
  if (totalPages > 1) {
    pgHtml += `<button class="srch-pg-btn" ${currentPage === 0 ? "disabled" : ""} data-page="${currentPage - 1}">\u25C0</button>`;
    const maxBtns = 7;
    let pStart = Math.max(0, currentPage - 3);
    let pEnd = Math.min(totalPages, pStart + maxBtns);
    if (pEnd - pStart < maxBtns) pStart = Math.max(0, pEnd - maxBtns);
    for (let p = pStart; p < pEnd; p++) {
      pgHtml += `<button class="srch-pg-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p + 1}</button>`;
    }
    pgHtml += `<button class="srch-pg-btn" ${currentPage >= totalPages - 1 ? "disabled" : ""} data-page="${currentPage + 1}">\u25B6</button>`;
  }
  const pgEl = $("srchPagination");
  pgEl.innerHTML = pgHtml;
  pgEl.querySelectorAll(".srch-pg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPage = parseInt(btn.dataset.page);
      renderSearchPage();
    });
  });

  renderTimelineViz(rows);
}

// ─── Timeline Visualization ──────────────────────────────────────────────────

function renderTimelineViz(tracks) {
  const viz = $("srchTimelineViz");
  if (!tracks.length) { viz.style.display = "none"; return; }
  viz.style.display = "block";
  const useNorm = bpmNormActive();
  const getBpm = (t) => useNorm ? (t.bpmNorm || 120) : (t.bpm || 120);
  const bpmMin = Math.min(...tracks.map(getBpm));
  const bpmMax = Math.max(...tracks.map(getBpm));
  const bpmRange = bpmMax - bpmMin || 1;
  const barW = Math.max(2, Math.floor(800 / tracks.length));

  $("srchTvBpm").innerHTML = tracks.map((t) => {
    const b = getBpm(t);
    const h = Math.max(10, Math.round(((b - bpmMin) / bpmRange) * 100));
    const hue = Math.round(200 - ((b - bpmMin) / bpmRange) * 140);
    return `<div class="srch-tv-bar" style="width:${barW}px;background:hsl(${hue},70%,50%);height:${h}%" data-tip="${esc(t.title)}: ${b} BPM"></div>`;
  }).join("");

  $("srchTvKey").innerHTML = tracks.map((t, i) => {
    if (i === 0) return `<div class="srch-tv-bar" style="width:${barW}px;background:#555;height:100%" data-tip="Start"></div>`;
    const comp = camelotCompat(tracks[i - 1].camelot, t.camelot);
    const color = comp === "perfect" || comp === "good" ? "var(--success)" : comp === "ok" ? "#fbbf24" : comp === "bad" ? "var(--danger)" : "#555";
    return `<div class="srch-tv-bar" style="width:${barW}px;background:${color};height:100%" data-tip="${t.camelot || "?"} \u2190 ${tracks[i - 1].camelot || "?"}: ${comp}"></div>`;
  }).join("");

  $("srchTvDrama").innerHTML = tracks.map((t) => {
    const h = Math.max(10, t.drama);
    return `<div class="srch-tv-bar" style="width:${barW}px;background:${dramaColor(t.drama)};height:${h}%" data-tip="${esc(t.title)}: Drama ${t.drama}"></div>`;
  }).join("");
}

// ─── Duplicates ──────────────────────────────────────────────────────────────

function renderDuplicates() {
  if (!allTracks) return;
  dupData = allTracks.filter((t) => t.p && t.p.length > 1).map((t) => ({
    track_id: t.i, title: t.t, mix: t.m, artists: t.a, genre: t.g,
    bpm: t.b, key: t.k, camelot: t.c, pls: t.p.length,
    playlistIds: t.p, // Array von Playlist-IDs für klickbare Anzeige
  }));

  const total = dupData.length;
  const in5 = dupData.filter((t) => t.pls >= 5).length;
  const in10 = dupData.filter((t) => t.pls >= 10).length;
  const maxPls = total ? Math.max(...dupData.map((t) => t.pls)) : 0;

  $("srchDupStats").innerHTML = [
    ["In 2+ PLs", fmt(total)], ["In 5+ PLs", fmt(in5)],
    ["In 10+ PLs", fmt(in10)], ["Max PLs", maxPls],
  ].map(([l, v]) => `<div class="srch-stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  filterDups();
}

function filterDups() {
  const qVal = ($("srchDupQ")?.value ?? "").toLowerCase();
  const sv = $("srchDupSort")?.value ?? "pls-desc";
  dupFiltered = dupData.filter((t) => {
    if (qVal && !((t.title || "").toLowerCase().includes(qVal) || (t.artists || "").toLowerCase().includes(qVal))) return false;
    return true;
  });
  const [col, dir] = sv.split("-");
  const d = dir === "asc" ? 1 : -1;
  dupFiltered.sort((a, b) => {
    switch (col) {
      case "pls": return d * ((a.pls || 0) - (b.pls || 0));
      case "bpm": return d * ((a.bpm || 0) - (b.bpm || 0));
      case "title": return d * (a.title || "").localeCompare(b.title || "");
      default: return d * ((a.pls || 0) - (b.pls || 0));
    }
  });
  $("srchDupCount").textContent = fmt(dupFiltered.length) + " Duplikate";

  $("srchDupBody").innerHTML = dupFiltered.slice(0, 200).map((t, i) => {
    const plNames = (t.playlistIds || []).map((id) => playlistNameMap.get(id) || `#${id}`);
    return `<tr><td style="color:var(--muted)">${i + 1}</td>
    <td><strong>${esc(t.title)}</strong> <span style="color:var(--muted);font-size:11px">${esc(t.mix) || ""}</span></td>
    <td>${esc(t.artists) || "\u2014"}</td><td>${esc(t.genre) || "\u2014"}</td>
    <td style="color:#ff6b35;font-weight:700">${t.bpm || "\u2014"}</td><td>${t.key || "\u2014"}</td>
    <td style="color:#b197fc;font-weight:700">${t.camelot || "\u2014"}</td>
    <td>
      <details class="dup-pls-detail">
        <summary><span class="srch-badge ${badgeCls(t.pls)}">${t.pls}</span></summary>
        <ul class="dup-pls-list">${plNames.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      </details>
    </td></tr>`;
  }).join("");
}

// ─── Playlist Builder ────────────────────────────────────────────────────────

function renderPool() {
  if (!allTracks) return;
  const qf = poolFilter.toLowerCase();
  const poolGenre = $("srchPoolGenre")?.value || "";
  const poolLabel = $("srchPoolLabel")?.value || "";
  const poolBpmMin = parseInt($("srchPoolBpmMin")?.value) || 0;
  const poolBpmMax = parseInt($("srchPoolBpmMax")?.value) || 999;
  const poolKey = $("srchPoolKey")?.value || "";
  const poolYearMin = parseInt($("srchPoolYearMin")?.value) || 0;
  const poolRating = parseInt($("srchPoolRating")?.value) || 0;
  const hasFilter = qf || poolGenre || poolLabel || poolBpmMin > 0 || poolBpmMax < 999 || poolKey || poolYearMin > 0 || poolRating > 0;
  let filtered = allTracks;
  if (hasFilter) {
    filtered = allTracks.filter((t) => {
      if (qf && !((t.t || "").toLowerCase().includes(qf) || (t.a || "").toLowerCase().includes(qf) || (t.l || "").toLowerCase().includes(qf))) return false;
      if (poolGenre && t.g !== poolGenre) return false;
      if (poolLabel && t.l !== poolLabel) return false;
      if (poolBpmMin > 0 && (t.b || 0) < poolBpmMin) return false;
      if (poolBpmMax < 999 && (t.b || 999) > poolBpmMax) return false;
      if (poolKey && t.k !== poolKey) return false;
      if (poolYearMin > 0 && (t.y || 0) < poolYearMin) return false;
      if (poolRating > 0 && (t.rating || 0) < poolRating) return false;
      return true;
    });
  } else {
    filtered = allTracks.slice(0, 200);
  }
  poolCache = filtered.slice(0, 100);
  $("srchPoolCount").textContent = "(" + fmt(filtered.length) + " gefunden)";

  const list = $("srchPoolList");
  list.innerHTML = poolCache.map((t, idx) =>
    `<div class="srch-pool-item"><div class="info"><div class="title">${esc(t.t)}</div>
    <div class="meta">${esc(t.a) || "\u2014"} \u00B7 ${t.b || "?"} BPM \u00B7 ${t.k || "?"} ${t.c ? "(" + t.c + ")" : ""}</div></div>
    <button class="srch-add-btn" data-pidx="${idx}">+</button></div>`
  ).join("") + (filtered.length > 100 ? `<div style="padding:8px;text-align:center;color:var(--muted);font-size:11px">${filtered.length - 100} weitere</div>` : "");

  list.querySelectorAll(".srch-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = poolCache[parseInt(btn.dataset.pidx)];
      if (t) { playlist.push({ i: t.i, t: t.t || "", m: t.m || "", a: t.a || "", g: t.g || "", b: t.b || 0, k: t.k || "", c: t.c || "", ms: t.ms || 0 }); renderPlaylist(); }
    });
  });
}

function renderPlaylist() {
  const list = $("srchPlList");
  $("srchPlCount").textContent = playlist.length ? "(" + playlist.length + " Tracks)" : "";

  if (!playlist.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">Tracks per + hinzufügen</div>';
    $("srchPlMeta").innerHTML = "<b>0</b> Tracks &middot; <b>0:00</b> Laufzeit";
    $("srchBpmFlow").innerHTML = "";
    return;
  }

  list.innerHTML = playlist.map((t, i) => {
    let cc = "#555", compLabel = "";
    if (i > 0) {
      const comp = camelotCompat(playlist[i - 1].c, t.c);
      cc = comp === "perfect" || comp === "good" ? "var(--success)" : comp === "ok" ? "#fbbf24" : comp === "bad" ? "var(--danger)" : "#555";
      compLabel = comp;
    }
    return `<div class="srch-pl-item" draggable="true" data-idx="${i}">
      <div class="compat" style="background:${cc}" title="${compLabel || "Start"}"></div>
      <div style="flex:1;overflow:hidden"><div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.t)}</div>
      <div style="font-size:10px;color:var(--muted)">${esc(t.a) || "\u2014"} \u00B7 ${t.b} BPM \u00B7 ${t.k} ${t.c ? "(" + t.c + ")" : ""}</div></div>
      <button class="srch-rm-btn" data-ridx="${i}">\u00D7</button></div>`;
  }).join("");

  // Remove buttons
  list.querySelectorAll(".srch-rm-btn").forEach((btn) => {
    btn.addEventListener("click", () => { playlist.splice(parseInt(btn.dataset.ridx), 1); renderPlaylist(); });
  });

  // Drag & Drop
  let dragIdx = null;
  list.querySelectorAll(".srch-pl-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => { dragIdx = parseInt(item.dataset.idx); item.classList.add("dragging"); });
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const toIdx = parseInt(item.dataset.idx);
      if (dragIdx !== null && dragIdx !== toIdx) {
        const moved = playlist.splice(dragIdx, 1)[0];
        playlist.splice(toIdx, 0, moved);
        renderPlaylist();
      }
    });
    item.addEventListener("dragend", () => { item.classList.remove("dragging"); dragIdx = null; });
  });

  // Meta
  const totalMs = playlist.reduce((s, t) => s + (t.ms || 0), 0);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const bpms = playlist.filter((t) => t.b > 0);
  const avgBpm = bpms.length ? Math.round(bpms.reduce((s, t) => s + t.b, 0) / bpms.length) : 0;
  $("srchPlMeta").innerHTML = `<b>${playlist.length}</b> Tracks &middot; <b>${mins}:${String(secs).padStart(2, "0")}</b> Laufzeit &middot; &Oslash; <b>${avgBpm}</b> BPM`;

  renderBpmFlow();
}

function renderBpmFlow() {
  if (!playlist.length) { $("srchBpmFlow").innerHTML = ""; return; }
  const bpms = playlist.map((t) => t.b || 0).filter((b) => b > 0);
  if (!bpms.length) return;
  const min = Math.min(...bpms) - 5, max = Math.max(...bpms) + 5, range = max - min || 1;
  const w = 400, h = 55, pad = 5;
  const pts = bpms.map((b, i) => {
    const x = pad + (i / (bpms.length - 1 || 1)) * (w - 2 * pad);
    const y = h - pad - ((b - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  $("srchBpmFlow").innerHTML =
    `<polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/>` +
    bpms.map((b, i) => {
      const x = pad + (i / (bpms.length - 1 || 1)) * (w - 2 * pad);
      const y = h - pad - ((b - min) / range) * (h - 2 * pad);
      return `<circle cx="${x}" cy="${y}" r="3" fill="var(--primary)"><title>${b} BPM</title></circle>`;
    }).join("");
}

// ─── Recommendations Panel (Feature 2) ─────────────────────────────────────
(function initRecoPanel() {
  // Delegierter Click-Handler auf Reco-Buttons in der Suchtabelle
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".srch-reco-btn");
    if (!btn) return;
    const tid = Number(btn.dataset.tid);
    if (!tid || !window.recommendationsApi) return;

    btn.textContent = "…";
    btn.disabled = true;
    try {
      const result = await window.recommendationsApi.forTrack(tid, 20);
      showRecoPanel(tid, result);
    } catch (err) {
      showRecoPanel(tid, { ok: false, error: err.message, tracks: [] });
    } finally {
      btn.textContent = "\u{1F52E}";
      btn.disabled = false;
    }
  });

  function showRecoPanel(trackId, result) {
    let panel = document.getElementById("srchRecoPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "srchRecoPanel";
      panel.className = "srch-reco-panel";
      const container = document.getElementById("srchRecoArea");
      if (container) { container.innerHTML = ""; container.appendChild(panel); }
    }

    const source = allTracks?.find((t) => t.track_id === trackId);
    const sourceTitle = source ? `${source.title} — ${source.artists}` : `Track ${trackId}`;

    if (!result.ok || !result.tracks?.length) {
      panel.innerHTML = `
        <div class="srch-reco-head">
          <strong>Empfehlungen für:</strong> ${esc(sourceTitle)}
          <button class="srch-reco-close" title="Schließen">&times;</button>
        </div>
        <p style="color:var(--muted);padding:12px">${esc(result.error || "Keine Empfehlungen gefunden.")}</p>
      `;
      panel.querySelector(".srch-reco-close")?.addEventListener("click", () => panel.remove());
      return;
    }

    panel.innerHTML = `
      <div class="srch-reco-head">
        <strong>Empfehlungen für:</strong> ${esc(sourceTitle)} <span style="color:var(--muted)">(${result.tracks.length} Vorschläge${result.endpoint ? " via " + result.endpoint.split("/").slice(-2, -1)[0] : ""})</span>
        <button class="srch-reco-close" title="Schließen">&times;</button>
      </div>
      <div class="srch-reco-list">
        ${result.tracks.map((r) => `
          <div class="srch-reco-item">
            ${r.image ? `<img src="${esc(r.image.replace("{w}", "60").replace("{h}", "60"))}" class="srch-reco-thumb" loading="lazy" />` : ""}
            <div class="srch-reco-meta">
              <div class="srch-reco-title">${esc(r.title)} <span style="color:var(--muted);font-size:10px">${esc(r.mix_name)}</span></div>
              <div class="srch-reco-artist">${esc(r.artists)} · ${esc(r.genre)} · ${r.bpm || "?"} BPM · ${esc(r.key)}</div>
              <div class="srch-reco-label" style="font-size:10px;color:var(--muted)">${esc(r.label)}</div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    panel.querySelector(".srch-reco-close")?.addEventListener("click", () => panel.remove());
  }
})();

// ─── Bridge für Engine-Analyse Tab ──────────────────────────────────────────

/**
 * Lädt externe Tracks (z.B. aus Engine-Analyse) in den Search-Tab.
 * Wandelt Engine-Track-Format in scoring-data.json Kurzformat um.
 */
export function loadExternalTracks(tracks, sourceName = "Engine-Analyse") {
  if (!Array.isArray(tracks) || tracks.length === 0) return;

  const converted = tracks.map((t) => ({
    i: t.beatport_id || t.engine_track_id || 0,
    t: t.title || "",
    m: "",
    a: t.artists || "",
    g: t.genre || "",
    sg: "",
    b: t.bpm || 0,
    k: t.key || "",
    cam: t.camelot || "",
    y: t.year || 0,
    l: t.label || "",
    r: t.album || "",
    ms: t.length_ms || 0,
    p: [],
    _source: "engine-analyze",
    _matchType: t.matchType || "none",
  }));

  allTracks = converted;

  const status = document.getElementById("srchDataStatus");
  if (status) {
    status.innerHTML = `<span style="color:var(--success)">&check; ${converted.length} Tracks aus ${sourceName} geladen</span>`;
  }

  buildDashData();
  initFilters();
  initSubGenreFilter();
  initLabelFilter();
  initChipFilters();
  renderDashboard();
  doSearch();
}
