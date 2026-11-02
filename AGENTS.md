# AGENTS.md — istruzioni per agenti AI

Progetto: **Consortium Zero**, clone tattico isometrico in sola tecnologia web. Zero dipendenze, zero build, zero asset esterni: grafica (Canvas 2D) e audio (WebAudio) sono procedurali e originali. Testi di gioco in **italiano**.

## Non fare mai
- Aggiungere librerie, framework, file di build, immagini/audio/fonti esterni.
- Nomi/marchi/asset reali di Bullfrog, EA, FreeSynd.
- Inventare campi in `mission.json`: il validatore e il motore ignorano ciò che non conoscono → silenziosamente persi.
- Modificare il motore per "abilitare" una missione: i contenuti nuovi si aggiungono solo in `missions/` (il motore legge `mission.json` + `mission.js`).
- Lasciare missioni non validate o `missions/index.json` non rigenerato dopo modifiche alle cartelle.

## Dove sono le istruzioni (per tipo di lavoro)

| Devi… | Leggi |
|---|---|
| Creare/modificare una missione (la guida completa) | [`docs/MISSIONI_AI.md`](docs/MISSIONI_AI.md) |
| Riferimento campi `mission.json`, hook script `ctx.*`, comandi, struttura | [`README.md`](README.md) |
| Copiare una struttura base | `missions/_template/mission.json` |
| Missioni semplici solo-JSON | `missions/01-primo-contratto` … `missions/04-convoglio` |
| Script con ondate al boss (`onKill` + `ctx.spawn/alarm`) | [`missions/05-torre-nera/mission.js`](missions/05-torre-nera/mission.js) |
| Script con minaccia a tempo (`escort` + `ctx.setPath`/`ctx.damage`) | [`missions/06-esecuzione/mission.js`](missions/06-esecuzione/mission.js) |
| Kit narrativo completo (`dialog`/`trigger`/`faction`/`lockdown`/`weather`/`focus`, obiettivi `via`+`board`) | [`missions/07-corriere/mission.js`](missions/07-corriere/mission.js) |
| Motore gameplay (cambi codice) | `js/` — mappa sotto |

## Mappa del motore (`js/`, ES modules, ~6.8k righe)

| File | Responsabilità |
|---|---|
| `main.js` | bootstrap, loop rAF, velocità/pausa, cambio schermate, audio unlock |
| `game.js` | mondo/turno: update unità, ordini (`orderMove/Attack/Persuade/Fire`), polizia/calore, pickups, fine missione |
| `mission.js` | `MissionState`: parsing dif, caricamento script, obiettivi/evaluate, `ctx` per gli script |
| `ai.js` | IA nemica (rilevamento, flanking, ripari, ondate), IA alleati (convinti che seguono) |
| `combat.js` | fuoco, danno (moltiplicatori per tipo/kind), esplosioni, persuasione, bombe |
| `map.js` / `gen.js` | tilemap + generatore città procedurale (ancore `spawn plaza pad park center tower tower_door nw ne se sw`) |
| `path.js` | A* (buffer stampati) + pathfinding stradale veicoli |
| `units.js` / `data.js` | entità (Unit/Vehicle/Pickup) e tabelle armi/potenziamenti/kind |
| `render.js` / `fx.js` / `themes.js` | render isometrico HiDPI con cache sprite, particelle, meteo, palette tema |
| `hud.js` / `screens.js` / `worldmap.js` / `input.js` | HUD in gioco, schermate menu/debrief/errore, mappa mondiale animata, comandi mouse/tastiera |
| `audio.js` / `profile.js` / `util.js` | WebAudio (sfx + musica + ambient meteo), profilo localStorage, helper |

## Comandi operativi

```bash
python3 serve.py                          # gioca: http://localhost:8080
python3 tools/random_mission.py [flags]   # genera missione casuale (valida e indicizzata)
python3 tools/validate_mission.py <cartella>   # verifica un mission.json (esce 1 se invalido)
python3 tools/build_index.py              # rigenera missions/index.json (fallback senza PHP)
```

## Playtest headless (obbligatorio prima di consegnare una missione)
Avvia `serve.py`, apri la pagina, poi in console del browser (snippet completo in `docs/MISSIONI_AI.md` §Flusso): `startMission` → `a._paused = true` → ciclo `g.update(1/60)`. Controlla: nessun errore, agenti vivi allo spawn dopo 20 s, obiettivi completabili. Verifica visiva reale con screenshot della finestra di gioco quando tocchi render/HUD/meteo.

## Deposito missioni in PHP
Su hosting PHP, `missions.php` elenca le cartelle a runtime (nessun index.json necessario). Senza PHP il gioco usa `missions/index.json` rigenerato da `build_index.py`.
