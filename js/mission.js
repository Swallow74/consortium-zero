import { generateCity } from './gen.js';
import { setPath } from './ai.js';
import { damage, killUnit, giveWeapon } from './combat.js';
import { play, setAmbient } from './audio.js';

// ---------------------------------------------------------------
// Caricamento missioni modulari: ogni cartella in /missions con mission.json
// ---------------------------------------------------------------
export async function listMissions() {
  const sources = ['missions.php', 'missions/index.json'];
  for (const src of sources) {
    try {
      const r = await fetch(src, { cache: 'no-store' });
      if (!r.ok) continue;
      const txt = await r.text();
      const j = JSON.parse(txt);
      const arr = Array.isArray(j) ? j : j.missions;
      if (Array.isArray(arr)) return arr;
    } catch (e) { /* prova la fonte successiva */ }
  }
  return [];
}

export async function loadMissionDef(folder) {
  const r = await fetch(`missions/${encodeURIComponent(folder)}/mission.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`mission.json non trovato per ${folder}`);
  const def = await r.json();
  def._folder = folder;
  def.id = def.id || folder;
  return def;
}

export async function loadMissionScript(def) {
  if (!def.script) return null;
  try {
    const url = new URL(`../missions/${encodeURIComponent(def._folder)}/${def.script}`, import.meta.url).href;
    const m = await import(url);
    return m.default || m;
  } catch (e) {
    console.error('Script missione non caricato', e);
    return null;
  }
}

export function buildMap(def) {
  const m = def.map || {};
  if (m.ascii) return { ascii: m.ascii, anchors: m.anchors || {} };
  const g = generateCity({ w: 56, h: 56, seed: def.seed ?? 1, ...(m.generate || {}) });
  return { ascii: g.ascii, anchors: { ...g.anchors, ...(m.anchors || {}) } };
}

// ---------------------------------------------------------------
// Stato missione e obiettivi
// ---------------------------------------------------------------
export class MissionState {
  constructor(game, def, script) {
    this.game = game;
    this.def = def;
    this.script = script;
    this.objectives = (def.objectives || []).map((d, i) => this.makeObj(d, i));
    this.timeLimit = def.timeLimit || 0;
    this.winT = 0;
    this.customDone = new Set();
    this.timers = []; // scheduled da ctx.after/ctx.every/dialog
    this.triggers = []; // zone narrative di ctx.trigger
    this.ctx = this.makeCtx();
    this.sequential = !!def.sequential;
  }

  makeObj(d, i) {
    const o = { def: d, idx: i, done: false, failed: false, progress: '', pos: null, pickupTaken: false };
    if (d.at) o.pos = this.game.resolvePos(d.at, { snap: false });
    return o;
  }

  init() { this.script?.init?.(this.ctx); for (const o of this.objectives) if (o.def.type === 'retrieve') { /* nulla */ } }

  makeCtx() {
    const g = this.game;
    const self = this;
    return {
      game: g,
      get time() { return g.t; },
      spawn: (spec) => g.spawnEntity(spec),
      spawnPickup: (spec) => g.spawnPickup(spec),
      pos: (spec) => g.resolvePos(spec),
      say: (text, kind = 'info') => g.toast(text, kind),
      get: (id) => g.byId.get(id),
      units: (f) => g.units.filter((u) => u.alive && (!f || f(u))),
      agents: () => g.agents.filter((a) => a.alive),
      complete: (id) => self.customDone.add(id),
      fail: (reason) => g.finish('lose', reason || 'Missione fallita'),
      win: (reason) => g.finish('win', reason),
      addObjective: (d) => { self.objectives.push(self.makeObj(d, self.objectives.length)); g.toast('Nuovo obiettivo: ' + (d.text || d.type), 'info'); },
      alarm: () => { g.alarm = true; g.addHeat(100, g.agents[0]); },
      explode: (x, y, r = 3) => g.fx.explosion(x, y, r),
      setPath: (u, x, y) => setPath(g, u, x, y),
      damage: (v, amt, src, type = 'bullet') => damage(g, v, amt, src, type),
      // ---- kit narrativo ----
      after: (sec, fn) => self.timers.push({ at: g.t + sec, fn }),
      every: (sec, fn) => self.timers.push({ at: g.t + sec, fn, per: sec }),
      trigger: (at, r, fn) => {
        const p = Array.isArray(at) ? { x: at[0], y: at[1] } : g.resolvePos(at, { snap: false });
        if (!p) { console.warn('trigger: posizione non risolta', at); return; }
        self.triggers.push({ x: p.x, y: p.y, r: r || 2.5, fn });
      },
      dialog: (lines, gap = 2.4) => {
        lines.forEach((ln, i) => {
          const [speaker, text, kind] = Array.isArray(ln) ? ln : [null, ln, 'info'];
          self.timers.push({ at: g.t + 0.1 + i * gap, fn: () => g.toast(speaker ? String(speaker).toUpperCase() + ': ' + text : text, kind || 'info') });
        });
      },
      faction: (u, f) => {
        if (!u || !u.alive) return;
        u.faction = f;
        if (f === 0) {
          u.persuaded = true; // i convinti seguono la squadra (allyAI)
          let best = null, bd = 1e9;
          for (const a of g.agents) if (a.alive) { const d = Math.hypot(a.x - u.x, a.y - u.y); if (d < bd) { bd = d; best = a; } }
          u.owner = best || g.agents[0] || null;
        } else u.persuaded = false;
      },
      kill: (u, src) => { if (u && u.alive) killUnit(g, u, src || null); },
      give: (u, item, ammo) => { if (u && u.alive) giveWeapon(u, item, ammo); },
      heal: (u, n) => { if (u && u.alive) u.hp = Math.min(u.maxHp, u.hp + (n ?? u.maxHp)); },
      remove: (u) => {
        if (!u || (u.kind !== 'vehicle' && g.agents.includes(u))) return;
        const arr = u.kind === 'vehicle' ? g.vehicles : g.units;
        const i = arr.indexOf(u);
        if (i >= 0) arr.splice(i, 1);
        if (u.id) g.byId.delete(u.id);
        g.sel.delete(u);
      },
      speed: (u, v) => { if (u) u.speed = v; },
      weather: (kind) => {
        if (!['clear', 'rain', 'fog'].includes(kind)) return;
        g.weather = kind;
        g.visMul = kind === 'fog' ? 0.7 : kind === 'rain' ? 0.88 : 1;
        if (g.profile?.settings?.weatherFx !== false) setAmbient(kind);
      },
      heat: (n, src) => g.addHeat(n, src || g.agents.find((a) => a.alive) || null),
      lockdown: (on) => { g.policeAlways = !!on; if (on) g.heat = Math.max(g.heat, 100); },
      focus: (x, y) => { if (g._renderer) g._renderer.centerOn(x, y, true); },
      state: (self.state = {}),
    };
  }

  targets(d) {
    const g = this.game;
    if (d.target) return [g.byId.get(d.target)].filter(Boolean);
    if (d.group) return [...g.units, ...g.vehicles].filter((u) => u.group === d.group);
    if (d.tag) return [...g.units, ...g.vehicles].filter((u) => u.tags?.includes(d.tag));
    return [];
  }

  onKill(v, src) { this.script?.onKill?.(this.ctx, v, src); }
  onPersuade(o, a) { this.script?.onPersuade?.(this.ctx, o, a); }
  onPickup(p, u) { this.script?.onPickup?.(this.ctx, p, u); }

  tick(dt) {
    const g = this.game;
    if (g.over) return;
    this.script?.update?.(this.ctx, dt);
    if (g.over) return;
    // scheduler narrativo
    if (this.timers.length) {
      const due = [];
      this.timers = this.timers.filter((t) => {
        if (g.t < t.at) return true;
        due.push(t);
        if (t.per) { t.at = g.t + t.per; return true; }
        return false;
      });
      for (const t of due) {
        try { t.fn(); } catch (e) { console.error('timer di missione:', e); }
        if (g.over) return;
      }
    }
    // zone narrative innescate dall'ingresso degli agenti
    if (this.triggers.length) {
      const aliveA = g.agents.filter((a) => a.alive);
      this.triggers = this.triggers.filter((tr) => {
        if (!aliveA.some((a) => Math.hypot(a.x - tr.x, a.y - tr.y) <= tr.r)) return true;
        try { tr.fn(); } catch (e) { console.error('trigger di missione:', e); }
        return false;
      });
      if (g.over) return;
    }

    // sconfitta: agenti morti
    const alive = g.aliveAgents();
    if (!alive.length) { g.finish('lose', 'Tutti gli agenti sono stati eliminati'); return; }
    if (this.timeLimit && g.t > this.timeLimit) { g.finish('lose', 'Tempo scaduto'); return; }
    if (this.def.maxCivilianCasualties !== undefined && g.stats.civKills > this.def.maxCivilianCasualties) { g.finish('lose', 'Troppe vittime civili'); return; }

    let activeIdx = -1;
    for (const o of this.objectives) {
      if (o.done || o.failed) continue;
      if (this.sequential) {
        if (activeIdx === -1) activeIdx = o.idx;
        else { o.active = false; continue; }
      }
      o.active = true;
      this.evaluate(o);
      if (g.over) return;
      if (o.done) {
        g.toast('Obiettivo completato: ' + (o.def.text || o.def.type), 'good');
        play('complete');
        this.script?.onObjective?.(this.ctx, o);
      }
    }
    const req = this.objectives.filter((o) => !o.def.optional);
    if (req.length && req.every((o) => o.done)) {
      this.winT += dt;
      if (this.winT > 1.2) g.finish('win', 'Obiettivi completati');
    } else if (!req.length && this.script?.won?.(this.ctx)) g.finish('win', 'Completata');
  }

  evaluate(o) {
    const g = this.game, d = o.def;
    const alive = g.aliveAgents();
    switch (d.type) {
      case 'kill': {
        const ts = this.targets(d);
        const left = ts.filter((t) => t.alive).length;
        o.progress = ts.length > 1 ? `${ts.length - left}/${ts.length}` : '';
        if (left === 0) o.done = true;
        break;
      }
      case 'persuade': {
        const ts = this.targets(d);
        const dead = ts.filter((t) => !t.alive && !t.persuaded).length;
        const ok = ts.filter((t) => t.alive && t.persuaded).length;
        o.progress = ts.length > 1 ? `${ok}/${ts.length}` : '';
        if (dead && !d.optional) { o.failed = true; g.finish('lose', 'Il bersaglio da persuadere è morto'); }
        else if (ok === ts.length && ts.length) o.done = true;
        break;
      }
      case 'eliminate': {
        let pool;
        if (d.group) pool = g.units.filter((u) => u.group === d.group);
        else pool = g.units.filter((u) => (d.faction === 'police' ? u.origFaction === 2 : d.faction === 'civilian' ? u.origFaction === 3 : u.origFaction === 1));
        const tot = pool.length;
        const left = pool.filter((u) => u.alive && !u.persuaded).length;
        o.progress = `${tot - left}/${tot}`;
        if (left === 0) o.done = true;
        break;
      }
      case 'reach': {
        if (!o.pos) { o.done = true; break; }
        // consegne a tappe: bisogna passare dai punti `via` IN ORDINE prima della meta
        if (d.via) {
          o.vias ||= d.via.map((v) => g.resolvePos(v, { snap: false })).filter(Boolean);
          o._viaI ||= 0;
          if (o._viaI < o.vias.length) {
            const vp = o.vias[o._viaI];
            const hit = alive.some((a) => Math.hypot(a.x - vp.x, a.y - vp.y) <= 2.4);
            if (hit) {
              o._viaI++;
              g.toast(`Consegna ${o._viaI}/${o.vias.length} completata`, 'good');
              play('complete');
            }
            o.progress = `tappa ${Math.min(o._viaI + 1, o.vias.length)}/${o.vias.length}`;
            break;
          }
        }
        // l'estrazione (reach semplice) scatta solo dopo gli altri obiettivi obbligatori
        // (salvo "early": true; i `reach` con via si auto-ordinano e non si bloccano a vicenda)
        if (!d.via && !d.early && this.objectives.some((q) => q !== o && !q.def.optional && !q.done && !(q.def.type === 'reach' && !q.def.via))) { o.progress = ''; break; }
        const r = d.radius || 3;
        const inside = alive.filter((a) => Math.hypot(a.x - o.pos.x, a.y - o.pos.y) <= r);
        const ok = d.all === false ? inside.length > 0 : inside.length === alive.length && alive.length > 0;
        o.progress = d.all === false ? '' : `${inside.length}/${alive.length}`;
        if (ok) { o.done = true; o.progress = ''; }
        break;
      }
      case 'board': {
        const v = this.targets(d).find((t) => t.alive && t.kind === 'vehicle');
        if (!v) {
          if (!d.optional) { o.failed = true; g.finish('lose', 'Il mezzo da usare è distrutto'); }
          break;
        }
        o.progress = '';
        if (g.agents.some((a) => a.alive && a.vehicle === v)) o.done = true;
        break;
      }
      case 'retrieve': {
        const held = alive.some((a) => a.carrying.some((c) => c.id === d.item || c.item === d.item));
        const pk = g.byId.get(d.item);
        if (d.deliver) {
          const p = (o.dpos ||= g.resolvePos(d.deliver, { snap: false }));
          o.progress = held ? 'in possesso' : 'da recuperare';
          if (held && p && alive.some((a) => a.carrying.some((c) => c.id === d.item) && Math.hypot(a.x - p.x, a.y - p.y) <= (d.radius || 3))) o.done = true;
        } else if (held) o.done = true;
        if (!held && pk === undefined) { /* elemento mancante */ }
        break;
      }
      case 'destroy': {
        const ts = this.targets(d);
        const left = ts.filter((t) => t.alive).length;
        o.progress = ts.length > 1 ? `${ts.length - left}/${ts.length}` : '';
        if (left === 0) o.done = true;
        break;
      }
      case 'escort': {
        const t = g.byId.get(d.target);
        if (!t || !t.alive) { o.failed = true; g.finish('lose', 'Il VIP da scortare è morto'); break; }
        if (!t.persuaded) { o.progress = 'persuadilo'; break; }
        const p = o.pos;
        o.progress = '';
        if (p && Math.hypot(t.x - p.x, t.y - p.y) <= (d.radius || 3)) o.done = true;
        break;
      }
      case 'survive': {
        const left = Math.max(0, d.seconds - g.t);
        o.progress = Math.ceil(left) + 's';
        if (left <= 0) o.done = true;
        break;
      }
      case 'custom':
        if (this.customDone.has(d.id)) o.done = true;
        break;
    }
  }

  /** Posizioni da evidenziare nel mondo (marker obiettivo). */
  markers() {
    const g = this.game;
    const m = [];
    for (const o of this.objectives) {
      if (o.done || o.failed || o.active === false) continue;
      const d = o.def;
      if (d.type === 'kill' || d.type === 'persuade' || d.type === 'destroy') for (const t of this.targets(d)) if (t.alive) m.push({ x: t.x, y: t.y, kind: 'target', obj: o });
      if (d.type === 'escort') { const t = g.byId.get(d.target); if (t?.alive && !t.persuaded) m.push({ x: t.x, y: t.y, kind: 'target', obj: o }); if (o.pos && t?.persuaded) m.push({ x: o.pos.x, y: o.pos.y, kind: 'zone', r: d.radius || 3, obj: o }); }
      if (d.type === 'reach' && o.pos) m.push({ x: o.pos.x, y: o.pos.y, kind: 'zone', r: d.radius || 3, obj: o });
      if (d.type === 'reach' && d.via) {
        o.vias ||= d.via.map((v) => g.resolvePos(v, { snap: false })).filter(Boolean);
        const vp = o.vias[o._viaI || 0];
        if (vp) m.push({ x: vp.x, y: vp.y, kind: 'zone', r: 2, obj: o });
      }
      if (d.type === 'board') { const tv = this.targets(d).find((v) => v.alive); if (tv) m.push({ x: tv.x, y: tv.y, kind: 'target', obj: o }); }
      if (d.type === 'retrieve') {
        const pk = g.pickups.find((p) => p.id === d.item);
        if (pk) m.push({ x: pk.x, y: pk.y, kind: 'item', obj: o });
        else if (d.deliver) { const p = (o.dpos ||= g.resolvePos(d.deliver, { snap: false })); if (p) m.push({ x: p.x, y: p.y, kind: 'zone', r: d.radius || 3, obj: o }); }
      }
    }
    return m;
  }
}
