import { Renderer } from './render.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Screens } from './screens.js';
import { Game } from './game.js';
import { listMissions, loadMissionDef, loadMissionScript, buildMap } from './mission.js';
import { loadProfile, saveProfile, applyResult } from './profile.js';
import { initAudio, startMusic, stopMusic, setVolume, setIntensity, setAmbient, stopAmbient, play } from './audio.js';
import { el } from './util.js';

const app = {
  profile: loadProfile(),
  missions: [],
  game: null,
  speed: 1,
  _paused: false,
  mode: 'menu', // menu | play
  settings: null,
  paused() { return this._paused; },
  menuOpen() { return menuOpen; },
  setSpeed(s) { this.speed = s; this.hud?.flash(`Velocità ${s}x`); },
  togglePause() { if (this.mode !== 'play' || menuOpen) return; this._paused = !this._paused; document.body.classList.toggle('tpause', this._paused); play('click'); },
  toggleMenu() { if (this.mode !== 'play') return; openMenu(!menuOpen); },
  toggleHelp() { this.showHelp(); },
  go(name, data) { if (name !== 'play') { this.mode = 'menu'; } screens.show(name, data); },
  applyQuality() { renderer.quality = this.profile.settings.quality; renderer.resize(); },
  showHelp() {
    const box = el('div', { class: 'overlay', onclick: () => box.remove() },
      el('div', { class: 'panel help' },
        el('h2', {}, 'Comandi'),
        el('table', {}, ...[
          ['Click sinistro', 'Muovi / attacca / persuadi / seleziona'],
          ['Click destro', 'Apri il fuoco sul punto o sul bersaglio'],
          ['Maiusc + click', 'Accoda ordini / selezione multipla'],
          ['Trascina', 'Selezione ad area'],
          ['1-4 / Tab', 'Seleziona agente / prossimo'],
          ['G o Ctrl/Cmd+A', 'Seleziona tutta la squadra'],
          ['TUTTI (in basso)', 'Seleziona tutta la squadra col mouse'],
          ['Q / E', 'Arma precedente / successiva'],
          ['R', 'Usa Medikit'],
          ['B', 'Piazza bomba a tempo'],
          ['X', 'Stop'],
          ['Z', 'Rinfodera / estrai le armi (la polizia non ti ferma)'],
          ['V', 'Sali / scendi da un veicolo vicino'],
          ['WASD / frecce', 'Muovi la telecamera'],
          ['Doppio click agente', 'Centra la telecamera'],
          ['Minimappa', 'Click: sposta la vista · Click destro: muovi la squadra'],
          ['Rotella / + −', 'Zoom'],
          ['Tasto centrale', 'Trascina la mappa'],
          ['C / F', 'Centra squadra / segui squadra'],
          ['Spazio / P', 'Pausa tattica (puoi dare ordini in pausa)'],
          ['[ / ]', 'Velocità di gioco'],
          ['HUD › VELOCITÀ', 'Click per cambiare velocità'],
          ['Barre ADR/PER/INT', 'Clic per regolare i livelli di droga (Maiusc = tutti)'],
          ['Esc', 'Menu di pausa'],
        ].map(([k, v]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, v)))),
        el('p', { class: 'muted' }, 'Clicca per chiudere')));
    document.body.append(box);
  },
  async startMission(m) {
    try {
      const def = await loadMissionDef(m._folder || m.folder || m.id);
      const script = await loadMissionScript(def);
      const mapData = buildMap(def);
      initAudio();
      this.applyAudio();
      const g = new Game(def, this.profile, mapData, script);
      g._renderer = renderer; // per ctx.focus() degli script di missione
      this.game = g;
      renderer.setGame(g);
      hud.setGame(g, renderer);
      this.settings = this.profile.settings;
      renderer.settings = this.profile.settings;
      this.speed = 1;
      this._paused = false;
      document.body.classList.remove('tpause');
      this.mode = 'play';
      input.enabled = true;
      screens.hide();
      hudRoot.classList.remove('hidden');
      pauseEl.classList.add('hidden');
      renderer.centerOn(g.start.x, g.start.y, false);
      g.toast(def.name, 'info');
      startMusic(0.3);
      setAmbient(this.profile.settings.weatherFx === false ? null : g.weather);
    } catch (e) {
      console.error(e);
      this.mode = 'menu';
      input.enabled = false;
      this.game = null;
      hudRoot.classList.add('hidden');
      this.go('error', { msg: e.message });
    }
  },
  applyAudio() {
    const s = this.profile.settings;
    setVolume('master', s.master); setVolume('sfx', s.sfx); setVolume('music', s.music);
  },
  endMission() {
    const g = this.game;
    const def = g.def;
    const sum = applyResult(this.profile, def, g);
    this.mode = 'menu';
    input.enabled = false;
    this.game = null;
    hudRoot.classList.add('hidden');
    pauseEl.classList.add('hidden');
    document.body.classList.remove('tpause');
    menuOpen = false;
    renderer.setGame(emptyGameStub());
    screens.root.classList.remove('hidden');
    stopMusic();
    stopAmbient();
    startMusic(0.15);
    screens.show('debrief', { sum, def });
  },
};

const canvas = document.getElementById('game');
const hudRoot = document.getElementById('hud');
const screenRoot = document.getElementById('screen');
const pauseEl = document.getElementById('pause');
const renderer = new Renderer(canvas);
const hud = new Hud(hudRoot, app);
const screens = new Screens(screenRoot, app);
const input = new Input(canvas, renderer, app);
app.hud = hud;
app.screens = screens;
app.settings = app.profile.settings;
renderer.settings = app.profile.settings;
app.applyQuality();
let menuOpen = false;

function emptyGameStub() { return null; }

function openMenu(open) {
  menuOpen = open;
  const g = app.game;
  if (open) {
    app._paused = true;
    pauseEl.innerHTML = '';
    pauseEl.append(el('div', { class: 'panel pause-box' },
      el('h2', {}, 'MENU'),
      el('button', { class: 'btn big', onclick: () => openMenu(false) }, 'Riprendi'),
      el('button', { class: 'btn', onclick: () => app.showHelp() }, 'Comandi'),
      el('button', { class: 'btn', onclick: () => { menuOpen = false; app._paused = false; g.finish('lose', 'Missione abbandonata'); } }, 'Abbandona missione')));
    pauseEl.classList.remove('hidden');
  } else {
    app._paused = document.body.classList.contains('tpause');
    pauseEl.classList.add('hidden');
  }
}

function resize() { renderer.resize(); }
window.addEventListener('resize', resize);

// ---- ciclo principale ----
let last = performance.now();
let endTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const g = app.game;
  if (app.mode === 'play' && g) {
    if (!app._paused) {
      // sotto-passi per stabilità con velocità alte
      const total = dt * app.speed;
      const steps = Math.ceil(total / 0.034);
      for (let i = 0; i < steps; i++) g.update(total / steps);
    }
    // camera
    const pan = input.panVector();
    renderer.updateCamera(dt, pan);
    if (app.settings.follow && !pan.x && !pan.y && !renderer.camT) {
      const alive = g.agents.filter((a) => a.alive && g.sel.has(a));
      if (alive.length) {
        const cx = alive.reduce((s, a) => s + a.x, 0) / alive.length, cy = alive.reduce((s, a) => s + a.y, 0) / alive.length;
        renderer.cam.x += (cx - renderer.cam.x) * Math.min(1, dt * 3);
        renderer.cam.y += (cy - renderer.cam.y) * Math.min(1, dt * 3);
      }
    }
    renderer.render(dt);
    hud.update(dt);
    if (g.over) {
      endTimer += dt;
      if (!menuOpen && endTimer > 1.8) { endTimer = 0; app.endMission(); }
      else if (menuOpen && g.over) { endTimer = 0; app.endMission(); }
    } else endTimer = 0;
  } else {
    // sfondo menu: pannello scuro animato
    const ctx = renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04070d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

async function boot() {
  app.missions = await listMissions();
  app.missions.forEach((m) => (m._folder = m.folder || m.id));
  // arricchisce con i dati delle missioni (nome, regione, requisiti...)
  const full = [];
  for (const m of app.missions) {
    try {
      const d = await loadMissionDef(m.folder || m.id);
      full.push({ ...d, _folder: m.folder || m.id });
    } catch (e) { console.warn('missione ignorata', m, e); }
  }
  full.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  app.missions = full;
  app.applyAudio();
  screens.show('title');
  document.getElementById('loading')?.remove();
  window.__app = app;
  window.__r = renderer;
  window.__input = input;
  requestAnimationFrame(frame);
}

// Audio e musica dopo il primo gesto dell'utente
const unlock = () => { initAudio(); app.applyAudio(); startMusic(0.15); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

boot();
