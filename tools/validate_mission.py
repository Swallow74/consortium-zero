#!/usr/bin/env python3
"""Valida missions/<cartella>/mission.json (solo stdlib).
Uso: python3 tools/validate_mission.py [cartella ...]   (senza argomenti: tutte)
Esce con codice 1 se ci sono errori. Gli avvisi non bloccano."""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MROOT = os.path.join(ROOT, "missions")
ANCHORS = {"spawn", "plaza", "pad", "park", "center", "tower", "tower_door", "nw", "ne", "se", "sw"}
KINDS = {"civilian", "scientist", "guard", "police", "enemy", "vip", "vehicle"}
VTYPES = {"car", "van", "armored", "police"}
OBJ = {"kill", "persuade", "eliminate", "reach", "retrieve", "destroy", "escort", "survive", "custom", "board"}
ZONES = {"pave", "plaza", "grass", "road", "any"}
WEATHER = {"clear", "rain", "fog"}
LAYOUTS = {"grid", "distretti", "radiale", "organico", "auto"}
WATERS = {"none", "south", "east", "fiume", "baia"}
GEN_KEYS = {"seed", "w", "h", "block", "roads", "park", "plaza", "heightBias", "ring", "margin", "layout", "water"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
THEME_HEX = ["pave", "road", "grass", "trunk", "curb", "laneCenter"]


def weapons_ids():
    src = open(os.path.join(ROOT, "js", "data.js"), encoding="utf-8").read()
    block = src.split("export const WEAPONS", 1)[1].split("export const OFFENSIVE", 1)[0]
    return set(re.findall(r"^  (\w+):", block, re.M))


def presets():
    src = open(os.path.join(ROOT, "js", "themes.js"), encoding="utf-8").read()
    block = src.split("THEME_PRESETS", 1)[1].split("export function resolveTheme", 1)[0]
    return set(re.findall(r"^  (\w+): ", block, re.M))


def all_missions():
    """folder -> requires (lista di id) per tutte le missioni esistenti."""
    out = {}
    for x in sorted(os.listdir(MROOT)):
        p = os.path.join(MROOT, x, "mission.json")
        if x[0] not in "._" and os.path.isdir(os.path.join(MROOT, x)) and os.path.isfile(p):
            try:
                rq = json.load(open(p, encoding="utf-8")).get("requires")
                out[x] = [r for r in rq if isinstance(r, str)] if isinstance(rq, list) else []
            except Exception:
                out[x] = []
    return out


def find_cycles(known):
    """folder -> descrizione del ciclo per ogni nodo coinvolto in un ciclo di requires."""
    color, stack, out = {}, [], {}

    def dfs(u):
        color[u] = 1
        stack.append(u)
        for v in known.get(u, []):
            if v not in known:
                continue
            if color.get(v, 0) == 1:
                i = stack.index(v)
                cyc = stack[i:] + [v]
                for node in stack[i:]:
                    out.setdefault(node, " -> ".join(cyc))
            elif color.get(v, 0) == 0:
                dfs(v)
        stack.pop()
        color[u] = 2

    for u in known:
        if color.get(u, 0) == 0:
            dfs(u)
    return out


def validate(folder, known=None, cycle=None):
    err, warn = [], []
    path = os.path.join(MROOT, folder, "mission.json")
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        return [f"JSON non valido: {e}"], []
    W = weapons_ids()
    P = presets()
    for k in ("name", "briefing", "map", "start", "objectives"):
        if k not in d:
            err.append(f"campo mancante: {k}")
    if d.get("weather") and d["weather"] not in WEATHER:
        err.append(f"weather non valido: {d['weather']}")
    if not 1 <= d.get("difficulty", 1) <= 5:
        err.append("difficulty fuori da 1-5")
    if known is None:
        known = all_missions()
    rq = d.get("requires", [])
    if rq:
        if not isinstance(rq, list) or any(not isinstance(x, str) for x in rq):
            err.append("requires deve essere una lista di id (stringhe)")
        else:
            if folder in rq:
                err.append(f"requires: auto-riferimento '{folder}' (non sarà mai giocabile)")
            for r in rq:
                if r not in known and r != folder:
                    err.append(f"requires: '{r}' non è una missione esistente (resterà bloccata per sempre)")
    if cycle:
        err.append(f"requires: ciclo di dipendenza: {cycle}")

    th = d.get("theme")
    if isinstance(th, str):
        th = {"preset": th}
    if th:
        if th.get("preset") and th["preset"] not in P:
            err.append(f"theme.preset sconosciuto: {th['preset']} (validi: {', '.join(sorted(P))})")
        for k in THEME_HEX:
            if k in th and not HEX.match(str(th[k])):
                err.append(f"theme.{k} deve essere #rrggbb")
        for i, s in enumerate(th.get("styles", [])):
            for k in ("wall", "roof"):
                if k in s and not HEX.match(s[k]):
                    err.append(f"theme.styles[{i}].{k} deve essere #rrggbb")
            if "win" in s and len(s["win"]) < 1:
                err.append(f"theme.styles[{i}].win vuoto")

    m = d.get("map", {})
    gen = "generate" in m
    if not gen and "ascii" not in m:
        err.append("map: serve generate o ascii")
    if gen:
        g = m["generate"]
        if not (36 <= g.get("w", 56) <= 90 and 36 <= g.get("h", 56) <= 90):
            warn.append("map.generate w/h consigliati 40-70")
        for k in g:
            if k not in GEN_KEYS:
                warn.append(f"map.generate: campo sconosciuto '{k}' ignorato dal motore")
        if g.get("layout") is not None and g["layout"] not in LAYOUTS:
            err.append(f"map.generate.layout non valido: {g['layout']} (validi: {'|'.join(sorted(LAYOUTS))})")
        if g.get("water") is not None and g["water"] not in WATERS:
            err.append(f"map.generate.water non valido: {g['water']} (validi: {'|'.join(sorted(WATERS))})")

    def pos_ok(spec, where):
        if spec is None or isinstance(spec, list):
            return
        if "anchor" in spec:
            if gen and spec["anchor"] not in ANCHORS and spec["anchor"] not in m.get("anchors", {}):
                err.append(f"{where}: ancora sconosciuta '{spec['anchor']}'")
        elif not any(k in spec for k in ("rect", "random", "x")):
            err.append(f"{where}: posizione non valida")
        elif "random" in spec and spec["random"] not in ZONES:
            err.append(f"{where}: random '{spec['random']}' non valido")

    pos_ok(d.get("start"), "start")
    ids = set()
    for i, e in enumerate(d.get("entities", [])):
        w = f"entities[{i}]"
        if e.get("kind") not in KINDS:
            err.append(f"{w}: kind non valido")
            continue
        if e["kind"] == "vehicle" and e.get("type", "car") not in VTYPES:
            err.append(f"{w}: type veicolo non valido")
        if e.get("zone") and e["zone"] not in ZONES:
            err.append(f"{w}: zone non valida")
        for wp in e.get("weapons", []):
            if wp not in W:
                err.append(f"{w}: arma sconosciuta '{wp}'")
        if e.get("ai") and not 1 <= e["ai"] <= 3:
            err.append(f"{w}: ai 1-3")
        pos_ok(e.get("at"), w + ".at")
        for j, r in enumerate(e.get("route", [])):
            pos_ok(r, f"{w}.route[{j}]")
        if e.get("id"):
            ids.add(e["id"])
        if e.get("group"):
            ids.add("group:" + e["group"])
    pk_ids = set()
    for i, p in enumerate(d.get("pickups", [])):
        pos_ok(p.get("at"), f"pickups[{i}].at")
        if p.get("id"):
            pk_ids.add(p["id"])
        if not p.get("quest") and p.get("item") not in W:
            warn.append(f"pickups[{i}]: item '{p.get('item')}' non è un'arma (ok solo se quest)")
    if not d.get("objectives"):
        err.append("nessun obiettivo")
    for i, o in enumerate(d.get("objectives", [])):
        w = f"objectives[{i}]"
        if o.get("type") not in OBJ:
            err.append(f"{w}: type non valido")
            continue
        t = o["type"]
        if t in ("kill", "persuade", "destroy", "escort", "board") and o.get("target") and o["target"] not in ids:
            err.append(f"{w}: target '{o['target']}' non esiste tra le entities")
        if t == "board" and not o.get("target"):
            err.append(f"{w}: board richiede target (id del veicolo)")
        if t == "board" and o.get("target"):
            tg = next((e for e in d.get("entities", []) if e.get("id") == o["target"]), None)
            if not tg or tg.get("kind") != "vehicle":
                err.append(f"{w}: board richiede un'entità vehicle come target")
        if o.get("group") and "group:" + o["group"] not in ids:
            err.append(f"{w}: group '{o['group']}' non esiste")
        if t == "retrieve" and o.get("item") not in pk_ids:
            err.append(f"{w}: item '{o.get('item')}' non corrisponde a un pickup con id")
        if t in ("reach", "escort"):
            pos_ok(o.get("at"), w + ".at")
        for j, v in enumerate(o.get("via", []) or []):
            pos_ok(v, w + f".via[{j}]")
        if t == "eliminate" and not (o.get("group") or o.get("faction")):
            warn.append(f"{w}: eliminate senza faction/group = fazione corp")
        if t == "persuade":
            tg = next((e for e in d.get("entities", []) if e.get("id") == o.get("target")), None)
            if tg and tg.get("kind") == "vip" and not tg.get("persuadable"):
                err.append(f"{w}: il vip va marcato persuadable:true")
    if not any(o.get("type") == "reach" for o in d.get("objectives", [])):
        warn.append("nessun obiettivo reach (estrazione)")
    return err, warn


def main():
    folders = sys.argv[1:] or sorted(x for x in os.listdir(MROOT) if x[0] not in "._" and os.path.isdir(os.path.join(MROOT, x)))
    known = all_missions()
    cyc = find_cycles(known)
    bad = 0
    for f in folders:
        f = os.path.basename(f.rstrip("/"))
        err, warn = validate(f, known, cyc.get(f))
        print(("OK   " if not err else "ERR  ") + f)
        for x in err:
            print("   errore:", x)
        for x in warn:
            print("   avviso:", x)
        bad += bool(err)
    sys.exit(1 if bad else 0)


main()
