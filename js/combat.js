import { WEAPONS, OFFENSIVE } from './data.js';
import { gauss, angDiff, rand, TAU } from './util.js';
import { play } from './audio.js';
import { Pickup, mkWeapon } from './units.js';

const MUZZLE_Z = 0.62;

/** Raggio: ritorna lista ordinata di bersagli colpiti e distanza massima utile. */
export function rayHit(game, x0, y0, ang, range, shooter, ignoreFaction = true) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const wall = game.map.rayWall(x0, y0, dx, dy, range);
  const maxT = wall === null ? range : wall;
  const hits = [];
  for (const u of game.units) {
    if (!u.alive || u === shooter || u.vehicle) continue;
    if (ignoreFaction && shooter && u.faction === shooter.faction) continue;
    const vx = u.x - x0, vy = u.y - y0;
    const t = vx * dx + vy * dy;
    if (t < 0 || t > maxT) continue;
    if (Math.abs(vx * dy - vy * dx) < u.radius + 0.06) hits.push({ o: u, t });
  }
  for (const v of game.vehicles) {
    if (!v.alive || v === shooter?.vehicle) continue;
    const vx = v.x - x0, vy = v.y - y0;
    const t = vx * dx + vy * dy;
    if (t < 0 || t > maxT) continue;
    const hx = v.heading <= 2 ? v.V.hx : v.V.hy, hy = v.heading <= 2 ? v.V.hy : v.V.hx;
    // intersezione grossolana con AABB (approssimata da cerchio ellittico)
    const px = x0 + dx * t - v.x, py = y0 + dy * t - v.y;
    if (Math.abs(px) < hx + 0.05 && Math.abs(py) < hy + 0.05) hits.push({ o: v, t });
  }
  hits.sort((a, b) => a.t - b.t);
  return { hits, maxT, wall: wall !== null, dx, dy };
}

/** Colpi mancati che sfiorano un'unita': la sopprimono (precisione peggiore, cerca riparo) e la mettono in allerta. */
function suppressRay(game, shooter, x0, y0, dx, dy, len, amt, hit) {
  for (const u of game.units) {
    if (!u.alive || u === hit || u.vehicle || u.faction === shooter.faction || u.faction === 3) continue;
    const vx = u.x - x0, vy = u.y - y0;
    const t = vx * dx + vy * dy;
    if (t < 0.5 || t > len + 0.8) continue;
    if (Math.abs(vx * dy - vy * dx) > 1.3) continue;
    u.suppress = Math.min(1, (u.suppress || 0) + amt);
    if (u.ai && (u.ai.state === 'idle' || u.ai.state === 'suspicious') && u.faction !== 0) game.onHurt?.(u, shooter, true);
  }
}

/** Spara con l'arma corrente dell'unita'. Ritorna true se ha sparato. */
export function fire(game, u, tx, ty, widx = null) {
  const idx = widx ?? u.cur;
  const slot = u.weapons[idx];
  if (!slot || u.cd > 0) return false;
  const w = WEAPONS[slot.id];
  if (!w || !OFFENSIVE.has(w.type) || slot.ammo <= 0) return false;
  const ang = Math.atan2(ty - u.y, tx - u.x);
  u.dir = ang;
  u.aimDir = ang;
  const mx = u.x + Math.cos(ang) * 0.35, my = u.y + Math.sin(ang) * 0.35;
  u.cd = w.cd * u.cdMul();
  slot.ammo--;
  u.flash = 0.07;
  u.holstered = false;
  game.stats.shots += u.faction === 0 ? 1 : 0;
  const rng = w.range * u.rangeMul();
  game.noise(u.x, u.y, w.noise || 14, u, true);
  game.sfx(w.snd, u.x, u.y);

  if (w.type === 'hit') {
    const spread = w.spread * u.spreadMul() * u.accMul();
    for (let p = 0; p < (w.pellets || 1); p++) {
      const a = ang + gauss() * spread * (w.pellets > 1 ? 1.6 : 1.9);
      const r = rayHit(game, u.x, u.y, a, rng, u);
      const h = r.hits[0];
      const endT = h ? h.t : r.maxT;
      game.fx.tracer(mx, my, u.x + r.dx * endT, u.y + r.dy * endT, w.tracer, 1.4, 0.07);
      if (h) damage(game, h.o, w.dmg, u, 'bullet', a);
      else if (r.wall) { game.fx.spark(u.x + r.dx * endT, u.y + r.dy * endT, 0.6, 3); game.fx.puff(u.x + r.dx * (endT - 0.05), u.y + r.dy * (endT - 0.05)); }
      if (p === 0 || p === 3) suppressRay(game, u, u.x, u.y, r.dx, r.dy, endT, w.dmg > 40 ? 0.35 : 0.14, h?.o);
    }
    game.fx.flash(mx, my, MUZZLE_Z, '#ffe3a0', 0.55, 0.05);
    game.fx.light(mx, my, '255,210,140', 2.6, 0.06);
    if (w.id !== 'shotgun' || Math.random() < 0.5) game.fx.shell(u.x, u.y, ang);
  } else if (w.type === 'beam') {
    const r = rayHit(game, u.x, u.y, ang + gauss() * 0.006 * u.accMul(), rng, u);
    game.fx.tracer(mx, my, u.x + r.dx * r.maxT, u.y + r.dy * r.maxT, w.tracer, 3.2, 0.16);
    game.fx.tracer(mx, my, u.x + r.dx * r.maxT, u.y + r.dy * r.maxT, '#ffffff', 1, 0.12);
    for (const h of r.hits) damage(game, h.o, w.dmg, u, 'bullet', ang);
    if (r.wall) game.fx.spark(u.x + r.dx * r.maxT, u.y + r.dy * r.maxT, 0.6, 6, '#ff5a8a');
    suppressRay(game, u, u.x, u.y, r.dx, r.dy, r.maxT, 0.4, null);
    game.fx.flash(mx, my, MUZZLE_Z, '#ff7a9a', 0.9, 0.08);
    game.fx.light(mx, my, '255,80,130', 3.2, 0.14);
  } else if (w.type === 'flame') {
    for (let i = 0; i < 3; i++) {
      const a = ang + gauss() * 0.14, d = Math.random() * rng;
      game.fx.add({ x: mx + Math.cos(a) * d * 0.4, y: my + Math.sin(a) * d * 0.4, z: 0.55, vx: Math.cos(a) * rng * 2.2, vy: Math.sin(a) * rng * 2.2, vz: 0.3, life: 0.28 + Math.random() * 0.15, size: 6 + Math.random() * 5, color: '#ff9a3d', g: -0.4, type: 'fire' });
    }
    for (const v of game.units) {
      if (!v.alive || v === u || v.vehicle || v.faction === u.faction) continue;
      const d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d > rng + 0.3) continue;
      if (Math.abs(angDiff(ang, Math.atan2(v.y - u.y, v.x - u.x))) > 0.3 + 0.4 / Math.max(1, d)) continue;
      if (!game.map.los(u.x, u.y, v.x, v.y)) continue;
      v.burn = 3.2;
      damage(game, v, w.dmg * 0.22, u, 'fire', ang);
    }
    for (const v of game.vehicles) {
      if (!v.alive) continue;
      const d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d < rng + 0.6 && Math.abs(angDiff(ang, Math.atan2(v.y - u.y, v.x - u.x))) < 0.5) damage(game, v, w.dmg * 0.5, u, 'fire');
    }
    game.fx.light(mx + Math.cos(ang) * 1.5, my + Math.sin(ang) * 1.5, '255,140,50', 4, 0.12);
  } else if (w.type === 'missile') {
    game.projectiles.push({ x: mx, y: my, vx: Math.cos(ang) * 17, vy: Math.sin(ang) * 17, owner: u, dmg: w.dmg, radius: w.radius, life: rng / 17 + 0.15, trail: 0 });
    game.fx.flash(mx, my, MUZZLE_Z, '#9ad8ff', 1.1, 0.1);
    game.fx.light(mx, my, '140,210,255', 3, 0.12);
  }
  return true;
}

export function damage(game, v, amt, src, type = 'bullet', ang = null) {
  if (!v.alive || amt <= 0) return;
  if (v.kind === 'vehicle') {
    // il lanciafiamme "gratta" ma consuma l'armatura col tempo; le pistole quasi nulla
    const mult = type === 'explosion' ? 1 : type === 'fire' ? (v.type === 'armored' ? 0.35 : 0.85) : v.type === 'armored' ? 0.12 : 0.6;
    v.hp -= amt * mult;
    v.flash = 0.1;
    game.fx.spark(v.x, v.y, 0.5, 2, '#ffd36b');
    if (v.hp <= 0) destroyVehicle(game, v, src);
    else if (v.hp < v.maxHp * 0.35) v.burn = 1;
    if (src) game.alertVehicleAttack?.(v, src);
    return;
  }
  // gli agenti cibernetici incassano meglio i colpi degli NPC (scala per livello AI);
  // le torri dei veicoli sparano pesante: niente riduzione
  if (v.faction === 0 && src && src.faction !== 0 && type !== 'explosion') {
    if (src.kind !== 'turret' && src.kind !== 'vehicle') amt *= [0.55, 0.55, 0.7, 0.85][src.ai?.level ?? 1] ?? 0.7;
  }
  if (v.shield > 0) {
    const ab = Math.min(v.shield, amt * 0.6);
    v.shield -= ab;
    amt -= ab;
    game.fx.spark(v.x, v.y, 0.7, 2, '#7af0ff');
  }
  v.hp -= amt;
  v.hurt = 0.18;
  if (ang === null && src) ang = Math.atan2(v.y - src.y, v.x - src.x);
  if (ang !== null) v.hitDir = ang;
  v.lastAttacker = src;
  v.lastHurtT = game.t;
  game.fx.blood(v.x, v.y, type === 'fire' ? 1 : 3 + (amt > 30 ? 4 : 0));
  game.sfx('hit', v.x, v.y);
  if (v.hp <= 0) killUnit(game, v, src, type);
  else game.onHurt?.(v, src);
}

export function killUnit(game, v, src, type) {
  if (!v.alive) return;
  v.alive = false;
  v.hp = 0;
  v.deadT = game.t;
  v.path = null; v.order = null; v.queue = [];
  v.burning = type === 'fire' || v.burn > 0;
  v.fallDir = v.hitDir ?? Math.random() * 6.28;
  v.deathType = type;
  if (v.vehicle) { v.vehicle.passengers = v.vehicle.passengers.filter((p) => p !== v); v.vehicle = null; }
  game.fx.blood(v.x, v.y, 12);
  game.fx.decal(v.x, v.y, 0.35, 'rgba(110,10,28,0.6)');
  game.sfx('death', v.x, v.y);
  // drop armi
  const drops = v.weapons.filter((w) => OFFENSIVE.has(WEAPONS[w.id]?.type) && w.ammo > 0);
  if (v.kind === 'agent' || Math.random() < 0.55) {
    for (const w of (v.kind === 'agent' ? v.weapons : drops.slice(0, 1))) {
      if (!WEAPONS[w.id] || WEAPONS[w.id].type === 'persuade' && v.kind !== 'agent') continue;
      game.pickups.push(new Pickup(w.id, v.x + (Math.random() - 0.5) * 0.7, v.y + (Math.random() - 0.5) * 0.7, { ammo: w.ammo, drop: true }));
    }
  }
  for (const q of v.carrying) game.pickups.push(new Pickup(q.item, v.x, v.y, { ...q, id: q.id }));
  v.carrying = [];
  // conseguenze
  const killerAgent = src && src.faction === 0;
  if (src) src.kills = (src.kills || 0) + 1;
  if (v.kind === 'agent') {
    game.stats.agentsLost++;
    game.toast(`Agente ${v.name} perso`, 'bad');
  } else if (killerAgent) {
    game.stats.kills++;
    if (v.origFaction === 3 && !v.persuaded) {
      game.stats.civKills++;
      game.addHeat(30, src);
    } else if (v.origFaction === 2 && !v.persuaded) game.addHeat(35, src);
    if (v.persuaded) game.stats.persuadedLost++;
  }
  // panico nei dintorni
  for (const o of game.units) {
    if (!o.alive || o.faction !== 3 || o === v) continue;
    if (Math.hypot(o.x - v.x, o.y - v.y) < 10) game.scare(o, v.x, v.y);
  }
  game.onKill?.(v, src);
}

export function destroyVehicle(game, v, src) {
  if (!v.alive) return;
  v.alive = false;
  v.wreck = true;
  v.deadT = game.t;
  v.speed = 0;
  game.stats.vehiclesDestroyed++;
  const ps = [...v.passengers];
  v.passengers = [];
  // explode() ignora le unita' ancora imbarcate (.vehicle): l'onda d'urto
  // colpirà solo chi e' fuori, il resto lo fa il danno dell'abitacolo qui sotto
  explode(game, v.x, v.y, 2.6, 90, src, v);
  for (const p of ps) {
    p.vehicle = null;
    const a = rand(0, TAU);
    const n = game.map.nearestWalk(Math.floor(v.x + Math.cos(a) * 1.6), Math.floor(v.y + Math.sin(a) * 1.6), 4);
    p.x = n ? n[0] + 0.5 : v.x; p.y = n ? n[1] + 0.5 : v.y;
    if (!p.alive) continue;
    // chi resta dentro all'esplosione incassa un danno grave, attenuato
    // dalla corazza (torace) e dallo scudo: senza protezioni si muore,
    // con torace 3 e scudo si esce bruciati ma vivi
    const armor = Math.min(3, p.mods?.chest ?? 0);
    damage(game, p, 200 * (1 - 0.16 * armor), src, 'explosion');
    if (p.alive) {
      p.burn = Math.max(p.burn || 0, 2);
      p.suppress = 1;
      if (p.faction === 3) game.scare(p, v.x, v.y);
    }
  }
  game.onKill?.(v, src);
}

export function explode(game, x, y, radius, dmg, src, skip = null) {
  game.fx.explosion(x, y, radius);
  game.sfx('explosion', x, y);
  game.noise(x, y, 28, src, true, true);
  const R = radius * 1.15;
  for (const u of [...game.units]) {
    if (!u.alive || u.vehicle) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > R) continue;
    if (!game.map.los(x, y, u.x, u.y) && d > 0.8) continue;
    damage(game, u, dmg * (1 - (d / R) * 0.8), src, 'explosion');
    if (u.alive && d < R * 0.5) u.burn = Math.max(u.burn, 2);
  }
  for (const v of [...game.vehicles]) {
    if (!v.alive || v === skip) continue;
    const d = Math.hypot(v.x - x, v.y - y);
    if (d < R + 0.5) damage(game, v, dmg * (1 - Math.min(0.8, d / (R + 0.5))), src, 'explosion');
  }
  for (const b of game.bombs) if (b.t > 0.05 && Math.hypot(b.x - x, b.y - y) < R) b.t = 0.05;
}

export function useMedikit(game, u) {
  const i = u.weapons.findIndex((w) => w.id === 'medikit' && w.ammo > 0);
  if (i < 0 || u.hp >= u.maxHp - 1 || !u.alive) return false;
  const w = WEAPONS.medikit;
  u.weapons[i].ammo--;
  u.hp = Math.min(u.maxHp, u.hp + w.heal);
  u.burn = 0;
  game.fx.text(u.x, u.y, '+SALUTE', '#5dff9a');
  game.sfx('heal', u.x, u.y);
  return true;
}

export function plantBomb(game, u) {
  const i = u.weapons.findIndex((w) => w.id === 'bomb' && w.ammo > 0);
  if (i < 0) return false;
  const w = WEAPONS.bomb;
  u.weapons[i].ammo--;
  game.bombs.push({ x: u.x, y: u.y, t: w.fuse, fuse: w.fuse, dmg: w.dmg, radius: w.radius, owner: u, beep: 0 });
  game.fx.text(u.x, u.y, 'BOMBA INNESCATA', '#ffb04d');
  play('bomb', 1);
  return true;
}

/** Persuadertron: converte il bersaglio e vicini entro raggio, rispettando la capacita'. */
export function persuade(game, a, target) {
  if (!target || !target.alive || target.kind === 'vehicle') return 0;
  const used = game.persuadeUsed(), cap = game.persuadeCapacity();
  const cands = game.units
    .filter((o) => o.alive && o.faction !== 0 && o.kind !== 'agent' && !o.vehicle && Math.hypot(o.x - target.x, o.y - target.y) < 1.7 && game.map.los(a.x, a.y, o.x, o.y))
    .sort((p, q) => Math.hypot(p.x - target.x, p.y - target.y) - Math.hypot(q.x - target.x, q.y - target.y));
  let left = cap - used, n = 0, denied = '';
  for (const o of cands) {
    if (!o.persuadable) { denied ||= 'IMMUNE'; continue; }
    if (o.persuadeCost > left) { denied ||= 'CAPACITA INSUFFICIENTE'; continue; }
    left -= o.persuadeCost;
    o.faction = 0;
    o.persuaded = true;
    o.owner = a;
    o.ai = null;
    o.path = null;
    o.suppress = 0;
    game.releaseCover?.(o);
    o.panic = 0;
    o.order = null;
    game.fx.text(o.x, o.y, 'PERSUASO', '#d28bff');
    game.fx.spark(o.x, o.y, 0.8, 8, '#d28bff');
    n++;
    game.onPersuade?.(o, a);
  }
  game.fx.tracer(a.x, a.y, target.x, target.y, '#d28bff', 2.2, 0.35, 0.7, 0.8);
  play(n ? 'persuade' : 'error');
  if (!n && denied) game.fx.text(target.x, target.y, denied, '#ff8a8a');
  return n;
}

export function giveWeapon(u, id, ammo) {
  const ex = u.weapons.find((w) => w.id === id);
  if (ex) {
    const w = WEAPONS[id];
    if (w.type === 'hit' || w.type === 'flame' || w.type === 'beam' || w.type === 'missile' || w.type === 'medikit' || w.type === 'bomb') ex.ammo = Math.min((w.ammo || 1) * 2, ex.ammo + (ammo ?? w.ammo ?? 1));
    return false;
  }
  if (u.weapons.length >= 8) return false;
  const s = mkWeapon(id);
  if (ammo != null && ammo > 0) s.ammo = ammo;
  u.weapons.push(s);
  return true;
}
