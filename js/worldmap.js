import { WORLD } from './worlddata.js';
import { clamp, TAU, strSeed } from './util.js';

// Proiezione equirettangolare ritagliata (vedi tools/build_worldmap.py):
//   x = (lon + 180) / 360        y = (latMax - lat) / (latMax - latMin)
// Le missioni possono dichiarare `region: { lat, lon }` (consigliato) oppure
// le vecchie `x`/`y` normalizzate 0..1.

const LAT_MIN = WORLD.latMin;
const LAT_MAX = WORLD.latMax;
const ASPECT = 360 / (LAT_MAX - LAT_MIN);

/** Blocchi corporativi che si spartiscono il pianeta (come nella mappa originale). */
export const BLOCS = [
  { id: 'sindacato', name: 'Sindacato', fill: [24, 86, 104], edge: 'rgba(55, 225, 255, 0.55)' },
  { id: 'aurex', name: 'Aurex Corp', fill: [96, 68, 26], edge: 'rgba(255, 196, 92, 0.5)' },
  { id: 'rivali', name: 'Sindacati rivali', fill: [70, 46, 100], edge: 'rgba(198, 140, 255, 0.45)' },
  { id: 'chiesa', name: 'Chiesa del Nuovo Epoch', fill: [88, 38, 50], edge: 'rgba(255, 120, 130, 0.4)' },
  { id: 'indipendenti', name: 'Consorzi indipendenti', fill: [40, 54, 68], edge: 'rgba(150, 178, 198, 0.32)' },
];

const STATUS = {
  done: { col: '#39e07a', rgb: [57, 224, 122], label: 'CONTROLLATO' },
  avail: { col: '#ffd24d', rgb: [255, 210, 77], label: 'OBIETTIVO' },
  locked: { col: '#6d7a92', rgb: [109, 122, 146], label: 'BLOCCATO' },
};

const CONTINENTS = [
  { t: 'NORD AMERICA', lat: 48, lon: -101 },
  { t: 'SUD AMERICA', lat: -14, lon: -60 },
  { t: 'EUROPA', lat: 52, lon: 16 },
  { t: 'AFRICA', lat: 4, lon: 19 },
  { t: 'ASIA', lat: 47, lon: 92 },
  { t: 'OCEANIA', lat: -26, lon: 134 },
];

const projX = (lon) => (lon + 180) / 360;
const projY = (lat) => (LAT_MAX - lat) / (LAT_MAX - LAT_MIN);

/** Posizione normalizzata di una missione, con supporto lat/lon e x/y. */
export function regionPoint(region = {}) {
  if (typeof region.lat === 'number' && typeof region.lon === 'number') {
    return { x: projX(region.lon), y: projY(region.lat) };
  }
  return { x: region.x ?? 0.5, y: region.y ?? 0.5 };
}

function ringPoints(flat) {
  const p = new Array(flat.length / 2);
  for (let i = 0; i < p.length; i++) p[i] = [flat[i * 2] / WORLD.min, flat[i * 2 + 1] / WORLD.min];
  return p;
}

// Prepara una volta sola i poligoni con bbox, area e centroide (per i tooltip).
const COUNTRIES = WORLD.countries.map((c) => {
  let best = null, bestA = 0;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  const rings = c.p.map((flat) => {
    const pts = ringPoints(flat);
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i], [nx, ny] = pts[(i + 1) % pts.length];
      a += x * ny - nx * y;
      cx += x; cy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    a = Math.abs(a) / 2;
    const ctr = { x: cx / pts.length, y: cy / pts.length };
    if (a > bestA) { bestA = a; best = ctr; }
    return pts;
  });
  return { name: c.n, rings, bbox: [x0, y0, x1, y1], area: bestA, center: best || { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, bloc: strSeed(c.n) % BLOCS.length, anim: null, path: null };
});

function inRing(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function countryAt(x, y) {
  for (const c of COUNTRIES) {
    const [x0, y0, x1, y1] = c.bbox;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    for (const ring of c.rings) if (inRing(x, y, ring)) return c;
  }
  return null;
}

const rgba = (rgb, a) => `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${a})`;

export function createWorldMap(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const missions = opts.missions || [];
  const statusOf = opts.statusOf || (() => 'locked');
  const onSelect = opts.onSelect || (() => {});

  const nodes = missions.map((m, i) => {
    const p = regionPoint(m.region);
    return { m, nx: p.x, ny: p.y, country: null, status: statusOf(m), appear: 0.35 + i * 0.09 };
  });

  // Territorio di appartenenza di ogni missione (paese che contiene il punto).
  for (const n of nodes) n.country = countryAt(n.nx, n.ny);

  const state = {
    z: 1, tx: 0, ty: 0,
    selected: opts.selected || null,
    hover: null, hoverCountry: null, cursor: null,
    dragging: false, moved: 0, sx: 0, sy: 0, t0: performance.now(),
  };

  let W = 0, H = 0, dpr = 1;
  let base = { x: 0, y: 0, w: 0, h: 0 };
  let allPath = null, blocPaths = [], gradient = null;
  let placed = [];

  const bx = (nx) => base.x + nx * base.w;
  const by = (ny) => base.y + ny * base.h;

  function buildPaths() {
    allPath = new Path2D();
    for (const c of COUNTRIES) {
      const p = new Path2D();
      for (const ring of c.rings) {
        for (let i = 0; i < ring.length; i++) {
          const [x, y] = ring[i];
          if (i) p.lineTo(bx(x), by(y)); else p.moveTo(bx(x), by(y));
        }
        p.closePath();
      }
      c.path = p;
      allPath.addPath(p);
    }
    rebuildBlocs();
    gradient = ctx.createLinearGradient(0, base.y, 0, base.y + base.h);
    gradient.addColorStop(0, 'rgba(150, 205, 255, 0.10)');
    gradient.addColorStop(0.42, 'rgba(150, 205, 255, 0.02)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
  }

  function rebuildBlocs() {
    blocPaths = BLOCS.map(() => new Path2D());
    for (const c of COUNTRIES) if (!c.anim) blocPaths[c.bloc].addPath(c.path);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    if (w === W && h === H && allPath) return true;
    W = w; H = h;
    const availW = Math.max(80, w - 58), availH = Math.max(60, h - 56);
    let bw = availW, bh = bw / ASPECT;
    if (bh > availH) { bh = availH; bw = bh * ASPECT; }
    base = { x: 32 + (availW - bw) / 2, y: 28 + (availH - bh) / 2, w: bw, h: bh };
    buildPaths();
    return true;
  }

  function clampView() {
    const left = base.x * state.z, right = (base.x + base.w) * state.z;
    const top = base.y * state.z, bottom = (base.y + base.h) * state.z;
    const loX = W - right, hiX = -left;
    state.tx = loX < hiX ? clamp(state.tx, loX, hiX) : (loX + hiX) / 2;
    const loY = H - bottom, hiY = -top;
    state.ty = loY < hiY ? clamp(state.ty, loY, hiY) : (loY + hiY) / 2;
  }

  const toScreen = (nx, ny) => ({ x: bx(nx) * state.z + state.tx, y: by(ny) * state.z + state.ty });

  function toWorld(sx, sy) {
    const x = (sx - state.tx) / state.z, y = (sy - state.ty) / state.z;
    return { x: (x - base.x) / base.w, y: (y - base.y) / base.h };
  }

  // ------------------------------------------------------------- disegno
  function drawBase(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 30, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#08192a');
    bg.addColorStop(1, '#03060b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.setTransform(dpr * state.z, 0, 0, dpr * state.z, dpr * state.tx, dpr * state.ty);
    ctx.beginPath();
    ctx.rect(base.x, base.y, base.w, base.h);
    ctx.clip();

    // oceano
    const og = ctx.createLinearGradient(0, base.y, 0, base.y + base.h);
    og.addColorStop(0, '#061420');
    og.addColorStop(0.5, '#0a2436');
    og.addColorStop(1, '#051220');
    ctx.fillStyle = og;
    ctx.fillRect(base.x, base.y, base.w, base.h);

    // graticola
    ctx.lineWidth = 0.7 / state.z;
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = bx(projX(lon));
      ctx.strokeStyle = lon === 0 ? 'rgba(55,225,255,0.16)' : 'rgba(55,225,255,0.07)';
      ctx.beginPath(); ctx.moveTo(x, base.y); ctx.lineTo(x, base.y + base.h); ctx.stroke();
    }
    for (let lat = -60; lat <= 90; lat += 30) {
      if (lat < LAT_MIN || lat > LAT_MAX) continue;
      const y = by(projY(lat));
      ctx.strokeStyle = lat === 0 ? 'rgba(55,225,255,0.18)' : 'rgba(55,225,255,0.07)';
      ctx.beginPath(); ctx.moveTo(base.x, y); ctx.lineTo(base.x + base.w, y); ctx.stroke();
    }

    // terre per blocco
    ctx.globalAlpha = 0.82;
    BLOCS.forEach((b, i) => { ctx.fillStyle = rgba(b.fill, 0.92); ctx.fill(blocPaths[i]); });
    ctx.globalAlpha = 1;
    // paesi in transizione di controllo
    for (const c of COUNTRIES) {
      if (!c.anim) continue;
      const k = clamp((t - c.anim.t0) / c.anim.dur, 0, 1);
      const from = BLOCS[c.anim.from].fill, to = BLOCS[c.bloc].fill;
      ctx.fillStyle = rgba([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k], 0.92);
      ctx.fill(c.path);
    }

    // ombreggiatura latitudinale
    ctx.fillStyle = gradient;
    ctx.fill(allPath);

    // coste e confini
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(55,225,255,0.10)';
    ctx.lineWidth = 5 / state.z;
    ctx.stroke(allPath);
    ctx.strokeStyle = 'rgba(120,215,245,0.55)';
    ctx.lineWidth = 1.15 / state.z;
    ctx.stroke(allPath);

    // territori delle missioni
    for (const n of nodes) {
      if (!n.country) continue;
      const st = STATUS[n.status];
      const pulse = 0.5 + 0.5 * Math.sin(t / 520 + n.nx * 9);
      ctx.fillStyle = rgba(st.rgb, 0.16 + pulse * 0.07);
      ctx.fill(n.country.path);
      ctx.strokeStyle = rgba(st.rgb, 0.55 + pulse * 0.35);
      ctx.lineWidth = (state.selected === n.m ? 2.4 : 1.5) / state.z;
      ctx.setLineDash([5 / state.z, 3 / state.z]);
      ctx.lineDashOffset = -(t / 26) % 8;
      ctx.stroke(n.country.path);
      ctx.setLineDash([]);
    }
    if (state.hoverCountry && !nodes.some((n) => n.country === state.hoverCountry)) {
      ctx.strokeStyle = 'rgba(180,235,255,0.5)';
      ctx.lineWidth = 1.2 / state.z;
      ctx.stroke(state.hoverCountry.path);
    }

    // scansione radar
    const sy = base.y + (((t / 9000) % 1) * base.h);
    const sg = ctx.createLinearGradient(0, sy - 46, 0, sy);
    sg.addColorStop(0, 'rgba(55,225,255,0)');
    sg.addColorStop(1, 'rgba(55,225,255,0.09)');
    ctx.fillStyle = sg;
    ctx.fillRect(base.x, sy - 46, base.w, 46);
    ctx.restore();
  }

  function drawGraticuleLabels() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(120,190,215,0.55)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let lat = -30; lat <= 60; lat += 30) {
      const y = by(projY(lat)) * state.z + state.ty;
      if (y < base.y * state.z + state.ty - 2 || y > (base.y + base.h) * state.z + state.ty + 2) continue;
      ctx.fillText(lat === 0 ? 'EQ' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`, base.x * state.z + state.tx - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = bx(projX(lon)) * state.z + state.tx;
      if (x < base.x * state.z + state.tx - 4 || x > (base.x + base.w) * state.z + state.tx + 4) continue;
      const txt = lon === 0 ? '0°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'O'}`;
      ctx.fillText(txt, x, base.y * state.z + state.ty - 8);
    }

    // nomi dei continenti
    ctx.font = '600 10px system-ui, sans-serif';
    for (const c of CONTINENTS) {
      const p = toScreen(projX(c.lon), projY(c.lat));
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
      const alpha = clamp(0.5 - (state.z - 1) * 0.16, 0.06, 0.5);
      ctx.fillStyle = `rgba(150,205,230,${alpha})`;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, 1);
      drawSpaced(ctx, c.t, 2.6);
      ctx.restore();
    }
  }

  function drawSpaced(c, text, gap) {
    const chars = [...text];
    const widths = chars.map((ch) => c.measureText(ch).width);
    const total = widths.reduce((s, w) => s + w, 0) + gap * (chars.length - 1);
    let x = -total / 2;
    c.textAlign = 'left';
    chars.forEach((ch, i) => { c.fillText(ch, x, 0); x += widths[i] + gap; });
    c.textAlign = 'center';
  }

  function drawFrame() {
    const x = base.x * state.z + state.tx, y = base.y * state.z + state.ty;
    const w = base.w * state.z, h = base.h * state.z;
    ctx.strokeStyle = 'rgba(55,225,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.strokeStyle = 'rgba(55,225,255,0.55)';
    ctx.lineWidth = 1.6;
    const k = 12;
    const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * k, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * k);
      ctx.stroke();
    }
  }

  function markerScreen(n) {
    const p = toScreen(n.nx, n.ny);
    return p;
  }

  function drawNodes(t) {
    placed = [];
    for (const n of nodes) {
      const p = markerScreen(n);
      if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;
      const st = STATUS[n.status];
      const sel = state.selected === n.m;
      const hov = state.hover === n.m;
      const grow = clamp((t - state.t0) / 1000 - n.appear, 0, 1);
      const r = (sel ? 9 : 6.5) * grow;

      if (n.status === 'avail' && grow > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(t / 420 + n.nx * 12);
        ctx.strokeStyle = rgba(st.rgb, 0.55 * pulse);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, 11 + pulse * 13, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(st.rgb, 0.25 * (1 - pulse));
        ctx.beginPath(); ctx.arc(p.x, p.y, 13 + pulse * 22, 0, TAU); ctx.stroke();
      }

      // reticolo
      ctx.strokeStyle = st.col;
      ctx.lineWidth = sel || hov ? 2 : 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - r - 9, p.y); ctx.lineTo(p.x - r - 2, p.y);
      ctx.moveTo(p.x + r + 2, p.y); ctx.lineTo(p.x + r + 9, p.y);
      ctx.moveTo(p.x, p.y - r - 9); ctx.lineTo(p.x, p.y - r - 2);
      ctx.moveTo(p.x, p.y + r + 2); ctx.lineTo(p.x, p.y + r + 9);
      ctx.stroke();

      ctx.fillStyle = st.col;
      ctx.shadowColor = st.col;
      ctx.shadowBlur = sel ? 18 : 8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;

      if (sel) {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1;
        const a0 = t / 700;
        for (let i = 0; i < 4; i++) {
          const a = a0 + (i * TAU) / 4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 17, a, a + 0.35);
          ctx.stroke();
        }
      }

      if (grow > 0.9) drawLabel(n, p, st, sel || hov);
    }
  }

  function drawLabel(n, p, st, strong) {
    const text = (n.m.region?.name || n.m.name || '').toUpperCase();
    ctx.font = `600 ${strong ? 11 : 10}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width;
    const padX = 5, h = 14;
    const right = p.x + 20, left = p.x - 20 - w;
    const options = [
      { x: right, y: p.y - h / 2, dir: 1 },
      { x: left, y: p.y - h / 2, dir: -1 },
      { x: p.x - w / 2, y: p.y - 28, dir: 0 },
      { x: p.x - w / 2, y: p.y + 18, dir: 0 },
    ];
    let spot = null;
    for (const o of options) {
      const r = { x: o.x - padX, y: o.y - 2, w: w + padX * 2, h: h + 2 };
      if (r.x < 4 || r.y < 4 || r.x + r.w > W - 4 || r.y + r.h > H - 4) continue;
      if (placed.some((q) => !(r.x > q.x + q.w || r.x + r.w < q.x || r.y > q.y + q.h || r.y + r.h < q.y))) continue;
      spot = { ...o, r };
      break;
    }
    if (!spot) return;
    placed.push(spot.r);

    ctx.strokeStyle = rgba(st.rgb, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (spot.dir > 0) { ctx.moveTo(p.x + 12, p.y); ctx.lineTo(spot.x - padX, p.y); }
    else if (spot.dir < 0) { ctx.moveTo(p.x - 12, p.y); ctx.lineTo(spot.x + w + padX, p.y); }
    ctx.stroke();

    ctx.fillStyle = strong ? 'rgba(6,14,22,0.92)' : 'rgba(6,14,22,0.6)';
    ctx.fillRect(spot.x - padX, spot.y - 2, w + padX * 2, h + 2);
    ctx.fillStyle = strong ? '#eaf7ff' : 'rgba(215,236,250,0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, spot.x, spot.y + h / 2 - 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
  }

  function drawReadout() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(120,190,215,0.6)';
    ctx.fillText('SINDACATO · RETE TERRITORIALE', 14, 18);

    // coordinate del puntatore
    if (state.cursor) {
      const wpt = toWorld(state.cursor.x, state.cursor.y);
      if (wpt.x >= 0 && wpt.x <= 1 && wpt.y >= 0 && wpt.y <= 1) {
        const lon = wpt.x * 360 - 180;
        const lat = LAT_MAX - wpt.y * (LAT_MAX - LAT_MIN);
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(140,205,230,0.75)';
        ctx.fillText(
          `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'O'}  ·  ${state.z.toFixed(1)}×`,
          W - 14, H - 12);
      }
    }

    // scala
    const kmPerPx = 40075 / (base.w * state.z);
    const target = 90 * kmPerPx;
    const nice = [100, 200, 250, 500, 1000, 2000, 2500, 5000].find((v) => v >= target) || 5000;
    const len = nice / kmPerPx;
    const y = H - 22;
    ctx.strokeStyle = 'rgba(140,205,230,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(14, y - 5); ctx.lineTo(14, y); ctx.lineTo(14 + len, y); ctx.lineTo(14 + len, y - 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(140,205,230,0.75)';
    ctx.textAlign = 'left';
    ctx.fillText(`${nice} km`, 14, y - 8);

    ctx.fillStyle = 'rgba(120,190,215,0.45)';
    ctx.fillText('ROTELLA: ZOOM · TRASCINA: SPOSTA · DOPPIO CLICK: RESET', 14, 18 + 14);
  }

  function drawTooltip() {
    if (!state.cursor) return;
    let lines = null;
    const n = nodes.find((q) => q.m === state.hover);
    if (n) {
      const st = STATUS[n.status];
      lines = [
        { t: n.m.region?.name || n.m.name, c: '#eaf7ff', s: 12, bold: true },
        { t: n.m.name, c: 'rgba(180,215,235,0.85)', s: 10 },
        { t: st.label + (n.status === 'avail' ? ' · CLICCA PER IL BRIEFING' : ''), c: st.col, s: 9 },
      ];
    } else if (state.hoverCountry) {
      const c = state.hoverCountry;
      lines = [
        { t: c.name, c: '#eaf7ff', s: 12, bold: true },
        { t: 'Controllo: ' + BLOCS[c.bloc].name, c: BLOCS[c.bloc].edge, s: 10 },
      ];
    }
    if (!lines) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 12px system-ui, sans-serif';
    const w = Math.max(...lines.map((l) => {
      ctx.font = `${l.bold ? '600' : '500'} ${l.s}px system-ui, sans-serif`;
      return ctx.measureText(l.t).width;
    })) + 20;
    const h = lines.length * 14 + 10;
    let x = state.cursor.x + 16, y = state.cursor.y + 16;
    if (x + w > W - 8) x = state.cursor.x - w - 16;
    if (y + h > H - 8) y = state.cursor.y - h - 16;
    ctx.fillStyle = 'rgba(5,12,20,0.92)';
    ctx.strokeStyle = 'rgba(55,225,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = `${l.bold ? '600' : '500'} ${l.s}px system-ui, sans-serif`;
      ctx.fillStyle = l.c;
      ctx.fillText(l.t, x + 10, y + 12 + i * 14);
    });
    ctx.textBaseline = 'alphabetic';
  }

  // ------------------------------------------------------------- animazione
  let raf = 0, last = 0, conquest = 0;

  function conquestTick(dt) {
    conquest += dt;
    if (conquest < 6.5) return;
    conquest = 0;
    const pool = COUNTRIES.filter((c) => !c.anim && !nodes.some((n) => n.country === c));
    if (!pool.length) return;
    const c = pool[Math.floor(Math.random() * pool.length)];
    const from = c.bloc;
    let to = Math.floor(Math.random() * BLOCS.length);
    if (to === from) to = (to + 1) % BLOCS.length;
    c.anim = { from, t0: performance.now(), dur: 1400 };
    c.bloc = to;
    rebuildBlocs();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!resize()) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    conquestTick(dt);
    for (const c of COUNTRIES) {
      if (c.anim && now - c.anim.t0 >= c.anim.dur) { c.anim = null; rebuildBlocs(); }
    }
    drawBase(now);
    drawGraticuleLabels();
    drawFrame();
    drawNodes(now);
    drawReadout();
    drawTooltip();
  }

  // ------------------------------------------------------------- input
  function pick(sx, sy) {
    let best = null, bestD = 22;
    for (const n of nodes) {
      const p = markerScreen(n);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    state.cursor = { x: sx, y: sy };
    if (state.dragging) {
      state.tx += e.clientX - state.sx;
      state.ty += e.clientY - state.sy;
      state.sx = e.clientX; state.sy = e.clientY;
      state.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      clampView();
      canvas.style.cursor = 'grabbing';
      return;
    }
    const hit = pick(sx, sy);
    const wpt = toWorld(sx, sy);
    const inside = wpt.x >= 0 && wpt.x <= 1 && wpt.y >= 0 && wpt.y <= 1;
    state.hover = hit ? hit.m : null;
    state.hoverCountry = !hit && inside ? countryAt(wpt.x, wpt.y) : null;
    canvas.style.cursor = hit ? 'pointer' : 'crosshair';
  }

  function onDown(e) {
    if (e.button !== 0) return;
    state.dragging = true;
    state.moved = 0;
    state.sx = e.clientX; state.sy = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onUp(e) {
    if (!state.dragging) return;
    state.dragging = false;
    canvas.style.cursor = 'crosshair';
    if (state.moved > 6) return;
    const r = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (hit) { state.selected = hit.m; onSelect(hit.m); }
  }

  function onWheel(e) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const wx = (cx - state.tx) / state.z, wy = (cy - state.ty) / state.z;
    const nz = clamp(state.z * Math.pow(1.0016, -e.deltaY), 1, 6);
    state.z = nz;
    state.tx = cx - wx * nz;
    state.ty = cy - wy * nz;
    clampView();
  }

  function onLeave() { state.cursor = null; state.hover = null; state.hoverCountry = null; }
  function onDbl() { state.z = 1; state.tx = 0; state.ty = 0; clampView(); }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    },
    setSelected(m) { state.selected = m; },
    selectCountryOf(m) { const n = nodes.find((q) => q.m === m); return n?.country?.name || ''; },
    get selected() { return state.selected; },
    zoomTo(m, z = 2.6) {
      const n = nodes.find((q) => q.m === m);
      if (!n || !base.w) return;
      state.z = z;
      const p = { x: bx(n.nx) * z, y: by(n.ny) * z };
      state.tx = W / 2 - p.x;
      state.ty = H / 2 - p.y;
      clampView();
    },
  };
}
