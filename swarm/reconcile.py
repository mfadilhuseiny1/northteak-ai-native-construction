"""Plain code, no model: compares what each source found per claim line and works out the rupiah."""

from __future__ import annotations

TOLERANCE_PCT = 5.0  # a declared assumption: differences up to this many percentage points count as agreeing

SUPPORTED, WEAK, UNBILLED, INSPECT, BILLING = "supported", "weak_evidence", "unbilled", "needs_inspection", "billing_error"
NEEDS_RULING = (WEAK, UNBILLED)  # conclusions the verifier must confirm before they go out


def decide(claimed: float, field: dict | None, log: dict | None) -> tuple[str, str, float | None]:
    """(status, reason, agreed progress %) from the field and document findings. A finding is {"pct": float} or
    {"pct": None, "reason": str} when that source could not establish the progress; None means it reported nothing."""
    field_pct = field.get("pct") if field else None
    log_pct = log.get("pct") if log else None
    if claimed == 0 and not field_pct and not log_pct:
        return SUPPORTED, "Nothing claimed and no source shows work on this item.", 0.0
    if field and field.get("pct") is None:
        return INSPECT, f"Not verifiable from photos: {field.get('reason') or 'work not visible'}.", None
    if field_pct is None or log_pct is None:
        missing = "Site photos" if field_pct is None else "The daily log"
        return INSPECT, f"{missing} gave no usable reading, so only one source remains.", None
    if abs(field_pct - log_pct) > TOLERANCE_PCT:
        return INSPECT, f"Sources disagree: photos show {field_pct:g}%, the daily log shows {log_pct:g}%.", None
    agreed = round((field_pct + log_pct) / 2, 1)
    if claimed - agreed > TOLERANCE_PCT:
        return WEAK, f"Claimed {claimed:g}%, but photos and the daily log agree on about {agreed:g}%.", agreed
    if agreed - claimed > TOLERANCE_PCT:
        return UNBILLED, f"Photos and the daily log agree on about {agreed:g}%, but only {claimed:g}% is claimed.", agreed
    return SUPPORTED, f"Claim of {claimed:g}% matches photos and the daily log (about {agreed:g}%).", agreed


def reconcile(data, findings: dict[str, dict[str, dict]]) -> list[dict]:
    """One result per claim line. findings: {source: {item code: finding}}."""
    out = []
    for code in data.codes:
        item, line = data.boq[code], data.claim[code]
        field, log = findings.get("field", {}).get(code), findings.get("documents", {}).get(code)
        plan = findings.get("schedule", {}).get(code)
        status, reason, agreed = decide(line["claimed_pct"], field, log)
        impact = 0
        if status in NEEDS_RULING:
            impact = round(item["value"] * abs(line["claimed_pct"] - agreed) / 100)
        billing = data.billing_difference(code)
        if status == SUPPORTED and billing:
            status = BILLING
            reason = f"Progress is supported, but the claimed amount is off by Rp {billing:,} against the BoQ price and claimed progress."
        evidence = [e for f in (field, log, plan) if f for e in f.get("evidence_ids", [])]
        out.append({"code": code, "name": item["name"], "area": item["area"], "value": item["value"], "claimed_pct": line["claimed_pct"],
                    "amount_claimed": line["amount"], "field_pct": field.get("pct") if field else None, "log_pct": log.get("pct") if log else None,
                    "planned_pct": plan.get("pct") if plan else None, "agreed_pct": agreed, "status": status, "reason": reason, "impact": impact,
                    "billing_difference": billing, "evidence_ids": evidence, "ruling": None})
    return out


def apply_rulings(lines: list[dict], rulings: dict[str, dict]) -> list[dict]:
    """The verifier can only confirm a conclusion or send it to inspection: it never writes a new number. A conclusion
    it did not rule on does not go out as a conclusion."""
    out = []
    for line in lines:
        line = dict(line)
        if line["status"] in NEEDS_RULING:
            ruling = rulings.get(line["code"])
            line["ruling"] = ruling
            if not ruling or ruling["decision"] != "confirmed":
                why = ruling["reason"] if ruling else "The verifier did not confirm this conclusion."
                line.update(status=INSPECT, impact=0, reason=f"{line['reason']} Verifier: {why}")
        out.append(line)
    return out


def totals(lines: list[dict]) -> dict:
    def worth(status: str) -> int:
        return sum(x["impact"] for x in lines if x["status"] == status)

    def count(status: str) -> int:
        return sum(1 for x in lines if x["status"] == status)

    return {"lines": len(lines), "claimed_amount": sum(x["amount_claimed"] for x in lines),
            "supported": count(SUPPORTED), "weak_evidence": count(WEAK), "unbilled": count(UNBILLED),
            "needs_inspection": count(INSPECT), "billing_error": count(BILLING),
            "weak_evidence_value": worth(WEAK), "unbilled_value": worth(UNBILLED),
            "billing_error_value": sum(x["billing_difference"] for x in lines if x["status"] == BILLING)}
