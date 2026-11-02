// mesh3d.js — mini renderer 3D software su Canvas 2D, proiezione assonometrica
// identica al mondo del gioco (screenX=(x−y)·AX, screenY=(x+y)·AY−z·AZ).
// Nessuna dipendenza: mesh costruite con primitive parametriche, rasterizzazione
// painter (depth sort) + flat shading con luce chiave, bordo e gradiente morbido.
import { clamp } from './util.js';

export const AX = 48, AY = 24, AZ = 44; // pixel CSS per unita' mondo (1 tile) a S=1

// Asse di profondita': crescere = piu' vicino alla camera (camera a +x+y, sopra).
export const ND = (() => {
  const n = [AX * AZ, AX * AZ, 2 * AX * AY];
  const L = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / L, n[1] / L, n[2] / L];
})();
// Luce chiave: da alto/sud-ovest dello schermo (in alto a sinistra).
export const LIGHT = (() => {
  const l = [-0.52, -0.42, 0.74];
  const L = Math.hypot(...l);
  return [l[0] / L, l[1] / L, l[2] / L];
})();

/** view locale per il bake negli sprite: (ox,oy) = proiezione dell'origine in px CSS. */
export function view(ox, oy, s = 1) { return { ox, oy, s }; }

/** Mesh nuova. f = [{ i:[indici vertici in winding CCW verso l'esterno], m:indice materiale }] */
export function mesh() { return { v: [], f: [] }; }

export function addVert(m, x, y, z) { m.v.push(x, y, z); return m.v.length / 3 - 1; }

export function face(m, mat, idx) { m.f.push({ i: idx, m: mat }); }

const TAU = Math.PI * 2;

/** Trasforma locale (offset + yaw rx? no: solo yaw su z + pitch su y) applicata ai vertici al push. */
export function xf(x, y, z, t) {
  if (!t) return [x, y, z];
  if (t.sx) x *= t.sx;
  if (t.sy) y *= t.sy;
  if (t.sz !== undefined) z *= t.sz;
  if (t.ry) { const c = Math.cos(t.ry), s = Math.sin(t.ry); const nx = c * x + s * z, nz = -s * x + c * z; x = nx; z = nz; }
  if (t.rx) { const c = Math.cos(t.rx), s = Math.sin(t.rx); const ny = c * y - s * z, nz = s * y + c * z; y = ny; z = nz; }
  if (t.rz) { const c = Math.cos(t.rz), s = Math.sin(t.rz); const nx = c * x - s * y, ny = s * x + c * y; x = nx; y = ny; }
  return [x + (t.x || 0), y + (t.y || 0), z + (t.z || 0)];
}


/**
 * anello poligonale chiuso (n lati) di raggio (rx,ry) centrato in (0,0) alla quota z.
 * ritorna indici vertici (n, con fase angolare 'ph').
 */
function ring(m, cx, cy, z, rx, ry, n, ph, t) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ph + (i / n) * TAU;
    out.push(addVert(m, ...xf(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z, t)));
  }
  return out;
}

/** Cylindro/cono tronco tra due anelli. wind: anelli CCW verso l'esterno. */
export function loft(m, mat, cx, cy, z0, r0x, r0y, z1, r1x, r1y, n = 6, ph = 0, t = null, caps = 3) {
  const a = ring(m, cx, cy, z0, r0x, r0y, n, ph, t);
  const b = ring(m, cx, cy, z1, r1x, r1y, n, ph, t);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    face(m, mat, [a[i], a[j], b[j], b[i]]); // CCW visto dall'esterno
  }
  if (caps & 2) for (let i = 1; i < n - 1; i++) face(m, mat, [b[0], b[i], b[i + 1]]);
  if (caps & 1) for (let i = 1; i < n - 1; i++) face(m, mat, [a[i], a[0], a[i + 1]]);
  return [a, b];
}

/** Prism a base quadrilatera con quote/sezioni/offset diversi.
 *  lv = [ [z, hx, hy, ox?, oy?], ... ] — sezioni centrate in (cx+ox, cy+oy). */
export function prism(m, mat, cx, cy, lv, t = null, caps = 3) {
  const rings = lv.map(([z, hx, hy, ox = 0, oy = 0]) => [
    addVert(m, ...xf(cx - hx + ox, cy - hy + oy, z, t)), addVert(m, ...xf(cx + hx + ox, cy - hy + oy, z, t)),
    addVert(m, ...xf(cx + hx + ox, cy + hy + oy, z, t)), addVert(m, ...xf(cx - hx + ox, cy + hy + oy, z, t)),
  ]);
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k], b = rings[k + 1];
    face(m, mat, [a[1], a[2], b[2], b[1]]); // est (+x)
    face(m, mat, [a[2], a[3], b[3], b[2]]); // sud (+y)
    face(m, mat, [a[3], a[0], b[0], b[3]]); // ovest
    face(m, mat, [a[0], a[1], b[1], b[0]]); // nord
  }
  const top = rings[rings.length - 1], bot = rings[0];
  if (caps & 2) face(m, mat, [top[0], top[1], top[2], top[3]]);
  if (caps & 1) face(m, mat, [bot[3], bot[2], bot[1], bot[0]]);
  return rings;
}

export function box(m, mat, cx, cy, cz0, cz1, hx, hy, t = null, caps = 3) {
  return prism(m, mat, cx, cy, [[cz0, hx, hy], [cz1, hx, hy]], t, caps);
}

/** Loft multi-anello: rings = [{z, rx, ry}] dal basso verso l'alto, sezione esagonale/pentagonale. */
export function loftRings(m, matId, rings, n = 6, ph = 0, t = null, caps = 3) {
  const rs = rings.map((r) => ring(m, 0, 0, r.z, r.rx, r.ry, n, ph, t));
  for (let k = 0; k < rs.length - 1; k++) {
    const a = rs[k], b = rs[k + 1];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; face(m, matId, [a[i], a[j], b[j], b[i]]); }
  }
  const top = rs[rs.length - 1], bot = rs[0];
  if (caps & 2) for (let i = 1; i < n - 1; i++) face(m, matId, [top[0], top[i], top[i + 1]]);
  if (caps & 1) for (let i = 1; i < n - 1; i++) face(m, matId, [bot[i], bot[0], bot[i + 1]]);
  return rs;
}

/** Sfera bassa (n lati, k anelli verticali), ellissoidale. */
export function ball(m, mat, cx, cy, cz, rx, ry, rz, n = 6, k = 3, t = null) {
  const rings = [];
  for (let j = 0; j <= k; j++) {
    const v = j / k, az = Math.PI * v - Math.PI / 2;
    const z = cz + Math.sin(az) * rz, r = Math.cos(az);
    if (r < 0.12) { rings.push([addVert(m, ...xf(cx, cy, z, t))]); continue; }
    rings.push(ring(m, cx, cy, z, rx * r, ry * r, n, 0, t));
  }
  for (let j = 0; j < rings.length - 1; j++) {
    const a = rings[j], b = rings[j + 1];
    if (a.length === 1) for (let i = 0; i < b.length; i++) face(m, mat, [a[0], b[i], b[(i + 1) % b.length]]);
    else if (b.length === 1) for (let i = 0; i < a.length; i++) face(m, mat, [a[i], a[(i + 1) % a.length], b[0]]);
    else for (let i = 0; i < n; i++) { const q = (i + 1) % n; face(m, mat, [a[i], a[q], b[q], b[i]]); }
  }
}

/** Cono/antenna etc. */
export function cone(m, mat, cx, cy, z0, z1, r, n = 5, t = null) {
  const a = ring(m, cx, cy, z0, r, r, n, 0, t);
  const tip = addVert(m, ...xf(cx, cy, z1, t));
  for (let i = 0; i < n; i++) face(m, mat, [a[i], a[(i + 1) % n], tip]);
  for (let i = 1; i < n - 1; i++) face(m, mat, [a[i], a[0], a[i + 1]]);
}

/** Tubo rastremato tra due punti arbitrari (arti, canne, barre). Cap = disco pieno. */
export function tube(m, matS, matC, p0, p1, r0, r1, n = 5, caps = 3) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const u = [d[0] / L, d[1] / L, d[2] / L];
  const up = Math.abs(u[2]) > 0.98 ? [1, 0, 0] : [0, 0, 1];
  let e1 = [u[1] * up[2] - u[2] * up[1], u[2] * up[0] - u[0] * up[2], u[0] * up[1] - u[1] * up[0]];
  const el = Math.hypot(...e1); e1 = [e1[0] / el, e1[1] / el, e1[2] / el];
  const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const rings = [0, 1].map((k) => {
    const c = k ? p1 : p0, r = k ? r1 : r0, out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      out.push(addVert(m, c[0] + (e1[0] * ca + e2[0] * sa) * r, c[1] + (e1[1] * ca + e2[1] * sa) * r, c[2] + (e1[2] * ca + e2[2] * sa) * r));
    }
    return out;
  });
  const a = rings[0], b = rings[1];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; face(m, matS, [a[i], a[j], b[j], b[i]]); }
  if (caps & 2) for (let i = 1; i < n - 1; i++) face(m, matC, [b[0], b[i], b[i + 1]]);
  if (caps & 1) for (let i = 1; i < n - 1; i++) face(m, matC, [a[i], a[0], a[i + 1]]);
  return rings;
}

/** Ruota tutta la mesh attorno a z (verso l'alto) di angolo a. */
export function rotZ(m, a) {
  const c = Math.cos(a), s = Math.sin(a), v = m.v;
  for (let i = 0; i < v.length; i += 3) { const x = v[i], y = v[i + 1]; v[i] = c * x - s * y; v[i + 1] = s * x + c * y; }
}

// ---------------- materiali ----------------
/** { color, kind: matte|metal|skin|cloth|glass|emit|dark, a:alpha, glow:'#css' } */
export function mat(o) { return { kind: 'matte', a: 1, ...o }; }

function parseCol(hex) {
  if (hex[0] === '#') { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = hex.match(/[\d.]+/g); return [+m[0], +m[1], +m[2]];
}

const KDF = { matte: 0.46, metal: 0.62, skin: 0.38, cloth: 0.42, dark: 0.34, glass: 0.7, emit: 0 };

/** Colore finale di una faccia. Ritorna [rgbLit, lit]. */
export function shadeFace(mats, f, nx, ny, nz) {
  const m = mats[f.m] || mats[0];
  const ndl = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  let lit = 0.58 + (KDF[m.kind] ?? 0.46) * Math.max(0, ndl);
  if (nz < -0.55) lit *= 0.82; // AO: superfici rivolte giu'
  if (m.kind === 'metal' && ndl > 0.5) lit += (ndl - 0.5) * 0.5;
  if (m.kind === 'glass') lit = 0.7 + Math.max(0, ndl) * 0.65;
  if (m.kind === 'emit') lit = 1;
  return [m._rgb || (m._rgb = parseCol(m.color)), clamp(lit, 0.24, 1.65)];
}

/**
 * Disegna la mesh con painter sort su ctx (che puo' avere gia' transform scale(S)).
 * vw: view(); opts: { grad:bordi/gradienti morbidi (bake), stroke, alpha }
 */
export function drawMesh(ctx, vw, m, mats, opts = {}) {
  const v = m.v, nf = m.f.length;
  if (!nf) return;
  const px = new Float64Array(v.length / 3), py = new Float64Array(v.length / 3);
  const s = vw.s;
  for (let i = 0, k = 0; i < v.length; i += 3, k++) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    px[k] = vw.ox + (x - y) * AX * s;
    py[k] = vw.oy + (x + y) * AY * s - z * AZ * s;
  }
  const order = [];
  for (let fi = 0; fi < nf; fi++) {
    const f = m.f[fi], idx = f.i, n = idx.length;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { const k = idx[i]; cx += v[k * 3]; cy += v[k * 3 + 1]; cz += v[k * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const a = idx[0], b = idx[1], c = idx[2];
    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[b * 3], wy = v[c * 3 + 1] - v[b * 3 + 1], wz = v[c * 3 + 2] - v[b * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (nx * ND[0] + ny * ND[1] + nz * ND[2] <= 0.005) continue; // backface cull
    order.push({ fi, d: cx * ND[0] + cy * ND[1] + cz * ND[2], nx, ny, nz });
  }
  order.sort((p, q) => p.d - q.d);
  const grad = opts.grad !== false;
  const stroke = opts.stroke ?? 0.5;
  for (const o of order) {
    const f = m.f[o.fi], idx = f.i, n = idx.length, mm = mats[f.m] || mats[0];
    const [rgb, lit] = shadeFace(mats, f, o.nx, o.ny, o.nz);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      const X = px[k], Y = py[k];
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
    let fill;
    if (grad && n > 2) {
      const g = ctx.createLinearGradient((x0 + x1) / 2, y0, (x0 + x1) / 2, y1);
      g.addColorStop(0, `rgb(${Math.min(255, rgb[0] * lit * 1.1) | 0},${Math.min(255, rgb[1] * lit * 1.1) | 0},${Math.min(255, rgb[2] * lit * 1.1) | 0})`);
      g.addColorStop(1, `rgb(${(rgb[0] * lit * 0.86) | 0},${(rgb[1] * lit * 0.86) | 0},${(rgb[2] * lit * 0.86) | 0})`);
      fill = g;
    } else {
      fill = `rgb(${(rgb[0] * lit) | 0},${(rgb[1] * lit) | 0},${(rgb[2] * lit) | 0})`;
    }
    ctx.globalAlpha = (opts.alpha ?? 1) * (mm.a ?? 1);
    if (mm.glow) { ctx.shadowColor = mm.glow; ctx.shadowBlur = mm.glowB ?? 6; }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (mm.kind === 'glass' && o.nz > 0) {
      // riflesso diagonale sul vetro
      ctx.strokeStyle = 'rgba(220,240,255,0.5)'; ctx.lineWidth = 1.1 * s;
      ctx.beginPath(); ctx.moveTo(px[idx[0]], py[idx[0]]); ctx.lineTo(px[idx[2]], py[idx[2]]); ctx.stroke();
    }
    if (stroke) { ctx.lineWidth = stroke * s; ctx.strokeStyle = `rgba(8,10,16,${mm.kind === 'emit' ? 0 : 0.32})`; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
}

/** Box iso "leggero" per contesti immediati (fences, tetti): 3 facce, niente mesh. */
export function isoBox(ctx, vw, cx, cy, z0, z1, hx, hy, colTop, colL, colR, s = vw.s) {
  const P = (x, y, z) => [vw.ox + (x - y) * AX * s, vw.oy + (x + y) * AY * s - z * AZ * s];
  const poly = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); };
  const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy;
  poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], colR);
  poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], colL);
  poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], colTop);
}
