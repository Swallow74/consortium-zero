import { WEAPONS, OFFENSIVE } from './data.js';
import { ZOOMS } from './render.js';
import { play, initAudio } from './audio.js';

/** Gestione di mouse e tastiera durante la missione. */
export class Input {
  constructor(canvas, renderer, app) {
    this.cv = canvas;
    this.r = renderer;
    this.app = app; // { game, paused(), togglePause(), toggleMenu(), settings, speed }
    this.keys = new Set();
    this.down = null;
    this.mid = null;
    this.enabled = false;
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('mouseleave', () => (this.r.mouse.inside = false));
    canvas.addEventListener('mouseenter', () => (this.r.mouse.inside = true));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get game() { return this.app.game; }
  selected() { return this.game ? this.game.agents.filter((a) => a.alive && this.game.sel.has(a)) : []; }

  pos(e) {
    const rc = this.cv.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  }

  onMove(e) {
    const p = this.pos(e);
    this.r.mouse = { x: p.x, y: p.y, inside: true };
    if (this.mid) {
      const dx = p.x - this.mid.x, dy = p.y - this.mid.y;
      this.mid = p;
      const S = this.r.S / this.r.dpr;
      const wx = (dx / (48 * S) + dy / (24 * S)) / 2, wy = (dy / (24 * S) - dx / (48 * S)) / 2;
      this.r.camT = null;
      this.r.cam.x -= wx; this.r.cam.y -= wy;
      return;
    }
    if (this.down && this.enabled) {
      const d = Math.hypot(p.x - this.down.x, p.y - this.down.y);
      if (d > 7) this.r.drag = { active: true, x0: this.down.x, y0: this.down.y, x1: p.x, y1: p.y };
    }
    if (this.enabled && this.game) this.updateCursor(p);
  }

  updateCursor(p) {
    const pk = this.r.pick(p.x, p.y);
    let mode = 'move';
    const sel = this.selected();
    this.r.hover = pk.unit || pk.vehicle || null;
    if (pk.unit && pk.unit.kind !== 'agent' && pk.unit.faction !== 0) {
      mode = 'attack';
      if (sel.some((a) => a.wdef()?.type === 'persuade') && pk.unit.persuadable && !sel.some((a) => OFFENSIVE.has(a.wdef()?.type))) mode = 'persuade';
      else if (sel.some((a) => a.wdef()?.type === 'persuade') && pk.unit.persuadable && pk.unit.faction === 3) mode = 'persuade';
    } else if (pk.vehicle) mode = pk.vehicle.hostile ? 'attack' : 'enter';
    this.r.cursor = mode;
  }

  onDown(e) {
    initAudio();
    const p = this.pos(e);
    if (e.button === 1) { this.mid = p; e.preventDefault(); return; }
    if (!this.enabled || !this.game || this.app.menuOpen()) return;
    if (e.button === 0) this.down = { ...p, shift: e.shiftKey };
    else if (e.button === 2) this.rightClick(p, e.shiftKey);
  }

  onUp(e) {
    if (e.button === 1) { this.mid = null; return; }
    if (e.button !== 0 || !this.down) return;
    const p = this.pos(e);
    const d = this.r.drag;
    const down = this.down;
    this.down = null;
    this.r.drag = null;
    if (!this.enabled || !this.game) return;
    if (d && d.active) { this.boxSelect(d, e.shiftKey); return; }
    if (this.app.menuOpen()) return;
    this.leftClick(p, e.shiftKey);
  }

  boxSelect(d, add) {
    const g = this.game;
    const dpr = this.r.dpr;
    const x0 = Math.min(d.x0, d.x1) * dpr, x1 = Math.max(d.x0, d.x1) * dpr, y0 = Math.min(d.y0, d.y1) * dpr, y1 = Math.max(d.y0, d.y1) * dpr;
    if (!add) g.sel.clear();
    for (const a of g.agents) {
      if (!a.alive) continue;
      const s = this.r.w2s(a.x, a.y, 0.5);
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) g.sel.add(a);
    }
    play('click');
  }

  leftClick(p, shift) {
    const g = this.game;
    const pk = this.r.pick(p.x, p.y);
    const sel = this.selected();
    if (pk.unit && pk.unit.kind === 'agent') {
      const now = performance.now();
      if (!shift && this.lastAgentClick?.u === pk.unit && now - this.lastAgentClick.t < 350) { this.r.centerOn(pk.unit.x, pk.unit.y); this.lastAgentClick = null; return; }
      this.lastAgentClick = { u: pk.unit, t: now };
      if (shift) { g.sel.has(pk.unit) ? g.sel.delete(pk.unit) : g.sel.add(pk.unit); }
      else { g.sel.clear(); g.sel.add(pk.unit); }
      play('click');
      return;
    }
    if (!sel.length) {
      this.app.hud?.flash('Nessun agente selezionato');
      return;
    }
    if (pk.unit && pk.unit.faction !== 0) {
      const t = pk.unit;
      const pers = sel.filter((a) => a.wdef()?.type === 'persuade' && t.persuadable);
      const atk = sel.filter((a) => a.attackIndex() >= 0 && a.wdef()?.type !== 'persuade' || (a.wdef()?.type === 'persuade' && !t.persuadable && a.attackIndex() >= 0));
      if (pers.length && (t.faction === 3 || !atk.length || t.faction !== 3)) {
        g.orderPersuade(pers, t, shift);
        g.orderAttack(atk.filter((a) => !pers.includes(a)), t, shift);
      } else if (atk.length) g.orderAttack(atk, t, shift);
      else g.fx.text(t.x, t.y, 'NESSUNA ARMA', '#ff8a8a');
      this.markOrder(t.x, t.y, '#ff4d5a');
      return;
    }
    if (pk.vehicle) {
      const v = pk.vehicle;
      if (v.hostile || (v.faction === 1)) { g.orderAttack(sel.filter((a) => a.attackIndex() >= 0), v, shift); this.markOrder(v.x, v.y, '#ff4d5a'); }
      else if (sel.some((a) => a.vehicle === v)) { g.exitVehicle(v); play('click'); }
      else { g.orderEnter(sel, v, shift); this.markOrder(v.x, v.y, '#5dff9a'); }
      return;
    }
    g.orderMove(sel, pk.world.x, pk.world.y, shift);
    this.markOrder(pk.world.x, pk.world.y, '#37e1ff');
  }

  rightClick(p) {
    const g = this.game;
    const sel = this.selected();
    if (!sel.length) return;
    const pk = this.r.pick(p.x, p.y);
    if (pk.unit && pk.unit.faction !== 0) g.orderAttack(sel.filter((a) => a.attackIndex() >= 0), pk.unit, false);
    else if (pk.vehicle && pk.vehicle.faction !== 0) g.orderAttack(sel.filter((a) => a.attackIndex() >= 0), pk.vehicle, false);
    else g.orderFire(sel, pk.world.x, pk.world.y);
    this.markOrder(pk.world.x, pk.world.y, '#ff4d5a');
  }

  markOrder(x, y, color) {
    this.game.fx.rings.push({ x, y, r: 0.1, max: 0.8, life: 0.5, t: 0.5 });
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.pos(e);
    this.r.setZoom(this.r.zoomIdx + (e.deltaY < 0 ? 1 : -1), p.x, p.y);
  }

  /** Direzione di pan in spazio schermo, normalizzata (-1..1 per asse). */
  panVector() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (this.app.settings?.edge && this.r.mouse.inside && this.enabled) {
      const w = this.cv.clientWidth, h = this.cv.clientHeight, m = this.r.mouse;
      if (m.x < 5) x -= 1;
      if (m.x > w - 5) x += 1;
      if (m.y < 5) y -= 1;
      if (m.y > h - 5) y += 1;
    }
    const len = Math.hypot(x, y);
    return len ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  onKey(e, down) {
    if (down && e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (down && !(e.code === 'KeyA' && (e.ctrlKey || e.metaKey))) this.keys.add(e.code); else if (!down) this.keys.delete(e.code);
    if (!down || !this.enabled || !this.game) return;
    const g = this.game;
    const sel = this.selected();
    const code = e.code;
    if (code === 'Escape') { this.app.toggleMenu(); e.preventDefault(); return; }
    if (code === 'Space' || code === 'KeyP') { this.app.togglePause(); e.preventDefault(); return; }
    if (this.app.menuOpen()) return;
    if (code.startsWith('Digit') && code !== 'Digit0') {
      const a = g.agents[+code.slice(5) - 1];
      if (a && a.alive) { if (e.shiftKey) (g.sel.has(a) ? g.sel.delete(a) : g.sel.add(a)); else { g.sel.clear(); g.sel.add(a); } play('click'); }
    } else if (code === 'KeyG' || (code === 'KeyA' && (e.ctrlKey || e.metaKey))) {
      g.sel.clear();
      g.agents.forEach((a) => a.alive && g.sel.add(a));
      play('click');
      e.preventDefault();
    }
    else if (code === 'Tab') {
      e.preventDefault();
      const alive = g.agents.filter((a) => a.alive);
      if (!alive.length) return;
      const cur = sel[0] ? alive.indexOf(sel[0]) : -1;
      g.sel.clear(); g.sel.add(alive[(cur + 1) % alive.length]); play('click');
    } else if (code === 'KeyQ' || code === 'KeyE') {
      for (const a of sel) {
        if (!a.weapons.length) continue;
        a.selectWeapon((a.cur + (code === 'KeyE' ? 1 : a.weapons.length - 1)) % a.weapons.length);
      }
      play('click');
    } else if (code === 'KeyR') { for (const a of sel) g.useMedikit(a); }
    else if (code === 'KeyB') { for (const a of sel) g.plantBomb(a); }
    else if (code === 'KeyX') { g.orderStop(sel); this.app.hud?.flash('STOP'); }
    else if (code === 'KeyZ') { const h = g.toggleHolster(sel); if (h !== undefined) this.app.hud?.flash(h ? 'Armi rinfoderate' : 'Armi in pugno'); }
    else if (code === 'KeyV') {
      const vs = new Set(sel.filter((a) => a.vehicle).map((a) => a.vehicle));
      if (vs.size) vs.forEach((v) => g.exitVehicle(v));
      else {
        const lead = sel[0];
        if (lead) {
          let best = null, bd = 6;
          for (const v of g.vehicles) { if (!v.alive || v.hostile) continue; const d = Math.hypot(v.x - lead.x, v.y - lead.y); if (d < bd) { bd = d; best = v; } }
          if (best) g.orderEnter(sel, best);
        }
      }
    } else if (code === 'KeyC') {
      if (sel.length) {
        const cx = sel.reduce((s, a) => s + a.x, 0) / sel.length, cy = sel.reduce((s, a) => s + a.y, 0) / sel.length;
        this.r.centerOn(cx, cy);
      }
    } else if (code === 'KeyF') { this.app.settings.follow = !this.app.settings.follow; this.app.hud?.flash(this.app.settings.follow ? 'Camera: segui squadra' : 'Camera libera'); }
    else if (code === 'Equal' || code === 'NumpadAdd') this.r.setZoom(this.r.zoomIdx + 1);
    else if (code === 'Minus' || code === 'NumpadSubtract') this.r.setZoom(this.r.zoomIdx - 1);
    else if (code === 'BracketLeft') this.app.setSpeed(Math.max(0.5, this.app.speed - 0.5));
    else if (code === 'BracketRight') this.app.setSpeed(Math.min(3, this.app.speed + 0.5));
    else if (code === 'F1' || code === 'KeyH') { this.app.toggleHelp(); e.preventDefault(); }
  }
}
