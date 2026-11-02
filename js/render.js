import { T, bldgZ } from './map.js';
import { resolveTheme } from './themes.js';
import { WEAPONS, OFFENSIVE } from './data.js';
import { hash2, clamp, TAU } from './util.js';
import { DIR_V } from './map.js';
import { AX, AY, AZ, view, drawMesh } from './mesh3d.js';
import { buildHuman, buildVehicle, buildTree, buildPickup, buildLamp, buildRoofProps } from './models.js';

export const TW = 96, TH = 48, ZH = 44;
export const ZOOMS = [0.42, 0.55, 0.7, 0.85, 1.0, 1.2, 1.45, 1.75, 2.1];
/** Velocità di pan da tastiera/bordi schermo, in pixel CSS al secondo. */
const PAN_SPEED = 700;
const FLOOR = 26;

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255), g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255), b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

const FACTION_LOOK = {
  agent: { coat: '#16283f', trim: '#37e1ff', pants: '#0d1624', skin: '#d9a98a', hair: '#1a1a22' },
  enemy: { coat: '#3a1620', trim: '#ff3b6b', pants: '#1a0d12', skin: '#c99478', hair: '#101015' },
  guard: { coat: '#4a3524', trim: '#ff7a3d', pants: '#23180f', skin: '#c9a080', hair: '#2a2018' },
  police: { coat: '#1d3a78', trim: '#8fb4ff', pants: '#0f1c3a', skin: '#d9b090', hair: '#14141c' },
  vip: { coat: '#4a4224', trim: '#ffd24d', pants: '#1c1a10', skin: '#e0b496', hair: '#d9d9d9' },
  scientist: { coat: '#d7e6e0', trim: '#7af0c0', pants: '#4a5560', skin: '#e0b496', hair: '#4a3a2a' },
};
const CIV_COATS = ['#6b5b8a', '#8a5b5b', '#5b8a74', '#8a7d5b', '#5b6e8a', '#7a7a86', '#a06a3a', '#3d6a6a'];

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.game = null;
    this.cam = { x: 10, y: 10 };
    this.camT = null;
    this.zoomIdx = 4;
    this.dpr = 1;
    this.cache = new Map();
    this.cacheKey = '';
    this.mouse = { x: 0, y: 0, inside: false };
    this.cursor = 'move';
    this.time = 0;
    this.drag = null;
    this.buckets = [];
    this.lamps = [];
    this.quality = 1;
    this.th = resolveTheme({});
    this.resize();
  }

  setGame(game) {
    this.game = game;
    this.cache.clear(); this._px = 0;
    if (!game) return;
    this.th = game.theme || resolveTheme(game.def || {});
    const m = game.map;
    this.lamps = [];
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        if (m.kind[y * m.w + x] !== T.PAVE) continue;
        if (!(m.isRoad(x + 1, y) || m.isRoad(x - 1, y) || m.isRoad(x, y + 1) || m.isRoad(x, y - 1))) continue;
        if (hash2(x, y, 5) < 0.07) this.lamps.push({ x, y });
      }
    // insegne al piano terra che illuminano il marciapiede
    this.neons = [];
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        if (m.kind[i] !== T.BLDG) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const k = m.k(x + dx, y + dy);
          if (k !== T.PAVE && k !== T.PLAZA) continue;
          if (hash2(x * 3 + dx, y * 3 + dy, 41) > 0.22) continue;
          const st = this.sty(m.style[i]);
          const c = parseInt(st.neon.slice(1), 16);
          this.neons.push({ x: x + 0.5 + dx * 0.9, y: y + 0.5 + dy * 0.9, rgb: `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}` });
        }
      }
    this.pads = [];
    for (let y = 1; y < m.h - 1; y++)
      for (let x = 1; x < m.w - 1; x++) {
        let all = true;
        for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (m.k(x + dx, y + dy) !== T.PAD) { all = false; break; }
        if (all) this.pads.push({ x: x + 0.5, y: y + 0.5 });
      }
    this.drops = [];
    this.camT = null;
    this.fadeAlpha = {};
    const s = game.start;
    this.cam.x = s.x; this.cam.y = s.y;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2) * (this.quality || 1);
    const w = this.cv.clientWidth || window.innerWidth, h = this.cv.clientHeight || window.innerHeight;
    this.cv.width = Math.max(2, Math.floor(w * this.dpr));
    this.cv.height = Math.max(2, Math.floor(h * this.dpr));
    this.cache.clear(); this._px = 0;
  }

  get S() { return ZOOMS[this.zoomIdx] * this.dpr; }

  setZoom(idx, ax = null, ay = null) {
    idx = clamp(idx, 0, ZOOMS.length - 1);
    if (idx === this.zoomIdx) return;
    const before = ax !== null ? this.s2w(ax * this.dpr, ay * this.dpr) : null;
    this.zoomIdx = idx;
    this.cache.clear(); this._px = 0;
    if (before) {
      this.frameSetup();
      const after = this.s2w(ax * this.dpr, ay * this.dpr);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    }
  }

  frameSetup(shakeX = 0, shakeY = 0) {
    const S = this.S;
    this.ox = this.cv.width / 2 - (this.cam.x - this.cam.y) * (TW / 2) * S + shakeX;
    this.oy = this.cv.height / 2 - (this.cam.x + this.cam.y) * (TH / 2) * S + shakeY;
  }

  w2s(wx, wy, z = 0) {
    const S = this.S;
    return { x: (wx - wy) * (TW / 2) * S + this.ox, y: (wx + wy) * (TH / 2) * S + this.oy - z * ZH * S };
  }
  s2w(sx, sy) {
    const S = this.S;
    const a = (sx - this.ox) / ((TW / 2) * S), b = (sy - this.oy) / ((TH / 2) * S);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  centerOn(x, y, smooth = true) {
    if (smooth) this.camT = { x, y };
    else { this.cam.x = x; this.cam.y = y; this.camT = null; }
  }

  updateCamera(dt, pan) {
    const g = this.game;
    if (!g) return;
    if (pan.x || pan.y) {
      // pan in coordinate schermo -> mondo: velocità costante in pixel schermo,
      // così il movimento resta identico a ogni livello di zoom.
      this.camT = null;
      const z = ZOOMS[this.zoomIdx];
      const sx = pan.x * PAN_SPEED * dt, sy = pan.y * PAN_SPEED * dt;
      const a = sx / ((TW / 2) * z), b = sy / ((TH / 2) * z);
      this.cam.x += (a + b) / 2;
      this.cam.y += (b - a) / 2;
    }
    if (this.camT) {
      const k = 1 - Math.pow(0.0006, dt);
      this.cam.x += (this.camT.x - this.cam.x) * k;
      this.cam.y += (this.camT.y - this.cam.y) * k;
      if (Math.hypot(this.camT.x - this.cam.x, this.camT.y - this.cam.y) < 0.05) this.camT = null;
    }
    this.cam.x = clamp(this.cam.x, 0, g.map.w);
    this.cam.y = clamp(this.cam.y, 0, g.map.h);
  }

  // ---------------- sprite cache ----------------
  sprite(key, w, h, fn) {
    let s = this.cache.get(key);
    if (s) return s;
    const S = this.S;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * S);
    c.height = Math.ceil(h * S);
    const x = c.getContext('2d');
    x.scale(S, S);
    fn(x);
    s = c;
    this.cache.set(key, s);
    return s;
  }

  sty(i) { const a = this.th.styles; return a[i % a.length]; }

  /**
   * BAKE 3D: costruisce la mesh con fn(), la rasterizza una volta in uno sprite
   * cached e ne memorizza gli ancoraggi. La mesh vive in unita' mondo (1 = tile)
   * con z verso l'alto; l'origine (0,0,0) viene appoggiata al bordo inferiore.
   * Ritorna il canvas con .fx/.fy (px CSS dell'origine) e, se la mesh ne ha,
   * .tip (bocca da fuoco) e .top (quota coperture).
   */
  bake(key, fn) {
    let s = this.cache.get(key);
    if (s) return s;
    const model = fn();
    const S = this.S;
    const v = model.m.v;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < v.length; i += 3) {
      const px = (v[i] - v[i + 1]) * AX, py = (v[i] + v[i + 1]) * AY - v[i + 2] * AZ;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
    const w = Math.ceil(x1 - x0) + 4, h = Math.ceil(y1 - y0) + 4;
    const ox = -x0 + 2, oy = -y0 + 2;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * S); c.height = Math.ceil(h * S);
    const x = c.getContext('2d');
    x.scale(S, S);
    drawMesh(x, view(ox, oy, 1), model.m, model.mats, { grad: true, stroke: 0.5 });
    c.fx = ox; c.fy = oy;
    if (model.tip) { const [tx, ty, tz] = model.tip; c.tip = [ox + (tx - ty) * AX, oy + (tx + ty) * AY - tz * AZ]; }
    if (model.top !== undefined) c.top = oy - model.top * AZ;
    this.cache.set(key, c);
    this._px = (this._px || 0) + c.width * c.height;
    if (this._px > 22e6) {
      let n = 0;
      for (const k of this.cache.keys()) { if (k.startsWith('m|') && n++ < 40) this.cache.delete(k); }
      this._px = 0;
      for (const cv of this.cache.values()) this._px += cv.width * cv.height;
    }
    return c;
  }

  diamond(ctx, e = 0.8) {
    ctx.beginPath();
    ctx.moveTo(0, -TH / 2 - e / 2);
    ctx.lineTo(TW / 2 + e, 0);
    ctx.lineTo(0, TH / 2 + e / 2);
    ctx.lineTo(-TW / 2 - e, 0);
    ctx.closePath();
  }

  groundSprite(kind, v, mask) {
    const key = `g${kind}|${v}|${mask}`;
    return this.sprite(key, TW + 2, TH + 2, (c) => {
      c.translate((TW + 2) / 2, (TH + 2) / 2);
      this.diamond(c);
      const vv = (v % 5) / 5;
      if (kind === T.PAVE || kind === T.FENCE || kind === T.GATE) {
        c.fillStyle = shade(this.th.pave, 0.9 + vv * 0.2);
        c.fill();
        c.save(); this.diamond(c, 0); c.clip();
        c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(-TW / 4, -TH / 4); c.lineTo(TW / 4, TH / 4); c.moveTo(TW / 4, -TH / 4); c.lineTo(-TW / 4, TH / 4); c.stroke();
        c.strokeStyle = 'rgba(160,190,230,0.07)';
        c.beginPath(); c.moveTo(0, -TH / 2); c.lineTo(TW / 2, 0); c.moveTo(-TW / 2, 0); c.lineTo(0, -TH / 2); c.stroke();
        for (let i = 0; i < 4; i++) { c.fillStyle = `rgba(0,0,0,${0.1 + hash2(v, i, 3) * 0.12})`; c.fillRect((hash2(v, i, 1) - 0.5) * 60, (hash2(v, i, 2) - 0.5) * 26, 2, 1.4); }
        c.restore();
      } else if (kind === T.ROAD) {
        c.fillStyle = shade(this.th.road, 0.92 + vv * 0.18);
        c.fill();
        c.save(); this.diamond(c, 0); c.clip();
        // bordi
        const E = { N: [[0, -TH / 2], [TW / 2, 0]], E: [[TW / 2, 0], [0, TH / 2]], S: [[0, TH / 2], [-TW / 2, 0]], W: [[-TW / 2, 0], [0, -TH / 2]] };
        const names = ['N', 'E', 'S', 'W'];
        names.forEach((n, i) => {
          const [a, b] = E[n];
          if (mask & (64 << i)) { // marciapiede
            c.strokeStyle = this.th.curb; c.lineWidth = 3; c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
            c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(a[0] + (n === 'N' ? 0 : 0), a[1] + 1.5); c.lineTo(b[0], b[1] + 1.5); c.stroke();
          }
          if (mask & (1 << i)) { c.strokeStyle = this.th.laneCenter; c.lineWidth = 2; c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
          if (mask & (16 << i)) {
            c.strokeStyle = this.th.laneDash; c.lineWidth = 1.6; c.setLineDash([7, 8]);
            c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); c.setLineDash([]);
          }
        });
        if (hash2(v, 9, 9) < 0.06) { c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(0, 0, 6, 3, 0, 0, TAU); c.fill(); }
        c.restore();
      } else if (kind === T.GRASS || kind === T.TREE) {
        c.fillStyle = shade(this.th.grass, 0.88 + vv * 0.28);
        c.fill();
        c.save(); this.diamond(c, 0); c.clip();
        for (let i = 0; i < 16; i++) {
          const px = (hash2(v, i, 11) - 0.5) * 80, py = (hash2(v, i, 12) - 0.5) * 38;
          const bl = this.th.blade; c.strokeStyle = `rgba(${bl[0] + hash2(v, i, 13) * 60},${bl[1] + hash2(v, i, 14) * 50},${bl[2]},0.4)`;
          c.lineWidth = 1; c.beginPath(); c.moveTo(px, py); c.lineTo(px + 1, py - 3.5); c.stroke();
        }
        c.restore();
      } else if (kind === T.WATER) {
        const g = c.createLinearGradient(-TW / 2, -TH / 2, TW / 2, TH / 2);
        g.addColorStop(0, this.th.water[0]); g.addColorStop(1, this.th.water[1]);
        c.fillStyle = g; c.fill();
      } else if (kind === T.PLAZA || kind === T.PAD) {
        c.fillStyle = (v & 1) ? this.th.plaza[0] : this.th.plaza[1];
        c.fill();
        c.save(); this.diamond(c, 0); c.clip();
        c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(0, -TH / 2); c.lineTo(TW / 2, 0); c.lineTo(0, TH / 2); c.lineTo(-TW / 2, 0); c.closePath(); c.stroke();
        c.restore();
        if (kind === T.PAD) { this.diamond(c); c.fillStyle = 'rgba(10,14,24,0.35)'; c.fill(); }
      }
    });
  }

  roadMask(x, y) {
    const m = this.game.map;
    const d = m.rdAt(x, y);
    let mask = 0;
    const nb = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N(y-1) E(x+1) S(y+1) W(x-1) in termini mondo: bordi iso
    // bordo iso N = vicino y-1, E = vicino x+1, S = vicino y+1, W = vicino x-1
    nb.forEach(([dx, dy], i) => {
      const nx = x + dx, ny = y + dy;
      if (!m.isRoad(nx, ny)) mask |= 64 << i;
      else {
        const nd = m.rdAt(nx, ny);
        if (d >= 1 && d <= 4 && nd >= 1 && nd <= 4) {
          const opp = (d === 1 && nd === 2) || (d === 2 && nd === 1) || (d === 3 && nd === 4) || (d === 4 && nd === 3);
          if (opp) mask |= 1 << i;
          else if (nd === d && (i === 1 || i === 2)) mask |= 16 << i;
        }
      }
    });
    return mask;
  }

  // ---------------- edifici ----------------
  faceSprite(side, style, z0, z1, variant) {
    const key = `f${side}|${style}|${z0}|${z1}|${variant}`;
    const Hf = z1 - z0;
    return this.sprite(key, TW / 2 + 1, Hf + TH / 2 + 1, (c) => {
      const st = this.sty(style);
      c.save();
      if (side === 'R') c.transform(1, -0.5, 0, 1, 0, TH / 2); else c.transform(1, 0.5, 0, 1, 0, 0);
      const f = side === 'L' ? 1.18 : 0.78;
      const g = c.createLinearGradient(0, 0, 0, Hf);
      g.addColorStop(0, shade(st.wall, f * 1.05));
      g.addColorStop(1, shade(st.wall, f * 0.72));
      c.fillStyle = g;
      c.fillRect(-0.5, 0, TW / 2 + 1, Hf + 0.5);
      // pannelli verticali
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(TW / 4 - 0.5, 0, 1, Hf);
      const sideSeed = side === 'L' ? 1 : 2;
      const k0 = Math.floor(z0 / FLOOR), k1 = Math.ceil(z1 / FLOOR);
      for (let k = k0; k < k1; k++) {
        const topAbs = (k + 1) * FLOOR;
        const v0 = z1 - topAbs;
        if (v0 + FLOOR < -2 || v0 > Hf) continue;
        // linea di solaio
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.fillRect(0, v0 + FLOOR - 1.6, TW / 2, 1.6);
        if (k === 0) {
          // piano terra: vetrina/ingresso
          const a = hash2(variant, style, 40 + sideSeed);
          c.fillStyle = a < 0.5 ? 'rgba(10,14,22,0.9)' : shade(st.wall, 0.55);
          c.fillRect(4, v0 + 6, TW / 2 - 8, FLOOR - 7);
          if (a > 0.3) { c.fillStyle = st.neon; c.shadowColor = st.neon; c.shadowBlur = 6; c.fillRect(6, v0 + 4.5, TW / 2 - 12, 1.8); c.shadowBlur = 0; }
          continue;
        }
        for (let col = 0; col < 3; col++) {
          const hv = hash2(variant * 31 + k, col + sideSeed * 7, style);
          const wx = 4 + col * 14, wy = v0 + 6, ww = 9.5, wh = FLOOR - 11;
          if (hv < 0.52) {
            const colr = st.win[Math.floor(hash2(k, col, variant + style) * st.win.length)];
            c.fillStyle = colr;
            c.globalAlpha = 0.55 + hash2(k, col, 3) * 0.45;
            c.shadowColor = colr; c.shadowBlur = 4;
            c.fillRect(wx, wy, ww, wh);
            c.shadowBlur = 0; c.globalAlpha = 1;
          } else {
            c.fillStyle = '#0d121c';
            c.fillRect(wx, wy, ww, wh);
            c.fillStyle = 'rgba(120,160,220,0.12)';
            c.fillRect(wx, wy, ww, 2);
          }
        }
      }
      // insegna neon verticale
      if (Hf > 100 && hash2(variant, style, 91 + sideSeed) < 0.16) {
        c.fillStyle = st.neon; c.shadowColor = st.neon; c.shadowBlur = 10;
        c.fillRect(TW / 4 - 2, Hf * 0.2, 4, Hf * 0.45);
        c.shadowBlur = 0;
      }
      // bordo alto
      c.fillStyle = 'rgba(255,255,255,0.16)';
      c.fillRect(-0.5, 0, TW / 2 + 1, 1.5);
      c.restore();
    });
  }

  topSprite(style, variant, z) {
    const key = `t${style}|${variant}|${z > 150 ? 1 : 0}`;
    const PADY = 46;
    const spr = this.sprite(key, TW + 2, TH + 2 + PADY, (c) => {
      const st = this.sty(style);
      c.translate((TW + 2) / 2, PADY + (TH + 2) / 2);
      this.diamond(c);
      const g = c.createLinearGradient(-TW / 2, -TH / 2, TW / 2, TH / 2);
      g.addColorStop(0, shade(st.roof, 1.18)); g.addColorStop(1, shade(st.roof, 0.9));
      c.fillStyle = g; c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(-TW / 2, 0); c.lineTo(0, -TH / 2); c.lineTo(TW / 2, 0); c.stroke();
      c.save(); this.diamond(c, 0); c.scale(0.78, 0.78); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.2; c.stroke(); c.restore();
      // oggetti sul tetto: props 3D (parapetto, condizionatori, cisterne)
      const rp = buildRoofProps(variant + 1 + style * 3, st.roof, st.wall);
      drawMesh(c, view(0, 0, 1), rp.m, rp.mats, { grad: true, stroke: 0.4 });
      if (hash2(variant, style, 9) < 0.25) { // antenna
        c.strokeStyle = '#9aa4bd'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -34); c.stroke();
        c.fillStyle = '#ff4466'; c.shadowColor = '#ff4466'; c.shadowBlur = 8; c.beginPath(); c.arc(0, -34, 2.2, 0, TAU); c.fill();
      }
    });
    return { spr, padY: PADY };
  }

  // ---------------- frame ----------------
  render(dt, viewport) {
    const g = this.game;
    const ctx = this.ctx;
    this.time += dt;
    const S = this.S;
    const cw = this.cv.width, ch = this.cv.height;
    const sh = g.fx.shake;
    this.frameSetup(sh ? (Math.random() - 0.5) * sh * S * 0.5 : 0, sh ? (Math.random() - 0.5) * sh * S * 0.5 : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sea = ctx.createLinearGradient(0, 0, 0, ch);
    sea.addColorStop(0, this.th.sea[0]); sea.addColorStop(1, this.th.sea[1]);
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, cw, ch);
    g.listener.x = this.cam.x; g.listener.y = this.cam.y;

    const m = g.map;
    // intervallo visibile
    const pts = [this.s2w(-40, -TH * S * 1.5), this.s2w(cw + 40, -TH * S * 1.5), this.s2w(-40, ch + 7.6 * ZH * S), this.s2w(cw + 40, ch + 7.6 * ZH * S)];
    let minX = Math.floor(Math.min(...pts.map((p) => p.x))) - 1, maxX = Math.ceil(Math.max(...pts.map((p) => p.x))) + 1;
    let minY = Math.floor(Math.min(...pts.map((p) => p.y))) - 1, maxY = Math.ceil(Math.max(...pts.map((p) => p.y))) + 1;
    minX = Math.max(0, minX); minY = Math.max(0, minY); maxX = Math.min(m.w - 1, maxX); maxY = Math.min(m.h - 1, maxY);
    const dmin = minX + minY, dmax = maxX + maxY;
    const hw = (TW / 2) * S, hh = (TH / 2) * S;

    // pass 0: mare oltre i confini della citta'
    this.drawOuterWater(pts);
    // pass 1: terreno
    for (let d = dmin; d <= dmax; d++) {
      const x0 = Math.max(minX, d - maxY), x1 = Math.min(maxX, d - minY);
      for (let x = x0; x <= x1; x++) {
        const y = d - x;
        const i = y * m.w + x;
        const k = m.kind[i];
        if (k === T.BLDG) continue;
        const sx = (x - y) * hw + this.ox + hw * 0, sy = (x + y + 1) * hh + this.oy - hh;
        // centro tile: (x+0.5, y+0.5)
        const cx = ((x + 0.5) - (y + 0.5)) * hw + this.ox, cy = ((x + 0.5) + (y + 0.5)) * hh + this.oy;
        if (cx < -hw * 2 || cx > cw + hw * 2 || cy < -hh * 2 || cy > ch + hh * 2) continue;
        const v = (x * 7 + y * 13) % 5;
        const mask = k === T.ROAD ? this.roadMask(x, y) : 0;
        const spr = this.groundSprite(k, k === T.PLAZA || k === T.PAD ? (x + y) & 1 : v + ((x * 31 + y * 17) % 7) * 5, mask);
        ctx.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - spr.height / 2));
        if (k === T.WATER) {
          const ph = this.time * 0.8 + x * 0.7 + y * 0.4;
          ctx.strokeStyle = `rgba(120,200,255,${0.1 + 0.1 * Math.sin(ph)})`;
          ctx.lineWidth = 1.2 * S;
          ctx.beginPath();
          ctx.moveTo(cx - 14 * S + Math.sin(ph) * 6 * S, cy); ctx.lineTo(cx + 6 * S + Math.sin(ph) * 6 * S, cy);
          ctx.stroke();
        }
      }
    }
    for (const pd of this.pads) this.drawPad(pd);
    this.drawQuay();

    // decalcomanie e cadaveri
    for (const dcl of g.fx.decals) {
      const p = this.w2s(dcl.x, dcl.y);
      if (p.x < -60 || p.x > cw + 60 || p.y < -60 || p.y > ch + 60) continue;
      ctx.fillStyle = dcl.color;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, dcl.r * TW * 0.5 * S, dcl.r * TH * 0.5 * S, 0, 0, TAU); ctx.fill();
    }
    for (const u of g.units) if (!u.alive && g.t - u.deadT >= 0.45) this.drawCorpse(u);
    if (this.settings?.lighting !== false) this.drawLightmap(cw, ch);
    this.drawOrders();

    // marker di zona (sotto le entita')
    const markers = g.mission.markers();
    for (const mk of markers) if (mk.kind === 'zone') this.drawZone(mk);
    for (const b of g.bombs) this.drawBombRing(b);

    // bucket entita'
    const nb = m.w + m.h + 2;
    const B = this.buckets;
    for (let i = 0; i < nb; i++) { if (!B[i]) B[i] = []; else B[i].length = 0; }
    const put = (o, type) => {
      const d = clamp(Math.floor(o.x) + Math.floor(o.y), dmin, dmax);
      B[d].push({ o, type, k: o.x + o.y });
    };
    for (const u of g.units) if ((u.alive && !u.vehicle) || (!u.alive && g.t - u.deadT < 0.45)) put(u, 'u');
    for (const v of g.vehicles) put(v, 'v');
    for (const p of g.pickups) put(p, 'p');
    for (const b of g.bombs) put(b, 'b');
    for (const p of g.projectiles) put(p, 'm');
    for (const l of this.lamps) put({ x: l.x + 0.5, y: l.y + 0.5 }, 'l');

    // pass 2: oggetti + entita' in ordine di profondita'
    for (let d = dmin; d <= dmax; d++) {
      const x0 = Math.max(minX, d - maxY), x1 = Math.min(maxX, d - minY);
      for (let x = x0; x <= x1; x++) {
        const y = d - x;
        const k = m.kind[y * m.w + x];
        if (k === T.BLDG) this.drawBuilding(x, y);
        else if (k === T.TREE) this.drawTree(x, y);
        else if (k === T.FENCE) this.drawFence(x, y);
        else if (k === T.GATE) this.drawGate(x, y);
      }
      const arr = B[d];
      if (arr.length) {
        arr.sort((a, b) => a.k - b.k);
        for (const e of arr) {
          if (e.type === 'u') this.drawUnit(e.o);
          else if (e.type === 'v') this.drawVehicle(e.o);
          else if (e.type === 'p') this.drawPickup(e.o);
          else if (e.type === 'b') this.drawBomb(e.o);
          else if (e.type === 'm') this.drawMissile(e.o);
          else if (e.type === 'l') this.drawLamp(e.o);
        }
      }
    }

    // marker bersagli (sopra)
    for (const mk of markers) if (mk.kind !== 'zone') this.drawArrow(mk);

    // luci/effetti additivi
    this.drawFx();
    if (this.settings?.weatherFx !== false) this.drawWeather(dt, cw, ch);
    // indicatori agenti sempre visibili (anche dietro agli edifici)
    for (const a of g.agents) {
      if (!a.alive || a.vehicle) continue;
      const p = this.w2s(a.x, a.y, 1.6);
      if (p.x < 0 || p.x > cw || p.y < 0 || p.y > ch) continue;
      const ctx2 = this.ctx;
      ctx2.save(); ctx2.translate(p.x, p.y - 4 * S); ctx2.globalAlpha = g.sel.has(a) ? 0.95 : 0.55;
      ctx2.fillStyle = a.hurt > 0 ? '#ff4d5a' : '#37e1ff'; ctx2.beginPath(); ctx2.moveTo(0, 5 * S); ctx2.lineTo(-4.5 * S, -2 * S); ctx2.lineTo(4.5 * S, -2 * S); ctx2.closePath(); ctx2.fill();
      ctx2.font = `bold ${10 * S}px ui-monospace, monospace`; ctx2.textAlign = 'center'; ctx2.fillText(String(g.agents.indexOf(a) + 1), 0, -5 * S);
      ctx2.restore();
    }
    this.drawOffscreenPointers(markers);
    this.drawCursorAndSelection();
  }

  // ---------------- ambiente ----------------
  /** Riflessi sull'acqua oltre i confini della mappa. */
  drawOuterWater(pts) {
    const g = this.game, m = g.map, ctx = this.ctx, S = this.S;
    const x0 = Math.floor(Math.min(...pts.map((p) => p.x))) - 1, x1 = Math.ceil(Math.max(...pts.map((p) => p.x))) + 1;
    const y0 = Math.floor(Math.min(...pts.map((p) => p.y))) - 1, y1 = Math.ceil(Math.max(...pts.map((p) => p.y))) + 1;
    if (x0 >= 0 && y0 >= 0 && x1 < m.w && y1 < m.h) return;
    ctx.lineWidth = 1.2 * S;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (m.inb(x, y) || hash2(x, y, 71) > 0.45) continue;
        const ph = this.time * 0.7 + x * 0.9 + y * 0.5;
        const c = this.w2s(x + 0.5, y + 0.5);
        ctx.strokeStyle = `rgba(120,200,255,${0.16 + 0.12 * Math.sin(ph)})`;
        ctx.beginPath(); ctx.moveTo(c.x - 16 * S + Math.sin(ph) * 8 * S, c.y); ctx.lineTo(c.x + 10 * S + Math.sin(ph) * 8 * S, c.y); ctx.stroke();
      }
  }

  /** Banchina lungo il perimetro della citta'. */
  drawQuay() {
    const m = this.game.map, ctx = this.ctx, S = this.S;
    const P = (x, y, z) => this.w2s(x, y, z);
    const face = (a, b, col) => {
      const p = [P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], -0.45), P(a[0], a[1], -0.45)];
      ctx.fillStyle = col; ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill();
    };
    face([m.w, 0], [m.w, m.h], this.th.quay[0]);
    face([0, m.h], [m.w, m.h], this.th.quay[1]);
    const c = [P(0, 0, 0), P(m.w, 0, 0), P(m.w, m.h, 0), P(0, m.h, 0)];
    ctx.strokeStyle = this.th.quayLine; ctx.lineWidth = 2.4 * S;
    ctx.beginPath(); c.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
  }

  /** Imposta una trasformazione sul piano del terreno: 1 unita' = 1 tile. */
  floorTransform(x, y, z = 0) {
    const S = this.S, c = this.w2s(x, y, z);
    this.ctx.setTransform((TW / 2) * S, (TH / 2) * S, -(TW / 2) * S, (TH / 2) * S, c.x, c.y);
  }

  drawPad(pd) {
    const ctx = this.ctx, c = this.w2s(pd.x, pd.y);
    if (c.x < -200 || c.x > this.cv.width + 200 || c.y < -120 || c.y > this.cv.height + 120) return;
    ctx.save();
    this.floorTransform(pd.x, pd.y);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 3);
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = `rgba(80,225,255,${0.55 + 0.3 * pulse})`;
    ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, TAU); ctx.stroke();
    ctx.setLineDash([0.18, 0.14]); ctx.lineDashOffset = -this.time * 0.4;
    ctx.beginPath(); ctx.arc(0, 0, 1.45, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,210,77,0.85)';
    ctx.fillRect(-0.45, -0.55, 0.16, 1.1); ctx.fillRect(0.29, -0.55, 0.16, 1.1); ctx.fillRect(-0.45, -0.08, 0.9, 0.16);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, on = (Math.floor(this.time * 6) % 8) === i;
      ctx.fillStyle = on ? '#bff6ff' : 'rgba(80,225,255,0.4)';
      ctx.beginPath(); ctx.arc(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0.06, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  lightSprite(rgb) {
    this.lsCache ??= new Map();
    let c = this.lsCache.get(rgb);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.35, `rgba(${rgb},0.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    this.lsCache.set(rgb, c);
    return c;
  }

  /** Sprite radiale pre-renderizzato per particelle/bagliori: evita createRadialGradient per ogni particella a ogni frame. */
  partSprite(key) {
    this.psCache ??= new Map();
    let s = this.psCache.get(key);
    if (s) return s;
    s = document.createElement('canvas'); s.width = s.height = 64;
    const x = s.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (key === 'fire') {
      gr.addColorStop(0, 'rgba(255,235,130,0.8)');
      gr.addColorStop(0.45, 'rgba(255,120,35,0.5)');
      gr.addColorStop(1, 'rgba(255,60,10,0)');
    } else if (key.startsWith('sm:')) {
      const rgb = key.slice(3);
      gr.addColorStop(0, `rgba(${rgb},0.4)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
    } else if (key.startsWith('fl:')) {
      gr.addColorStop(0, key.slice(3));
      gr.addColorStop(1, 'rgba(0,0,0,0)');
    } else if (key.startsWith('gl:')) {
      const rgb = key.slice(3);
      gr.addColorStop(0, `rgba(${rgb},0.22)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
    } else {
      gr.addColorStop(0, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
    }
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    this.psCache.set(key, s);
    return s;
  }

  /** Illuminazione notturna del terreno: oscurita' ambientale moltiplicata, schiarita da lampioni, insegne, fari, spari ed esplosioni. */
  drawLightmap(cw, ch) {
    const g = this.game, LS = 0.5;
    const W = Math.ceil(cw * LS), H = Math.ceil(ch * LS);
    if (!this.lm || this.lm.width !== W || this.lm.height !== H) { this.lm = document.createElement('canvas'); this.lm.width = W; this.lm.height = H; this.lmx = this.lm.getContext('2d'); }
    const l = this.lmx;
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    l.fillStyle = g.def.ambient || g.theme.ambient || (g.weather === 'fog' ? 'rgb(132,138,166)' : g.weather === 'rain' ? 'rgb(104,112,152)' : 'rgb(116,124,166)');
    l.fillRect(0, 0, W, H);
    if (this.thunder > 0) { l.fillStyle = `rgba(200,210,255,${this.thunder})`; l.fillRect(0, 0, W, H); }
    l.globalCompositeOperation = 'lighter';
    const k = (TW / 2) * this.S * LS * 1.15;
    const add = (x, y, rgb, r, a = 1) => {
      const p = this.w2s(x, y);
      const rx = r * k, ry = rx * 0.5, px = p.x * LS, py = p.y * LS;
      if (px + rx < 0 || px - rx > W || py + ry < 0 || py - ry > H) return;
      l.globalAlpha = clamp(a, 0, 1);
      l.drawImage(this.lightSprite(rgb), px - rx, py - ry, rx * 2, ry * 2);
    };
    const t = this.time;
    for (const lp of this.lamps) add(lp.x + 0.75, lp.y + 0.5, '255,206,140', 3.4, 0.8 + (hash2(lp.x, lp.y, 3) < 0.08 ? 0.4 * Math.sin(t * 23) : 0));
    for (const n of this.neons) add(n.x, n.y, n.rgb, 2.1, 0.5 + 0.08 * Math.sin(t * 2 + n.x));
    for (const pd of this.pads) add(pd.x, pd.y, '80,225,255', 3.2, 0.45 + 0.15 * Math.sin(t * 3));
    for (const v of g.vehicles) {
      if (!v.alive) { if (g.t - (v.deadT ?? -99) < 25) add(v.x, v.y, '255,130,50', 2.6, 0.35 + 0.25 * Math.random()); continue; }
      const dv = DIR_V[v.heading];
      add(v.x + dv[0] * 2.1, v.y + dv[1] * 2.1, '255,240,205', 2.3, 0.65);
      add(v.x - dv[0] * 0.9, v.y - dv[1] * 0.9, '255,40,40', 0.9, 0.5);
      if (v.type === 'police') { const on = Math.sin(t * 14) > 0; add(v.x, v.y, on ? '255,40,60' : '50,90,255', 3.4, 0.8); }
      if (v.burn) add(v.x, v.y, '255,140,60', 2.2, 0.5 + 0.3 * Math.random());
    }
    for (const u of g.units) {
      if (!u.alive) { if (u.burning && g.t - u.deadT < 6) add(u.x, u.y, '255,140,60', 1.6, 0.4 * Math.random() + 0.3); continue; }
      if (u.burn > 0) add(u.x, u.y, '255,150,60', 2, 0.5 + 0.3 * Math.random());
      else if (u.kind === 'agent' && !u.vehicle) add(u.x, u.y, '110,220,255', 1.3, 0.4);
    }
    for (const pk of g.pickups) add(pk.x, pk.y, pk.quest ? '255,210,77' : '60,255,160', 1.1, 0.55);
    for (const b of g.bombs) add(b.x, b.y, '255,60,40', 1.4, 0.4 + 0.4 * Math.abs(Math.sin(t * 8)));
    for (const p of g.projectiles) add(p.x, p.y, '150,215,255', 2.4, 0.9);
    for (const f of g.fx.lights) add(f.x, f.y, f.rgb, f.r, f.life / f.max);
    l.globalAlpha = 1;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.lm, 0, 0, cw, ch);
    ctx.restore();
  }

  /** Percorsi e ordini in coda degli agenti selezionati. */
  drawOrders() {
    const g = this.game, ctx = this.ctx, S = this.S;
    ctx.save();
    ctx.lineWidth = 1.6 * S;
    ctx.setLineDash([6 * S, 6 * S]);
    ctx.lineDashOffset = -this.time * 20 * S;
    for (const a of g.agents) {
      if (!a.alive || a.vehicle || !g.sel.has(a)) continue;
      const pts = [{ x: a.x, y: a.y }];
      if (a.path) for (let i = a.pi; i < a.path.length; i++) pts.push(a.path[i]);
      else if (a.order?.type === 'move') pts.push({ x: a.order.x, y: a.order.y });
      for (const q of a.queue) {
        const tg = q.type === 'move' ? q : q.target;
        if (tg && (tg.alive ?? true)) pts.push({ x: tg.x, y: tg.y, q: q.type });
      }
      if (pts.length < 2) continue;
      const atk = a.order?.type === 'attack' || a.order?.type === 'persuade';
      ctx.strokeStyle = atk ? 'rgba(255,90,100,0.55)' : 'rgba(55,225,255,0.45)';
      ctx.beginPath();
      pts.forEach((p, i) => { const s = this.w2s(p.x, p.y, 0.02); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.stroke();
      const e = this.w2s(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(e.x, e.y - 4 * S); ctx.lineTo(e.x + 7 * S, e.y); ctx.lineTo(e.x, e.y + 4 * S); ctx.lineTo(e.x - 7 * S, e.y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /** Pioggia, nebbia e lampi in spazio schermo. */
  drawWeather(dt, cw, ch) {
    const g = this.game, ctx = this.ctx, dpr = this.dpr;
    this.thunder = Math.max(0, (this.thunder || 0) - dt * 3);
    if (g.weather === 'rain') {
      const N = Math.round(260 * (this.quality || 1));
      const D = this.drops;
      while (D.length < N) D.push({ x: Math.random() * cw, y: Math.random() * ch, l: (10 + Math.random() * 14) * dpr, v: (900 + Math.random() * 500) * dpr });
      D.length = N;
      ctx.save();
      ctx.strokeStyle = 'rgba(170,200,255,0.28)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      for (const d of D) {
        d.y += d.v * dt; d.x -= d.v * 0.16 * dt;
        if (d.y > ch) { d.y = -d.l; d.x = Math.random() * (cw + 200); }
        if (d.x < -20) d.x += cw + 40;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.16, d.y - d.l);
      }
      ctx.stroke();
      this.splash ??= [];
      for (let i = 0; i < 5; i++) this.splash.push({ x: Math.random() * cw, y: Math.random() * ch, t: 0 });
      ctx.strokeStyle = 'rgba(180,210,255,0.35)';
      for (let i = this.splash.length - 1; i >= 0; i--) {
        const sp = this.splash[i];
        sp.t += dt;
        if (sp.t > 0.25) { this.splash.splice(i, 1); continue; }
        const r = (2 + sp.t * 28) * dpr;
        ctx.globalAlpha = 1 - sp.t / 0.25;
        ctx.beginPath(); ctx.ellipse(sp.x, sp.y, r, r * 0.45, 0, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(14,22,40,0.10)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
      if (Math.random() < dt * 0.025) this.thunder = 0.6;
    } else if (g.weather === 'fog') {
      ctx.save();
      for (let i = 0; i < 7; i++) {
        const x = ((i * 0.37 + this.time * 0.012 * (1 + i * 0.2)) % 1.4 - 0.2) * cw, y = ((i * 0.23 + Math.sin(this.time * 0.05 + i) * 0.05) % 1) * ch;
        const r = (0.35 + (i % 3) * 0.15) * Math.max(cw, ch);
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(150,165,190,0.13)'); gr.addColorStop(1, 'rgba(150,165,190,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, cw, ch);
      }
      ctx.restore();
    }
    if (this.thunder > 0) { ctx.fillStyle = `rgba(210,220,255,${this.thunder * 0.18})`; ctx.fillRect(0, 0, cw, ch); }
  }

  // ---------------- oggetti ----------------
  drawBuilding(x, y) {
    const m = this.game.map;
    const i = y * m.w + x;
    const L = m.bh[i], st = m.style[i];
    const S = this.S;
    const z1 = Math.round(bldgZ(L) * ZH);
    const cx = ((x + 0.5) - (y + 0.5)) * (TW / 2) * S + this.ox, cy = ((x + 0.5) + (y + 0.5)) * (TH / 2) * S + this.oy;
    if (cx < -TW * S || cx > this.cv.width + TW * S || cy - z1 * S > this.cv.height + TH * S || cy + TH * S < -10) return;
    const v = (x * 5 + y * 11) % 4;
    const ctx = this.ctx;
    const nr = m.bhAt(x + 1, y), nl = m.bhAt(x, y + 1);
    // dissolvenza se l'edificio copre un agente
    let fade = false;
    if (L >= 2) {
      for (const a of this.game.agents) {
        if (!a.alive || a.vehicle) continue;
        const dx = x - a.x, dy = y - a.y;
        if (dx >= -1 && dy >= -1 && dx + dy > 0 && dx <= 1 + L * 1.1 && dy <= 1 + L * 1.1 && Math.abs(dx - dy) <= 3.2) { fade = true; break; }
      }
    }
    const fa = this.fadeAlpha ??= {};
    const key = y * m.w + x;
    fa[key] = (fa[key] ?? 1) + ((fade ? 0.3 : 1) - (fa[key] ?? 1)) * 0.2;
    ctx.globalAlpha = fa[key];
    if (nr < L) {
      const z0 = Math.round(bldgZ(nr) * ZH);
      const spr = this.faceSprite('R', st, z0, z1, v);
      ctx.drawImage(spr, Math.round(cx), Math.round(cy - z1 * S));
    }
    if (nl < L) {
      const z0 = Math.round(bldgZ(nl) * ZH);
      const spr = this.faceSprite('L', st, z0, z1, v);
      ctx.drawImage(spr, Math.round(cx - (TW / 2) * S), Math.round(cy - z1 * S));
    }
    const { spr, padY } = this.topSprite(st, v, z1);
    ctx.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - z1 * S - (padY + (TH + 2) / 2) * S));
    ctx.globalAlpha = 1;
  }

  box(cx, cy, hx, hy, z0, z1, top, left, right) {
    const ctx = this.ctx;
    const P = (x, y, z) => this.w2s(x, y, z);
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy;
    const poly = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); };
    poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], right);
    poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], left);
    poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top);
  }

  drawTree(x, y) {
    const S = this.S, ctx = this.ctx;
    const p = this.w2s(x + 0.5, y + 0.5, 0);
    if (p.x < -90 || p.x > this.cv.width + 90 || p.y < -110 || p.y > this.cv.height + 80) return;
    const seed = (x * 7 + y * 13) % 6;
    const frame = Math.floor(((((this.time * 1.35 + x * 1.7 + y) % TAU) + TAU) % TAU) / (TAU / 8));
    const sway = Math.sin((frame / 8) * TAU);
    const key = `m|t|${this.th.name}|${seed}|${frame}`;
    const spr = this.bake(key, () => buildTree(seed, sway, this.th.trunk, this.th.tree));
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 20 * S, 9 * S, 0, 0, TAU); ctx.fill();
    ctx.drawImage(spr, p.x - spr.fx * S, p.y - spr.fy * S);
  }

  drawFence(x, y) {
    this.box(x + 0.5, y + 0.5, 0.5, 0.5, 0, 0.55, '#59627a', '#3d4559', '#2a3042');
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(160,190,230,0.12)';
  }
  drawGate(x, y) {
    const open = this.game.map.gateOpen.has(y * this.game.map.w + x);
    this.box(x + 0.5, y + 0.5, 0.5, 0.5, 0, open ? 0.08 : 1.0, '#5a6078', open ? '#2d6a45' : '#7a2e3a', open ? '#1f4f33' : '#591f29');
    if (!open) {
      const p = this.w2s(x + 0.5, y + 0.5, 1.0);
      this.ctx.fillStyle = '#ff4466'; this.ctx.shadowColor = '#ff4466'; this.ctx.shadowBlur = 8;
      this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 3 * this.S, 0, TAU); this.ctx.fill(); this.ctx.shadowBlur = 0;
    }
  }
  drawLamp(o) {
    const S = this.S;
    const p = this.w2s(o.x, o.y, 0);
    if (p.x < -60 || p.x > this.cv.width + 60 || p.y < -130 || p.y > this.cv.height + 40) return;
    const spr = this.bake(`m|lamp|${this.th.name}`, () => buildLamp());
    this.ctx.drawImage(spr, p.x - spr.fx * S, p.y - spr.fy * S);
  }

  worldCircle(wx, wy, r, z = 0) {
    const c = this.w2s(wx, wy, z), S = this.S;
    return { x: c.x, y: c.y, rx: r * Math.SQRT2 * (TW / 2) * S, ry: r * Math.SQRT2 * (TH / 2) * S };
  }

  drawZone(mk) {
    const ctx = this.ctx, S = this.S;
    const c = this.worldCircle(mk.x, mk.y, mk.r);
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 3);
    const col = '255,210,77';
    ctx.fillStyle = `rgba(${col},${0.1 * pulse})`;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${col},${0.5 + 0.3 * pulse})`; ctx.lineWidth = 2.2 * S; ctx.setLineDash([10 * S, 7 * S]); ctx.lineDashOffset = -this.time * 24 * S;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  drawBombRing(b) {
    const ctx = this.ctx;
    const c = this.worldCircle(b.x, b.y, b.radius);
    const f = 0.35 + 0.35 * Math.abs(Math.sin(this.time * (2 + 8 * (1 - b.t / b.fuse))));
    ctx.strokeStyle = `rgba(255,90,60,${f})`; ctx.lineWidth = 2 * this.S;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, TAU); ctx.stroke();
  }

  drawArrow(mk) {
    const ctx = this.ctx, S = this.S;
    const z = mk.kind === 'item' ? 0.9 : 1.75;
    const p = this.w2s(mk.x, mk.y, z + 0.2 * Math.sin(this.time * 4));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = mk.kind === 'item' ? '#ffd24d' : '#ff5a5a';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10 * S;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8 * S, -12 * S); ctx.lineTo(8 * S, -12 * S); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawOffscreenPointers(markers) {
    const ctx = this.ctx, S = this.S, cw = this.cv.width, ch = this.cv.height;
    for (const mk of markers) {
      const p = this.w2s(mk.x, mk.y, 0.5);
      if (p.x > 30 && p.x < cw - 30 && p.y > 30 && p.y < ch - 90) continue;
      const cx = cw / 2, cy = ch / 2;
      const a = Math.atan2(p.y - cy, p.x - cx);
      const px = clamp(cx + Math.cos(a) * 1e4, 36 * this.dpr, cw - 36 * this.dpr), py = clamp(cy + Math.sin(a) * 1e4, 70 * this.dpr, ch - 150 * this.dpr);
      // intersezione approssimata col bordo
      const tx = (Math.cos(a) > 0 ? cw - 36 * this.dpr : 36 * this.dpr) - cx, ty = (Math.sin(a) > 0 ? ch - 150 * this.dpr : 70 * this.dpr) - cy;
      const t = Math.min(Math.abs(tx / (Math.cos(a) || 1e-6)), Math.abs(ty / (Math.sin(a) || 1e-6)));
      const ex = cx + Math.cos(a) * t, ey = cy + Math.sin(a) * t;
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = mk.kind === 'zone' ? '#ffd24d' : mk.kind === 'item' ? '#ffd24d' : '#ff5a5a';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8 * this.dpr;
      ctx.beginPath(); ctx.moveTo(14 * this.dpr, 0); ctx.lineTo(-8 * this.dpr, -9 * this.dpr); ctx.lineTo(-8 * this.dpr, 9 * this.dpr); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---------------- unita' ----------------
  look(u) {
    if (u.kind === 'civilian' && !u.persuaded) return { coat: CIV_COATS[u.uid % CIV_COATS.length], trim: '#aab', pants: '#2b2f3a', skin: ['#d9a98a', '#c18f6d', '#8d5a3b', '#e6c4a6'][u.uid % 4], hair: ['#1a1a22', '#4a3322', '#8a6a3a', '#cfcfcf'][u.uid % 4] };
    if (u.kind === 'civilian') return { coat: CIV_COATS[u.uid % CIV_COATS.length], trim: '#d28bff', pants: '#2b2f3a', skin: ['#d9a98a', '#c18f6d', '#8d5a3b', '#e6c4a6'][u.uid % 4], hair: '#1a1a22' };
    return FACTION_LOOK[u.kind] || FACTION_LOOK.guard;
  }

  drawCorpse(u) {
    const ctx = this.ctx, S = this.S;
    const p = this.w2s(u.x, u.y);
    if (p.x < -50 || p.x > this.cv.width + 50 || p.y < -50 || p.y > this.cv.height + 50) return;
    const L = this.look(u);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(S, S);
    ctx.fillStyle = 'rgba(110,8,26,0.65)'; ctx.beginPath(); ctx.ellipse(0, 0, 15, 7, 0, 0, TAU); ctx.fill();
    ctx.rotate(-0.3 + (u.uid % 7) * 0.12);
    if (Math.cos(u.fallDir ?? 0) - Math.sin(u.fallDir ?? 0) >= 0) ctx.scale(-1, 1);
    ctx.fillStyle = L.pants; ctx.fillRect(-4, -2, 16, 5);
    ctx.fillStyle = L.coat; ctx.beginPath(); ctx.ellipse(-4, 0, 9, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(-14, 0, 4.4, 0, TAU); ctx.fill();
    ctx.fillStyle = L.hair; ctx.beginPath(); ctx.arc(-15, -1, 3.6, Math.PI, TAU); ctx.fill();
    ctx.restore();
    if (u.burning && this.game.t - u.deadT < 6 && Math.random() < 0.3) this.game.fx.fire(u.x, u.y, 0.15, 4);
  }

  drawUnit(u) {
    const ctx = this.ctx, S = this.S, g = this.game;
    const p = this.w2s(u.x, u.y);
    if (p.x < -60 || p.x > this.cv.width + 60 || p.y < -120 || p.y > this.cv.height + 60) return;
    const L = this.look(u);
    const dead = !u.alive;
    const sel = !dead && g.sel.has(u);
    const fall = dead ? clamp((g.t - u.deadT) / 0.45, 0, 1) : 0;
    const dirB = Math.round((((u.dir % TAU) + TAU) % TAU) / (TAU / 12)) % 12;
    const moving = !dead && !!u.moving && !u.cower;
    const frame = moving ? Math.floor((((u.anim % TAU) + TAU) % TAU) / (TAU / 8)) : -1;
    const w = u.weapons.length ? u.wdef() : null;
    const hasGun = !dead && !u.holstered && w && (OFFENSIVE.has(w.type) || w.type === 'persuade');
    const aim = !dead && !!hasGun && (u.flash > 0 || !!u.aimDir || (u.order && (u.order.type === 'attack' || u.order.type === 'persuade')));
    const key = `m|u|${this.th.name}|${u.kind}|${L.coat}|${L.trim}|${L.pants}|${L.skin}|${L.hair}|${hasGun ? w.id : '-'}|${dirB}|${frame}|${u.cower ? 1 : 0}|${aim ? 1 : 0}`;
    const spr = this.bake(key, () => buildHuman(L, u.kind, { yaw: dirB * TAU / 12, moving: frame >= 0, frame: frame < 0 ? 0 : frame, aim: !!aim, cower: !!u.cower, hasGun: !!hasGun, weapon: hasGun ? w.id : 'pistol' }));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(S, S);
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 6, 0, 0, TAU); ctx.fill();
    if (!dead) {
      if (sel) {
        ctx.strokeStyle = `rgba(55,225,255,${0.7 + 0.3 * Math.sin(this.time * 6)})`; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.ellipse(0, 0, 19, 9.5, 0, 0, TAU); ctx.stroke();
      }
      if (u.persuaded && u.kind !== 'agent') {
        ctx.strokeStyle = 'rgba(210,139,255,0.8)'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.ellipse(0, 0, 15, 7.5, 0, 0, TAU); ctx.stroke();
      }
      if (this.hover === u) {
        ctx.strokeStyle = u.faction === 0 ? 'rgba(55,225,255,0.9)' : u.faction === 3 ? 'rgba(220,230,245,0.8)' : 'rgba(255,90,100,0.95)';
        ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.lineDashOffset = this.time * 12;
        ctx.beginPath(); ctx.ellipse(0, 0, 22, 11, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
    ctx.save();
    ctx.translate(p.x, p.y);
    if (fall) {
      const fs = Math.cos(u.fallDir ?? 0) - Math.sin(u.fallDir ?? 0) >= 0 ? 1 : -1;
      ctx.rotate(fs * fall * fall * 1.45);
      ctx.globalAlpha = 1 - fall * 0.15;
    }
    ctx.drawImage(spr, -spr.fx * S, -spr.fy * S);
    if (u.flash > 0 && !dead && spr.tip) {
      ctx.fillStyle = 'rgba(255,230,160,0.95)'; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 14 * S;
      ctx.beginPath(); ctx.arc(spr.tip[0] * S, spr.tip[1] * S, (4 + Math.random() * 2) * S, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.restore();
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(S, S);
    if (u.hurt > 0) { ctx.fillStyle = `rgba(255,60,60,${u.hurt * 2.2})`; ctx.beginPath(); ctx.ellipse(0, -22, 8, 16, 0, 0, TAU); ctx.fill(); }
    if (dead) { ctx.restore(); return; }
    if (u.shield > 0) { ctx.strokeStyle = `rgba(110,225,255,${0.25 + 0.15 * Math.sin(this.time * 8)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, -21, 12, 22, 0, 0, TAU); ctx.stroke(); }
    // indicatori
    if (u.carrying.length) { ctx.fillStyle = '#ffd24d'; ctx.fillRect(-4, -53, 8, 6); }
    if (u.persuaded && u.kind !== 'agent') { ctx.fillStyle = '#d28bff'; ctx.shadowColor = '#d28bff'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(4, -55); ctx.lineTo(0, -60); ctx.lineTo(-4, -55); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; }
    if (u.hp < u.maxHp - 0.5 || sel) {
      const bw = u.kind === 'agent' ? 30 : 24;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-bw / 2 - 1, -53, bw + 2, 5);
      const f = clamp(u.hp / u.maxHp, 0, 1);
      ctx.fillStyle = u.faction === 0 ? (f > 0.4 ? '#39e07a' : '#ffb04d') : u.faction === 3 ? '#9aa4b8' : '#ff4d5a';
      ctx.fillRect(-bw / 2, -52, bw * f, 3);
    }
    const st = u.faction !== 0 && u.faction !== 3 ? u.ai?.state : null;
    if (st) {
      ctx.textAlign = 'center'; ctx.font = 'bold 13px sans-serif';
      if (st === 'suspicious') {
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.arc(0, -62, 5.5, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, -62, 5.5, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(u.ai.sus, 0, 1)); ctx.stroke();
      } else if (st === 'alert') { ctx.fillStyle = '#ffd24d'; ctx.fillText('?', 0, -56); }
      else if (st === 'warn') { ctx.fillStyle = Math.sin(this.time * 10) > 0 ? '#ff4d5a' : '#7ea6ff'; ctx.fillText('!', 0, -56); }
      else if (st === 'cover' || st === 'retreat') { ctx.fillStyle = '#ffb04d'; ctx.font = 'bold 9px sans-serif'; ctx.fillText('▼', 0, -56); }
    }
    ctx.restore();
  }

  // ---------------- veicoli ----------------
  drawVehicle(v) {
    const ctx = this.ctx, S = this.S;
    const p = this.w2s(v.x, v.y);
    if (p.x < -160 || p.x > this.cv.width + 160 || p.y < -170 || p.y > this.cv.height + 120) return;
    const dead = !v.alive;
    const key = `m|v|${v.type}|${v.color}|${v.heading}|${dead ? 1 : 0}`;
    const spr = this.bake(key, () => buildVehicle(v.type, v.color, v.heading, { dead }));
    const sc = this.worldCircle(v.x, v.y, 0.7);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(sc.x, sc.y, sc.rx * 1.05, sc.ry * 1.05, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.drawImage(spr, -spr.fx * S, -spr.fy * S);
    if (v.flash > 0 && !dead) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55; ctx.drawImage(spr, -spr.fx * S, -spr.fy * S); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    ctx.restore();
    const topPx = (spr.top - spr.fy) * S;
    if (v.type === 'police' && v.alive) {
      const on = Math.sin(this.time * 14) > 0;
      ctx.fillStyle = on ? '#ff3b4b' : '#3b6bff'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12 * S;
      ctx.beginPath(); ctx.arc(p.x, p.y + topPx - 2 * S, 5 * S, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    }
    if (v.type === 'armored' && v.alive) {
      const td = v.turretDir ?? (v.heading === 1 ? 0 : v.heading === 2 ? Math.PI : v.heading === 3 ? Math.PI / 2 : -Math.PI / 2);
      const b1 = this.w2s(v.x + Math.cos(td) * 0.85, v.y + Math.sin(td) * 0.85, 0);
      ctx.strokeStyle = '#12151d'; ctx.lineWidth = 5 * S; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y + topPx + 2 * S); ctx.lineTo(b1.x, b1.y + topPx + 2 * S); ctx.stroke();
      ctx.fillStyle = '#ff3b6b'; ctx.shadowColor = '#ff3b6b'; ctx.shadowBlur = 6 * S;
      ctx.beginPath(); ctx.arc(p.x, p.y + topPx - 1 * S, 1.8 * S, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    }
    if (v.alive && v.hp < v.maxHp) {
      const pp = this.w2s(v.x, v.y, 1.35);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(pp.x - 17 * S, pp.y, 34 * S, 5 * S);
      ctx.fillStyle = '#ff4d5a'; ctx.fillRect(pp.x - 16 * S, pp.y + S, 32 * S * clamp(v.hp / v.maxHp, 0, 1), 3 * S);
    }
    if (v.passengers.length) {
      const pp = this.w2s(v.x, v.y, 1.2);
      ctx.fillStyle = '#37e1ff'; ctx.font = `bold ${13 * S}px monospace`; ctx.textAlign = 'center';
      ctx.fillText('⚑'.repeat(0) + v.passengers.length + '▸', pp.x, pp.y - 6 * S);
    }
  }

  drawPickup(p) {
    const ctx = this.ctx, S = this.S;
    const bob = Math.sin(p.t * 3) * 0.08;
    const s = this.w2s(p.x, p.y, 0.45 + bob);
    const gs = this.w2s(p.x, p.y, 0);
    const col = p.quest ? '#ffd24d' : '#3dffa0';
    const yawB = Math.floor(((((p.t * 1.4) % TAU) + TAU) % TAU) / (TAU / 8));
    const key = `m|pk|${p.quest ? 1 : 0}|${yawB}`;
    const spr = this.bake(key, () => buildPickup(col, col, (yawB % 8) * TAU / 8, p.quest));
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(gs.x, gs.y, 9 * S, 4 * S, 0, 0, TAU); ctx.fill();
    ctx.drawImage(spr, s.x - spr.fx * S, s.y - spr.fy * S);
    ctx.save(); ctx.translate(s.x, s.y); ctx.scale(S, S);
    ctx.fillStyle = '#04131b'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
    ctx.fillText(p.quest ? '$' : (WEAPONS[p.item]?.abbr || '?'), 0, 2.5);
    ctx.restore();
  }

  drawBomb(b) {
    const ctx = this.ctx, S = this.S;
    const s = this.w2s(b.x, b.y, 0.12);
    ctx.fillStyle = '#2a2f3d'; ctx.beginPath(); ctx.ellipse(s.x, s.y, 8 * S, 4 * S, 0, 0, TAU); ctx.fill();
    const on = Math.sin(this.time * (6 + 14 * (1 - b.t / b.fuse))) > 0;
    ctx.fillStyle = on ? '#ff3b3b' : '#5a1a1a'; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = on ? 12 * S : 0;
    ctx.beginPath(); ctx.arc(s.x, s.y - 3 * S, 2.6 * S, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  }
  drawMissile(p) {
    const ctx = this.ctx, S = this.S;
    const s = this.w2s(p.x, p.y, 0.55);
    ctx.fillStyle = '#e6f6ff'; ctx.shadowColor = '#7ad6ff'; ctx.shadowBlur = 14 * S;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.4 * S, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  }

  // ---------------- effetti ----------------
  drawFx() {
    const g = this.game, fx = g.fx, ctx = this.ctx, S = this.S;
    ctx.save();
    // particelle
    for (const p of fx.parts) {
      const s = this.w2s(p.x, p.y, p.z);
      if (s.x < -30 || s.x > this.cv.width + 30 || s.y < -30 || s.y > this.cv.height + 30) continue;
      const a = clamp(p.life / p.max, 0, 1);
      if (p.type === 'smoke') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a;
        if (!p._rgb) p._rgb = (p.color.match(/[\d.]+,[\d.]+,[\d.]+/) || ['120,126,144'])[0];
        const r = p.size * S;
        ctx.drawImage(this.partSprite('sm:' + p._rgb), s.x - r, s.y - r, r * 2, r * 2);
      } else if (p.type === 'fire') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        const r = p.size * S * (0.5 + 0.5 * a);
        ctx.drawImage(this.partSprite('fire'), s.x - r, s.y - r, r * 2, r * 2);
      } else {
        ctx.globalCompositeOperation = p.type === 'spark' ? 'lighter' : 'source-over';
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(s.x - p.size * S * 0.5, s.y - p.size * S * 0.5, p.size * S, p.size * S);
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
    // tracciati: alone largo + nucleo (shadowBlur per-stroke costava troppo in guerra)
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const t of fx.tracers) {
      const a = clamp(t.life / t.max, 0, 1);
      const p0 = this.w2s(t.x0, t.y0, t.z0), p1 = this.w2s(t.x1, t.y1, t.z1);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = t.color; ctx.globalAlpha = a * 0.35; ctx.lineWidth = t.w * S * 3.6; ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = t.w * S * 1.6; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // bagliori
    for (const f of fx.flashes) {
      const a = clamp(f.life / f.max, 0, 1);
      const s = this.w2s(f.x, f.y, f.z), r = f.r * TW * 0.5 * S;
      ctx.globalAlpha = a * 0.75;
      ctx.drawImage(this.partSprite('fl:' + f.color), s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    // onde d'urto
    ctx.globalCompositeOperation = 'source-over';
    for (const r of fx.rings) {
      const k = 1 - r.life / 0.5;
      const c = this.worldCircle(r.x, r.y, r.max * k);
      ctx.strokeStyle = `rgba(255,200,120,${1 - k})`; ctx.lineWidth = (3 + 5 * (1 - k)) * S;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, TAU); ctx.stroke();
    }
    // testi fluttuanti
    ctx.font = `bold ${12 * S}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'center';
    for (const t of fx.texts) {
      const s = this.w2s(t.x, t.y, t.z);
      ctx.globalAlpha = clamp(t.life / t.max * 1.6, 0, 1);
      ctx.lineWidth = 3 * S; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t.str, s.x, s.y);
      ctx.fillStyle = t.color; ctx.fillText(t.str, s.x, s.y);
    }
    ctx.globalAlpha = 1;
    // fari lampioni (alone)
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lamps) {
      const s = this.w2s(l.x + 0.5, l.y + 0.5, 0);
      if (s.x < -80 || s.x > this.cv.width + 80 || s.y < -80 || s.y > this.cv.height + 80) continue;
      const r = 52 * S;
      ctx.drawImage(this.partSprite('gl:255,220,140'), s.x - r, s.y - r * 0.5, r * 2, r);
    }
    ctx.restore();
  }

  drawCursorAndSelection() {
    const ctx = this.ctx, d = this.drag, dpr = this.dpr;
    if (d && d.active) {
      ctx.strokeStyle = 'rgba(55,225,255,0.9)'; ctx.fillStyle = 'rgba(55,225,255,0.12)'; ctx.lineWidth = 1.5 * dpr;
      const x = Math.min(d.x0, d.x1) * dpr, y = Math.min(d.y0, d.y1) * dpr, w = Math.abs(d.x1 - d.x0) * dpr, h = Math.abs(d.y1 - d.y0) * dpr;
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    }
    if (!this.mouse.inside) return;
    const mx = this.mouse.x * dpr, my = this.mouse.y * dpr;
    const cols = { move: '#37e1ff', attack: '#ff4d5a', persuade: '#d28bff', enter: '#5dff9a', none: '#aab' };
    const col = cols[this.cursor] || '#37e1ff';
    ctx.save();
    ctx.translate(mx, my);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.8 * dpr; ctx.shadowColor = col; ctx.shadowBlur = 8 * dpr;
    const r = (this.cursor === 'move' ? 9 : 13) * dpr;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r - 5 * dpr, 0); ctx.lineTo(-r * 0.4, 0); ctx.moveTo(r + 5 * dpr, 0); ctx.lineTo(r * 0.4, 0); ctx.moveTo(0, -r - 5 * dpr); ctx.lineTo(0, -r * 0.4); ctx.moveTo(0, r + 5 * dpr); ctx.lineTo(0, r * 0.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 1.6 * dpr, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------------- picking ----------------
  pick(sx, sy) {
    const g = this.game;
    const S = this.S;
    const px = sx * this.dpr, py = sy * this.dpr;
    let best = null, bd = 1e9;
    for (const u of g.units) {
      if (!u.alive || u.vehicle) continue;
      const p = this.w2s(u.x, u.y, 0.5);
      const d = Math.hypot(p.x - px, (p.y - py) * 0.85);
      if (d < 24 * S && d < bd) { bd = d; best = u; }
    }
    if (best) return { unit: best, world: this.s2w(px, py) };
    for (const v of g.vehicles) {
      if (!v.alive) continue;
      const p = this.w2s(v.x, v.y, 0.3);
      const d = Math.hypot(p.x - px, (p.y - py) * 0.8);
      if (d < 46 * S && d < bd) { bd = d; best = v; }
    }
    if (best) return { vehicle: best, world: this.s2w(px, py) };
    return { world: this.s2w(px, py) };
  }
}
