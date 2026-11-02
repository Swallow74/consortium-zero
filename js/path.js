import { Heap } from './util.js';
import { DIR_V, T } from './map.js';

const heap = new Heap();
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A* a 8 direzioni. Ritorna [{x,y}] in coordinate mondo (centri tile) oppure null. */
export function findPath(map, sx, sy, tx, ty, o = {}) {
  const W = map.w;
  let ix = Math.floor(sx), iy = Math.floor(sy), gx = Math.floor(tx), gy = Math.floor(ty);
  if (!map.walk(ix, iy)) { const n = map.nearestWalk(ix, iy, 4); if (!n) return null; [ix, iy] = n; }
  let exact = true;
  if (!map.walk(gx, gy)) { const n = map.nearestWalk(gx, gy, 6); if (!n) return null; [gx, gy] = n; exact = false; }
  if (ix === gx && iy === gy) return [{ x: exact ? tx : gx + 0.5, y: exact ? ty : gy + 0.5 }];

  const stamp = ++map._cur;
  const G = map._g, P = map._par, S = map._stamp, CL = map._cl;
  heap.clear();
  const s = iy * W + ix, goal = gy * W + gx;
  G[s] = 0; P[s] = -1; S[s] = stamp;
  heap.push(s, 0);
  let best = s, bestH = 1e9, exp = 0;
  const maxExp = o.maxExp || 9000;
  while (heap.size) {
    const c = heap.pop();
    if (CL[c] === stamp) continue;
    CL[c] = stamp;
    if (c === goal) { best = c; break; }
    if (++exp > maxExp) break;
    const cx = c % W, cy = (c / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + N8[k][0], ny = cy + N8[k][1];
      if (!map.walk(nx, ny)) continue;
      if (k >= 4 && (!map.walk(cx + N8[k][0], cy) || !map.walk(cx, cy + N8[k][1]))) continue;
      const j = ny * W + nx;
      const ng = G[c] + (k >= 4 ? 1.414 : 1) * map.cost(nx, ny) * (o.avoid ? o.avoid(nx, ny) : 1);
      if (S[j] === stamp && ng >= G[j]) continue;
      S[j] = stamp; G[j] = ng; P[j] = c;
      const dx = Math.abs(nx - gx), dy = Math.abs(ny - gy);
      const hh = (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
      if (hh < bestH) { bestH = hh; best = j; }
      heap.push(j, ng + hh);
    }
  }
  const out = [];
  for (let c = best; c !== -1 && c !== undefined; c = P[c]) out.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
  out.reverse();
  if (out.length > 1) out.shift();
  if (best === goal && exact) out[out.length - 1] = { x: tx, y: ty };
  return smooth(map, sx, sy, out);
}

function smooth(map, sx, sy, pts) {
  if (pts.length < 2) return pts;
  const res = [];
  let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let far = i;
    for (let j = pts.length - 1; j > i; j--) {
      if (map.clearLine(ax, ay, pts[j].x, pts[j].y, 0.25)) { far = j; break; }
    }
    res.push(pts[far]);
    ax = pts[far].x; ay = pts[far].y;
    i = far + 1;
  }
  return res;
}

/** Percorso per veicoli: segue le corsie direzionali. Ritorna [{x,y}] (centri tile). */
export function findRoadPath(map, sx, sy, tx, ty, startDir = 0) {
  const W = map.w;
  const s = Math.floor(sy) * W + Math.floor(sx);
  let gx = Math.floor(tx), gy = Math.floor(ty);
  if (!map.isRoad(gx, gy)) {
    let best = null, bd = 1e9;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      if (!map.isRoad(gx + dx, gy + dy)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [gx + dx, gy + dy]; }
    }
    if (!best) return null;
    [gx, gy] = best;
  }
  const goal = gy * W + gx;
  const stamp = ++map._cur;
  const G = map._g, P = map._par, S = map._stamp, CL = map._cl;
  heap.clear();
  G[s] = 0; P[s] = -1; S[s] = stamp;
  heap.push(s, 0);
  let found = false;
  while (heap.size) {
    const c = heap.pop();
    if (CL[c] === stamp) continue;
    CL[c] = stamp;
    if (c === goal) { found = true; break; }
    const cx = c % W, cy = (c / W) | 0;
    const d = map.rd[c];
    const dirs = d === 5 || d === 0 ? [1, 2, 3, 4] : [d];
    for (const dd of dirs) {
      const nx = cx + DIR_V[dd][0], ny = cy + DIR_V[dd][1];
      if (!map.isRoad(nx, ny)) continue;
      const nd = map.rdAt(nx, ny);
      if (nd && nd !== 5 && nd === opposite(dd)) continue;
      if (nd && nd !== 5 && nd !== dd) continue; // curve solo dentro le giunzioni X: mai immettersi contromano
      const j = ny * W + nx;
      const ng = G[c] + 1;
      if (S[j] === stamp && ng >= G[j]) continue;
      S[j] = stamp; G[j] = ng; P[j] = c;
      heap.push(j, ng + Math.abs(nx - gx) + Math.abs(ny - gy));
    }
  }
  if (!found) return null;
  const out = [];
  for (let c = goal; c !== -1; c = P[c]) out.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
  out.reverse();
  out.shift();
  return out;
}

export const opposite = (d) => (d === 1 ? 2 : d === 2 ? 1 : d === 3 ? 4 : d === 4 ? 3 : 0);
export { T };
