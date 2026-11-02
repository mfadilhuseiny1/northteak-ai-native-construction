"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { aip, modelName, usd, wib, type AipEvent, type Rec, type Run } from "@/components/aip/aipRun";
import { useTampilBiaya } from "@/components/aip/costToggle";
import { firm, rp, GROUP_COLOR, REVIEWED, STRENGTH, type FirmAgent } from "@/components/aip/firmApi";
import { LINI } from "@/components/aip/SwarmView";
import { demoLive, demoPoll, demoSwarm, useDemoSwarm } from "@/components/aip/demoSwarm";

/* Multi-agent system animation: a review by the firm replayed from its own event log (the real run, not a
   simulation). Each agent lights up in the colour of its line while it works; every interaction travels as a packet —
   a read to the data, a signal to the ledger, a handoff to its lead, an option to an option analyst, a ruling to the
   orchestrator — and is written to the interaction log; the flow underneath fills as the review goes: signals →
   schedule & cost impact → the risk register → the decision board. Play, pause, speed and seek; click an agent, a stage or a
   line of the log. A review still running is followed live. */

const W = 1200, H = 612;
const HUB = { x: 600, y: 372, w: 560, h: 34 };
const CARD = { y: 432, w: 262, h: 166 };
// A machine check working before the plan: its chip sits under the data bar, not as a gate between the data and the agents
const TELAAH = { x: HUB.x, y: HUB.y + HUB.h / 2 + 18 };
const TELAAH_COLOR = "#c084fc";
const CARDS = [
  { key: "indikasi", label: "Signals", x: 30, hint: "auto rules + analyst signals with evidence" },
  { key: "ml", label: "Schedule & cost impact", x: 326, hint: "options priced by code" },
  { key: "box", label: "Risk register", x: 622, hint: "items grouped by exposed cost" },
  { key: "keputusan", label: "Decision board", x: 918, hint: "option ruling → project manager decision" },
] as const;
type CardKey = (typeof CARDS)[number]["key"];
// The decision check lead first: it works before the domain leads
const LEAD_13 = "telaah_keputusan";
const LEAD_ORDER = ["site", "subcontract", "procurement", "planning", "cost", "quality", "contract", "validator"];
const PHASES: [string, string, string][] = [
  ["telaah", "Decision check", "Before agents work, a machine check scores each high-risk item; a weak signal only where two checks see a problem."],
  ["penugasan", "Assign", "The orchestrator reads the disruption and writes the plan and validation contract before any agent works."],
  ["lapangan", "Field reading", "Analysts read their own sources and flag signals with evidence."],
  ["register", "Risk register", "Code ranks what is exposed: items are grouped A–Z by exposed cost."],
  ["investigasi", "Option analysis", "One analyst per recovery option; each tests Schedule, Cost and Constraints, then recommends an option ruling."],
  ["sintesis", "Synthesis", "Each domain lead merges its analysts' work into one synthesis per line, with result references."],
  ["qa", "QA & red team", "Reviewers recheck each synthesis; the red team attacks the best option."],
  ["laporan", "Recovery plan", "The recovery plan goes to the project manager, who decides; the validator checks numbers and the validation contract."],
];
// The newer decision check phase in place of the earlier one
const PHASE_13: [string, string, string] = ["telaah", "Decision check",
  "Before agents work, a machine check scores each high-risk item as likely sound / needs checking / suspect. No signals: agents check the highest-scored items and flag signals with their own evidence."];
// a planning review: the same phases doing a different job
const PLAN_PHASES: [string, string, string][] = [
  PHASES[0],
  ["penugasan", "Assign", "The orchestrator reads the consultant's package, and sets the sections and validation contract before any agent works."],
  ["lapangan", "Document reading", "Analysts read the drawings, specification, programme and revisions, and write each quantity as a sum."],
  ["register", "Quantities", "Code works out every quantity and compares it with the BoQ."],
  ["investigasi", "Section planning", "One planner per section writes its operations and procedures, on the national standard's norms."],
  ["sintesis", "Integration", "Leads merge the sections, place inspections and handling, assign crews, find waste and settle what disagrees."],
  ["qa", "QA & red team", "A reviewer and the red team, on the other model, try to break the plan."],
  ["laporan", "OPC & procedure", "The chart and procedure go to a person to approve; the validator judges them against the contract."],
];
const PLAN_CARDS: Record<string, [string, string]> = {
  indikasi: ["Findings", "what in the package does not agree"],
  ml: ["Quantities", "each worked out by code from a sum"],
  box: ["Findings by kind", "what must be settled first"],
  keputusan: ["Work plan", "sections planned → a person approves"],
};
const PHASE_COLOR = [TELAAH_COLOR, "#9d8cff", "#3987e5", "#c98500", "#d55181", "#199e70", "#8f99a8", "#e5e8eb"];
const SPEEDS = [1, 5, 15, 40, 100];
const KINDS: [string, string][] = [["all", "All"], ["tool", "Read data"], ["tag", "Signal"], ["handoff", "Handoff"], ["validation", "Validation"],
  ["decision", "Decision"], ["machine", "Machine"], ["error", "Error"]];
const JALUR: Record<string, string> = { rejected: "#e5484d", risky: "#fab219", recommended: "#29a383" };
// a review picked up again after an API restart: its mark on the timeline and its line in the log
const RESUME = "#fbbf24";
const STATE_LABEL: Record<string, string> = { antre: "queued", bekerja: "working", selesai: "done", gagal: "failed" };

type XY = { x: number; y: number };
type Pos = XY & { r: number };
type Line = { i: number; at: number; rt: number; kind: string; key: string; who: string; color: string; text: string };  // at: replay ms; rt: real s from the start
type Packet = { a: XY; b: XY; color: string; r: number; t0: number; dur: number };
/** what one frame draws: the replay's clock and place in the log, the state there, the packets in flight */
type Snap = { clock: number; cursor: number; now: number; L: Live; packets: Packet[] };
type Live = {
  st: Record<string, string>; calls: Record<string, number>; tags: Record<string, number>; formed: Set<string>; flash: Record<string, number>;
  phase: string; phases: Record<string, string>; tagN: number; strength: Record<string, number>; modes: Record<string, number>; auto: number;
  ml: Rec | null; box: Rec | null; recs: Record<string, number>; reds: Record<string, number>; scrut: [number, number]; qa: [number, number];
  final: Rec | null; report: boolean; errors: number; lessons: number; log: Line[]; review: Review | null;
};
/** The decision check as its events tell it: each stage's progress, the screen's verdicts, the calibration, how it ended */
type Review = { versi: string; klaim: number; saring: string; periksa: string; tahap: string; prog: Record<string, [number, number]>; kesimpulan: Record<string, number>;
  tag: number; status: "berjalan" | "selesai" | "berhenti"; kappa: number | null; lolos: boolean | null; alasan: string };
const fresh = (): Live => ({
  st: {}, calls: {}, tags: {}, formed: new Set(), flash: {}, phase: "", phases: {}, tagN: 0, strength: { lemah: 0, sedang: 0, kuat: 0 }, modes: {}, auto: 0,
  ml: null, box: null, recs: {}, reds: {}, scrut: [0, 0], qa: [0, 0], final: null, report: false, errors: 0, lessons: 0, log: [], review: null,
});
const freshReview = (): Review => ({ versi: "1.1", klaim: 0, saring: "", periksa: "", tahap: "", prog: {}, kesimpulan: {}, tag: 0, status: "berjalan", kappa: null, lolos: null, alasan: "" });

/** Event times on a replay clock: events of one second spread across it; with `skip`, a quiet gap (models thinking)
    counts at most 2.5 s, so the replay keeps moving. */
function timeline(events: AipEvent[], skip: boolean): { at: number[]; real: number[]; total: number } {
  const secs = events.map((e) => Date.parse(String(e.t ?? "")));
  for (let i = 0; i < secs.length; i++) if (!Number.isFinite(secs[i])) secs[i] = i ? secs[i - 1] : 0;
  const real: number[] = new Array(events.length);
  for (let i = 0; i < events.length;) {
    let j = i;
    while (j < events.length && secs[j] === secs[i]) j++;
    for (let k = i; k < j; k++) real[k] = secs[i] + ((k - i + 0.5) / (j - i)) * 1000;
    i = j;
  }
  const at: number[] = new Array(events.length);
  let t = 0;
  for (let k = 0; k < events.length; k++) {
    // a time earlier than the one before (a copied trail, writers out of step) does not take the clock back
    const gap = k ? Math.max(0, real[k] - real[k - 1]) : 0;
    t += skip ? Math.min(gap, 2500) : gap;
    at[k] = t;
  }
  return { at, real, total: (at.at(-1) ?? 0) + 1200 };
}

const short = (a: FirmAgent | undefined, key: string) => (a?.name ?? key).replace("Orchestrator · Orchestrator", "Orchestrator").replace(/^Agent /, "")
  .replace(/^Site analyst · /, "Analyst ").replace(/^Sub-agent /, "Impact · ").replace(/^QA reviewer · /, "QA ").replace(/^Specialist /, "Specialist ");
/** Shortens an item title for the log */
const place = (s: unknown) => String(s ?? "").slice(0, 60);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** What an event changes in the review's state, and the line it writes to the interaction log. */
function apply(L: Live, e: AipEvent, i: number, at: number, rt: number, who: (k: string) => FirmAgent | undefined): void {
  const name = (k: string) => (k === "scrutiny" ? "Scrutiny (code)" : k === "machine_check" ? "Decision check" : short(who(k), k));
  const color = (k: string) => (k === "scrutiny" ? "#b8a9ff" : k === "machine_check" ? TELAAH_COLOR : LINI[who(k)?.lini ?? ""]?.color ?? "#8f99a8");
  const log = (kind: string, k: string, text: string, c?: string) => L.log.push({ i, at, rt, kind, key: k, who: k ? name(k) : "", color: c ?? (k ? color(k) : "#8f99a8"), text });
  switch (e.type) {
    case "telaah": {
      const R = (L.review ??= freshReview());
      const t = String(e.tahap ?? ""), num = (v: unknown) => Number(v ?? 0).toLocaleString("en-GB");
      if (t === "mulai") {
        R.versi = String(e.versi ?? "1.1");
        R.klaim = Number(e.klaim ?? 0);
        R.saring = modelName(String((e.model as Rec)?.saring ?? ""));
        R.periksa = modelName(String((e.model as Rec)?.periksa ?? ""));
        L.st[LEAD_13] = "bekerja";  // the decision check lead in the tree (absent in the earlier version: nothing drawn)
        log("machine", "machine_check", R.versi === "1.3"
          ? `started: ${num(e.klaim)} high-risk items · machine decisions score each item (score per outcome) · no recheck, no signal`
          : `started: ${num(e.klaim)} high-risk items · screen ${R.saring} → recheck ${R.periksa}`);
      } else if (t === "kalibrasi") {
        R.kappa = e.kappa ?? null;
        R.lolos = !!e.lolos;
        const ref = R.versi === "1.3" ? ` with stored decisions from ${R.periksa}` : "";
        log("machine", "machine_check", `calibration ${num(e.n)} items: weighted kappa ${e.kappa ?? "-"}${ref} — ${e.lolos ? "passed, full check runs" : `failed: ${((e.alasan ?? []) as string[]).join("; ")}`}`);
      } else if (t === "saring" || t === "periksa") {
        // one line when a stage starts, no running counts (the flow is drawn, not written)
        const sel = Number(e.selesai ?? 0), tot = Number(e.total ?? 0), prev = R.prog[t];
        const what = t === "periksa" ? `rechecking items that are not sound (${R.periksa})`
          : R.versi === "1.3" ? `scoring high-risk items from project data (${R.saring})` : `screening high-risk items from project data (${R.saring})`;
        if (!prev || prev[1] !== tot) log("machine", "machine_check", tot <= 300 ? `calibration: ${what}` : `start ${what}`);
        R.prog[t] = [sel, tot];
        R.tahap = t;
        if (t === "saring") R.kesimpulan = (e.kesimpulan ?? {}) as Record<string, number>;
      } else if (t === "berhenti") {
        R.status = "berhenti";
        R.alasan = String(e.alasan ?? "");
        L.st[LEAD_13] = "gagal";
        log("machine", "machine_check", `stopped: ${R.alasan} — stored decisions kept; assignment continues as before`, "#fbd38d");
      } else if (t === "selesai") {
        R.status = e.status === "selesai" ? "selesai" : "berhenti";
        L.st[LEAD_13] = R.status === "selesai" ? "selesai" : "gagal";
        R.tag = Number(e.tag ?? 0);
        if (e.kesimpulan_saring) R.kesimpulan = e.kesimpulan_saring as Record<string, number>;
      }
      break;
    }
    case "agent_status":
      L.st[e.agent] = e.status;
      if (e.status === "gagal") log("error", e.agent, "turn failed");
      break;
    case "tool":
      L.calls[e.agent] = (L.calls[e.agent] ?? 0) + 1;
      log(e.ok === false ? "error" : "tool", e.agent, `${e.tool} → ${String(e.summary ?? "").slice(0, 140)}${e.rid ? ` [${e.rid}]` : ""}`);
      break;
    case "progress":
      log("tool", e.agent, String(e.text ?? "").replace(/^\[\s*\d+s\]\s*/, "").slice(0, 140));
      break;
    case "tag": {
      const n = Number(e.jumlah ?? 1), k = String(e.kekuatan ?? e.kekuatan_agen ?? "lemah");
      L.tags[e.agent] = (L.tags[e.agent] ?? 0) + n;
      L.tagN += n;
      L.strength[k] = (L.strength[k] ?? 0) + n;
      L.modes[e.tag] = (L.modes[e.tag] ?? 0) + n;
      log("tag", e.agent, `flags ${place(e.judul)} · ${e.tag} (${k})`);
      break;
    }
    case "handoff": {
      const h = (e.handoff ?? {}) as Rec, lead = who(e.agent)?.induk;
      const q = (h.queries_run ?? []).length, issues = (h.issues_found ?? []).length;
      log("handoff", e.agent, `handoff${lead ? ` to ${name(lead)}` : ""}: ${q} queries${issues ? `, ${issues} findings` : ""}${(h.left_undone ?? []).length ? ", some work left undone" : ""}`);
      break;
    }
    case "assign": {
      const lead = who(e.agent)?.induk ?? "";
      log("handoff", lead, `→ ${name(e.agent)}: review ${place(e.target?.nama)} (group ${e.target?.kelompok ?? "-"})`);
      break;
    }
    case "instances":
      for (const a of (e.agents ?? []) as FirmAgent[]) L.formed.add(a.key);
      log("handoff", e.parent ?? "", `${e.role === "red_team" ? "red team" : e.role === "section_planner" ? "section planner" : "option analyst"} role forms ${(e.agents ?? []).length} instances from the ${e.antrean ?? "-"} queue`);
      break;
    case "rekomendasi":
      L.recs[e.jalur] = (L.recs[e.jalur] ?? 0) + 1;
      log("decision", e.agent, e.ringkas ? `${place(e.nama)}: ${e.ringkas}` : `${place(e.nama)} [${e.kelompok}] → ${String(e.jalur).toUpperCase()} · Schedule ${e.impact?.schedule ?? "-"}, Cost ${e.impact?.cost ?? "-"}, Constraints ${e.impact?.constraints ?? "-"}`);
      break;
    case "red_team":
      L.reds[e.hasil] = (L.reds[e.hasil] ?? 0) + 1;
      log("validation", e.agent, `tests ${e.tag} at ${place(e.judul)}: ${e.hasil} → ${e.kekuatan}`);
      break;
    case "verdict":
      if (e.validator === "scrutiny") {
        L.scrut = [L.scrut[0] + Number(e.passed ?? 0), L.scrut[1] + Number(e.total ?? 0)];
        log("validation", "scrutiny", `milestone ${e.milestone}: ${e.passed}/${e.total} checks passed`);
      } else if (e.lini) {
        L.qa = [L.qa[0] + Number(e.passed ?? 0), L.qa[1] + Number(e.total ?? 0)];
        log("validation", e.validator, `synthesis ${e.sintesis ?? e.lini}: ${e.passed}/${e.total} points held`);
      } else {
        L.final = e;
        const k = (e.kontrak ?? []) as Rec[];
        const rated = k.filter((c) => typeof c.ok === "boolean").length;  // unjudged (null) is not failed
        log("validation", e.validator ?? "validator", `final report: ${e.passed}/${e.total} checks; validation contract ` +
          (rated ? `${k.filter((c) => c.ok === true).length}/${rated} met` : "not yet rated"));
      }
      break;
    case "machine":
      if (e.status === "selesai") {
        if (e.key === "auto_checks") {
          L.auto = Object.values((e.hasil?.aturan ?? {}) as Record<string, number>).reduce((n, v) => n + Number(v || 0), 0);
          log("machine", "", e.hasil?.catatan ? String(e.hasil.catatan) : `auto checks: ${L.auto.toLocaleString("en-GB")} signals from ${Object.keys(e.hasil?.aturan ?? {}).length} record rules`, "#738091");
        } else if (e.key === "impact_engine") {
          L.ml = e.hasil ?? {};
          log("machine", "", L.ml?.catatan ? String(L.ml.catatan) : `schedule and cost code: ${L.ml?.teknik ?? "-"} options priced across ${L.ml?.items ?? "-"} activities`, LINI.planning.color);
        } else if (e.key === "register") {
          L.box = e.hasil ?? {};
          const g = (L.box?.kelompok ?? {}) as Record<string, Rec>;
          log("machine", "", L.box?.catatan ? String(L.box.catatan) : `risk register: ${L.box?.items ?? "-"} items · ${Object.entries(g).map(([k, v]) => `${k} ${v.items}`).join(" · ")}`, LINI.contract.color);
        } else if (e.key === "machine_check") {
          // the machine check of every screened item, before the plan
          const h = (e.hasil ?? {}) as Rec;
          log("machine", "", h.status === "selesai"
            ? `decision check: ${Number(h.ditelaah ?? 0).toLocaleString("en-GB")} items checked, ${Number(h.tag ?? 0).toLocaleString("en-GB")} flagged (weak)`
            : `decision check ${String(h.status ?? "berhenti")}: ${((h.alasan ?? []) as string[]).join("; ") || "-"} — continues as before`, "#9d8cff");
        }
      }
      break;
    case "phase": {
      // a phase announced again after a resume is the same phase going on, not a new one
      const again = e.status === "mulai" && L.phases[e.phase] === "mulai";
      L.phases[e.phase] = e.status;
      if (e.status === "mulai") {
        L.phase = e.phase;
        log("phase", "", `Phase ${e.label ?? PHASES.find((p) => p[0] === e.phase)?.[1] ?? e.phase} ${again ? "resumed" : "started"}`, "#e5e8eb");
      }
      break;
    }
    case "lanjut":
      // the API restarted mid-review: the review picked up from its own trail
      log("machine", "", `review resumed after an API restart: ${Number(e.agen_selesai ?? 0)} finished agents not repeated, ${Number(e.agen_dilanjutkan ?? 0)} resume from their step`, RESUME);
      break;
    case "kontrak":
      log("validation", "partner", `validation contract: ${(e.kontrak ?? []).length} statements, written before any agent works`);
      break;
    case "engagement_plan":
      log("phase", "partner", `plan: ${String(e.plan?.ringkasan ?? "").slice(0, 180)}`);
      break;
    case "error":
      L.errors++;
      log("error", e.agent ?? "", String(e.message ?? "").slice(0, 160), "#e5484d");
      break;
    case "pelajaran":
      L.lessons++;
      log("validation", "", `new lesson for skill ${e.skill} (${e.status})`, "#9d8cff");
      break;
    case "salinan":  // a report rewrite: what follows up to the report phase is the source review's trail, copied
      log("phase", "", `phases 0–5 copied from review ${e.sumber} (not rerun); only the report is rewritten`, "#e5e8eb");
      break;
    case "kerangka": {
      const parts = (e.bagian ?? []) as { poin?: unknown[] }[];
      const dropped = ((e.dibuang ?? []) as unknown[]).length;
      log("handoff", "partner", `report outline: ${parts.length} sections, ${parts.reduce((n, s) => n + (s.poin ?? []).length, 0)} sourced points` +
        (dropped ? `, ${dropped} points dropped by code` : ""));
      break;
    }
    case "bagian":
      if (e.status === "menulis") log("tool", "partner", `writing section "${e.judul}" from its sourced points${e.revisi ? " (revision)" : ""}`);
      else log(e.status === "gagal" ? "error" : "handoff", "partner", `section "${e.judul}" ${e.status === "gagal" ? "failed to write" : "done"}${e.revisi ? " (revision)" : ""}`);
      break;
    case "engagement":
      L.report = true;
      log("decision", "partner", e.statistik?.steps != null ? "the work plan is handed over; it waits for a person to approve" : "final report handed over; option ruling awaits the project manager");
      break;
    case "done":
      log("phase", "", "Review complete", "#e5e8eb");
      break;
  }
}

/** Where an event's interaction travels: from the agent (or stage) to the data, the ledger, its lead, a stage. */
function packetsOf(e: AipEvent, pos: Record<string, Pos>, who: (k: string) => FirmAgent | undefined): Omit<Packet, "t0">[] {
  const at = (k: string | null | undefined): XY | null => (k && pos[k] ? pos[k] : null);
  const hub = (x: number): XY => ({ x: Math.max(HUB.x - HUB.w / 2 + 12, Math.min(HUB.x + HUB.w / 2 - 12, x)), y: HUB.y - HUB.h / 2 });
  const card = (k: CardKey, dx = 0): XY => { const c = CARDS.find((x) => x.key === k)!; return { x: c.x + CARD.w / 2 + dx, y: CARD.y }; };
  const col = (k: string) => LINI[who(k)?.lini ?? ""]?.color ?? "#8f99a8";
  const out: Omit<Packet, "t0">[] = [];
  const go = (a: XY | null, b: XY | null, color: string, r = 2.4, dur = 800) => { if (a && b) out.push({ a, b, color, r, dur }); };
  const burst = (a: XY | null, b: (i: number) => XY, color: string, n: number, dur = 1300) => { for (let i = 0; i < n; i++) go(a, b(i), color, 3, dur + i * 90); };
  switch (e.type) {
    case "tool": { const p = at(e.agent); if (p) go(p, hub(p.x), col(e.agent), 2, 650); break; }
    case "telaah": {
      // sparks along the data bar while items are read; the calibration up to the orchestrator; the signals to Signals
      const top: XY = { x: HUB.x, y: HUB.y - HUB.h / 2 }, chip: XY = { x: TELAAH.x, y: TELAAH.y };
      const along = () => ({ x: HUB.x - HUB.w / 2 + 30 + Math.random() * (HUB.w - 60), y: HUB.y });
      if (e.tahap === "saring" || e.tahap === "periksa")
        for (let i = 0; i < 3; i++) go(along(), along(), e.tahap === "saring" ? TELAAH_COLOR : "#9d8cff", 2.2, 900 + i * 150);
      if (e.tahap === "kalibrasi") go(top, at("partner"), TELAAH_COLOR, 3.2, 1200);
      if (e.tahap === "selesai") { burst(chip, (i) => card("indikasi", (i - 3) * 22), TELAAH_COLOR, 7); go(top, at("partner"), TELAAH_COLOR, 3.2, 1300); }
      break;
    }
    case "tag": go(at(e.agent), card("indikasi", (Math.random() - 0.5) * 120), STRENGTH[String(e.kekuatan ?? e.kekuatan_agen)] ?? "#8f99a8", 3, 1200); break;
    case "handoff": go(at(e.agent), at(who(e.agent)?.induk ?? "partner"), "#e5e8eb", 2.6, 900); break;
    case "assign": go(at(who(e.agent)?.induk), at(e.agent), LINI.contract.color, 2.8, 900); break;
    case "instances": for (const a of (e.agents ?? []) as FirmAgent[]) go(at(e.role), at(a.key), col(a.key), 2.6, 1000); break;
    case "rekomendasi": go(at(e.agent), card("keputusan", (Math.random() - 0.5) * 100), JALUR[e.jalur] ?? "#e5e8eb", 3.6, 1400); break;
    case "red_team": go(at(e.agent), card("indikasi", 60), e.hasil === "bertahan" ? "#ffb4b4" : "#7ee2c0", 3.2, 1300); break;
    case "verdict":
      if (e.validator === "scrutiny") go(at("scrutiny"), at("partner"), "#b8a9ff", 3, 900);
      else if (e.lini) go(at(e.validator), at(e.lini), e.passed === e.total ? "#29a383" : "#fab219", 3, 1000);
      else go(at("validator"), at("partner"), e.passed === e.total ? "#29a383" : "#fab219", 3.4, 1100);
      break;
    case "machine":
      if (e.status !== "selesai") break;
      if (e.key === "auto_checks") burst({ x: HUB.x - 200, y: HUB.y + HUB.h / 2 }, (i) => card("indikasi", (i - 3) * 22), "#738091", 7);
      if (e.key === "impact_engine") burst(at("machine_learning"), (i) => card("ml", (i - 3) * 22), LINI.planning.color, 7);
      if (e.key === "register") {
        burst(card("indikasi", 100), (i) => card("box", (i - 3) * 22), LINI.contract.color, 6);
        burst(card("ml", 100), (i) => card("box", (i - 3) * 22), LINI.planning.color, 6);
      }
      break;
    case "kontrak": case "engagement_plan":
      for (const k of LEAD_ORDER) go(at("partner"), at(k), LINI.pimpinan.color, 3, 1000);
      break;
    // the outline is built from the leads' syntheses; a finished section goes to the report
    case "kerangka": for (const k of LEAD_ORDER) if (k !== "validator") go(at(k), at("partner"), LINI.pimpinan.color, 2.6, 900); break;
    case "bagian": if (e.status === "selesai") go(at("partner"), card("keputusan", (Math.random() - 0.5) * 90), LINI.pimpinan.color, 2.6, 1100); break;
    case "engagement": burst(at("partner"), (i) => card("keputusan", (i - 2) * 25), LINI.pimpinan.color, 5, 1500); break;
  }
  return out;
}

/** The firm drawn as a stage: the orchestrator on top, a column per lead, its analysts beneath; roles' instances
    take their places as they are formed. */
function layoutOf(roster: FirmAgent[]): Record<string, Pos> {
  const pos: Record<string, Pos> = {};
  const partner = roster.find((a) => a.jenjang === "partner");
  if (partner) pos[partner.key] = { x: W / 2, y: 52, r: 21 };
  pos.scrutiny = { x: W / 2 + 150, y: 52, r: 10 };
  pos.machine_check = { x: TELAAH.x, y: TELAAH.y, r: 6 };  // (its signals flow from the data bar to Signals)
  const rank = (k: string) => (LEAD_ORDER.includes(k) ? LEAD_ORDER.indexOf(k) : 99);
  const leads = roster.filter((a) => a.jenjang === "manajer").sort((a, b) => rank(a.key) - rank(b.key));
  const colW = W / Math.max(leads.length, 1);
  const order = (a: FirmAgent) => (a.instans_dari ? 2 : a.jenjang === "peran" ? 1 : 0);
  leads.forEach((lead, i) => {
    const cx = colW * i + colW / 2;
    pos[lead.key] = { x: cx, y: 140, r: 14 };
    const kids = roster.filter((a) => a.induk === lead.key && a.jenjang !== "manajer").sort((a, b) => order(a) - order(b) || a.key.localeCompare(b.key));
    const COLS = 7, G = 21, cols = Math.min(COLS, kids.length);
    kids.forEach((a, j) => { pos[a.key] = { x: cx + ((j % COLS) - (cols - 1) / 2) * G, y: 196 + Math.floor(j / COLS) * G, r: a.jenjang === "peran" ? 8 : 6.5 }; });
  });
  return pos;
}

/** What an agent does in the network, in one line for an audience: when an agent is hovered it shows
 *  what agent + a short description of its function, so the agent network can be shown to an audience; its own
 *  assignment (a.peran: the area, the pattern, the item) follows it on the card */
function fungsi(a: FirmAgent): string {
  const role = `${a.instans_dari ?? a.peran_kode} ${a.key}`;
  if (a.jenjang === "partner") return "Orchestrator: sets the hypotheses and validation contract, splits focus by line, writes the final report for the project manager.";
  if (a.key === "validator" || (a.jenjang === "manajer" && a.lini === "qa")) return "Validator: leads QA and the red team, checks every synthesis and the final report against the data, with another model family.";
  if (a.key === LEAD_13) return "Decision check: leads the decision checkers — before agents work, a machine check scores each high-risk item; with no signals, agents check the top items with their own evidence.";
  if (a.peran_kode === "pemeriksa_keputusan") return "Decision checker: takes ten items from the shared queue and scores each — likely sound / needs checking / suspect, with a proposed signal and no text.";
  if (a.key === "redaksi") return "Report desk (code): runs the editor and exhibit analyst, rejects edits that change numbers, and freezes exhibits and the project file when the review ends.";
  if (a.jenjang === "manajer") return "Domain lead: owns its project-data area; leads its analysts and synthesizes their findings for the orchestrator.";
  if (a.key === "editor_laporan") return "Report editor: edits the language of each report section; code rejects edits that change numbers, references or signal codes.";
  if (a.key === "analis_exhibit") return "Exhibit analyst: writes the meaning and implications of each full-report exhibit; sentences whose numbers are not in the exhibit facts are dropped by code.";
  if (/penyidik/.test(role)) return "Option analyst: reviews one item from the risk register: audit workpaper, Schedule–Cost–Constraints reading and an option ruling (recommended / risky / rejected).";
  if (/red_team/.test(role)) return "Red team: tests the strongest signal with its sound explanation, then decides whether the signal holds or weakens.";
  if (a.lini === "qa") return "QA reviewer: rechecks one line's synthesis against the data with its own reading.";
  if (a.lini === "site") return "Site analyst: reads site operations sources for one area and flags signals with evidence.";
  if (a.lini === "subcontract") return "Subcontract analyst: reads subcontractor progress sources and flags signals with evidence.";
  if (a.lini === "procurement") return "Procurement analyst: reads orders and deliveries and flags signals with evidence.";
  if (a.lini === "planning") return "Planning analyst: reads the schedule and flags delay signals with evidence.";
  if (a.lini === "cost") return "Cost analyst: reads cost records and flags overrun signals with evidence.";
  if (a.lini === "quality") return "Quality analyst: reads quality and safety records and flags signals with evidence.";
  if (a.lini === "contract") return "Contract analyst: reads contract records and flags signals with evidence.";
  return a.peran;
}
const LEVEL: Record<string, string> = { partner: "orchestrator", manajer: "domain lead", analis: "analyst", validator: "validator", peran: "role (instance per option)" };

/** embedded: the firm chart of the AI Agent Swarm tab — the review the tab selected (no selector of its own), at rest
 *  on its end state as a chart until played (a running one live), sized by its own width: the log beside the network
 *  when the box is wide, under it when narrow. playKey: a new value replays from the start (the tab's "Play AI Swarm system").
 *  onAgent: the agent clicked (the tab opens its report). */
export function AgentAnimation({ full = false, initialRun, embedded = false, playKey = 0, simKey = 0, proyek = null, simulasi = false, onAgent }: { full?: boolean;
  initialRun?: string | null; embedded?: boolean; playKey?: number; onAgent?: (key: string | null) => void;
  /** a new value plays the simulation of the project (the tab's "Simulation") */
  simKey?: number; proyek?: string | null;
  /** the project's simulation view: the simulation from the start, no review loaded first */
  simulasi?: boolean }) {
  const tampilBiaya = useTampilBiaya();
  const [runs, setRuns] = useState<Rec[]>([]);
  const [sel, setSel] = useState<string | null>(initialRun ?? null);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<AipEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(15);
  const [skip, setSkip] = useState(true);
  const [kind, setKind] = useState("all");
  const [focus, setFocus] = useState<{ agent?: string; card?: CardKey } | null>(null);
  // the agent under the pointer and where it is in the stage's (scrolled) content: a card, not the browser's title box
  const [hover, setHover] = useState<{ key: string; x: number; y: number; w: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const el = root.current;
    if (!embedded || !el) return;
    const ro = new ResizeObserver(([e]) => setRoomy(e.contentRect.width >= 1150));
    ro.observe(el);
    return () => ro.disconnect();
  }, [embedded]);
  const stacked = embedded && !roomy;
  const point = (key: string) => (e: React.PointerEvent) => {
    const r = stage.current?.getBoundingClientRect();
    setHover({ key, x: e.clientX - (r?.left ?? 0) + (stage.current?.scrollLeft ?? 0), y: e.clientY - (r?.top ?? 0) + (stage.current?.scrollTop ?? 0),
      w: stage.current?.clientWidth ?? 0 });
  };
  // the replay runs in refs (60 fps, no render per event); a frame's snapshot goes to the state about 30 times a second
  const [snap, setSnap] = useState<Snap>(() => ({ clock: 0, cursor: 0, now: 0, L: fresh(), packets: [] }));
  const clock = useRef(0), cursor = useRef(0), live = useRef<Live>(fresh()), packets = useRef<Packet[]>([]);
  const paint = useCallback((now: number) => setSnap({ clock: clock.current, cursor: cursor.current, now, L: live.current, packets: packets.current.slice() }), []);
  const logBox = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // a replay file opened from disk (Save replay): played without the API, the review's spend not repeated
  const [file, setFile] = useState<string | null>(null);
  const opener = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firm.engagements().then((l) => { setRuns(l); if (!simulasi) setSel((s) => s ?? (l[0]?.id ?? null)); }).catch((e) => setErr((e as Error).message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on open (a simulation view never picks a review)
  // the review's events: all of a finished one; a running one is followed as its agents work
  useEffect(() => {
    if (!sel || file) return;
    let halt = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new review starts empty
    setLoading(true); setEvents([]); setErr("");
    aip.run(sel, 0).then(async (first) => {
      if (halt) return;
      setRun(first.run); setEvents(first.events); setLoading(false);
      if (first.run.status !== "running") return;
      let after = first.next;
      for (;;) {
        await new Promise((r) => setTimeout(r, demoPoll(2000)));
        if (halt) return;
        const r = await aip.run(sel, after).catch(() => null);
        if (!r) continue;
        after = r.next;
        if (r.events.length) setEvents((es) => [...es, ...r.events]);
        setRun(r.run);
        if (r.run.status !== "running") return;
      }
    }).catch((e) => { if (!halt) { setErr((e as Error).message); setLoading(false); } });
    return () => { halt = true; };
  }, [sel, file]);

  const roster: FirmAgent[] = useMemo(() => {
    const firmEvent = events.find((e) => e.type === "firm");
    const formed = events.filter((e) => e.type === "instances").flatMap((e) => (e.agents ?? []) as FirmAgent[]);
    return [...((firmEvent?.tim ?? []) as FirmAgent[]), ...((firmEvent?.telaah_tim ?? []) as FirmAgent[]), ...formed];
  }, [events]);
  const byKey = useMemo(() => new Map(roster.map((a) => [a.key, a])), [roster]);
  const who = useCallback((k: string) => byKey.get(k), [byKey]);
  const pos = useMemo(() => layoutOf(roster), [roster]);
  const tl = useMemo(() => timeline(events, skip), [events, skip]);
  const phaseSpans = useMemo(() => {
    const s: Record<string, [number, number]> = {};
    events.forEach((e, i) => {
      if (e.type !== "phase") return;
      // after a resume (an API restart) the phase is announced again: it keeps its first start
      if (e.status === "mulai") s[e.phase] = [s[e.phase]?.[0] ?? tl.at[i], tl.total];
      else if (s[e.phase]) s[e.phase][1] = tl.at[i];
    });
    return s;
  }, [events, tl]);
  // a review with a decision check: the check stands on the stage; the newer version also as a tree
  const version = useMemo(() => String(events.find((e) => e.type === "firm")?.versi ?? events.find((e) => e.type === "telaah" && e.tahap === "mulai")?.versi ?? ""), [events]);
  const hasCheck = useMemo(() => events.some((e) => e.type === "telaah") || REVIEWED.includes(version), [events, version]);
  const isCheck13 = version === "1.3";
  const isPlan = useMemo(() => events.some((e) => e.type === "firm" && e.jenis === "plan"), [events]);
  const phases = useMemo(() => (isPlan ? PLAN_PHASES : isCheck13 ? PHASES.map((p) => (p[0] === "telaah" ? PHASE_13 : p)) : PHASES), [isCheck13, isPlan]);
  const marks = useMemo(() => events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === "error" || e.type === "rekomendasi" || e.type === "lanjut" || (e.type === "verdict" && !e.lini && e.validator !== "scrutiny")), [events]);

  /** the state at a moment of the replay, rebuilt from the log (no packets: a jump is not an animation) */
  const seek = useCallback((ms: number) => {
    const L = fresh();
    let i = 0;
    while (i < tl.at.length && tl.at[i] <= ms) { apply(L, events[i], i, tl.at[i], (tl.real[i] - tl.real[0]) / 1000, who); i++; }
    live.current = L; cursor.current = i; clock.current = Math.max(0, Math.min(ms, tl.total)); packets.current = [];
    stick.current = true;
    paint(performance.now());
  }, [tl, events, who, paint]);

  // a new review plays from its start; a running one is joined live at its end
  const loadedFor = useRef<string | null>(null);
  const source = file ? `file:${file}` : sel;
  useEffect(() => {
    if (!events.length || loadedFor.current === source) return;
    loadedFor.current = source;
    const rest = embedded && run?.status !== "running" && !file;  // the chart: a finished review as it ended
    seek((run?.status === "running" && !file) || rest ? tl.total : 0);
    setPlaying(!rest);  // the replay starts once the log has arrived
  }, [events.length, source, file, run?.status, seek, tl.total, embedded]);
  useEffect(() => {
    if (!playKey) return;
    seek(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a command from outside (the tab's "Play AI Swarm system"), not derived state
    setPlaying(true);
  }, [playKey, seek]);

  /** The review as a file (its run and every event): the animation replays from it later, offline, at no model cost. */
  const saveReplay = () => {
    if (!run || !events.length) return;
    const blob = new Blob([JSON.stringify({ jenis: "animation-review", version: 1, saved: new Date().toISOString(), run, events })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `animation-${run.id}${run.status === "running" ? "-partial" : ""}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const openReplay = async (f?: File | null) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.jenis !== "animation-review" || !Array.isArray(j.events) || !j.run?.id) throw new Error("not an animation replay file (Save replay)");
      setErr(""); setFocus(null); setPlaying(false);
      // (saved while it ran: part of the review, replayed as it stood — never "live")
      setFile(f.name); setRun({ ...(j.run as Run), status: j.run.status === "running" ? "saved partial" : j.run.status }); setEvents(j.events as AipEvent[]);
    } catch (e) { setErr(`File could not be opened: ${(e as Error).message}`); }
  };
  /** The simulation as an animation only: played like a replay file, no model called */
  const loadSim = async () => {
    try {
      const j = await firm.simulation(proyek);
      loadedFor.current = null;
      setErr(""); setFocus(null); setPlaying(false);
      setFile("Simulation"); setRun(j.run); setEvents(j.events);
    } catch (e) { setErr(`Simulation could not be loaded: ${(e as Error).message}`); }
  };
  // a new simKey from the tab; the value it was mounted with is not a request (switching reviews remounts this chart)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the simulation view loads its replay once, when it opens
    if (simulasi) loadSim();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on open
  const simSeen = useRef(simKey);
  useEffect(() => {
    if (!simKey || simKey === simSeen.current) return;
    simSeen.current = simKey;
    loadSim();
  }, [simKey]); // eslint-disable-line react-hooks/exhaustive-deps -- loads once per request
  // the clock keeps its place in the log when the timeline is rebuilt (idle skipping toggled, live events added)
  useEffect(() => { clock.current = cursor.current ? tl.at[cursor.current - 1] : 0; }, [tl]);

  // /swarm-x (demoSwarm.ts): while its review runs, the transport drives the demo's clock — its speed, its pause — and
  // the chart follows at that speed; a replay afterwards is the chart's own again
  const demo = useDemoSwarm();
  const bound = !!demo && run?.status === "running" && !file;
  const rate = bound ? demo.speed : speed;
  const on = bound ? !demo.paused : playing;
  useEffect(() => {
    let raf = 0, last = performance.now(), painted = 0;
    const step = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (on && events.length) {
        clock.current = Math.min(tl.total, clock.current + dt * rate);
        const L = live.current;
        let n = 0;
        while (cursor.current < tl.at.length && tl.at[cursor.current] <= clock.current) {
          const i = cursor.current, e = events[i];
          apply(L, e, i, tl.at[i], (tl.real[i] - tl.real[0]) / 1000, who);
          if (n++ < 60) for (const p of packetsOf(e, pos, who)) packets.current.push({ ...p, t0: now });
          if (e.agent && (e.type === "tool" || e.type === "tag" || e.type === "handoff" || e.type === "rekomendasi" || e.type === "bagian")) L.flash[e.agent] = now;
          cursor.current++;
        }
        if (packets.current.length > 260) packets.current.splice(0, packets.current.length - 260);
        if (clock.current >= tl.total && run?.status !== "running") setPlaying(false);
      }
      packets.current = packets.current.filter((p) => now - p.t0 < p.dur);
      if (now - painted > 33 && (on || packets.current.length)) { painted = now; paint(now); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on, rate, tl, events, pos, who, run?.status, paint]);

  // space plays and pauses (not while typing; while a demo review runs, the demo page pauses its clock)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== "Space" || demoLive() || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      e.preventDefault();
      setPlaying((p) => !p);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const { L, now } = snap;
  // phase dividers stay in every filter: they say where in the review a line belongs
  const shown = L.log.filter((l) => l.kind === "phase" || kind === "all" || l.kind === kind).slice(-220);
  useEffect(() => { if (stick.current && logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight; }, [snap, kind]);
  const working = Object.values(L.st).filter((s) => s === "bekerja").length;
  const doneN = Object.values(L.st).filter((s) => s === "selesai" || s === "gagal").length;
  // a role (the option analyst, the red team) is a template, never run itself: its instances are counted, and its node
  // shows how they stand (a review read "104/106 done" with every agent done: the two roles were counted)
  const runners = roster.filter((a) => a.jenjang !== "peran").length;
  const roleState = (key: string): string | undefined => {
    const st = roster.filter((a) => a.instans_dari === key && L.formed.has(a.key)).map((a) => L.st[a.key]);
    if (!st.length) return undefined;
    return st.some((s) => s === "bekerja") ? "bekerja" : st.every((s) => s === "selesai" || s === "gagal") ? "selesai" : st.some((s) => s === "antre") ? "antre" : undefined;
  };
  const phaseIdx = Math.max(0, phases.findIndex((p) => p[0] === (L.phase || (hasCheck ? "telaah" : "penugasan"))));
  const realNow = snap.cursor && tl.real[snap.cursor - 1] != null ? (tl.real[snap.cursor - 1] - tl.real[0]) / 1000 : 0;
  const realTotal = events.length ? (tl.real[events.length - 1] - tl.real[0]) / 1000 : 0;
  const pct = tl.total ? Math.min(1, snap.clock / tl.total) : 0;
  const leads = roster.filter((a) => a.jenjang === "manajer");
  const partner = roster.find((a) => a.jenjang === "partner");
  const techs = roster.filter((a) => a.lini === "planning" && a.jenjang === "analis");
  const techsDone = techs.filter((a) => L.st[a.key] === "selesai").length;
  const recTotal = Object.values(L.recs).reduce((n, v) => n + v, 0);
  const strengthTotal = Math.max(1, L.strength.lemah + L.strength.sedang + L.strength.kuat);
  const topModes = Object.entries(L.modes).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const groups = Object.entries((L.box?.kelompok ?? {}) as Record<string, Rec>);
  const groupMax = Math.max(1, ...groups.map(([, g]) => Number(g.items) || 0));
  const hubHot = snap.packets.filter((p) => p.b.y === HUB.y - HUB.h / 2 && now - p.t0 > p.dur * 0.8).length;
  // a lead whose analysts are at work is lit too: it is the team that works
  const busyLeads = new Set(roster.filter((a) => a.induk && L.st[a.key] === "bekerja").map((a) => a.induk));

  const curve = (p: Packet): XY & { o: number } => {
    const t = Math.min(1, (now - p.t0) / p.dur), u = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const mx = (p.a.x + p.b.x) / 2, my = (p.a.y + p.b.y) / 2, dx = p.b.x - p.a.x, dy = p.b.y - p.a.y;
    const cx = mx - dy * 0.18, cy = my + dx * 0.18;
    return { x: (1 - u) ** 2 * p.a.x + 2 * (1 - u) * u * cx + u * u * p.b.x, y: (1 - u) ** 2 * p.a.y + 2 * (1 - u) * u * cy + u * u * p.b.y, o: t < 0.85 ? 1 : (1 - t) / 0.15 };
  };

  const selAgent = focus?.agent ? byKey.get(focus.agent) : undefined;

  return (
    <div ref={root} className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-[#12161b] text-[12px] text-[#e5e8eb] ${full ? "h-screen" : ""} `}>
      {/* the run and the transport */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-[#1c2127] px-3 py-2">
        <p className="mr-1 flex items-center gap-1.5 text-[13px] font-semibold text-white"><Icon name="play" className="h-3.5 w-3.5 text-[#9d8cff]" />{embedded ? "Firm chart" : "Multi-agent system animation"}</p>
        {!embedded && <select value={file ? "" : sel ?? ""} onChange={(e) => { loadedFor.current = null; setFile(null); setSel(e.target.value); setFocus(null); }}
          className="rounded-sm border border-white/15 bg-[#111418] px-1.5 py-0.5 text-[11px] text-[#d3d8de] outline-none" title="AI Agent Swarm review to replay">
          {file && <option value="">file · {file}</option>}
          {/* a run opened by its link that the list does not hold (the list shows the signed-in user's own runs) */}
          {!file && sel && run?.id === sel && !runs.some((r) => r.id === sel) && (
            <option value={sel}>{wib(run.created_at)} · {run.status === "running" ? "running" : `${run.status}${tampilBiaya ? ` · ${usd(run.spent_usd)}` : ""}`}</option>
          )}
          {runs.map((r) => <option key={r.id} value={r.id}>{wib(String(r.created_at ?? ""))} · {r.status === "running" ? "running" : `${r.status}${tampilBiaya ? ` · ${usd(r.spent_usd)}` : ""}`}</option>)}
        </select>}
        <button onClick={saveReplay} disabled={!events.length} title="download this review (run + all events) as a file: replay it any time, offline, at no model cost"
          className="flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-[11px] text-[#d3d8de] hover:bg-white/10 disabled:opacity-40"><Icon name="download" className="h-3 w-3" />Save replay</button>
        <button onClick={() => opener.current?.click()} title="play a saved replay file"
          className="flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-[11px] text-[#d3d8de] hover:bg-white/10"><Icon name="upload" className="h-3 w-3" />Open replay</button>
        <input ref={opener} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { openReplay(e.target.files?.[0]); e.target.value = ""; }} />
        {run?.simulasi && <span className="rounded-full bg-[#c084fc]/20 px-2 py-0.5 text-[10px] font-semibold text-[#e9d5ff]"
          title="animation only: the check phase is a projection from the last calibration; later phases are the source review's real trail; no model is called">SIMULATION · no model calls</span>}
        <div className="flex items-center gap-0.5">
          <button onClick={() => { seek(0); setPlaying(true); }} title="restart from the beginning" className="rounded p-1 hover:bg-white/10"><Icon name="restore" className="h-3.5 w-3.5" /></button>
          <button onClick={() => { if (bound) { demoSwarm.togglePause(); return; } if (clock.current >= tl.total) seek(0); setPlaying((p) => !p); }} title="play / pause (space)"
            className="flex items-center gap-1 rounded-sm bg-[#5b5fd6] px-2.5 py-0.5 font-medium text-white hover:bg-[#6a6ee0]">
            <Icon name={on ? "pause" : "play"} className="h-3 w-3" />{on ? "Pause" : "Play"}
          </button>
        </div>
        <div className="flex overflow-hidden rounded border border-white/15 text-[10.5px]" title="replay speed">
          {SPEEDS.map((s) => <button key={s} onClick={() => (bound ? demoSwarm.setSpeed(s) : setSpeed(s))} className={`px-1.5 py-0.5 tabular-nums ${rate === s ? "bg-white/15 text-white" : "text-[#abb3bf] hover:bg-white/10"}`}>{s}×</button>)}
        </div>
        <label className="flex items-center gap-1 text-[10.5px] text-[#abb3bf]" title="long pauses while models think are compressed to at most 2.5 seconds">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />skip pauses
        </label>
        {run?.status === "running" && <span className="rounded-full bg-[#e5484d]/20 px-2 py-0.5 text-[10px] font-semibold text-[#ffb4b4]">● LIVE</span>}
        <span className="ml-auto tabular-nums text-[11px] text-[#8f99a8]">real time {mmss(realNow)} / {mmss(realTotal)} · {snap.cursor.toLocaleString("en-GB")}/{events.length.toLocaleString("en-GB")} events{tampilBiaya ? ` · cost ${usd(run?.spent_usd)}` : ""}</span>
        {!full && !demo && <a href={`/aip/animation?embed=1${sel ? `&run=${sel}` : ""}`} target="_blank" rel="noreferrer" title="full screen for presentation" className="rounded p-1 text-[#abb3bf] hover:bg-white/10"><Icon name="external" className="h-3.5 w-3.5" /></a>}
      </div>
      {/* the timeline: the phases, the moments that matter, the playhead */}
      <div className="border-b border-white/5 bg-[#161a1f] px-3 pb-2 pt-1.5">
        <div className="relative h-7 cursor-pointer select-none" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * tl.total); }}>
          {phases.map(([k, label], i) => {
            const s = phaseSpans[k];
            if (!s || !tl.total) return null;
            return (
              <div key={k} className="absolute top-0 flex h-4 items-center overflow-hidden rounded-sm px-1 text-[9.5px] font-medium text-black/80"
                style={{ left: `${(s[0] / tl.total) * 100}%`, width: `${Math.max(0.4, ((s[1] - s[0]) / tl.total) * 100)}%`, background: PHASE_COLOR[i], opacity: L.phase === k ? 1 : 0.55 }} title={label}>
                <span className="truncate">{label}</span>
              </div>
            );
          })}
          {marks.map(({ e, i }) => (
            <div key={i} className={`absolute ${e.type === "lanjut" ? "top-0 h-7 w-0.5" : "top-[18px] h-2 w-px"}`}
              title={e.type === "error" ? `error: ${e.message}` : e.type === "rekomendasi" ? `option ruling ${e.jalur}` : e.type === "lanjut" ? `resumed after an API restart (${Number(e.agen_selesai ?? 0)} finished agents not repeated)` : "validator ruling"}
              style={{ left: `${(tl.at[i] / tl.total) * 100}%`, background: e.type === "error" ? "#e5484d" : e.type === "rekomendasi" ? JALUR[e.jalur] ?? "#d55181" : e.type === "lanjut" ? RESUME : "#29a383" }} />
          ))}
          <div className="absolute -top-0.5 h-7 w-0.5 rounded bg-white shadow-[0_0_6px_white]" style={{ left: `${pct * 100}%` }} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="rounded px-1.5 py-px text-[10.5px] font-semibold text-black" style={{ background: PHASE_COLOR[phaseIdx] }}>{phases[phaseIdx]?.[1]}</span>
          <p className="min-w-0 flex-1 truncate text-[11px] text-[#c5cbd3]">{phases[phaseIdx]?.[2]}</p>
          <span className="shrink-0 text-[10.5px] tabular-nums text-[#8f99a8]" title="fixed agents and dynamic instances formed so far; roles (option analyst, red team) are not counted, their instances are"><b className="text-[#b8a9ff]">{working}</b> working · {doneN}/{runners} done · {L.tagN.toLocaleString("en-GB")} signals · {recTotal} {isPlan ? "sections planned" : "option rulings"}{L.errors ? ` · ${L.errors} errors` : ""}</span>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 ${stacked ? "flex-col" : embedded ? "" : "max-xl:flex-col"}`}>
        <div ref={stage} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto p-2" onPointerLeave={() => setHover(null)}>
          {loading && <p className="p-6 text-center text-[#8f99a8]">Loading review log…</p>}
          {err && <p className="p-3 text-red-300">{err}</p>}
          {!loading && !roster.length && !err && <p className="p-6 text-center text-[#8f99a8]">No AI Agent Swarm review to replay yet.</p>}
          {roster.length > 0 && (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Animation of agents at work: orchestrator, domain leads and their analysts, flow from signals to decision">
              <defs>
                <filter id="ag-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" /></filter>
                <filter id="ag-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" /></filter>
                <linearGradient id="ag-hub" x1="0" x2="1"><stop offset="0" stopColor="#1e2a36" /><stop offset="0.5" stopColor="#24384a" /><stop offset="1" stopColor="#1e2a36" /></linearGradient>
                {/* the machine check: a light sweeping the data bar, clipped to it */}
                <linearGradient id="ag-scan" x1="0" x2="1"><stop offset="0" stopColor={TELAAH_COLOR} stopOpacity="0" /><stop offset="0.5" stopColor={TELAAH_COLOR} stopOpacity="0.55" /><stop offset="1" stopColor={TELAAH_COLOR} stopOpacity="0" /></linearGradient>
                <clipPath id="ag-hubclip"><rect x={HUB.x - HUB.w / 2} y={HUB.y - HUB.h / 2} width={HUB.w} height={HUB.h} rx={17} /></clipPath>
              </defs>
              {/* links: the orchestrator to its leads, each lead to its analysts */}
              {leads.map((l) => {
                const a = pos[partner?.key ?? "partner"], b = pos[l.key];
                if (!a || !b) return null;
                const hot = L.st[l.key] === "bekerja";
                return <path key={`pl-${l.key}`} d={`M${a.x},${a.y + a.r} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y - b.r}`} fill="none"
                  stroke={LINI[l.lini]?.color ?? "#555"} strokeOpacity={hot ? 0.8 : 0.28} strokeWidth={hot ? 2 : 1.2} />;
              })}
              {roster.filter((a) => a.induk && a.jenjang !== "manajer" && pos[a.key] && pos[a.induk] && (!a.instans_dari || L.formed.has(a.key))).map((a) => {
                const p = pos[a.key], q = pos[a.induk!], hot = L.st[a.key] === "bekerja";
                return <line key={`e-${a.key}`} x1={q.x} y1={q.y + q.r} x2={p.x} y2={p.y - p.r} stroke={LINI[a.lini]?.color ?? "#555"} strokeOpacity={hot ? 0.55 : 0.08} strokeWidth={hot ? 1.2 : 0.8} />;
              })}
              {/* the shared data every agent reads */}
              <g>
                <rect x={HUB.x - HUB.w / 2} y={HUB.y - HUB.h / 2} width={HUB.w} height={HUB.h} rx={17} fill="url(#ag-hub)" stroke="#3987e5" strokeOpacity={0.35 + Math.min(0.6, hubHot * 0.06)} strokeWidth={1.5} />
                <text x={HUB.x} y={HUB.y + 4} textAnchor="middle" className="fill-[#c5d8ef] text-[12px] font-semibold">{isPlan ? "Consultant's package · drawings, specification, BoQ, programme · live records" : "Project data · schedule, logs, photos, orders, contract · shared state"}</text>
              </g>
              {/* only with a decision check: the check runs on the project data (no node, it must not read as a gate) */}
              {hasCheck && (() => {
                const R = L.review, on = !!R && R.status === "berjalan" && L.phase === "telaah";
                const done = R?.status === "selesai", stopped = R?.status === "berhenti";
                const what = isCheck13 ? "Decision check" : "Machine check";
                const label = done ? `${what} ✓` : stopped ? `${what} stopped · continues as before` : what;
                const w = label.length * 6.1 + (on ? 34 : 24), c = done ? "#29a383" : stopped ? "#fab219" : TELAAH_COLOR;
                return (
                  <g>
                    {on && (
                      <g clipPath="url(#ag-hubclip)">
                        <rect y={HUB.y - HUB.h / 2} width={150} height={HUB.h} fill="url(#ag-scan)">
                          <animate attributeName="x" from={HUB.x - HUB.w / 2 - 150} to={HUB.x + HUB.w / 2} dur="2.4s" repeatCount="indefinite" />
                        </rect>
                      </g>
                    )}
                    {on && (
                      <rect x={HUB.x - HUB.w / 2} y={HUB.y - HUB.h / 2} width={HUB.w} height={HUB.h} rx={17} fill="none" stroke={TELAAH_COLOR} strokeWidth={1.8}>
                        <animate attributeName="stroke-opacity" values="0.9;0.25;0.9" dur="1.8s" repeatCount="indefinite" />
                      </rect>
                    )}
                    <g transform={`translate(${TELAAH.x},${TELAAH.y})`}>
                      <title>{isCheck13
                        ? "Decision check: a machine scores each high-risk item in the project data (rules + impact engine) as likely sound / needs checking / suspect. No signals: agents check the highest-scored items and flag signals with their own evidence."
                        : "Machine check: reads each high-risk item in the project data (rules + impact engine) with a screening model; items that are not sound and a 5% random sample are rechecked by another model family. Agents still read all data; a weak signal only if both models see a problem."}</title>
                      <rect x={-w / 2} y={-9} width={w} height={18} rx={9} fill={c} fillOpacity={on ? 0.28 : 0.14} stroke={c} strokeOpacity={on ? 0.9 : 0.5} />
                      {on && (
                        <circle cx={-w / 2 + 11} cy={0} r={3} fill={TELAAH_COLOR}>
                          <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <text x={on ? 6 : 0} y={3.5} textAnchor="middle" className="fill-[#f3e8ff] text-[10px] font-medium">{label}</text>
                    </g>
                  </g>
                );
              })()}
              {/* the flow: signals → schedule & cost impact → risk register → decision board */}
              {CARDS.slice(0, -1).map((c, i) => {
                const x1 = c.x + CARD.w, x2 = CARDS[i + 1].x, y = CARD.y + CARD.h / 2, on = [L.tagN + L.auto > 0, !!L.ml, !!L.box][i];
                return (
                  <g key={`ar-${c.key}`}>
                    <line x1={x1 + 3} y1={y} x2={x2 - 6} y2={y} stroke={on ? "#e5e8eb" : "#3a414b"} strokeWidth={2} strokeDasharray="5 4">
                      {on && <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.8s" repeatCount="indefinite" />}
                    </line>
                    <path d={`M${x2 - 8},${y - 5} L${x2 - 2},${y} L${x2 - 8},${y + 5}`} fill="none" stroke={on ? "#e5e8eb" : "#3a414b"} strokeWidth={2} />
                  </g>
                );
              })}
              {CARDS.map((c) => {
                const active = focus?.card === c.key;
                const lit = c.key === "indikasi" ? L.tagN + L.auto > 0 : c.key === "ml" ? !!L.ml || techsDone > 0 : c.key === "box" ? !!L.box : recTotal > 0 || L.report;
                return (
                  <g key={c.key} transform={`translate(${c.x},${CARD.y})`} className="cursor-pointer" onClick={() => setFocus(active ? null : { card: c.key })}>
                    <rect width={CARD.w} height={CARD.h} rx={8} fill="#1c2127" stroke={active ? "#ffffff" : lit ? "#4b5563" : "#2a3038"} strokeWidth={active ? 2 : 1} />
                    <text x={12} y={20} className="fill-white text-[12.5px] font-semibold">{isPlan ? PLAN_CARDS[c.key][0] : c.label}</text>
                    <text x={12} y={34} className="fill-[#8f99a8] text-[9.5px]">{isPlan ? PLAN_CARDS[c.key][1] : c.hint}</text>
                    {c.key === "indikasi" && (
                      <g>
                        <text x={12} y={64}><tspan className="fill-white text-[22px] font-semibold tabular-nums">{L.tagN.toLocaleString("en-GB")}</tspan><tspan dx={6} className="fill-[#abb3bf] text-[10.5px]">agent signals</tspan></text>
                        <text x={12} y={80} className="fill-[#8f99a8] text-[10px]">{isPlan ? `${L.auto} documents and open RFIs read` : `+ ${L.auto.toLocaleString("en-GB")} auto rule signals`}</text>
                        {(["lemah", "sedang", "kuat"] as const).reduce<{ x: number; els: ReactNode[] }>((acc, k) => {
                          const w = ((CARD.w - 24) * (L.strength[k] ?? 0)) / strengthTotal;
                          acc.els.push(<rect key={k} x={12 + acc.x} y={88} width={Math.max(0, w - (w > 2 ? 2 : 0))} height={8} rx={2} fill={STRENGTH[k]} />);
                          acc.x += w;
                          return acc;
                        }, { x: 0, els: [] }).els}
                        <text x={12} y={110} className="fill-[#8f99a8] text-[9.5px]">weak {L.strength.lemah} · medium {L.strength.sedang} · strong {L.strength.kuat}</text>
                        {topModes.slice(0, 2).map(([m, n], i) => <text key={m} x={12} y={126 + i * 12} className="fill-[#c5cbd3] text-[9.5px]">{m.replace(/_/g, " ").toLowerCase()} · {n}</text>)}
                        {!!(L.reds.melemah || L.reds.bertahan) && <text x={12} y={CARD.h - 10} className="fill-[#7ee2c0] text-[9.5px]">red team: {L.reds.melemah ?? 0} weakened · {L.reds.bertahan ?? 0} held</text>}
                      </g>
                    )}
                    {c.key === "ml" && (
                      <g>
                        <text x={12} y={64} className="fill-white text-[22px] font-semibold tabular-nums">{L.ml ? `${L.ml.teknik ?? 0}` : techsDone ? `${techsDone}/${techs.length}` : "—"}</text>
                        <text x={12} y={80} className="fill-[#abb3bf] text-[10.5px]">{L.ml ? (isPlan ? `quantities, compared with ${L.ml.items ?? "-"} BoQ lines` : `options priced, across ${L.ml.items ?? "-"} activities`) : `impact analysts done`}</text>
                        {techs.map((a, i) => {
                          const s = L.st[a.key];
                          return <rect key={a.key} x={12 + i * 26} y={90} width={22} height={8} rx={2} fill={s === "selesai" ? LINI.planning.color : s === "bekerja" ? "#ffd27a" : "#2a3038"}><title>{a.name}: {STATE_LABEL[s ?? ""] ?? "not yet"}</title></rect>;
                        })}
                        {L.ml && <text x={12} y={118} className="fill-[#c5cbd3] text-[9.5px]">{isPlan ? `${Number(L.ml.tag ?? 0)} off the BoQ` : `${Number(L.ml.tag ?? 0)} activities on the critical path`}</text>}
                        <text x={12} y={134} className="fill-[#8f99a8] text-[9.5px]">{isPlan ? "every number comes from code, not a model" : "dates and costs come from code, not a model"}</text>
                      </g>
                    )}
                    {c.key === "box" && (
                      <g>
                        <text x={12} y={64} className="fill-white text-[22px] font-semibold tabular-nums">{L.box ? Number(L.box.items ?? 0).toLocaleString("en-GB") : "—"}</text>
                        <text x={12} y={80} className="fill-[#abb3bf] text-[10.5px]">{L.box ? (isPlan ? `findings · BoQ exposure ${rp(Number(L.box.total_estimasi_kerugian_rp ?? 0))}` : `items · exposed cost estimate ${rp(Number(L.box.total_estimasi_kerugian_rp ?? 0))}`) : isPlan ? "waiting for the quantities" : "waiting for the risk register phase"}</text>
                        {groups.map(([g, v], i) => {
                          const n = Number(v.items) || 0, h = Math.max(2, (46 * Math.log10(1 + n)) / Math.log10(1 + groupMax));
                          return (
                            <g key={g} transform={`translate(${16 + i * 48},0)`}>
                              <rect x={0} y={142 - h} width={30} height={h} rx={2} fill={GROUP_COLOR[g] ?? "#738091"}><title>{`group ${g}: ${n} items — ${v.arti ?? ""}`}</title></rect>
                              <text x={15} y={154} textAnchor="middle" className="fill-[#d3d8de] text-[9.5px] font-semibold">{g} · {n}</text>
                            </g>
                          );
                        })}
                      </g>
                    )}
                    {c.key === "keputusan" && (
                      <g>
                        <text x={12} y={64} className="fill-white text-[22px] font-semibold tabular-nums">{recTotal}</text>
                        <text x={12} y={80} className="fill-[#abb3bf] text-[10.5px]">{isPlan ? "sections planned" : "option rulings from option analysts"}</text>
                        {((isPlan ? ["recommended"] : ["rejected", "risky", "recommended"]) as ("rejected" | "risky" | "recommended")[]).map((j, i) => (
                          <g key={j} transform={`translate(${12 + i * 80},90)`}>
                            <rect width={74} height={18} rx={9} fill={JALUR[j]} fillOpacity={0.18} stroke={JALUR[j]} strokeOpacity={0.6} />
                            <text x={37} y={12.5} textAnchor="middle" className="fill-[#e5e8eb] text-[9.5px]">{isPlan ? "planned" : j} · {L.recs[j] ?? 0}</text>
                          </g>
                        ))}
                        <text x={12} y={126} className="fill-[#c5cbd3] text-[9.5px]">{L.final ? `report validator: ${L.final.passed}/${L.final.total}` : "report validator: waiting"}{L.report ? " · report handed over" : ""}</text>
                        <text x={12} y={142} className="fill-[#8f99a8] text-[9.5px]">{isPlan ? "a person approves it, in the Work plans tab" : "the project manager decides, in the Decisions tab"}</text>
                        
                      </g>
                    )}
                  </g>
                );
              })}
              {/* the scrutiny validator (code) beside the orchestrator */}
              {pos.scrutiny && (
                <g transform={`translate(${pos.scrutiny.x},${pos.scrutiny.y})`} className="cursor-pointer" onClick={() => setFocus({ agent: "scrutiny" })}
                  onPointerEnter={point("scrutiny")} onPointerMove={point("scrutiny")} onPointerLeave={() => setHover(null)}>
                  <rect x={-8} y={-8} width={16} height={16} transform="rotate(45)" fill="#232a33" stroke="#b8a9ff" strokeWidth={2} />
                  <text y={24} textAnchor="middle" className="fill-[#c5cbd3] text-[10px]">Scrutiny · code</text>
                  {L.scrut[1] > 0 && <text y={-14} textAnchor="middle" className="fill-[#b8a9ff] text-[9.5px] tabular-nums">{L.scrut[0]}/{L.scrut[1]}</text>}
                </g>
              )}
              {/* the agents */}
              {roster.filter((a) => pos[a.key] && (!a.instans_dari || L.formed.has(a.key))).map((a) => {
                const p = pos[a.key], s = a.jenjang === "peran" ? roleState(a.key) : L.st[a.key], c = LINI[a.lini]?.color ?? "#8f99a8", f = L.flash[a.key];
                const sel = focus?.agent === a.key, big = a.jenjang !== "analis", team = s !== "bekerja" && busyLeads.has(a.key);
                // idle: tinted with its line; at work: its line's colour, bright and pulsing; done: dimmed with a green ring
                const fill = s === "gagal" ? "#5a2326" : c;
                const fillOp = s === "bekerja" ? 1 : s === "selesai" ? 0.42 : team ? 0.55 : s === "gagal" ? 1 : 0.14;
                const ring = sel ? "#ffffff" : s === "antre" ? "#fab219" : s === "selesai" ? "#29a383" : s === "gagal" ? "#e5484d" : s === "bekerja" || team ? "#ffffff" : c;
                const ringOp = s || team || sel ? 1 : 0.45;
                const age = f ? now - f : 1e9;
                return (
                  <g key={a.key} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onClick={() => { setFocus(sel ? null : { agent: a.key }); onAgent?.(sel ? null : a.key); }}
                    onPointerEnter={point(a.key)} onPointerMove={point(a.key)} onPointerLeave={() => setHover(null)}>
                    {(s === "bekerja" || team) && <circle r={p.r + 5} fill={c} opacity={team ? 0.25 : 0.45} filter="url(#ag-glow)" />}
                    {s === "bekerja" && <circle r={p.r + 3} fill="none" stroke={c} strokeOpacity={0.7}><animate attributeName="r" values={`${p.r + 1};${p.r + 7};${p.r + 1}`} dur="1.4s" repeatCount="indefinite" /><animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="1.4s" repeatCount="indefinite" /></circle>}
                    {age < 450 && <circle r={p.r + 2 + (age / 450) * 9} fill="none" stroke="#ffffff" strokeOpacity={1 - age / 450} strokeWidth={1.2} />}
                    <circle r={p.r} fill={fill} fillOpacity={fillOp} stroke={ring} strokeOpacity={ringOp} strokeWidth={sel ? 2.4 : s === "bekerja" ? 1.4 : 1.6}
                      strokeDasharray={a.jenjang === "peran" || s === "antre" ? "3 2" : undefined} />
                    {a.jenjang === "peran" && <text y={3} textAnchor="middle" className="pointer-events-none fill-white text-[7px] font-semibold">×{String(a.target?.kapasitas ?? roster.filter((x) => x.instans_dari === a.key).length ?? "")}</text>}
                    {!!L.tags[a.key] && a.jenjang === "analis" && <text y={2.5} textAnchor="middle" className="pointer-events-none fill-white text-[6.5px] font-bold">{L.tags[a.key] > 99 ? "99+" : L.tags[a.key]}</text>}
                    {big && a.jenjang !== "peran" && <text y={p.r + 13} textAnchor="middle" className="pointer-events-none fill-[#e5e8eb] text-[11px] font-medium">{short(a, a.key)}</text>}
                    {a.jenjang === "partner" && <text y={p.r + 25} textAnchor="middle" className="pointer-events-none fill-[#8f99a8] text-[9.5px]">plan · validation contract · report</text>}
                  </g>
                );
              })}
              {/* the interactions in flight */}
              {snap.packets.map((p, i) => {
                const q = curve(p);
                return <circle key={i} cx={q.x} cy={q.y} r={p.r} fill={p.color} opacity={q.o} filter={p.r >= 3 ? "url(#ag-soft)" : undefined} />;
              })}
            </svg>
          )}
          {hover && (() => {
            // the hover card: who the agent is, what its kind of agent does, its own assignment, and its state now
            const wide = hover.w;
            const style = { top: hover.y + 14, ...(hover.x > wide - 340 ? { right: wide - hover.x + 14 } : { left: hover.x + 14 }) };
            const box = "pointer-events-none absolute z-30 rounded-lg border border-white/15 bg-[#111418] px-3 py-2 text-[11.5px] shadow-2xl";
            if (hover.key === "scrutiny") return (
              <div className={`${box} w-[300px]`} style={style}>
                <p className="font-semibold text-white">Scrutiny validator</p>
                <p className="mt-0.5 text-[10.5px] text-[#b8a9ff]">code, not a model</p>
                <p className="mt-1.5 leading-snug text-[#d3d8de]">Checks at the end of each phase what that phase left behind: every number sourced, every task has evidence, every scope answered.</p>
                {L.scrut[1] > 0 && <p className="mt-1.5 text-[10.5px] tabular-nums text-[#8f99a8]">{L.scrut[0]}/{L.scrut[1]} checks passed so far</p>}
              </div>
            );
            const a = roster.find((x) => x.key === hover.key);
            if (!a) return null;
            const st = a.jenjang === "peran" ? roleState(a.key) : L.st[a.key];
            const lead = a.induk ? roster.find((x) => x.key === a.induk)?.name : null;
            const what = fungsi(a);
            return (
              <div className={`${box} w-[320px]`} style={style}>
                <p className="font-semibold leading-snug text-white">{a.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[#abb3bf]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LINI[a.lini]?.color ?? "#8f99a8" }} />
                  {LINI[a.lini]?.label ?? a.lini} · {a.key === "redaksi" ? "report desk (code)" : LEVEL[a.jenjang] ?? a.jenjang}{lead ? ` · led by ${lead}` : ""}
                </p>
                <p className="mt-1.5 leading-snug text-[#e5e8eb]">{what}</p>
                {a.peran && a.peran !== what && <p className="mt-1 line-clamp-3 leading-snug text-[#8f99a8]">Assignment: {a.peran}</p>}
                <p className="mt-1.5 flex flex-wrap gap-x-2 border-t border-white/[.06] pt-1.5 text-[10.5px] tabular-nums text-[#abb3bf]">
                  <span>{modelName(a.model)}</span><span>· {STATE_LABEL[st ?? ""] ?? "not working yet"}</span>
                  {!!L.calls[a.key] && <span>· {L.calls[a.key]} tool calls</span>}
                  {!!L.tags[a.key] && <span>· {L.tags[a.key]} signals</span>}
                </p>
              </div>
            );
          })()}
          {roster.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[10.5px] text-[#8f99a8]">
              {Object.entries(LINI).filter(([k]) => roster.some((a) => a.lini === k)).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: v.color }} />{v.label}</span>)}
              <span>· lit colour = agent working (pulsing) · dashed yellow ring = queued · dim + green ring = done · red = failed · white flash = one interaction · moving dot = data read, signal (strength colour), handoff, ruling</span>
            </div>
          )}
        </div>

        {/* the interaction log, or what was clicked */}
        <aside className={`flex min-h-0 shrink-0 flex-col bg-[#1c2127] ${stacked ? "h-[260px] w-full border-t border-black/30" : embedded ? "relative w-[380px] border-l border-black/30" : "w-[380px] border-l border-black/30 max-xl:h-[360px] max-xl:w-full max-xl:border-l-0 max-xl:border-t"}`}>
          <div className={embedded && !stacked ? "absolute inset-0 flex min-h-0 flex-col" : "contents"}>
          {focus && (
            <div className="max-h-[50%] shrink-0 overflow-y-auto border-b border-white/5 p-3">
              <div className="mb-1 flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[13px] font-semibold text-white">{focus.card ? CARDS.find((c) => c.key === focus.card)?.label : focus.agent === "scrutiny" ? "Scrutiny validator (code)" : selAgent?.name ?? focus.agent}</p>
                <button onClick={() => setFocus(null)} className="rounded p-0.5 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button>
              </div>
              {focus.agent && focus.agent !== "scrutiny" && selAgent && (
                <div className="space-y-1 text-[11px] text-[#c5cbd3]">
                  <p>{selAgent.peran}</p>
                  <p className="text-[#8f99a8]">{LINI[selAgent.lini]?.label ?? selAgent.lini} · {modelName(selAgent.model)} · {STATE_LABEL[L.st[selAgent.key] ?? ""] ?? "not working yet"} · {L.calls[selAgent.key] ?? 0} tool calls · {L.tags[selAgent.key] ?? 0} signals</p>
                  {selAgent.instans_dari && <p className="text-[#8f99a8]">instance of the {selAgent.instans_dari === "red_team" ? "red team" : "option analyst"} role: formed when there is an option in the queue, not a fixed agent</p>}
                </div>
              )}
              {focus.agent === "scrutiny" && <p className="text-[11px] text-[#c5cbd3]">Validator with no model: code that checks what each phase left in shared state (handoffs, signal evidence, result references, validation contract). So far {L.scrut[0]}/{L.scrut[1]} checks passed.</p>}
              {focus.card === "indikasi" && (
                <div className="space-y-1 text-[11px] text-[#c5cbd3]">
                  <p>Signals come from two sources: auto checks from the semantic layer ({L.auto.toLocaleString("en-GB")} rule signals) and agents flagging signals with evidence from their own reading ({L.tagN.toLocaleString("en-GB")} signals). Strength is calculated from its source; strong ones are marked confidential.</p>
                  <ul className="space-y-0.5">{Object.entries(L.modes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m, n]) => <li key={m} className="flex"><span className="truncate">{m}</span><span className="ml-auto tabular-nums text-white">{n}</span></li>)}</ul>
                </div>
              )}
              {focus.card === "ml" && (
                <div className="space-y-1 text-[11px] text-[#c5cbd3]">
                  <p>{isPlan ? "An agent writes each quantity as a sum, with figures it read. Code works it out and compares it with the BoQ. Workforce, material and waste then come from the national standard." : "Code works out each option's dates and cost from the dependency network and the rate sheet. Agents read these numbers and argue over what they mean; no model writes a date or a price."}</p>
                  <ul className="space-y-0.5">{techs.map((a) => <li key={a.key} className="flex"><span>{a.name.replace("Sub-agent ", "")}</span><span className="ml-auto" style={{ color: L.st[a.key] === "selesai" ? LINI.planning.color : "#8f99a8" }}>{STATE_LABEL[L.st[a.key] ?? ""] ?? "not yet"}</span></li>)}</ul>
                  {L.ml && <p className="text-white">{isPlan ? `${L.ml.teknik} quantities worked out, ${Number(L.ml.tag ?? 0)} off the BoQ` : `${L.ml.teknik} options priced across ${L.ml.items} activities, ${Number(L.ml.tag ?? 0)} of them critical`}</p>}
                </div>
              )}
              {focus.card === "box" && (
                <div className="space-y-1 text-[11px] text-[#c5cbd3]">
                  {L.box ? groups.map(([g, v]) => (
                    <p key={g}><b style={{ color: GROUP_COLOR[g] ?? "#d3d8de" }}>{g}</b> · {v.items} items · {rp(Number(v.kerugian_rp ?? 0))} <span className="text-[#8f99a8]">— {v.arti}</span></p>
                  )) : <p>The register is calculated in the risk register phase, after all field signals are in.</p>}
                </div>
              )}
              {focus.card === "keputusan" && (
                <div className="space-y-1 text-[11px] text-[#c5cbd3]">
                  <p>{isPlan ? "Each section planner writes its operations and procedures. The chart goes to a person, who approves it in the Work plans tab." : "Option analysts recommend an option ruling per item (rejected only if Schedule, Cost and Constraints are all met); the project manager decides in the Decisions tab."}</p>
                  <ul className="space-y-0.5">{L.log.filter((l) => l.kind === "decision" && l.key !== "partner").slice(-12).map((l) => <li key={l.i} className="truncate" title={l.text}>{l.text}</li>)}</ul>
                </div>
              )}
              {focus.agent && (
                <ul className="mt-2 space-y-0.5 border-t border-white/5 pt-1.5 text-[10.5px]">
                  {L.log.filter((l) => l.key === focus.agent).slice(-25).map((l) => <li key={l.i} className="text-[#c5cbd3]"><span className="tabular-nums text-[#6b7480]">{mmss(l.rt)} </span>{l.text}</li>)}
                  {!L.log.some((l) => l.key === focus.agent) && <li className="text-[#8f99a8]">No interaction up to this point.</li>}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1 border-b border-white/5 px-2 py-1.5">
            <p className="mr-1 self-center text-[11px] font-semibold text-white">Interaction log</p>
            {KINDS.map(([k, label]) => <button key={k} onClick={() => setKind(k)} className={`rounded px-1.5 py-0.5 text-[10px] ${kind === k ? "bg-white/15 text-white" : "text-[#abb3bf] hover:bg-white/10"}`}>{label}</button>)}
          </div>
          <div ref={logBox} onScroll={(e) => { const d = e.currentTarget; stick.current = d.scrollHeight - d.scrollTop - d.clientHeight < 30; }}
            className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 py-1 font-mono text-[10.5px]">
            {shown.map((l) => l.kind === "phase" && !l.key ? (
              <p key={l.i} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[#c5cbd3]">— {l.text} —</p>
            ) : (
              <button key={l.i} onClick={() => { seek(l.at); if (l.key) setFocus({ agent: l.key }); }} title="jump to this moment"
                className={`flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white/[.06] ${focus?.agent && focus.agent === l.key ? "bg-white/[.05]" : ""}`}>
                <span className="shrink-0 tabular-nums text-[#6b7480]" title="real time since the review started">{mmss(l.rt)}</span>
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: l.color }} />
                <span className={`min-w-0 ${l.kind === "error" ? "text-[#ffb4b4]" : l.kind === "decision" ? "text-[#ffd8a8]" : l.kind === "tag" ? "text-[#e5e8eb]" : "text-[#abb3bf]"}`}>
                  {l.who && <b className="font-semibold" style={{ color: l.color }}>{l.who} </b>}{l.text}
                </span>
              </button>
            ))}
            {!shown.length && <p className="p-3 text-center font-sans text-[#8f99a8]">{events.length ? "Press Play: every agent interaction appears here." : "—"}</p>}
          </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
