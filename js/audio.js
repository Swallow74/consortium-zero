// Audio sintetizzato con WebAudio (nessun asset esterno).
let ctx = null, master = null, sfxBus = null, musBus = null, ambBus = null, noiseBuf = null;
const vol = { master: 0.8, sfx: 0.9, music: 0.45 };
let curOut = null;
let musicOn = false, musicTimer = null, step = 0, intensity = 0.3, nextT = 0;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  musBus = ctx.createGain();
  ambBus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  sfxBus.connect(master); musBus.connect(master); ambBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVol();
}

export function setVolume(k, v) { vol[k] = v; applyVol(); }
export function getVolume() { return { ...vol }; }
function applyVol() {
  if (!ctx) return;
  master.gain.value = vol.master;
  sfxBus.gain.value = vol.sfx;
  musBus.gain.value = vol.music * 0.5;
  ambBus.gain.value = vol.sfx * 0.8;
}

function tone(f0, f1, dur, type = 'square', v = 0.2, delay = 0, bus = null) {
  if (!ctx) return;
  bus ||= curOut || sfxBus;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, v = 0.3, f0 = 4000, f1 = 600, delay = 0, q = 0.7) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(curOut || sfxBus);
  s.start(t, Math.random()); s.stop(t + dur + 0.02);
}

const lastPlay = {};
const SFX = {
  pistol: () => { noise(0.12, 0.35, 5000, 500); tone(380, 90, 0.1, 'square', 0.12); },
  uzi: () => { noise(0.07, 0.25, 6000, 900); tone(520, 140, 0.05, 'square', 0.08); },
  shotgun: () => { noise(0.3, 0.55, 3500, 250); tone(160, 45, 0.25, 'sawtooth', 0.2); },
  minigun: () => { noise(0.05, 0.22, 4000, 700); tone(220, 90, 0.05, 'square', 0.08); },
  longrange: () => { noise(0.35, 0.4, 7000, 400); tone(900, 60, 0.3, 'sawtooth', 0.15); },
  laser: () => { tone(1700, 220, 0.28, 'sawtooth', 0.14); tone(850, 110, 0.3, 'sine', 0.12); },
  flame: () => { noise(0.14, 0.2, 1800, 500, 0, 0.3); },
  gauss: () => { tone(120, 38, 0.5, 'sine', 0.4); noise(0.3, 0.3, 2500, 200); tone(2400, 300, 0.22, 'sawtooth', 0.07); },
  explosion: () => { noise(1.2, 0.9, 1800, 60, 0, 1); tone(90, 24, 0.9, 'sine', 0.5); },
  hit: () => { noise(0.06, 0.18, 1500, 400); },
  death: () => { tone(420, 80, 0.4, 'sawtooth', 0.12); },
  pickup: () => { tone(660, 990, 0.1, 'square', 0.08); tone(990, 1320, 0.12, 'square', 0.08, 0.08); },
  persuade: () => { [440, 554, 659, 880].forEach((f, i) => tone(f, f * 1.01, 0.12, 'triangle', 0.14, i * 0.06)); },
  heal: () => { tone(500, 900, 0.3, 'sine', 0.16); },
  click: () => { tone(900, 700, 0.04, 'square', 0.05); },
  error: () => { tone(160, 120, 0.18, 'sawtooth', 0.1); },
  alarm: () => { tone(660, 880, 0.25, 'square', 0.07); tone(880, 660, 0.25, 'square', 0.07, 0.25); },
  complete: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.2, 'triangle', 0.16, i * 0.1)); },
  fail: () => { [330, 262, 208, 165].forEach((f, i) => tone(f, f * 0.98, 0.3, 'sawtooth', 0.12, i * 0.14)); },
  beep: () => { tone(1200, 1200, 0.05, 'sine', 0.06); },
  bomb: () => { tone(1000, 1000, 0.05, 'sine', 0.1); },
  gate: () => { tone(200, 400, 0.4, 'sawtooth', 0.08); },
  car: () => { tone(60, 50, 0.15, 'sawtooth', 0.04); },
  siren: () => { tone(700, 1050, 0.35, 'triangle', 0.05); tone(1050, 700, 0.35, 'triangle', 0.05, 0.35); },
  warn: () => { tone(520, 520, 0.09, 'square', 0.07); tone(390, 390, 0.12, 'square', 0.07, 0.11); },
  holster: () => { noise(0.05, 0.12, 3000, 1200); tone(300, 220, 0.05, 'square', 0.04, 0.03); },
  turret: () => { noise(0.08, 0.3, 5000, 700); tone(260, 80, 0.08, 'square', 0.1); },
  shell: () => { tone(3200, 2600, 0.03, 'sine', 0.02); },
  step: () => { noise(0.04, 0.05, 900, 300); },
};

const MIN_GAP = { siren: 0.7, turret: 0.12, shell: 0.06, uzi: 0.05, minigun: 0.04, hit: 0.04, flame: 0.08, click: 0.02, car: 0.2, step: 0.17 };
/** Riproduce un effetto con guadagno e panning stereo propri (non tocca il bus condiviso). */
export function play(name, gainMul = 1, pan = 0) {
  if (!ctx || !SFX[name]) return;
  const now = ctx.currentTime;
  if (lastPlay[name] && now - lastPlay[name] < (MIN_GAP[name] ?? 0.015)) return;
  lastPlay[name] = now;
  const g = ctx.createGain();
  g.gain.value = Math.max(0.03, Math.min(1, gainMul));
  let out = g;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); p.connect(sfxBus);
  } else g.connect(sfxBus);
  curOut = out;
  try { SFX[name](); } finally { curOut = null; }
  setTimeout(() => g.disconnect(), 2500);
}

// ---- Musica generativa synthwave scura ----
const ROOTS = [55, 55, 65.41, 49];
const SCALE = [0, 3, 5, 7, 10, 12, 15];
function schedule() {
  if (!musicOn || !ctx) return;
  const bpm = 92 + intensity * 30;
  const sd = 60 / bpm / 2;
  while (nextT < ctx.currentTime + 0.35) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const root = ROOTS[bar];
    const t = nextT - ctx.currentTime;
    if (s % 4 === 0 || (intensity > 0.5 && s % 4 === 2)) tone(root, root * 0.98, sd * 1.8, 'sawtooth', 0.11, Math.max(0, t), musBus);
    if (s % 2 === 0 && intensity > 0.2) {
      const n = SCALE[(step * 3 + bar * 2) % SCALE.length];
      tone(root * 4 * Math.pow(2, n / 12), root * 4 * Math.pow(2, n / 12), sd * 0.9, 'triangle', 0.045 + intensity * 0.03, Math.max(0, t), musBus);
    }
    if (s === 0) { tone(root * 2, root * 2, sd * 14, 'sine', 0.06, Math.max(0, t), musBus); tone(root * 3.0, root * 3.0, sd * 14, 'sine', 0.04, Math.max(0, t), musBus); }
    if (s % 8 === 4) {
      const t0 = ctx.currentTime + Math.max(0, t);
      const sn = ctx.createBufferSource(); sn.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.07, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      sn.connect(f); f.connect(g); g.connect(musBus); sn.start(t0, Math.random()); sn.stop(t0 + 0.16);
    }
    if (intensity > 0.45 && s % 2 === 1) {
      const t0 = ctx.currentTime + Math.max(0, t);
      const sn = ctx.createBufferSource(); sn.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.03, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      sn.connect(f); f.connect(g); g.connect(musBus); sn.start(t0, Math.random()); sn.stop(t0 + 0.05);
    }
    nextT += sd;
    step++;
  }
}
export function startMusic(i = 0.3) {
  intensity = i;
  if (!ctx || musicOn) return;
  musicOn = true;
  nextT = ctx.currentTime + 0.1;
  step = 0;
  musicTimer = setInterval(schedule, 100);
}
export function setIntensity(i) { intensity = i; }
export function stopMusic() { musicOn = false; clearInterval(musicTimer); }

// ---- Ambienti meteo: loop di rumore filtrato (pioggia / vento / ronzio citta') ----
let ambient = null; // { kind, gain, nodes:[] }

function ambLayer(out, ftype, freq, q, v, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = ftype;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = v;
  s.connect(f); f.connect(g); g.connect(out);
  s.start(0, Math.random() * 0.5);
  s._f = f;
  return s;
}

export function setAmbient(kind) {
  if (!ctx) return;
  if (ambient && ambient.kind === kind) return;
  stopAmbient(0.5);
  if (!kind || !ambBus) return;
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  g.connect(ambBus);
  const nodes = [g];
  if (kind === 'rain') {
    nodes.push(ambLayer(g, 'lowpass', 2200, 0.7, 0.5, 1), ambLayer(g, 'highpass', 3800, 0.9, 0.16, 1.25), ambLayer(g, 'lowpass', 150, 0.7, 0.55, 0.55));
  } else if (kind === 'fog') {
    const w = ambLayer(g, 'bandpass', 420, 0.8, 0.38, 0.9);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 0.08;
    og.gain.value = 260;
    o.connect(og); og.connect(w._f.frequency);
    o.start();
    nodes.push(w, o, ambLayer(g, 'lowpass', 240, 0.6, 0.28, 0.7));
  } else {
    nodes.push(ambLayer(g, 'lowpass', 130, 0.6, 0.42, 0.5), ambLayer(g, 'bandpass', 750, 0.5, 0.05, 0.9));
  }
  g.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.6);
  ambient = { kind, gain: g, nodes };
}

export function stopAmbient(fade = 0.4) {
  if (!ambient || !ctx) { ambient = null; return; }
  const { gain, nodes } = ambient;
  ambient = null;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
  gain.gain.linearRampToValueAtTime(0.0001, t + fade);
  setTimeout(() => {
    for (const n of nodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* gia' fermo */ } }
    try { gain.disconnect(); } catch (e) { /* ignora */ }
  }, fade * 1000 + 120);
}
