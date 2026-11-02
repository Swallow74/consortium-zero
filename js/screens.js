import { el, fmtMoney, fmtTime, clamp, TAU } from './util.js';
import { WEAPONS, MODS, OFFENSIVE } from './data.js';
import { buyWeapon, buyMod, modCost, recruit, RECRUIT_COST, equip, unequip, saveProfile, resetProfile } from './profile.js';
import { play, setVolume, getVolume } from './audio.js';
import { createWorldMap, BLOCS } from './worldmap.js';

export class Screens {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.anim = null;
    this._gen = 0; // token di schermata: ignora animazioni avviate dopo il cambio schermata
    this._timer = 0;
  }

  stopAnim() {
    this._gen++;
    clearTimeout(this._timer);
    if (this.anim) {
      if (typeof this.anim === 'object') this.anim.stop();
      else cancelAnimationFrame(this.anim);
    }
    this.anim = null;
  }
  hide() { this.stopAnim(); this.root.classList.add('hidden'); this.root.innerHTML = ''; }
  show(name, data) {
    this.stopAnim();
    this.root.innerHTML = '';
    this.root.className = 'screen ' + name;
    this.root.append(this[name](data));
    play('click');
  }

  money() { return el('div', { class: 'money' }, fmtMoney(this.app.profile.money)); }

  // ---------------------------------------------------------------- TITOLO
  title() {
    const a = this.app;
    const has = Object.keys(a.profile.completed).length > 0;
    return el('div', { class: 'title-screen' },
      el('div', { class: 'logo' }, el('span', {}, 'CONSORTIUM'), el('em', {}, 'ZERO')),
      el('p', { class: 'tag' }, 'Controlla la città. Persuadi, elimina, domina.'),
      el('div', { class: 'menu' },
        el('button', { class: 'btn big', onclick: () => a.go('hub') }, has ? 'CONTINUA' : 'NUOVA CAMPAGNA'),
        el('button', { class: 'btn', onclick: () => a.go('team', 'hub') }, 'SQUADRA & ARMERIA'),
        el('button', { class: 'btn', onclick: () => a.go('options', 'title') }, 'OPZIONI'),
        el('button', { class: 'btn', onclick: () => a.showHelp() }, 'COMANDI')),
      el('p', { class: 'foot' }, 'Missioni modulari: aggiungi una cartella in /missions'));
  }

  // ---------------------------------------------------------------- HUB / MAPPA
  hub() {
    const a = this.app, p = a.profile;
    const ms = a.missions;
    const done = (m) => !!p.completed[m.id];
    const avail = (m) => (m.requires || []).every((r) => p.completed[r]);
    const info = el('aside', { class: 'panel info' });
    let selected = null;

    const statusOf = (m) => (done(m) ? 'done' : avail(m) ? 'avail' : 'locked');
    const showInfo = () => {
      info.innerHTML = '';
      if (!selected) {
        info.append(el('h2', {}, 'Mappa territori'), el('p', { class: 'muted' }, ms.length ? 'Seleziona un territorio per leggere il rapporto della missione.' : 'Nessuna missione trovata. Aggiungi cartelle in /missions.'));
        return;
      }
      const m = selected, ok = avail(m), dn = done(m);
      info.append(
        el('h2', {}, m.name),
        el('div', { class: 'meta' },
          el('span', {}, m.region?.name || ''),
          el('span', {}, '★'.repeat(m.difficulty || 1) + '☆'.repeat(Math.max(0, 5 - (m.difficulty || 1)))),
          el('span', { class: 'muted', style: 'margin-left:6px' }, dn ? 'CONTROLLATO' : ok ? 'OBIETTIVO' : 'BLOCCATO')),
        el('p', {}, (m.briefing || '').split('\n')[0]),
        el('div', { class: 'kv' }, el('span', {}, 'Ricompensa'), el('b', {}, fmtMoney(m.reward || 0))),
        el('div', { class: 'kv' }, el('span', {}, 'Stato'), el('b', { class: dn ? 'ok' : ok ? '' : 'bad' }, dn ? 'COMPLETATA' : ok ? 'DISPONIBILE' : 'BLOCCATA')),
        ...(ok ? [] : [el('p', { class: 'muted' }, 'Richiede: ' + (m.requires || []).map((r) => ms.find((x) => x.id === r)?.name || r).join(', '))]),
        el('button', { class: 'btn big', disabled: !ok, onclick: () => a.go('briefing', m) }, dn ? 'RIGIOCA' : 'BRIEFING'));
    };
    showInfo();

    const cv = el('canvas', { class: 'world' });
    const gen = this._gen;
    // il canvas deve essere nel DOM prima del primo resize: creiamo la mappa al tick successivo
    this._timer = setTimeout(() => {
      if (this._gen !== gen) return; // schermata cambiata nel frattempo: mai lasciare un loop orfano
      this.anim = createWorldMap(cv, {
        missions: ms,
        statusOf: (m) => statusOf(m),
        selected: selected,
        onSelect: (m) => { selected = m; showInfo(); play('click'); },
      });
    }, 0);

    return el('div', { class: 'hub' },
      el('header', { class: 'bar' },
        el('div', { class: 'logo sm' }, el('span', {}, 'CONSORTIUM'), el('em', {}, 'ZERO')),
        this.money(),
        el('nav', {},
          el('button', { class: 'btn', onclick: () => a.go('team', 'hub') }, 'Squadra & Armeria'),
          el('button', { class: 'btn', onclick: () => a.go('options', 'hub') }, 'Opzioni'),
          el('button', { class: 'btn', onclick: () => a.go('title') }, 'Titolo'))),
      el('div', { class: 'hub-main' }, cv, info));
  }

  // ---------------------------------------------------------------- BRIEFING
  briefing(m) {
    const a = this.app;
    const alive = a.profile.agents.filter((x) => x.alive).length;
    return el('div', { class: 'briefing' },
      el('header', { class: 'bar' }, el('h1', {}, m.name), this.money()),
      el('div', { class: 'brief-main' },
        el('section', { class: 'panel' },
          el('div', { class: 'meta' }, el('span', {}, m.region?.name || ''), el('span', {}, '★'.repeat(m.difficulty || 1))),
          ...(m.briefing || '').split('\n').filter(Boolean).map((t) => el('p', {}, t)),
          el('h3', {}, 'Obiettivi'),
          el('ul', { class: 'objs' }, (m.objectives || []).map((o) => el('li', { class: o.optional ? 'opt' : '' }, o.text || o.type, o.optional ? el('small', {}, ` (bonus ${fmtMoney(o.bonus || 0)})`) : null))),
          el('div', { class: 'kv' }, el('span', {}, 'Ricompensa'), el('b', {}, fmtMoney(m.reward || 0))),
          m.timeLimit ? el('div', { class: 'kv' }, el('span', {}, 'Limite di tempo'), el('b', {}, fmtTime(m.timeLimit))) : null,
          (m.unlocks || []).length ? el('div', { class: 'kv' }, el('span', {}, 'Sblocca'), el('b', {}, m.unlocks.map((u) => WEAPONS[u]?.name || u).join(', '))) : null),
        el('section', { class: 'panel squad' },
          el('h3', {}, `Squadra (${alive}/4 agenti)`),
          ...a.profile.agents.map((ag) => el('div', { class: 'squad-row' + (ag.alive ? '' : ' dead') },
            el('b', {}, ag.name), el('span', {}, ag.alive ? ag.loadout.map((w) => WEAPONS[w]?.abbr).join(' · ') : 'CADUTO'))),
          alive === 0 ? el('p', { class: 'bad' }, 'Nessun agente disponibile: recluta dalla schermata Squadra.') : null,
          el('div', { class: 'row' },
            el('button', { class: 'btn', onclick: () => a.go('team', ['briefing', m]) }, 'Modifica squadra'),
            el('button', { class: 'btn big', disabled: alive === 0, onclick: () => a.startMission(m) }, 'AVVIA MISSIONE')))),
      el('footer', { class: 'bar' }, el('button', { class: 'btn', onclick: () => a.go('hub') }, '← Mappa')));
  }

  // ---------------------------------------------------------------- SQUADRA / ARMERIA
  team(back) {
    const a = this.app, p = a.profile;
    this._teamIdx ??= 0;
    const root = el('div', { class: 'team' });
    const render = () => {
      root.innerHTML = '';
      const ag = p.agents[this._teamIdx];
      const msg = el('div', { class: 'msg' });
      const note = (t, bad) => { msg.textContent = t; msg.className = 'msg' + (bad ? ' bad' : ' ok'); play(bad ? 'error' : 'pickup'); };
      const tabs = el('div', { class: 'tabs' }, p.agents.map((x, i) => el('button', { class: 'tab' + (i === this._teamIdx ? ' on' : '') + (x.alive ? '' : ' dead'), onclick: () => { this._teamIdx = i; render(); } }, `${i + 1} · ${x.name}${x.alive ? '' : ' ✖'}`)));
      let body;
      if (!ag.alive) {
        body = el('div', { class: 'panel' }, el('h2', {}, `${ag.name} è caduto`),
          el('p', {}, `Recluta un nuovo agente per ${fmtMoney(RECRUIT_COST)}.`),
          el('button', { class: 'btn big', onclick: () => { const r = recruit(p, this._teamIdx); if (r === 'ok') { render(); } else note('Fondi insufficienti', true); } }, 'Recluta'));
      } else {
        const mods = el('section', { class: 'panel' }, el('h3', {}, 'Potenziamenti cibernetici'),
          Object.entries(MODS).map(([k, d]) => {
            const lvl = ag.mods[k], c = modCost(ag, k);
            return el('div', { class: 'mod' },
              el('div', {}, el('b', {}, d.name), el('small', {}, d.desc)),
              el('div', { class: 'pips' }, [0, 1, 2].map((i) => el('i', { class: i < lvl ? 'on' : '' }))),
              el('button', { class: 'btn sm', disabled: c === null, onclick: () => { const r = buyMod(p, this._teamIdx, k); if (r === 'ok') render(); else note(r === 'money' ? 'Fondi insufficienti' : 'Livello massimo', true); } }, c === null ? 'MAX' : fmtMoney(c)));
          }));
        const loadout = el('section', { class: 'panel' }, el('h3', {}, `Equipaggiamento (${ag.loadout.length}/8)`),
          el('div', { class: 'slots' }, Array.from({ length: 8 }, (_, i) => {
            const id = ag.loadout[i];
            return id ? el('button', { class: 'slot', title: 'Rimuovi', onclick: () => { unequip(p, this._teamIdx, id); render(); } }, el('b', {}, WEAPONS[id].abbr), el('small', {}, WEAPONS[id].name)) : el('div', { class: 'slot empty' });
          })),
          el('p', { class: 'muted' }, 'Clicca un\'arma equipaggiata per rimuoverla. Il Persuadertron è essenziale per reclutare.'));
        const shop = el('section', { class: 'panel shop' }, el('h3', {}, 'Armeria'),
          el('div', { class: 'wlist' }, Object.entries(WEAPONS).map(([id, w]) => {
            const owned = p.owned.includes(id);
            const available = w.tier === 0 || p.unlocked.includes(id);
            const equipped = ag.loadout.includes(id);
            return el('div', { class: 'witem' + (available || owned ? '' : ' locked') },
              el('div', { class: 'wabbr' }, w.abbr),
              el('div', { class: 'wtxt' }, el('b', {}, w.name), el('small', {}, w.desc)),
              owned
                ? el('button', { class: 'btn sm', disabled: equipped || ag.loadout.length >= 8, onclick: () => { equip(p, this._teamIdx, id); render(); } }, equipped ? 'Equip.' : 'Equipaggia')
                : available
                  ? el('button', { class: 'btn sm', onclick: () => { const r = buyWeapon(p, id); if (r === 'ok') render(); else note('Fondi insufficienti', true); } }, fmtMoney(w.cost))
                  : el('span', { class: 'lock' }, 'Bloccata'));
          })));
        body = el('div', { class: 'team-grid' }, mods, loadout, shop);
      }
      root.append(
        el('header', { class: 'bar' }, el('h1', {}, 'Squadra & Armeria'), this.money()),
        tabs, body, msg,
        el('footer', { class: 'bar' }, el('button', { class: 'btn', onclick: () => { saveProfile(p); if (Array.isArray(back)) a.go(back[0], back[1]); else a.go(back || 'hub'); } }, '← Indietro')));
    };
    render();
    return root;
  }

  // ---------------------------------------------------------------- ERRORE
  error(d) {
    const a = this.app;
    return el('div', { class: 'debrief' },
      el('h1', { class: 'bad' }, 'ERRORE'),
      el('p', { class: 'muted' }, d?.msg || 'Impossibile caricare la missione.'),
      el('p', { class: 'muted' }, 'Verifica che la cartella in /missions contenga un mission.json valido: `python3 tools/validate_mission.py`.'),
      el('div', { class: 'row' }, el('button', { class: 'btn big', onclick: () => a.go('hub') }, '← Torna alla mappa')));
  }

  // ---------------------------------------------------------------- DEBRIEF
  debrief(d) {
    const a = this.app, s = d.sum, def = d.def;
    const fmt = (n) => fmtMoney(n);
    return el('div', { class: 'debrief' },
      el('h1', { class: s.win ? 'ok' : 'bad' }, s.win ? 'MISSIONE COMPIUTA' : 'MISSIONE FALLITA'),
      el('p', { class: 'muted' }, s.reason),
      el('div', { class: 'panel' },
        el('div', { class: 'kv' }, el('span', {}, 'Missione'), el('b', {}, def.name)),
        el('div', { class: 'kv' }, el('span', {}, 'Tempo'), el('b', {}, fmtTime(s.time))),
        el('div', { class: 'kv' }, el('span', {}, 'Nemici eliminati'), el('b', {}, s.stats.kills - s.stats.civKills)),
        el('div', { class: 'kv' }, el('span', {}, 'Vittime civili'), el('b', { class: s.stats.civKills ? 'bad' : '' }, s.stats.civKills)),
        el('div', { class: 'kv' }, el('span', {}, 'Agenti persi'), el('b', { class: s.lost.length ? 'bad' : '' }, s.lost.length ? s.lost.join(', ') : 'Nessuno')),
        s.win ? [
          el('hr'),
          el('div', { class: 'kv' }, el('span', {}, 'Ricompensa'), el('b', {}, fmt(s.reward))),
          s.bonus ? el('div', { class: 'kv' }, el('span', {}, 'Bonus'), el('b', { class: 'ok' }, '+' + fmt(s.bonus))) : null,
          s.penalty ? el('div', { class: 'kv' }, el('span', {}, 'Penale civili'), el('b', { class: 'bad' }, '-' + fmt(s.penalty))) : null,
          s.unlocked.length ? el('div', { class: 'kv' }, el('span', {}, 'Nuove armi'), el('b', { class: 'ok' }, s.unlocked.map((u) => WEAPONS[u]?.name).join(', '))) : null,
        ] : null),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => a.go('briefing', def) }, 'Riprova'),
        el('button', { class: 'btn big', onclick: () => a.go('hub') }, 'Continua')));
  }

  // ---------------------------------------------------------------- OPZIONI
  options(back) {
    const a = this.app, st = a.profile.settings;
    const slider = (label, key, apply) => {
      const inp = el('input', { type: 'range', min: 0, max: 100, value: Math.round(st[key] * 100), oninput: () => { st[key] = inp.value / 100; apply(st[key]); saveProfile(a.profile); } });
      return el('label', { class: 'opt' }, el('span', {}, label), inp);
    };
    const chk = (label, key, on) => {
      const inp = el('input', { type: 'checkbox', checked: !!st[key], onchange: () => { st[key] = inp.checked; on?.(); saveProfile(a.profile); } });
      return el('label', { class: 'opt' }, el('span', {}, label), inp);
    };
    const quality = el('select', { onchange: () => { st.quality = +quality.value; a.applyQuality(); saveProfile(a.profile); } },
      [[0.6, 'Bassa (60%)'], [0.8, 'Media (80%)'], [1, 'Alta (100%)']].map(([v, t]) => el('option', { value: v, selected: st.quality === v }, t)));
    return el('div', { class: 'options' },
      el('header', { class: 'bar' }, el('h1', {}, 'Opzioni')),
      el('div', { class: 'panel' },
        slider('Volume generale', 'master', (v) => setVolume('master', v)),
        slider('Effetti', 'sfx', (v) => setVolume('sfx', v)),
        slider('Musica', 'music', (v) => setVolume('music', v)),
        chk('Scorrimento ai bordi dello schermo', 'edge'),
        chk('Telecamera: segui la squadra', 'follow'),
        chk('Illuminazione notturna dinamica', 'lighting'),
        chk('Effetti meteo (pioggia, nebbia)', 'weatherFx'),
        el('label', { class: 'opt' }, el('span', {}, 'Risoluzione di rendering'), quality),
        el('hr'),
        el('button', { class: 'btn danger', onclick: () => { if (confirm('Cancellare tutti i progressi?')) { a.profile = resetProfile(); a.go('title'); } } }, 'Azzera salvataggio')),
      el('footer', { class: 'bar' }, el('button', { class: 'btn', onclick: () => a.go(back || 'title') }, '← Indietro')));
  }
}
