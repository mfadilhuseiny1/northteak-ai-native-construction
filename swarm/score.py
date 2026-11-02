"""Scores a finished run against the answer key. This is the only module that reads the key, and it runs after the agents."""

from __future__ import annotations

import json
from pathlib import Path


def _off(got, truth) -> bool:
    if truth is None or got is None:
        return (truth is None) != (got is None)
    return abs(got - truth) > 1


def score(report: dict, folder: Path) -> dict:
    key = json.loads((folder / "_hidden" / "answer_key.json").read_text(encoding="utf-8"))
    rows = []
    for line in report["lines"]:
        truth = key["lines"][line["code"]]
        rows.append({"code": line["code"], "expected": truth["expected"], "got": line["status"], "scenario": truth["scenario"],
                     "correct": line["status"] == truth["expected"], "field_pct": line["field_pct"], "true_photo_pct": truth["photo_pct"],
                     "log_pct": line["log_pct"], "true_log_pct": truth["log_pct"]})
    planted = [r for r in rows if r["expected"] != "supported"]
    clean = [r for r in rows if r["expected"] == "supported"]
    found = [set(x["log_ids"]) for x in report["extra_work"]]
    truth_extra = [set(v) for v in key["extra_work"].values()]
    return {"lines_correct": sum(r["correct"] for r in rows), "lines": len(rows),
            "planted_found": sum(r["correct"] for r in planted), "planted": len(planted),
            "false_alarms": sum(not r["correct"] for r in clean), "clean_lines": len(clean),
            "extra_work_found": sum(any(t & f for f in found) for t in truth_extra), "extra_work_planted": len(truth_extra),
            "extra_work_false": sum(not any(t & f for t in truth_extra) for f in found),
            "photo_readings_wrong": [r["code"] for r in rows if _off(r["field_pct"], r["true_photo_pct"])],
            "log_readings_wrong": [r["code"] for r in rows if _off(r["log_pct"], r["true_log_pct"])],
            "misses": [r for r in rows if not r["correct"]]}
