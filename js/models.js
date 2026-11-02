// models.js — modelli 3D parametrici e originali per il mondo di gioco:
// umani (agenti, civili, guardie, polizia, VIP, scienziati), veicoli, alberi,
// pickup, lampioni, props di tetto. Costruiti con le primitive di mesh3d.js.
import { mesh, box, prism, loft, loftRings, tube, ball, cone, rotZ } from './mesh3d.js';

const TAU = Math.PI * 2;

// ---------------- umanoide ----------------
/**
 * Personaggio in spazio locale (+x avanti, +y sinistra, +z su), ruotato di yaw.
 * pose: { yaw, moving, frame 0..7, aim, cower, hasGun, weapon }
 * look: { coat, trim, pants, skin, hair }. Ritorna { m, mats, tip } con tip =
 * bocca da fuoco in coordinate locali (nulla se senza arma).
 */
export function buildHuman(look, kind, pose) {
  const m = mesh();
  const mats = [
    { color: look.coat, kind: 'cloth' },
    { color: look.trim, kind: 'emit', glow: look.trim, glowB: 5 },
    { color: look.pants, kind: 'cloth' },
    { color: look.skin, kind: 'skin' },
    { color: look.hair, kind: 'cloth' },
    { color: '#141822', kind: 'dark' },
    { color: '#8791a8', kind: 'metal' },
    { color: '#2a3042', kind: 'dark' },
  ];
  const c = pose.cower ? 0.66 : 1;
  const Z = (z) => z * c;
  const moving = pose.moving && !pose.cower;
  const ph = moving ? (pose.frame % 8) / 8 * TAU : 0;
  const sw = moving ? Math.sin(ph) : 0;
  const B = moving ? Math.abs(Math.cos(ph)) * 0.014 : 0;

  const longCoat = kind === 'agent' || kind === 'enemy' || kind === 'vip';
  const lab = kind === 'scientist';

  // scarpe
  const hipZ = Z(0.37) + B, kneeZ = Z(0.2) + B, ankZ = Z(0.055) + B;
  for (const side of [-1, 1]) {
    const s = sw * side;
    const kx = s * 0.045, ax = s * 0.085;
    box(m, 5, ax + 0.018, side * 0.03, ankZ - 0.01, ankZ + 0.045, 0.058, 0.034);
  }
  // gambe
  for (const side of [-1, 1]) {
    const s = sw * side;
    const kx = s * 0.045, ax = s * 0.085;
    tube(m, 2, 2, [0, side * 0.028, hipZ], [kx, side * 0.03, kneeZ], 0.036, 0.03, 5, 0);
    tube(m, 2, 2, [kx, side * 0.03, kneeZ], [ax, side * 0.03, ankZ], 0.03, 0.022, 5, 0);
  }

  // busto a anelli esagonali
  const hemZ = Z(longCoat ? 0.26 : lab ? 0.33 : 0.37) + B;
  const waistZ = Z(0.42) + B, chestZ = Z(0.55) + B, shZ = Z(0.625) + B;
  const rings = longCoat || lab
    ? [{ z: hemZ, rx: 0.073, ry: 0.056 }, { z: waistZ, rx: 0.046, ry: 0.052 }, { z: chestZ, rx: 0.055, ry: 0.047 }, { z: shZ, rx: 0.046, ry: 0.074 }]
    : [{ z: hemZ, rx: 0.048, ry: 0.052 }, { z: chestZ, rx: 0.055, ry: 0.047 }, { z: shZ, rx: 0.046, ry: 0.074 }];
  loftRings(m, 0, rings, 6, 0);
  if (longCoat) {
    loft(m, 5, 0, 0, waistZ + 0.005, 0.05, 0.056, waistZ + 0.028, 0.05, 0.056, 6, 0, null, 0);
    box(m, 1, 0.052, 0, waistZ + 0.02, shZ - 0.01, 0.006, 0.013); // risvolto luminoso frontale
  }
  if (lab) {
    box(m, 1, 0.056, 0.01, chestZ - 0.07, chestZ + 0.01, 0.005, 0.012); // risvolto camice
    box(m, 5, 0.012, 0.062, chestZ - 0.045, chestZ + 0.005, 0.018, 0.034); // cartelletta
  }
  if (!lab) loft(m, 0, 0, 0, shZ - 0.005, 0.052, 0.064, Z(0.668) + B, 0.032, 0.038, 6, 0, null, 0); // colletto

  // collo + testa
  const neckZ = Z(0.64) + B, headZ = Z(0.72) + B;
  tube(m, 3, 3, [0, 0, neckZ], [0, 0, headZ - 0.02], 0.02, 0.02, 5, 0);
  ball(m, 3, 0, 0, headZ, 0.038, 0.037, 0.045, 8, 3);

  // copricapi
  if (kind === 'police') {
    loft(m, 5, 0, 0, headZ + 0.012, 0.042, 0.040, headZ + 0.052, 0.03, 0.028, 8, 0, null, 2);
    box(m, 5, 0.038, 0, headZ + 0.004, headZ + 0.016, 0.024, 0.04); // visiera
    box(m, 1, 0.022, 0, headZ + 0.048, headZ + 0.058, 0.012, 0.012); // distintivo
  } else if (kind === 'guard') {
    loft(m, 4, 0, 0, headZ + 0.002, 0.043, 0.041, headZ + 0.044, 0.026, 0.024, 8, 0, { x: -0.004 }, 2);
    box(m, 1, 0.04, 0, headZ + 0.02, headZ + 0.028, 0.014, 0.01); // visierina berretto
  } else {
    loft(m, 4, 0, 0, headZ - 0.008, 0.043, 0.041, headZ + 0.042, 0.018, 0.018, 8, 0, { x: kind === 'vip' ? 0.002 : -0.008 }, 2);
  }
  if (kind === 'agent' || kind === 'enemy') {
    box(m, 1, 0.031, 0, headZ + 0.006, headZ + 0.026, 0.01, 0.034); // visore luminoso
    box(m, 1, 0.014, 0.022, headZ + 0.012, headZ + 0.02, 0.018, 0.012);
  }
  if (kind === 'vip') { box(m, 5, 0.03, 0, headZ - 0.004, headZ + 0.008, 0.01, 0.03); } // baffi occhiali scuri

  // braccia + arma
  const aSw = moving ? -sw * 0.05 : 0;
  const armed = pose.hasGun && pose.aim === false;
  const aiming = pose.hasGun && pose.aim;
  const tip = pose.hasGun ? gunMesh(m, pose.weapon) : null;
  for (const side of [-1, 1]) {
    const shY = side * 0.07;
    if (aiming || armed) {
      const el = [0.07, side * 0.05, chestZ - 0.02];
      const ha = side > 0 ? [0.14, 0.02, chestZ - 0.03] : [0.11, 0.035, chestZ - 0.025];
      tube(m, 0, 3, [0.014, shY, shZ - 0.012], el, 0.026, 0.021, 5, 0);
      tube(m, 0, 3, el, ha, 0.021, 0.016, 5, 2);
    } else if (pose.cower) {
      tube(m, 0, 3, [0, shY, shZ - 0.012], [0.01, side * 0.088, waistZ - 0.02], 0.026, 0.02, 5, 2);
    } else {
      const ex = aSw * (side > 0 ? 1 : -1);
      tube(m, 0, 3, [0, shY, shZ - 0.012], [ex * 0.5, shY + side * 0.008, chestZ - 0.06], 0.026, 0.021, 5, 0);
      tube(m, 0, 3, [ex * 0.5, shY + side * 0.008, chestZ - 0.06], [ex, shY + side * 0.012, waistZ + 0.015], 0.021, 0.016, 5, 2);
    }
  }
  if (pose.weapon === 'flamer') {
    tube(m, 7, 6, [-0.058, 0, chestZ - 0.04], [-0.058, 0, shZ + 0.04], 0.032, 0.028, 6, 3);
    tube(m, 6, 6, [-0.05, 0.02, shZ + 0.02], [-0.01, 0.05, chestZ - 0.02], 0.007, 0.007, 4, 0);
  }

  rotZ(m, pose.yaw);
  let t2 = tip;
  if (t2) { const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw); t2 = [cy * t2[0] - sy * t2[1], sy * t2[0] + cy * t2[1], t2[2]]; }
  return { m, mats, tip: t2 };
}

// ---------------- armi (addITIVE all'umanoide, mano destra avanti) ----------------
function gunMesh(m, id) {
  const G = 6, GD = 7, E = 1;
  const z = 0.505, x = 0.15;
  switch (id) {
    case 'persuadertron':
      box(m, GD, x - 0.02, 0.02, z - 0.025, z + 0.01, 0.022, 0.016);
      cone(m, E, x + 0.045, 0.02, z + 0.03, z, 0.03, 6, { ry: Math.PI / 2 });
      return [x + 0.06, 0.02, z + 0.005];
    case 'gauss':
      box(m, GD, x + 0.04, 0.02, z - 0.028, z + 0.022, 0.078, 0.026);
      tube(m, G, E, [x + 0.11, 0.02, z], [x + 0.17, 0.02, z], 0.016, 0.022, 6, 2);
      return [x + 0.18, 0.02, z];
    case 'minigun':
      box(m, GD, x + 0.015, 0.02, z - 0.022, z + 0.028, 0.048, 0.023);
      box(m, G, x - 0.03, 0.048, z - 0.05, z - 0.01, 0.024, 0.026);
      for (const oy of [-0.009, 0.009]) tube(m, G, G, [x + 0.06, 0.02 + oy, z], [x + 0.17, 0.02 + oy, z], 0.008, 0.008, 4, 0);
      return [x + 0.18, 0.02, z];
    case 'longrange':
      box(m, GD, x + 0.025, 0.02, z - 0.018, z + 0.005, 0.065, 0.017);
      box(m, G, x + 0.015, 0.02, z + 0.012, z + 0.023, 0.032, 0.011);
      tube(m, GD, GD, [x + 0.08, 0.02, z - 0.006], [x + 0.2, 0.02, z], 0.007, 0.006, 4, 0);
      return [x + 0.21, 0.02, z];
    case 'shotgun':
      box(m, GD, x + 0.015, 0.02, z - 0.018, z + 0.005, 0.052, 0.019);
      tube(m, G, G, [x + 0.06, 0.02, z - 0.005], [x + 0.16, 0.02, z - 0.002], 0.011, 0.009, 5, 0);
      box(m, 5, x - 0.05, 0.02, z - 0.03, z + 0.005, 0.024, 0.015);
      return [x + 0.17, 0.02, z - 0.002];
    case 'laser':
      box(m, GD, x + 0.02, 0.02, z - 0.018, z + 0.012, 0.055, 0.019);
      box(m, E, x + 0.085, 0.02, z - 0.01, z + 0.014, 0.012, 0.021);
      return [x + 0.098, 0.02, z + 0.002];
    case 'flamer':
      box(m, GD, x + 0.01, 0.02, z - 0.016, z + 0.008, 0.042, 0.019);
      tube(m, G, G, [x + 0.05, 0.02, z - 0.005], [x + 0.14, 0.02, z + 0.002], 0.01, 0.006, 5, 0);
      return [x + 0.15, 0.02, z + 0.002];
    case 'uzi':
      box(m, GD, x + 0.005, 0.02, z - 0.022, z + 0.008, 0.036, 0.019);
      box(m, GD, x - 0.012, 0.02, z - 0.055, z - 0.022, 0.013, 0.013);
      tube(m, G, G, [x + 0.04, 0.02, z], [x + 0.08, 0.02, z], 0.007, 0.006, 4, 0);
      return [x + 0.09, 0.02, z];
    default: // pistol
      box(m, GD, x - 0.002, 0.02, z - 0.02, z + 0.005, 0.028, 0.017);
      tube(m, G, G, [x + 0.02, 0.02, z - 0.001], [x + 0.06, 0.02, z], 0.007, 0.006, 4, 0);
      return [x + 0.068, 0.02, z];
  }
}

// ---------------- veicoli ----------------
export const VEH_SPEC = {
  car: { hx: 0.75, hy: 0.40, zt: 0.38, cab: true, wheel: 0.135, turret: false },
  police: { hx: 0.75, hy: 0.40, zt: 0.38, cab: true, wheel: 0.135, turret: false, bar: true },
  van: { hx: 0.90, hy: 0.46, zt: 0.55, cab: false, wheel: 0.155, turret: false },
  armored: { hx: 1.00, hy: 0.52, zt: 0.52, cab: true, wheel: 0.16, turret: true },
};

/** Veicolo locale +x avanti; heading 1..4 => yaw; top = quota torretta/faro. */
export function buildVehicle(type, color, heading, o = {}) {
  const D = VEH_SPEC[type] || VEH_SPEC.car;
  const dead = !!o.dead;
  const m = mesh();
  const body = dead ? '#26272e' : color;
  const mats = [
    { color: body, kind: 'metal' },
    { color: dead ? '#141519' : '#11141c', kind: 'dark' },
    { color: dead ? '#161c26' : '#16273b', kind: 'glass', a: 0.94 },
    { color: dead ? '#2c2e33' : '#9aa4b8', kind: 'metal' },
    { color: dead ? '#1a1a1a' : '#fff6c8', kind: 'emit', glow: '#ffe9a0', glowB: 7 },
    { color: dead ? '#1a1a1a' : '#ff3344', kind: 'emit', glow: '#ff2a3a', glowB: 7 },
    { color: '#3d3f52', kind: 'metal' },
    { color: dead ? '#1a1a1a' : '#3b6bff', kind: 'emit', glow: '#3b6bff', glowB: 7 },
  ];
  const { hx, hy, zt, wheel: wr } = D;
  // ruote (assi lungo y)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const xw = sx * hx * 0.58, yw = sy * hy * 0.9;
    tube(m, 1, 3, [xw, yw - 0.075, wr], [xw, yw + 0.075, wr], wr, wr * 0.96, 8, 3);
    tube(m, 3, 3, [xw, yw + 0.075, wr], [xw, yw + 0.095, wr], wr * 0.45, wr * 0.45, 6, 0);
  }
  // telaio
  prism(m, 0, 0, 0, [[0.09, hx * 0.88, hy * 0.88], [zt, hx, hy]]);
  if (D.cab) {
    const cH = type === 'armored' ? 0.22 : 0.15;
    // cofano + bagagliaio ribassati
    prism(m, 0, 0, 0, [[zt - 0.02, hx * 0.33, hy * 0.86, hx * 0.63, 0], [zt + 0.05, hx * 0.22, hy * 0.8, hx * 0.63, 0]]);
    prism(m, 0, 0, 0, [[zt - 0.02, hx * 0.30, hy * 0.86, -hx * 0.68, 0], [zt + 0.04, hx * 0.20, hy * 0.8, -hx * 0.68, 0]]);
    // abitacolo vetro con parabrezza inclinato
    prism(m, 2, 0, 0, [[zt + 0.01, 0.33, hy * 0.8, 0.06, 0], [zt + cH, 0.3, hy * 0.72, -0.06, 0]], null, 2);
    prism(m, 0, 0, 0, [[zt + cH - 0.01, 0.32, hy * 0.76, -0.04, 0], [zt + cH + 0.03, 0.28, hy * 0.66, -0.04, 0]]); // tetto
    if (type === 'armored') {
      tube(m, 1, 3, [0, 0, zt + cH + 0.04], [0, 0, zt + cH + 0.12], 0.17, 0.15, 8, 3); // torretta
      box(m, 3, 0, 0, zt + cH + 0.11, zt + cH + 0.14, 0.07, 0.07);
    }
    if (D.bar) {
      box(m, 1, -0.04, 0, zt + cH + 0.03, zt + cH + 0.05, 0.13, 0.13); // alloggio barra
      box(m, 5, -0.04, 0.055, zt + cH + 0.045, zt + cH + 0.09, 0.11, 0.055);
      box(m, 7, -0.04, -0.055, zt + cH + 0.045, zt + cH + 0.09, 0.11, 0.055);
    }
  } else {
    // furgone: tetto alto + parabrezza
    prism(m, 2, 0, 0, [[zt - 0.14, 0.2, hy * 0.86, hx * 0.66, 0], [zt + 0.02, 0.16, hy * 0.8, hx * 0.84, 0]], null, 0);
    prism(m, 0, 0, 0, [[zt, hx * 0.94, hy * 0.94, -hx * 0.06, 0], [zt + 0.07, hx * 0.9, hy * 0.9, -hx * 0.06, 0]]);
    box(m, 1, hx * 0.97, 0, zt - 0.06, zt + 0.05, 0.02, hy * 0.5); // portellone scuro
  }
  // paraurti + luci
  box(m, 1, hx * 1.0, 0, 0.1, 0.2, 0.05, hy * 0.86);
  box(m, 1, -hx * 1.0, 0, 0.1, 0.2, 0.05, hy * 0.86);
  if (!dead) {
    box(m, 4, hx * 1.0, hy * 0.6, zt - 0.1, zt - 0.02, 0.03, 0.07);
    box(m, 4, hx * 1.0, -hy * 0.6, zt - 0.1, zt - 0.02, 0.03, 0.07);
    box(m, 5, -hx * 1.0, hy * 0.6, zt - 0.1, zt - 0.02, 0.03, 0.07);
    box(m, 5, -hx * 1.0, -hy * 0.6, zt - 0.1, zt - 0.02, 0.03, 0.07);
  }
  rotZ(m, heading === 1 ? 0 : heading === 2 ? Math.PI : heading === 3 ? Math.PI / 2 : -Math.PI / 2);
  const top = D.turret ? zt + 0.36 : D.bar ? zt + 0.24 : D.cab ? zt + 0.18 : zt + 0.07;
  return { m, mats, top };
}

// ---------------- alberi ----------------
export function buildTree(seed, sway, trunk, cols) {
  const m = mesh();
  const mats = [
    { color: trunk, kind: 'cloth' },
    { color: cols[0], kind: 'cloth' },
    { color: cols[1], kind: 'cloth' },
    { color: cols[2], kind: 'cloth' },
  ];
  const j = (i) => ((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
  const lean = (j(0) - 0.5) * 0.06;
  tube(m, 0, 0, [0, 0, 0], [lean * 0.4, 0, 0.4], 0.06, 0.045, 5, 0);
  tube(m, 0, 0, [lean * 0.4, 0, 0.4], [lean + sway * 0.05, j(3) * 0.06 - 0.03, 0.62], 0.045, 0.02, 5, 0);
  const base = 0.3 + j(1) * 0.1;
  ball(m, 1, lean * 0.6 + sway * 0.03, j(2) * 0.08 - 0.04, base + 0.12, base * 0.62, base * 0.56, base * 0.4, 6, 2);
  ball(m, 2, lean + sway * 0.05, j(4) * 0.06 - 0.03, base + 0.3, base * 0.5, base * 0.45, base * 0.32, 6, 2);
  ball(m, 3, lean * 1.2 + sway * 0.08, 0, base + 0.46, base * 0.3, base * 0.27, base * 0.2, 6, 2);
  return { m, mats };
}

// ---------------- pickup ----------------
export function buildPickup(col, glowCol, yaw, quest) {
  const m = mesh();
  const mats = [
    { color: col, kind: quest ? 'metal' : 'matte', glow: glowCol, glowB: quest ? 9 : 7 },
    { color: '#0a141c', kind: 'dark' },
    { color: '#e8f4ff', kind: 'metal' },
  ];
  const bevel = quest ? 0.1 : 0.115;
  prism(m, 0, 0, 0, [[0.02, bevel * 0.85, bevel * 0.68], [0.05, bevel, bevel * 0.74], [0.1, bevel, bevel * 0.74], [0.13, bevel * 0.85, bevel * 0.68]], null, 3);
  if (quest) {
    tube(m, 2, 2, [-0.03, 0, 0.132], [-0.02, 0, 0.155], 0.011, 0.011, 4, 0);
    tube(m, 2, 2, [-0.02, 0, 0.155], [0.02, 0, 0.155], 0.012, 0.012, 4, 0);
    tube(m, 2, 2, [0.02, 0, 0.155], [0.03, 0, 0.132], 0.011, 0.011, 4, 0);
    box(m, 2, 0.105, 0, 0.055, 0.075, 0.012, 0.03);
  } else {
    prism(m, 2, 0, 0, [[0.1, 0.07, 0.05, 0, 0], [0.115, 0.06, 0.04, 0, 0]]);
  }
  rotZ(m, yaw);
  return { m, mats };
}

// ---------------- lampione ----------------
export function buildLamp() {
  const m = mesh();
  const mats = [
    { color: '#6a7390', kind: 'metal' },
    { color: '#2a3042', kind: 'dark' },
    { color: '#ffe8a8', kind: 'emit', glow: '#ffd27a', glowB: 9 },
  ];
  box(m, 1, 0, 0, 0, 0.07, 0.06, 0.06);
  tube(m, 0, 0, [0, 0, 0.05], [0, 0, 1.02], 0.026, 0.018, 6, 0);
  tube(m, 0, 0, [0, 0, 1.0], [0.15, 0, 1.06], 0.016, 0.012, 5, 0);
  cone(m, 1, 0.16, 0, 1.05, 0.99, 0.075, 6);
  ball(m, 2, 0.16, 0, 0.975, 0.05, 0.05, 0.03, 6, 1);
  return { m, mats };
}

// ---------------- props di tetto ----------------
export function buildRoofProps(seed, roof, wall) {
  const m = mesh();
  const mats = [
    { color: roof, kind: 'matte' },
    { color: wall, kind: 'matte' },
    { color: '#3a4152', kind: 'metal' },
    { color: '#141822', kind: 'dark' },
    { color: '#9aa4bd', kind: 'metal' },
  ];
  const R = 0.455;
  for (const [x, y, hx, hy] of [[0, -R, 0.46, 0.04], [0, R, 0.46, 0.04], [-R, 0, 0.04, 0.46], [R, 0, 0.04, 0.46]])
    box(m, 0, x, y, 0, 0.07, hx, hy, null, 2);
  const j = (i) => ((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
  const n = 1 + Math.floor(j(0) * 2);
  for (let i = 0; i < n; i++) {
    const px = (j(i + 1) - 0.5) * 0.5, py = (j(i + 4) - 0.5) * 0.5;
    box(m, 2, px, py, 0.04, 0.13, 0.09, 0.06);
    tube(m, 3, 3, [px, py, 0.13], [px, py, 0.16], 0.045, 0.045, 6, 2);
    if (j(i + 7) < 0.5) box(m, 4, px + 0.11, py, 0.04, 0.09, 0.02, 0.05); // quadro elettrico
  }
  if (j(9) < 0.35) { //-botola
    prism(m, 1, (j(10) - 0.5) * 0.4, (j(11) - 0.5) * 0.4, [[0.03, 0.1, 0.08], [0.05, 0.1, 0.08]]);
  }
  if (j(12) < 0.3) { // cisterna
    tube(m, 2, 4, [(j(13) - 0.5) * 0.3, (j(14) - 0.5) * 0.3, 0.07], [(j(13) - 0.5) * 0.3, (j(14) - 0.5) * 0.3, 0.22], 0.1, 0.09, 8, 2);
  }
  return { m, mats };
}

// ---------------- recinzione ----------------
// (le recinzioni restano su box() in render.js: sono piatte e Cache-friendly)
