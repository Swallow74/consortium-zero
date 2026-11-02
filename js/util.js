export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function strSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function gauss(r = Math.random) {
  return (r() + r() + r() - 1.5) / 1.5;
}

/** Min-heap su priorita' numerica. */
export class Heap {
  constructor() {
    this.v = [];
    this.p = [];
  }
  get size() {
    return this.v.length;
  }
  clear() {
    this.v.length = 0;
    this.p.length = 0;
  }
  push(val, pri) {
    const { v, p } = this;
    let i = v.length;
    v.push(val);
    p.push(pri);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= pri) break;
      v[i] = v[par];
      p[i] = p[par];
      i = par;
    }
    v[i] = val;
    p[i] = pri;
  }
  pop() {
    const { v, p } = this;
    const top = v[0];
    const lv = v.pop();
    const lp = p.pop();
    const n = v.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        v[i] = v[c];
        p[i] = p[c];
        i = c;
      }
      v[i] = lv;
      p[i] = lp;
    }
    return top;
  }
}

export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs)
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('it-IT');
export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
