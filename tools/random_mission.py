#!/usr/bin/env python3
"""Genera una missione casuale valida in missions/<NN>-<slug>/ (solo stdlib).
Uso: python3 tools/random_mission.py [--seed N] [--theme nome] [--difficulty 1-5] [--type tipo] [--out cartella] [--after cartella]
Tipi: assassinio, epurazione, conversione, recupero, convoglio. Poi: tools/validate_mission.py e build_index.py.
--after lega la missione a un checkpoint di campagna (ripetibile): il giocatore la vede solo dopo aver completato quella.
Convenzione (docs/MISSIONI_AI.md): diff 1-2 -> --after 01-primo-contratto; diff 3 -> 03-epurazione; diff 4-5 -> 07-corriere.
Il risultato è un punto di partenza: l'agente AI può rifinire briefing, nome e dettagli (vedi docs/MISSIONI_AI.md)."""
import argparse, json, os, random, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MROOT = os.path.join(ROOT, "missions")
THEMES = ["citta", "deserto", "industriale", "artico", "tossico", "tramonto"]
TYPES = ["assassinio", "epurazione", "conversione", "recupero", "convoglio"]
WEATHER_BY_THEME = {"citta": ["rain", "clear", "fog"], "deserto": ["clear"], "industriale": ["fog", "rain", "clear"], "artico": ["clear", "fog"], "tossico": ["fog", "rain"], "tramonto": ["clear"]}
CITIES = {"citta": ["Marsiglia Nord", "Lione Est", "Torino Sud", "Rotterdam"], "deserto": ["Dubai Vecchia", "Tucson", "Marrakech", "Aswan"], "industriale": ["Detroit", "Katowice", "Gelsenkirchen", "Ulsan"], "artico": ["Murmansk", "Tromsø", "Nuuk", "Yakutsk"], "tossico": ["Chernobyl Zona 3", "Bhopal", "Cubatão", "Norilsk"], "tramonto": ["Los Angeles", "Lagos", "Rio", "Sydney"]}
LAYOUT_BY_THEME = {"citta": ["grid", "distretti", "organico"], "deserto": ["grid", "radiale"], "industriale": ["distretti", "grid"], "artico": ["grid", "radiale"], "tossico": ["distretti", "organico"], "tramonto": ["organico", "radiale", "distretti"]}
WATER_BY_THEME = {"citta": ["none", "fiume", "baia"], "deserto": ["none"], "industriale": ["none", "fiume"], "artico": ["none"], "tossico": ["none", "fiume"], "tramonto": ["baia", "none", "fiume"]}
ADJ = ["Cenere", "Vetro", "Ombra", "Ruggine", "Ghiaccio", "Neon", "Sabbia", "Veleno", "Eco", "Falco", "Spettro", "Ferro"]
NOUN = {"assassinio": ["Contratto", "Esecuzione", "Silenzio"], "epurazione": ["Epurazione", "Pulizia", "Rappresaglia"], "conversione": ["Conversione", "Defezione", "Mente"], "recupero": ["Recupero", "Furto", "Dossier"], "convoglio": ["Convoglio", "Transito", "Carico"]}
BRIEF = {
    "assassinio": "Un dirigente della corporazione {city} si muove sotto scorta. Eliminalo e raggiungi l'estrazione prima che l'allarme chiami i rinforzi.",
    "epurazione": "Agenti rivali della corporazione presidiano {city}. Elimina tutta la squadra: sono addestrati e usano i medikit.",
    "conversione": "Una scienziata a {city} conosce i codici del progetto Aurex. Persuadila con il Persuadertron e scortala all'estrazione. Se muore, la missione è persa.",
    "recupero": "Un case di dati è custodito a {city}. Recuperalo dalla piazza centrale, evita i civili e portalo all'estrazione.",
    "convoglio": "Un blindato corporativo pattuglia {city}. Distruggilo (servono esplosivi o fuoco prolungato) e recupera il carico.",
}


def build(a):
    r = random.Random(a.seed)
    th = a.theme or r.choice(THEMES)
    typ = a.type or r.choice(TYPES)
    dif = a.difficulty or r.randint(1, 4)
    city = r.choice(CITIES[th])
    size = r.choice([52, 56, 60, 64])
    seed = r.randint(1, 9999)
    guards = 3 + dif * 2
    ai = min(3, 1 + dif // 2)
    gun = r.choice(["uzi", "pistol"] if dif < 3 else ["uzi", "shotgun"])
    d = {
        "name": f"{r.choice(NOUN[typ])} {r.choice(ADJ)}", "order": 100 + a.seed % 900, "requires": list(a.after or []),
        "region": {"name": city, "x": round(r.uniform(0.1, 0.9), 2), "y": round(r.uniform(0.15, 0.85), 2)},
        "difficulty": dif, "reward": 4000 + dif * 6000 + r.randint(0, 3) * 500, "parTime": 240 + dif * 60, "unlocks": [],
        "seed": seed, "traffic": r.randint(6, 16), "weather": r.choice(WEATHER_BY_THEME[th]), "theme": th,
        "briefing": BRIEF[typ].format(city=city),
        "map": {"generate": {"seed": seed, "w": size, "h": size, "layout": r.choice(LAYOUT_BY_THEME[th]), "water": r.choice(WATER_BY_THEME[th])}}, "start": {"anchor": "spawn"},
        "entities": [
            {"kind": "civilian", "count": r.randint(14, 30), "zone": "pave"},
            {"kind": "police", "count": 2 + dif // 2, "zone": "pave"},
            {"kind": "guard", "id": "g", "count": guards, "at": {"anchor": "plaza"}, "spread": 5, "weapons": [gun], "ai": ai, "patrol": "random", "group": "scorta"},
        ],
        "pickups": [{"item": "medikit", "at": {"anchor": "park"}}], "objectives": [],
    }
    E, O, P = d["entities"], d["objectives"], d["pickups"]
    extract = {"type": "reach", "at": {"anchor": "spawn"}, "radius": 4, "text": "Estrazione"}
    if typ == "assassinio":
        E.append({"kind": "vip", "id": "target", "name": "Il dirigente", "at": {"anchor": "tower_door"}, "weapons": ["pistol"], "ai": 2, "hp": 90 + dif * 15})
        O += [{"type": "kill", "target": "target", "text": "Elimina il dirigente"}, {"type": "eliminate", "group": "scorta", "optional": True, "bonus": True, "text": "Elimina la scorta"}, extract]
    elif typ == "epurazione":
        E.append({"kind": "enemy", "id": "rival", "count": 2 + dif, "at": {"anchor": "plaza"}, "spread": 6, "weapons": ["uzi", "medikit"], "ai": 3, "group": "rivali", "patrol": "random"})
        O += [{"type": "eliminate", "group": "rivali", "text": "Elimina gli agenti rivali"}, extract]
    elif typ == "conversione":
        E.append({"kind": "scientist", "id": "target", "name": "La dottoressa", "at": {"anchor": "park"}, "persuadable": True})
        O += [{"type": "persuade", "target": "target", "text": "Persuadi la dottoressa"}, {"type": "escort", "target": "target", "at": {"anchor": "spawn"}, "radius": 4, "text": "Scortala all'estrazione"}]
    elif typ == "recupero":
        P.append({"id": "case", "item": "dati", "label": "Case dati", "quest": True, "at": {"anchor": "plaza", "dx": 1}})
        O += [{"type": "retrieve", "item": "case", "text": "Recupera il case dati"}, extract]
    else:
        E.append({"kind": "vehicle", "id": "conv", "type": "armored", "at": {"anchor": "nw"}, "hostile": True, "hp": 500 + dif * 50, "route": [{"anchor": "ne"}, {"anchor": "se"}, {"anchor": "sw"}, {"anchor": "nw"}], "group": "convoglio"})
        P += [{"item": "bomb", "at": {"anchor": "center"}}, {"id": "case", "item": "dati", "label": "Case dati", "quest": True, "at": {"anchor": "plaza", "dx": 1}}]
        O += [{"type": "destroy", "target": "conv", "text": "Distruggi il blindato"}, {"type": "retrieve", "item": "case", "text": "Recupera il case dati"}, extract]
    if dif >= 3:
        d["waves"] = [{"onAlarm": True, "message": "Rinforzi in arrivo!", "alert": True, "entities": [{"kind": "guard", "count": dif, "at": {"anchor": "plaza"}, "spread": 6, "weapons": ["uzi"], "ai": ai}]}]
    return d, typ


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=random.randint(1, 99999))
    ap.add_argument("--theme", choices=THEMES)
    ap.add_argument("--difficulty", type=int, choices=range(1, 6))
    ap.add_argument("--type", choices=TYPES)
    ap.add_argument("--out")
    ap.add_argument("--after", action="append", metavar="CARTELLA",
                    help="missione di campagna da completare prima (ripetibile); scrive requires")
    a = ap.parse_args()
    if a.after:
        for r_id in a.after:
            if not os.path.isdir(os.path.join(MROOT, r_id)):
                ap.error(f"--after: cartella inesistente in missions/: {r_id}")
    d, typ = build(a)
    slug = re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")
    folder = a.out or f"{d['order']:03d}-{slug}"
    path = os.path.join(MROOT, folder)
    os.makedirs(path, exist_ok=True)
    with open(os.path.join(path, "mission.json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    gate = " dopo " + ", ".join(d["requires"]) if d["requires"] else " (subito giocabile)"
    print(f"creata missions/{folder} ({typ}, tema {d['theme']}, diff {d['difficulty']}){gate}")
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_index.py")], check=True)
    sys.exit(subprocess.run([sys.executable, os.path.join(ROOT, "tools", "validate_mission.py"), folder]).returncode)


main()
