// Il corriere del tramonto — missione vetrina del kit narrativo.
// Beat: dialoghi schedati (ctx.dialog), talpa che cambia fazione al contatto
// (ctx.trigger + ctx.faction + ctx.give), coprifuoco + meteo dinamico alla
// consegna finale (ctx.lockdown + ctx.weather), camera cut (ctx.focus).
export default {
  init(ctx) {
    ctx.dialog([
      ['Centralino', 'Squadra, siete sul territorio. Quattro pacchetti, quattro recapiti: parco, piazza, nord, sud-est.', 'info'],
      ['Centralino', 'Al nord c\'è la Nostra Gente nella security: la Talpa. Non sparatele.', 'warn'],
    ]);
    // il contatto con la Talpa avviene solo entrando nel suo distretto
    ctx.trigger({ anchor: 'nw' }, 6, () => {
      const tp = ctx.get('talpa');
      if (tp && tp.alive) {
        ctx.faction(tp, 0); // cambia schieramento: ora combatte e segue con voi
        ctx.give(ctx.agents()[0], 'shotgun', 24);
        ctx.dialog([
          ['Talpa', 'Tenete: ho messo la bomba nel mio armadietto. Il furgone è a sud-est.', 'good'],
        ]);
      } else {
        ctx.dialog([
          ['Centralino', 'La Talpa è saltata. Piano B: tutto il distretto ora vi cerca.', 'bad'],
        ]);
        ctx.heat(30);
      }
    });
    ctx.state.locked = false;
  },
  onObjective(ctx, o) {
    if (o.def.type !== 'reach' || !o.def.via) return;
    // ultima consegna fatta: la corporazione sigilla la città
    ctx.state.locked = true;
    ctx.lockdown(true);
    ctx.weather('rain');
    const van = ctx.get('furgone');
    if (van) ctx.focus(van.x, van.y);
    ctx.dialog([
      ['Centralino', 'Il silenzio era un inganno: la città è sigillata. Coprifuoco.', 'bad'],
      ['Centralino', 'Il furgone è su una strada a sud-est. Il covo è a sud-ovest. Muovetevi.', 'warn'],
    ], 2.6);
  },
};
