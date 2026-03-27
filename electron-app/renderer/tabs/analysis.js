/**
 * analysis.js — Analyse-Tab Visualisierungen
 *
 * Canvas-basierte Charts: BPM-Histogramm, Camelot Key-Wheel,
 * Genre-Breakdown, Playlist-Overlap-Heatmap.
 *
 * Wird als ES-Modul geladen und von app.js via initAnalysisTab() gesteuert.
 */

// ─── State ──────────────────────────────────────────────────────────────────────

let trackData = [];
let overlapData = [];
let loading = false;
let error = "";
let lastConfigJson = "";

// ─── Farben (passend zum bestehenden Design) ────────────────────────────────────

const COLORS = {
  primary: "#0e6b5f",
  primaryLight: "rgba(14, 107, 95, 0.7)",
  accent: "#f29f05",
  accentLight: "rgba(242, 159, 5, 0.6)",
  danger: "#9b2c23",
  muted: "#665f52",
  text: "#1f1d18",
  line: "#d8c8ab",
  panelBg: "rgba(255, 252, 246, 0.96)",
  white: "#fff",
  // Camelot-Wheel Palette (12 Tonarten × 2 Modi)
  keys: [
    "#0e6b5f", "#1a8a7b", "#27a897", "#3cc4b1", "#5fd6c7",
    "#f29f05", "#e8890a", "#d4710f", "#c05a14", "#ab4319",
    "#963118", "#7c221b",
  ],
  // Genre-Palette
  genres: [
    "#0e6b5f", "#f29f05", "#9b2c23", "#4a7fb5", "#8e6bbf",
    "#d4710f", "#3cc4b1", "#c05a14", "#5b8a3c", "#b5547a",
    "#6b7c8d", "#d4a017", "#7c4dff", "#ff6b6b", "#3d8b74",
    "#a0522d",
  ],
};

// ─── Camelot-Wheel Mappings ─────────────────────────────────────────────────────

const CAMELOT_MAP = {
  // Minor keys → Camelot A codes
  "Ab min": "1A",  "G# min": "1A",
  "Eb min": "2A",  "D# min": "2A",
  "Bb min": "3A",  "A# min": "3A",
  "F min":  "4A",
  "C min":  "5A",
  "G min":  "6A",
  "D min":  "7A",
  "A min":  "8A",
  "E min":  "9A",
  "B min": "10A",
  "F# min": "11A", "Gb min": "11A",
  "Db min": "12A", "C# min": "12A",
  // Major keys → Camelot B codes
  "B maj":  "1B",
  "F# maj": "2B",  "Gb maj": "2B",
  "Db maj": "3B",  "C# maj": "3B",
  "Ab maj": "4B",  "G# maj": "4B",
  "Eb maj": "5B",  "D# maj": "5B",
  "Bb maj": "6B",  "A# maj": "6B",
  "F maj":  "7B",
  "C maj":  "8B",
  "G maj":  "9B",
  "D maj": "10B",
  "A maj": "11B",
  "E maj": "12B",
};

const CAMELOT_LABELS = [
  "1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A", "9A", "10A", "11A", "12A",
  "1B", "2B", "3B", "4B", "5B", "6B", "7B", "8B", "9B", "10B", "11B", "12B",
];

function toCamelot(rawKey) {
  if (!rawKey) return null;
  const k = rawKey.trim();
  // Already Camelot notation?
  if (/^\d{1,2}[AB]$/i.test(k)) return k.toUpperCase();
  return CAMELOT_MAP[k] || null;
}

// ─── Daten laden ────────────────────────────────────────────────────────────────

export async function loadAnalysisData(config) {
  const configJson = JSON.stringify(config || {});
  if (loading) return;
  if (trackData.length > 0 && configJson === lastConfigJson) return;

  loading = true;
  error = "";
  renderLoadingState();

  try {
    // Sequenziell laden — SQLite sperrt die DB bei parallelen Prozessen
    const tracks = await window.analysisApi.getTrackData(config);
    trackData = Array.isArray(tracks) ? tracks : [];
    const overlaps = await window.analysisApi.getOverlapMatrix(config);
    overlapData = Array.isArray(overlaps) ? overlaps : [];
    lastConfigJson = configJson;
  } catch (err) {
    error = err.message || "Daten konnten nicht geladen werden.";
    trackData = [];
    overlapData = [];
  } finally {
    loading = false;
  }

  renderAnalysis();
}

export function forceReload() {
  lastConfigJson = "";
  error = "";
}

// ─── Render-Steuerung ───────────────────────────────────────────────────────────

function renderLoadingState() {
  const container = document.getElementById("analysis-content");
  if (!container) return;
  container.innerHTML = `
    <section class="panel span-full placeholder-panel">
      <p class="placeholder-text">Lade Analyse-Daten&hellip;</p>
    </section>
  `;
}

function renderAnalysis() {
  const container = document.getElementById("analysis-content");
  if (!container) return;

  if (error) {
    container.innerHTML = `
      <section class="panel span-full">
        <div class="callout warning">${escapeHtml(error)}</div>
      </section>
    `;
    return;
  }

  if (trackData.length === 0) {
    container.innerHTML = `
      <section class="panel span-full placeholder-panel">
        <h2>Keine Analyse-Daten</h2>
        <p class="placeholder-text">
          Führe zuerst einen Scan mit Tiefenanalyse im Scanner-Tab durch,
          damit BPM, Key, Genre und Label für deine Tracks vorliegen.
        </p>
      </section>
    `;
    return;
  }

  // Stats berechnen
  const totalTracks = trackData.length;
  const uniqueTracks = new Set(trackData.map((t) => t.trackId).filter(Boolean)).size;
  const playlists = new Set(trackData.map((t) => t.playlistKey)).size;
  const withBpm = trackData.filter((t) => parseBpm(t.bpm) > 0).length;
  const withKey = trackData.filter((t) => toCamelot(t.key)).length;

  container.innerHTML = `
    <section class="panel span-full">
      <div class="analysis-stats">
        <div class="stat-card">
          <span class="stat-label">Track-Einträge</span>
          <strong class="stat-value">${totalTracks.toLocaleString("de")}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Unique Tracks</span>
          <strong class="stat-value">${uniqueTracks.toLocaleString("de")}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Playlists</span>
          <strong class="stat-value">${playlists}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Mit BPM</span>
          <strong class="stat-value">${pct(withBpm, totalTracks)}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Mit Key</span>
          <strong class="stat-value">${pct(withKey, totalTracks)}</strong>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>BPM-Verteilung</h2>
      <canvas id="chart-bpm" width="600" height="320"></canvas>
    </section>

    <section class="panel">
      <h2>Camelot Key-Wheel</h2>
      <canvas id="chart-key" width="480" height="480"></canvas>
    </section>

    <section class="panel span-full">
      <h2>Genre-Breakdown</h2>
      <canvas id="chart-genre" width="900" height="360"></canvas>
    </section>

    <section class="panel span-full">
      <div class="section-head">
        <h2>Playlist-Overlap</h2>
        <span class="pill">${overlapData.length} Paare mit &ge;2 gemeinsamen Tracks</span>
      </div>
      <div id="overlap-table-wrap" class="table-wrap" style="max-height:420px"></div>
    </section>
  `;

  // Charts zeichnen (nächster Frame → Canvas ist im DOM)
  requestAnimationFrame(() => {
    drawBpmHistogram();
    drawKeyWheel();
    drawGenreChart();
    renderOverlapTable();
  });
}

// ─── BPM-Histogramm ─────────────────────────────────────────────────────────────

function parseBpm(raw) {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function drawBpmHistogram() {
  const canvas = document.getElementById("chart-bpm");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Daten gruppieren in 5-BPM Bins
  const bpms = trackData.map((t) => parseBpm(t.bpm)).filter((b) => b >= 60 && b <= 200);
  if (bpms.length === 0) {
    drawEmptyMessage(ctx, w, h, "Keine BPM-Daten");
    return;
  }

  const binSize = 5;
  const minBpm = Math.floor(Math.min(...bpms) / binSize) * binSize;
  const maxBpm = Math.ceil(Math.max(...bpms) / binSize) * binSize;
  const bins = new Map();
  for (let b = minBpm; b <= maxBpm; b += binSize) bins.set(b, 0);
  for (const bpm of bpms) {
    const bin = Math.floor(bpm / binSize) * binSize;
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }

  const entries = [...bins.entries()].sort((a, b) => a[0] - b[0]);
  const maxCount = Math.max(...entries.map(([, c]) => c));

  // Layout
  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const barW = Math.max(2, cw / entries.length - 1);

  // Achsen
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, h - pad.bottom);
  ctx.lineTo(w - pad.right, h - pad.bottom);
  ctx.stroke();

  // Balken
  entries.forEach(([bin, count], i) => {
    const x = pad.left + (i / entries.length) * cw;
    const barH = (count / maxCount) * ch;
    const y = h - pad.bottom - barH;

    const gradient = ctx.createLinearGradient(x, y, x, h - pad.bottom);
    gradient.addColorStop(0, COLORS.primary);
    gradient.addColorStop(1, COLORS.primaryLight);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barW, barH);

    // X-Labels (alle 20 BPM)
    if (bin % 20 === 0) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = "11px 'Avenir Next', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(bin), x + barW / 2, h - pad.bottom + 16);
    }
  });

  // Y-Achsen Labels
  ctx.fillStyle = COLORS.muted;
  ctx.font = "11px 'Avenir Next', sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((maxCount / 4) * i);
    const y = h - pad.bottom - (i / 4) * ch;
    ctx.fillText(String(val), pad.left - 8, y + 4);
    if (i > 0) {
      ctx.strokeStyle = "rgba(216, 200, 171, 0.3)";
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }
  }

  // Median-Linie
  const sorted = [...bpms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const medianX = pad.left + ((median - minBpm) / (maxBpm - minBpm)) * cw;
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(medianX, pad.top);
  ctx.lineTo(medianX, h - pad.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.accent;
  ctx.font = "bold 12px 'Avenir Next', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Median: ${median} BPM`, medianX, pad.top - 4);
}

// ─── Camelot Key-Wheel ──────────────────────────────────────────────────────────

function drawKeyWheel() {
  const canvas = document.getElementById("chart-key");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.clientWidth, canvas.clientHeight);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  // Zählung nach Camelot-Code
  const counts = {};
  for (const label of CAMELOT_LABELS) counts[label] = 0;
  for (const t of trackData) {
    const c = toCamelot(t.key);
    if (c && counts[c] !== undefined) counts[c]++;
  }
  const maxCount = Math.max(1, ...Object.values(counts));
  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  if (total === 0) {
    drawEmptyMessage(ctx, size, size, "Keine Key-Daten");
    return;
  }

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 30;
  const innerR = outerR * 0.48;
  const sliceAngle = (2 * Math.PI) / 12;
  const startOffset = -Math.PI / 2 - sliceAngle / 2;

  // Outer ring = B (Major), Inner ring = A (Minor)
  for (let i = 0; i < 12; i++) {
    const angle0 = startOffset + i * sliceAngle;
    const angle1 = angle0 + sliceAngle;
    const midAngle = angle0 + sliceAngle / 2;

    // B-Ring (Major) — aussen
    const bKey = `${i + 1}B`;
    const bFrac = counts[bKey] / maxCount;
    const bR = innerR + (outerR - innerR) * 0.5 + (outerR - innerR) * 0.5 * bFrac;
    drawArcSlice(ctx, cx, cy, innerR + (outerR - innerR) * 0.5, bR, angle0, angle1, COLORS.keys[i], 0.3 + 0.7 * bFrac);
    // Label
    const bLabelR = innerR + (outerR - innerR) * 0.75;
    const bx = cx + bLabelR * Math.cos(midAngle);
    const by = cy + bLabelR * Math.sin(midAngle);
    ctx.fillStyle = bFrac > 0.4 ? COLORS.white : COLORS.text;
    ctx.font = `bold ${bFrac > 0.3 ? 13 : 11}px 'Avenir Next', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(bKey, bx, by);

    // A-Ring (Minor) — innen
    const aKey = `${i + 1}A`;
    const aFrac = counts[aKey] / maxCount;
    const aR = innerR * 0.3 + innerR * 0.7 * aFrac;
    drawArcSlice(ctx, cx, cy, innerR * 0.3, innerR + (outerR - innerR) * 0.48, angle0, angle1, COLORS.keys[i], 0.15 + 0.55 * aFrac);
    // Label
    const aLabelR = innerR * 0.7;
    const ax = cx + aLabelR * Math.cos(midAngle);
    const ay = cy + aLabelR * Math.sin(midAngle);
    ctx.fillStyle = aFrac > 0.3 ? COLORS.white : COLORS.text;
    ctx.font = `${aFrac > 0.3 ? 12 : 10}px 'Avenir Next', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(aKey, ax, ay);
  }

  // Trennlinien
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const angle = startOffset + i * sliceAngle;
    ctx.beginPath();
    ctx.moveTo(cx + innerR * 0.3 * Math.cos(angle), cy + innerR * 0.3 * Math.sin(angle));
    ctx.lineTo(cx + outerR * Math.cos(angle), cy + outerR * Math.sin(angle));
    ctx.stroke();
  }

  // Innerer Kreis — Zusammenfassung
  ctx.beginPath();
  ctx.arc(cx, cy, innerR * 0.28, 0, 2 * Math.PI);
  ctx.fillStyle = COLORS.panelBg;
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 16px 'Avenir Next', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(total), cx, cy - 6);
  ctx.font = "11px 'Avenir Next', sans-serif";
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("Tracks", cx, cy + 10);
}

function drawArcSlice(ctx, cx, cy, rInner, rOuter, a0, a1, color, alpha) {
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, a0, a1);
  ctx.arc(cx, cy, rInner, a1, a0, true);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, alpha);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

// ─── Genre-Breakdown ─────────────────────────────────────────────────────────────

function drawGenreChart() {
  const canvas = document.getElementById("chart-genre");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Top-Genres zählen
  const genreCounts = new Map();
  for (const t of trackData) {
    const genre = (t.genre || "").trim();
    if (!genre) continue;
    genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  }

  if (genreCounts.size === 0) {
    drawEmptyMessage(ctx, w, h, "Keine Genre-Daten");
    return;
  }

  const sorted = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const maxCount = sorted[0][1];
  const pad = { top: 10, right: 60, bottom: 10, left: 200 };
  const barAreaH = h - pad.top - pad.bottom;
  const barH = Math.min(28, barAreaH / sorted.length - 4);
  const barGap = (barAreaH - barH * sorted.length) / sorted.length;

  sorted.forEach(([genre, count], i) => {
    const y = pad.top + i * (barH + barGap);
    const barW = (count / maxCount) * (w - pad.left - pad.right);

    // Bar
    const color = COLORS.genres[i % COLORS.genres.length];
    const gradient = ctx.createLinearGradient(pad.left, y, pad.left + barW, y);
    gradient.addColorStop(0, withAlpha(color, 0.85));
    gradient.addColorStop(1, withAlpha(color, 0.55));
    ctx.fillStyle = gradient;
    roundRect(ctx, pad.left, y, barW, barH, 4);
    ctx.fill();

    // Genre-Label (links)
    ctx.fillStyle = COLORS.text;
    ctx.font = "12px 'Avenir Next', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const label = genre.length > 28 ? genre.slice(0, 26) + "…" : genre;
    ctx.fillText(label, pad.left - 10, y + barH / 2);

    // Count (rechts vom Balken)
    ctx.fillStyle = COLORS.muted;
    ctx.font = "bold 11px 'Avenir Next', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(count), pad.left + barW + 8, y + barH / 2);
  });
}

// ─── Playlist-Overlap Tabelle ───────────────────────────────────────────────────

function renderOverlapTable() {
  const wrap = document.getElementById("overlap-table-wrap");
  if (!wrap) return;

  if (overlapData.length === 0) {
    wrap.classList.add("empty");
    wrap.textContent = "Keine überlappenden Playlists gefunden (min. 2 gemeinsame Tracks).";
    return;
  }

  wrap.classList.remove("empty");
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Playlist A</th>
        <th>Playlist B</th>
        <th style="text-align:right">Gemeinsame Tracks</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  for (const row of overlapData) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="wrap-cell">${escapeHtml(row.nameA || row.playlistA)}</td>
      <td class="wrap-cell">${escapeHtml(row.nameB || row.playlistB)}</td>
      <td style="text-align:right;font-weight:700">${row.sharedTracks}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

// ─── Canvas-Hilfsfunktionen ─────────────────────────────────────────────────────

function drawEmptyMessage(ctx, w, h, message) {
  ctx.fillStyle = COLORS.muted;
  ctx.font = "14px 'Avenir Next', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, w / 2, h / 2);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function withAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}
