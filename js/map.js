import { hash2 } from './util.js';

export const T = { PAVE: 0, ROAD: 1, GRASS: 2, WATER: 3, BLDG: 4, PLAZA: 5, FENCE: 6, GATE: 7, TREE: 8, PAD: 9 };
// Codici direzione corsie: 1:+x 2:-x 3:+y 4:-y 5:incrocio/libera
export const DIR_V = [null, [1, 0], [-1, 0], [0, 1], [0, -1]];
const ROAD_CH = { '>': 1, '<': 2, v: 3, '^': 4, X: 5, '=': 5 };
export const BH_UNIT = 0.6; // altezza in unita' per livello
export const bldgZ = (lvl) => (lvl > 0 ? lvl * BH_UNIT + 0.6 : 0);

export class GameMap {
  /** @param {string[]} ascii */
  constructor(ascii) {
    this.h = ascii.length;
    this.w = Math.max(...ascii.map((r) => r.length));
    const n = this.w * this.h;
    this.kind = new Uint8Array(n);
    this.bh = new Uint8Array(n);
    this.rd = new Uint8Array(n);
    this.style = new Uint8Array(n);
    this.gateOpen = new Set();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const ch = ascii[y][x] ?? '~';
        const i = y * this.w + x;
        if (ROAD_CH[ch]) {
          this.kind[i] = T.ROAD;
          this.rd[i] = ROAD_CH[ch];
        } else if (ch === '#') {
          this.kind[i] = T.BLDG;
          this.bh[i] = 4;
        } else if (ch >= '1' && ch <= '9') {
          this.kind[i] = T.BLDG;
          this.bh[i] = +ch;
        } else if (ch === ',') this.kind[i] = T.GRASS;
        else if (ch === '~') this.kind[i] = T.WATER;
        else if (ch === '+') this.kind[i] = T.PLAZA;
        else if (ch === 'F') this.kind[i] = T.FENCE;
        else if (ch === 'G') this.kind[i] = T.GATE;
        else if (ch === 'T') this.kind[i] = T.TREE;
        else if (ch === 'Z') this.kind[i] = T.PAD;
        else this.kind[i] = T.PAVE;
      }
    }
    this._styleBuildings();
    this._g = new Float32Array(n);
    this._par = new Int32Array(n);
    this._stamp = new Uint32Array(n);
    this._cl = new Uint32Array(n); // marcatura "closed" per A*: niente Set riallocati a ogni chiamata
    this._cur = 0;
    this.reach = null;
  }

  _styleBuildings() {
    const { w, h, kind, style } = this;
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (kind[i] !== T.BLDG || seen[i]) continue;
      const st = Math.floor(hash2(i % w, (i / w) | 0, 77) * 7);
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        style[c] = st;
        const cx = c % w, cy = (c / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (kind[j] === T.BLDG && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
  }

  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  idx(x, y) { return y * this.w + x; }
  k(x, y) { return this.inb(x, y) ? this.kind[y * this.w + x] : T.WATER; }
  bhAt(x, y) { return this.inb(x, y) && this.kind[y * this.w + x] === T.BLDG ? this.bh[y * this.w + x] : 0; }
  rdAt(x, y) { return this.inb(x, y) ? this.rd[y * this.w + x] : 0; }
  isRoad(x, y) { return this.k(x, y) === T.ROAD; }

  /** Tile percorribile da pedoni. */
  walk(x, y) {
    if (!this.inb(x, y)) return false;
    const i = y * this.w + x;
    const k = this.kind[i];
    if (k === T.BLDG || k === T.WATER || k === T.FENCE || k === T.TREE) return false;
    if (k === T.GATE) return this.gateOpen.has(i);
    return true;
  }
  /** Blocca la linea di tiro. */
  blocksLOS(x, y) {
    if (!this.inb(x, y)) return true;
    const i = y * this.w + x;
    const k = this.kind[i];
    return k === T.BLDG || (k === T.GATE && !this.gateOpen.has(i));
  }
  cost(x, y) {
    const k = this.kind[y * this.w + x];
    return k === T.ROAD ? 2.2 : k === T.GRASS ? 1.1 : 1;
  }

  /** Test cerchio contro tile bloccanti. */
  free(x, y, r = 0.28) {
    return this.walk(Math.floor(x - r), Math.floor(y - r)) && this.walk(Math.floor(x + r), Math.floor(y - r)) &&
      this.walk(Math.floor(x - r), Math.floor(y + r)) && this.walk(Math.floor(x + r), Math.floor(y + r));
  }

  nearestWalk(x, y, maxR = 6) {
    if (this.walk(x, y)) return [x, y];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.walk(x + dx, y + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = [x + dx, y + dy]; }
        }
      if (best) return best;
    }
    return null;
  }

  /** Flood fill dei tile percorribili raggiungibili da (x,y). */
  computeReach(x, y) {
    const { w, h } = this;
    const r = new Uint8Array(w * h);
    const s = this.nearestWalk(x | 0, y | 0, 10);
    if (!s) return (this.reach = r);
    const st = [s[1] * w + s[0]];
    r[st[0]] = 1;
    while (st.length) {
      const c = st.pop();
      const cx = c % w, cy = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.inb(nx, ny)) continue;
          const j = ny * w + nx;
          if (r[j]) continue;
          // gate chiusi sono considerati percorribili per il calcolo (si aprono con la tessera)
          const kk = this.kind[j];
          if (!(this.walk(nx, ny) || kk === T.GATE)) continue;
          if (dx && dy && (!(this.walk(cx + dx, cy) || this.kind[cy * w + cx + dx] === T.GATE) || !(this.walk(cx, cy + dy) || this.kind[(cy + dy) * w + cx] === T.GATE))) continue;
          r[j] = 1;
          st.push(j);
        }
    }
    return (this.reach = r);
  }

  /** Tile casuale con filtro; usa la raggiungibilita' se calcolata. */
  randomTile(rnd, pred, tries = 400) {
    for (let i = 0; i < tries; i++) {
      const x = Math.floor(rnd() * this.w), y = Math.floor(rnd() * this.h);
      if (!this.walk(x, y)) continue;
      if (this.reach && !this.reach[y * this.w + x]) continue;
      if (pred && !pred(x, y)) continue;
      return [x, y];
    }
    return null;
  }

  /** Linea libera per un cerchio di raggio r (percorribilita). */
  clearLine(x0, y0, x1, y1, r = 0.26) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 0.25));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.free(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return false;
    }
    return true;
  }

  /** Raycast tile (DDA) per la linea di tiro. Ritorna distanza al primo muro o null. */
  rayWall(x0, y0, dx, dy, maxD) {
    let tx = Math.floor(x0), ty = Math.floor(y0);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tDx = dx !== 0 ? Math.abs(1 / dx) : 1e30, tDy = dy !== 0 ? Math.abs(1 / dy) : 1e30;
    let tMx = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * tDx : 1e30;
    let tMy = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * tDy : 1e30;
    let t = 0;
    while (t <= maxD) {
      if (tMx < tMy) { t = tMx; tMx += tDx; tx += sx; } else { t = tMy; tMy += tDy; ty += sy; }
      if (t > maxD) return null;
      if (this.blocksLOS(tx, ty)) return t;
    }
    return null;
  }

  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return true;
    return this.rayWall(x0, y0, dx / d, dy / d, d) === null;
  }
}
