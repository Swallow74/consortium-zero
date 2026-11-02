// Esecuzione alla Fonderia: il tempo stringe davvero. Drenko smette di aspettare
// e va a uccidere l'ostaggio; il conto alla rovescia finisce solo se lo converti
// (o se lo estrai prima che lui ti raggiunga).
// ctx: game, time, spawn, spawnPickup, pos, say, get, units, agents, complete,
//      fail, win, addObjective, alarm, setPath, damage, state
export default {
  init(ctx) {
    ctx.state.hunt = false;
    ctx.state.execT = 0;
    ctx.state.warned = false;
  },
  onPersuade(ctx, o) {
    if (o.id === 'ostaggio') ctx.say('Brenner è dei nostri: portalo al punto di partenza.', 'good');
  },
  onKill(ctx, victim) {
    if (victim.id === 'drenko') ctx.say('Drenko è caduto: la sentenza è annullata.', 'good');
  },
  update(ctx, dt) {
    const ost = ctx.get('ostaggio');
    const dre = ctx.get('drenko');
    if (!ost || !ost.alive) return;
    // Drenko parte verso la sua vittima: allo scadere del tempo o appena gli agenti si avvicinano
    if (!ctx.state.hunt && dre && dre.alive) {
      const near = ctx.agents().some((ag) => Math.hypot(ag.x - ost.x, ag.y - ost.y) < 14);
      if (ctx.time > 18 || near) {
        ctx.state.hunt = true;
        ctx.say('Drenko si muove verso l\'ostaggio!', 'bad');
      }
    }
    if (!ctx.state.hunt || !dre || !dre.alive) return;
    dre._repath = (dre._repath || 0) + dt;
    if (dre._repath > 2) {
      dre._repath = 0;
      ctx.setPath(dre, ost.x, ost.y);
    }
    const d = Math.hypot(dre.x - ost.x, dre.y - ost.y);
    // a distanza: la pompa non perdona; l'ostaggio ha 120 punti vita
    if (d < 1.7) {
      if (!ctx.state.warned) { ctx.state.warned = true; ctx.say('Drenko sta per eseguire la sentenza!', 'bad'); }
      ctx.state.execT += dt;
      if (ctx.state.execT >= 1) {
        ctx.state.execT = 0;
        ctx.damage(ost, 34, dre, 'bullet');
      }
    } else {
      ctx.state.execT = 0;
    }
  },
};
