"use client";
import { useEffect, useState } from "react";
import { api, Bar, clean, Kpi, Kpis, Label, Loading, Pill, primary, Problem, short, Side, useData, field, type Rec } from "./kit";

/* The schedule as a Gantt chart. Code works out every date from the dependencies; the thin bar is the baseline, so a move shows at a glance. */

const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;

export function ScheduleView({ onGo }: { onGo: (tab: string) => void }) {
  const { data, err, act } = useData("/api/project/schedule");
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState({ progress: "", duration: "" });
  const acts = (data?.activities ?? []) as Rec[];
  const open = acts.find((a) => a.id === sel);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form follows the activity picked
    if (open) setForm({ progress: String(open.progress), duration: String(open.duration) });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps -- only when another activity is picked
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const m = data.milestone as Rec;
  const dates = acts.flatMap((a) => [a.start, a.finish, a.baseline_start, a.baseline_finish]).concat(m.contract_date, data.today);
  const first = Math.min(...dates.map(dayOf)), last = Math.max(...dates.map(dayOf)) + 1;
  const span = last - first + 1;
  const left = (d: string) => ((dayOf(d) - first) / span) * 100;
  const width = (a: string, b: string) => ((dayOf(b) - dayOf(a) + 1) / span) * 100;
  const days = Array.from({ length: span }, (_, i) => new Date((first + i) * 86400000).toISOString().slice(0, 10));
  const pour = acts.find((a) => a.id === "A30");
  const moved = acts.filter((a) => a.start !== a.baseline_start || a.finish !== a.baseline_finish).length;
  return (
    <div className="flex min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Schedule" note={`dates worked out by code from the dependencies · today ${data.today}`} />
        <Problem err={err} />
        <Kpis>
          <Kpi label={`milestone ${m.id}, due ${short(m.contract_date)}`} value={short(m.forecast)} tone={m.days_late ? "bad" : "ok"} hint={m.days_late ? `${m.days_late} days late` : "on time"} />
          <Kpi label="Level 3 pour" value={short(pour?.start)} hint={pour?.start !== pour?.baseline_start ? `was ${short(pour?.baseline_start)}` : "on baseline"} />
          <Kpi label="critical activities" value={acts.filter((a) => a.critical).length} />
          <Kpi label="moved from baseline" value={moved} tone={moved ? "warn" : undefined} />
        </Kpis>
        <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
          <div className="min-w-[980px]">
            <div className="sticky top-0 z-[2] flex border-b border-white/10 bg-[#1c2127]">
              <div className="w-[300px] shrink-0 px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[#8f99a8]">Activity</div>
              <div className="relative h-7 flex-1">
                {days.map((d, i) => (
                  <span key={d} className={`absolute top-1.5 text-center text-[9.5px] tabular-nums ${d === data.today ? "font-semibold text-white" : "text-[#8f99a8]"}`} style={{ left: `${(i / span) * 100}%`, width: `${100 / span}%` }}>{d.slice(8)}</span>
                ))}
              </div>
            </div>
            {acts.map((a) => (
              <button key={a.id} onClick={() => setSel(a.id)} className={`flex w-full border-b border-white/5 text-left hover:bg-white/[.03] ${sel === a.id ? "bg-white/[.06]" : ""}`}>
                <div className="w-[300px] shrink-0 px-3 py-1.5">
                  <p className="truncate text-[#e5e8eb]"><span className="mr-1.5 text-[10.5px] text-[#8f99a8]">{a.id}</span>{a.name}</p>
                  <p className="truncate text-[10.5px] text-[#8f99a8]">{clean(a.by_name)} · {a.duration} day{a.duration === 1 ? "" : "s"} · float {a.float_days}</p>
                </div>
                <div className="relative min-h-[42px] flex-1">
                  {days.map((d, i) => d === data.today ? <span key={d} className="absolute inset-y-0 w-px bg-[#9d8cff]/60" style={{ left: `${(i / span) * 100}%` }} /> : null)}
                  <span className="absolute inset-y-0 w-px bg-[#fab219]/50" style={{ left: `${left(m.contract_date) + 100 / span}%` }} title={`Milestone ${m.id} due`} />
                  <span className="absolute top-[30px] h-[3px] rounded-full bg-[#738091]" style={{ left: `${left(a.baseline_start)}%`, width: `${width(a.baseline_start, a.baseline_finish)}%` }} title={`Baseline ${a.baseline_start} to ${a.baseline_finish}`} />
                  <span className={`absolute top-[9px] flex h-[18px] items-center overflow-hidden rounded-sm ${a.critical ? "bg-[#e5484d]/80" : "bg-[#3987e5]/70"}`} style={{ left: `${left(a.start)}%`, width: `${width(a.start, a.finish)}%` }} title={`${a.start} to ${a.finish}`}>
                    <span className="h-full bg-[#29a383]" style={{ width: `${a.progress}%` }} />
                  </span>
                  {(a.rfis.length + a.ncrs.length + a.pos.length > 0) && <span className="absolute top-[11px] rounded bg-black/60 px-1 text-[9px] text-[#fbd38d]" style={{ left: `${left(a.finish) + 100 / span + 0.3}%` }}>{a.rfis.length + a.ncrs.length + a.pos.length} open</span>}
                </div>
              </button>
            ))}
            <div className="flex flex-wrap gap-3 px-3 py-2 text-[10.5px] text-[#8f99a8]">
              <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-sm bg-[#e5484d]/80" />critical</span>
              <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-sm bg-[#3987e5]/70" />has float</span>
              <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-sm bg-[#29a383]" />progress</span>
              <span className="flex items-center gap-1"><i className="h-[3px] w-4 rounded-full bg-[#738091]" />baseline</span>
              <span className="flex items-center gap-1"><i className="h-3 w-px bg-[#9d8cff]" />today</span>
              <span className="flex items-center gap-1"><i className="h-3 w-px bg-[#fab219]" />milestone due</span>
            </div>
          </div>
        </div>
      </div>
      {open && (
        <Side eyebrow={open.id} title={open.name} onClose={() => setSel(null)}>
          <p className="text-[#d3d8de]">{open.start} to {open.finish}{open.start !== open.baseline_start ? `, baseline ${open.baseline_start}` : ""}.</p>
          <div className="flex flex-wrap gap-1">{open.critical ? <Pill tone="bad">critical</Pill> : <Pill tone="info">float {open.float_days} days</Pill>}<Pill>{clean(open.by_name)}</Pill>{open.package && <Pill>{open.package}</Pill>}</div>
          {open.predecessors.length > 0 && <div><Label>Depends on</Label><p className="text-[#d3d8de]">{open.predecessors.join(", ")}</p></div>}
          {(open.rfis.length + open.ncrs.length + open.pos.length > 0) && (
            <div className="space-y-1">
              <Label>Open records holding it</Label>
              <div className="flex flex-wrap gap-1">
                {open.rfis.map((x: string) => <button key={x} onClick={() => onGo("rfis")}><Pill tone="warn">{x}</Pill></button>)}
                {open.ncrs.map((x: string) => <button key={x} onClick={() => onGo("quality")}><Pill tone="bad">{x}</Pill></button>)}
                {open.pos.map((x: string) => <button key={x} onClick={() => onGo("procurement")}><Pill tone="info">{x}</Pill></button>)}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label><Label>Progress %</Label><input type="number" min={0} max={100} value={form.progress} onChange={(e) => setForm({ ...form, progress: e.target.value })} className={field} /></label>
            <label><Label>Duration, days</Label><input type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className={field} /></label>
          </div>
          <button onClick={() => act(() => api(`/api/project/schedule/${open.id}`, { progress: Number(form.progress), duration: Number(form.duration) }))} className={`${primary} w-full`}>Update, and work out the dates again</button>
        </Side>
      )}
    </div>
  );
}
