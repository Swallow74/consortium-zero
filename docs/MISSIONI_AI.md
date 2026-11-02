# Guida per agenti AI: creare missioni (anche casuali)

Una missione = una cartella `missions/NN-nome/` con `mission.json` (+ `mission.js` facoltativo). Nessuna modifica al codice del motore. Riferimento completo dei campi: `README.md` (campi missione e hook `ctx`). Esempi: `missions/01..07` (minaccia a tempo: `06-esecuzione/mission.js`; kit narrativo completo: `07-corriere/mission.js`).

## Flusso consigliato
1. **Base casuale**: `python3 tools/random_mission.py [--seed N] [--theme T] [--difficulty 1-5] [--type TIPO] [--after CART]`
   Tipi: `assassinio`, `epurazione`, `conversione`, `recupero`, `convoglio`. Temi: vedi sotto. `--after` (ripetibile) lega la missione a un checkpoint di campagna. Crea la cartella, aggiorna `missions/index.json` e valida.
2. **Rifinisci a mano** `mission.json`: nome, briefing (italiano, 2-3 frasi, atmosfera + indizio tattico), regione, ricompensa, entità extra, tema personalizzato.
3. **Valida**: `python3 tools/validate_mission.py <cartella>` (esce 1 se ci sono errori). Dopo ogni modifica di cartelle: `python3 tools/build_index.py`.
4. **Playtest headless** (obbligatorio prima di consegnare): avvia `python3 serve.py`, apri http://localhost:8080 in un browser con devtools, poi in console:
   ```js
   const a = window.__app; localStorage.clear();
   await a.startMission({ _folder: 'NN-nome' }); const g = a.game; a._paused = true;
   for (let i = 0; i < 3600; i++) { g.update(1/60); if (g.over) break; }
   console.log(g.agents.map(x => Math.round(x.hp)), g.over, g.mission.objectives.map(o => [o.def.text, o.done]));
   g.over = null; localStorage.clear();
   ```
   Nessun errore in console; gli agenti fermi allo spawn non devono morire nei primi 20 s; gli obiettivi devono essere raggiungibili. Azzera `localStorage` dopo i test (altrimenti agenti morti nel profilo).

## Regole di progetto
- Percorsi relativi. Cartelle che iniziano con `_` o `.` sono ignorate dall'elenco (usale per bozze/modelli).
- `order` univoco (le 6 campagne usano 1-6; le casuali 100+). Le missioni extra dichiarano `requires` verso un checkpoint di campagna (convenzione in fondo); `requires: []` solo per missioni volutamente aperte a tutti dal primo avvio.
- Testi in italiano con accenti corretti. Nessun marchio/asset reale di terzi.
- Non inventare campi: il validatore e il motore ignorano ciò che non conoscono.

## Mappa
- `"map": { "generate": { "seed", "w", "h", "layout", "water", "park", "plaza", "heightBias" } }` (w,h 40-70). `layout`: `grid` (default) | `distretti` (centro denso + supra-blocchi e viali diagonali) | `radiale` (anelli concentrici + assi) | `organico` (tratti a T, isolati irregolari) | `auto` (pesca dal seed, con acqua casuale). `water`: `none|south|east|fiume|baia` (`fiume`/`baia` con ponti: le corsie non vengono tagliate). Ancore generate: `spawn plaza pad park center tower tower_door nw ne se sw` (non garantite tutte: se serve una posizione sicura usa `spawn`, `plaza`, `center`, `nw/ne/se/sw`). Verifica in playtest che un'entità con ancora mancante non sparisca (console: `ancora mancante`).
- Oppure `"ascii"` + `"anchors"` per layout disegnati a mano (legenda in README). Le corsie `> < v ^` sono sensi unici: il traffico le rispetta e non svolta contromano; agli incroci `X` può svoltare solo verso una corsia libera nel verso giusto. Disegna pair di corsie opposte (es. righe adiacenti `>` e `<`) così le auto completano i giri; una corsia che finisce in un vicolo senza uscita legale intasa gli incroci a monte.
- Posizioni: `[x,y]`, `{anchor,dx,dy}`, `{rect:[x0,y0,x1,y1]}`, `{random:"pave|plaza|grass|road|any", near, radius}`.

## Tema grafico (`theme`)
`"theme": "deserto"` oppure `"theme": { "preset": "artico", ...override }`. Preset: `citta` (default neon), `deserto`, `industriale`, `artico`, `tossico`, `tramonto`. Ogni preset imposta anche luce `ambient` e `weather` di default (la missione può sovrascrivere con `weather`/`ambient`).

Override (tutti facoltativi):
| campo | formato | note |
|---|---|---|
| `styles` | array di `{wall, roof, neon, win:[c1,c2,c3]}` | indice = stile edificio (7 stili, scelti a caso per palazzo); override parziale per indice |
| `pave`, `road`, `grass`, `curb`, `laneCenter`, `trunk` | `#rrggbb` | **solo esadecimale a 6 cifre** (vengono schiarite/scurite) |
| `plaza` | `[#a, #b]` | scacchiera piazza |
| `water`, `sea`, `quay` | `[#a, #b]` | acqua interna, mare di sfondo (alto→basso), pareti banchina |
| `quayLine`, `laneDash` | CSS rgba | linee |
| `blade` | `[r,g,b]` | colore fili d'erba |
| `tree` | 3 colori | chiome |
| `ambient` | CSS `rgb(r,g,b)` | luce ambiente **moltiplicata**: scura = notte (`rgb(104,112,152)`), chiara = giorno (`rgb(236,214,176)`) |
| `weather` | `clear\|rain\|fog` | |

Per un nuovo preset riusabile: aggiungi una voce in `THEME_PRESETS` di `js/themes.js` (stessa forma). Mantieni contrasto: edifici/tetti distinguibili dall'asfalto, finestre luminose (`win`) più chiare del muro.

## Entità e obiettivi (riassunto sicuro)
- `kind`: `civilian|scientist|guard|police|enemy|vip|vehicle`. `guard`=fazione corp ai 1; `enemy`=agente rivale ai 3 (usa medikit); `vip` non persuadibile salvo `persuadable:true`.
- Armi valide: `pistol shotgun uzi longrange flamer minigun laser gauss bomb medikit` (+ `persuadertron scanner access` negli agenti/pickup). `ai` 1-3, `hp`, `speed` sono letti dal motore. Veicoli: `car van armored police`, `hostile`, `route` (lista posizioni, inseguita in ordine), `hp`.
- `id` obbligatorio per ciò che un obiettivo referenzia (`target`) ; `group` per `eliminate`/`kill` di gruppi; `count>1` genera id `id_1..n`.
- Obiettivi: `kill`(target|group|tag) `persuade` `eliminate`(group|faction) `reach`(at,radius,`via` a tappe ordinate,`all:false`,`early:true`) `retrieve`(item=id pickup quest) `destroy` `escort`(target,at) `board`(target=veicolo id) `survive`(seconds) `custom`. L'estrazione `reach` scatta per ultima (i `reach` con `via` si auto-ordinano; `early:true` la esonera). Opzionali: `optional`, `bonus`, `text`.
- `escort` **prima richiede la conversione**: finché il target non è `persuadable`/persuaso il progresso è `persuadilo` e non completa MAI; un bersaglio `vip` va marcato `persuadable:true`. Attenzione: un NPC convertito passa alla fazione 0 e i nemici nelle vicinanze aprono il fuoco su di lui — calibra distanze e scorte, o il "salvataggio" diventa un suicidio del bersaglio.
- `waves[]`: `{time|onAlarm|onHeat, entities, message, alert}` per rinforzi.
- `policeBackup:false` disattiva i rinforzi di polizia (missioni stealth/rapide).
- **Raggiungibilità (bug silenziosi)**: le ancore del generatore possono cadere in enclavi irraggiungibili a piedi da `spawn` (tipico: `center`/`tower` in certe seed) o su angoli senza strade. In playtest headless verifica `g.map.reach[Math.floor(y)*g.map.w+Math.floor(x)] === 1` per ogni obiettivo e punto `via`. I veicoli hanno bisogno di una strada entro 10 tile dalla posizione, altrimenti **spariscono senza errore**: per un parcheggio garantito usa `at:{random:"road",near:{anchor:...},radius:...}`.

## Kit narrativo (mission.js) — vetrina: `07-corriere`
- `ctx.after(sec,fn)` / `ctx.every(sec,fn)`: scheduler basato su `g.t`; i callback che uccidono/eliminano usano `ctx.damage`/`ctx.remove`, non `killUnit` diretto.
- `ctx.dialog([[mittente,testo,tone],...],gap)`: tostade a cascata (default 2.2 s l'una); `tone`: `info|warn|bad|good`.
- `ctx.trigger(pos,radius,fn)`: esegue `fn` **una sola volta** quando un agente entra nel raggio (raggio≥4 consigliato, gli agenti sono grossi).
- `ctx.faction(u,0)`: defezione → l'NPC diventa alleato, combatte e segue la squadra (come i persuasi). Ricorda: i nemici gli sparano.
- `ctx.give(u,arma,mun)`, `ctx.heal(u,n)`, `ctx.remove(u)`, `ctx.heat(n)`, `ctx.weather(...)`, `ctx.lockdown(on)` (coprifuoco permanente + calore 100: ondate continue; usalo per il "climax"), `ctx.focus(x,y)` (carrellata verso un punto narrativo).
- Ordine di esecuzione per tick: script `update` → scheduler/trigger → obiettivi. Un `ctx.complete/fail/win` interrompe il resto subito.
- I callback dello script non devono assumere che un'entità esista: `ctx.get(id)` può essere `undefined` o morto (vedi fallback Talpa morta in `07-corriere/mission.js`).

## Bilanciamento (misurato)
- Difficoltà 1: 5-6 guardie ai 1. Difficoltà 3: 9-10 guardie ai 2, 1-2 rivali. Difficoltà 5: rivali ai 3 + ondate. Mai più di ~12 nemici armati entro 15 tile dallo spawn.
- Nessun nemico a meno di 12 tile dallo spawn (default per spawn senza `at`; con `at` controlla tu la distanza).
- Le guardie in `patrol:"random"` coprono bene una piazza; guardie statiche vicino all'obiettivo creano scontri tattici.
- `timeLimit` solo se serve (secondi); `parTime` ≈ 240 + 60×difficoltà.
- Minacce a tempo: con `ctx.setPath(unit,x,y)` e `ctx.damage(v,amt,fonte,tipo)` uno script può far muovere un NPC verso un bersaglio e ucciderlo (es. esecuzione di un ostaggio) — vedi `missions/06-esecuzione/mission.js`. La minaccia deve essere intercettabile: dai al giocatore il tempo di arrivare (distanza/densità) e rendi l'eliminazione della fonte la via di risoluzione.
- Ricompensa tipica: 4000 + 6000×difficoltà.

## Missioni casuali: ricetta per variare davvero
Combina a caso (seed registrato in `seed`): tema × meteo × tipo di obiettivo × dimensione mappa × densità nemici × presenza di ondate/script. Per più varietà aggiungi 1 elemento extra: un veicolo ostile di pattuglia, un pickup d'arma sul percorso, un obiettivo bonus opzionale, un `mission.js` con un evento (es. `ctx.say` + `ctx.spawn` a metà missione).

## Missioni extra: checkpoint e difficoltà (convenzione)
Il negozio è **globale**: `p.owned`/`p.unlocked`/`p.money` vengono da tutte le missioni vinte, non solo dalla campagna. Una extra senza `requires` si offre quindi a *chiunque*: un rookie entra solo con pistol e 14k, un veterano con tutto l'arsenale della campagna già pagabile. Da qui due regole:

1. **Checkpoint per fascia** — metti `requires` verso l'ultimo checkpoint di campagna che un giocatore di quella fascia ha già fatto (il tool lo fa con `--after`):
   - difficoltà 1-2 → `"requires": ["01-primo-contratto"]`
   - difficoltà 3 → `"requires": ["03-epurazione"]`
   - difficoltà 4-5 → `"requires": ["07-corriere"]`
   Il validatore rifiuta `requires` che puntano a missioni inesistenti o in ciclo: l'id è il **nome della cartella**.
2. **La difficoltà viene dalla composizione, non dal gate.** L'equipaggiamento del giocatore non si può limitare via file; rendi la missione interessante anche per una squadra ricca usando ciò che le armi non risolvono da sole: obiettivi `escort`/`persuade` con bersaglio fragile (ucciderlo = sconfitta), `retrieve` in zona sorvegliata con `policeHostile`, ondate crescenti (`waves`/`onKill`, modello 05), `lockdown` a tempo, civili da non macellare in spazi stretti. "Elimina N guardie" è facile o impossibile a seconda di chi entra; "porta Okafor viva fuori da una città in coprifuoco" resta tattico per tutti.
