"""The digital twin: the finished building, and the sensors a smart building puts in it, floor by floor.

Which systems are there comes from the project itself: a system the MEP scope installs (fire protection, air conditioning, CCTV, power panels,
solar, pumps and the STP, the lift) is in scope, with the work package that says so. What a client often adds to make the building smart, but
no document here asks for, is offered apart as an add-on. How many devices go on a floor follows a stated rule of thumb per floor area, for a
designer to check, never a measured design.

There is no building management system behind it yet. A device's readings are real once a system sends them to /api/project/twin/readings;
until then the screen simulates them and says so. Nothing here is stored as if it had been measured.
"""

from __future__ import annotations

import math
import re
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import model3d, modules as M, project as P

# key, name, the words a work package uses for it, a colour, the devices: (kind, name, how many: ("area", m2 each) | ("floor", n) | ("ground", n) | ("roof", n), the metrics)
SYSTEMS = [
    ("fire", "Fire protection", r"kebakaran|\bapar\b|hydrant|hidran|sprinkler|fire alarm|alarm kebakaran", "#e5484d",
     [("smoke", "Smoke detector", ("area", 60), ["alarm"]), ("call", "Manual call point", ("floor", 2), ["alarm"]), ("flow", "Sprinkler flow switch", ("floor", 1), ["flow"]), ("panel", "Fire alarm panel", ("ground", 1), ["alarm"])]),
    ("hvac", "Air conditioning", r"tata udara|exhaust|\bac\b|hvac|ventilasi|air condition", "#3987e5",
     [("climate", "Temperature and humidity", ("area", 100), ["temperature", "humidity"]), ("co2", "CO₂ sensor", ("area", 150), ["co2"])]),
    ("cctv", "CCTV", r"cctv|kamera", "#9085e9",
     [("camera", "Camera", ("area", 150), ["online", "people"])]),
    ("energy", "Power and energy", r"panel|listrik|solar|genset|\bmdp\b|\bsdp\b|tenaga listrik", "#c98500",
     [("meter", "kWh meter, floor panel", ("floor", 1), ["power"]), ("main", "Main panel meter", ("ground", 1), ["power"]), ("solar", "Solar inverter", ("roof", 1), ["generation"])]),
    ("water", "Water and plumbing", r"plambing|plumbing|pompa|\bstp\b|ground water tank|tangki|sanitari|air bersih", "#199e70",
     [("tank", "Tank level", ("ground", 1), ["level"]), ("roof_tank", "Roof tank level", ("roof", 1), ["level"]), ("pump", "Pump", ("ground", 1), ["running", "pressure"]), ("stp", "STP sensor", ("ground", 1), ["ph"])]),
    ("lift", "Lift", r"\blift\b|elevator", "#d55181",
     [("lift", "Lift controller", ("ground", 1), ["trips", "fault"])]),
]
ADD_ONS = [  # what a smart building often adds, that the documents here do not ask for
    ("lighting", "Smart lighting", "#d95926", [("occupancy", "Occupancy and light sensor", ("area", 80), ["occupancy", "lux"])], "turns lights and air off in empty rooms"),
    ("access", "Access control", "#8f99a8", [("reader", "Card reader", ("floor", 2), ["entries"])], "who goes where, and when"),
    ("structure", "Structural health", "#e66767", [("accel", "Accelerometer", ("every", 2), ["vibration"]), ("tilt", "Tilt meter", ("roof", 1), ["tilt"])], "vibration and tilt, to catch damage early"),
]
METRICS = {  # unit, normal range for the simulation, the line past which it alerts
    "alarm": ("", (0, 0), 1), "flow": ("", (0, 0), 1), "temperature": ("°C", (23, 27), 28), "humidity": ("%", (50, 65), 70), "co2": ("ppm", (500, 900), 1000),
    "online": ("", (1, 1), None), "people": ("", (0, 25), None), "power": ("kW", (8, 30), None), "generation": ("kW", (0, 40), None), "level": ("%", (45, 90), None),
    "running": ("", (0, 1), None), "pressure": ("bar", (2.5, 4.5), None), "ph": ("", (6.8, 7.6), 8.5), "trips": ("", (0, 40), None), "fault": ("", (0, 0), 1),
    "occupancy": ("%", (0, 90), None), "lux": ("lx", (300, 600), None), "entries": ("", (0, 60), None), "vibration": ("mm/s", (0.1, 1.2), 5), "tilt": ("°", (0, 0.05), 0.2),
}


def _systems_in_scope(names: list[str]) -> dict[str, list[str]]:
    """Each system the scope installs, with the work packages that say so."""
    return {key: [n for n in names if re.search(words, n, re.I)] for key, _, words, _, _ in SYSTEMS}


def _place(model: dict, rule: tuple, floors: list[dict]) -> list[tuple[str, float, float, float]]:
    """Where a kind of device goes: spread over each floor by area, a few per floor by the core, or one at the ground or on the roof."""
    w, d = model["width"], model["depth"]
    out = []
    kind, n = rule
    if kind == "area":
        per = max(1, math.ceil(w * d / n))
        cols = max(1, round(math.sqrt(per * w / d)))
        rows = max(1, math.ceil(per / cols))
        for f in floors:
            for k in range(per):
                c, r = k % cols, k // cols
                out.append((f["name"], -w / 2 + (c + 0.5) * w / cols, f["elevation"] + 2.6, -d / 2 + (r + 0.5) * d / rows))
    elif kind in ("floor", "every"):
        for i, f in enumerate(floors):
            if kind == "every" and i % n:
                continue
            for k in range(1 if kind == "every" else n):
                out.append((f["name"], -w / 2 + 2.5 + k * 3, f["elevation"] + 1.6, d / 2 - 2.5))
    elif kind == "ground":
        g = next((f for f in floors if f["index"] == 0), floors[0])
        for k in range(n):
            out.append((g["name"], w / 2 - 2 - k * 2.5, g["elevation"] + 1.2, -d / 2 + 2))
    elif kind == "roof":
        for k in range(n):
            out.append(("Roof", -w / 4 + k * 4, model["top"] + 1.5, 0.0))
    return out


def schema() -> dict:
    model = model3d.build()
    floors = sorted([f for f in model.get("storeys", []) if f.get("planned", True)], key=lambda f: f["index"])
    if not floors or not model.get("width"):
        return {"floors": [], "systems": [], "devices": [], "note": "No building to place sensors in yet: the 3D model needs work packages with floors."}
    names = [a["name"] for a in P.all_of("activity")] + [p["name"] for p in P.all_of("package")]
    found = _systems_in_scope(names)
    if model.get("lift"):
        found["lift"] = found["lift"] or ["the 3D model has a lift core"]
    systems, devices = [], []

    def add(key: str, name: str, color: str, kinds: list, in_scope: bool, why: list[str] | str) -> None:
        count = 0
        for kind, label, rule, metrics in kinds:
            if kind == "solar" and not any(re.search(r"solar", n, re.I) for n in names):
                continue
            for k, (floor, x, y, z) in enumerate(_place(model, rule, floors)):
                devices.append({"id": f"{key}-{kind}-{k + 1:03d}", "system": key, "kind": kind, "name": label, "floor": floor, "x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
                                "metrics": metrics, "topic": f"northteak/{P.DB.stem}/{floor.lower().replace(' ', '-')}/{key}/{key}-{kind}-{k + 1:03d}"})
                count += 1
        rule_text = "; ".join(f"{label}: {('one per %d m²' % r[1]) if r[0] == 'area' else ('%d a floor' % r[1]) if r[0] == 'floor' else ('one every %d floors' % r[1]) if r[0] == 'every' else ('%d at the ground' % r[1]) if r[0] == 'ground' else ('%d on the roof' % r[1])}"
                              for _, label, r, _ in kinds)
        systems.append({"key": key, "name": name, "color": color, "in_scope": in_scope, "why": why, "devices": count, "rule": rule_text})

    for key, name, _, color, kinds in SYSTEMS:
        if found.get(key):
            add(key, name, color, kinds, True, found[key][:3])
    for key, name, color, kinds, why in ADD_ONS:
        add(key, name, color, kinds, False, why)
    units = {m: {"unit": u, "normal": list(n), "alert": a} for m, (u, n, a) in METRICS.items()}
    return {"floors": [{"name": f["name"], "elevation": f["elevation"], "index": f["index"]} for f in floors] + [{"name": "Roof", "elevation": model["top"], "index": 99}],
            "systems": systems, "devices": devices, "metrics": units, "area": round(model["width"] * model["depth"]), "readings": P.meta("twin_readings") or {}}


# ------------------------------------------------------------------------------------------------ readings a building's systems send


class Reading(BaseModel):
    device: str
    metric: str
    value: float
    at: str = ""


def take(readings: list[Reading]) -> dict:
    """Readings from the building's systems: the latest of each device's metric is kept, and from then on that device shows live, not simulated."""
    known = {d["id"]: d for d in schema()["devices"]}
    kept = P.meta("twin_readings") or {}
    refused = []
    for r in readings:
        d = known.get(r.device)
        if not d or r.metric not in d["metrics"]:
            refused.append(f"{r.device}/{r.metric}")
            continue
        kept.setdefault(r.device, {})[r.metric] = {"value": r.value, "at": r.at or time.strftime("%Y-%m-%dT%H:%M:%S")}
    P.set_meta("twin_readings", kept)
    return {"kept": len(readings) - len(refused), "refused": refused}


router = APIRouter()


@router.get("/api/project/twin")
def twin() -> dict:
    return schema()


@router.post("/api/project/twin/readings")
def readings(body: list[Reading]) -> dict:
    if not body:
        raise HTTPException(400, "send at least one reading")
    return take(body)
