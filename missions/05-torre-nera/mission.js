// Script opzionale di missione. Esporta un oggetto con hook facoltativi.
// ctx: game, time, spawn(spec), spawnPickup(spec), pos(spec), say(testo, tipo), get(id), units(filtro),
//      agents(), complete(idCustom), fail(motivo), win(), addObjective(def), alarm()
export default {
  init(ctx) {
    ctx.say('Sistemi di sicurezza attivi: cancelli a tessera.', 'warn');
    ctx.state.waveSent = false;
  },
  update(ctx) {
    // l'obiettivo "card" si completa quando un agente possiede la tessera
    if (ctx.agents().some((a) => a.has('access'))) ctx.complete('card');
  },
  onKill(ctx, victim) {
    if (victim.id === 'boss' && !ctx.state.waveSent) {
      ctx.state.waveSent = true;
      ctx.say('Kessler è morto! Rinforzi in arrivo!', 'bad');
      ctx.alarm();
      ctx.spawn({ kind: 'enemy', count: 3, at: { anchor: 'tower_door' }, spread: 3, weapons: ['uzi', 'medikit'], minDist: 0 });
      ctx.spawn({ kind: 'guard', count: 4, at: { anchor: 'yard' }, spread: 4, weapons: ['uzi'], minDist: 0 });
    }
  },
};
