#!/usr/bin/env python3
"""Rigenera missions/index.json (fallback statico quando PHP non e' disponibile).
Uso: python3 tools/build_index.py"""
import json, os

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "missions")
out = []
for d in sorted(os.listdir(root)):
    if d[0] in "._":
        continue
    if os.path.isfile(os.path.join(root, d, "mission.json")):
        out.append({"folder": d, "id": d})
with open(os.path.join(root, "index.json"), "w", encoding="utf-8") as f:
    json.dump({"missions": out}, f, ensure_ascii=False, indent=2)
print(f"{len(out)} missioni indicizzate")
