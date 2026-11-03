"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, Card, clean, Empty, field, inFocus, Kpi, Kpis, Label, Loading, num, Pill, primary, Problem, quiet, Ref, short, Side, Table, td, tr, useData, useFocus, useGo, type Rec } from "./kit";
import { NetworkSheet } from "./NetworkSheet";
import { NodePanel } from "./NodePanel";

/* Module 2, AI Scheduling: when should the work happen? Code works out every date, the float and the critical path from the dependencies, and detects what is late. The thin bar is the baseline, so a move shows at a glance, and tasks from the work plan sit under their activity. */

const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;
const LEVEL: Record<string, "bad" | "warn"> = { high: "bad", medium: "warn" };

function Gantt({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/schedule");
  const { focus } = useFocus();
  const go = useGo();
  const [sel, setSel] = useState<string | null>(target || null);
  const [task, setTask] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ progress: "", duration: "" });
  const [showDelays, setShowDelays] = useState(true);
  useEffect(() => { if (target) { setSel(target); setTask(null); } }, [target]);
  const acts = (data?.activities ?? []) as Rec[];
  const current = acts.find((a) => a.id === sel);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form follows the activity picked
    if (current) setForm({ progress: String(current.progress), duration: String(current.duration) });
  }, [sel, current?.progress, current?.duration]); // eslint-disable-line react-hooks/exhaustive-deps -- only when another activity is picked or its figures move
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const milestones = data.milestones as Rec[];
  const shown = acts.filter((a) => inFocus(focus, { activity: a.id }));
  const delays = (data.delays as Rec[]).filter((d) => inFocus(focus, { activity: d.activity }));
  const all = shown.flatMap((a) => [a.start, a.finish, a.baseline_start, a.baseline_finish, ...(a.tasks as Rec[]).flatMap((t) => [t.start, t.finish])]).concat(milestones.map((m) => m.contract_date), data.today);
  const first = all.length ? Math.min(...all.map(dayOf)) : dayOf(data.today), last = (all.length ? Math.max(...all.map(dayOf)) : dayOf(data.today)) + 1;
  const span = last - first + 1;
  const left = (d: string) => ((dayOf(d) - first) / span) * 100;
  const width = (a: string, b: string) => ((dayOf(b) - dayOf(a) + 1) / span) * 100;
  const days = Array.from({ length: span }, (_, i) => new Date((first + i) * 86400000).toISOString().slice(0, 10));
  const moved = acts.filter((a) => a.start !== a.baseline_start || a.finish !== a.baseline_finish).length;
  const m = milestones[0];
  const toggle = (id: string) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next); };
  const lines = (
    <>
      {days.map((d, i) => d === data.today ? <span key={d} className="absolute inset-y-0 w-px bg-[#9d8cff]/60" style={{ left: `${(i / span) * 100}%` }} /> : null)}
      {milestones.map((x) => <span key={x.id} className="absolute inset-y-0 w-px bg-[#fab219]/50" style={{ left: `${left(x.contract_date) + 100 / span}%` }} title={`Milestone ${x.id} due`} />)}
    </>
  );
  const change = (body: Rec) => act(() => api(`/api/project/schedule/${current?.id}`, body));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Gantt chart" note={`dates worked out by code · today ${data.today}`} />
        <Problem err={err} />
        <Kpis>
          {m && <Kpi label={`milestone ${m.id}, due ${short(m.contract_date)}`} value={short(m.forecast)} tone={m.days_late ? "bad" : "ok"} hint={m.days_late ? `${m.days_late} days late` : "on time"} />}
          <Kpi label="work packages with no float" value={acts.filter((a) => a.critical).length} />
          <Kpi label="moved from baseline" value={moved} tone={moved ? "warn" : undefined} />
          <Kpi label="delays and threats found" value={(data.delays as Rec[]).length} tone={(data.delays as Rec[]).some((d) => d.level === "high") ? "bad" : (data.delays as Rec[]).length ? "warn" : "ok"} />
          {data.plan && <Kpi label={`tasks from ${data.plan.id}, ${data.plan.status}`} value={acts.reduce((n, a) => n + (a.tasks as Rec[]).length, 0)} />}
        </Kpis>
        {delays.length > 0 && (
          <div className="shrink-0 border-b border-white/5 bg-[#161a1f] px-3 py-1.5">
            <button onClick={() => setShowDelays(!showDelays)} aria-expanded={showDelays} className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-[#8f99a8] hover:text-white"><Icon name={showDelays ? "down" : "right"} className="h-3 w-3" />Delays and threats, found by code ({delays.length})</button>
            {showDelays && <div className="mt-1 max-h-[110px] space-y-0.5 overflow-y-auto">{delays.map((d, i) => <button key={i} onClick={() => { setSel(d.activity); setTask(null); }} className="flex w-full items-center gap-2 rounded px-1 text-left hover:bg-white/5"><Pill tone={LEVEL[d.level]}>{d.kind}</Pill><span className="min-w-0 flex-1 truncate text-[#d3d8de]">{d.text}</span></button>)}</div>}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
          {!shown.length ? <Empty>No work packages yet. They come from the AI analysis of the documents.</Empty> : (
            <div className="min-w-[980px]">
              <div className="sticky top-0 z-[2] flex border-b border-white/10 bg-[#1c2127]">
                <div className="w-[320px] shrink-0 px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[#8f99a8]">Work package</div>
                <div className="relative h-7 flex-1">
                  {span > 62
                    ? days.map((d, i) => d.endsWith("-01") || !i ? <span key={d} className="absolute top-1.5 whitespace-nowrap border-l border-white/20 pl-1 text-[10px] text-[#abb3bf]" style={{ left: `${(i / span) * 100}%` }}>{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}{d.slice(5, 7) === "01" || !i ? ` ${d.slice(0, 4)}` : ""}</span> : null)
                    : days.map((d, i) => <span key={d} className={`absolute top-1.5 text-center text-[9.5px] tabular-nums ${d === data.today ? "font-semibold text-white" : "text-[#8f99a8]"}`} style={{ left: `${(i / span) * 100}%`, width: `${100 / span}%` }}>{span > 45 && i % 3 ? "" : d.slice(8)}</span>)}
                </div>
              </div>
              {shown.map((a) => {
                const tasks = a.tasks as Rec[];
                const isOpen = open.has(a.id);
                return (
                  <div key={a.id}>
                    <div onClick={() => { setSel(a.id); setTask(null); }} className={`flex w-full cursor-pointer border-b border-white/5 text-left hover:bg-white/[.03] ${sel === a.id ? "bg-white/[.06]" : ""}`}>
                      <div className="flex w-[320px] shrink-0 items-start gap-1 px-2 py-1.5">
                        {tasks.length ? <button onClick={(e) => { e.stopPropagation(); toggle(a.id); }} aria-label={isOpen ? "Hide its tasks" : "Show its tasks"} aria-expanded={isOpen} className="mt-0.5 rounded p-0.5 text-[#abb3bf] hover:bg-white/10"><Icon name={isOpen ? "down" : "right"} className="h-3 w-3" /></button> : <span className="w-4 shrink-0" />}
                        <div className="min-w-0">
                          <p className="truncate text-[#e5e8eb]"><span className="mr-1.5 font-mono text-[10.5px] text-[#8f99a8]">{a.code || a.id}</span>{a.name}</p>
                          <p className="truncate text-[10.5px] text-[#8f99a8]">{clean(a.by_name)} · {a.duration} day{a.duration === 1 ? "" : "s"} {a.critical || a.float_days ? ` · float ${a.float_days}` : ""}{tasks.length ? ` · ${tasks.length} tasks` : ""}</p>
                        </div>
                      </div>
                      <div className="relative min-h-[42px] flex-1">
                        {lines}
                        <span className="absolute top-[30px] h-[3px] rounded-full bg-[#738091]" style={{ left: `${left(a.baseline_start)}%`, width: `${width(a.baseline_start, a.baseline_finish)}%` }} title={`Baseline ${a.baseline_start} to ${a.baseline_finish}`} />
                        <span className={`absolute top-[9px] flex h-[18px] items-center overflow-hidden rounded-sm ${a.critical ? "bg-[#e5484d]/80" : "bg-[#3987e5]/70"}`} style={{ left: `${left(a.start)}%`, width: `${width(a.start, a.finish)}%` }} title={`${a.start} to ${a.finish}`}><span className="h-full bg-[#29a383]" style={{ width: `${a.progress}%` }} /></span>
                        {milestones.filter((x) => x.activity === a.id).map((x) => <span key={x.id} className="absolute top-[11px] z-[1] text-[12px] leading-none text-[#fab219]" style={{ left: `calc(${left(x.forecast) + 100 / span}% - 5px)` }} title={`Milestone ${x.id}: ${x.name}`}>◆</span>)}
                        {(a.rfis.length + a.ncrs.length + a.pos.length > 0) && <span className="absolute top-[11px] rounded bg-black/60 px-1 text-[9px] text-[#fbd38d]" style={{ left: `${left(a.finish) + 100 / span + 0.3}%` }}>{a.rfis.length + a.ncrs.length + a.pos.length} open</span>}
                      </div>
                    </div>
                    {isOpen && tasks.map((t) => (
                      <div key={t.id} onClick={() => { setTask(t.code); setSel(null); }} className={`flex w-full cursor-pointer border-b border-white/[.03] text-left hover:bg-white/[.03] ${task === t.code ? "bg-white/[.06]" : ""}`}>
                        <div className="w-[320px] shrink-0 truncate py-0.5 pl-8 pr-3 text-[11px] text-[#d3d8de]"><span className="mr-1.5 text-[10px] tabular-nums text-[#8f99a8]">{t.id}</span>{t.name}{t.hold_point && <span className="ml-1 text-[10px] text-[#ffb4b4]">hold</span>}</div>
                        <div className="relative h-[22px] flex-1">
                          {lines}
                          <span className={`absolute top-[6px] h-[10px] overflow-hidden rounded-sm ${t.status === "proposed" ? "border border-dashed border-[#c084fc]/70" : t.stopped ? "bg-[#e5484d]/60" : t.critical ? "bg-[#fab219]/70" : "bg-[#3987e5]/50"}`} style={{ left: `${left(t.start)}%`, width: `${width(t.start, t.finish)}%` }} title={`${t.start} to ${t.finish}. Waits for: ${(t.after as string[]).join(", ") || "nothing"}`}><span className="block h-full bg-[#29a383]" style={{ width: `${t.status === "done" ? 100 : t.progress}%` }} /></span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-3 px-3 py-2 text-[10.5px] text-[#8f99a8]">
                <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-sm bg-[#e5484d]/80" />critical</span>
                <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-sm bg-[#3987e5]/70" />has float</span>
                <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-sm bg-[#29a383]" />progress</span>
                <span className="flex items-center gap-1"><i className="h-[3px] w-4 rounded-full bg-[#738091]" />baseline</span>
                <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-sm border border-dashed border-[#c084fc]/70" />proposed task</span>
                <span className="flex items-center gap-1"><i className="h-3 w-px bg-[#9d8cff]" />today</span>
                <span className="flex items-center gap-1 text-[#fab219]">◆<span className="text-[#8f99a8]">milestone</span></span>
              </div>
            </div>
          )}
        </div>
      </div>
      {task && <NodePanel key={task} code={task} onClose={() => setTask(null)} />}
      {current && (
        <Side eyebrow={`${current.code} · ${current.id}`} title={current.name} onClose={() => { setSel(null); if (target) go("schedule/gantt"); }}>
          <p className="text-[#d3d8de]">{current.start} to {current.finish}{current.start !== current.baseline_start ? `, baseline ${current.baseline_start}` : ""}.</p>
          <div className="flex flex-wrap gap-1">{current.critical ? <Pill tone="bad">critical</Pill> : current.float_days ? <Pill tone="info">float {current.float_days} days</Pill> : null}<Pill>{clean(current.by_name)}</Pill>{current.package && <Pill>{current.package}</Pill>}</div>
          <button onClick={() => go(`wbs/tree:${current.code}`)} className={`${quiet} w-full`}>See everything on it in the WBS</button>
          <div className="space-y-1">
            <Label>Must finish first</Label>
            <div className="flex flex-wrap gap-1">
              {(current.predecessors as string[]).map((p) => <button key={p} onClick={() => change({ predecessors: (current.predecessors as string[]).filter((x) => x !== p) })} title={`Remove the link to ${p}`} className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-[#d3d8de] hover:bg-[#e5484d]/30">{p}<Icon name="x" className="h-2.5 w-2.5" /></button>)}
              {!(current.predecessors as string[]).length && <span className="text-[#8f99a8]">Nothing</span>}
            </div>
            <select aria-label="Add a dependency" value="" onChange={(e) => e.target.value && change({ predecessors: [...(current.predecessors as string[]), e.target.value] })} className={field}>
              <option value="" className="bg-[#1c2127]">Add a dependency…</option>
              {acts.filter((a) => a.id !== current.id && !(current.predecessors as string[]).includes(a.id)).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2127]">{a.id} {a.name}</option>)}
            </select>
            <p className="text-[10.5px] text-[#8f99a8]">Code works the dates and float out again, and refuses a loop.</p>
          </div>
          {(current.rfis.length + current.ncrs.length + current.pos.length > 0) && (
            <div className="space-y-1">
              <Label>Open records holding it</Label>
              <div className="flex flex-wrap gap-1">
                {current.rfis.map((x: string) => <Ref key={x} to={`documents/rfis:${x}`} tone="warn">{x}</Ref>)}
                {current.ncrs.map((x: string) => <Ref key={x} to={`quality/ncrs:${x}`} tone="bad">{x}</Ref>)}
                {current.pos.map((x: string) => <Ref key={x} to={`procurement/orders:${x}`} tone="info">{x}</Ref>)}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label><Label>Progress %</Label><input type="number" min={0} max={100} disabled={current.progress_from === "tasks"} value={form.progress} onChange={(e) => setForm({ ...form, progress: e.target.value })} className={field} /></label>
            <label><Label>Duration, days</Label><input type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className={field} /></label>
          </div>
          {current.progress_from === "tasks" && <p className="text-[11px] text-[#abb3bf]">Its progress comes from its tasks on the Kanban board.</p>}
          <button onClick={() => change({ ...(current.progress_from === "tasks" ? {} : { progress: Number(form.progress) }), duration: Number(form.duration) })} className={`${primary} w-full`}>Update, and work out the dates again</button>
        </Side>
      )}
    </div>
  );
}

/** People on site at one moment, day by day, against what the programme allows: one measure, so one hue; the limit is a line. */
function CrewChart({ days, limit, who }: { days: Rec[]; limit: number | null; who: Record<string, string> }) {
  const peak = Math.max(...days.map((d) => d.total), 0);
  const top = Math.max(limit ?? 0, peak, 1) * 1.14;
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const names = [...new Set(days.flatMap((d) => Object.keys(d.crew)))].filter((k) => who[k]);
  return (
    <div className="p-3">
      <div className="relative ml-2 mr-[150px] flex h-[170px] items-end gap-[2px] border-b border-white/15" onMouseLeave={() => setHover(null)}>
        {limit ? <div className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-[#d3d8de]/70" style={{ bottom: `${(limit / top) * 100}%` }}><span className="absolute left-full top-[-8px] ml-1.5 whitespace-nowrap text-[10.5px] text-[#d3d8de]">{limit} a day in the programme</span></div> : null}
        {days.map((d) => (
          <div key={d.day} tabIndex={0} aria-label={`Day ${d.day}: ${d.total} people at the peak`} className="relative flex h-full flex-1 cursor-default flex-col justify-end outline-none hover:bg-white/[.03] focus:bg-white/[.03]" onMouseEnter={() => setHover(d.day)} onFocus={() => setHover(d.day)}>
            <div className="relative mx-auto w-full max-w-[64px] rounded-t bg-[#8083e8]" style={{ height: `${(d.total / top) * 100}%` }}>{d.total === peak && <span className="absolute inset-x-0 -top-[17px] text-center text-[11px] font-medium tabular-nums text-white">{d.total}</span>}</div>
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
      {asTable && <div className="mt-2"><Table heads={["Day", "Peak on site", ...names.map((k) => who[k])]}>{days.map((d) => <tr key={d.day} className={tr}><td className={td}>{d.day}</td><td className={td}>{d.total}</td>{names.map((k) => <td key={k} className={td}>{d.crew[k] ?? 0}</td>)}</tr>)}</Table></div>}
    </div>
  );
}

function Resources() {
  const { data, err } = useData("/api/project/schedule");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const r = data.resources as Rec | null, who = data.who as Record<string, string>;
  if (!r) return <div className="flex-1 bg-[#161a1f]"><Empty>Resources come from the AI analysis. <button onClick={() => go("analysis")} className="underline">Open it</button>.</Empty></div>;
  const t = r.totals as Rec;
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#161a1f] p-3 text-[12px]">
      <Card title="People on site at the peak of each day" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">{t.hours_per_oh} working hours a day</span>}><CrewChart days={r.crew_by_day} limit={t.programme_crew} who={who} /></Card>
      <Card title="Workforce by trade" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">OH: one person for one day. From SNI 7394:2008, plus the agents&apos; estimates for handling and inspection</span>}>
        <Table heads={["Trade", "OH", "Man-hours", "Cost (Rp)"]}>{(r.workforce as Rec[]).map((w) => <tr key={w.role} className={tr}><td className={`${td} text-white`}>{w.role}{w.supervises ? <span className="text-[#8f99a8]"> (shared across tasks)</span> : null}</td><td className={td}>{num(w.oh)}</td><td className={td}>{num(w.man_hours)}</td><td className={td}>{w.cost.toLocaleString("en-US")}</td></tr>)}</Table>
      </Card>
      <Card title="Peak against what each has" right={<button onClick={() => go("procurement/assignments")} className={quiet}>Assignments</button>}>
        <Table heads={["Who", "Peak on this plan", "Crew they have", ""]}>{Object.entries(t.peak_by as Record<string, number>).filter(([k]) => t.crews[k] != null).map(([k, n]) => <tr key={k} className={tr}><td className={`${td} text-white`}>{who[k] ?? k}</td><td className={td}>{n}</td><td className={td}>{t.crews[k]}</td><td className={td}><Pill tone={n > t.crews[k] ? "bad" : "ok"}>{n > t.crews[k] ? "more than they have" : "fits"}</Pill></td></tr>)}</Table>
      </Card>
    </div>
  );
}

function Network() {
  const { data, err } = useData("/api/project/schedule");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f] p-3 text-[12px]">
      {data.network ? <><p className="mb-2 text-[#abb3bf]">The dependencies between the tasks of {data.network.title}: what the critical path is worked out from.</p><NetworkSheet plan={data.network} /></> : <Empty>The network comes from the AI analysis. <button onClick={() => go("analysis")} className="underline">Open it</button>.</Empty>}
    </div>
  );
}

export function ScheduleModule({ sub, target }: { sub: string; target: string }) {
  const tab = ["network", "resources"].includes(sub) ? sub : "gantt";
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {tab === "gantt" && <Gantt target={target} />}
      {tab === "network" && <Network />}
      {tab === "resources" && <Resources />}
    </div>
  );
}
