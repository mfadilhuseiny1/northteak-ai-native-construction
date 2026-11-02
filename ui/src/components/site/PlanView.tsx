"use client";
import { useState, type ReactNode } from "react";
import { Markdown } from "@/components/aip/Briefing";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { api, Bar, Card, field, full, good, Kpi, Kpis, Label, Loading, money, Pill, primary, Problem, quiet, Side, Table, td, tr, useData, type Rec, type Tone } from "./kit";

/* The main job: a consultant's planning documents into an Operation Process Chart and procedure, with the workforce, material and waste of every step. Agents decide the steps; every number comes from code, and a person approves before anything changes. */

const ROW = 92, COL = 292, HEAD = 56;
const STATUS: Record<string, Tone> = { pending: "warn", approved: "ok", rejected: "bad", superseded: "none", proposed: "violet", open: "info", done: "ok" };
const num = (n: number, d = 1) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
const KINDS: Record<string, string> = { scope: "Work brief", drawing: "Drawing", spec: "Specification", itp: "Inspection plan", boq: "BoQ", programme: "Programme", method: "Site logistics", rates: "Rates" };
const TAG: Record<string, string> = { DOCUMENT_CONFLICT: "Documents disagree", SUPERSEDED_DRAWING: "Superseded drawing", BOQ_MISMATCH: "BoQ mismatch", CREW_SHORT: "Crew short", TIME_SHORT: "Time short", SCOPE_GAP: "Scope gap", RFI_OPEN: "Open RFI", SEQUENCE_RISK: "Sequence risk", MATERIAL_WASTE: "Material waste", HANDLING_WASTE: "Handling waste", SAFETY: "Safety", COST_EXPOSURE: "Cost exposure", OTHER: "Other" };

/** Where each step sits: by section across, and down so that a feeder ends just above the step it feeds, as an OPC is drawn. */
function placement(plan: Rec): Record<string, { x: number; y: number }> {
  const steps = plan.steps as Rec[];
  const next: Record<string, string[]> = {};
  steps.forEach((s) => (s.after as string[]).forEach((a) => { (next[a] ??= []).push(s.id); }));
  const left: Record<string, number> = {};
  const walk = (id: string, path: Set<string>): number => {
    if (left[id] !== undefined) return left[id];
    if (path.has(id)) return 0;
    path.add(id);
    const d = next[id]?.length ? 1 + Math.max(...next[id].map((n) => walk(n, path))) : 0;
    path.delete(id);
    left[id] = d;
    return d;
  };
  steps.forEach((s) => walk(s.id, new Set()));
  const deepest = Math.max(0, ...Object.values(left));
  const cols = Object.fromEntries((plan.sections as Rec[]).map((s, i) => [s.id, i]));
  const taken = new Set<string>();
  const out: Record<string, { x: number; y: number }> = {};
  [...steps].reverse().forEach((s) => {
    const col = cols[s.section] ?? 0;
    let row = deepest - left[s.id];
    while (taken.has(`${col}:${row}`) && row > 0) row -= 1;
    taken.add(`${col}:${row}`);
    out[s.id] = { x: col * COL + 34, y: HEAD + row * ROW + 26 };
  });
  return out;
}

function Symbol({ s, on }: { s: Rec; on: boolean }) {
  const ring = on ? "outline outline-2 outline-offset-2 outline-white" : s.critical ? "outline outline-1 outline-offset-2 outline-[#fab219]/70" : "";
  if (s.kind === "inspection") return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] text-[10.5px] font-semibold text-white ${s.hold_point ? "bg-[#e5484d]" : "bg-[#199e70]"} ${ring}`}>{s.id}</span>;
  if (s.kind === "handling") return <span className={`flex h-10 w-10 shrink-0 items-center justify-center bg-[#5f6b7c] pr-1 text-[10px] font-semibold text-white ${ring}`} style={{ clipPath: on ? undefined : "polygon(0 18%, 68% 18%, 68% 0, 100% 50%, 68% 100%, 68% 82%, 0 82%)" }}>{s.id}</span>;
  return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#5b5fd6] text-[10.5px] font-semibold text-white ${ring}`}>{s.id}</span>;
}

function OpcChart({ plan, who, flagged, sel, onSelect }: { plan: Rec; who: Record<string, string>; flagged: Set<string>; sel: string | null; onSelect: (id: string) => void }) {
  const steps = plan.steps as Rec[], sections = plan.sections as Rec[];
  const pos = placement(plan);
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  const width = sections.length * COL + 20;
  const height = Math.max(...Object.values(pos).map((p) => p.y), 0) + ROW;
  return (
    <div className="relative" style={{ width, height }}>
      {sections.map((sec, i) => {
        const mine = steps.filter((s) => s.section === sec.id);
        const hours = mine.reduce((n, s) => n + s.man_hours, 0), waste = mine.reduce((n, s) => n + s.waste_cost, 0);
        return (
          <div key={sec.id} className={`absolute top-0 ${i === sections.length - 1 ? "" : "border-r border-white/[.04]"}`} style={{ left: i * COL, width: COL, height }}>
            <div className="border-b border-white/10 px-3 pb-2 pt-1">
              <p className="text-[11.5px] font-semibold text-white">{sec.name}{i === sections.length - 1 && <span className="ml-1.5 font-normal text-[#8f99a8]">main stem</span>}</p>
              <p className="text-[10.5px] text-[#8f99a8]">{num(hours, 0)} man-hours{waste ? ` · waste ${money(waste)}` : ""}</p>
            </div>
          </div>
        );
      })}
      <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
        <defs>
          <marker id="opc-a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#5f6b7c" /></marker>
          <marker id="opc-c" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#fab219" /></marker>
        </defs>
        {steps.flatMap((s) => (s.after as string[]).filter((a) => pos[a]).map((a) => {
          const p = pos[a], q = pos[s.id], hot = by[a].critical && s.critical;
          const d = p.x === q.x ? `M${p.x} ${p.y + 22} L${q.x} ${q.y - 23}` : `M${p.x} ${p.y + 22} L${p.x} ${q.y - 36} L${q.x} ${q.y - 36} L${q.x} ${q.y - 23}`;
          return <path key={`${a}-${s.id}`} d={d} fill="none" stroke={hot ? "#fab219" : "#5f6b7c"} strokeWidth={hot ? 2 : 1.25} markerEnd={`url(#${hot ? "opc-c" : "opc-a"})`} />;
        }))}
      </svg>
      {steps.map((s) => {
        const p = pos[s.id];
        if (!p) return null;
        const first = (s.materials as Rec[]).reduce<Rec | null>((best, m) => (!best || m.cost > best.cost ? m : best), null);
        const more = (s.materials as Rec[]).length - 1;
        const crew = (s.crew as Rec[]).map((c) => `${c.count} ${c.role}`).join(", ");
        return (
          <button key={s.id} onClick={() => onSelect(s.id)} className="absolute flex items-start gap-2 rounded px-1 text-left hover:bg-white/[.04]" style={{ left: p.x - 24, top: p.y - 21, width: COL - 22 }}>
            <Symbol s={s} on={sel === s.id} />
            <span className="min-w-0 pt-px">
              <span className="block text-[11.5px] font-medium leading-tight text-white">{s.name}</span>
              {s.kind === "inspection"
                ? <span className="mt-0.5 block truncate text-[10.5px] text-[#abb3bf]">{s.hold_point ? <b className="font-semibold text-[#ffb4b4]">Hold point {s.itp}</b> : s.itp} · {s.by}{s.wait_days ? ` · result in ${s.wait_days} days` : ""}</span>
                : <span className="mt-0.5 block truncate text-[10.5px] text-[#abb3bf]" title={crew}>{who[s.by] ?? s.by} · {s.crew_size} crew · {num(s.hours)} h</span>}
              {first && <span className="block truncate text-[10.5px] text-[#8f99a8]">{first.name} {num(first.gross, first.gross < 100 ? 1 : 0)} {first.unit}{first.waste ? <span className="text-[#fbd38d]"> · waste {num(first.waste, first.waste < 100 ? 1 : 0)}</span> : null}{more > 0 ? ` · +${more}` : ""}</span>}
              {flagged.has(s.id) && <span className="block text-[10px] text-[#fbd38d]">waste to take out</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 px-3 py-2 text-[10.5px] text-[#abb3bf]">
      <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-[#5b5fd6]" />Operation</span>
      <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[2px] bg-[#199e70]" />Inspection or test</span>
      <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[2px] bg-[#e5484d]" />Hold point: work stops until signed</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-3.5 bg-[#5f6b7c]" style={{ clipPath: "polygon(0 18%, 68% 18%, 68% 0, 100% 50%, 68% 100%, 68% 82%, 0 82%)" }} />Material handling</span>
      <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-[#fab219]" />Critical path</span>
    </div>
  );
}

function Chips({ ids, onDoc, onGo }: { ids: string[]; onDoc: (id: string) => void; onGo: (tab: string) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => id.startsWith("RFI") ? <button key={id} onClick={() => onGo("rfis")} className="rounded bg-white/10 px-1.5 py-px text-[10.5px] text-[#d3d8de] hover:bg-white/20">{id}</button>
        : <button key={id} onClick={() => onDoc(id)} className="rounded bg-white/10 px-1.5 py-px text-[10.5px] text-[#d3d8de] hover:bg-white/20">{id}</button>)}
    </span>
  );
}

function Actuals({ rec, s, act }: { rec: Rec; s: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [hours, setHours] = useState(s.actual?.man_hours != null ? String(s.actual.man_hours) : "");
  const [used, setUsed] = useState<Record<string, string>>(Object.fromEntries((s.materials as Rec[]).map((m) => [m.key, s.actual?.materials?.[m.key] != null ? String(s.actual.materials[m.key]) : ""])));
  const save = () => act(() => api(`/api/project/plans/${rec.id}/steps/${s.id}/actual`, { man_hours: hours === "" ? null : Number(hours), materials: Object.fromEntries(Object.entries(used).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) }));
  return (
    <div className="space-y-1.5 rounded border border-white/10 p-2">
      <Label>What it really took</Label>
      <label className="flex items-center justify-between gap-2 text-[#d3d8de]">Man-hours <span className="flex items-center gap-1 text-[10.5px] text-[#8f99a8]">plan {s.man_hours}<input type="number" min={0} aria-label="Actual man-hours" value={hours} onChange={(e) => setHours(e.target.value)} className={`${field} !w-[84px]`} /></span></label>
      {(s.materials as Rec[]).map((m) => (
        <label key={m.key} className="flex items-center justify-between gap-2 text-[#d3d8de]"><span className="min-w-0 truncate">{m.name}</span><span className="flex shrink-0 items-center gap-1 text-[10.5px] text-[#8f99a8]">plan {num(m.gross)} {m.unit}<input type="number" min={0} aria-label={`Actual ${m.name}`} value={used[m.key]} onChange={(e) => setUsed({ ...used, [m.key]: e.target.value })} className={`${field} !w-[84px]`} /></span></label>
      ))}
      <button disabled={hours === "" && !Object.values(used).some((v) => v !== "")} onClick={save} className={`${primary} w-full`}>Record</button>
      {(s.actual?.lines ?? []).map((l: Rec) => (
        <p key={l.key} className={l.over ? "text-[#ffb4b4]" : "text-[#7ee2c0]"}><Icon name={l.over ? "alert" : "check"} className="mr-1 inline h-3 w-3" />{l.name}: {num(l.used)} {l.unit} used, waste {num(l.waste)} ({l.waste_pct}%){l.over ? ", over plan" : ""}</p>
      ))}
    </div>
  );
}

function StepPanel({ rec, s, who, onClose, onDoc, onGo, act }: { rec: Rec; s: Rec; who: Record<string, string>; onClose: () => void; onDoc: (id: string) => void; onGo: (tab: string) => void; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const section = (rec.plan.sections as Rec[]).find((x) => x.id === s.section);
  const flags = (rec.plan.waste_flags as Rec[]).filter((f) => f.step === s.id);
  return (
    <Side eyebrow={`${s.id} · ${section?.name ?? s.section}`} title={s.name} onClose={onClose}>
      <div className="flex flex-wrap gap-1">
        {s.critical && <Pill tone="warn">critical</Pill>}
        {s.hold_point && <Pill tone="bad">hold point {s.itp}</Pill>}
        {!s.hold_point && s.itp && <Pill>{s.itp}</Pill>}
        <Pill tone={s.norm ? "info" : "none"}>{s.basis}</Pill>
        {s.with_previous && <Pill>runs with the step before</Pill>}
      </div>
      <div><Label>Procedure</Label><p className="mt-0.5 leading-snug text-[#e5e8eb]">{s.procedure}</p>{s.criteria && <p className="mt-1 leading-snug text-[#d3d8de]"><b className="font-medium text-white">Passes if:</b> {s.criteria}</p>}</div>
      <div>
        <Label>Workforce</Label>
        <p className="mt-0.5 text-[#e5e8eb]">{(s.crew as Rec[]).map((c) => `${c.count} ${c.role}`).join(", ") || "None"}{s.kind !== "inspection" && s.by ? `, ${who[s.by] ?? s.by}` : ""}</p>
        <p className="text-[11px] text-[#abb3bf]">{num(s.hours)} hours · {num(s.man_hours)} man-hours · {money(s.labour_cost)}{s.wait_days ? ` · then wait ${s.wait_days} days` : ""}</p>
        {(s.labour as Rec[]).length > 0 && (
          <table className="mt-1 w-full text-[11px] text-[#d3d8de]"><tbody>
            {(s.labour as Rec[]).map((w) => <tr key={w.role} className="border-t border-white/5"><td className="py-0.5">{w.role}{w.supervises ? <span className="text-[#8f99a8]"> (shared)</span> : null}</td><td className="text-right tabular-nums">{w.oh} OH</td><td className="pl-2 text-right tabular-nums">{w.man_hours} h</td></tr>)}
          </tbody></table>
        )}
      </div>
      {(s.materials as Rec[]).length > 0 && (
        <div>
          <Label>Material and waste</Label>
          <table className="mt-1 w-full text-[11px] text-[#d3d8de]"><thead className="text-[10px] text-[#8f99a8]"><tr><th className="text-left font-normal">Material</th><th className="text-right font-normal">Net</th><th className="text-right font-normal">Waste</th><th className="text-right font-normal">To order</th></tr></thead><tbody>
            {(s.materials as Rec[]).map((m) => <tr key={m.key} className="border-t border-white/5" title={`${m.waste_pct}%: ${m.basis}`}><td className="py-0.5">{m.name}</td><td className="text-right tabular-nums">{num(m.net)}</td><td className={`text-right tabular-nums ${m.waste ? "text-[#fbd38d]" : "text-[#8f99a8]"}`}>{m.waste ? num(m.waste) : "–"}</td><td className="text-right tabular-nums">{num(m.gross)} {m.unit}</td></tr>)}
          </tbody></table>
          <p className="mt-1 text-[10.5px] text-[#8f99a8]">{money(s.material_cost)}, of which waste {money(s.waste_cost)}. Hover a line for where its waste figure comes from.</p>
        </div>
      )}
      {flags.map((f, i) => <p key={i} className="rounded bg-[#fab219]/10 p-2 leading-snug text-[#fbd38d]"><b className="font-semibold">Waste to take out ({f.kind}).</b> {f.note}{f.saving_rp ? ` About ${money(f.saving_rp)}, the agent's estimate.` : ""}</p>)}
      <div><Label>Source</Label><div className="mt-1"><Chips ids={s.evidence} onDoc={onDoc} onGo={onGo} /></div></div>
      {rec.status === "approved" && s.kind !== "inspection" && <Actuals key={s.id} rec={rec} s={s} act={act} />}
    </Side>
  );
}

/** People on site at one moment, day by day, against what the programme allows: one measure, so one hue; the limit is a line. */
function CrewChart({ plan, who }: { plan: Rec; who: Record<string, string> }) {
  const days = plan.crew_by_day as Rec[], limit = plan.totals.programme_crew as number | null;
  const peak = Math.max(...days.map((d) => d.total), 0);
  const top = Math.max(limit ?? 0, peak, 1) * 1.14;  // one scale for every bar, with room above the tallest for its label
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const names = [...new Set(days.flatMap((d) => Object.keys(d.crew)))].filter((k) => who[k]);
  return (
    <div className="p-3">
      <div className="relative ml-2 mr-[150px] flex h-[170px] items-end gap-[2px] border-b border-white/15" onMouseLeave={() => setHover(null)}>
        {limit ? <div className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-[#d3d8de]/70" style={{ bottom: `${(limit / top) * 100}%` }}><span className="absolute left-full top-[-8px] ml-1.5 whitespace-nowrap text-[10.5px] text-[#d3d8de]">{limit} a day in the programme</span></div> : null}
        {days.map((d) => (
          <div key={d.day} tabIndex={0} aria-label={`Day ${d.day}: ${d.total} people at the peak`} className="relative flex h-full flex-1 cursor-default flex-col justify-end outline-none hover:bg-white/[.03] focus:bg-white/[.03]" onMouseEnter={() => setHover(d.day)} onFocus={() => setHover(d.day)}>
            <div className="relative mx-auto w-full max-w-[64px] rounded-t bg-[#8083e8]" style={{ height: `${(d.total / top) * 100}%` }}>
              {d.total === peak && <span className="absolute inset-x-0 -top-[17px] text-center text-[11px] font-medium tabular-nums text-white">{d.total}</span>}
            </div>
            {hover === d.day && (
              <div className="absolute left-1/2 top-1 z-10 w-[170px] -translate-x-1/2 rounded border border-white/15 bg-[#111418] p-2 text-[11px] text-[#d3d8de] shadow-lg">
                <p className="font-semibold text-white">Day {d.day}: {d.total} at the peak</p>
                {Object.entries(d.crew as Record<string, number>).filter(([k]) => who[k]).map(([k, n]) => <p key={k} className="flex justify-between gap-2"><span className="truncate">{who[k]}</span><span className="tabular-nums">{n}</span></p>)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="ml-2 mr-[150px] mt-1 flex gap-[2px]">{days.map((d) => <span key={d.day} className="flex-1 text-center text-[10.5px] text-[#8f99a8]">Day {d.day}</span>)}</div>
      <button onClick={() => setAsTable(!asTable)} className={`${quiet} ml-2 mt-2`}>{asTable ? "Hide the table" : "Show as a table"}</button>
      {asTable && (
        <div className="mt-2"><Table heads={["Day", "Peak on site", ...names.map((k) => who[k])]}>
          {days.map((d) => <tr key={d.day} className={tr}><td className={td}>{d.day}</td><td className={td}>{d.total}</td>{names.map((k) => <td key={k} className={td}>{d.crew[k] ?? 0}</td>)}</tr>)}
        </Table></div>
      )}
    </div>
  );
}

function Documents({ docs, open, onOpen, onClose }: { docs: Rec[]; open: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const doc = docs.find((d) => d.id === open);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label="The consultant's package" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-[980px] overflow-hidden rounded-lg border border-white/10 bg-[#1c2127] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="w-[320px] shrink-0 overflow-y-auto border-r border-white/10 p-2">
          <p className="px-2 pb-2 pt-1 text-[13px] font-semibold text-white">The consultant&apos;s package</p>
          {docs.map((d) => (
            <button key={d.id} onClick={() => onOpen(d.id)} className={`block w-full rounded px-2 py-1.5 text-left ${open === d.id ? "bg-white/10" : "hover:bg-white/5"}`}>
              <span className="block text-[11.5px] font-medium leading-tight text-white">{d.title}</span>
              <span className="text-[10.5px] text-[#8f99a8]">{KINDS[d.kind] ?? d.kind} · {d.from} · {d.date}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="flex items-start gap-2"><div className="min-w-0"><p className="text-[14px] font-semibold text-white">{doc?.title ?? "Choose a document"}</p>{doc && <p className="text-[11px] text-[#8f99a8]">{doc.id} · {doc.from} · {doc.date}</p>}</div><button onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button></div>
          {doc && <p className="mt-3 whitespace-pre-line text-[12.5px] leading-relaxed text-[#e5e8eb]">{doc.text}</p>}
          <p className="mt-4 text-[10.5px] text-[#8f99a8]">Synthetic document, written for this demo. No real project.</p>
        </div>
      </div>
    </div>
  );
}

function Start({ busy, onStart, onClose }: { busy: boolean; onStart: (versi: string) => void; onClose?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={busy} onClick={() => onStart("mock")} className={primary}>{busy ? "Starting…" : "Plan it: offline mock, no cost"}</button>
      <button disabled={busy} onClick={() => onStart("muse")} className={good}>Plan it: Muse, real models</button>
      {onClose && <button onClick={onClose} className={quiet}>Cancel</button>}
    </div>
  );
}

const VIEWS: [string, string][] = [["chart", "Chart"], ["steps", "Steps"], ["material", "Material and waste"], ["workforce", "Workforce"], ["findings", "Findings"], ["report", "Plan document"]];

export function PlanView({ onGo }: { onGo: (tab: string) => void }) {
  const { data, err, act } = useData("/api/project/plans");
  const pack = useData("/api/project/plan-package");
  const [pid, setPid] = useState<string | null>(null);
  const [view, setView] = useState("chart");
  const [sel, setSel] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null | undefined>(undefined);
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const docs = (pack.data?.documents ?? []) as Rec[];
  const start = async (versi: string) => {
    setBusy(true); setProblem("");
    try {
      const projects = await api<Rec[]>("/api/aip/konsultan/proyek");
      const proyek = projects[0]?.id ?? null;
      const r = await api("/api/aip/konsultan", { nama: `${pack.data?.scope.title ?? "Work"}: work plan`, proyek, versi, jenis: "plan" });
      try { localStorage.setItem("aip.swarm.terakhir", JSON.stringify({ proyek, run: r.run })); } catch { /* storage blocked */ }
      onGo("swarm");
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const plans = data.plans as Rec[], who = (data.who ?? {}) as Record<string, string>;
  const live = plans.filter((p) => p.status !== "superseded");
  const rec = plans.find((p) => p.id === pid) ?? live[0] ?? plans[0];
  const overlay = doc !== undefined && <Documents docs={docs} open={doc} onOpen={setDoc} onClose={() => setDoc(undefined)} />;
  if (!rec) return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Work plans" note="from the consultant's documents to a plan the site can build from" />
      <Problem err={err || problem} />
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f] p-6">
        <div className="mx-auto max-w-[840px] space-y-4">
          <div>
            <p className="text-[18px] font-semibold text-white">Consultant&apos;s documents in. A chart the site can build from out.</p>
            <p className="mt-1 max-w-[680px] leading-relaxed text-[#d3d8de]">The swarm reads the package and writes an Operation Process Chart: every operation and inspection in order, with its procedure, workforce, material and waste. It says where the documents disagree. Agents decide the steps, code does the sums from the national standard, and a person approves.</p>
          </div>
          <Card title={`The package: ${pack.data?.scope.title ?? ""}`} right={<span className="text-[10.5px] font-normal text-[#8f99a8]">{docs.length} documents, synthetic</span>}>
            <div className="grid grid-cols-2 gap-px bg-white/5 max-md:grid-cols-1">
              {docs.map((d) => (
                <button key={d.id} onClick={() => setDoc(d.id)} className="bg-[#1c2127] px-3 py-2 text-left hover:bg-[#232a33]">
                  <span className="block text-[11.5px] font-medium leading-tight text-white">{d.title}</span>
                  <span className="text-[10.5px] text-[#8f99a8]">{KINDS[d.kind] ?? d.kind} · {d.from}</span>
                </button>
              ))}
            </div>
          </Card>
          <Start busy={busy} onStart={start} />
        </div>
      </div>
      {overlay}
    </div>
  );
  const plan = rec.plan as Rec, t = plan.totals as Rec, steps = plan.steps as Rec[], checks = plan.checks as Rec[], flags = plan.waste_flags as Rec[];
  const look = checks.filter((c) => !c.ok);
  const open = steps.find((s) => s.id === sel);
  const flagged = new Set(flags.map((f) => f.step as string));
  const saving = flags.reduce((n, f) => n + (f.saving_rp || 0), 0);
  const line = (m: Rec) => <p key={m.key} className="whitespace-nowrap">{m.name}: {num(m.gross)} {m.unit}{m.waste ? <span className="text-[#fbd38d]"> (waste {num(m.waste)})</span> : null}</p>;
  const tabs: ReactNode = (
    <div className="flex shrink-0 gap-1 border-b border-white/5 bg-[#1c2127] px-3 pt-1.5">
      {VIEWS.map(([k, label]) => <button key={k} onClick={() => setView(k)} className={`rounded-t px-2.5 py-1 text-[11.5px] ${view === k ? "bg-[#161a1f] font-medium text-white" : "text-[#abb3bf] hover:text-white"}`}>{label}{k === "findings" && look.length ? <span className="ml-1 rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{look.length}</span> : null}</button>)}
    </div>
  );
  return (
    <div className="flex min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title={`Work plan: ${rec.title}`} note={<span className="inline-flex items-center gap-1.5"><Pill tone={STATUS[rec.status]}>{rec.status === "pending" ? "waiting for you" : rec.status}</Pill>{rec.mode === "mock" && <Pill tone="violet">offline mock: scripted answers</Pill>}<span>{(plan.activities as string[]).join(", ")}</span></span>}>
          {plans.length > 1 && <select aria-label="Choose a plan" value={rec.id} onChange={(e) => { setPid(e.target.value); setSel(null); }} className="rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-[11px] text-white">{plans.map((p) => <option key={p.id} value={p.id} className="bg-[#1c2127]">{p.id} · {p.status}</option>)}</select>}
          <button onClick={() => setDoc(docs[0]?.id ?? null)} className={quiet}>The documents</button>
          <a href={`${API_URL}/api/project/plans/${rec.id}/procedure.md`} download={`${rec.id}-procedure.md`} className={quiet}>Procedure</a>
          <a href={`${API_URL}/api/project/plans/${rec.id}/table.csv`} download={`${rec.id}-steps.csv`} className={quiet}>Spreadsheet</a>
          <button onClick={() => setAgain(!again)} className={quiet}>Plan again</button>
        </Bar>
        <Problem err={err || problem} />
        {again && <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/5 bg-[#161a1f] px-4 py-2"><span className="text-[#d3d8de]">A new review reads the package and the records as they stand now, and replaces this plan if it is still waiting.</span><Start busy={busy} onStart={start} onClose={() => setAgain(false)} /></div>}
        {rec.status === "pending" && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#fab219]/30 bg-[#fab219]/[.07] px-4 py-2">
            <span className="text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />Nothing has changed yet. Approving opens the work items, plans the inspections and requests the material.{look.length ? ` Code has ${look.length} things for you to look at first.` : ""}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (optional)" className={`${field} !w-[230px]`} />
            <button onClick={() => act(() => api(`/api/project/plans/${rec.id}/approve`, { note }))} className={good}>Approve the plan</button>
            <button onClick={() => act(() => api(`/api/project/plans/${rec.id}/reject`, { note }))} className={quiet}>Reject</button>
          </div>
        )}
        {rec.status === "approved" && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#29a383]/30 bg-[#29a383]/[.07] px-4 py-1.5 text-[#7ee2c0]">
            <span><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />Approved by {rec.decided_by}, {rec.decided_at}. {(rec.effects as string[]).join(" ")}</span>
            <span className="ml-auto flex gap-1"><button onClick={() => onGo("decisions")} className={quiet}>Work items</button><button onClick={() => onGo("quality")} className={quiet}>Inspections</button><button onClick={() => onGo("procurement")} className={quiet}>Material requests</button></span>
          </div>
        )}
        <Kpis>
          <Kpi label={`${t.inspections} inspections · ${t.handling} handling`} value={`${t.operations} operations`} />
          <Kpi label="man-hours" value={num(t.man_hours, 0)} hint={`${num(t.oh, 0)} OH`} />
          <Kpi label={`working days, ${t.window_days} in the programme`} value={t.days} tone={t.days > t.window_days ? "bad" : "ok"} />
          <Kpi label={t.programme_crew ? `peak crew, ${t.programme_crew} in the programme` : "peak crew"} value={t.peak_crew} tone={t.programme_crew && t.peak_crew > t.programme_crew ? "warn" : "ok"} />
          <Kpi label="material" value={money(t.material_cost)} />
          <Kpi label="material waste" value={money(t.waste_cost)} tone="warn" hint={saving ? `${money(saving)} could come out` : ""} />
          <Kpi label={`planned cost, BoQ ${money(t.boq_value)}`} value={money(t.cost)} tone={t.margin < 0 ? "warn" : "ok"} />
          {rec.status === "approved" && <Kpi label="steps with actuals" value={`${rec.progress.done} of ${rec.progress.of}`} hint={rec.progress.done ? `waste ${money(rec.progress.actual_waste)} against ${money(rec.progress.planned_waste)}` : ""} tone={rec.progress.actual_waste > rec.progress.planned_waste ? "bad" : undefined} />}
        </Kpis>
        {tabs}
        <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
          {view === "chart" && <div className="min-w-fit"><Legend /><div className="px-3 pb-6"><OpcChart plan={plan} who={who} flagged={flagged} sel={sel} onSelect={setSel} /></div></div>}
          {view === "steps" && (
            <Table heads={["Step", "What", "By", "Crew", "Hours", "Man-hours", "Material to order", "Waste (Rp)", "Cost (Rp)", "Basis"]}>
              {steps.map((s) => (
                <tr key={s.id} onClick={() => setSel(s.id)} className={`${tr} cursor-pointer ${sel === s.id ? "bg-white/[.07]" : ""}`}>
                  <td className={`${td} font-medium text-white`}>{s.id}{s.critical && <span className="ml-1 text-[10px] font-normal text-[#fbd38d]">critical</span>}</td><td className={td}>{s.name}</td><td className={td}>{who[s.by] ?? s.by}</td>
                  <td className={td}>{(s.crew as Rec[]).map((c) => <p key={c.role} className="whitespace-nowrap">{c.count} {c.role}</p>)}</td><td className={td}>{num(s.hours)}</td><td className={td}>{num(s.man_hours)}</td>
                  <td className={td}>{(s.materials as Rec[]).map(line)}</td><td className={td}>{s.waste_cost ? s.waste_cost.toLocaleString("en-US") : "–"}</td><td className={td}>{(s.labour_cost + s.material_cost).toLocaleString("en-US")}</td><td className={td}>{s.basis}</td>
                </tr>
              ))}
            </Table>
          )}
          {view === "material" && (
            <div className="space-y-3 p-3">
              <Card title="Material to order, and the waste in it" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">{plan.source.split(",")[0]}</span>}>
                <Table heads={["Material", "Net need", "Waste", "To order", "Rate (Rp)", "Cost (Rp)", "Waste (Rp)", "Steps", "Where the waste figure comes from"]}>
                  {(plan.materials as Rec[]).map((m) => <tr key={m.key} className={tr}><td className={`${td} font-medium text-white`}>{m.name}</td><td className={td}>{num(m.net)} {m.unit}</td><td className={`${td} ${m.waste ? "text-[#fbd38d]" : "text-[#8f99a8]"}`}>{m.waste ? `${num(m.waste)} (${m.waste_pct}%)` : "none stated"}</td><td className={td}>{num(m.gross)} {m.unit}</td><td className={td}>{m.rate.toLocaleString("en-US")}</td><td className={td}>{m.cost.toLocaleString("en-US")}</td><td className={td}>{m.waste_cost ? m.waste_cost.toLocaleString("en-US") : "–"}</td><td className={td}>{(m.steps as string[]).join(", ")}</td><td className={`${td} text-[11px] text-[#abb3bf]`}>{m.basis}</td></tr>)}
                </Table>
              </Card>
              <Card title={`Waste the agents would take out (${flags.length})`} right={saving ? <span className="text-[10.5px] font-normal text-[#8f99a8]">about {money(saving)}, their estimate</span> : undefined}>
                {flags.length ? flags.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 border-t border-white/5 px-3 py-2 first:border-t-0">
                    <button onClick={() => { setView("chart"); setSel(f.step); }} className="shrink-0"><Pill tone="warn">{f.step}</Pill></button>
                    <div className="min-w-0 flex-1"><p className="leading-snug text-[#e5e8eb]">{f.note}</p><p className="mt-0.5 text-[10.5px] text-[#8f99a8]">{f.kind} · {f.saving_rp ? `about ${full(f.saving_rp)} (${f.saving_expression})` : "no figure"}</p></div>
                    <Chips ids={f.evidence} onDoc={setDoc} onGo={onGo} />
                  </div>
                )) : <p className="p-4 text-center text-[#8f99a8]">None flagged.</p>}
              </Card>
              <Card title="Quantities, each worked out by code from the agent's sum">
                <Table heads={["Quantity", "The sum", "Worked out", "BoQ", "Difference", "Source"]}>
                  {(plan.quantities as Rec[]).map((q) => <tr key={q.id} className={tr}><td className={`${td} font-medium text-white`}>{q.element}</td><td className={`${td} font-mono text-[11px]`}>{q.expression}</td><td className={td}>{num(q.value, 2)} {q.unit}</td><td className={td}>{q.boq_qty != null ? `${num(q.boq_qty, 2)} ${q.unit}` : "–"}</td><td className={td}>{q.boq_diff_pct != null ? <Pill tone={Math.abs(q.boq_diff_pct) > 3 ? "bad" : "ok"}>{q.boq_diff_pct > 0 ? "+" : ""}{q.boq_diff_pct}%</Pill> : "–"}</td><td className={td}><Chips ids={q.evidence} onDoc={setDoc} onGo={onGo} /></td></tr>)}
                </Table>
              </Card>
            </div>
          )}
          {view === "workforce" && (
            <div className="space-y-3 p-3">
              <Card title="People on site at the peak of each day" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">{t.hours_per_oh} working hours a day</span>}><CrewChart plan={plan} who={who} /></Card>
              <Card title="Workforce by trade" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">OH: one person for one day. From SNI 7394:2008, plus the agents&apos; estimates for handling and inspection</span>}>
                <Table heads={["Trade", "OH", "Man-hours", "Cost (Rp)"]}>{(plan.workforce as Rec[]).map((w) => <tr key={w.role} className={tr}><td className={`${td} text-white`}>{w.role}{w.supervises ? <span className="text-[#8f99a8]"> (shared across steps)</span> : null}</td><td className={td}>{num(w.oh)}</td><td className={td}>{num(w.man_hours)}</td><td className={td}>{w.cost.toLocaleString("en-US")}</td></tr>)}</Table>
              </Card>
              <Card title="Peak against what each has">
                <Table heads={["Who", "Peak on this plan", "Crew they have", ""]}>{Object.entries(t.peak_by as Record<string, number>).filter(([k]) => t.crews[k] != null).map(([k, n]) => <tr key={k} className={tr}><td className={`${td} text-white`}>{who[k] ?? k}</td><td className={td}>{n}</td><td className={td}>{t.crews[k]}</td><td className={td}><Pill tone={n > t.crews[k] ? "bad" : "ok"}>{n > t.crews[k] ? "more than they have" : "fits"}</Pill></td></tr>)}</Table>
              </Card>
            </div>
          )}
          {view === "findings" && (
            <div className="space-y-3 p-3">
              <Card title={`What code checked: ${look.length} to look at, ${checks.length - look.length} fine`}>
                {[...look, ...checks.filter((c) => c.ok)].map((c) => <p key={c.rule} className={`flex items-start gap-2 border-t border-white/5 px-3 py-1.5 first:border-t-0 ${c.ok ? "text-[#abb3bf]" : "text-[#e5e8eb]"}`}><Icon name={c.ok ? "check" : "alert"} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${c.ok ? "text-[#7ee2c0]" : "text-[#fbd38d]"}`} /><span><b className="font-medium">{c.ok ? "Fine." : "Look at this."}</b> {c.text}</span></p>)}
              </Card>
              <Card title={`What the agents found in the package (${[...new Set((rec.findings as Rec[]).map((f) => f.tag))].length} kinds of problem)`}>
                {[...new Set((rec.findings as Rec[]).map((f) => f.tag as string))].map((tag) => (
                  <div key={tag} className="flex items-start gap-3 border-t border-white/5 px-3 py-2 first:border-t-0">
                    <span className="w-[130px] shrink-0"><Pill tone="warn">{TAG[tag] ?? tag}</Pill></span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {(rec.findings as Rec[]).filter((f) => f.tag === tag).map((f, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <div className="min-w-0 flex-1"><p className="leading-snug text-[#e5e8eb]">{f.note}</p><p className="mt-0.5 text-[10.5px] text-[#8f99a8]">{((f.who ?? f.agents) as string[]).join(", ")} · on {f.subject}</p></div>
                          <Chips ids={f.evidence} onDoc={setDoc} onGo={onGo} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!(rec.findings as Rec[]).length && <p className="p-4 text-center text-[#8f99a8]">None.</p>}
              </Card>
              <Card title="The red team">
                {Object.values(rec.attacks as Record<string, Rec>).map((a) => <div key={a.view} className="flex items-start gap-3 border-t border-white/5 px-3 py-2 first:border-t-0"><span className="w-[130px] shrink-0"><Pill tone={a.result === "holds" ? "ok" : "warn"}>{a.result === "holds" ? "plan holds" : "plan weakened"}</Pill></span><p className="min-w-0 flex-1 leading-snug text-[#e5e8eb]"><b className="font-medium text-white">As {a.view}:</b> {a.reason}</p></div>)}
              </Card>
              <Card title={`RFIs the agents drafted (${(rec.rfi_drafts as Rec[]).length})`} right={<button onClick={() => onGo("rfis")} className={quiet}>Open RFIs</button>}>
                {(rec.rfi_drafts as Rec[]).map((r, i) => <div key={i} className="border-t border-white/5 px-3 py-2 first:border-t-0"><p className="font-medium text-white">{r.subject}</p><p className="leading-snug text-[#d3d8de]">{r.question}</p><p className="text-[10.5px] text-[#8f99a8]">To {r.to}, on {r.activity}. A person issues it.</p></div>)}
                {!(rec.rfi_drafts as Rec[]).length && <p className="p-4 text-center text-[#8f99a8]">None.</p>}
              </Card>
              <Card title={`Work items from this plan (${(rec.work_items as Rec[]).length})`}>
                <Table heads={["Item", "What", "Who", "Due", "Status"]}>{(rec.work_items as Rec[]).map((w) => <tr key={w.id} className={tr}><td className={td}>{w.id}</td><td className={td}><span className="text-white">{w.title}</span>{w.why && <p className="text-[10.5px] text-[#8f99a8]">{w.why}</p>}</td><td className={td}>{(w.owner as string).replace(" (fictional)", "")}</td><td className={`${td} whitespace-nowrap`}>{w.due}</td><td className={td}><Pill tone={STATUS[w.status] ?? "none"}>{w.status}</Pill></td></tr>)}</Table>
              </Card>
            </div>
          )}
          {view === "report" && <div className="mx-auto max-w-[980px] p-4"><Markdown text={rec.report} /></div>}
        </div>
      </div>
      {open && <StepPanel rec={rec} s={open} who={who} onClose={() => setSel(null)} onDoc={setDoc} onGo={onGo} act={act} />}
      {overlay}
    </div>
  );
}
