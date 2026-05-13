/**
 * Playlist Builder — Standalone-Komponente
 *
 * Wiederverwendbarer Track-Pool + Playlist-Builder mit:
 * - Pool-Suche & Filter (BPM, Key, Genre, Label, Rating)
 * - Playlist mit Drag&Drop Reihenfolge
 * - Camelot-Kompatibilitaet (farbige Dots)
 * - BPM-Flow SVG
 * - "Playlist erstellen" Aktion (Beatport / Engine DJ)
 *
 * Tracks im scoring-data Kurzformat: {i, t, m, a, g, b, k, c, ms, l, y, rating}
 * Fuer Engine-Tracks: addTracksToPool() konvertiert automatisch.
 */

// ─── State ──────────────────────────────────────────────────────────────────

let poolTracks = [];       // alle Tracks im Pool
let playlist = [];         // aktuelle Playlist (geordnet)
let poolFilter = "";
let containerEl = null;
let _onSave = null;        // callback(playlistName, tracks)

// ─── Helpers ────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

// Helpers + Camelot/Drama aus konsolidierter Lib. dramaScore wird ohne
// DOM-Toggle-Parameter aufgerufen — Default useNorm=true entspricht
// vorherigem playlist-builder-Verhalten (normBpm(bpm) || bpm).
import {
  esc,
  normBpm,
  camelotSortVal,
  camelotCompat,
  dramaScore,
  dramaColor,
  toCamelot,
} from "../lib/track-utils.js";

/**
 * Konvertiert Engine-Analyse-Track-Format zum Kurzformat.
 */
function normalizeTrack(t) {
  if (t.i !== undefined) return t; // schon Kurzformat
  return {
    i: t.beatport_id || t.engine_track_id || t.track_id || "",
    t: t.title || "",
    m: t.mix_name || "",
    a: t.artists || t.artist || "",
    g: t.genre || "",
    b: t.bpm || 0,
    k: t.key || "",
    c: t.camelot || toCamelot(t.key) || "",
    ms: t.length_ms || 0,
    l: t.label || "",
    y: t.year || 0,
    rating: t.rating || null,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function renderBuilder(container) {
  containerEl = container;
  container.innerHTML = `
    <div class="pb-howto" style="font-size:11px;color:var(--muted);margin-bottom:8px">
      <strong>Builder:</strong> Links Pool durchsuchen, per <strong>+</strong> hinzuf\u00fcgen. Rechts per Drag&Drop sortieren.
    </div>
    <div class="pb-wrap">
      <div class="pb-panel">
        <h3 style="font-size:13px;margin:0 0 6px">Track-Pool <span style="font-size:11px;color:var(--muted);font-weight:400" id="pbPoolCount"></span></h3>
        <div style="display:flex;gap:4px;margin-bottom:4px">
          <input type="text" id="pbPoolSearch" placeholder="Track, Artist, Label\u2026" style="flex:1;padding:5px 8px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:11px">
        </div>
        <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
          <input type="number" id="pbBpmMin" placeholder="BPM \u2265" min="60" max="200" style="width:55px;padding:4px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:10px">
          <input type="number" id="pbBpmMax" placeholder="BPM \u2264" min="60" max="200" style="width:55px;padding:4px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:10px">
          <select id="pbKeyFilter" style="padding:4px;background:var(--bg);border:1px solid var(--line-strong);border-radius:4px;color:var(--text);font-size:10px;max-width:70px"><option value="">Key</option></select>
        </div>
        <div class="pb-pool-list" id="pbPoolList" style="flex:1;overflow-y:auto;max-height:calc(100vh - 400px)"></div>
      </div>
      <div class="pb-panel">
        <h3 style="font-size:13px;margin:0 0 6px">Playlist <span style="font-size:11px;color:var(--muted);font-weight:400" id="pbPlCount"></span></h3>
        <div class="pb-pl-meta" id="pbPlMeta" style="font-size:11px;color:var(--muted);margin-bottom:6px"><b>0</b> Tracks &middot; <b>0:00</b> Laufzeit</div>
        <div style="display:flex;gap:4px;margin-bottom:6px">
          <button type="button" id="pbSortCamelot" style="padding:3px 8px;font-size:10px">Camelot</button>
          <button type="button" id="pbSortBpm" style="padding:3px 8px;font-size:10px">BPM</button>
          <button type="button" id="pbClearPl" class="danger" style="padding:3px 8px;font-size:10px">Leeren</button>
        </div>
        <div class="pb-pl-list" id="pbPlList" style="flex:1;overflow-y:auto;max-height:calc(100vh - 400px)"></div>
        <svg class="pb-bpm-flow" id="pbBpmFlow" viewBox="0 0 400 50" preserveAspectRatio="none" style="width:100%;height:40px;margin-top:6px"></svg>
      </div>
    </div>
  `;
  bindBuilderEvents();
  renderPool();
  renderPlaylist();
}

export function addTracksToPool(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return;
  const existing = new Set(poolTracks.map(t => String(t.i)));
  let added = 0;
  for (const t of tracks) {
    const norm = normalizeTrack(t);
    const key = String(norm.i || `${norm.t}|${norm.a}`);
    if (!existing.has(key)) {
      poolTracks.push(norm);
      existing.add(key);
      added++;
    }
  }
  if (containerEl) {
    renderPool();
    updateBadge();
  }
  return added;
}

export function clearPool() {
  poolTracks = [];
  if (containerEl) {
    renderPool();
    updateBadge();
  }
}

export function getPlaylist() {
  return [...playlist];
}

export function getPoolCount() {
  return poolTracks.length;
}

export function getPlaylistCount() {
  return playlist.length;
}

export function onSave(callback) {
  _onSave = callback;
}

// ─── Internal Rendering ─────────────────────────────────────────────────────

function updateBadge() {
  const badge = $("builderPoolBadge");
  if (badge) badge.textContent = poolTracks.length;
  const toggleBadge = $("builderToggleBadge");
  if (toggleBadge) toggleBadge.textContent = poolTracks.length;
}

function renderPool() {
  const list = $("pbPoolList");
  if (!list) return;

  const qf = ($("pbPoolSearch")?.value || "").toLowerCase();
  const bpmMin = parseInt($("pbBpmMin")?.value) || 0;
  const bpmMax = parseInt($("pbBpmMax")?.value) || 999;
  const keyFilter = $("pbKeyFilter")?.value || "";

  let filtered = poolTracks;
  if (qf || bpmMin > 0 || bpmMax < 999 || keyFilter) {
    filtered = poolTracks.filter(t => {
      if (qf && !((t.t || "").toLowerCase().includes(qf) || (t.a || "").toLowerCase().includes(qf) || (t.l || "").toLowerCase().includes(qf))) return false;
      if (bpmMin > 0 && (t.b || 0) < bpmMin) return false;
      if (bpmMax < 999 && (t.b || 999) > bpmMax) return false;
      if (keyFilter && toCamelot(t.k) !== keyFilter && t.k !== keyFilter) return false;
      return true;
    });
  }

  const show = filtered.slice(0, 100);
  $("pbPoolCount").textContent = `(${filtered.length})`;

  list.innerHTML = show.map((t, idx) => {
    const ds = dramaScore(t.b, toCamelot(t.k));
    const dc = dramaColor(ds);
    return `<div class="pb-pool-item"><div class="info"><div class="title" style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.t)}</div>
    <div class="meta" style="font-size:9px;color:var(--muted)">${esc(t.a) || "\u2014"} \u00B7 ${t.b || "?"} BPM \u00B7 ${toCamelot(t.k) || "?"} \u00B7 <span style="color:${dc};font-weight:700">D${ds}</span></div></div>
    <button class="pb-add-btn" data-pidx="${idx}" style="padding:2px 8px;font-size:14px;cursor:pointer;background:none;border:1px solid var(--line-strong);border-radius:4px;color:var(--text)">+</button></div>`;
  }
  ).join("") + (filtered.length > 100 ? `<div style="padding:6px;text-align:center;color:var(--muted);font-size:10px">${filtered.length - 100} weitere</div>` : "");

  list.querySelectorAll(".pb-add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = show[parseInt(btn.dataset.pidx)];
      if (t) { playlist.push({ ...t }); renderPlaylist(); }
    });
  });
}

function renderPlaylist() {
  const list = $("pbPlList");
  if (!list) return;

  $("pbPlCount").textContent = playlist.length ? `(${playlist.length})` : "";

  if (!playlist.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:11px">Tracks per + hinzuf\u00fcgen</div>';
    $("pbPlMeta").innerHTML = "<b>0</b> Tracks &middot; <b>0:00</b> Laufzeit";
    $("pbBpmFlow").innerHTML = "";
    return;
  }

  list.innerHTML = playlist.map((t, i) => {
    let cc = "#555", compLabel = "";
    if (i > 0) {
      const cam = toCamelot(t.k);
      const prevCam = toCamelot(playlist[i - 1].k);
      const comp = camelotCompat(prevCam, cam);
      cc = comp === "perfect" || comp === "good" ? "var(--success)" : comp === "ok" ? "#fbbf24" : comp === "bad" ? "var(--danger)" : "#555";
      compLabel = comp;
    }
    const ds = dramaScore(t.b, toCamelot(t.k));
    const dc = dramaColor(ds);
    return `<div class="pb-pl-item" draggable="true" data-idx="${i}" style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid var(--line);cursor:grab">
      <div style="width:6px;height:6px;border-radius:50%;background:${cc};flex-shrink:0" title="${compLabel || "Start"}"></div>
      <div style="flex:1;overflow:hidden"><div style="font-weight:600;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.t)}</div>
      <div style="font-size:9px;color:var(--muted)">${esc(t.a) || "\u2014"} \u00B7 ${t.b} BPM \u00B7 ${toCamelot(t.k) || "?"}</div></div>
      <span style="font-size:10px;font-weight:700;color:${dc};min-width:24px;text-align:center" title="Dramaturgie ${ds}">${ds}</span>
      <button class="pb-rm-btn" data-ridx="${i}" style="padding:2px 6px;font-size:12px;cursor:pointer;background:none;border:none;color:var(--muted)">\u00D7</button></div>`;
  }).join("");

  // Remove
  list.querySelectorAll(".pb-rm-btn").forEach(btn => {
    btn.addEventListener("click", () => { playlist.splice(parseInt(btn.dataset.ridx), 1); renderPlaylist(); });
  });

  // Drag & Drop
  let dragIdx = null;
  list.querySelectorAll(".pb-pl-item").forEach(item => {
    item.addEventListener("dragstart", () => { dragIdx = parseInt(item.dataset.idx); item.style.opacity = "0.5"; });
    item.addEventListener("dragover", e => e.preventDefault());
    item.addEventListener("drop", e => {
      e.preventDefault();
      const toIdx = parseInt(item.dataset.idx);
      if (dragIdx !== null && dragIdx !== toIdx) {
        const moved = playlist.splice(dragIdx, 1)[0];
        playlist.splice(toIdx, 0, moved);
        renderPlaylist();
      }
    });
    item.addEventListener("dragend", () => { item.style.opacity = "1"; dragIdx = null; });
  });

  // Meta
  const totalMs = playlist.reduce((s, t) => s + (t.ms || 0), 0);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const bpms = playlist.filter(t => t.b > 0);
  const avgBpm = bpms.length ? Math.round(bpms.reduce((s, t) => s + t.b, 0) / bpms.length) : 0;
  $("pbPlMeta").innerHTML = `<b>${playlist.length}</b> Tracks &middot; <b>${mins}:${String(secs).padStart(2, "0")}</b> &middot; \u00D8 <b>${avgBpm}</b> BPM`;

  renderBpmFlow();
}

function renderBpmFlow() {
  const svg = $("pbBpmFlow");
  if (!svg || !playlist.length) { if (svg) svg.innerHTML = ""; return; }
  const bpms = playlist.map(t => t.b || 0).filter(b => b > 0);
  if (!bpms.length) return;
  const min = Math.min(...bpms) - 5, max = Math.max(...bpms) + 5, range = max - min || 1;
  const w = 400, h = 45, pad = 5;
  const pts = bpms.map((b, i) => {
    const x = pad + (i / (bpms.length - 1 || 1)) * (w - 2 * pad);
    const y = h - pad - ((b - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  svg.innerHTML =
    `<polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/>` +
    bpms.map((b, i) => {
      const x = pad + (i / (bpms.length - 1 || 1)) * (w - 2 * pad);
      const y = h - pad - ((b - min) / range) * (h - 2 * pad);
      return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--primary)"><title>${b} BPM</title></circle>`;
    }).join("");
}

// ─── Event Binding ──────────────────────────────────────────────────────────

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function bindBuilderEvents() {
  $("pbPoolSearch")?.addEventListener("input", debounce(() => renderPool(), 200));
  $("pbBpmMin")?.addEventListener("input", debounce(() => renderPool(), 300));
  $("pbBpmMax")?.addEventListener("input", debounce(() => renderPool(), 300));
  $("pbKeyFilter")?.addEventListener("change", () => renderPool());

  // Key-Filter befuellen
  const pk = $("pbKeyFilter");
  if (pk) {
    for (let n = 1; n <= 12; n++) {
      for (const l of ["A", "B"]) {
        const o = document.createElement("option");
        o.value = `${n}${l}`;
        o.textContent = `${n}${l}`;
        pk.appendChild(o);
      }
    }
  }

  $("pbSortCamelot")?.addEventListener("click", () => {
    playlist.sort((a, b) => camelotSortVal(toCamelot(a.k)) - camelotSortVal(toCamelot(b.k)));
    renderPlaylist();
  });
  $("pbSortBpm")?.addEventListener("click", () => {
    playlist.sort((a, b) => (a.b || 0) - (b.b || 0));
    renderPlaylist();
  });
  $("pbClearPl")?.addEventListener("click", () => {
    playlist = [];
    renderPlaylist();
  });
}
