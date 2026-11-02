import { KINDS, WEAPONS, VEHICLE_TYPES, OFFENSIVE } from './data.js';
import { TAU } from './util.js';

let UID = 1;
export const nextUid = () => UID++;

export const mkWeapon = (id) => ({ id, ammo: WEAPONS[id]?.ammo ?? 0 });

export class Unit {
  constructor(kind, x, y, o = {}) {
    const K = KINDS[kind];
    this.uid = UID++;
    this.id = o.id || `${kind}_${this.uid}`;
    this.kind = kind;
    this.faction = o.faction ?? K.faction;
    this.origFaction = this.faction;
    this.name = o.name || K.label;
    this.x = x; this.y = y;
    this.dir = o.dir ?? Math.random() * TAU;
    this.maxHp = o.hp ?? K.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.radius = 0.3;
    this.baseSpeed = o.speed ?? K.speed;
    this.sight = o.vision ?? K.sight;
    this.aiLevel = o.ai ?? K.ai ?? 0;
    this.persuadeCost = o.persuadeCost ?? K.cost;
    this.persuadable = o.persuadable ?? (kind !== 'agent');
    this.weapons = (o.weapons || K.weapons || []).map(mkWeapon);
    this.cur = 0;
    this.lastOff = 0;
    this.cd = 0;
    this.path = null; this.pi = 0;
    this.anim = Math.random() * 6;
    this.moving = false;
    this.stuck = 0;
    this.order = null; this.queue = [];
    this.group = o.group || null;
    this.tags = o.tags || [];
    this.mods = { legs: 0, arms: 0, chest: 0, heart: 0, eyes: 0, brain: 0, ...(o.mods || {}) };
    this.ipa = { a: { t: 50, e: 50 }, p: { t: 50, e: 50 }, i: { t: 50, e: 50 } };
    this.burn = 0; this.hurt = 0; this.flash = 0; this.shield = 0;
    this.owner = null; // agente che lo ha persuaso
    this.persuaded = false;
    this.vehicle = null;
    this.ai = null;
    this.aimDir = null;
    this.kills = 0;
    this.deadT = 0;
    this.lastAttacker = null;
    this.lastHurtT = -99;
    this.carrying = [];
    this.patrol = o.patrol || null;
    this.home = { x, y };
    this.color = o.color || K.color;
    this.panic = 0;
    this.holstered = false;
    this.suppress = 0;
    this.hitDir = null;
    if (kind === 'agent') {
      this.recomputeStats();
      this.hp = this.maxHp;
    }
  }

  get fA() { return (this.ipa.a.e - 50) / 50; }
  get fP() { return (this.ipa.p.e - 50) / 50; }
  get fI() { return (this.ipa.i.e - 50) / 50; }

  recomputeStats() {
    if (this.kind === 'agent') {
      const old = this.maxHp;
      this.maxHp = 120 + this.mods.chest * 45;
      if (this.maxHp !== old && this.hp > 0) this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - old));
    }
  }

  speedMul() {
    return (1 + this.mods.legs * 0.11) * (1 + this.fA * 0.3) * (this.burn > 0 ? 0.75 : 1) * (this.panic > 0 && this.faction === 3 ? 1.5 : 1);
  }
  spreadMul() { return Math.max(0.15, (1 - this.mods.arms * 0.13) * (1 - this.fI * 0.4)); } // precisione = INT
  cdMul() { return (1 - this.mods.arms * 0.06) / (1 + this.fA * 0.28); }
  rangeMul() { return (1 + this.mods.eyes * 0.07) * (1 + this.fP * 0.18); }
  /** Moltiplicatore di dispersione: addestramento (livello IA), movimento, soppressione. */
  accMul() {
    let m = this.kind === 'agent' ? 1 : [1.9, 1.75, 1.35, 1.05][this.aiLevel] ?? 1.35;
    if (this.persuaded && this.kind !== 'agent') m = Math.max(m, 1.55);
    if (this.moving) m *= this.kind === 'agent' ? 1.35 - Math.max(0, this.fI) * 0.3 : 1.5;
    return m * (1 + (this.suppress || 0) * 0.8);
  }
  regen() { return this.mods.heart * 0.9 + 0.0; }
  persuadeCap() { return 10 + this.mods.brain * 4; }

  wdef() { return WEAPONS[this.weapons[this.cur]?.id]; }
  wslot() { return this.weapons[this.cur]; }
  has(id) { return this.weapons.some((w) => w.id === id); }
  firstOffensive() {
    const i = this.weapons.findIndex((w) => OFFENSIVE.has(WEAPONS[w.id]?.type) && (w.ammo > 0));
    return i;
  }
  /** Indice dell'arma offensiva da usare per il fuoco automatico. */
  attackIndex() {
    const c = this.weapons[this.cur];
    if (c && OFFENSIVE.has(WEAPONS[c.id]?.type) && c.ammo > 0) return this.cur;
    const l = this.weapons[this.lastOff];
    if (l && OFFENSIVE.has(WEAPONS[l.id]?.type) && l.ammo > 0) return this.lastOff;
    return this.firstOffensive();
  }
  selectWeapon(i) {
    if (i < 0 || i >= this.weapons.length) return;
    this.cur = i;
    if (OFFENSIVE.has(WEAPONS[this.weapons[i].id]?.type)) this.lastOff = i;
  }
  get armed() { return this.attackIndex() >= 0; }
  get isHuman() { return true; }
}

export class Vehicle {
  constructor(type, x, y, o = {}) {
    const V = VEHICLE_TYPES[type] || VEHICLE_TYPES.car;
    this.uid = UID++;
    this.id = o.id || `veh_${this.uid}`;
    this.kind = 'vehicle';
    this.type = type;
    this.V = V;
    this.x = x; this.y = y;
    this.heading = o.heading || 1; // 1:+x 2:-x 3:+y 4:-y
    this.speed = 0;
    this.maxSpeed = V.speed;
    this.hp = o.hp ?? V.hp;
    this.maxHp = this.hp;
    this.alive = true;
    this.color = o.color || ['#c23b5b', '#2b7bd1', '#d8a21e', '#8a8f9c', '#2fa56b', '#e0e0e8'][Math.floor(Math.random() * 6)];
    if (type === 'police') this.color = '#e8ecff';
    if (type === 'armored') this.color = '#3b4350';
    this.faction = o.faction ?? 3;
    this.player = false;
    this.passengers = [];
    this.path = null; this.pi = 0;
    this.nx = null; this.ny = null;
    this.hostile = !!o.hostile;
    this.tags = o.tags || [];
    this.group = o.group || null;
    this.traffic = !!o.traffic;
    this.burn = 0;
    this.flash = 0;
    this.wait = 0;
    this.radius = 0.6;
  }
}

export class Pickup {
  constructor(item, x, y, o = {}) {
    this.uid = UID++;
    this.id = o.id || `pk_${this.uid}`;
    this.item = item;
    this.x = x; this.y = y;
    this.ammo = o.ammo;
    this.quest = !!o.quest;
    this.label = o.label || (WEAPONS[item]?.name ?? item);
    this.taken = false;
    this.t = Math.random() * 6;
  }
}
