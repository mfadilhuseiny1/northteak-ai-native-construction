"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { api, Bar, Card, Empty, field, good, Kpi, Kpis, Label, Loading, money, num, Pill, primary, Problem, quiet, Ref, dates, short, Side, useData, useFocus, useGo, type Rec, type Tone, NotYet } from "./kit";
import { CARD, nodeFocus, NodePanel } from "./NodePanel";
import { WbsDiagram, WbsReport, type WbsNode } from "./WbsDiagram";
import { CpmNetwork, linkReasons } from "./CpmNetwork";
import { ControlAccounts, Dictionary, WorkPackages } from "./WbsViews";
import { Group, hue, Item, Legend, OTHER, SizeBar, Span } from "./Visual";

/* The WBS: the work broken down from the project, through control accounts and work packages, to the task. Everything else hangs on this tree, so a row here shows what is known about that piece of work, and opens it. */

const STATUS: Record<string, Tone> = { pending: "warn", approved: "ok", rejected: "bad", superseded: "none", proposed: "violet", open: "info", done: "ok" };
const KINDS: Record<string, string> = { scope: "Work brief", drawing: "Drawing", spec: "Specification", itp: "Inspection plan", boq: "BoQ", programme: "Programme", method: "Site logistics", rates: "Rates" };
const TAG: Record<string, string> = { DOCUMENT_CONFLICT: "Documents disagree", SUPERSEDED_DRAWING: "Superseded drawing", BOQ_MISMATCH: "BoQ mismatch", CREW_SHORT: "Crew short", TIME_SHORT: "Time short", SCOPE_GAP: "Scope gap", RFI_OPEN: "Open RFI", SEQUENCE_RISK: "Sequence risk", MATERIAL_WASTE: "Material waste", HANDLING_WASTE: "Handling waste", SAFETY: "Safety", COST_EXPOSURE: "Cost exposure", OTHER: "Other" };
const TYPE_ICON: Record<string, string> = { operation: "O", inspection: "I", handling: "H" };

function Progress({ value }: { value: number }) {
  return <span className="flex items-center gap-1.5" title={`${value}%`}><span className="h-1.5 w-14 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-[#c08414]" style={{ width: `${value}%` }} /></span><span className="w-7 text-right text-[10.5px] tabular-nums text-[#abb3bf]">{value}%</span></span>;
}

/** What every module knows about this node, each a way into that module. */
function Links({ n }: { n: Rec }) {
  const r = n.roll as Rec;
  if (!r) return null;
  const live = r.tasks - r.proposed;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {r.proposed > 0 && <Ref to="wbs/plan" tone="violet">{r.proposed} proposed</Ref>}
      {live > 0 && <Ref to="kanban/board" tone={r.stopped ? "bad" : r.done === live ? "ok" : "none"}>{r.done}/{live} tasks{r.stopped ? `, ${r.stopped} stopped` : ""}</Ref>}
      {r.rfis > 0 && <Ref to="documents/rfis" tone="warn">{r.rfis} RFI</Ref>}
      {r.drafts > 0 && <Ref to="documents/rfis" tone="violet">{r.drafts} draft</Ref>}
      {r.ncrs > 0 && <Ref to="quality/ncrs" tone="bad">{r.ncrs} NCR</Ref>}
      {r.inspections > 0 && <Ref to="quality/inspections" tone={r.inspections_passed === r.inspections ? "ok" : "none"}>{r.inspections_passed}/{r.inspections} insp.</Ref>}
      {r.orders > 0 && <Ref to="procurement/orders" tone={r.orders_late ? "bad" : "none"}>{r.orders} order{r.orders === 1 ? "" : "s"}{r.orders_late ? `, ${r.orders_late} late` : ""}</Ref>}
    </span>
  );
}

const OUTLINE = "grid grid-cols-[60px_minmax(230px,1fr)_130px_24%_96px_92px_170px] items-center gap-x-3";  // the same widths on every row, so the timeline lines up down the page
type Window = { from: string; to: string; today: string };

function Row({ n, depth, open, toggle, sel, onSel, span, color }: { n: Rec; depth: number; open: Set<string>; toggle: (code: string) => void; sel: string | null; onSel: (code: string) => void; span: Window; color: string }) {
  const kids = (n.children ?? []) as Rec[];
  const isOpen = open.has(n.code);
  const { setFocus } = useFocus();
  const at = (d: string) => Math.max(0, Math.min(100, ((Date.parse(d) - Date.parse(span.from)) / Math.max(1, Date.parse(span.to) - Date.parse(span.from))) * 100));
  return (
    <>
      <div onClick={() => onSel(n.code)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onSel(n.code); }} className={`group ${OUTLINE} cursor-pointer border-t border-white/[.04] px-3 py-1.5 outline-none hover:bg-white/[.04] focus-visible:bg-white/[.06] ${sel === n.code ? "bg-white/[.07]" : n.type === "package" ? "bg-white/[.025]" : ""}`} style={n.type === "package" ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
        <span className="truncate font-mono text-[10.5px] text-[#8f99a8]">{n.code}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            {Array.from({ length: depth }, (_, i) => <span key={i} className="-my-2 h-7 w-3 shrink-0 border-l border-white/10" />)}
            {kids.length ? <button onClick={(e) => { e.stopPropagation(); toggle(n.code); }} aria-label={isOpen ? "Collapse" : "Expand"} aria-expanded={isOpen} className="rounded p-0.5 text-[#abb3bf] hover:bg-white/10"><Icon name={isOpen ? "down" : "right"} className="h-3 w-3" /></button> : <span className="w-4 shrink-0" />}
            {n.type === "task" && <span className={`flex h-4 w-4 shrink-0 items-center justify-center text-[9px] font-bold ${n.kind === "inspection" ? `rounded-[2px] border ${n.hold_point ? "border-[#e5484d] text-[#ffb4b4]" : "border-[#abb3bf] text-[#d3d8de]"}` : n.kind === "handling" ? "text-[#abb3bf]" : "rounded-full border border-[#abb3bf] text-[#d3d8de]"}`}>{TYPE_ICON[n.kind] ?? "O"}</span>}
            <span className={`min-w-0 ${n.type === "project" || n.type === "package" ? "font-semibold text-white" : n.type === "activity" ? "font-medium text-white" : n.type === "section" ? "text-[#e5e8eb]" : "text-[#d3d8de]"}`}>{n.name}</span>
            {n.ref && n.type !== "section" && n.type !== "project" && <span className="shrink-0 text-[10.5px] text-[#8f99a8]">{n.type === "package" ? String(n.ref).replace("WP-", "CA-") : n.ref}</span>}
            {n.critical && n.type !== "package" && <span className="shrink-0 text-[10px] text-[#fbd38d]">critical</span>}
            {n.hold_point && <span className="shrink-0 text-[10px] text-[#ffb4b4]">hold point</span>}
            {n.ready && !n.ready.ready && <span className="shrink-0 text-[10px] text-[#fbd38d]">info not ready</span>}
            <button onClick={(e) => { e.stopPropagation(); setFocus(nodeFocus(n, kids)); }} title="Show only this in every module" aria-label={`Show only ${n.code} in every module`} className="ml-1 shrink-0 rounded p-0.5 text-[#8f99a8] opacity-0 hover:bg-white/10 hover:text-white focus:opacity-100 group-hover:opacity-100"><Icon name="fit" className="h-3 w-3" /></button>
          </span>
        </span>
        <span className="truncate text-[11px] text-[#d3d8de]" title={n.by_name || ""}>{n.by_name || ""}</span>
        <span>{n.start && n.finish ? <Span start={n.start} finish={n.finish} from={span.from} to={span.to} today={span.today} color={color} progress={typeof n.progress === "number" && n.type !== "section" ? n.progress : undefined} critical={!!n.critical && n.type !== "package"} /> : null}</span>
        <span>{n.status && n.type === "task" ? <Pill tone={CARD[n.status]?.[1] ?? "none"}>{CARD[n.status]?.[0] ?? n.status}</Pill> : typeof n.progress === "number" && n.type !== "section" ? <Progress value={n.progress} /> : null}</span>
        <span className="whitespace-nowrap text-right text-[11px] tabular-nums text-[#d3d8de]">{n.cost ? money(n.cost.budget) : n.roll?.planned_cost ? money(n.roll.planned_cost) : ""}</span>
        <span><Links n={n} /></span>
      </div>
      {n.type === "activity" && isOpen && (n.milestones as Rec[]).map((m) => (
        <div key={m.id} className={`${OUTLINE} border-t border-white/[.04] px-3 py-1.5`}>
          <span className="font-mono text-[10.5px] text-[#8f99a8]">{m.id}</span>
          <span className={`text-[11.5px] ${m.days_late ? "text-[#ffb4b4]" : "text-[#d3d8de]"}`} style={{ paddingLeft: (depth + 1) * 16 + 20 }}>◆ {m.name}: due {short(m.contract_date)}, forecast {short(m.forecast)}{m.days_late ? `, ${m.days_late} days late` : ""}</span>
          <span />
          <span className="relative block h-3.5">{[["contract", m.contract_date], ["forecast", m.forecast]].map(([k, d]) => <span key={k} title={`${k} ${d}`} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]" style={{ left: `${at(d)}%`, ...(k === "contract" ? { boxShadow: "inset 0 0 0 1.5px #e5e8eb" } : { background: m.days_late ? "#f87171" : "#c08414" }) }} />)}</span>
        </div>
      ))}
      {isOpen && kids.map((k, i) => <Row key={k.code} n={k} depth={depth + 1} open={open} toggle={toggle} sel={sel} onSel={onSel} span={span} color={n.type === "project" ? hue(i) : color} />)}
    </>
  );
}

function ancestors(code: string) {
  const parts = code.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

function Adder({ kind, data, act, onClose }: { kind: string; data: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void }) {
  const [f, setF] = useState<Rec>({ name: "", package: data.packages[0]?.id ?? "", duration: 5, predecessors: [], by: "self", activity: data.activities[0]?.id ?? "", contract_date: "", sub: "", budget: "" });
  const save = async (fn: () => Promise<unknown>) => { if (await act(fn)) onClose(); };
  return (
    <Side title={kind === "package" ? "Add a control account" : kind === "activity" ? "Add a work package" : "Add a milestone"} onClose={onClose}>
      <label className="block"><Label>Name</Label><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} /></label>
      {kind === "package" && (
        <>
          <label className="block"><Label>Subcontractor</Label><select value={f.sub} onChange={(e) => setF({ ...f, sub: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">Own crew</option>{(data.subs as Rec[]).map((s) => <option key={s.id} value={s.id} className="bg-[#1c2733]">{s.name}</option>)}</select></label>
          <label className="block"><Label>Budget, Rp (BoQ lines add to it)</Label><input type="number" min={0} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} className={field} /></label>
          <button disabled={!f.name.trim()} onClick={() => save(() => api("/api/project/packages", { name: f.name, sub: f.sub, budget: Number(f.budget) || 0 }))} className={`${primary} w-full`}>Add the control account</button>
        </>
      )}
      {kind === "activity" && (
        <>
          <label className="block"><Label>Control account</Label><select value={f.package} onChange={(e) => setF({ ...f, package: e.target.value })} className={field}>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2733]">{p.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2">
            <label><Label>Duration, days</Label><input type="number" min={1} value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} className={field} /></label>
            <label><Label>By</Label><select value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} className={field}><option value="self" className="bg-[#1c2733]">Own crew</option>{(data.subs as Rec[]).map((s) => <option key={s.id} value={s.id} className="bg-[#1c2733]">{s.name}</option>)}</select></label>
          </div>
          <div><Label>Must finish first</Label><div className="mt-1 max-h-[170px] space-y-0.5 overflow-y-auto rounded border border-white/10 p-1.5">{(data.activities as Rec[]).map((a) => <label key={a.id} className="flex items-center gap-1.5 text-[11.5px] text-[#d3d8de]"><input type="checkbox" checked={(f.predecessors as string[]).includes(a.id)} onChange={(e) => setF({ ...f, predecessors: e.target.checked ? [...f.predecessors, a.id] : f.predecessors.filter((x: string) => x !== a.id) })} /><span className="text-[#8f99a8]">{a.id}</span><span className="truncate">{a.name}</span></label>)}{!(data.activities as Rec[]).length && <p className="text-[#8f99a8]">None yet.</p>}</div></div>
          <p className="text-[11px] text-[#abb3bf]">Code works out its dates and float from the links.</p>
          <button disabled={!f.name.trim() || !f.package} onClick={() => save(() => api("/api/project/activities", { name: f.name, package: f.package, duration: Number(f.duration) || 1, predecessors: f.predecessors, by: f.by }))} className={`${primary} w-full`}>Add the work package</button>
        </>
      )}
      {kind === "milestone" && (
        <>
          <label className="block"><Label>Reached when this finishes</Label><select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} className={field}>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.id} {a.name}</option>)}</select></label>
          <label className="block"><Label>Contract date</Label><input type="date" value={f.contract_date} onChange={(e) => setF({ ...f, contract_date: e.target.value })} className={field} /></label>
          <button disabled={!f.name.trim() || !f.activity || !f.contract_date} onClick={() => save(() => api("/api/project/milestones", { name: f.name, activity: f.activity, contract_date: f.contract_date }))} className={`${primary} w-full`}>Add the milestone</button>
        </>
      )}
    </Side>
  );
}

/** The breakdown as a tree diagram or as an outline table. What is picked opens beside it, in the WBS's panel. */
function Tree({ view, data, target, sel, onSel }: { view: string; data: Rec; target: string; sel: string | null; onSel: (code: string) => void }) {
  const { focus } = useFocus();
  const [open, setOpen] = useState<Set<string> | null>(null);
  const root = data.root as Rec;
  const opened = useMemo(() => {
    if (open) return open;
    const start = new Set<string>(["1"]);
    for (const c of root.children ?? []) start.add(c.code);  // down to the work packages: open one to see its tasks
    return start;
  }, [open, root]);
  useEffect(() => { if (target) setOpen(new Set([...opened, ...ancestors(target)])); }, [target]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // a node renumbered by a move, or picked elsewhere, shows with its parents open
    if (sel && ancestors(sel).slice(0, -1).some((c) => !opened.has(c))) setOpen(new Set([...opened, ...ancestors(sel).slice(0, -1)]));
  }, [sel]);  // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (code: string) => { const next = new Set(opened); if (next.has(code)) next.delete(code); else next.add(code); setOpen(next); };
  const shown = focus && focus.type !== "project" ? (function find(n: Rec): Rec | null { if (n.code === focus.code) return n; for (const c of n.children ?? []) { const hit = find(c); if (hit) return hit; } return null; })(root) ?? root : root;
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
      {view === "outline" ? (
        <div className="min-w-[1080px]">
          <div className={`${OUTLINE} sticky top-0 z-[1] bg-[#1c2733] px-3 py-2 text-[10.5px] uppercase tracking-wide text-[#8f99a8]`}>{["WBS", "Work", "By", "When", "Progress", "Budget or plan", "Linked records"].map((h, i) => <span key={h} className={`whitespace-nowrap font-medium ${i >= 5 ? "text-right" : ""}`}>{h}</span>)}</div>
          <Row n={shown} depth={0} open={new Set([...opened, shown.code])} toggle={toggle} sel={sel} onSel={onSel} span={{ from: root.start, to: root.finish, today: data.today }} color={OTHER} />
        </div>
      ) : <WbsDiagram root={shown as WbsNode} hide={shown.type === "project" ? ["section", "task"] : shown.type === "package" ? ["task"] : []} sel={sel} onSelect={onSel} />}
      {!(root.children as Rec[]).length && <NotYet>Nothing broken down yet. You can also add a control account and its work packages by hand, with Add.</NotYet>}
    </div>
  );
}

/** One button for everything a person can add to the WBS by hand. What cannot be added yet says what has to come first. */
function AddMenu({ data, onPick }: { data: Rec; onPick: (kind: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  const items: [string, string, string, string][] = [
    ["package", "Control account", "a part of the job with its own budget", ""],
    ["activity", "Work package", "work under a control account, with its days and links", (data.packages as Rec[]).length ? "" : "add a control account first"],
    ["milestone", "Milestone", "a contract date, reached when a work package finishes", (data.activities as Rec[]).length ? "" : "add a work package first"],
  ];
  return (
    <div ref={box} className="relative">
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={`${quiet} flex items-center gap-1`}><span className="text-[13px] leading-none">+</span>Add</button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-[270px] rounded-md border border-white/15 bg-[#1c2733] p-1 shadow-[0_8px_24px_rgb(0_0_0/.45)]">
          {items.map(([k, label, hint, first]) => (
            <button key={k} role="menuitem" disabled={!!first} onClick={() => { setOpen(false); onPick(k); }} className="block w-full rounded px-2.5 py-1.5 text-left hover:bg-white/[.07] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent">
              <span className="block text-[12px] text-white">{label}</span>
              <span className="block text-[10.5px] text-[#8f99a8]">{first || hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_WORD: Record<string, string> = { operation: "work", inspection: "inspection", handling: "handling" };

/** A plan's tasks, under the work package each belongs to: who does it, how many people for how long, and what it waits for. */
function TaskCards({ steps, plan, who, sel, onSel }: { steps: Rec[]; plan: Rec; who: Rec; sel: string | null; onSel: (code: string) => void }) {
  const tree = (plan.tree ?? []) as Rec[];
  const groups = tree.length ? tree.map((t) => ({ key: t.activity as string, code: t.code as string, name: t.name as string })) : [...new Set(steps.map((s) => s.activity as string))].map((a) => ({ key: a, code: String(steps.find((s) => s.activity === a)?.code ?? "").split(".").slice(0, 3).join("."), name: a }));
  const accounts = [...new Set(groups.map((g) => g.code.split(".").slice(0, 2).join(".")))];
  const max = Math.max(...steps.map((s) => s.man_hours || 0), 1);
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-[#8f99a8]"><span>{steps.length} tasks in {groups.length} work packages. Bars: man-hours. Click a task to open it.</span><Legend items={[{ label: "critical", color: "#f87171" }, { label: "hold point", color: "#ffb4b4", hatched: true }]} /></div>
      {groups.map((g) => {
        const mine = steps.filter((s) => s.activity === g.key);
        if (!mine.length) return null;
        const color = hue(accounts.indexOf(g.code.split(".").slice(0, 2).join(".")));
        const hours = mine.reduce((n, s) => n + (s.man_hours || 0), 0);
        return (
          <Group key={g.key} color={color} code={g.code} title={g.name} sub={`${mine.length} task${mine.length === 1 ? "" : "s"} · ${plan.packages?.[g.key]?.responsible || (who[mine[0].by] ?? mine[0].by)}`}
            right={<div className="text-right"><p className="text-[14px] font-bold tabular-nums text-white">{num(hours, 0)}</p><p className="text-[10.5px] text-[#8f99a8]">man-hours</p></div>}>
            {mine.map((s) => (
              <Item key={s.id} code={s.code} selected={sel === s.code} onClick={() => onSel(s.code)}
                title={<span className="flex flex-wrap items-center gap-1.5"><span className="text-[#e5e8eb]">{s.name}</span><span className="rounded bg-white/[.06] px-1.5 text-[10px] text-[#abb3bf]">{KIND_WORD[s.kind] ?? s.kind}</span>{s.critical && <span className="text-[10px] font-semibold text-[#f87171]">critical</span>}{s.hold_point && <span className="text-[10px] font-semibold text-[#ffb4b4]">hold point</span>}</span>}
                meta={<><span className="flex flex-wrap gap-1">{(s.crew as Rec[]).map((c) => <span key={c.role} className="rounded-full bg-white/[.05] px-1.5 py-px text-[10px] text-[#d3d8de]"><b className="font-semibold text-white">{c.count}</b> {c.role}</span>)}{(s.after as string[]).length > 0 && <span className="text-[10px] text-[#8f99a8]">after {(s.after as string[]).join(", ")}</span>}</span><span className="mt-0.5 block text-[10px] text-[#6f7c8b]">{s.basis}</span></>}
                visual={<SizeBar value={s.man_hours || 0} max={max} color={s.critical ? "#f87171" : color} />}
                value={<><span className="block font-semibold">{num(s.man_hours, 0)} mh</span><span className="block text-[10.5px] font-normal text-[#8f99a8]">{num(s.hours, 0)} h on site</span></>} />
            ))}
          </Group>
        );
      })}
    </div>
  );
}

function Start({ busy, onStart, onClose }: { busy: boolean; onStart: () => void; onClose?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={busy} title="Muse reads the documents and writes the plan. This uses API credit." onClick={onStart} className={primary}>{busy ? "Starting…" : "Plan it with Muse"}</button>
      {onClose && <button onClick={onClose} className={quiet}>Cancel</button>}
    </div>
  );
}

export function WorkPlan() {
  const { data, err, act } = useData("/api/project/plans");
  const pack = useData("/api/project/plan-package");
  const cpm = useData("/api/project/critical-path");
  const go = useGo();
  const [pid, setPid] = useState<string | null>(null);
  const [view, setView] = useState("findings");
  const [sel, setSel] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const docs = (pack.data?.documents ?? []) as Rec[];
  const start = async () => {
    setBusy(true); setProblem("");
    try {
      await api("/api/aip/konsultan", pack.data?.scenario === false ? { nama: "Analysis of the documents", versi: "muse", jenis: "package" } : { nama: `${pack.data?.scope.title ?? "Work"}: work plan`, versi: "muse", jenis: "plan" });
      go("analysis");
      window.location.reload();
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const plans = data.plans as Rec[];
  const live = plans.filter((p) => p.status !== "superseded");
  const rec = plans.find((p) => p.id === pid) ?? live[0] ?? plans[0];
  if (!rec) return <div className="flex-1 bg-[#111820]"><Problem err={err || problem} /></div>;
  const plan = rec.plan as Rec, t = plan.totals as Rec, checks = plan.checks as Rec[], flags = plan.waste_flags as Rec[];
  const fromDocs = plan.kind === "package";
  const look = checks.filter((c) => !c.ok);
  const saving = flags.reduce((n, f) => n + (f.saving_rp || 0), 0);
  const steps = [...(plan.steps as Rec[])].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title={`Work plan: ${rec.title}`} note={<span className="inline-flex items-center gap-1.5"><Pill tone={STATUS[rec.status]}>{rec.status === "pending" ? "waiting for you" : rec.status}</Pill>{rec.mode === "mock" && <Pill tone="violet">offline mock: scripted answers</Pill>}{!fromDocs && <span>{(plan.activities as string[]).join(", ")}</span>}</span>}>
          {plans.length > 1 && <select aria-label="Choose a plan" value={rec.id} onChange={(e) => { setPid(e.target.value); setSel(null); }} className="rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-[11px] text-white">{plans.map((p) => <option key={p.id} value={p.id} className="bg-[#1c2733]">{p.id} · {p.status}</option>)}</select>}
          <a href={`${API_URL}/api/project/plans/${rec.id}/procedure.md`} download={`${rec.id}-procedure.md`} className={quiet}>Procedure</a>
          <a href={`${API_URL}/api/project/plans/${rec.id}/table.csv`} download={`${rec.id}-tasks.csv`} className={quiet}>Spreadsheet</a>
          {!(fromDocs && rec.status === "approved") && <button onClick={() => setAgain(!again)} className={quiet}>Plan again</button>}
        </Bar>
        <Problem err={err || problem} />
        {again && <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/5 bg-[#111820] px-4 py-2"><span className="text-[#d3d8de]">A new review reads the package and the records as they stand now, and replaces this plan if it is still waiting{rec.status === "pending" && rec.edits ? `, with the ${rec.edits} change${rec.edits === 1 ? "" : "s"} you made to it` : ""}.</span><Start busy={busy} onStart={start} onClose={() => setAgain(false)} /></div>}
        {rec.status === "pending" && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#fab219]/30 bg-[#fab219]/[.07] px-4 py-2">
            <span className="text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />{fromDocs ? "Read the WBS, the procedures, the cost and the schedule in the tabs above: they are this proposal. Approving puts the tasks on the Kanban board and plans the inspections. Rejecting takes it all away, and the agents remember your reason." : "Nothing has changed yet. Approving puts the tasks on the Kanban board, plans the inspections in QA/QC and requests the material from Procurement."}{look.length ? ` Code has ${look.length} thing${look.length === 1 ? "" : "s"} for you to look at first.` : ""}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your reason, if you reject it" className={`${field} !w-[230px]`} />
            <button onClick={() => act(() => api(`/api/project/plans/${rec.id}/approve`, { note }))} className={good}>Approve the plan</button>
            <button onClick={() => act(() => api(`/api/project/plans/${rec.id}/reject`, { note }))} className={quiet}>Reject</button>
          </div>
        )}
        {rec.status === "approved" && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#29a383]/30 bg-[#29a383]/[.07] px-4 py-1.5 text-[#7ee2c0]">
            <span><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />Approved by {rec.decided_by}, {rec.decided_at}. {(rec.effects as string[]).join(" ")}</span>
            <span className="ml-auto flex gap-1"><button onClick={() => go("procedures")} className={quiet}>Procedures</button><button onClick={() => go("kanban/board")} className={quiet}>The board</button></span>
          </div>
        )}
        {fromDocs ? (
          <Kpis>
            <Kpi label={`${(plan.accounts as Rec[]).length} control accounts`} value={`${(plan.activities as string[]).length} work packages`} />
            <Kpi label={`${t.inspections} of them inspections`} value={`${t.steps} tasks`} />
            <Kpi label={`days, ${t.window_days} in the contract`} value={t.days} tone={t.days > t.window_days ? "bad" : "ok"} />
            <Kpi label="worth, from the priced BoQ" value={money(t.cost)} />
            <Kpi label="to look at" value={look.length} tone={look.length ? "warn" : "ok"} />
            <Kpi label="cost of this analysis" value={rec.mode === "mock" ? "free" : `$${Number(rec.usd ?? 0).toFixed(2)}`} />
          </Kpis>
        ) : <Kpis>
          <Kpi label={`${t.inspections} inspections · ${t.handling} handling`} value={`${t.operations} operations`} />
          <Kpi label="man-hours" value={num(t.man_hours, 0)} hint={`${num(t.oh, 0)} OH`} />
          <Kpi label={`working days, ${t.window_days} in the programme`} value={t.days} tone={t.days > t.window_days ? "bad" : "ok"} />
          <Kpi label={t.programme_crew ? `peak crew, ${t.programme_crew} in the programme` : "peak crew"} value={t.peak_crew} tone={t.programme_crew && t.peak_crew > t.programme_crew ? "warn" : "ok"} />
          <Kpi label="material waste" value={money(t.waste_cost)} tone="warn" hint={saving ? `${money(saving)} could come out` : ""} />
          <Kpi label={`planned cost, BoQ ${money(t.boq_value)}`} value={money(t.cost)} tone={t.margin < 0 ? "warn" : "ok"} />
        </Kpis>}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/5 bg-[#1c2733] px-3 pt-1.5">
          {[["findings", "Findings"], ["tasks", "Tasks"], ["report", "Plan document"]].map(([k, label]) => <button key={k} onClick={() => setView(k)} className={`rounded-t px-2.5 py-1 text-[11.5px] ${view === k ? "bg-[#111820] font-medium text-white" : "text-[#abb3bf] hover:text-white"}`}>{label}{k === "findings" && look.length ? <span className="ml-1 rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{look.length}</span> : null}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
          {view === "tasks" && <TaskCards steps={steps} plan={plan} who={data.who as Rec} sel={sel} onSel={setSel} />}
          {view === "findings" && (
            <div className="space-y-3 p-3">
              <Card title={`What code checked: ${look.length} to look at, ${checks.length - look.length} fine`}>
                {[...look, ...checks.filter((c) => c.ok)].map((c) => <p key={c.rule} className={`flex items-start gap-2 border-t border-white/5 px-3 py-1.5 first:border-t-0 ${c.ok ? "text-[#abb3bf]" : "text-[#e5e8eb]"}`}><Icon name={c.ok ? "check" : "alert"} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${c.ok ? "text-[#7ee2c0]" : "text-[#fbd38d]"}`} /><span><b className="font-medium">{c.ok ? "Fine." : "Look at this."}</b> {c.text}</span></p>)}
              </Card>
              <Card title={fromDocs ? `Where the documents disagree (${(rec.findings as Rec[]).length})` : `What the agents found in the package (${(rec.findings as Rec[]).length})`}>
                {[...new Set((rec.findings as Rec[]).map((f) => f.tag as string))].map((tag) => (
                  <div key={tag} className="flex items-start gap-3 border-t border-white/5 px-3 py-2 first:border-t-0">
                    <span className="w-[130px] shrink-0"><Pill tone="warn">{TAG[tag] ?? tag}</Pill></span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {(rec.findings as Rec[]).filter((f) => f.tag === tag).map((f, i) => (
                        <Fragment key={i}><div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1"><p className="leading-snug text-[#e5e8eb]">{f.note}</p><p className="mt-0.5 text-[10.5px] text-[#8f99a8]">{((f.who ?? f.agents) as string[]).join(", ")} · on {f.subject}</p></div>
                          <span className="flex flex-wrap gap-1">{(f.evidence as string[]).map((e) => <Ref key={e} to={e.startsWith("RFI") ? `documents/rfis:${e}` : `documents/register:${e}`}>{e}</Ref>)}</span>
                        </div>{(f.sources as Rec[] | undefined)?.map((s, j) => <p key={j} className="mt-0.5 leading-snug text-[11px] text-[#abb3bf]">{s.title ?? s.doc}, page {s.page}: “{s.quote}”</p>)}<div>
                        </div></Fragment>
                      ))}
                    </div>
                  </div>
                ))}
                {!(rec.findings as Rec[]).length && <Empty>None.</Empty>}
              </Card>
              {Object.keys(rec.attacks as Rec).length > 0 && <Card title="The red team">
                {Object.values(rec.attacks as Record<string, Rec>).map((a) => <div key={a.view} className="flex items-start gap-3 border-t border-white/5 px-3 py-2 first:border-t-0"><span className="w-[130px] shrink-0"><Pill tone={a.result === "holds" ? "ok" : "warn"}>{a.result === "holds" ? "plan holds" : "plan weakened"}</Pill></span><p className="min-w-0 flex-1 leading-snug text-[#e5e8eb]"><b className="font-medium text-white">As {a.view}:</b> {a.reason}</p></div>)}
              </Card>}
              <Card title={`Questions for the consultant, drafted and not sent (${(rec.rfi_drafts as Rec[]).length})`} right={<button onClick={() => go("documents/rfis")} className={quiet}>Open them</button>}>
                {(rec.rfi_drafts as Rec[]).map((r, i) => <div key={i} className="border-t border-white/5 px-3 py-2 first:border-t-0"><p className="font-medium text-white">{r.subject}</p><p className="leading-snug text-[#d3d8de]">{r.question}</p><p className="text-[10.5px] text-[#8f99a8]">To {r.to}{r.activity ? `, on ${r.activity}` : ""}. A person issues it.</p></div>)}
                {!(rec.rfi_drafts as Rec[]).length && <Empty>None.</Empty>}
              </Card>
              {(rec.work_items as Rec[]).length > 0 && <Card title={`Actions the agents proposed (${(rec.work_items as Rec[]).length})`} right={<button onClick={() => go("kanban/board")} className={quiet}>The board</button>}>
                <div className="divide-y divide-white/[.04]">{(rec.work_items as Rec[]).map((w) => <Item key={w.id} code={w.id} title={<span className="text-white">{w.title}</span>} meta={`${w.why ? `${w.why} · ` : ""}${(w.owner as string).replace(" (fictional)", "")}`} value={<span className="flex items-center justify-end gap-2"><span className="text-[11px] text-[#8f99a8]">due {w.due}</span><Pill tone={STATUS[w.status] ?? "none"}>{w.status}</Pill></span>} />)}</div>
              </Card>}
            </div>
          )}
          {view === "report" && <div className="mx-auto max-w-[1140px] p-4"><WbsReport text={rec.report} plan={plan} onSelect={setSel}
            network={fromDocs && (rec.status === "pending" || rec.status === "approved") && cpm.data ? <CpmNetwork rows={cpm.data.activities as Rec[]} path={cpm.data.path as Rec[]} reasons={linkReasons(plan)} onOpen={setSel} /> : null} /></div>}
        </div>
      </div>
      {sel && <NodePanel key={sel} code={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

const VIEWS: [string, string, string][] = [
  ["tree", "Tree", "The breakdown drawn as a tree, down to the work packages"],
  ["outline", "Outline", "Every level in one table, down to the task, with what is linked to it"],
  ["packages", "Work packages", "The lowest level at which cost and time are planned, with where each stands on the board"],
  ["accounts", "Control accounts", "Where scope, budget and schedule meet, each with one person answering for it"],
  ["dictionary", "Dictionary", "What each piece of the breakdown is, written once"],
];

/** The WBS in one place: one switch for how to look at it, one button to add to it, and what is picked opening beside it in every view. */
export function WbsModule({ sub, target }: { sub: string; target: string }) {
  const { data, err, act } = useData("/api/project/wbs");
  const go = useGo();
  const view = VIEWS.some(([k]) => k === sub) ? sub : "tree";
  const [sel, setSel] = useState<string | null>(target || null);
  const [adding, setAdding] = useState("");
  useEffect(() => { if (target) { setSel(target); setAdding(""); } }, [target]);
  const root = data?.root as Rec | undefined;
  if (!data || !root) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const pick = (code: string) => { setAdding(""); setSel(code); };
  const r = root.roll as Rec, late = (data.milestones as Rec[]).filter((m) => m.days_late);
  const next = (data.milestones as Rec[])[0];
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title={root.name} note={`${String(data.project.contractor ?? "").replace(" (fictional)", "")}${data.project.owner ? ` for ${String(data.project.owner).replace(" (fictional)", "")}` : ""} · today ${data.today}`}>
        <span className="flex rounded-md border border-white/15 bg-black/20 p-0.5" role="tablist" aria-label="View">
          {VIEWS.map(([k, label, hint]) => <button key={k} role="tab" aria-selected={view === k} title={hint} onClick={() => { if (k !== view) { setSel(null); setAdding(""); } go(`wbs/${k}`); }} className={`rounded px-2 py-0.5 text-[11.5px] ${view === k ? "bg-[#f5b82e] font-semibold text-[#171106]" : "text-[#abb3bf] hover:bg-white/[.07] hover:text-white"}`}>{label}</button>)}
        </span>
        <AddMenu data={data} onPick={(kind) => { setSel(null); setAdding(kind); }} />
      </Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label="control accounts · work packages" value={`${(data.packages as Rec[]).length} · ${(data.activities as Rec[]).length}`} />
        <Kpi label="tasks done" value={r.tasks - r.proposed > 0 ? `${r.done} of ${r.tasks - r.proposed}` : "–"} hint={r.proposed ? `${r.proposed} proposed` : ""} />
        <Kpi label="progress" value={`${root.progress}%`} />
        <Kpi label="man-hours planned" value={r.man_hours ? num(r.man_hours, 0) : "–"} />
        {next && <Kpi label={`milestone ${next.id}, due ${short(next.contract_date)}`} value={short(next.forecast)} tone={late.length ? "bad" : "ok"} hint={next.days_late ? `${next.days_late} days late` : "on time"} />}
        <Kpi label="open RFIs · NCRs" value={`${r.rfis} · ${r.ncrs}`} tone={r.ncrs ? "bad" : r.rfis ? "warn" : "ok"} />
      </Kpis>
      {data.plan?.status === "pending" && (
        <button onClick={() => go("review")} className="flex shrink-0 items-center gap-2 border-b border-[#fab219]/30 bg-[#fab219]/[.07] px-4 py-1.5 text-left text-[#fbd38d] hover:bg-[#fab219]/[.12]"><Icon name="alert" className="h-3.5 w-3.5" />Work plan {data.plan.id} is waiting for you: its {r.proposed} tasks reach the board, the schedule and QA/QC when you approve it.<span className="ml-auto whitespace-nowrap underline">Open Review</span></button>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div data-tour="wbs" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {(view === "tree" || view === "outline") && <Tree view={view} data={data} target={target} sel={sel} onSel={pick} />}
          {view === "packages" && <WorkPackages sel={sel} onSel={pick} />}
          {view === "accounts" && <ControlAccounts sel={sel} onSel={pick} />}
          {view === "dictionary" && <Dictionary />}
        </div>
        {adding ? <Adder key={adding} kind={adding} data={data} act={act} onClose={() => setAdding("")} />
          : sel && view !== "dictionary" ? <NodePanel key={sel} code={sel} onClose={() => { setSel(null); if (target) go(`wbs/${view}`); }} onMoved={(code) => { if (target) go(`wbs/${view}:${code}`); else setSel(code); }} /> : null}
      </div>
    </div>
  );
}
