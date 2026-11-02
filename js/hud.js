import { el, fmtTime, clamp } from './util.js';
import { WEAPONS, OFFENSIVE, MODS, SCORING } from './data.js';
import { T } from './map.js';
import { play } from './audio.js';
import { drawAgentPortrait } from './portrait.js';

const IPA = [['a', 'ADR', 'Adrenalina: velocita e cadenza'], ['p', 'PER', 'Percezione: reattivita e portata'], ['i', 'INT', 'Intelligenza: precisione e comportamenti sensati']];

export class Hud {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.game = null;
    this.acc = 0;
    this.cards = [];
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    this.objBox = el('div', { class: 'hud-obj panel' });
    this.topRight = el('div', { class: 'hud-top panel' });
    this.toasts = el('div', { class: 'hud-toasts' });
    this.agentsBox = el('div', { class: 'hud-agents' });
    this.allBtn = el('button', {
      class: 'hud-all',
      title: 'Seleziona tutta la squadra (G, Ctrl/Cmd+A o doppio click su questa riga)',
      onclick: () => { this.selectAll(); play('click'); },
      ondblclick: () => { this.selectAll(); play('click'); },
    }, 'TUTTI');
    this.mini = el('canvas', { class: 'hud-mini', width: 200, height: 200 });
    this.miniWrap = el('div', { class: 'hud-minibox panel' }, this.mini);
    this.flashEl = el('div', { class: 'hud-flash' });
    this.tip = el('div', { class: 'hud-tip hidden' });
    this.pauseTag = el('div', { class: 'hud-pause' }, 'PAUSA TATTICA — impartisci gli ordini, Spazio per riprendere');
    this.hurtEl = el('div', { class: 'hud-hurt' });
    r.append(this.hurtEl, this.objBox, this.topRight, this.toasts, this.agentsBox, this.miniWrap, this.flashEl, this.tip, this.pauseTag);
    this.mctx = this.mini.getContext('2d');
    this.mini.addEventListener('mousedown', (e) => { if (e.button === 2) this.miniOrder(e); else this.miniClick(e); });
    this.mini.addEventListener('mousemove', (e) => { if (e.buttons & 1) this.miniClick(e); });
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());
    // riga velocità cliccabile (il pannello viene ri-creato via innerHTML: delega sul contenitore)
    this.topRight.addEventListener('click', () => {
      if (!this.game) return;
      const cur = this.app.speed;
      const nextSpd = cur < 1 ? 1 : cur < 1.5 ? 1.5 : cur < 2 ? 2 : cur < 3 ? 3 : 0.5;
      this.app.setSpeed(nextSpd);
      play('click');
    });
  }

  setGame(game, renderer) {
    this.game = game;
    this.r = renderer;
    this.msgSeen = 0;
    this.toasts.innerHTML = '';
    this.agentsBox.innerHTML = '';
    this.cards = [];
    game.agents.forEach((a, i) => this.cards.push(this.makeCard(a, i)));
    this.agentsBox.prepend(this.allBtn);
    this.buildMini();
    this.lastObj = '';
    this.update(0, true);
  }

  selectAll() {
    const g = this.game;
    if (!g) return;
    g.sel.clear();
    g.agents.forEach((a) => a.alive && g.sel.add(a));
  }

  flash(text) {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('show');
  }

  makeCard(a, idx) {
    const g = this.game;
    const portrait = el('canvas', { width: 64, height: 64, class: 'portrait' });
    this.drawPortrait(portrait.getContext('2d'), a);
    const hpFill = el('div', { class: 'hp-fill' });
    const hpTxt = el('span', { class: 'hp-txt' });
    const name = el('div', { class: 'ag-name' }, `${idx + 1} · ${a.name}`);
    const ipaEls = {};
    const ipa = el('div', { class: 'ipa' }, IPA.map(([k, lab, tip]) => {
      const fill = el('div', { class: 'ipa-fill' });
      const tgt = el('div', { class: 'ipa-tgt' });
      const bar = el('div', { class: 'ipa-bar', title: tip }, fill, tgt);
      const setFrom = (e) => {
        const rc = bar.getBoundingClientRect();
        const v = Math.round(clamp(100 - ((e.clientY - rc.top) / rc.height) * 100, 0, 100));
        const targets = e.shiftKey ? g.agents.filter((x) => x.alive) : [a];
        targets.forEach((t) => (t.ipa[k].t = v));
      };
      bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); bar.setPointerCapture(e.pointerId); setFrom(e); bar._d = true; });
      bar.addEventListener('pointermove', (e) => { if (bar._d) setFrom(e); });
      bar.addEventListener('pointerup', () => (bar._d = false));
      ipaEls[k] = { fill, tgt };
      return el('div', { class: 'ipa-col' }, bar, el('span', {}, lab));
    }));
    const slots = [];
    const grid = el('div', { class: 'wgrid' });
    for (let i = 0; i < 8; i++) {
      const s = el('button', { class: 'wslot', onclick: (e) => { e.stopPropagation(); this.clickSlot(a, i, e); } });
      slots.push(s);
      grid.append(s);
    }
    const card = el('div', { class: 'agent-card', onclick: (e) => {
      if (!a.alive) return;
      if (e.shiftKey) g.sel.has(a) ? g.sel.delete(a) : g.sel.add(a); else { g.sel.clear(); g.sel.add(a); }
      play('click');
    }, ondblclick: () => this.r.centerOn(a.x, a.y) },
      el('div', { class: 'ag-top' }, portrait, el('div', { class: 'ag-info' }, name, el('div', { class: 'hp-bar' }, hpFill, hpTxt), el('div', { class: 'ag-state' }))),
      el('div', { class: 'ag-body' }, ipa, grid));
    this.agentsBox.append(card);
    return { a, card, hpFill, hpTxt, ipaEls, slots, state: card.querySelector('.ag-state'), name };
  }

  clickSlot(a, i, e) {
    const g = this.game;
    if (!a.alive || !a.weapons[i]) return;
    if (!g.sel.has(a)) { if (!e.shiftKey) g.sel.clear(); g.sel.add(a); }
    const w = WEAPONS[a.weapons[i].id];
    if (w.type === 'medikit') { g.useMedikit(a); return; }
    if (w.type === 'bomb') { g.plantBomb(a); return; }
    // applica la stessa arma a tutti i selezionati che la possiedono
    for (const s of g.sel) {
      const idx = s.weapons.findIndex((x) => x.id === a.weapons[i].id);
      if (idx >= 0) s.selectWeapon(idx);
    }
    play('click');
  }

  drawPortrait(c, a) {
    drawAgentPortrait(c, a.name);
  }

  miniClick(e) {
    const g = this.game;
    if (!g) return;
    const rc = this.mini.getBoundingClientRect();
    const x = ((e.clientX - rc.left) / rc.width) * g.map.w, y = ((e.clientY - rc.top) / rc.height) * g.map.h;
    this.r.centerOn(x, y, true);
    e.stopPropagation();
  }

  miniOrder(e) {
    const g = this.game;
    if (!g) return;
    const rc = this.mini.getBoundingClientRect();
    const x = ((e.clientX - rc.left) / rc.width) * g.map.w, y = ((e.clientY - rc.top) / rc.height) * g.map.h;
    const sel = g.agents.filter((a) => a.alive && g.sel.has(a));
    if (!sel.length) return;
    g.orderMove(sel, x, y, e.shiftKey);
    g.fx.rings.push({ x, y, r: 0.1, max: 0.8, life: 0.5, t: 0.5 });
    play('click');
    e.stopPropagation();
    e.preventDefault();
  }

  /** Scheda informativa dell'unita' sotto il cursore. */
  updateTip() {
    const r = this.r, h = r.hover, g = this.game;
    if (!h || !h.alive || !r.mouse.inside) { this.tip.classList.add('hidden'); return; }
    const fac = h.kind === 'vehicle' ? (h.hostile ? 'Ostile' : h.dispatch || h.type === 'police' ? 'Polizia' : h.player ? 'Sindacato' : 'Civile') : h.persuaded && h.kind !== 'agent' ? 'Persuaso' : { 0: 'Sindacato', 1: 'Corporazione', 2: 'Polizia', 3: 'Civile' }[h.faction];
    const name = h.kind === 'vehicle' ? { car: 'Auto', van: 'Furgone', armored: 'Blindato', police: 'Volante' }[h.type] : h.name;
    let st = '';
    if (h.kind !== 'vehicle') {
      const w = h.wdef?.();
      const ws = h.weapons.filter((x) => OFFENSIVE.has(WEAPONS[x.id]?.type)).map((x) => WEAPONS[x.id].abbr).join(' ');
      const ai = h.ai?.state;
      const mood = h.faction === 3 ? (h.panic > 0 ? 'in preda al panico' : '') : h.kind === 'agent' ? (h.holstered ? 'armi rinfoderate' : '') : { idle: 'tranquillo', suspicious: 'sospettoso', alert: 'in allerta', combat: 'in combattimento', cover: 'al riparo', retreat: 'in ritirata', warn: "intima l'alt" }[ai] || '';
      st = `${ws ? `<span>Armi: <b>${ws}</b></span>` : ''}${mood ? `<span>${mood}</span>` : ''}${h.persuadable && h.faction !== 0 ? `<span>Persuasione: ${h.persuadeCost}</span>` : h.faction !== 0 && h.kind !== 'agent' ? '<span>Immune alla persuasione</span>' : ''}`;
    }
    const f = clamp(h.hp / h.maxHp, 0, 1);
    this.tip.innerHTML = `<b class="f${h.faction}">${name}</b><em>${fac}</em><div class="tip-hp"><i style="width:${f * 100}%"></i></div>${st}`;
    this.tip.style.transform = `translate(${Math.min(r.mouse.x + 18, innerWidth - 220)}px, ${Math.min(r.mouse.y + 18, innerHeight - 120)}px)`;
    this.tip.classList.remove('hidden');
  }

  buildMini() {
    const g = this.game, m = g.map;
    const c = document.createElement('canvas');
    c.width = m.w; c.height = m.h;
    const x = c.getContext('2d');
    const img = x.createImageData(m.w, m.h);
    const col = { [T.PAVE]: [48, 56, 76], [T.ROAD]: [24, 26, 34], [T.GRASS]: [30, 72, 52], [T.WATER]: [14, 52, 84], [T.PLAZA]: [70, 78, 104], [T.PAD]: [60, 200, 230], [T.FENCE]: [90, 96, 120], [T.GATE]: [180, 70, 80], [T.TREE]: [26, 100, 60] };
    for (let i = 0; i < m.w * m.h; i++) {
      let c3 = col[m.kind[i]];
      if (m.kind[i] === T.BLDG) { const L = m.bh[i]; const b = 70 + L * 12; c3 = [b * 0.7, b * 0.75, b]; }
      img.data[i * 4] = c3[0]; img.data[i * 4 + 1] = c3[1]; img.data[i * 4 + 2] = c3[2]; img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.miniBase = c;
  }

  update(dt, force = false) {
    const g = this.game;
    if (!g) return;
    this.acc += dt;
    if (!force && this.acc < 0.08) return;
    this.acc = 0;
    // schede agente
    const aliveN = g.agents.reduce((s, a) => s + (a.alive ? 1 : 0), 0);
    const selAliveN = g.agents.reduce((s, a) => s + (a.alive && g.sel.has(a) ? 1 : 0), 0);
    this.allBtn.classList.toggle('on', aliveN >= 1 && selAliveN === aliveN);
    const fx = g.agents;
    for (const c of this.cards) {
      const a = c.a;
      c.card.classList.toggle('sel', g.sel.has(a));
      c.card.classList.toggle('dead', !a.alive);
      const f = clamp(a.hp / a.maxHp, 0, 1);
      c.hpFill.style.width = f * 100 + '%';
      c.hpFill.style.background = f > 0.5 ? '#39e07a' : f > 0.25 ? '#ffb04d' : '#ff4d5a';
      c.hpTxt.textContent = a.alive ? `${Math.ceil(a.hp)}/${a.maxHp}` : 'CADUTO';
      for (const k of ['a', 'p', 'i']) {
        c.ipaEls[k].fill.style.height = a.ipa[k].e + '%';
        c.ipaEls[k].tgt.style.bottom = a.ipa[k].t + '%';
      }
      c.state.textContent = !a.alive ? '' : a.vehicle ? 'IN VEICOLO' : a.order ? { move: 'IN MOVIMENTO', attack: 'ATTACCO', persuade: 'PERSUADE', enter: 'SALE', fire: 'FUOCO', hold: 'FERMO' }[a.order.type] : (a.autoT?.alive ? 'INGAGGIO' : a.followM ? 'SEGUE IL GRUPPO' : a.holstered ? 'ARMI RINFODERATE' : '');
      c.card.classList.toggle('hurt', a.alive && a.hurt > 0);
      c.card.classList.toggle('holst', !!a.holstered);
      for (let i = 0; i < 8; i++) {
        const s = c.slots[i], w = a.weapons[i];
        if (!w) { if (s.dataset.k !== '') { s.dataset.k = ''; s.className = 'wslot empty'; s.textContent = ''; s.title = ''; } continue; }
        const d = WEAPONS[w.id];
        const off = OFFENSIVE.has(d.type);
        const key = w.id + (off || d.type === 'medikit' || d.type === 'bomb' ? ':' + w.ammo : '') + (a.cur === i ? '*' : '') + (w.ammo <= 0 && d.ammo ? 'x' : '');
        if (s.dataset.k !== key) {
          s.dataset.k = key;
          s.className = 'wslot' + (a.cur === i ? ' cur' : '') + (w.ammo <= 0 && d.ammo ? ' empty-ammo' : '') + (d.type === 'persuade' ? ' prs' : '') + (d.type === 'passive' ? ' passive' : '');
          s.innerHTML = `<b>${d.abbr}</b>` + (d.ammo ? `<i>${w.ammo}</i>` : '');
          s.title = `${d.name} — ${d.desc}`;
        }
      }
    }
    // obiettivi
    const ms = g.mission;
    const objHtml = ms.objectives.map((o) => {
      const cls = o.done ? 'done' : o.failed ? 'fail' : o.active === false ? 'wait' : '';
      return `<li class="${cls}${o.def.optional ? ' opt' : ''}"><span class="chk">${o.done ? '✔' : o.failed ? '✖' : '◆'}</span> ${o.def.text || o.def.type}${o.progress ? ` <em>${o.progress}</em>` : ''}${o.def.optional ? ' <small>(bonus)</small>' : ''}</li>`; // taste-skill-ignore
    }).join('');
    const title = `<h3>${g.def.name}</h3>`;
    const full = title + `<ul>${objHtml}</ul>`;
    if (full !== this.lastObj) { this.objBox.innerHTML = full; this.lastObj = full; }
    // vignetta danni sugli agenti
    const hurtNow = g.agents.some((a) => a.alive && a.hurt > 0.05);
    const low = g.agents.some((a) => a.alive && a.hp < a.maxHp * 0.3);
    this.hurtEl.style.opacity = hurtNow ? 0.9 : low ? 0.35 + 0.2 * Math.sin(g.t * 5) : 0;
    this.updateTip();
    // top-right
    const heat = Math.round(g.heat);
    // soglie uguali a quelle di dispatchPolice in game.js (50/90): le stelle non mentono
    const lvl = g.policeAlways ? 3 : heat >= 90 ? 3 : heat >= 50 ? 2 : heat > 0 ? 1 : 0;
    const cap = g.persuadeCapacity(), used = g.persuadeUsed();
    const pt = g.mission.timeLimit ? ` / ${fmtTime(g.mission.timeLimit)}` : '';
    const par = g.def.parTime || 0;
    const speedBonus = par ? Math.max(0, Math.round((par - g.t) * SCORING.speedBonusPerSec)) : 0;
    this.topRight.innerHTML = `<div class="tr-row"><span>TEMPO</span><b>${fmtTime(g.t)}${pt}</b></div>
      ${par ? `<div class="tr-row"><span>BONUS VELOCITÀ</span><b class="${speedBonus ? 'ok' : 'muted'}">${speedBonus ? '$' + speedBonus.toLocaleString('it-IT') : 'azzerato'}</b></div>` : ''}
      <div class="tr-row"><span>POLIZIA</span><div class="heat lv${lvl}"><i style="width:${g.policeAlways ? 100 : heat}%"></i></div><b class="stars">${'★'.repeat(lvl)}${'☆'.repeat(3 - lvl)}${lvl === 0 && !g.policeAlways ? ' <small class="muted">calmo</small>' : ''}</b></div> <!-- taste-skill-ignore -->
      <div class="tr-row"><span>NEMICI</span><b>${g.units.filter((u) => u.alive && u.faction === 1).length}</b></div>
      <div class="tr-row"><span>PERSUASI</span><b>${used}/${cap}</b></div>
      <div class="tr-row tr-speed" title="Clicca per cambiare velocità ([ e ] sulla tastiera)"><span>VELOCITÀ</span><b>${this.app.paused() ? 'PAUSA' : this.app.speed + 'x'}</b></div>`;
    // toast
    for (const m of g.messages) if (m.id > this.msgSeen) { this.addToast(m); this.msgSeen = m.id; }
    this.drawMini();
  }

  addToast(m) {
    const t = el('div', { class: 'toast ' + m.kind }, m.msg);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4800);
    while (this.toasts.children.length > 5) this.toasts.firstChild.remove();
  }

  drawMini() {
    const g = this.game, c = this.mctx, m = g.map;
    const W = 200, H = 200;
    c.clearRect(0, 0, W, H);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.miniBase, 0, 0, W, H);
    const sx = W / m.w, sy = H / m.h;
    const scan = g.agents.some((a) => a.alive && a.has('scanner'));
    const vr = scan ? 34 : 14;
    const seen = (o) => g.agents.some((a) => a.alive && Math.hypot(a.x - o.x, a.y - o.y) < vr + a.mods.eyes);
    for (const v of g.vehicles) if (v.alive && (seen(v) || v.player || v.dispatch)) { c.fillStyle = v.player ? '#37e1ff' : v.hostile ? '#ff4d5a' : v.type === 'police' ? (Math.sin(g.t * 12) > 0 ? '#ff3b4b' : '#5b8cff') : '#d8a21e'; c.fillRect(v.x * sx - 2, v.y * sy - 2, 4, 4); }
    for (const u of g.units) {
      if (!u.alive || u.vehicle) continue;
      if (u.faction !== 0 && !seen(u)) continue;
      c.fillStyle = u.kind === 'agent' ? (g.sel.has(u) ? '#ffffff' : '#37e1ff') : u.persuaded ? '#d28bff' : u.faction === 1 ? '#ff4d5a' : u.faction === 2 ? '#5b8cff' : '#8d96ab';
      const s = u.kind === 'agent' ? 4 : u.faction === 3 ? 2 : 3;
      c.fillRect(u.x * sx - s / 2, u.y * sy - s / 2, s, s);
    }
    for (const mk of g.mission.markers()) {
      c.strokeStyle = '#ffd24d'; c.lineWidth = 1.5;
      c.globalAlpha = 0.5 + 0.5 * Math.sin(g.t * 6);
      c.beginPath(); c.arc(mk.x * sx, mk.y * sy, mk.kind === 'zone' ? Math.max(4, mk.r * sx) : 4, 0, 6.3); c.stroke();
      c.globalAlpha = 1;
    }
    // riquadro camera
    const r = this.r, cw = r.cv.width, ch = r.cv.height;
    const pts = [r.s2w(0, 0), r.s2w(cw, 0), r.s2w(cw, ch), r.s2w(0, ch)];
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x * sx, p.y * sy) : c.moveTo(p.x * sx, p.y * sy))); c.closePath(); c.stroke();
  }
}
