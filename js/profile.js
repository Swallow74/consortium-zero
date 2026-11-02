import { WEAPONS, MODS, SCORING } from './data.js';

const KEY = 'syndicate-web-save-v1'; // chiave legacy: NON cambiare, preserva i salvataggi esistenti
const NAMES = ['Vega', 'Orion', 'Nyx', 'Rook', 'Sable', 'Iris', 'Kestrel', 'Zephyr', 'Mira', 'Talon'];

function newAgent(name) {
  return { name, alive: true, mods: { legs: 0, arms: 0, chest: 0, heart: 0, eyes: 0, brain: 0 }, loadout: ['pistol', 'persuadertron'], ipa: { a: 50, p: 50, i: 50 }, kills: 0 };
}

export function defaultProfile() {
  return {
    v: 1,
    money: 14000,
    agents: [0, 1, 2, 3].map((i) => newAgent(NAMES[i])),
    owned: ['pistol', 'persuadertron', 'medikit'],
    unlockedTier: 0,
    unlocked: [], // armi sbloccate dalle missioni
    completed: {},
    settings: { master: 0.8, sfx: 0.9, music: 0.45, edge: false, quality: 1, speed: 1, follow: false, lighting: true, weatherFx: true },
    recruitCount: 4,
  };
}

export function loadProfile() {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const p = JSON.parse(s);
      return { ...defaultProfile(), ...p, settings: { ...defaultProfile().settings, ...(p.settings || {}) } };
    }
  } catch (e) { /* ignora */ }
  return defaultProfile();
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignora */ }
}

export function resetProfile() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignora */ }
  return defaultProfile();
}

export function shopList(p) {
  return Object.entries(WEAPONS).map(([id, w]) => ({
    id, w,
    owned: p.owned.includes(id),
    available: w.tier === 0 || p.unlocked.includes(id),
  }));
}

export function buyWeapon(p, id) {
  const w = WEAPONS[id];
  if (!w || p.owned.includes(id)) return 'owned';
  if (!(w.tier === 0 || p.unlocked.includes(id))) return 'locked';
  if (p.money < w.cost) return 'money';
  p.money -= w.cost;
  p.owned.push(id);
  saveProfile(p);
  return 'ok';
}

export function modCost(agent, mod) {
  const lvl = agent.mods[mod];
  return lvl >= 3 ? null : MODS[mod].costs[lvl];
}

export function buyMod(p, agentIdx, mod) {
  const a = p.agents[agentIdx];
  const c = modCost(a, mod);
  if (!a.alive) return 'dead';
  if (c === null) return 'max';
  if (p.money < c) return 'money';
  p.money -= c;
  a.mods[mod]++;
  saveProfile(p);
  return 'ok';
}

export const RECRUIT_COST = 2500;
export function recruit(p, idx) {
  const a = p.agents[idx];
  if (a.alive) return 'alive';
  if (p.money < RECRUIT_COST) return 'money';
  p.money -= RECRUIT_COST;
  p.agents[idx] = newAgent(NAMES[(p.recruitCount++) % NAMES.length]);
  saveProfile(p);
  return 'ok';
}

export function equip(p, idx, id) {
  const a = p.agents[idx];
  if (!p.owned.includes(id) || a.loadout.includes(id) || a.loadout.length >= 8) return false;
  a.loadout.push(id);
  saveProfile(p);
  return true;
}
export function unequip(p, idx, id) {
  const a = p.agents[idx];
  a.loadout = a.loadout.filter((w) => w !== id);
  saveProfile(p);
}

/** Applica il risultato di una missione al profilo; ritorna il riepilogo per il debrief. */
export function applyResult(p, def, game) {
  const res = game.over?.result === 'win';
  const sum = { win: res, reason: game.over?.reason || '', reward: 0, bonus: 0, penalty: 0, unlocked: [], lost: [], time: game.t, stats: { ...game.stats } };
  for (const u of game.agents) {
    const a = u.profileRef;
    if (!a) continue;
    a.ipa = { a: u.ipa.a.t, p: u.ipa.p.t, i: u.ipa.i.t };
    a.kills = (a.kills || 0) + u.kills;
    if (!u.alive) { a.alive = false; sum.lost.push(a.name); }
  }
  if (res) {
    sum.reward = def.reward || 0;
    const par = def.parTime || 0;
    if (par && game.t < par) sum.bonus += Math.round((par - game.t) * SCORING.speedBonusPerSec);
    for (const o of game.mission.objectives) if (o.def.optional && o.done) sum.bonus += o.def.bonus || 0;
    sum.penalty = game.stats.civKills * SCORING.civilianPenalty;
    p.money += Math.max(0, sum.reward + sum.bonus - sum.penalty);
    for (const id of def.unlocks || []) if (!p.unlocked.includes(id)) { p.unlocked.push(id); sum.unlocked.push(id); }
    const prev = p.completed[def.id];
    if (!prev || game.t < prev.time) p.completed[def.id] = { time: Math.round(game.t) };
  }
  saveProfile(p);
  return sum;
}
