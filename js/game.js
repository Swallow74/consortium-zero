import { WEAPONS, KINDS, OFFENSIVE } from './data.js';
import { GameMap, T, DIR_V } from './map.js';
import { Unit, Vehicle, Pickup, mkWeapon } from './units.js';
import { Fx } from './fx.js';
import { findPath, findRoadPath, opposite } from './path.js';
import { updateAgent, updateNPC, setPath, ensureAI, alertTo, drawn } from './ai.js';
import { damage, explode, giveWeapon, killUnit, destroyVehicle, useMedikit, plantBomb, persuade, rayHit } from './combat.js';
import { play, setIntensity } from './audio.js';
import { rng as mkRng, clamp, rand, TAU, gauss } from './util.js';
import { MissionState } from './mission.js';
import { resolveTheme } from './themes.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Game {
  constructor(def, profile, mapData, script) {
    this.def = def;
    this.profile = profile;
    this.anchors = mapData.anchors || {};
    this.map = new GameMap(mapData.ascii);
    this.rnd = mkRng((def.seed ?? 7) + 99);
    this.units = [];
    this.vehicles = [];
    this.pickups = [];
    this.bombs = [];
    this.projectiles = [];
    this.fx = new Fx();
    this.byId = new Map();
    this.t = 0;
    this.heat = 0; this.heatT = 0; this.heatWarned = false;
    this.alarm = false;
    this.stats = { kills: 0, civKills: 0, agentsLost: 0, shots: 0, vehiclesDestroyed: 0, persuadedLost: 0 };
    this.sel = new Set();
    this.agents = [];
    this.over = null;
    this.paused = false;
    this.messages = [];
    this.mem = { 1: new Map(), 2: new Map(), 0: new Map() };
    this.listener = { x: 0, y: 0 };
    this.tickT = 0; this.gateT = 0; this.sepT = 0;
    this.policeCool = new Map();
    this.coverRes = new Map();
    this.dispatchT = 12;
    this.heatSrc = null;
    this.theme = resolveTheme(def);
    this.weather = def.weather || this.theme.weather || 'rain';
    this.visMul = this.weather === 'fog' ? 0.7 : this.weather === 'rain' ? 0.88 : 1;
    this.policeAlways = !!def.policeHostile;
    if (this.policeAlways) this.heat = 100;
    this.traffic = { target: def.traffic ?? 10, t: 0 };
    this.roadTiles = [];
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) if (this.map.kind[y * this.map.w + x] === T.ROAD && this.map.rd[y * this.map.w + x] >= 1 && this.map.rd[y * this.map.w + x] <= 4) this.roadTiles.push([x, y]);
    this.gateTiles = [];
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) if (this.map.kind[y * this.map.w + x] === T.GATE) this.gateTiles.push([x, y]);

    // posizione di partenza
    const startSpec = def.start || { anchor: 'spawn' };
    this.start = this.resolvePos(startSpec) || { x: 3.5, y: 3.5 };
    this.map.computeReach(this.start.x, this.start.y);
    this.spawnAgents();
    for (const e of def.entities || []) this.spawnEntity(e);
    for (const p of def.pickups || []) this.spawnPickup(p);
    this.waves = (def.waves || []).map((w) => ({ ...w, fired: false }));
    this.mission = new MissionState(this, def, script);
    this.mission.init();
    const n = this.traffic.target;
    for (let i = 0; i < n; i++) this.spawnTraffic(true);
  }

  // ------------- posizioni -------------
  resolvePos(spec, o = {}) {
    if (!spec) return null;
    const snap = o.snap !== false;
    const fix = (x, y) => {
      if (!snap) return { x, y };
      const n = this.map.nearestWalk(Math.floor(x), Math.floor(y), 8);
      if (!n) return { x, y };
      if (Math.floor(x) === n[0] && Math.floor(y) === n[1]) return { x, y };
      return { x: n[0] + 0.5, y: n[1] + 0.5 };
    };
    if (Array.isArray(spec)) return fix(spec[0] + 0.5, spec[1] + 0.5);
    if (spec.anchor) {
      const a = this.anchors[spec.anchor];
      if (!a) { console.warn('ancora mancante', spec.anchor); return null; }
      return fix(a[0] + 0.5 + (spec.dx || 0), a[1] + 0.5 + (spec.dy || 0));
    }
    if (spec.rect) {
      const [x0, y0, x1, y1] = spec.rect;
      const t = this.map.randomTile(this.rnd, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && (!o.noRoad || this.map.k(x, y) !== T.ROAD));
      return t ? { x: t[0] + 0.5, y: t[1] + 0.5 } : null;
    }
    if (spec.random) {
      const near = spec.near ? this.resolvePos(spec.near) : null;
      const rad = spec.radius || 8;
      const kinds = { pave: [T.PAVE], plaza: [T.PLAZA, T.PAD], grass: [T.GRASS], road: [T.ROAD], any: null }[spec.random] || null;
      const t = this.map.randomTile(this.rnd, (x, y) => (!kinds || kinds.includes(this.map.k(x, y))) && (!near || Math.hypot(x - near.x, y - near.y) < rad) && (!o.minFrom || Math.hypot(x - o.minFrom.x, y - o.minFrom.y) > (o.minDist || 10)), 800);
      return t ? { x: t[0] + 0.5, y: t[1] + 0.5 } : null;
    }
    if (spec.x !== undefined) return fix(spec.x, spec.y);
    return null;
  }

  // ------------- spawn -------------
  spawnAgents() {
    const team = this.profile.agents.filter((a) => a.alive).slice(0, 4);
    const offs = [[0, 0], [1, 0], [0, -1], [1, -1], [2, 0], [0, 1], [1, 1], [2, -1]];
    const used = new Set();
    team.forEach((a, i) => {
      let p = null;
      for (const [ox, oy] of offs) {
        const tx = Math.floor(this.start.x) + ox, ty = Math.floor(this.start.y) + oy;
        if (this.map.walk(tx, ty) && !used.has(tx + ',' + ty)) { p = [tx, ty]; break; }
      }
      p ||= this.map.nearestWalk(Math.floor(this.start.x), Math.floor(this.start.y), 4) || [Math.floor(this.start.x), Math.floor(this.start.y)];
      used.add(p[0] + ',' + p[1]);
      const u = new Unit('agent', p[0] + 0.5, p[1] + 0.5, { name: a.name, mods: a.mods, weapons: a.loadout, id: 'agent' + i, dir: 0.8 });
      u.profileRef = a;
      u.ipa = { a: { t: a.ipa?.a ?? 50, e: a.ipa?.a ?? 50 }, p: { t: a.ipa?.p ?? 50, e: a.ipa?.p ?? 50 }, i: { t: a.ipa?.i ?? 50, e: a.ipa?.i ?? 50 } };
      u.recomputeStats();
      u.hp = u.maxHp;
      if (u.has('shield')) u.shield = 150;
      u.selectWeapon(Math.max(0, u.weapons.findIndex((w) => OFFENSIVE.has(WEAPONS[w.id]?.type))));
      this.addUnit(u);
      this.agents.push(u);
      this.sel.add(u);
    });
  }

  addUnit(u) {
    this.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  spawnPickup(p) {
    const pos = this.resolvePos(p.at || p);
    if (!pos) return null;
    const pk = new Pickup(p.item, pos.x, pos.y, { id: p.id, ammo: p.ammo, quest: p.quest, label: p.label });
    this.pickups.push(pk);
    this.byId.set(pk.id, pk);
    return pk;
  }

  spawnEntity(e) {
    const count = e.count ?? 1;
    const out = [];
    const isVeh = e.kind === 'vehicle';
    for (let i = 0; i < count; i++) {
      let pos = null;
      for (let tries = 0; tries < 12 && !pos; tries++) {
        if (e.at) {
          pos = this.resolvePos(e.at);
          if (pos && (e.spread || count > 1)) {
            const sp = e.spread ?? 2.5;
            const n = this.map.nearestWalk(Math.floor(pos.x + rand(-sp, sp)), Math.floor(pos.y + rand(-sp, sp)), 3);
            pos = n ? { x: n[0] + 0.5, y: n[1] + 0.5 } : pos;
          }
        } else if (e.area && Array.isArray(e.area)) pos = this.resolvePos({ rect: e.area });
        else pos = this.resolvePos({ random: e.zone || 'pave' }, { minFrom: this.start, minDist: e.minDist ?? 12 });
        if (pos && !isVeh && this.map.reach && !this.map.reach[Math.floor(pos.y) * this.map.w + Math.floor(pos.x)]) pos = null;
        if (pos && !e.at && Math.hypot(pos.x - this.start.x, pos.y - this.start.y) < (e.minDist ?? 12)) pos = null;
      }
      if (!pos) continue;
      let ent;
      const id = e.id ? (count > 1 ? `${e.id}_${i + 1}` : e.id) : undefined;
      if (isVeh) {
        let t = null;
        for (let r = 0; r < 10 && !t; r++) for (let dy = -r; dy <= r && !t; dy++) for (let dx = -r; dx <= r && !t; dx++) if (this.map.isRoad(Math.floor(pos.x) + dx, Math.floor(pos.y) + dy)) t = [Math.floor(pos.x) + dx, Math.floor(pos.y) + dy];
        if (!t) continue;
        const d = this.map.rdAt(t[0], t[1]);
        ent = new Vehicle(e.type || 'car', t[0] + 0.5, t[1] + 0.5, { id, heading: e.heading || (d >= 1 && d <= 4 ? d : 1), hp: e.hp, color: e.color, hostile: e.hostile, faction: e.faction ?? (e.hostile ? 1 : 3), group: e.group, tags: e.tags });
        ent.parked = !!e.parked || !!e.route;
        if (e.route) ent.route = e.route.map((s) => this.resolvePos(s)).filter(Boolean);
        ent.traffic = !!e.traffic;
        ent.keep = true;
        this.vehicles.push(ent);
      } else {
        const weapons = e.weapons || (e.weapon ? [e.weapon] : undefined);
        let patrol = e.patrol;
        if (Array.isArray(patrol)) patrol = patrol.map((s) => this.resolvePos(s)).filter(Boolean);
        ent = new Unit(e.kind, pos.x, pos.y, { id, name: e.name, hp: e.hp, weapons, ai: e.ai, vision: e.vision, patrol, persuadable: e.persuadable, persuadeCost: e.persuadeCost, group: e.group, tags: e.tags, speed: e.speed, color: e.color, faction: e.faction, dir: e.dir });
        if (e.kind === 'vip' && e.persuadable === undefined) ent.persuadable = false;
        this.addUnit(ent);
      }
      if (ent.id) this.byId.set(ent.id, ent);
      out.push(ent);
    }
    return out;
  }

  spawnTraffic(initial = false) {
    if (!this.roadTiles.length) return;
    for (let k = 0; k < 20; k++) {
      const [x, y] = this.roadTiles[Math.floor(this.rnd() * this.roadTiles.length)];
      const far = this.agents.every((a) => !a.alive || Math.hypot(a.x - x, a.y - y) > (initial ? 8 : 16));
      if (!far) continue;
      if (this.vehicles.some((v) => v.alive && Math.hypot(v.x - x - 0.5, v.y - y - 0.5) < 3)) continue;
      const d = this.map.rd[y * this.map.w + x];
      const type = this.rnd() < 0.2 ? 'van' : 'car';
      const v = new Vehicle(type, x + 0.5, y + 0.5, { heading: d, traffic: true });
      this.vehicles.push(v);
      return v;
    }
  }

  // ------------- query -------------
  hostile(a, b) {
    if (a.faction === b.faction || !b.alive) return false;
    if (a.faction === 3 || b.faction === 3) return false;
    if (a.faction === 0) return b.faction === 1 || (b.faction === 2 && this.heat > 0);
    if (a.faction === 1) return b.faction === 0;
    if (a.faction === 2) return b.faction === 0 && this.heat > 0;
    return false;
  }

  nearestAgent(x, y) {
    let best = null, bd = 1e9;
    for (const a of this.agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  aliveAgents() { return this.agents.filter((a) => a.alive); }
  persuadeCapacity() { return this.aliveAgents().reduce((s, a) => s + a.persuadeCap(), 0) / 2; }
  persuadeUsed() { return this.units.reduce((s, u) => s + (u.alive && u.persuaded ? u.persuadeCost : 0), 0); }

  soundGain(x, y) {
    const d = Math.hypot(x - this.listener.x, y - this.listener.y);
    return clamp(1.15 - d / 38, 0.06, 1);
  }
  /** Effetto sonoro posizionale: volume per distanza, panning per posizione orizzontale sullo schermo. */
  sfx(name, x, y, mul = 1) {
    const pan = clamp(((x - y) - (this.listener.x - this.listener.y)) / 22, -0.85, 0.85);
    play(name, this.soundGain(x, y) * mul, pan);
  }

  toast(msg, kind = 'info') {
    this.msgId = (this.msgId || 0) + 1;
    this.messages.push({ msg, kind, t: this.t, id: this.msgId });
    if (this.messages.length > 10) this.messages.shift();
  }

  // ------------- movimento -------------
  tryMove(u, nx, ny) {
    const r = 0.26;
    const m = this.map;
    if (!m.free(u.x, u.y, r)) {
      const n = m.nearestWalk(Math.floor(u.x), Math.floor(u.y), 3);
      if (n) { u.x += (n[0] + 0.5 - u.x) * 0.25; u.y += (n[1] + 0.5 - u.y) * 0.25; }
    }
    if (m.free(nx, u.y, r)) u.x = nx;
    if (m.free(u.x, ny, r)) u.y = ny;
  }

  separate() {
    // griglia a celle da 2 tile: ogni coppia a distanza < 0.5 ricade nella stessa
    // cella o in celle adiacenti; si visita solo meta' degli offset per non
    // processare due volte la stessa coppia (prima era O(n^2) su tutte le unita')
    const CS = 2, W = 4096;
    const cells = new Map();
    const list = [];
    for (const a of this.units) {
      if (!a.alive || a.vehicle) continue;
      const cx = Math.floor(a.x / CS), cy = Math.floor(a.y / CS);
      a._scx = cx; a._scy = cy; a._si = list.length;
      list.push(a);
      const k = cx * W + cy;
      let arr = cells.get(k);
      if (!arr) cells.set(k, arr = []);
      arr.push(a);
    }
    const NEIGH = [[1, 0], [1, 1], [0, 1], [1, -1]];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let o = -1; o < NEIGH.length; o++) {
        let arr;
        if (o < 0) arr = cells.get(a._scx * W + a._scy);
        else arr = cells.get((a._scx + NEIGH[o][0]) * W + (a._scy + NEIGH[o][1]));
        if (!arr) continue;
        for (const b of arr) {
          if (b._si <= i) continue;
          const dx = b.x - a.x;
          if (dx > 0.5 || dx < -0.5) continue;
          const dy = b.y - a.y;
          if (dy > 0.5 || dy < -0.5) continue;
          const d = Math.hypot(dx, dy);
          if (d >= 0.5 || d < 0.001) continue;
          const push = (0.5 - d) * 0.35;
          const px = (dx / d) * push, py = (dy / d) * push;
          this.tryMove(a, a.x - px, a.y - py);
          this.tryMove(b, b.x + px, b.y + py);
        }
      }
    }
  }

  // ------------- ordini -------------
  formation(n, x, y) {
    const o = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const res = [];
    for (let i = 0; i < n; i++) {
      const [ox, oy] = o[i] || [0, 0];
      const tx = x + ox * 0.9, ty = y + oy * 0.9;
      res.push(this.map.walk(Math.floor(tx), Math.floor(ty)) ? { x: tx, y: ty } : { x, y });
    }
    return res;
  }

  _give(u, order, queue) {
    if (queue && u.order) u.queue.push(order);
    else { u.order = order; u.queue = []; u.path = null; u.repaths = 0; }
  }

  orderMove(units, x, y, queue = false) {
    units = units.filter((u) => u.alive);
    if (!units.length) return;
    const inV = units.filter((u) => u.vehicle);
    const vs = new Set(inV.map((u) => u.vehicle));
    for (const v of vs) this.driveTo(v, x, y);
    const out = units.filter((u) => !u.vehicle);
    const f = this.formation(out.length, x, y);
    out.forEach((u, i) => this._give(u, { type: 'move', x: f[i].x, y: f[i].y }, queue));
  }
  orderAttack(units, target, queue = false) {
    for (const u of units) if (u.alive && !u.vehicle) this._give(u, { type: 'attack', target }, queue);
  }
  orderPersuade(units, target, queue = false) {
    for (const u of units) if (u.alive && !u.vehicle && u.has('persuadertron')) this._give(u, { type: 'persuade', target }, queue);
  }
  orderEnter(units, v, queue = false) {
    for (const u of units) if (u.alive && !u.vehicle) this._give(u, { type: 'enter', target: v }, queue);
  }
  orderFire(units, x, y) {
    for (const u of units) if (u.alive && !u.vehicle && u.attackIndex() >= 0) this._give(u, { type: 'fire', x, y, t: 0.7 }, false);
  }
  orderStop(units) {
    for (const u of units) if (u.alive && !u.vehicle) { u.order = { type: 'hold' }; u.queue = []; u.path = null; }
    for (const v of new Set(units.filter((u) => u.vehicle).map((u) => u.vehicle))) v.path = null;
  }

  // ------------- veicoli -------------
  enterVehicle(u, v) {
    if (!v.alive || v.passengers.length >= v.V.seats || u.vehicle) return false;
    u.vehicle = v;
    u.path = null; u.order = null; u.queue = [];
    v.passengers.push(u);
    v.player = true;
    v.parked = false;
    v.faction = 0;
    v.traffic = false;
    v.path = null;
    this.fx.text(v.x, v.y, 'A BORDO', '#5fe3ff');
    play('click');
    return true;
  }

  exitVehicle(v) {
    const ps = [...v.passengers];
    v.passengers = [];
    ps.forEach((u, i) => {
      u.vehicle = null;
      const a = (i / Math.max(1, ps.length)) * TAU;
      const n = this.map.nearestWalk(Math.floor(v.x + Math.cos(a) * 1.4), Math.floor(v.y + Math.sin(a) * 1.4), 4);
      if (n) { u.x = n[0] + 0.5; u.y = n[1] + 0.5; }
    });
    v.player = false;
    v.parked = true;
    v.path = null;
  }

  driveTo(v, x, y) {
    if (!v.alive) return;
    const sx = v.nx !== null && v.nx !== undefined ? v.nx : v.x, sy = v.ny !== null && v.ny !== undefined ? v.ny : v.y;
    const p = findRoadPath(this.map, sx, sy, x, y, v.heading);
    if (p) { v.path = p; v.pi = 0; v.parked = false; if (v.nx === null || v.nx === undefined) v.nx = undefined; }
    else this.fx.text(v.x, v.y, 'NESSUN PERCORSO', '#ff8a8a');
  }

  updateVehicle(v, dt) {
    if (!v.alive) {
      // i relitti si raffreddano: dopo un po' spariscono, la citta' non si riempie di ferraglia
      if (v.wreck && this.t - (v.deadT ?? 0) > 42) { v.gone = true; return; }
      if (Math.random() < dt * 6) this.fx.smoke(v.x + rand(-0.3, 0.3), v.y + rand(-0.3, 0.3), 0.5, rand(5, 9), 1.5);
      if (Math.random() < dt * 4) this.fx.fire(v.x + rand(-0.3, 0.3), v.y + rand(-0.3, 0.3), 0.4, rand(4, 8));
      return;
    }
    v.flash = Math.max(0, v.flash - dt);
    v.engageT = Math.max(0, (v.engageT || 0) - dt);
    v.panicT = Math.max(0, (v.panicT || 0) - dt);
    if (v.hostile && !v.player && (v.type === 'armored' || v.armed)) this.vehicleTurret(v, dt);
    if (v.dispatch) {
      if (Math.random() < dt * 0.8) this.sfx('siren', v.x, v.y, 0.8);
      const d = v.dispatch;
      if (Math.hypot(v.x - d.x, v.y - d.y) < 7 || (!v.path && v.speed < 0.2)) { this.unloadPolice(v); return; }
    }
    if (v.burn) {
      v.hp -= 12 * dt;
      if (Math.random() < dt * 8) this.fx.fire(v.x, v.y, 0.6, 6);
      if (v.hp <= 0) { destroyVehicle(this, v, null); return; }
    }
    const map = this.map;
    if (v.parked && !v.player && !v.path) {
      if (v.route && v.route.length) { // pattuglia su tragitto: obiettivo = v.routeI, avanzato solo a fine tratta
        const r = v.route[v.routeI || 0];
        const p = findRoadPath(map, v.x, v.y, r.x, r.y, v.heading);
        if (p) { v.path = p; v.pi = 0; v.parked = false; }
      }
      v.speed = Math.max(0, v.speed - dt * 10);
      return;
    }
    // prossimo tile
    if (v.nx === null || v.nx === undefined) {
      const tx = Math.floor(v.x), ty = Math.floor(v.y);
      let nd = 0;
      if (v.path && v.pi < v.path.length) {
        let p = v.path[v.pi];
        while (p && Math.floor(p.x) === tx && Math.floor(p.y) === ty) { v.pi++; p = v.path[v.pi]; }
        if (p) {
          const dx = Math.floor(p.x) - tx, dy = Math.floor(p.y) - ty;
          nd = dx === 1 ? 1 : dx === -1 ? 2 : dy === 1 ? 3 : dy === -1 ? 4 : 0;
        }
      } else if (v.path) {
        v.path = null;
        if (v.route && v.route.length && !v.dispatch && !v.player) v.routeI = ((v.routeI || 0) + 1) % v.route.length;
        if (v.dispatch) { this.unloadPolice(v); return; }
        if (v.player || !v.traffic) { v.parked = true; v.speed = Math.max(0, v.speed - dt * 10); return; }
      }
      if (!nd && (v.traffic || (!v.player && !v.path && !v.parked))) {
        const d = map.rdAt(tx, ty);
        const occ = (mx, my) => this.vehicles.some((o) => o !== v && o.alive && Math.hypot(o.x - (mx + 0.5), o.y - (my + 0.5)) < 0.6);
        // si può parcheggiare l'intera manovra: oltre la giunzione deve esserci una corsia
        // libera nel verso giusto, altrimenti la coda si incastra dentro gli X
        const boxFree = (cx, cy, dd, depth) => {
          if (!map.isRoad(cx, cy) || occ(cx, cy)) return false;
          const r = map.rdAt(cx, cy);
          if (r !== 5) return r === dd;
          if (depth <= 0) return false;
          for (const d2 of [1, 2, 3, 4]) {
            if (d2 === opposite(dd) && map.rdAt(cx + DIR_V[d2][0], cy + DIR_V[d2][1]) !== 5) continue;
            if (boxFree(cx + DIR_V[d2][0], cy + DIR_V[d2][1], d2, depth - 1)) return true;
          }
          return false;
        };
        const dirs = (d === 5 || d === 0 ? [1, 2, 3, 4] : [d]).filter((dd) => {
          if (dd === opposite(v.heading)) return false; // niente inversioni: mai contromano
          const nx = tx + DIR_V[dd][0], ny = ty + DIR_V[dd][1];
          return map.isRoad(nx, ny) && boxFree(nx, ny, dd, 4);
        });
        if (dirs.length) nd = dirs.includes(v.heading) && Math.random() < 0.7 ? v.heading : dirs[Math.floor(Math.random() * dirs.length)];
        else {
          // nessun sbocco libero: se la strada continua è solo coda (aspetta); moncone → sparisce
          const stradaContinua = (d === 5 || d === 0 ? [1, 2, 3, 4] : [d]).some((dd) => {
            const nx = tx + DIR_V[dd][0], ny = ty + DIR_V[dd][1];
            return map.isRoad(nx, ny) && !(map.rdAt(nx, ny) && map.rdAt(nx, ny) !== 5 && map.rdAt(nx, ny) === opposite(dd));
          });
          if (v.traffic && !stradaContinua) { v.alive = false; v.gone = true; return; }
          v.speed = Math.max(0, v.speed - dt * 10); // in coda: aspetta che la tile davanti si liberi
          return;
        }
      }
      if (nd) { v.heading = nd; v.nx = tx + 0.5 + DIR_V[nd][0]; v.ny = ty + 0.5 + DIR_V[nd][1]; }
      else { v.speed = Math.max(0, v.speed - dt * 10); return; }
    }
    // ostacoli davanti
    const hv = DIR_V[v.heading];
    let block = false;
    const look = 1.2 + v.speed * 0.28;
    for (const u of this.units) {
      if (!u.alive || u.vehicle) continue;
      const rx = u.x - v.x, ry = u.y - v.y;
      const f = rx * hv[0] + ry * hv[1], l = Math.abs(rx * hv[1] - ry * hv[0]);
      if (f > 0.3 && f < look + 0.5 && l < 0.8) {
        if (v.player && u.faction !== 0 && v.speed > 1.8) {
          damage(this, u, 90, v.passengers[0] || null, 'bullet');
          this.fx.blood(u.x, u.y, 6);
          continue; // investito: non frena
        }
        // gli NPC si scansano dai veicoli: forza superiore alla loro andatura,
        // altrimenti un poliziotto in servizio ingessa la coda per sempre
        if (!this.agents.includes(u)) {
          const sgn = rx * hv[1] - ry * hv[0] < 0 ? -1 : 1;
          const px = u.x + hv[1] * sgn * 5.5 * dt, py = u.y - hv[0] * sgn * 5.5 * dt;
          if (this.map.walk(Math.floor(px), Math.floor(py))) {
            u.x = px; u.y = py;
            u.shoveT = 0.4; // l'IA resta ferma: altrimenti un passo la rimette in coda
          }
        }
      }
      if (f > 0.3 && f < look && l < 0.55) block = true;
    }
    for (const o of this.vehicles) {
      if (o === v || !o.alive) continue;
      const rx = o.x - v.x, ry = o.y - v.y;
      const f = rx * hv[0] + ry * hv[1], l = Math.abs(rx * hv[1] - ry * hv[0]);
      if (f > 0.2 && f < look + 0.2 && l < 0.6) block = true;
    }
    const target = block ? 0 : v.maxSpeed * (v.traffic ? (v.panicT > 0 ? 1.1 : 0.65) : 1) * (v.engageT > 0 && !v.player ? 0.35 : 1) * (v.dispatch ? 1.15 : 1);
    v.speed += clamp(target - v.speed, -dt * 14, dt * 5);
    if (v.traffic && v.speed < 0.1 && v.nx !== null && v.nx !== undefined) {
      // disincaglio: se resta fermo a bersaglio impegnato, rinuncia e rivaluta la direzione
      v.stuckT = (v.stuckT || 0) + dt;
      if (v.stuckT > 2.5) { v.nx = v.ny = null; v.stuckT = 0; return; }
    } else v.stuckT = 0;
    const step = v.speed * dt;
    const dx = v.nx - v.x, dy = v.ny - v.y;
    const dd = Math.hypot(dx, dy);
    if (dd <= step) {
      v.x = v.nx; v.y = v.ny; v.nx = null; v.ny = null;
    } else if (step > 0) {
      v.x += (dx / dd) * step;
      v.y += (dy / dd) * step;
    }
    for (const p of v.passengers) { p.x = v.x; p.y = v.y; }
    if (v.speed > 2 && Math.random() < dt * 0.6) this.sfx('car', v.x, v.y);
  }

  // ------------- eventi -------------
  addHeat(n, src) {
    if (src) this.heatSrc = { x: src.x, y: src.y };
    if (this.policeAlways) return;
    const was = this.heat;
    this.heat = Math.min(100, this.heat + n);
    this.heatT = 14;
    if (was <= 0) this.dispatchT = 16;
    if (!this.heatWarned && this.heat > 0) { this.heatWarned = true; this.toast('Polizia allertata!', 'bad'); play('alarm'); }
    if (was < 50 && this.heat >= 50) this.toast('Allarme polizia: arrivano le volanti', 'bad');
    if (was < 90 && this.heat >= 90) this.toast('Massima allerta: unità tattiche in arrivo', 'bad');
    if (!src) return;
    for (const p of this.units) {
      if (!p.alive || p.faction !== 2 || p.persuaded) continue;
      if (Math.hypot(p.x - src.x, p.y - src.y) > 28) continue;
      if (p.ai?.state === 'warn') p.ai.state = 'idle';
      alertTo(this, p, src.x, src.y, 10);
    }
  }

  /** Volante di rinforzo: parte da una strada lontana, raggiunge l'ultima posizione nota e sbarca gli agenti. */
  dispatchPolice(lvl) {
    const tgt = this.heatSrc || this.nearestAgent(this.start.x, this.start.y);
    if (!tgt || !this.roadTiles.length) return;
    for (let k = 0; k < 40; k++) {
      const [x, y] = this.roadTiles[Math.floor(this.rnd() * this.roadTiles.length)];
      const d = Math.hypot(x - tgt.x, y - tgt.y);
      if (d < 18 || d > 45) continue;
      if (this.agents.some((a) => a.alive && Math.hypot(a.x - x, a.y - y) < 14)) continue;
      if (this.vehicles.some((v) => v.alive && Math.hypot(v.x - x - 0.5, v.y - y - 0.5) < 3)) continue;
      const v = new Vehicle('police', x + 0.5, y + 0.5, { heading: this.map.rd[y * this.map.w + x], faction: 2 });
      const p = findRoadPath(this.map, v.x, v.y, tgt.x, tgt.y, v.heading);
      if (!p) continue;
      v.path = p; v.pi = 0; v.parked = false;
      v.dispatch = { lvl, n: lvl >= 3 ? 3 : 2, x: tgt.x, y: tgt.y };
      v.keep = true;
      this.vehicles.push(v);
      return v;
    }
  }

  unloadPolice(v) {
    const d = v.dispatch;
    v.dispatch = null;
    v.parked = true; v.path = null;
    const weapons = d.lvl >= 3 ? [['uzi'], ['shotgun'], ['uzi', 'medikit']] : [['pistol'], ['pistol'], ['shotgun']];
    for (let i = 0; i < d.n; i++) {
      const a = (i / d.n) * TAU + 0.6;
      const n = this.map.nearestWalk(Math.floor(v.x + Math.cos(a) * 1.3), Math.floor(v.y + Math.sin(a) * 1.3), 4);
      if (!n) continue;
      const u = new Unit('police', n[0] + 0.5, n[1] + 0.5, { weapons: weapons[i % weapons.length], ai: d.lvl >= 3 ? 3 : 2, hp: d.lvl >= 3 ? 100 : 80, name: d.lvl >= 3 ? 'Agente tattico' : 'Poliziotto' });
      u.reinforcement = true;
      this.addUnit(u);
      alertTo(this, u, this.heatSrc?.x ?? d.x, this.heatSrc?.y ?? d.y, 14);
    }
    this.sfx('siren', v.x, v.y);
  }

  /** Torretta dei veicoli ostili armati (blindati): raffiche contro agenti e alleati in vista. */
  vehicleTurret(v, dt) {
    v.tcd = (v.tcd || 0) - dt;
    if (v.tcd > 0) return;
    const R = 8.5;
    let t = v.tTarget;
    if (!t || !t.alive || t.vehicle || Math.hypot(t.x - v.x, t.y - v.y) > R || !this.map.los(v.x, v.y, t.x, t.y)) {
      t = null; let bd = R;
      const cand = (o) => {
        // il convoglio apre il fuoco solo se in allarme o se attaccato
        if (!this.alarm && this.heat < 50 && v.tTarget !== o) return;
        const d = Math.hypot(o.x - v.x, o.y - v.y);
        if (d < bd && this.map.los(v.x, v.y, o.x, o.y)) { bd = d; t = o; }
      };
      for (const u of this.units) {
        if (!u.alive || u.vehicle || u.faction !== 0) continue;
        cand(u);
      }
      // l'auto del giocatore con agenti a bordo e' un bersaglio legittimo
      for (const o of this.vehicles) {
        if (o === v || !o.alive || !o.passengers.some((p) => p.alive && p.faction === 0)) continue;
        cand(o);
      }
      if (t && t !== v.tTarget) v.tcd = 0.7; // tempo di acquisizione
      v.tTarget = t;
      if (t) return;
    }
    if (!t) { v.tcd = 0.35; v.tShots = 0; return; }
    v.engageT = 1.5;
    const want = Math.atan2(t.y - v.y, t.x - v.x);
    v.turretDir = v.turretDir ?? want;
    v.turretDir += clamp(((want - v.turretDir + Math.PI * 3) % TAU) - Math.PI, -dt * 6, dt * 6);
    if (Math.abs(((want - v.turretDir + Math.PI * 3) % TAU) - Math.PI) > 0.25) { v.tcd = 0.02; return; }
    v.tShots = (v.tShots || 0) + 1;
    v.tcd = v.tShots % 5 === 0 ? 1.7 : 0.16;
    const a = v.turretDir + gauss() * 0.11;
    const shooter = { faction: v.faction, vehicle: v, x: v.x, y: v.y, kind: 'turret' };
    const r = rayHit(this, v.x, v.y, a, R, shooter);
    const h = r.hits.find((x) => x.o !== v);
    const endT = h ? h.t : r.maxT;
    const mx = v.x + Math.cos(a) * 0.9, my = v.y + Math.sin(a) * 0.9;
    this.fx.tracer(mx, my, v.x + r.dx * endT, v.y + r.dy * endT, '#ffb070', 1.6, 0.08, 0.9, 0.5);
    this.fx.flash(mx, my, 0.9, '#ffd08a', 0.6, 0.05);
    this.fx.light(mx, my, '255,190,120', 2.5, 0.06);
    if (h) damage(this, h.o, 11, v, 'bullet', a);
    this.sfx('turret', v.x, v.y);
    this.noise(v.x, v.y, 14, v, true);
  }

  alertVehicleAttack(v, src) {
    if (v.hostile && src?.faction === 0) { v.tTarget = src.kind === 'vehicle' ? null : src; this.alarm = true; }
    if (v.traffic && !v.player) v.panicT = 5;
    if (v.player && src && src.faction !== 0) {
      // chi e' a bordo sente i colpi sull'auto: estrae le armi e si gira verso l'aggressore
      for (const p of v.passengers) if (p.alive) { p.lastAttacker = src; p.lastHurtT = this.t; }
    }
  }

  persuade(a, t) { return persuade(this, a, t); }

  // ripari prenotati, per non ammassarsi dietro lo stesso muro
  reserveCover(c, u) { this.releaseCover(u); const k = c.ty * this.map.w + c.tx; this.coverRes.set(k, { u, until: this.t + 8 }); u.coverKey = k; }
  releaseCover(u) { if (u.coverKey !== undefined) { const r = this.coverRes.get(u.coverKey); if (r?.u === u) this.coverRes.delete(u.coverKey); u.coverKey = undefined; } }
  coverTaken(tx, ty, u) { const r = this.coverRes.get(ty * this.map.w + tx); return !!r && r.u !== u && r.u.alive && r.until > this.t; }

  toggleHolster(units) {
    const list = units.filter((u) => u.alive && !u.vehicle);
    if (!list.length) return;
    const to = !list.every((u) => u.holstered);
    for (const u of list) { u.holstered = to; if (to) { u.autoT = null; if (u.order?.type === 'attack' || u.order?.type === 'fire') u.order = null; } }
    play('holster');
    return to;
  }

  scare(u, x, y) {
    if (!u.alive || u.faction !== 3) return;
    u.panic = Math.max(u.panic, 3 + Math.random() * 4);
    u.ai ||= { state: 'idle', t: 0 };
    u.ai.fx = x; u.ai.fy = y; u.path = null; u.ai.state = 'flee0';
  }

  noise(x, y, r, src, shot = false, loud = false) {
    if (shot && src?.faction === 0) this.lastShotT = this.t;
    for (const u of this.units) {
      if (!u.alive || u === src || u.vehicle) continue;
      const dx = u.x - x, dy = u.y - y;
      if (Math.abs(dx) > r || Math.abs(dy) > r) continue;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      if (u.faction === 3) {
        if (d < r * 0.75 && (loud || this.map.los(u.x, u.y, x, y))) this.scare(u, x, y);
      } else if (src && u.faction !== 0 && src.faction === 0) {
        if (u.faction === 2 && this.heat <= 0 && d < 16 && (loud || this.map.los(u.x, u.y, x, y))) this.addHeat(25, src);
        if (this.hostile(u, src) || (u.faction === 2 && this.heat > 0)) {
          // i muri attutiscono: oltre metà portata serve la linea di vista, salvo esplosioni
          if (d > r * 0.55 && !loud && !this.map.los(u.x, u.y, x, y)) continue;
          alertTo(this, u, src.x + rand(-1.5, 1.5), src.y + rand(-1.5, 1.5), 9);
        }
      }
    }
  }

  onHurt(v, src, nearMiss = false) {
    if (v.faction === 0 && v.kind === 'agent' && !nearMiss) v.holstered = false;
    if (v.faction === 3 && src) { this.scare(v, src.x, src.y); return; }
    if (v.faction === 2 && src?.faction === 0) this.addHeat(nearMiss ? 8 : 14, src);
    if (!src || v.faction === 0 || !this.hostile(v, src) || src.kind === 'turret') return;
    const ai = ensureAI(v);
    if (nearMiss) { if (ai.state === 'idle' || ai.state === 'suspicious') { ai.sus = 1; alertTo(this, v, src.x, src.y, 9); } return; }
    if (ai.state !== 'combat' && ai.state !== 'cover' && ai.state !== 'retreat') {
      ai.state = 'combat'; ai.target = src; ai.reactT = 0.12; ai.seen = { x: src.x, y: src.y, t: this.t }; ai.sus = 1; v.path = null;
      this.alertAllies(v, src);
    }
  }

  onKill(v, src) {
    this.mission.onKill(v, src);
    if (v.persuaded && v.kind !== 'vehicle') this.toast(`${v.name} persuaso perso`, 'warn');
  }
  onPersuade(o, a) {
    this.mission.onPersuade(o, a);
  }

  alertAllies(u, T) {
    for (const o of this.units) {
      if (!o.alive || o === u || o.faction !== u.faction || o.persuaded) continue;
      if (Math.hypot(o.x - u.x, o.y - u.y) > 16) continue;
      if (o.faction === 2 && this.heat <= 0) continue;
      const ai = ensureAI(o);
      if (ai.state === 'idle' || ai.state === 'suspicious' || ai.state === 'alert') { ai.state = 'idle'; alertTo(this, o, T.x, T.y, 10); }
    }
    this.alarm = true;
  }

  remember(f, t) { this.mem[f].set(t.id, { x: t.x, y: t.y, t: this.t }); }
  recall(f, u) {
    let best = null, bd = 18;
    for (const [id, m] of this.mem[f]) {
      if (this.t - m.t > 6) { this.mem[f].delete(id); continue; }
      const d = Math.hypot(m.x - u.x, m.y - u.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  // ------------- ciclo -------------
  update(dt) {
    this.t += dt;
    this.fx.update(dt);
    const hasCombat = this.units.some((u) => u.alive && u.ai?.state === 'combat');
    setIntensity(hasCombat ? 0.8 : this.heat > 0 ? 0.55 : 0.3);

    for (const u of this.units) {
      if (!u.alive) continue;
      u.cd = Math.max(0, u.cd - dt);
      u.flash = Math.max(0, u.flash - dt);
      u.hurt = Math.max(0, u.hurt - dt);
      if (u.suppress > 0) u.suppress = Math.max(0, u.suppress - dt * 0.35);
      for (const k of ['a', 'p', 'i']) {
        const s = u.ipa[k];
        s.e += clamp(s.t - s.e, -dt * 18, dt * 18);
      }
      if (u.burn > 0) {
        u.burn -= dt;
        if (Math.random() < dt * 10) this.fx.fire(u.x, u.y, 0.5, 4);
        u.hp -= 9 * dt;
        u.hurt = 0.1;
        if (u.hp <= 0) { killUnit(this, u, u.lastAttacker, 'fire'); continue; }
      }
      if (u.vehicle) { u.moving = false; continue; }
      if (u.kind === 'agent') updateAgent(this, u, dt);
      else updateNPC(this, u, dt);
      if (u.moving) u.anim += dt * 6;
    }
    this.separate();

    for (const v of this.vehicles) this.updateVehicle(v, dt);
    this.vehicles = this.vehicles.filter((v) => !v.gone);
    this.traffic.t -= dt;
    if (this.traffic.t <= 0) {
      this.traffic.t = 1.5;
      const n = this.vehicles.filter((v) => v.traffic && v.alive).length;
      if (n < this.traffic.target) this.spawnTraffic();
    }

    this.updateProjectiles(dt);
    this.updateBombs(dt);
    this.updatePickups(dt);

    this.gateT -= dt;
    if (this.gateT <= 0) { this.gateT = 0.25; this.updateGates(); }

    // calore e rinforzi di polizia
    if (!this.policeAlways) {
      this.heatT -= dt;
      if (this.heatT <= 0 && this.heat > 0) { this.heat = Math.max(0, this.heat - 4 * dt); if (this.heat === 0) { this.heatWarned = false; this.toast('Polizia calmata', 'info'); this.policeCool.clear(); } }
    }
    if (this.heat > 0 && this.def.policeBackup !== false) {
      this.dispatchT -= dt;
      if (this.dispatchT <= 0) {
        const lvl = this.heat >= 90 ? 3 : this.heat >= 50 ? 2 : 1;
        this.dispatchT = lvl === 3 ? 22 : lvl === 2 ? 32 : 40;
        const cops = this.units.filter((u) => u.alive && u.faction === 2 && !u.persuaded).length;
        const enRoute = this.vehicles.filter((v) => v.alive && v.dispatch).length;
        if (lvl >= 2 && cops + enRoute * 2 < (lvl === 3 ? 12 : 7)) this.dispatchPolice(lvl);
      }
    }

    // ondate
    for (const w of this.waves) {
      if (w.fired) continue;
      if ((w.time !== undefined && this.t >= w.time) || (w.onAlarm && this.alarm) || (w.onHeat && this.heat > 0)) {
        w.fired = true;
        for (const e of w.entities || []) this.spawnEntity({ ...e, minDist: 0 });
        if (w.message) this.toast(w.message, 'bad');
        if (w.alert) for (const u of this.units) if (u.alive && u.faction === 1 && u.ai) { u.ai.state = 'alert'; u.ai.invest = { x: this.start.x, y: this.start.y }; u.ai.alertT = 12; }
      }
    }

    this.tickT -= dt;
    if (this.tickT <= 0) { this.tickT = 0.2; this.mission.tick(0.2); }

    // pulizia cadaveri
    if (this.units.length > 120) {
      const dead = this.units.filter((u) => !u.alive).sort((a, b) => a.deadT - b.deadT);
      const rm = new Set(dead.slice(0, Math.max(0, dead.length - 40)));
      if (rm.size) this.units = this.units.filter((u) => !rm.has(u));
    }
  }

  updateGates() {
    if (!this.gateTiles.length) return;
    const carriers = this.agents.filter((a) => a.alive && a.has('access'));
    for (const [gx, gy] of this.gateTiles) {
      const i = gy * this.map.w + gx;
      const near = carriers.some((a) => Math.hypot(a.x - gx - 0.5, a.y - gy - 0.5) < 2.8);
      const occupied = this.units.some((u) => u.alive && Math.hypot(u.x - gx - 0.5, u.y - gy - 0.5) < 1.3);
      if (near && !this.map.gateOpen.has(i)) { this.map.gateOpen.add(i); this.sfx('gate', gx, gy); }
      else if (!near && !occupied && this.map.gateOpen.has(i)) this.map.gateOpen.delete(i);
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      let boom = p.life <= 0;
      const steps = 3;
      for (let s = 0; s < steps && !boom; s++) {
        p.x += (p.vx * dt) / steps;
        p.y += (p.vy * dt) / steps;
        if (this.map.blocksLOS(Math.floor(p.x), Math.floor(p.y))) boom = true;
        else {
          for (const u of this.units) if (u.alive && !u.vehicle && u.faction !== p.owner.faction && Math.hypot(u.x - p.x, u.y - p.y) < 0.45) { boom = true; break; }
          if (!boom) for (const v of this.vehicles) if (v.alive && Math.hypot(v.x - p.x, v.y - p.y) < 0.8) { boom = true; break; }
        }
      }
      p.trail -= dt;
      if (p.trail <= 0) { p.trail = 0.015; this.fx.smoke(p.x, p.y, 0.55, 3, 0.5, 'rgba(180,200,220,'); this.fx.add({ x: p.x, y: p.y, z: 0.55, vx: 0, vy: 0, vz: 0, life: 0.12, size: 3, color: '#9ad8ff', g: 0, type: 'fire' }); }
      if (boom) { this.projectiles.splice(i, 1); explode(this, p.x, p.y, p.radius, p.dmg, p.owner); }
    }
  }

  updateBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t -= dt;
      b.beep -= dt;
      if (b.beep <= 0) { b.beep = Math.max(0.15, b.t / 5); this.sfx('beep', b.x, b.y, 0.7); }
      if (b.t <= 0) { this.bombs.splice(i, 1); explode(this, b.x, b.y, b.radius, b.dmg, b.owner); }
    }
  }

  updatePickups(dt) {
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.t += dt;
      for (const u of this.units) {
        if (!u.alive || u.vehicle || u.faction !== 0) continue;
        if (Math.hypot(u.x - p.x, u.y - p.y) > 0.9) continue;
        if (p.quest) {
          // solo gli agenti del giocatore possono raccogliere oggetti di missione:
          // un alleato persuaso che si porta via il case bloccherebbe l'obiettivo
          if (u.kind !== 'agent') continue;
          u.carrying.push({ item: p.item, id: p.id, quest: true, label: p.label });
          p.taken = true;
          this.fx.text(u.x, u.y, p.label.toUpperCase(), '#ffd24d');
          play('pickup');
          this.mission.onPickup(p, u);
          break;
        }
        if (u.kind === 'agent' || WEAPONS[p.item]) {
          if (u.weapons.length >= 8 && !u.has(p.item)) continue;
          giveWeapon(u, p.item, p.ammo);
          p.taken = true;
          this.fx.text(u.x, u.y, WEAPONS[p.item]?.name.toUpperCase() || p.item, '#ffd24d');
          play('pickup');
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  // ------------- azioni da UI -------------
  useMedikit(u) { return useMedikit(this, u); }
  plantBomb(u) { return plantBomb(this, u); }

  finish(result, reason) {
    if (this.over) return;
    this.over = { result, reason };
    play(result === 'win' ? 'complete' : 'fail');
  }

  debugState() {
    return {
      t: +this.t.toFixed(1), heat: Math.round(this.heat), over: this.over,
      agents: this.agents.map((a) => ({ n: a.name, hp: Math.round(a.hp), x: +a.x.toFixed(1), y: +a.y.toFixed(1), alive: a.alive, order: a.order?.type || null, w: a.weapons.map((w) => w.id + ':' + w.ammo) })),
      enemies: this.units.filter((u) => u.alive && u.faction === 1).length,
      civs: this.units.filter((u) => u.alive && u.faction === 3).length,
      vehicles: this.vehicles.filter((v) => v.alive).length,
      objectives: this.mission.objectives.map((o) => ({ t: o.def.text, done: o.done, failed: o.failed })),
    };
  }
}
