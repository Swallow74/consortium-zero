#!/usr/bin/env python3
"""Genera js/worlddata.js dai confini Natural Earth (110m, pubblico dominio).

Uso:
    python3 tools/build_worldmap.py                       # scarica dal web
    python3 tools/build_worldmap.py percorso.geojson      # usa un file locale

Il risultato e' un modulo ES autonomo: nessuna richiesta di rete a runtime,
nessun asset esterno. Rigenerarlo solo se serve piu' dettaglio o una
semplificazione diversa.
"""
import json
import math
import sys
import urllib.request
from pathlib import Path

SRC_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_110m_admin_0_countries.geojson"
)
OUT = Path(__file__).resolve().parent.parent / "js" / "worlddata.js"

LAT_MIN, LAT_MAX = -58.0, 84.0   # taglia l'Antartide e il vuoto polare
TOLERANCE = 0.12                 # gradi: semplificazione Douglas-Peucker
MIN_AREA = 0.35                  # gradi^2: scarta isolotti invisibili
QUANT = 2000                     # unita' per lato del mondo


def load(path):
    if path:
        return json.loads(Path(path).read_text())
    with urllib.request.urlopen(SRC_URL, timeout=60) as r:
        return json.loads(r.read().decode())


def ring_area(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def dp(pts, tol):
    """Douglas-Peucker iterativo (niente ricorsione su anelli lunghi)."""
    n = len(pts)
    if n < 4:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tol * tol
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        x1, y1 = pts[i]
        x2, y2 = pts[j]
        dx, dy = x2 - x1, y2 - y1
        d2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if d2 == 0:
                dd = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = ((px - x1) * dx + (py - y1) * dy) / d2
                t = 0.0 if t < 0 else 1.0 if t > 1 else t
                dd = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2
            if dd > best:
                best, bi = dd, k
        if best > tol2:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


def clip_lat(ring):
    """Taglia l'anello alle latitudini ammesse (solo bordi orizzontali)."""
    out = []
    for i, (x, y) in enumerate(ring):
        y = min(LAT_MAX, max(LAT_MIN, y))
        if out and abs(out[-1][0] - x) < 1e-9 and abs(out[-1][1] - y) < 1e-9:
            continue
        out.append((x, y))
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def normalize(ring):
    """lon/lat -> 0..1 quantizzato, come interi."""
    flat = []
    for lon, lat in ring:
        x = round((lon + 180.0) / 360.0 * QUANT)
        y = round((LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * QUANT)
        flat.append(min(QUANT, max(0, x)))
        flat.append(min(QUANT, max(0, y)))
    return flat


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    data = load(src)
    out = []
    pts_total = 0
    for f in data["features"]:
        p = f["properties"]
        name = p.get("NAME_IT") or p.get("NAME") or p.get("ADMIN") or "?"
        if name in ("Antartide", "Antarctica"):
            continue
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        rings = []
        for poly in polys:
            outer = poly[0]
            if ring_area(outer) < MIN_AREA:
                continue
            simple = dp(outer, TOLERANCE)
            simple = clip_lat(simple)
            if len(simple) < 4:
                continue
            rings.append(normalize(simple))
            pts_total += len(simple)
        if rings:
            out.append({"n": name, "p": rings})
    out.sort(key=lambda c: c["n"])
    body = ",\n".join(
        "{n:%s,p:[%s]}" % (json.dumps(c["n"]), ",".join("[" + ",".join(map(str, r)) + "]" for r in c["p"]))
        for c in out
    )
    js = (
        "// GENERATO da tools/build_worldmap.py - NON modificare a mano.\n"
        "// Confini: Natural Earth 1:110m (dominio pubblico, naturalearthdata.com).\n"
        "// Coordinate normalizzate 0..%d su una proiezione equirettangolare\n"
        "// ritagliata a %g..%g di latitudine: x = (lon+180)/360, y = (latMax-lat)/(latMax-latMin).\n"
        "export const WORLD = { min: %d, latMin: %g, latMax: %g, countries: [\n%s\n] };\n"
        % (QUANT, LAT_MIN, LAT_MAX, QUANT, LAT_MIN, LAT_MAX, body)
    )
    OUT.write_text(js)
    print(f"{len(out)} paesi, {pts_total} vertici -> {OUT} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
