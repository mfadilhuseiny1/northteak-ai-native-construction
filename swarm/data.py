"""The project files as the tools read them. Nothing under data/project/_hidden is loaded here."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import generator


def _read(folder: Path, name: str):
    return json.loads((folder / name).read_text(encoding="utf-8"))


@dataclass
class ProjectData:
    folder: Path
    project: dict
    boq: dict[str, dict]
    claim: dict[str, dict]
    schedule: dict[str, dict]
    logs: list[dict]
    change_orders: list[dict]
    photos: list[dict]

    @classmethod
    def load(cls, folder: Path | None = None) -> "ProjectData":
        folder = folder or generator.ensure()
        return cls(folder=folder, project=_read(folder, "project.json"),
                   boq={x["code"]: x for x in _read(folder, "boq.json")},
                   claim={x["code"]: x for x in _read(folder, "claim.json")},
                   schedule={x["code"]: x for x in _read(folder, "schedule.json")},
                   logs=_read(folder, "daily_logs.json"), change_orders=_read(folder, "change_orders.json"),
                   photos=_read(folder, "photos.json"))

    @property
    def codes(self) -> list[str]:
        return list(self.boq)

    def photo(self, photo_id: str) -> dict | None:
        return next((p for p in self.photos if p["id"] == photo_id), None)

    def photos_of(self, code: str) -> list[dict]:
        return sorted((p for p in self.photos if p["item_code"] == code), key=lambda p: p["date"])

    def log(self, log_id: str) -> dict | None:
        return next((e for e in self.logs if e["id"] == log_id), None)

    def billing_difference(self, code: str) -> int:
        """Claimed amount minus what the BoQ price and the claimed progress give."""
        line, item = self.claim[code], self.boq[code]
        return line["amount"] - round(item["qty"] * item["unit_price"] * line["claimed_pct"] / 100)

    def evidence(self, evidence_id: str) -> dict | None:
        if evidence_id.startswith("P-"):
            return self.photo(evidence_id)
        if evidence_id.startswith("LOG-"):
            return self.log(evidence_id)
        kind, _, code = evidence_id.partition("-")
        source = {"SCH": self.schedule, "CL": self.claim, "BOQ": self.boq}.get(kind)
        return source.get(code) if source else None
