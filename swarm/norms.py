"""Workforce and material per unit of work, from the Indonesian national standard SNI 7394:2008 (concrete work for buildings and housing).

An OH (orang-hari) is one person working one day. The figures below are the standard's; the waste allowances say where each comes from. Where the standard states no allowance, none is claimed.
"""

from __future__ import annotations

SOURCE = "SNI 7394:2008, Tata cara perhitungan harga satuan pekerjaan beton untuk konstruksi bangunan gedung dan perumahan"
HOURS_PER_OH = 7  # a working day of 08:00 to 16:00 with a one hour break: our assumption, not the standard's
SUPERVISORS = ("Kepala tukang", "Mandor")  # share their time across steps; the crew on a step is the others
CONCRETE_WASTE_PCT = 2.5  # spillage at the mixer, skip and tremie: our assumption
PLYWOOD_NET_PER_M2 = 1 / (1.22 * 2.44)  # a 1.22 x 2.44 m sheet covers 2.98 m2

NONE_STATED = "the standard states no allowance"
ASSUMED = f"our assumption: {CONCRETE_WASTE_PCT}% spillage at the mixer, skip and tremie"
UNIT_WEIGHTS = {"D10": 0.617, "D13": 1.042, "D16": 1.578, "D19": 2.226, "D22": 2.984, "D25": 3.853}  # kg per metre of bar: nominal mass, diameter squared x 0.00617


def _concrete(section: str, grade: str, mpa: float, cement: int, sand: int, gravel: int, heavy: bool = False) -> dict:
    labour = {"Pekerja": 2.1, "Tukang batu": 0.35, "Kepala tukang": 0.035, "Mandor": 0.105} if heavy else {"Pekerja": 1.65, "Tukang batu": 0.275, "Kepala tukang": 0.028, "Mandor": 0.083}
    extra = {"waste_pct": CONCRETE_WASTE_PCT, "basis": ASSUMED, "built_in": False}
    return {"name": f"Concrete {grade}, f'c {mpa} MPa, slump 12 +/- 2 cm", "section": section, "per": 1, "unit": "m3", "labour": labour,
            "materials": {"cement": {"name": "Cement", "unit": "kg", "qty": cement, **extra}, "sand": {"name": "Concrete sand", "unit": "kg", "qty": sand, **extra}, "gravel": {"name": "Gravel, up to 30 mm", "unit": "kg", "qty": gravel, **extra},
                          "water": {"name": "Water", "unit": "L", "qty": 215, "waste_pct": 0, "basis": NONE_STATED, "built_in": False}}}


def _formwork(section: str, element: str, timber_ii: float, props: int) -> dict:
    plywood_pct = round((0.35 / PLYWOOD_NET_PER_M2 - 1) * 100, 1)
    plain = {"waste_pct": 0, "basis": NONE_STATED, "built_in": False}
    return {"name": f"Formwork for {element}, one use", "section": section, "per": 1, "unit": "m2", "labour": {"Pekerja": 0.66, "Tukang kayu": 0.33, "Kepala tukang": 0.033, "Mandor": 0.033},
            "materials": {"plywood": {"name": "Plywood, 9 mm", "unit": "sheet", "qty": 0.35, "waste_pct": plywood_pct, "basis": f"the standard allows 0.35 sheet per m2; geometry needs {PLYWOOD_NET_PER_M2:.3f}", "built_in": True},
                          "timber_iii": {"name": "Timber, class III", "unit": "m3", "qty": 0.04, **plain}, "timber_ii": {"name": "Timber beams, class II", "unit": "m3", "qty": timber_ii, **plain},
                          "nails": {"name": "Nails, 5 to 12 cm", "unit": "kg", "qty": 0.4, **plain}, "form_oil": {"name": "Form oil", "unit": "L", "qty": 0.2, **plain}, "props": {"name": "Props, dolken 8 to 10 cm, 4 m", "unit": "piece", "qty": props, **plain}}}


NORMS = {
    "SNI-6.7": _concrete("6.7", "K-225", 19.3, 371, 698, 1047),
    "SNI-6.8": _concrete("6.8", "K-250", 21.7, 384, 692, 1039),
    "SNI-6.9": _concrete("6.9", "K-275", 24.0, 406, 684, 1026),
    "SNI-6.10": _concrete("6.10", "K-300", 26.4, 413, 681, 1021),
    "SNI-6.11": _concrete("6.11", "K-325", 28.8, 439, 670, 1006, heavy=True),
    "SNI-6.12": _concrete("6.12", "K-350", 31.2, 448, 667, 1000, heavy=True),
    "SNI-6.17": {"name": "Reinforcement, plain or deformed bar", "section": "6.17", "per": 10, "unit": "kg", "labour": {"Pekerja": 0.07, "Tukang besi": 0.07, "Kepala tukang": 0.007, "Mandor": 0.004},
                 "materials": {"rebar": {"name": "Rebar", "unit": "kg", "qty": 10.5, "waste_pct": 5.0, "basis": "the standard allows 10.5 kg for each 10 kg fixed", "built_in": True},
                               "tie_wire": {"name": "Tie wire", "unit": "kg", "qty": 0.15, "waste_pct": 0, "basis": NONE_STATED, "built_in": False}}},
    "SNI-6.22": _formwork("6.22", "columns", 0.015, 2),
    "SNI-6.23": _formwork("6.23", "beams", 0.018, 2),
    "SNI-6.24": _formwork("6.24", "floor slabs", 0.015, 6),
}


def table() -> dict:
    """What an agent reads: the norms and bar weights, with where they come from."""
    return {"source": SOURCE, "hours_per_oh": HOURS_PER_OH, "bar_weight_kg_per_m": UNIT_WEIGHTS,
            "norms": {k: {"name": n["name"], "per": n["per"], "unit": n["unit"], "labour_oh": n["labour"], "materials": {m: {"name": v["name"], "unit": v["unit"], "qty": v["qty"]} for m, v in n["materials"].items()}} for k, n in NORMS.items()}}
