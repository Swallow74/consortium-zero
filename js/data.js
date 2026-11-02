// Dati di gioco: armi, potenziamenti, tipi di unita'. Tutto originale.

export const WEAPONS = {
  persuadertron: { name: 'Persuadertron', abbr: 'PRS', type: 'persuade', range: 6.5, cd: 1.0, cost: 1500, tier: 0, noise: 0, desc: 'Converte civili e guardie. Capacita limitata dal cervello.' },
  pistol: { name: 'Pistola', abbr: 'PST', type: 'hit', dmg: 20, cd: 0.42, range: 8, spread: 0.05, pellets: 1, ammo: 60, cost: 100, tier: 0, noise: 13, tracer: '#ffe28a', snd: 'pistol', desc: 'Affidabile e silenziosa.' },
  shotgun: { name: 'Fucile a pompa', abbr: 'SHG', type: 'hit', dmg: 11, cd: 0.95, range: 6.5, spread: 0.2, pellets: 6, ammo: 24, cost: 450, tier: 0, noise: 18, tracer: '#ffc27a', snd: 'shotgun', desc: 'Devastante a corto raggio.' },
  uzi: { name: 'Uzi', abbr: 'UZI', type: 'hit', dmg: 8, cd: 0.085, range: 7.5, spread: 0.11, pellets: 1, ammo: 240, cost: 700, tier: 0, noise: 16, tracer: '#ffd36b', snd: 'uzi', desc: 'Cadenza altissima.' },
  medikit: { name: 'Medikit', abbr: 'MED', type: 'medikit', cd: 0.5, ammo: 1, cost: 300, tier: 0, heal: 110, desc: 'Ripristina la salute. Uso singolo.' },
  scanner: { name: 'Scanner', abbr: 'SCN', type: 'passive', cost: 500, tier: 0, desc: 'Radar a lungo raggio sulla minimappa.' },
  longrange: { name: 'Fucile di precisione', abbr: 'LNG', type: 'hit', dmg: 85, cd: 1.7, range: 17, spread: 0.004, pellets: 1, ammo: 18, cost: 2600, tier: 1, noise: 20, tracer: '#9ad8ff', snd: 'longrange', desc: 'Un colpo, un bersaglio.' },
  flamer: { name: 'Lanciafiamme', abbr: 'FLM', type: 'flame', dmg: 14, cd: 0.07, range: 4.6, ammo: 300, cost: 2000, tier: 1, noise: 12, snd: 'flame', desc: 'Brucia tutto nel cono.' },
  minigun: { name: 'Minigun', abbr: 'MNG', type: 'hit', dmg: 11, cd: 0.05, range: 9, spread: 0.13, pellets: 1, ammo: 700, cost: 4200, tier: 1, noise: 22, tracer: '#ff9a5a', snd: 'minigun', desc: 'Pioggia di piombo.' },
  shield: { name: 'Scudo energetico', abbr: 'SHD', type: 'passive', cost: 2400, tier: 1, desc: 'Assorbe il 60% dei danni finche regge.' },
  laser: { name: 'Fucile laser', abbr: 'LSR', type: 'beam', dmg: 46, cd: 0.7, range: 11, ammo: 36, cost: 3600, tier: 2, noise: 10, tracer: '#ff3b6b', snd: 'laser', desc: 'Raggio perforante.' },
  gauss: { name: 'Cannone Gauss', abbr: 'GSS', type: 'missile', dmg: 160, cd: 2.3, range: 13, ammo: 6, cost: 6200, tier: 2, noise: 30, radius: 3.0, snd: 'gauss', desc: 'Proiettile esplosivo ad area.' },
  access: { name: 'Tessera accesso', abbr: 'ACC', type: 'passive', cost: 1200, tier: 1, desc: 'Apre i cancelli di sicurezza.' },
  bomb: { name: 'Bomba a tempo', abbr: 'BMB', type: 'bomb', cd: 0.6, ammo: 2, cost: 900, tier: 1, dmg: 220, radius: 3.6, fuse: 4.5, desc: 'Piazzala e allontanati.' },
};

export const OFFENSIVE = new Set(['hit', 'flame', 'beam', 'missile']);

export const MODS = {
  legs: { name: 'Gambe', desc: 'Velocita di movimento', costs: [1200, 2600, 4800] },
  arms: { name: 'Braccia', desc: 'Precisione e cadenza', costs: [1200, 2600, 4800] },
  chest: { name: 'Torace', desc: 'Salute massima', costs: [1500, 3000, 5200] },
  heart: { name: 'Cuore', desc: 'Rigenerazione salute', costs: [1500, 3000, 5200] },
  eyes: { name: 'Occhi', desc: 'Portata di vista e tiro', costs: [1000, 2200, 4200] },
  brain: { name: 'Cervello', desc: 'Capacita di persuasione e IPA', costs: [2000, 4000, 7000] },
};

export const KINDS = {
  agent: { label: 'Agente', faction: 0, hp: 120, speed: 3.3, sight: 11, cost: 99, color: '#37e1ff' },
  civilian: { label: 'Civile', faction: 3, hp: 24, speed: 1.55, sight: 8, cost: 1, color: '#9aa4b8' },
  scientist: { label: 'Scienziato', faction: 3, hp: 26, speed: 1.6, sight: 8, cost: 2, color: '#d7efe0' },
  guard: { label: 'Guardia', faction: 1, hp: 70, speed: 2.6, sight: 10, cost: 3, color: '#ff7a3d', weapons: ['uzi'], ai: 1 },
  police: { label: 'Polizia', faction: 2, hp: 75, speed: 2.8, sight: 11, cost: 3, color: '#4d7bff', weapons: ['pistol'], ai: 1 },
  enemy: { label: 'Agente rivale', faction: 1, hp: 125, speed: 3.2, sight: 12, cost: 8, color: '#ff3b6b', weapons: ['uzi', 'medikit'], ai: 3 },
  vip: { label: 'Dirigente', faction: 1, hp: 95, speed: 2.4, sight: 9, cost: 7, color: '#ffd24d', weapons: ['pistol'], ai: 2 },
};

export const FACTION_NAMES = { 0: 'Sindacato', 1: 'Corporazione', 2: 'Polizia', 3: 'Civili' };

export const VEHICLE_TYPES = {
  car: { hp: 160, speed: 4.6, hx: 0.75, hy: 0.4, h: 0.38, cab: 0.28, seats: 4 },
  van: { hp: 220, speed: 3.8, hx: 0.9, hy: 0.46, h: 0.55, cab: 0.3, seats: 4 },
  armored: { hp: 700, speed: 3.2, hx: 1.0, hy: 0.52, h: 0.62, cab: 0.25, seats: 4 },
  police: { hp: 180, speed: 5.2, hx: 0.75, hy: 0.4, h: 0.38, cab: 0.28, seats: 4 },
};

export const BUILDING_STYLES = [
  { wall: '#3d4455', win: ['#ffd27a', '#ffe9b0', '#7af0ff'], roof: '#4a5266', neon: '#ff4fd8' },
  { wall: '#244a78', win: ['#7af0ff', '#bdf6ff', '#ffe9b0'], roof: '#2f5c8f', neon: '#4de0ff' },
  { wall: '#5e3a36', win: ['#ffd27a', '#ff9a5a', '#ffe9b0'], roof: '#6d4742', neon: '#ffb04d' },
  { wall: '#3c2e57', win: ['#ff7ad9', '#ffc4f1', '#7af0ff'], roof: '#4a3a6b', neon: '#ff4fd8' },
  { wall: '#1f5252', win: ['#8dffe0', '#d4fff4', '#ffe9b0'], roof: '#2a6767', neon: '#4dffc4' },
  { wall: '#69718a', win: ['#e8f4ff', '#a8d8ff', '#ffe9b0'], roof: '#7b849c', neon: '#7ab8ff' },
  { wall: '#1a1e2b', win: ['#ff6a5a', '#ffb04d', '#ff4f7b'], roof: '#262b3b', neon: '#ff3b6b' },
];

export const SCORING = { civilianPenalty: 250, agentLostPenalty: 0, speedBonusPerSec: 5 };
