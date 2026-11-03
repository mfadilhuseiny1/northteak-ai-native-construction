"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, clean, Empty, field, good, inFocus, Label, Loading, Pill, primary, Problem, quiet, Ref, Side, useData, useFocus, useGo, type Rec, type Tone } from "./kit";
import { NodePanel } from "./NodePanel";
import { DailyReportsView } from "./RecordsViews";

/* Module 4, Kanban: who is doing the work today, and what is stopping them? The cards are the work plan's tasks and the actions people agree, and an activity nobody has broken down yet is one card. Moving a card moves the schedule. A rule can refuse a move, and says why: a hold point stops what follows it, and only QA/QC closes an inspection. */

const COLUMNS: [string, string][] = [["proposed", "Proposed"], ["open", "To do"], ["doing", "In progress"], ["review", "In review"], ["done", "Done"]];
const LEVEL: Record<string, Tone> = { high: "bad", medium: "warn", low: "none" };
const KIND: Record<string, string> = { operation: "O", inspection: "I", handling: "H" };
const DOT: Record<string, string> = { proposed: "#c084fc", open: "#8f99a8", doing: "#3987e5", review: "#fab219", done: "#29a383" };
const CONTROL = "rounded border border-white/15 bg-black/20 px-2 py-1 text-[12.5px] text-white";
const ACTION = "!px-2.5 !py-1 !text-[12.5px]";

/** A date as a person says it, with the year only when it is not this one. */
function when(d: string, today: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) });
}

function Card({ c, names, today, on, dim, onOpen, onDragStart }: { c: Rec; names: Record<string, string>; today: string; on: boolean; dim: boolean; onOpen: () => void; onDragStart: () => void }) {
  const soft = (c.blockers as Rec[]).filter((b) => !b.stop);
  const hard = (c.blockers as Rec[]).filter((b) => b.stop);
  const frozen = c.status === "proposed";
  const say = (b: Rec) => (b.kind === "activity" && names[b.ref] ? `Waits for ${names[b.ref]}` : b.text);  // the work's name: an id says nothing on a card
  return (
    <button draggable={!frozen} onDragStart={onDragStart} onClick={onOpen} title={frozen ? "A proposal: it opens when its plan is approved" : "Drag to another column, or open it"}
      className={`block w-full rounded-md border bg-[#232a33] px-3 py-2.5 text-left transition-opacity ${on ? "border-white" : c.stopped ? "border-[#e5484d]/70" : c.overdue ? "border-[#fab219]/70" : "border-white/10 hover:border-white/30"} ${dim ? "opacity-30" : ""} ${frozen ? "cursor-default border-dashed" : "cursor-grab active:cursor-grabbing"}`}>
      <span className="flex items-center gap-1.5 text-[11.5px] text-[#8f99a8]">
        {KIND[c.kind] && <span className={`flex h-4 w-4 shrink-0 items-center justify-center text-[9.5px] font-bold text-[#d3d8de] ${c.kind === "inspection" ? `rounded-[2px] border ${c.hold_point ? "border-[#e5484d]" : "border-[#abb3bf]"}` : c.kind === "operation" ? "rounded-full border border-[#abb3bf]" : ""}`}>{KIND[c.kind]}</span>}
        <span className="truncate font-mono">{c.wbs || c.id}</span>
        {c.step && <span className="shrink-0">{c.step}</span>}
        {c.critical && <span className="ml-auto shrink-0 rounded-full bg-[#fab219]/15 px-2 py-px text-[11px] text-[#fbd38d]">critical</span>}
      </span>
      <span className="mt-1 block text-[14px] font-medium leading-snug text-white">{c.title}</span>
      {c.status === "doing" && c.progress > 0 && <span className="mt-2 flex items-center gap-2"><span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-[#29a383]" style={{ width: `${c.progress}%` }} /></span><span className="shrink-0 text-[12px] tabular-nums text-[#d3d8de]">{c.progress}%</span></span>}
      <span className="mt-2 flex items-center gap-2 text-[12px] text-[#abb3bf]">
        {c.owner && <span className="min-w-0 truncate" title={clean(c.owner)}>{clean(c.owner)}</span>}
        {c.due && <span className={`ml-auto shrink-0 tabular-nums ${c.overdue ? "font-medium text-[#ffb4b4]" : ""}`}>{when(c.due, today)}</span>}
      </span>
      {hard.length > 0 && <span className="mt-1.5 flex items-start gap-1.5 text-[12px] font-medium leading-snug text-[#ffb4b4]"><Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2">Stopped: {say(hard[0])}</span></span>}
      {!hard.length && soft.length > 0 && <span className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-[#fbd38d]"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2">{say(soft[0])}{soft.length > 1 ? ` +${soft.length - 1}` : ""}</span></span>}
    </button>
  );
}

function CardPanel({ c, owners, onMove, onDetail, act, onClose }: { c: Rec; owners: string[]; onMove: (status: string) => void; onDetail?: () => void; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void }) {
  const go = useGo();
  const [f, setF] = useState({ owner: c.owner ?? "", due: c.due ?? "", progress: String(c.progress ?? 0) });
  useEffect(() => setF({ owner: c.owner ?? "", due: c.due ?? "", progress: String(c.progress ?? 0) }), [c.id, c.owner, c.due, c.progress]);
  const frozen = c.status === "proposed";
  const isActivity = c.type === "activity";
  return (
    <Side eyebrow={`${c.wbs ? `${c.wbs} · ` : ""}${c.id}`} title={c.title} onClose={onClose}>
      <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap gap-1">
        {c.critical && <Pill tone="warn">critical</Pill>}{c.hold_point && <Pill tone="bad">hold point {c.itp}</Pill>}{c.overdue && <Pill tone="bad">overdue</Pill>}
        <Pill>{isActivity ? "work package, not broken down yet" : c.physical ? "task" : "action"}</Pill>{c.proposed_by && <Pill>{c.proposed_by}</Pill>}
      </div>
      {c.why && <p className="leading-snug text-[#d3d8de]">{c.why}</p>}
      {onDetail && <button onClick={onDetail} className={`${quiet} w-full`}>Procedure, material, and record what it really took</button>}
      {(c.blockers as Rec[]).length > 0 && (
        <div className="space-y-1">
          <Label>What is holding it</Label>
          {(c.blockers as Rec[]).map((b, i) => <button key={i} onClick={() => go(b.go)} className={`flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left hover:brightness-125 ${b.stop ? "bg-[#e5484d]/15 text-[#ffb4b4]" : "bg-[#fab219]/10 text-[#fbd38d]"}`}><Icon name={b.stop ? "lock" : "alert"} className="mt-0.5 h-3 w-3 shrink-0" /><span className="leading-snug">{b.text}</span></button>)}
        </div>
      )}
      {frozen ? <p className="rounded bg-[#c084fc]/10 p-2 text-[#e9d5ff]">A proposal. It opens when the plan it belongs to is approved. <button onClick={() => go(c.decision?.startsWith("DEC") ? "tower/decisions" : "wbs/plan")} className="underline">Decide</button></p> : (
        <>
          <div><Label>Move it</Label><div className="mt-1 flex flex-wrap gap-1">{COLUMNS.filter(([k]) => k !== "proposed").map(([k, label]) => <button key={k} disabled={c.status === k} onClick={() => onMove(k)} className={c.status === k ? `${quiet} ${ACTION} !bg-white/15 !text-white` : `${quiet} ${ACTION}`}>{label}</button>)}</div></div>
          {c.kind === "inspection" && c.itp && <button onClick={() => go(`quality/inspections:${c.itp}`)} className={`${good} w-full`}>Record the result in QA/QC</button>}
          {!isActivity && (
            <div className="space-y-1.5">
              <label className="block"><Label>Assigned to</Label><input list="board-owners" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} className={field} /><datalist id="board-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist></label>
              <div className="grid grid-cols-2 gap-2">
                <label><Label>Due</Label><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className={field} /></label>
                <label><Label>Progress %</Label><input type="number" min={0} max={100} value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value })} className={field} /></label>
              </div>
              <button onClick={() => act(() => api(`/api/project/work-items/${c.id}`, { owner: f.owner !== c.owner ? f.owner : null, due: f.due !== c.due ? f.due : null, progress: Number(f.progress) !== c.progress ? Number(f.progress) : null }))} className={`${primary} w-full`}>Save</button>
              {c.start && <p className="text-[10.5px] text-[#8f99a8]">Planned to start {c.start}. Its dates follow the schedule, unless you set one here.</p>}
            </div>
          )}
          {isActivity && <p className="text-[11px] text-[#abb3bf]">Moving this card sets the work package&apos;s progress in the schedule. Once it has tasks, they take over.</p>}
        </>
      )}
      {c.activity && <p className="text-[#d3d8de]"><Ref to={`schedule/gantt:${c.activity}`}>{c.activity}</Ref> {c.activity_name}</p>}
      </div>
    </Side>
  );
}

function Progress({ k, cards, proposed, bottlenecks, today, activities }: { k: Rec; cards: Rec[]; proposed: number; bottlenecks: number; today: string; activities: Rec[] }) {
  const live = k.open + k.doing + k.review + k.done;
  const pct = (n: number) => (live ? Math.round((n / live) * 100) : 0);
  const donePct = pct(k.done);
  const seg = [
    { label: "Done", n: k.done, color: "#29a383" },
    { label: "In progress", n: k.doing, color: "#3987e5" },
    { label: "In review", n: k.review, color: "#fab219" },
    { label: "To do", n: k.open, color: "rgba(255,255,255,.16)" },
  ];
  const day = (plus: number) => { const d = new Date(`${today}T00:00:00`); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };
  const dueSoon = cards.filter((c) => c.status !== "done" && c.due && c.due >= today && c.due <= day(7)).length;
  const owners = [...cards.reduce((m, c) => {
    const name = clean(c.owner || "") || "Unassigned";
    const o = m.get(name) ?? { name, open: 0, doing: 0, review: 0, done: 0 };
    o[c.status as string] = (o[c.status as string] ?? 0) + 1;
    return m.set(name, o);
  }, new Map<string, Rec>()).values()].map((o) => ({ ...o, active: o.open + o.doing + o.review, total: o.open + o.doing + o.review + o.done })).sort((a, b) => b.active - a.active || b.total - a.total).slice(0, 5);
  const days14 = Array.from({ length: 14 }, (_, i) => day(i - 13));
  const done14 = days14.map((d) => cards.filter((c) => c.status === "done" && c.done_on === d).length);
  const done7 = done14.slice(7).reduce((a, b) => a + b, 0);
  const maxDay = Math.max(1, ...done14);
  const stats: [string, number, string][] = [
    ["Overdue", k.overdue, "#ffb4b4"], ["Stopped by a rule", k.stopped, "#ffb4b4"], ["Proposed, not yet on the board", proposed, "#d9d3ff"],
    ["Bottlenecks found by code", bottlenecks, "#fbd38d"], ["Due in the next 7 days", dueSoon, "#fbd38d"], ["Done in the last 7 days", done7, "#7ee2c0"],
  ];
  const ring = 2 * Math.PI * 34;
  return (
    <div className="shrink-0 border-b border-white/10 bg-[#1c2127] px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="relative block h-[84px] w-[84px] shrink-0">
            <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
              <circle cx="42" cy="42" r="34" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="8" />
              <circle cx="42" cy="42" r="34" fill="none" stroke="#29a383" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(donePct / 100) * ring} ${ring}`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[17px] font-semibold text-white">{donePct}%</span>
          </span>
          <span>
            <span className="block text-[10px] uppercase tracking-wide text-[#8f99a8]">Project progress</span>
            <span className="block text-[12px] text-[#d3d8de]">{k.done} of {live} cards done</span>
            <span className="block text-[11px] text-[#8f99a8]">{k.doing + k.review} under way · {k.open} not started</span>
          </span>
        </div>
        <div className="min-w-[240px] flex-1">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/30" role="img" aria-label={`Done ${donePct} percent, in progress ${pct(k.doing)} percent, in review ${pct(k.review)} percent, to do ${pct(k.open)} percent`}>
            {seg.map((s) => <span key={s.label} style={{ width: `${live ? (s.n / live) * 100 : 0}%`, background: s.color }} />)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {seg.map((s) => <span key={s.label} className="flex items-center gap-1 text-[10.5px] text-[#abb3bf]"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />{s.label} {pct(s.n)}% · {s.n}</span>)}
          </div>
          {owners.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-[#8f99a8]">Workload by owner</p>
              {owners.map((o) => (
                <div key={o.name} className="flex items-center gap-2">
                  <span className="w-[118px] shrink-0 truncate text-[10.5px] text-[#abb3bf]">{o.name}</span>
                  <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-black/30">
                    <span style={{ width: `${o.total ? (o.done / o.total) * 100 : 0}%`, background: "#29a383" }} /><span style={{ width: `${o.total ? (o.doing / o.total) * 100 : 0}%`, background: "#3987e5" }} /><span style={{ width: `${o.total ? (o.review / o.total) * 100 : 0}%`, background: "#fab219" }} /><span style={{ width: `${o.total ? (o.open / o.total) * 100 : 0}%`, background: "rgba(255,255,255,.16)" }} />
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-[#abb3bf]">{o.doing + o.review} doing · {o.open} to do · {o.done} done</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid w-[248px] shrink-0 grid-cols-2 gap-1.5">
          {stats.map(([label, n, color]) => (
            <div key={label} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
              <p className="text-[15px] font-semibold leading-none" style={{ color: n ? color : "#fff" }}>{n}</p>
              <p className="mt-1 text-[9.5px] leading-tight text-[#8f99a8]">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/5 pt-2.5">
        {activities.length > 0 && (
          <div className="min-w-[280px] flex-1">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[#8f99a8]">Progress by activity</p>
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 max-lg:grid-cols-1">
              {[...activities].sort((a, b) => (b.progress > 0 && b.progress < 100 ? 1 : 0) - (a.progress > 0 && a.progress < 100 ? 1 : 0) || b.progress - a.progress).slice(0, 8).map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span className="w-[168px] shrink-0 truncate text-[10.5px] text-[#abb3bf]">{a.code} {clean(a.name)}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/30"><span className="block h-full rounded-full" style={{ width: `${a.progress}%`, background: a.progress >= 100 ? "#29a383" : "#3987e5" }} /></span>
                  <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-white">{a.progress}%</span>
                </div>
              ))}
            </div>
            {activities.length > 8 && <p className="mt-1 text-[10.5px] text-[#8f99a8]">The eight furthest along or under way, of {activities.length}. All of them are in AI Scheduling.</p>}
          </div>
        )}
        <div className="w-[218px] shrink-0">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[#8f99a8]">Completed, last 14 days</p>
          <div className="flex h-10 items-end gap-[3px]" role="img" aria-label={`${done14.reduce((a, b) => a + b, 0)} cards completed in the last 14 days`}>
            {done14.map((n, i) => <span key={days14[i]} title={`${days14[i]}: ${n} done`} className="min-w-0 flex-1 rounded-t-sm" style={{ height: `${n ? Math.max(14, (n / maxDay) * 100) : 4}%`, background: n ? "#29a383" : "rgba(255,255,255,.12)" }} />)}
          </div>
          <p className="mt-1 text-[10.5px] text-[#8f99a8]">{done14.reduce((a, b) => a + b, 0)} done in 14 days · {done7} this week</p>
        </div>
      </div>
    </div>
  );
}

/** How the board stands, on one line, so that the cards get the screen. What needs attention shows only when there is some, and filters the board. The detail opens on request. */
function Summary({ k, only, setOnly, open, onToggle }: { k: Rec; only: string; setOnly: (v: string) => void; open: boolean; onToggle: () => void }) {
  const live = k.open + k.doing + k.review + k.done;
  const flag = (key: string, n: number, label: string) => n > 0 && <button onClick={() => setOnly(only === key ? "" : key)} aria-pressed={only === key} className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${only === key ? "bg-[#e5484d] text-white" : "bg-[#e5484d]/15 text-[#ffb4b4] hover:bg-[#e5484d]/25"}`}>{n} {label}</button>;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/5 bg-[#161a1f] px-4 py-2">
      <span className="shrink-0 text-[13px] text-[#d3d8de]"><b className="font-semibold tabular-nums text-white">{k.done} of {live}</b> done</span>
      <span className="flex h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${k.done} done, ${k.doing} in progress, ${k.review} in review, ${k.open} to do`}>
        {([["done", k.done], ["doing", k.doing], ["review", k.review]] as [string, number][]).map(([key, n]) => <span key={key} style={{ width: `${live ? (n / live) * 100 : 0}%`, background: DOT[key] }} />)}
      </span>
      {flag("stopped", k.stopped, "stopped")}{flag("overdue", k.overdue, "overdue")}
      <button onClick={onToggle} aria-expanded={open} className={`${quiet} ${ACTION} flex shrink-0 items-center gap-1`}><Icon name={open ? "down" : "right"} className="h-3 w-3" />Progress details</button>
    </div>
  );
}

function Board({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/board");
  const { focus } = useFocus();
  const go = useGo();
  const [sel, setSel] = useState<string | null>(target || null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState("");
  const [owner, setOwner] = useState("");
  const [only, setOnly] = useState("");
  const [cause, setCause] = useState<Rec | null>(null);
  const [form, setForm] = useState<Rec | null>(null);
  const [causesOpen, setCausesOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [detail, setDetail] = useState(false);
  const activities = useData("/api/project/daily-reports");
  const sched = useData("/api/project/schedule");
  useEffect(() => { if (target) { setSel(target); setForm(null); } }, [target]);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const all = data.cards as Rec[];
  const scoped = all.filter((c) => inFocus(focus, { activity: c.activity, package: c.package }) && c.status !== "proposed");
  const k = { open: scoped.filter((c) => c.status === "open").length, doing: scoped.filter((c) => c.status === "doing").length, review: scoped.filter((c) => c.status === "review").length, done: scoped.filter((c) => c.status === "done").length, stopped: scoped.filter((c) => c.stopped).length, overdue: scoped.filter((c) => c.overdue).length };
  const order = (c: Rec) => `${c.start || c.due || "9"} ${String(c.wbs).split(".").map((n: string) => n.padStart(3, "0")).join(".")}`;
  const cards = all.filter((c) => inFocus(focus, { activity: c.activity, package: c.package }) && (!owner || c.owner === owner) && (only !== "stopped" || c.stopped) && (only !== "critical" || c.critical) && (only !== "overdue" || c.overdue)).sort((a, b) => order(a).localeCompare(order(b)));
  const open = all.find((c) => c.id === sel);
  const move = (c: Rec, status: string) => { if (c.status !== status && c.status !== "proposed" && status !== "proposed") void act(() => c.type === "activity" ? api(`/api/project/board/activity/${c.id}`, { status }) : api(`/api/project/work-items/${c.id}`, { status })); };
  const causes = (data.bottlenecks as Rec[]).filter((b) => !focus || focus.type === "project" || (b.cards as string[]).some((id) => cards.some((c) => c.id === id)));
  const lit = cause ? new Set(cause.cards as string[]) : null;
  const names: Record<string, string> = Object.fromEntries(all.map((c) => [c.id, c.title]));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12.5px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Task board" note={data.plan ? `tasks of ${data.plan.id}, ${data.plan.title}, and the programme around it` : "the programme, until a work plan breaks it down"}>
          <select aria-label="Show one person's cards" value={owner} onChange={(e) => setOwner(e.target.value)} className={`${CONTROL} max-w-[220px]`}><option value="" className="bg-[#1c2127]">Everyone</option>{(data.owners as string[]).map((o) => <option key={o} value={o} className="bg-[#1c2127]">{clean(o)}</option>)}</select>
          <select aria-label="Show only" value={only} onChange={(e) => setOnly(e.target.value)} className={CONTROL}><option value="" className="bg-[#1c2127]">All cards</option><option value="stopped" className="bg-[#1c2127]">Stopped</option><option value="critical" className="bg-[#1c2127]">Critical</option><option value="overdue" className="bg-[#1c2127]">Overdue</option></select>
          <button onClick={() => { setSel(null); setForm({ title: "", owner: "", due: "", activity: focus?.activities[0] ?? "" }); }} className={`${primary} ${ACTION}`}>Add a card</button>
        </Bar>
        <Problem err={err} />
        <Summary k={k} only={only} setOnly={setOnly} open={details} onToggle={() => setDetails(!details)} />
        {details && <div className="max-h-[45vh] shrink-0 overflow-y-auto"><Progress k={k} cards={scoped} proposed={all.filter((c) => c.status === "proposed" && inFocus(focus, { activity: c.activity, package: c.package })).length} bottlenecks={causes.length} today={data.today} activities={((sched.data?.activities ?? []) as Rec[]).filter((a) => inFocus(focus, { activity: a.id }))} /></div>}
        {data.waiting && <button onClick={() => go("wbs/plan")} className="flex shrink-0 items-center gap-2 border-b border-[#fab219]/30 bg-[#fab219]/[.07] px-4 py-1.5 text-left text-[#fbd38d] hover:bg-[#fab219]/[.12]"><Icon name="alert" className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 truncate">Work plan {data.waiting.id} is waiting: approve it to put its {data.waiting.tasks} tasks here.</span><span className="ml-auto shrink-0 underline">Decide</span></button>}
        {causes.length > 0 && (
          <div className="shrink-0 border-b border-white/5 bg-[#161a1f] px-4 py-1">
            {(causesOpen ? causes.slice(0, 8) : causes.slice(0, 1)).map((b) => (
              <div key={b.kind + b.ref} className={`flex items-center gap-2 rounded py-0.5 ${cause?.ref === b.ref ? "bg-white/10" : ""}`}>
                <Pill tone={b.stop ? "bad" : LEVEL[b.level]}>{b.stop ? "stops work" : "bottleneck"}</Pill>
                <button onClick={() => setCause(cause?.ref === b.ref ? null : b)} title="Light up the cards it holds" className="min-w-0 flex-1 truncate text-left text-[#d3d8de] hover:text-white">{b.text}</button>
                <span className="shrink-0 tabular-nums text-[#abb3bf]">holds {b.held}{b.critical ? `, ${b.critical} critical` : ""}</span>
                <button onClick={() => go(b.go)} className={quiet}>Open</button>
              </div>
            ))}
            {(causes.length > 1 || cause) && <div className="flex items-center gap-2 pb-0.5">
              {causes.length > 1 && <button onClick={() => setCausesOpen(!causesOpen)} aria-expanded={causesOpen} className="text-[12px] text-[#9cc7f5] hover:underline">{causesOpen ? "Show fewer" : `${causes.length - 1} more bottleneck${causes.length > 2 ? "s" : ""}`}</button>}
              {cause && <button onClick={() => setCause(null)} className={`${quiet} ml-auto`}>Show every card</button>}
            </div>}
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-[#161a1f] p-3">
          {COLUMNS.filter(([key]) => key !== "proposed" || cards.some((c) => c.status === "proposed")).map(([key, label]) => {
            const mine = cards.filter((c) => c.status === key);
            return (
              <div key={key} onDragOver={(e) => { if (key !== "proposed") { e.preventDefault(); setOver(key); } }} onDragLeave={() => setOver("")}
                onDrop={(e) => { e.preventDefault(); setOver(""); const c = all.find((x) => x.id === drag); if (c) move(c, key); setDrag(null); }}
                className={`flex min-h-0 min-w-[270px] flex-1 basis-0 flex-col rounded-lg border ${over === key ? "border-[#9d8cff] bg-[#9d8cff]/10" : "border-white/5 bg-[#1c2127]"}`}>
                <p className="flex shrink-0 items-center gap-2 px-3 py-2.5 text-[13.5px] font-semibold text-white"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[key] }} />{label}<span className="ml-auto rounded-full bg-white/10 px-2 text-[12px] font-normal tabular-nums text-[#c5cbd3]">{mine.length}</span></p>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {mine.map((c) => <Card key={c.id} c={c} names={names} today={data.today} on={sel === c.id} dim={!!lit && !lit.has(c.id)} onOpen={() => { setForm(null); setDetail(false); setSel(c.id); }} onDragStart={() => setDrag(c.id)} />)}
                  {!mine.length && <p className="p-4 text-center text-[12.5px] text-[#6b7480]">Drop a card here</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {form && (
        <Side title="Add a card" onClose={() => setForm(null)}>
          <label className="block"><Label>What must be done</Label><input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} /></label>
          <label className="block"><Label>Who</Label><input list="board-owners-new" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} className={field} /><datalist id="board-owners-new">{(data.owners as string[]).map((o) => <option key={o} value={o} />)}</datalist></label>
          <label className="block"><Label>Due</Label><input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className={field} /></label>
          <label className="block"><Label>On which work package</Label><select value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2127]">None: an action, not site work</option>{((activities.data?.activities ?? []) as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2127]">{a.id} {a.name}</option>)}</select></label>
          {form.activity && <p className="text-[11px] text-[#abb3bf]">It counts as site work on that work package, and its progress reaches the schedule.</p>}
          <button disabled={!form.title.trim() || !form.owner.trim()} onClick={async () => { if (await act(() => api("/api/project/work-items", { ...form, physical: !!form.activity }))) setForm(null); }} className={`${primary} w-full`}>Add it to the board</button>
        </Side>
      )}
      {open && !form && (detail && open.wbs ? <NodePanel key={open.wbs} code={open.wbs} onClose={() => setDetail(false)} /> : <CardPanel c={open} owners={data.owners} onMove={(s) => move(open, s)} onDetail={open.step ? () => setDetail(true) : undefined} act={act} onClose={() => { setSel(null); if (target) go("kanban/board"); }} />)}
      {sel && !open && !form && <Side title={sel} onClose={() => setSel(null)}><Empty>This card is not on the board.</Empty></Side>}
    </div>
  );
}

export function KanbanModule({ sub, target }: { sub: string; target: string }) {
  const tab = sub === "daily" ? "daily" : "board";
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {tab === "board" ? <Board target={target} /> : <DailyReportsView />}
    </div>
  );
}
