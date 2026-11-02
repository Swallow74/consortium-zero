import { WEAPONS, OFFENSIVE } from './data.js';
import { findPath } from './path.js';
import { fire, useMedikit } from './combat.js';
import { angDiff, clamp, rand, TAU } from './util.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- Movimento ----------
export function setPath(game, u, x, y, o) {
  const p = findPath(game.map, u.x, u.y, x, y, o);
  u.path = p;
  u.pi = 0;
  u.goal = { x, y };
  u.stuck = 0;
  return !!p;
}

export function turnTo(u, ang, dt, rate = 12) {
  u.dir += clamp(angDiff(u.dir, ang), -rate * dt, rate * dt);
}

export function moveAlong(game, u, dt, mul = 1) {
  if (!u.path || u.pi >= u.path.length) { u.moving = false; return false; }
  const p = u.path[u.pi];
  const dx = p.x - u.x, dy = p.y - u.y;
  const d = Math.hypot(dx, dy);
  const sp = u.baseSpeed * u.speedMul() * mul;
  const step = sp * dt;
  if (d <= step + 0.02) {
    game.tryMove(u, p.x, p.y);
    u.pi++;
    if (u.pi >= u.path.length) { u.path = null; u.moving = false; return false; }
    u.moving = true;
    return true;
  }
  const ox = u.x, oy = u.y;
  game.tryMove(u, u.x + (dx / d) * step, u.y + (dy / d) * step);
  const moved = Math.hypot(u.x - ox, u.y - oy);
  u.stuck = moved < step * 0.3 ? u.stuck + dt : 0;
  if (u.stuck > 0.5) {
    u.stuck = 0;
    if (u.goal && (u.repaths = (u.repaths || 0) + 1) < 4) setPath(game, u, u.goal.x, u.goal.y);
    else { u.path = null; u.repaths = 0; }
  }
  if (u.aimT === undefined || u.aimT <= 0) turnTo(u, Math.atan2(dy, dx), dt, 14);
  u.moving = true;
  u.anim += dt * sp * 2.6;
  return true;
}

export function faceTarget(u, x, y, dt) {
  u.aimT = 0.25;
  turnTo(u, Math.atan2(y - u.y, x - u.x), dt, 16);
}

const aimedAt = (u, x, y, tol = 0.3) => Math.abs(angDiff(u.dir, Math.atan2(y - u.y, x - u.x))) < tol;

// ---------- Stato IA ----------
export function ensureAI(u) {
  const ai = u.ai || (u.ai = {});
  ai.state ??= 'idle';
  ai.t ??= 0;
  ai.scan ??= Math.random() * 0.3;
  ai.level ??= u.aiLevel || 1;
  ai.patrolI ??= 0;
  ai.repathT ??= 0; ai.strafeT ??= 0; ai.flankT ??= 0; ai.coverT ??= 0; ai.thinkT ??= 0;
  ai.lookT ??= rand(1, 4);
  ai.sus ??= 0; ai.burst ??= 0; ai.pause ??= 0; ai.noCover ??= 0; ai.retreatCD ??= 0;
  ai.target ??= null;
  return ai;
}

/** Porta un'unita' ostile in allerta verso un punto (indagine + ricerca). */
export function alertTo(game, u, x, y, t = 9) {
  const ai = ensureAI(u);
  if (ai.state === 'combat' || ai.state === 'cover' || ai.state === 'retreat' || ai.state === 'warn') return;
  ai.state = 'alert';
  ai.invest = { x, y };
  ai.alertT = t + (ai.level >= 2 ? 6 : 0);
  ai.searchN = ai.level >= 2 ? 3 : 1;
  ai.look = undefined;
  setPath(game, u, x, y);
}

/** Arma in pugno e visibile (la polizia la intima di gettarla). */
export const drawn = (a) => !a.holstered && a.attackIndex() >= 0;

// ---------- Bersagli ----------
function threatScore(game, u, t, d) {
  let s = 100 - d * 4;
  if (t.hp < t.maxHp * 0.4) s += 18;
  if (t.kind === 'agent') s += 8;
  if (t === u.ai?.target || t === u.autoT) s += 14;
  if (t === u.lastAttacker && game.t - u.lastHurtT < 4) s += 26;
  if (t.ai?.target === u || t.autoT === u) s += 10; // mi sta prendendo di mira
  if (t.persuaded && t.kind !== 'agent') s -= 6;
  return s;
}

export function findTarget(game, u, range, cone = false, bonus = null) {
  let best = null, bs = -1e9;
  for (const t of game.units) {
    if (!t.alive || t === u || t.vehicle) continue;
    if (!game.hostile(u, t)) continue;
    const dx = t.x - u.x, dy = t.y - u.y;
    if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
    const d = Math.hypot(dx, dy);
    if (d > range) continue;
    if (cone && d > 3.2 && Math.abs(angDiff(u.dir, Math.atan2(dy, dx))) > 1.15) continue;
    if (!game.map.los(u.x, u.y, t.x, t.y)) continue;
    const s = threatScore(game, u, t, d) + (bonus ? bonus(t) : 0);
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}

function nearestWeaponPickup(game, u, r) {
  let best = null, bd = r;
  for (const p of game.pickups) {
    if (p.taken || p.quest || !OFFENSIVE.has(WEAPONS[p.item]?.type)) continue;
    const d = Math.hypot(p.x - u.x, p.y - u.y);
    if (d < bd && game.map.los(u.x, u.y, p.x, p.y)) { bd = d; best = p; }
  }
  return best;
}

// ---------- Agenti del giocatore ----------
export function updateAgent(game, u, dt) {
  u.aimT = Math.max(0, (u.aimT || 0) - dt);
  const o = u.order;
  let busy = false;
  if (o) {
    switch (o.type) {
      case 'move': {
        if (!u.path) {
          if (o.done) { next(u); break; }
          if (!setPath(game, u, o.x, o.y)) { next(u); break; }
          o.done = true;
        }
        moveAlong(game, u, dt, o.run ? 1.15 : 1);
        if (!u.path) next(u);
        else autoFire(game, u, dt, true);
        busy = true;
        break;
      }
      case 'attack': {
        const t = o.target;
        if (!t || !t.alive || (t.faction === 0 && t.kind !== 'vehicle')) { next(u); break; }
        const wi = u.attackIndex();
        if (wi < 0) { game.fx.text(u.x, u.y, 'NESSUNA ARMA', '#ff8a8a'); next(u); break; }
        u.holstered = false;
        if (u.cur !== wi && !OFFENSIVE.has(u.wdef()?.type)) u.selectWeapon(wi);
        const w = WEAPONS[u.weapons[u.cur].id];
        const rng = w.range * u.rangeMul();
        const d = dist(u, t);
        if (d <= rng * 0.97 && game.map.los(u.x, u.y, t.x, t.y)) {
          u.path = null; u.moving = false;
          faceTarget(u, t.x, t.y, dt);
          if (aimedAt(u, t.x, t.y)) fire(game, u, t.x, t.y, u.cur);
          if (u.weapons[u.cur].ammo <= 0) { const n = u.attackIndex(); if (n < 0) next(u); else u.selectWeapon(n); }
        } else {
          o.re = (o.re || 0) - dt;
          if (!u.path || o.re <= 0) { setPath(game, u, t.x, t.y); o.re = 0.45; }
          moveAlong(game, u, dt);
          if (u.fI > -0.2) autoFire(game, u, dt, true, t);
        }
        busy = true;
        break;
      }
      case 'persuade': {
        const t = o.target;
        if (!t || !t.alive || t.faction === 0) { next(u); break; }
        const pi = u.weapons.findIndex((w) => w.id === 'persuadertron');
        if (pi < 0) { next(u); break; }
        const rng = WEAPONS.persuadertron.range * u.rangeMul();
        const d = dist(u, t);
        if (d <= rng && game.map.los(u.x, u.y, t.x, t.y)) {
          u.path = null; u.moving = false;
          faceTarget(u, t.x, t.y, dt);
          if (u.cd <= 0) { game.persuade(u, t); u.cd = 1.0 * u.cdMul(); next(u); }
        } else {
          o.re = (o.re || 0) - dt;
          if (!u.path || o.re <= 0) { setPath(game, u, t.x, t.y); o.re = 0.5; }
          moveAlong(game, u, dt);
        }
        busy = true;
        break;
      }
      case 'enter': {
        const v = o.target;
        if (!v || !v.alive) { next(u); break; }
        if (dist(u, v) < 1.7) { game.enterVehicle(u, v); next(u); break; }
        o.re = (o.re || 0) - dt;
        if (!u.path || o.re <= 0) { setPath(game, u, v.x, v.y); o.re = 0.6; }
        moveAlong(game, u, dt);
        busy = true;
        break;
      }
      case 'fire': {
        o.t -= dt;
        u.holstered = false;
        faceTarget(u, o.x, o.y, dt);
        const wi = u.attackIndex();
        if (wi >= 0 && aimedAt(u, o.x, o.y)) fire(game, u, o.x, o.y, wi);
        if (o.t <= 0 || wi < 0) next(u);
        busy = true;
        break;
      }
      case 'hold': {
        u.moving = false;
        autoFire(game, u, dt, false);
        busy = true;
        break;
      }
    }
  }
  // armi rinfoderate: si estraggono da sole se la squadra finisce sotto attacco
  if (u.holstered) {
    u.alarmT = (u.alarmT || 0) - dt;
    if (u.alarmT <= 0) {
      u.alarmT = 0.3;
      const hot = game.agents.some((a) => a.alive && game.t - (a.lastHurtT ?? -99) < 2 && a.lastAttacker?.faction !== 0 && dist(a, u) < 12)
        || game.units.some((o) => o.alive && o.ai?.state === 'combat' && o.ai.target?.faction === 0 && dist(o, u) < 11);
      if (hot) { u.holstered = false; game.fx.text(u.x, u.y, 'ARMI!', '#ffcf6b'); }
    }
  }
  if (!busy && !followSquad(game, u, dt)) {
    u.moving = false;
    autoFire(game, u, dt, false);
    // consapevolezza: si gira verso chi lo ha colpito
    if (!u.autoT?.alive && u.lastAttacker?.alive && game.t - u.lastHurtT < 2.5) turnTo(u, Math.atan2(u.lastAttacker.y - u.y, u.lastAttacker.x - u.x), dt, 8);
  }
  // passi synced col passo (sfx 'step' era definito ma mai usato)
  if (u.moving && !u.vehicle) {
    u.stepP ??= u.anim;
    while (u.anim - u.stepP >= Math.PI) {
      u.stepP += Math.PI;
      game.sfx('step', u.x, u.y, 0.3);
    }
  }
  // cuore: rigenerazione
  if (u.hp < u.maxHp && u.alive) u.hp = Math.min(u.maxHp, u.hp + u.regen() * dt);
  // intelligenza: medikit automatico in emergenza
  if (u.hp < u.maxHp * 0.3 && u.fI > -0.1) {
    u.medT = (u.medT || 0) - dt;
    if (u.medT <= 0) { u.medT = 2.5; useMedikit(game, u); }
  }
  // intelligenza: schiva esplosivi
  if (u.fI > 0.2 && !u.vehicle) avoidHazards(game, u, dt);
}

function next(u) {
  u.order = u.queue.shift() || null;
  u.path = null;
  u.repaths = 0;
}

function focusBonus(game, u, c) {
  let b = 0;
  for (const a of game.agents) if (a !== u && a.alive && a.autoT === c) b += 9;
  return b;
}

export function autoFire(game, u, dt, moving, prefer = null) {
  if (u.vehicle || u.holstered) return;
  u.scanT = (u.scanT || 0) - dt;
  const wi = u.attackIndex();
  if (wi < 0) return;
  if (moving && u.ipa.i.e < 35) return;
  const w = WEAPONS[u.weapons[wi].id];
  const rng = w.range * u.rangeMul();
  let t = u.autoT && u.autoT.alive ? u.autoT : null;
  if (t && (dist(u, t) > rng || !game.map.los(u.x, u.y, t.x, t.y) || !game.hostile(u, t))) t = null;
  if (!t || u.scanT <= 0) {
    u.scanT = 0.18 - u.fP * 0.08; // reattivita del tiro automatico = PER
    if (prefer && prefer.alive && dist(u, prefer) <= rng && game.map.los(u.x, u.y, prefer.x, prefer.y)) t = prefer;
    else t = findTarget(game, u, rng, false, u.fI > 0 ? (c) => focusBonus(game, u, c) : null);
    u.autoT = t;
  }
  if (!t) return;
  faceTarget(u, t.x, t.y, dt);
  if (u.cd <= 0 && aimedAt(u, t.x, t.y, 0.35)) fire(game, u, t.x, t.y, wi);
}

// ---------- Raggruppamento: gli agenti non comandati seguono il gruppo ----------
const FOLLOW_DIST = 9;

/** Se l'agente senza ordini e' rimasto indietro rispetto al gruppo, lo riporta in formazione dietro di loro. Ritorna true se si sta muovendo. */
function followSquad(game, u, dt) {
  u.followM = false;
  if (game.sel.has(u) || u.order) { u.followPath = false; return false; }
  const sel = game.agents.filter((a) => a.alive && game.sel.has(a));
  const grp = (sel.length ? sel : game.agents.filter((a) => a.alive)).filter((a) => a !== u);
  if (!grp.length) return false;
  let ax = 0, ay = 0;
  for (const a of grp) { ax += a.x; ay += a.y; }
  ax /= grp.length; ay /= grp.length;
  const d = Math.hypot(ax - u.x, ay - u.y);
  // non spezza un combattimento in corso; insegue finche' non e' in formazione (isteresi: riparte solo se il gruppo si allontana)
  if (u.autoT?.alive || d <= (u.followPath ? 4 : FOLLOW_DIST)) {
    if (u.followPath) { u.path = null; u.moving = false; u.followPath = false; }
    return false;
  }
  // slot a ventaglio dietro il baricentro, uno per agente in formazione, per non accatastarsi
  const followers = game.agents.filter((a) => a.alive && a !== u && !a.order && !game.sel.has(a) && !a.autoT?.alive).sort((a, b) => a.uid - b.uid);
  const i = Math.max(0, followers.indexOf(u)), n = followers.length + 1;
  const back = Math.atan2(u.y - ay, u.x - ax);
  const row = Math.floor(i / 5), col = i % 5, inRow = Math.min(5, n - row * 5);
  const ang = back + (col - (inRow - 1) / 2) * 0.55;
  const r = 2.2 + row * 1.3;
  let sx = ax + Math.cos(ang) * r, sy = ay + Math.sin(ang) * r;
  if (!game.map.walk(Math.floor(sx), Math.floor(sy))) {
    const nw = game.map.nearestWalk(Math.floor(sx), Math.floor(sy), 3);
    if (!nw) return false;
    sx = nw[0] + 0.5; sy = nw[1] + 0.5;
  }
  u.followPath = true; u.followM = true;
  u.followRe = (u.followRe || 0) - dt;
  if (!u.path || u.followRe <= 0) { setPath(game, u, sx, sy); u.followRe = 1; }
  moveAlong(game, u, dt, 1.2);
  autoFire(game, u, dt, true);
  return true;
}

function avoidHazards(game, u, dt) {
  u.hazT = (u.hazT || 0) - dt;
  if (u.hazT > 0) return;
  u.hazT = 0.3;
  for (const b of game.bombs) {
    if (b.owner?.faction === u.faction && b.t > 1.2) continue;
    if (Math.hypot(b.x - u.x, b.y - u.y) < b.radius + 1) { fleeFrom(game, u, b.x, b.y, b.radius + 3); return; }
  }
  for (const p of game.projectiles) {
    if (p.owner?.faction === u.faction) continue;
    if (Math.hypot(p.x - u.x, p.y - u.y) < p.radius + 2) { fleeFrom(game, u, p.x, p.y, 5); return; }
  }
}

function fleeFrom(game, u, x, y, d) {
  const a = Math.atan2(u.y - y, u.x - x);
  for (let i = 0; i < 8; i++) {
    const aa = a + rand(-0.9, 0.9) * (1 + i * 0.15);
    const tx = u.x + Math.cos(aa) * d, ty = u.y + Math.sin(aa) * d;
    if (game.map.walk(Math.floor(tx), Math.floor(ty)) && setPath(game, u, tx, ty)) return true;
  }
  return false;
}

// ---------- Civili ----------
function civilianAI(game, u, dt) {
  const ai = u.ai || (u.ai = { state: 'idle', t: rand(0.5, 5) });
  ai.t -= dt;
  u.panic = Math.max(0, u.panic - dt);
  if (u.burn > 0) u.panic = Math.max(u.panic, 2);
  if (u.panic > 0) {
    if (ai.state !== 'flee' || !u.path) {
      ai.state = 'flee';
      const sx = ai.fx ?? u.x, sy = ai.fy ?? u.y;
      if (!fleeFrom(game, u, sx, sy, 10 + Math.random() * 6)) fleeFrom(game, u, u.x + rand(-1, 1), u.y + rand(-1, 1), 8);
    }
    if (!moveAlong(game, u, dt, 1)) {
      // rannicchiato: in panico ma senza via di fuga
      u.moving = false;
      u.cower = true;
    } else u.cower = false;
    return;
  }
  u.cower = false;
  if (ai.state === 'flee') { ai.state = 'idle'; ai.t = rand(2, 5); u.path = null; }
  if (ai.state === 'idle') {
    u.moving = false;
    if (ai.t <= 0) {
      const r = 6 + Math.random() * 10;
      const a = Math.random() * TAU;
      const tx = Math.floor(u.x + Math.cos(a) * r), ty = Math.floor(u.y + Math.sin(a) * r);
      if (game.map.walk(tx, ty) && game.map.k(tx, ty) !== 1 && (!game.map.reach || game.map.reach[ty * game.map.w + tx]) && setPath(game, u, tx + 0.5, ty + 0.5)) ai.state = 'walk';
      else ai.t = rand(0.5, 2);
    }
  } else if (ai.state === 'walk') {
    if (!moveAlong(game, u, dt, 0.9)) { ai.state = 'idle'; ai.t = rand(1.5, 6); }
  }
}

// ---------- Dispatcher NPC ----------
export function updateNPC(game, u, dt) {
  u.aimT = Math.max(0, (u.aimT || 0) - dt);
  if (u.shoveT > 0) { u.shoveT -= dt; return; } // spinto da un veicolo: lascia la carreggiata
  if (u.faction === 3) return civilianAI(game, u, dt);
  if (u.faction === 0 && u.persuaded) return allyAI(game, u, dt);
  hostileAI(game, u, dt);
}

function hasMedikit(u) { return u.weapons.some((w) => w.id === 'medikit' && w.ammo > 0); }

function hostileAI(game, u, dt) {
  const ai = ensureAI(u);
  ai.repathT -= dt; ai.strafeT -= dt; ai.flankT -= dt; ai.lookT -= dt; ai.thinkT -= dt;
  ai.noCover = Math.max(0, ai.noCover - dt);
  ai.retreatCD = Math.max(0, ai.retreatCD - dt);
  if (u.burn > 0 && ai.level < 3) { if (!u.path) fleeFrom(game, u, u.x + rand(-1, 1), u.y + rand(-1, 1), 4); moveAlong(game, u, dt, 1.2); return; }
  if (ai.level >= 2 && hasMedikit(u) && game.t - u.lastHurtT > 0.4 && u.hp < u.maxHp * (ai.level >= 3 ? 0.45 : 0.32)) useMedikit(game, u);

  // polizia senza allarme: pattuglia e intima di gettare le armi
  if (u.faction === 2 && game.heat <= 0) return policeCalm(game, u, ai, dt);

  perceive(game, u, ai, dt);

  switch (ai.state) {
    case 'idle': return idle(game, u, ai, dt);
    case 'suspicious': {
      u.moving = false;
      if (ai.seen) faceTarget(u, ai.seen.x, ai.seen.y, dt);
      // livello alto: avanza piano verso il sospetto
      if (ai.level >= 2 && ai.sus > 0.55 && ai.seen) {
        if (!u.path || ai.repathT <= 0) { setPath(game, u, ai.seen.x, ai.seen.y); ai.repathT = 1; }
        moveAlong(game, u, dt, 0.5);
      }
      return;
    }
    case 'alert': return search(game, u, ai, dt);
    case 'combat': return combat(game, u, ai, dt);
    case 'cover': {
      ai.coverT -= dt;
      const T = ai.target;
      if (u.path) moveAlong(game, u, dt, 1.2);
      else {
        u.moving = false;
        if (T?.alive) turnTo(u, Math.atan2(T.y - u.y, T.x - u.x), dt, 5);
        // posizione compromessa: risponde al fuoco
        if (T?.alive && ai.coverT > 0.4 && game.map.los(u.x, u.y, T.x, T.y)) ai.coverT = 0.25;
      }
      if (u.hp < u.maxHp * 0.6 && hasMedikit(u)) useMedikit(game, u);
      if (ai.coverT <= 0) { ai.state = 'combat'; ai.noCover = rand(2.2, 4); u.path = null; ai.strafeT = 0; game.releaseCover(u); }
      return;
    }
    case 'retreat': {
      ai.retreatT -= dt;
      if (!moveAlong(game, u, dt, 1.25) || ai.retreatT <= 0) { ai.state = 'combat'; ai.noCover = 0; ai.thinkT = 0; }
      return;
    }
    default: ai.state = 'idle';
  }
}

function perceive(game, u, ai, dt) {
  ai.scan -= dt;
  if (ai.scan > 0) return;
  const iv = 0.18 + Math.random() * 0.1 - (ai.level >= 3 ? 0.05 : 0);
  ai.scan = iv;
  const calm = ai.state === 'idle' || ai.state === 'suspicious';
  const sight = u.sight * (calm ? 1 : 1.35) * (1 + u.mods.eyes * 0.07) * (game.visMul || 1);
  const t = findTarget(game, u, sight, calm);
  if (!t) {
    ai.sus = Math.max(0, ai.sus - iv * 0.3);
    if (ai.state === 'suspicious' && ai.sus <= 0.05) { ai.state = 'idle'; u.path = null; }
    if (ai.state === 'idle') { const m = game.recall(u.faction, u); if (m) alertTo(game, u, m.x, m.y, 9); }
    return;
  }
  const d = dist(u, t);
  ai.seen = { x: t.x, y: t.y, t: game.t };
  if (calm) {
    // rilevamento graduale: distanza, arma in pugno, livello
    let rate = clamp(1.8 - d / sight, 0.3, 1.8) * (ai.level >= 3 ? 1.7 : ai.level === 2 ? 1.3 : 1);
    if (!drawn(t)) rate *= 0.4;
    if (t.moving) rate *= 1.15;
    if (d < 2.6 || (t === u.lastAttacker && game.t - u.lastHurtT < 5) || game.alarm) rate = 99;
    ai.sus += rate * iv * 1.5;
    if (ai.sus < 1) {
      if (ai.state !== 'suspicious' && ai.sus > 0.2) { ai.state = 'suspicious'; u.path = null; game.fx.text(u.x, u.y, '?', '#ffd24d', 0.8); }
      return;
    }
  }
  if (calm || ai.state === 'alert') {
    game.alertAllies(u, t);
    if (ai.level >= 2) game.fx.text(u.x, u.y, '!', '#ff5a5a', 0.8);
  }
  ai.target = t;
  ai.sus = 1;
  if (ai.state !== 'combat' && ai.state !== 'cover' && ai.state !== 'retreat') {
    ai.state = 'combat';
    ai.reactT = (calm ? 0.35 : 0.15) + Math.random() * 0.25 - (ai.level >= 3 ? 0.12 : 0);
    u.path = null;
  }
  game.remember(u.faction, t);
  if (u.faction === 2) game.heatT = Math.max(game.heatT, 10); // la polizia ti vede: l'allarme non cala
}

function idle(game, u, ai, dt) {
  if (u.patrol === 'random') {
    if (!u.path) {
      ai.t -= dt;
      if (ai.t <= 0) {
        const tx = Math.floor(u.home.x + rand(-8, 8)), ty = Math.floor(u.home.y + rand(-8, 8));
        if (game.map.walk(tx, ty) && setPath(game, u, tx + 0.5, ty + 0.5)) ai.t = rand(2, 6);
        else ai.t = 1;
      }
      lookAround(u, ai, dt);
    }
    moveAlong(game, u, dt, 0.7);
  } else if (Array.isArray(u.patrol) && u.patrol.length) {
    if (!u.path) {
      ai.t -= dt;
      if (ai.t <= 0) {
        const p = u.patrol[ai.patrolI % u.patrol.length];
        ai.patrolI++;
        setPath(game, u, p.x, p.y);
        ai.t = rand(0.5, 2.5);
      }
      lookAround(u, ai, dt);
    }
    moveAlong(game, u, dt, 0.65);
  } else {
    if (u.path) moveAlong(game, u, dt, 0.8);
    else { u.moving = false; lookAround(u, ai, dt); }
  }
}

function lookAround(u, ai, dt) {
  if (ai.lookT <= 0) { ai.look = u.dir + rand(-1.6, 1.6); ai.lookT = rand(2, 5); }
  if (ai.look !== undefined) turnTo(u, ai.look, dt, 2);
}

/** Indagine: raggiunge il punto, si guarda intorno, perlustra i dintorni, poi torna al posto. */
function search(game, u, ai, dt) {
  ai.alertT -= dt;
  if (ai.alertT <= 0) return giveUp(game, u, ai);
  if (u.path) { moveAlong(game, u, dt, ai.level >= 2 ? 1.1 : 1); return; }
  u.moving = false;
  ai.scanLook = (ai.scanLook ?? rand(0.8, 1.6)) - dt;
  u.dir += dt * 2.4 * (u.uid % 2 ? 1 : -1);
  if (ai.scanLook > 0) return;
  ai.scanLook = undefined;
  if (ai.searchN > 0 && ai.invest) {
    ai.searchN--;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * TAU, r = rand(3, 7);
      const tx = ai.invest.x + Math.cos(a) * r, ty = ai.invest.y + Math.sin(a) * r;
      if (game.map.walk(Math.floor(tx), Math.floor(ty)) && setPath(game, u, tx, ty)) return;
    }
  }
  giveUp(game, u, ai);
}

function giveUp(game, u, ai) {
  ai.state = 'idle';
  ai.invest = null;
  ai.sus = 0.3;
  ai.scanLook = undefined;
  if (!u.patrol) setPath(game, u, u.home.x, u.home.y);
  else u.path = null;
}

function npcShoot(game, u, ai, T, wi, w, dt) {
  if (!aimedAt(u, T.x, T.y, 0.28)) return;
  if (w.cd < 0.2) { // armi automatiche: raffiche intervallate
    if (ai.pause > 0) { ai.pause -= dt; return; }
    if (ai.burst <= 0) ai.burst = rand(0.45, 1.0) * (ai.level >= 3 ? 1.35 : 1);
    ai.burst -= dt;
    if (ai.burst <= 0) ai.pause = rand(0.3, 0.75) / (ai.level >= 3 ? 1.6 : 1);
  }
  // livello 3: anticipa il movimento del bersaglio
  let tx = T.x, ty = T.y;
  if (ai.level >= 3 && T.moving && T.path?.[T.pi]) {
    const p = T.path[T.pi], dd = Math.hypot(p.x - T.x, p.y - T.y) || 1;
    const lead = Math.min(0.6, dist(u, T) / 30) * T.baseSpeed;
    tx += ((p.x - T.x) / dd) * lead; ty += ((p.y - T.y) / dd) * lead;
  }
  fire(game, u, tx, ty, wi);
}

function outnumbered(game, u, T) {
  let foes = 0, mates = 0;
  for (const o of game.units) {
    if (!o.alive || Math.abs(o.x - u.x) > 10 || Math.abs(o.y - u.y) > 10) continue;
    if (o.faction === u.faction && o !== u) mates++;
    else if (game.hostile(u, o)) foes++;
  }
  return foes > mates + 1;
}

function combat(game, u, ai, dt) {
  const T = ai.target;
  if (ai.reactT > 0) { ai.reactT -= dt; u.moving = false; if (T?.alive) faceTarget(u, T.x, T.y, dt); return; }
  if (!T || !T.alive || T.vehicle || !game.hostile(u, T)) {
    ai.target = null;
    const s = ai.seen;
    ai.state = 'idle';
    if (s && game.t - s.t < 20) alertTo(game, u, s.x, s.y, 8);
    return;
  }
  const wi = u.attackIndex();
  if (wi < 0) {
    // disarmato: recupera un'arma a terra, altrimenti fugge
    const pk = nearestWeaponPickup(game, u, 9);
    if (pk) { if (!u.path || ai.repathT <= 0) { setPath(game, u, pk.x, pk.y); ai.repathT = 0.8; } }
    else if (!u.path) fleeFrom(game, u, T.x, T.y, 10);
    moveAlong(game, u, dt, 1.2);
    return;
  }
  if (u.cur !== wi) u.selectWeapon(wi);
  const w = WEAPONS[u.weapons[wi].id];
  const rng = w.range * u.rangeMul();
  const d = dist(u, T);
  const vis = d < Math.max(u.sight * 1.7, rng) && game.map.los(u.x, u.y, T.x, T.y);
  if (vis) { ai.seen = { x: T.x, y: T.y, t: game.t }; game.remember(u.faction, T); }

  // decisioni tattiche periodiche
  if (ai.thinkT <= 0) {
    ai.thinkT = 0.35 + Math.random() * 0.3;
    const hpF = u.hp / u.maxHp;
    if (ai.level >= 2 && hpF < 0.3 && !hasMedikit(u) && ai.retreatCD <= 0 && outnumbered(game, u, T)) {
      ai.retreatCD = 14;
      if (fleeFrom(game, u, T.x, T.y, 9)) { ai.state = 'retreat'; ai.retreatT = 3.5; game.fx.text(u.x, u.y, 'RIPIEGO!', '#ffb04d', 0.9); return; }
    }
    const pressed = u.suppress > 0.55 || hpF < 0.45 || (game.t - u.lastHurtT < 0.8 && hpF < 0.75);
    if (ai.level >= 2 && ai.noCover <= 0 && pressed) {
      const c = findCover(game, u, T, rng);
      if (c && setPath(game, u, c.x, c.y)) {
        ai.state = 'cover';
        ai.coverT = rand(1.4, 2.8) + u.suppress * 1.5;
        game.reserveCover(c, u);
        return;
      }
      ai.noCover = 1.5;
    }
  }

  const pref = Math.min(rng * 0.72, rng - 1);
  if (vis && d <= rng * 0.96) {
    faceTarget(u, T.x, T.y, dt);
    if (ai.level >= 3 && d < rng * 0.28 && ai.repathT <= 0 && w.range > 6) {
      fleeFrom(game, u, T.x, T.y, 4);
      ai.repathT = 1.2;
    } else if (ai.level >= 2 && ai.strafeT <= 0 && !u.path) {
      const a = Math.atan2(T.y - u.y, T.x - u.x) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      const r = rand(1, 2.5);
      const tx = u.x + Math.cos(a) * r, ty = u.y + Math.sin(a) * r;
      if (game.map.walk(Math.floor(tx), Math.floor(ty)) && game.map.los(tx, ty, T.x, T.y)) setPath(game, u, tx, ty);
      ai.strafeT = rand(1.4, 3.2);
    }
    if (u.path) moveAlong(game, u, dt, 0.75);
    else u.moving = false;
    npcShoot(game, u, ai, T, wi, w, dt);
    return;
  }
  // avvicinamento / aggiramento
  if (ai.repathT <= 0 || !u.path) {
    ai.repathT = 0.5 + Math.random() * 0.3;
    let dx = T.x, dy = T.y;
    if (!vis && ai.seen && game.t - ai.seen.t > 1.2) { dx = ai.seen.x; dy = ai.seen.y; }
    if (ai.level >= 2 && d > pref && ai.flankT <= 0) {
      ai.flankT = 1.2;
      const mates = game.units.filter((m) => m.alive && m.ai && m.ai.target === T && m.ai.state === 'combat' && m.faction === u.faction).sort((a, b) => a.uid - b.uid);
      if (mates.length >= 2) {
        const rank = mates.indexOf(u);
        const base = Math.atan2(u.y - T.y, u.x - T.x);
        const off = (rank - (mates.length - 1) / 2) * 0.8;
        const px = T.x + Math.cos(base + off) * pref, py = T.y + Math.sin(base + off) * pref;
        const nw = game.map.nearestWalk(Math.floor(px), Math.floor(py), 2);
        if (nw) { dx = nw[0] + 0.5; dy = nw[1] + 0.5; }
      }
    }
    setPath(game, u, dx, dy);
    if (!vis && ai.seen && game.t - ai.seen.t > 7) { ai.target = null; ai.state = 'idle'; alertTo(game, u, ai.seen.x, ai.seen.y, 7); return; }
  }
  moveAlong(game, u, dt, 1.12);
  if (vis) {
    faceTarget(u, T.x, T.y, dt);
    if (ai.level >= 2 && d < rng) npcShoot(game, u, ai, T, wi, w, dt);
  }
}

/** Cerca un riparo: tile senza linea di tiro dal bersaglio, preferibilmente a ridosso di un muro, vicino e non occupato. */
function findCover(game, u, T, rng) {
  const m = game.map;
  const ux = Math.floor(u.x), uy = Math.floor(u.y);
  let best = null, bs = -1e9;
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const r2 = dx * dx + dy * dy;
      if (r2 < 1 || r2 > 49) continue;
      const tx = ux + dx, ty = uy + dy;
      if (!m.walk(tx, ty)) continue;
      const cx = tx + 0.5, cy = ty + 0.5;
      const dT = Math.hypot(cx - T.x, cy - T.y);
      if (dT < 2.5 || dT > rng * 1.5) continue;
      const dS = Math.sqrt(r2);
      if (dS > dT + 1) continue; // non correre verso il nemico
      if (game.coverTaken(tx, ty, u)) continue;
      let adj = 0;
      if (m.blocksLOS(tx + 1, ty)) adj++;
      if (m.blocksLOS(tx - 1, ty)) adj++;
      if (m.blocksLOS(tx, ty + 1)) adj++;
      if (m.blocksLOS(tx, ty - 1)) adj++;
      const s = -dS * 1.1 + Math.min(adj, 2) * 1.6 - (adj ? 0 : 3) - Math.abs(dT - rng * 0.75) * 0.25;
      if (s <= bs) continue;
      if (m.los(cx, cy, T.x, T.y)) continue;
      bs = s; best = { x: cx, y: cy, tx, ty };
    }
  }
  return best;
}

// ---------- Polizia senza allarme ----------
function policeCalm(game, u, ai, dt) {
  if (ai.state === 'combat' || ai.state === 'cover' || ai.state === 'retreat' || ai.state === 'suspicious') { ai.state = 'idle'; ai.target = null; u.path = null; }
  ai.scan -= dt;
  if (ai.state === 'warn') {
    const t = ai.warnTarget;
    if (!t?.alive || t.vehicle) { ai.state = 'idle'; return; }
    const d = dist(u, t);
    faceTarget(u, t.x, t.y, dt);
    if (d > 4.5) {
      if (!u.path || ai.repathT <= 0) { setPath(game, u, t.x, t.y); ai.repathT = 0.6; }
      moveAlong(game, u, dt, 1.1);
    } else { u.path = null; u.moving = false; }
    ai.warnT -= dt;
    if (!drawn(t)) {
      game.fx.text(u.x, u.y, 'Circolare.', '#8fb4ff', 1.2);
      game.policeCool.set(t, game.t + 12);
      ai.state = 'idle';
      return;
    }
    if (ai.warnT <= 0) {
      game.fx.text(u.x, u.y, 'FERMO! POLIZIA!', '#ff5a5a', 1.2);
      ai.state = 'combat'; ai.target = t; ai.reactT = 0.15;
      game.addHeat(30, t);
    }
    return;
  }
  if (ai.scan <= 0) {
    ai.scan = 0.3 + Math.random() * 0.15;
    for (const a of game.agents) {
      if (!a.alive || a.vehicle || !drawn(a)) continue;
      if ((game.policeCool.get(a) ?? -1) > game.t) continue;
      const d = dist(u, a);
      if (d > u.sight * 0.85 * (game.visMul || 1)) continue;
      if (d > 3.2 && Math.abs(angDiff(u.dir, Math.atan2(a.y - u.y, a.x - u.x))) > 1.3) continue;
      if (!game.map.los(u.x, u.y, a.x, a.y)) continue;
      ai.state = 'warn'; ai.warnTarget = a; ai.warnT = 5.5 - ai.level * 0.5;
      game.fx.text(u.x, u.y, "GETTA L'ARMA!", '#ffd24d', 1.8);
      game.sfx('warn', u.x, u.y);
      if (!game.warnedOnce) { game.warnedOnce = true; game.toast("Polizia: \"Getta l'arma!\" — rinfodera con Z o affrontala", 'warn'); }
      return;
    }
  }
  idle(game, u, ai, dt);
}

// ---------- Alleati persuasi ----------
function leaderOf(game, u) {
  if (u.owner?.alive && u.owner.faction === 0) return u.owner;
  const n = game.nearestAgent(u.x, u.y);
  if (n) u.owner = n;
  return n;
}

function allyAI(game, u, dt) {
  const ai = ensureAI(u);
  ai.repathT -= dt; ai.scan -= dt;
  const leader = leaderOf(game, u);
  if (!leader) { u.moving = false; return; }
  // il capo e' salito su un veicolo: lo segue a bordo
  if (leader.vehicle) {
    const v = leader.vehicle;
    if (v.alive && v.passengers.length < v.V.seats) {
      if (dist(u, v) < 1.7) { game.enterVehicle(u, v); return; }
      if (!u.path || ai.repathT <= 0) { setPath(game, u, v.x, v.y); ai.repathT = 0.6; }
      moveAlong(game, u, dt, 1.3);
    } else u.moving = false;
    return;
  }
  const dl = dist(u, leader);
  const wi0 = u.attackIndex();
  // disarmato: raccoglie un'arma vicina
  if (wi0 < 0) {
    if (ai.scan <= 0) { ai.scan = 0.5; ai.pk = dl < 12 ? nearestWeaponPickup(game, u, 9) : null; }
    if (ai.pk && !ai.pk.taken) {
      if (!u.path || ai.repathT <= 0) { setPath(game, u, ai.pk.x, ai.pk.y); ai.repathT = 0.8; }
      moveAlong(game, u, dt, 1.15);
      return;
    }
  } else if (ai.scan <= 0) {
    ai.scan = 0.25;
    const w = WEAPONS[u.weapons[wi0].id];
    const rng = Math.max(w.range, u.sight);
    const ok = (t) => t && t.alive && !t.vehicle && game.hostile(u, t) && dist(u, t) < rng && game.map.los(u.x, u.y, t.x, t.y) ? t : null;
    const lo = leader.order;
    const assist = lo && lo.type === 'attack' && lo.target?.kind !== 'vehicle' ? lo.target : null;
    const threat = game.t - leader.lastHurtT < 3 ? leader.lastAttacker : null;
    ai.target = dl < 12 ? ok(assist) || ok(threat) || ok(leader.autoT) || findTarget(game, u, rng) : null;
  }
  if (wi0 >= 0 && ai.target?.alive && game.hostile(u, ai.target) && dist(leader, ai.target) < 16) {
    const wi = wi0;
    if (u.cur !== wi) u.selectWeapon(wi);
    const T = ai.target;
    const w = WEAPONS[u.weapons[wi].id];
    const rng = w.range * u.rangeMul();
    const d = dist(u, T);
    if (d <= rng * 0.95 && game.map.los(u.x, u.y, T.x, T.y)) {
      faceTarget(u, T.x, T.y, dt);
      u.path = null; u.moving = false;
      npcShoot(game, u, ai, T, wi, w, dt);
      return;
    }
    if (ai.repathT <= 0 || !u.path) { setPath(game, u, T.x, T.y); ai.repathT = 0.6; }
    moveAlong(game, u, dt, 1.1);
    return;
  }
  // formazione a ventaglio alle spalle del capo
  if (ai.repathT <= 0 || (!u.path && dl > 2.6)) {
    ai.repathT = 0.6;
    const flock = game.units.filter((o) => o.alive && o.persuaded && o.kind !== 'agent' && o.owner === leader && !o.vehicle).sort((a, b) => a.uid - b.uid);
    const idx = Math.max(0, flock.indexOf(u)), n = flock.length;
    const row = Math.floor(idx / 5), col = idx % 5, inRow = Math.min(5, n - row * 5);
    const back = leader.moving ? leader.dir + Math.PI : Math.atan2(u.y - leader.y, u.x - leader.x);
    const a = back + (col - (inRow - 1) / 2) * 0.5;
    const r = 1.7 + row * 1.1;
    let sx = leader.x + Math.cos(a) * r, sy = leader.y + Math.sin(a) * r;
    if (!game.map.walk(Math.floor(sx), Math.floor(sy))) { const nw = game.map.nearestWalk(Math.floor(sx), Math.floor(sy), 2); if (nw) { sx = nw[0] + 0.5; sy = nw[1] + 0.5; } else { sx = leader.x; sy = leader.y; } }
    if (Math.hypot(sx - u.x, sy - u.y) > 1.1) setPath(game, u, sx, sy);
    else u.path = null;
  }
  if (u.path) moveAlong(game, u, dt, dl > 6 ? 1.35 : 1.0);
  else { u.moving = false; turnTo(u, leader.dir, dt, 3); }
}
