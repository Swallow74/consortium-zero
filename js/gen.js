import { rng } from './util.js';

// Tile che bloccano la flood-fill dei blocchi (strade, erba/viali, acqua, e quanto dipinto dopo).
const ROAD_CH = '><^vX=';
const isRoadCh = (c) => ROAD_CH.includes(c);

/**
 * Generatore di citta' procedurale. Restituisce { ascii:string[], anchors:{nome:[x,y]} }.
 * Opzioni: w,h,seed,block,roads,park,plaza,heightBias,ring,margin,
 *          layout: grid|distretti|radiale|organico|auto,
 *          water: none|south|east|fiume|baia
 */
export function generateCity(o = {}) {
  const r = rng(o.seed ?? 1);
  const W = o.w || 56, H = o.h || 56;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const gapMin = o.block || 11;
  const cx = W / 2, cy = H / 2;

  // ---- anello perimetrale a corsie opposte: tutte le arterie si chiudono su di esso ----
  const RM = Math.max(2, o.ring ?? 3); // corsie esterne a RM tile dal bordo
  const inR = W - 1 - RM, inB = H - 1 - RM;
  const setLane = (x, y, ch) => { if (g[y] && g[y][x] !== undefined) g[y][x] = g[y][x] === '.' ? ch : 'X'; };
  // anello rettangolare a doppia corsia (usato per il perimetro e per gli anelli radiali interni)
  const rectRing = (x0, y0, x1, y1) => {
    for (let x = x0; x <= x1; x++) {
      setLane(x, y0, '>'); setLane(x, y0 + 1, '<');
      setLane(x, y1 - 1, '>'); setLane(x, y1, '<');
    }
    for (let y = y0; y <= y1; y++) { setLane(x0, y, '^'); setLane(x0 + 1, y, 'v'); setLane(x1 - 1, y, '^'); setLane(x1, y, 'v'); }
    // angoli: giunzioni curve 2x2 (le corsie svoltano qui, regola "curve solo agli incroci")
    for (const [ax, ay] of [[x0, y0], [x1 - 1, y0], [x0, y1 - 1], [x1 - 1, y1 - 1]])
      for (const dy of [0, 1]) for (const dx of [0, 1]) if (g[ay + dy]) g[ay + dy][ax + dx] = 'X';
  };
  rectRing(RM, RM, inR, inB);

  // ---- layout: griglia storica, quartieri misti, anelli radiali, tessuto organico ----
  // default 'grid' preserva le mappe esistenti; 'auto' pesca dal seed per diversita'
  const LAYOUTS = ['grid', 'distretti', 'radiale', 'organico'];
  const auto = o.layout === 'auto';
  let layout = auto ? LAYOUTS[Math.floor(r() * 4)] : LAYOUTS.includes(o.layout) ? o.layout : 'grid';

  const m0 = Math.max(o.margin ?? 6, RM + 3);
  const vr = [], hr = [];
  // vialetti erba (viali pedonali): non sono corsie, i veicoli non li usano
  const paths = [];

  const fillGrass = (x, y) => { if (g[y] && g[y][x] === '.') g[y][x] = ','; };
  function diagonal(fx0, fy0, fx1, fy1) {
    const steps = Math.max(Math.abs(fx1 - fx0), Math.abs(fy1 - fy0));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      const x = Math.round(fx0 + (fx1 - fx0) * t);
      const y = Math.round(fy0 + (fy1 - fy0) * t);
      fillGrass(x, y); fillGrass(x + 1, y); fillGrass(x, y + 1);
    }
  }

  if (layout === 'grid') {
    for (let x = m0; x < inR - 2; x += 2 + gapMin + Math.floor(r() * 4)) vr.push(x);
    for (let y = m0; y < inB - 2; y += 2 + gapMin + Math.floor(r() * 4)) hr.push(y);
    // arterie da anello ad anello: nessun moncone, ogni strada ricade in un circuito chiuso
    for (const y of hr) for (let x = RM; x <= inR; x++) { setLane(x, y, '>'); setLane(x, y + 1, '<'); }
    for (const x of vr) for (let y = RM; y <= inB; y++) { setLane(x, y, 'v'); setLane(x + 1, y, '^'); }
    for (const y of hr) for (const x of vr) for (const dy of [0, 1]) for (const dx of [0, 1]) g[y + dy][x + dx] = 'X';
  } else if (layout === 'distretti') {
    // densità per zona: blocco piccolo dentro un raggio, grande fuori (centro storico + supra-blocchi)
    const sx = m0 + Math.floor((0.3 + r() * 0.4) * (inR - 2 - m0));
    const sy = m0 + Math.floor((0.3 + r() * 0.4) * (inB - 2 - m0));
    const smallG = Math.max(5, Math.round(gapMin * 0.5));
    const bigG = gapMin + 8;
    for (let x = m0; x < inR - 2;) {
      vr.push(x);
      const insideX = Math.abs(x - sx) < (inR - 2 - m0) * 0.32;
      x += 2 + (insideX ? smallG : bigG) + Math.floor(r() * 4);
    }
    for (let y = m0; y < inB - 2;) {
      hr.push(y);
      const insideY = Math.abs(y - sy) < (inB - 2 - m0) * 0.32;
      y += 2 + (insideY ? smallG : bigG) + Math.floor(r() * 4);
    }
    for (const y of hr) for (let x = RM; x <= inR; x++) { setLane(x, y, '>'); setLane(x, y + 1, '<'); }
    for (const x of vr) for (let y = RM; y <= inB; y++) { setLane(x, y, 'v'); setLane(x + 1, y, '^'); }
    for (const y of hr) for (const x of vr) for (const dy of [0, 1]) for (const dx of [0, 1]) g[y + dy][x + dx] = 'X';
    paths.push([m0, RM + 1, inR, inB]);
    paths.push([RM + 1, inB, inR, m0]);
  } else if (layout === 'radiale') {
    // assi radiali pieni + anelli concentrici chiusi (tipo Moscovia/Osaka): rete sempre connessa,
    // ogni moncone di anello ricade in un incrocio a X con un asse
    vr.push(Math.floor(cx - 2 - r() * 6), Math.floor(cx + 2 + r() * 6));
    hr.push(Math.floor(cy - 2 - r() * 5), Math.floor(cy + 2 + r() * 5));
    for (const x of vr) for (let y = RM; y <= inB; y++) { setLane(x, y, 'v'); setLane(x + 1, y, '^'); }
    for (const y of hr) for (let x = RM; x <= inR; x++) { setLane(x, y, '>'); setLane(x, y + 1, '<'); }
    const rings = [];
    const ax = (inR - RM) / 2, ay = (inB - RM) / 2;
    for (const k of [0.38 + r() * 0.12, 0.72 + r() * 0.14]) {
      const x0 = Math.round(RM + ax * (1 - k) + (r() - 0.5) * 3);
      const x1 = Math.round(inR - ax * (1 - k) + (r() - 0.5) * 3);
      const y0 = Math.round(RM + ay * (1 - k) + (r() - 0.5) * 3);
      const y1 = Math.round(inB - ay * (1 - k) + (r() - 0.5) * 3);
      if (x1 - x0 >= 10 && y1 - y0 >= 10) { rectRing(x0, y0, x1, y1); rings.push([x0, y0, x1, y1]); }
    }
    for (const y of hr) for (const x of vr) for (const dy of [0, 1]) for (const dx of [0, 1]) g[y + dy][x + dx] = 'X';
    paths.push([RM + 1, RM + 1, Math.floor(cx), Math.floor(cy)]);
    paths.push([inR, inB, Math.floor(cx), Math.floor(cy)]);
  } else {
    // organico: le verticali tagliano la città da bordo a bordo, gli orizzontali sono
    // tratti che finiscono a T su una verticale → isolati irregolari, tessitura medievale
    const nv = 3 + Math.floor(r() * 3);
    for (let i = 0; i < nv; i++) {
      const x = Math.floor(m0 + (i + 0.35 + r() * 0.3) * ((inR - 2 - m0) / nv));
      if (x > m0 && x < inR - 2 && vr.every((v) => Math.abs(v - x) > 3)) vr.push(x);
    }
    vr.sort((a, b) => a - b);
    for (const x of vr) for (let y = RM; y <= inB; y++) { setLane(x, y, 'v'); setLane(x + 1, y, '^'); }
    const lines = 3 + Math.floor(r() * 3);
    for (let i = 0; i < lines; i++) {
      const y = Math.floor(m0 + (i + 0.2 + r() * 0.6) * ((inB - 2 - m0) / lines));
      if (y < m0 || y > inB - 2) continue;
      const anchorsX = [RM, ...vr, inR];
      let a = anchorsX[Math.floor(r() * anchorsX.length - 1)] ?? RM;
      let b = anchorsX[Math.min(anchorsX.length - 1, anchorsX.indexOf(a) + 1 + Math.floor(r() * 3))];
      if (b - a < 6) { a = RM; b = inR; } // qualche corso lungo, non solo viottoli
      hr.push({ y, x0: a, x1: b });
      for (let x = a; x <= b; x++) { setLane(x, y, '>'); setLane(x, y + 1, '<'); }
    }
    for (const y of hr) for (const x of vr) if (x >= y.x0 && x + 2 <= y.x1 + 2) for (const dy of [0, 1]) for (const dx of [0, 1]) g[y.y + dy][x + dx] = 'X';
    paths.push([m0, RM + 1, RM + 1, m0 + Math.floor((inB - m0) * 0.4)]);
  }

  for (const [ax, ay, bx, by] of paths) diagonal(ax, ay, bx, by);

  // ---- acqua: fiume con ponti (le corsie sopravvivono) o baia d'angolo ----
  const water = o.water ? (o.water === 'none' ? null : o.water) : auto && r() < 0.5 ? (r() < 0.55 ? 'fiume' : 'baia') : null;
  if (water === 'fiume') {
    if (W >= H) {
      let x = Math.floor(m0 + (0.15 + r() * 0.7) * (inR - m0));
      for (let y = 0; y < H; y++) {
        if (r() < 0.16) x += r() < 0.5 ? -1 : 1;
        x = Math.max(RM + 3, Math.min(inR - 3, x));
        for (const xx of [x, x + 1]) if (!isRoadCh(g[y][xx])) g[y][xx] = '~';
      }
    } else {
      let y = Math.floor(m0 + (0.15 + r() * 0.7) * (inB - m0));
      for (let x = 0; x < W; x++) {
        if (r() < 0.16) y += r() < 0.5 ? -1 : 1;
        y = Math.max(RM + 3, Math.min(inB - 3, y));
        for (const yy of [y, y + 1]) if (!isRoadCh(g[yy][x])) g[yy][x] = '~';
      }
    }
  } else if (water === 'baia') {
    const sx = r() < 0.5 ? W - 1 : 0, sy = r() < 0.5 ? H - 1 : 0;
    const rad = Math.min(W, H) * (0.26 + r() * 0.14);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if ((x - sx) ** 2 + (y - sy) ** 2 < rad * rad && !isRoadCh(g[y][x])) g[y][x] = '~';
  }

  // ---- blocchi: componenti connesse di tile '.', auto-rilevate per ogni layout ----
  // la griglia storica usa il calcolo diretto xs×ys (preserva le mappe della campagna)
  const blocks = [];
  if (layout === 'grid') {
    const xs = [RM + 1, ...vr.flatMap((x) => [x, x + 2]), inR - 1];
    const ys = [RM + 1, ...hr.flatMap((y) => [y, y + 2]), inB - 1];
    for (let i = 0; i < xs.length; i += 2)
      for (let j = 0; j < ys.length; j += 2) {
        const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
        if (x1 - x0 >= 4 && y1 - y0 >= 4) blocks.push({ x0, x1, y0, y1, kind: 'bldg' });
      }
  } else {
    const seen = new Uint8Array(W * H);
    const stack = [];
    for (let s = 0; s < W * H; s++) {
      const sx = s % W, sy = (s / W) | 0;
      if (seen[s] || g[sy][sx] !== '.') continue;
      let x0 = sx, x1 = sx, y0 = sy, y1 = sy, n = 0;
      stack.push(s); seen[s] = 1;
      while (stack.length) {
        const c = stack.pop();
        const x = c % W, y = (c / W) | 0;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (seen[j] || g[ny][nx] !== '.') continue;
          seen[j] = 1; stack.push(j);
        }
      }
      // scarti: fasce periferiche che toccano il bordo, sacche minuscole tra le giunzioni
      const touchesEdge = x0 <= RM - 1 || y0 <= RM - 1 || x1 >= W - RM || y1 >= H - RM;
      if (!touchesEdge && n >= 10 && x1 - x0 >= 3 && y1 - y0 >= 3)
        blocks.push({ x0, x1: x1 + 1, y0, y1: y1 + 1, kind: 'bldg' });
    }
  }

  const byCenter = [...blocks].sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - cx, (a.y0 + a.y1) / 2 - cy) - Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy) );
  const anchors = {};
  if (!byCenter.length) { anchors.tower = [Math.floor(cx), Math.floor(cy)]; }
  const plazaBlock = byCenter[Math.min(1, byCenter.length - 1)];
  if (plazaBlock) {
    plazaBlock.kind = 'plaza';
    const towerBlock = byCenter[0] === plazaBlock ? byCenter[2] || byCenter[0] : byCenter[0];
    if (towerBlock && towerBlock !== plazaBlock) towerBlock.kind = 'tower';
  }
  const rest = blocks.filter((b) => b.kind === 'bldg');
  const parkP = o.park ?? (layout === 'organico' ? 0.18 : 0.13), plazaP = o.plaza ?? 0.06;
  let parkBlock = null;
  for (const b of rest) {
    const p = r();
    if (p < parkP) { b.kind = 'park'; parkBlock ||= b; }
    else if (p < parkP + plazaP) b.kind = 'plaza';
  }
  if (!parkBlock && rest.length) { parkBlock = rest[rest.length - 1]; parkBlock.kind = 'park'; }

  const bc = (b) => [Math.floor((b.x0 + b.x1) / 2), Math.floor((b.y0 + b.y1) / 2)];
  const hbias = o.heightBias ?? (layout === 'organico' ? 0.6 : layout === 'radiale' ? 1.15 : 1);

  function fillLots(x0, y0, x1, y1, depth, tall) {
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) { fillRect(x0, y0, x1, y1, '.'); return; }
    if ((w <= 6 && h <= 6 && (depth > 1 || r() < 0.5)) || depth > 3) {
      const gap = r() < 0.4 && w > 3 && h > 3 ? 1 : 0;
      const dcx = (x0 + x1) / 2 - cx, dcy = (y0 + y1) / 2 - cy;
      const closeness = 1 - Math.min(1, Math.hypot(dcx, dcy) / (Math.hypot(cx, cy) * 0.9));
      let lvl = Math.round(2 + r() * 2.5 + closeness * 3.5 * hbias);
      lvl = Math.max(1, Math.min(8, lvl));
      if (tall) lvl = 9;
      fillRect(x0 + gap, y0 + gap, x1 - gap, y1 - gap, String(lvl));
      return;
    }
    if (w >= h) {
      const s = x0 + 2 + Math.floor(r() * Math.max(1, w - 4));
      fillLots(x0, y0, s, y1, depth + 1, tall);
      fillLots(s, y0, x1, y1, depth + 1, false);
    } else {
      const s = y0 + 2 + Math.floor(r() * Math.max(1, h - 4));
      fillLots(x0, y0, x1, s, depth + 1, tall);
      fillLots(x0, s, x1, y1, depth + 1, false);
    }
  }
  function fillRect(x0, y0, x1, y1, ch) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g[y] && g[y][x] !== undefined && g[y][x] === '.') g[y][x] = ch;
  }
  const paint = (x, y, ch) => { if (g[y] && g[y][x] === '.') g[y][x] = ch; };

  for (const b of blocks) {
    const ix0 = b.x0 + 1, iy0 = b.y0 + 1, ix1 = b.x1 - 1, iy1 = b.y1 - 1;
    if (b.kind === 'bldg') fillLots(ix0, iy0, ix1, iy1, 0, false);
    else if (b.kind === 'tower') {
      // torre al centro con cortile
      const tx0 = ix0 + 1, ty0 = iy0 + 1, tx1 = ix1 - 1, ty1 = iy1 - 1;
      fillRect(tx0, ty0, tx1, ty1, '9');
      anchors.tower = [Math.floor((tx0 + tx1) / 2), Math.floor((ty0 + ty1) / 2)];
      anchors.tower_door = [Math.floor((tx0 + tx1) / 2), ty1];
    } else if (b.kind === 'park') {
      for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) paint(x, y, r() < 0.12 && (x + y) % 3 ? 'T' : ',');
    } else if (b.kind === 'plaza') {
      for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) if (g[y] && (g[y][x] === '.' || (layout !== 'grid' && g[y][x] === ','))) g[y][x] = '+';
      const [px, py] = bc(b);
      for (let y = py - 1; y <= py + 1; y++) for (let x = px - 1; x <= px + 1; x++) if (g[y] && (g[y][x] === '+' || g[y][x] === '.')) g[y][x] = 'Z';
    }
  }
  const [pcx, pcy] = bc(plazaBlock || { x0: cx, y0: cy, x1: cx, y1: cy });
  anchors.plaza = [pcx, pcy];
  anchors.pad = [pcx, pcy];
  if (parkBlock) {
    const [qx, qy] = bc(parkBlock);
    if (g[qy] && /[.,T]/.test(g[qy][qx])) g[qy][qx] = ',';
    anchors.park = [qx, qy];
  }
  anchors.center = bc(byCenter[0] || { x0: cx, y0: cy, x1: cx, y1: cy });
  const corner = (fx, fy) => {
    const b = [...blocks].sort((a, c) => ((a.x0 + a.x1) / 2 - fx * W) ** 2 + ((a.y0 + a.y1) / 2 - fy * H) ** 2 - (((c.x0 + c.x1) / 2 - fx * W) ** 2 + ((c.y0 + c.y1) / 2 - fy * H) ** 2))[0];
    if (!b) return [Math.floor(fx * W), Math.floor(fy * H)];
    return [fx < 0.5 ? b.x0 : b.x1 - 1, fy < 0.5 ? b.y0 : b.y1 - 1];
  };
  anchors.sw = corner(0.1, 0.9);
  anchors.nw = corner(0.1, 0.1);
  anchors.ne = corner(0.9, 0.1);
  anchors.se = corner(0.9, 0.9);
  anchors.spawn = anchors.sw;
  if (!anchors.tower) { anchors.tower = anchors.center; anchors.tower_door = anchors.center; }
  if (water === 'south' || water === 'east') for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (water === 'south' ? y >= H - 2 : x >= W - 2) g[y][x] = '~';

  // posizioni ancora in tile percorribili: forza pavimento sotto le ancore pericolose;
  // gli angoli (spawn/nw/ne/se/sw) vengono spostati alla cella aperta piu' vicina
  const openable = (x, y) => g[y] && g[y][x] !== undefined && !/[1-9#TF~]/.test(g[y][x]);
  const pave = (a) => { const [ax, ay] = a; if (g[ay]?.[ax] && /[1-9#TF~]/.test(g[ay][ax])) g[ay][ax] = '.'; };
  const openness = (x, y) => {
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])
      if (openable(x + dx, y + dy)) n++;
    return n;
  };
  if (layout === 'grid') {
    for (const k in anchors) pave(anchors[k]);
  } else {
    for (const k of ['tower', 'tower_door', 'center', 'plaza', 'pad', 'park']) if (anchors[k]) pave(anchors[k]);
    for (const k of ['sw', 'nw', 'ne', 'se']) {
      let [ax, ay] = anchors[k];
      const good = (x, y) => openable(x, y) && openness(x, y) >= 5;
      if (!isRoadCh(g[ay]?.[ax] ?? '.') && good(ax, ay)) { pave(anchors[k]); continue; }
      let best = null, bestScore = -1;
      for (let rad = 1; rad <= 5; rad++)
        for (let dy = -rad; dy <= rad; dy++)
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
            const x = ax + dx, y = ay + dy;
            if (!openable(x, y)) continue;
            const s = openness(x, y) - rad * 2 - (isRoadCh(g[y][x]) ? 4 : 0);
            if (s > bestScore) { bestScore = s; best = [x, y]; }
          }
      if (best && bestScore >= 2) anchors[k] = best;
      pave(anchors[k]);
    }
    anchors.spawn = anchors.sw;
  }
  return { ascii: g.map((row) => row.join('')), anchors };
}
