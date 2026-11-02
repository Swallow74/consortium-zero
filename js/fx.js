import { rand, TAU } from './util.js';

/** Effetti visivi: particelle, tracciati, esplosioni, decalcomanie, testi fluttuanti. */
export class Fx {
  constructor() {
    this.tracers = [];
    this.parts = [];
    this.rings = [];
    this.decals = [];
    this.texts = [];
    this.flashes = [];
    this.lights = [];
    this.shake = 0;
  }

  /** Luce dinamica temporanea per la mappa di illuminazione (rgb come 'r,g,b', raggio in tile). */
  light(x, y, rgb, r = 3, life = 0.1) {
    if (this.lights.length > 120) this.lights.shift();
    this.lights.push({ x, y, rgb, r, life, max: life });
  }

  /** Bossolo espulso dall'arma. */
  shell(x, y, ang) {
    const a = ang + Math.PI / 2 + rand(-0.4, 0.4), s = rand(1.2, 2.2);
    this.add({ x, y, z: 0.55, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(1.2, 2.2), life: rand(0.5, 0.9), size: 1.3, color: '#e0b84a', g: 9, type: 'spark' });
  }

  /** Sbuffo di polvere sull'impatto contro un muro. */
  puff(x, y) {
    this.add({ x, y, z: rand(0.3, 0.8), vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(0.1, 0.4), life: rand(0.3, 0.6), size: rand(2.5, 4), color: 'rgba(170,175,190,', g: 0, type: 'smoke' });
  }

  tracer(x0, y0, x1, y1, color = '#ffe28a', w = 1.6, life = 0.1, z0 = 0.62, z1 = 0.5) {
    this.tracers.push({ x0, y0, x1, y1, color, w, life, max: life, z0, z1 });
    if (this.tracers.length > 300) this.tracers.shift();
  }

  flash(x, y, z, color = '#ffd88a', r = 1.2, life = 0.09) {
    this.flashes.push({ x, y, z, color, r, life, max: life });
  }

  spark(x, y, z, n = 6, color = '#ffd88a') {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(1, 4);
      this.add({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(1, 3), life: rand(0.2, 0.5), size: rand(1, 2.2), color, g: 7, type: 'spark' });
    }
  }

  blood(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(0.5, 2.5);
      this.add({ x, y, z: 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(0.5, 2.5), life: rand(0.3, 0.7), size: rand(1.4, 2.8), color: '#b3122c', g: 9, type: 'blood' });
    }
    if (n > 3) this.decal(x + rand(-0.15, 0.15), y + rand(-0.15, 0.15), rand(0.1, 0.22), 'rgba(120,10,30,0.55)');
  }

  smoke(x, y, z, size = 5, life = 1.2, color = 'rgba(70,74,90,') {
    this.add({ x, y, z, vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), vz: rand(0.4, 0.9), life, size, color, g: 0, type: 'smoke' });
  }

  fire(x, y, z, size = 5) {
    this.add({ x, y, z, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(0.6, 1.6), life: rand(0.25, 0.6), size, color: '#ff9a3d', g: -1, type: 'fire' });
  }

  decal(x, y, r, color) {
    this.decals.push({ x, y, r, color });
    if (this.decals.length > 220) this.decals.shift();
  }

  explosion(x, y, radius = 3) {
    const n = Math.floor(14 + radius * 8);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(0.5, radius * 2.2);
      this.add({ x, y, z: rand(0.1, 0.6), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(1, 4), life: rand(0.4, 1.0), size: rand(5, 13), color: '#ff8a2b', g: 2, type: 'fire' });
    }
    for (let i = 0; i < 12; i++) this.smoke(x + rand(-1, 1), y + rand(-1, 1), rand(0.2, 1), rand(9, 18), rand(1.2, 2.4));
    this.spark(x, y, 0.5, 14, '#ffd36b');
    this.rings.push({ x, y, r: 0.2, max: radius * 1.15, life: 0.5, t: 0.5 });
    this.flash(x, y, 0.4, '#ffb04d', radius * 1.6, 0.35);
    this.decal(x, y, radius * 0.45, 'rgba(10,8,8,0.55)');
    this.light(x, y, '255,170,80', radius * 3.2, 0.6);
    this.shake = Math.min(18, this.shake + radius * 3.2);
  }

  text(x, y, str, color = '#ffffff', life = 1.4) {
    this.texts.push({ x, y, z: 1.3, str, color, life, max: life });
  }

  add(p) {
    p.max = p.life;
    if (this.parts.length > 1400) this.parts.shift();
    this.parts.push(p);
  }

  update(dt) {
    for (const a of [this.tracers, this.flashes, this.rings, this.texts, this.lights]) {
      for (let i = a.length - 1; i >= 0; i--) {
        const o = a[i];
        o.life -= dt;
        if (o.t !== undefined) o.t = o.life;
        if (o.life <= 0) a.splice(i, 1);
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) this.texts[i].z += dt * 0.6;
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vz -= p.g * dt;
      if (p.z < 0 && p.type !== 'smoke' && p.type !== 'fire') { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
      if (p.type === 'smoke') { p.size += dt * 3; p.vx *= 0.98; p.vy *= 0.98; }
    }
    this.shake *= Math.pow(0.02, dt);
    if (this.shake < 0.2) this.shake = 0;
  }
}
