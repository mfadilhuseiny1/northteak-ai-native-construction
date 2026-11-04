"use client";
import { useEffect, useState } from "react";
import { api, field, full, Label, Loading, money, NotYet, primary, Problem, quiet, useData, useGo, type Rec } from "./kit";
import { ACTUAL, compact, PLAN } from "./ReportCharts";
import { SourceLink } from "./SourceDrawer";

/* The Kurva-S as contractors draw it: the master schedule's own rows and weekly figures where the package has one code can read, the planned and
   actual cumulative curves drawn over that grid, the weekly progress as bars beneath them, and the four rows that sum it all up. Without a readable
   schedule, each work package's weight is spread over its baseline's weeks. The actual line is what the site recorded here, week by week; until it
   has, a point for each month a report saved and for today. Weeks no one measured are left empty, not filled in. */

const CW = 46, RH = 24, HH = 22, NO = 36, NAME = 236, WEIGHT = 62, LEFT = NO + NAME + WEIGHT, AXIS = 52;
const pct = (v: number | null | undefined, d = 2) => (v == null ? "" : `${v.toFixed(d)}%`);
const monthOf = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const SPENT = "#8f99a8";  // what cost control draws money spent in
const dayOf = (d: string, plus = 0, year = false) => new Date(Date.parse(`${d}T00:00:00Z`) + plus * 86400000).toLocaleString("en-US", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

/** What the site really did in a week: the progress made, and the cost by control account. Recording a week again replaces it. */
function RecordWeek({ data, week, err, onWeek, onSave, onClose }: { data: Rec; week: number; err: string; onWeek: (w: number) => void; onSave: (body: Rec) => void; onClose: () => void }) {
  const recorded = data.recorded as Record<string, Rec>, rec = recorded[week], accounts = data.accounts as Rec[], starts = data.week_starts as string[], now = data.current_week as number;
  const [progress, setProgress] = useState(rec?.progress == null ? "" : String(rec.progress));
  const [costs, setCosts] = useState<Record<string, string>>(Object.fromEntries(Object.entries((rec?.costs ?? {}) as Record<string, number>).map(([k, v]) => [k, String(v)])));
  const [note, setNote] = useState(String(rec?.note ?? ""));
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const done = progress.trim() === "" ? null : Number(progress);
  const before = Object.values(recorded).reduce((n, r) => n + (r.week < week ? r.progress ?? 0 : 0), 0);
  const total = Object.values(costs).reduce((n, v) => n + Number(v || 0), 0);
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[min(460px,92vw)] flex-col border-l border-white/15 bg-[#1c2733] text-[12px] shadow-2xl" role="dialog" aria-label="Record actuals">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <p className="flex-1 text-[13px] font-semibold text-white">Record actuals</p>
        <button onClick={onClose} className={quiet}>Close</button>
      </div>
      <Problem err={err} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <div className="space-y-1">
          <Label>Week</Label>
          <select aria-label="Week" value={week} onChange={(e) => onWeek(Number(e.target.value))} className={field}>
            {starts.map((d, k) => <option key={k} value={k + 1} className="bg-[#1c2733]">Week {k + 1}: {dayOf(d)} to {dayOf(d, 6, true)}{recorded[k + 1] ? ", recorded" : ""}</option>)}
          </select>
          {week > now && <p className="text-[11px] text-[#fbd38d]">This week has not {now ? "finished" : "started"} yet, so check the date before saving.</p>}
        </div>
        <div className="space-y-1">
          <Label>Progress made this week, % of the whole job</Label>
          <input type="number" min="0" max="100" step="0.01" autoFocus aria-label="Progress this week" value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="For example 1.25" className={`${field} tabular-nums`} />
          <p className="text-[11px] text-[#abb3bf]">That brings the job to <b className="text-white">{pct(before + (done ?? 0))}</b>. Planned by the end of this week: <b className="text-white">{pct((data.planned_cum as number[])[week - 1])}</b>.</p>
          {!data.site_recorded && <p className="text-[11px] text-[#8f99a8]">The Kanban cards read {pct(data.board_progress)}. Once a week is recorded, the figures here are what the Kurva-S and the reports show.</p>}
        </div>
        {accounts.length > 0 && (
          <div className="space-y-1">
            <Label>Cost spent this week, by control account</Label>
            <div className="divide-y divide-white/[.06]">
              {accounts.map((a) => (
                <label key={a.id} className="grid grid-cols-[minmax(0,1fr)_146px] items-center gap-3 py-1.5">
                  <span className="min-w-0"><span className="block truncate text-white" title={a.name}>{a.name}</span><span className="text-[10.5px] text-[#8f99a8]">{a.id} · budget {money(a.budget)}</span></span>
                  <input inputMode="numeric" aria-label={`Cost for ${a.name}`} value={costs[a.id] ? Number(costs[a.id]).toLocaleString("en-US") : ""} onChange={(e) => setCosts({ ...costs, [a.id]: e.target.value.replace(/\D/g, "") })} placeholder="Rp" className={`${field} text-right tabular-nums`} />
                </label>
              ))}
            </div>
            <p className="flex justify-between pt-1 text-[11.5px] font-semibold text-white"><span>Total this week</span><span className="tabular-nums">{full(total)}</span></p>
          </div>
        )}
        <div className="space-y-1">
          <Label>Note</Label>
          <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className={field} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-4 py-2.5">
        <button disabled={done == null && !total && !note.trim()} onClick={() => onSave({ progress: done, costs: Object.fromEntries(Object.entries(costs).filter(([, v]) => Number(v)).map(([k, v]) => [k, Number(v)])), note })} className={primary}>Save week {week}</button>
        {rec && <button onClick={() => onSave({})} className={`${quiet} ml-auto`}>Clear this week</button>}
      </div>
    </div>
  );
}

export function KurvaS() {
  const { data, err, act } = useData("/api/project/kurva-s");
  const go = useGo();
  const [recording, setRecording] = useState<number | null>(null);
  if (!data) return <div className="p-3"><Problem err={err} />{!err && <Loading />}</div>;
  if (!data.weeks) return <div className="p-3"><NotYet>No work packages with dates yet, so there is no Kurva-S to draw.</NotYet></div>;
  const weeks = data.weeks as number, rows = data.rows as Rec[], planned = data.planned as number[], cum = data.planned_cum as number[];
  const actual = data.actual as [number, number][], weekly = data.actual_weekly as Record<string, number>, now = data.current_week as number;
  const months: { label: string; span: number }[] = [];
  for (const d of data.week_starts as string[]) {
    const label = monthOf(d);
    if (months.length && months[months.length - 1].label === label) months[months.length - 1].span++;
    else months.push({ label, span: 1 });
  }
  const bodyH = rows.length * RH, width = weeks * CW;
  const y = (v: number) => bodyH - 6 - (Math.min(100, Math.max(0, v)) / 100) * (bodyH - 14);
  const barArea = Math.min(150, bodyH * 0.3), barMax = Math.max(...planned, ...Object.values(weekly).map(Math.abs), 0.01);
  const planPath = [`M0,${y(0)}`, ...cum.map((v, k) => `L${(k + 1) * CW},${y(v)}`)].join(" ");
  const actualPath = actual.map(([w, v], k) => `${k ? "L" : "M"}${w * CW},${y(v)}`).join(" ");
  const last = actual[actual.length - 1];
  const at = data.site_recorded ? last[0] : now;  // what was recorded is compared with the plan at that week, and the board's reading with this one
  const planAt = at ? cum[at - 1] : 0;
  const costWeekly = data.cost_weekly as Record<string, number>, costCum = data.cost_cum as Record<string, number>;
  const spentElsewhere = data.spent_elsewhere as number;
  const save = async (body: Rec) => { if (await act(() => api(`/api/project/actuals/${recording}`, body))) setRecording(null); };
  const actualByWeek = Object.fromEntries(actual.map(([w, v]) => [w, v]));
  const cell = "shrink-0 border-b border-r border-white/[.07]";
  const left = "sticky left-0 z-10 flex shrink-0 border-r border-white/15";
  return (
    <div className="text-[11px]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2">
        <p className="text-[12.5px] font-bold uppercase tracking-wide text-white">Kurva-S{now ? <span className="ml-2 font-normal normal-case tracking-normal text-[#abb3bf]">week {now}, {monthOf((data.week_starts as string[])[Math.max(0, now - 1)])}</span> : null}</p>
        <span className="flex items-center gap-1.5 text-[#abb3bf]"><span className="h-[2px] w-5" style={{ background: PLAN }} />planned, cumulative</span>
        <span className="flex items-center gap-1.5 text-[#abb3bf]"><span className="h-[2px] w-5" style={{ background: ACTUAL }} />actual, cumulative</span>
        <span className="flex items-center gap-1.5 text-[#abb3bf]"><span className="h-3 w-1.5 rounded-sm" style={{ background: PLAN }} /><span className="h-3 w-1.5 rounded-sm" style={{ background: ACTUAL }} />progress that week</span>
        <span className="flex items-center gap-1.5 text-[#abb3bf]"><span className="h-3 w-4 rounded-sm bg-[#f5b82e]" />a work package&apos;s weight in the week</span>
        <span className="ml-auto text-[10.5px] text-[#8f99a8]">{data.source ? <>planned figures as printed in <SourceLink doc={data.source.doc} page={data.source.page} title={data.source.title}>{data.source.title}, p.{data.source.page}</SourceLink></> : `weights from ${data.weights_from === "rab" ? "the RAB" : "the days, as nothing is priced"} · dates from the baseline`}</span>
        <button onClick={() => setRecording(now || 1)} className={primary}>Record actuals</button>
      </div>
      <div className="max-h-[680px] overflow-auto border-t border-white/10">
        <div className="relative" style={{ width: LEFT + width + AXIS }}>
          <div className="sticky top-0 z-20 flex bg-[#1c2733] text-[10.5px] font-semibold text-[#d3d8de]">
            <div className={`${left} bg-[#1c2733]`} style={{ height: HH * 2 }}>
              <span className={`${cell} flex items-center justify-center`} style={{ width: NO }}>No</span>
              <span className={`${cell} flex items-center px-2`} style={{ width: NAME }}>Work item</span>
              <span className={`${cell} flex items-center justify-center`} style={{ width: WEIGHT }}>Weight</span>
            </div>
            <div>
              <div className="flex" style={{ height: HH }}>{months.map((m, k) => <span key={k} className={`${cell} flex items-center justify-center truncate px-1`} style={{ width: m.span * CW }}>{m.span > 1 ? m.label : m.label.slice(0, 3)}</span>)}</div>
              <div className="flex" style={{ height: HH }}>{Array.from({ length: weeks }, (_, k) => <span key={k} className={`${cell} flex items-center justify-center ${k + 1 === now ? "bg-[#f5b82e] text-[#171106]" : ""}`} style={{ width: CW }}>W{k + 1}</span>)}</div>
            </div>
            <span className={`${cell} flex items-center justify-center text-[10px] font-normal text-[#8f99a8]`} style={{ width: AXIS, height: HH * 2 }}>cumul.</span>
          </div>
          <div className="relative">
            {rows.map((r, n) => {
              const group = r.type !== "item", filled = r.type !== "group";  // a group's own row is bold; a row of work has its weeks filled in
              return (
                <div key={`${r.code}-${r.no ?? ""}-${n}`} onClick={() => { if (r.code) go(`wbs/tree:${r.code}`); }} className={`group flex cursor-pointer ${group ? "bg-[#1c2733]" : "bg-[#111820] hover:bg-[#16202b]"}`} style={{ height: RH }} title={`${r.no ?? r.code} ${r.name}: ${pct(r.weight)} of the job`}>
                  <div className={`${left} ${group ? "bg-[#1c2733]" : "bg-[#111820] group-hover:bg-[#16202b]"}`}>
                    <span className={`${cell} flex items-center justify-center font-mono text-[10px] text-[#8f99a8]`} style={{ width: NO }}>{r.no ?? (group ? r.code : String(r.code).split(".").pop())}</span>
                    <span className={`${cell} flex items-center truncate ${group ? "px-2 font-semibold uppercase text-white" : "pl-4 pr-2 text-[#e5e8eb]"}`} style={{ width: NAME }}>{r.name}</span>
                    <span className={`${cell} flex items-center justify-end px-2 tabular-nums ${group ? "font-semibold text-white" : "text-[#d3d8de]"}`} style={{ width: WEIGHT }}>{pct(r.weight)}</span>
                  </div>
                  {(r.cells as number[]).map((v, k) => (
                    <span key={k} className={`${cell} flex items-center justify-center text-[9px] tabular-nums`} style={{ width: CW, ...(v > 0.004 && filled ? { background: "rgb(233 194 46 / .88)", color: "#1a1406" } : v > 0.004 ? { color: "#8f99a8" } : {}) }}>{v > 0.004 ? v.toFixed(2) : ""}</span>
                  ))}
                  <span className={cell} style={{ width: AXIS }} />
                </div>
              );
            })}
            <svg className="pointer-events-none absolute top-0" style={{ left: LEFT }} width={width + AXIS} height={bodyH} aria-label={`Kurva-S: ${pct(planAt)} planned by week ${at}, ${pct(last?.[1])} done`}>
              {now > 0 && <rect x={(now - 1) * CW} y={0} width={CW} height={bodyH} fill="#f5b82e" opacity={0.08} />}
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => <text key={v} x={width + AXIS - 6} y={y(v) + 3} textAnchor="end" fontSize="9.5" fill="#8f99a8">{v}%</text>)}
              {planned.map((v, k) => v > 0 && <rect key={`p${k}`} x={k * CW + CW * 0.18} y={bodyH - (v / barMax) * barArea} width={CW * 0.3} height={(v / barMax) * barArea} rx={2} fill={PLAN} opacity={0.9} />)}
              {Object.entries(weekly).map(([w, v]) => v > 0 && <rect key={`a${w}`} x={(Number(w) - 1) * CW + CW * 0.52} y={bodyH - (v / barMax) * barArea} width={CW * 0.3} height={(v / barMax) * barArea} rx={2} fill={ACTUAL} />)}
              <path d={planPath} fill="none" stroke={PLAN} strokeWidth={2.5} strokeLinejoin="round" />
              {cum.map((v, k) => <circle key={k} cx={(k + 1) * CW} cy={y(v)} r={2.6} fill={PLAN} stroke="#111820" strokeWidth={1} />)}
              {actual.length > 1 && <path d={actualPath} fill="none" stroke={ACTUAL} strokeWidth={2.5} strokeLinejoin="round" />}
              {actual.slice(1).map(([w, v]) => <circle key={w} cx={w * CW} cy={y(v)} r={4} fill={ACTUAL} stroke="#111820" strokeWidth={1.5} />)}
              {at > 0 && last && (() => {
                const x = at * CW, bx = Math.max(8, x - 168), boxes: [number, string, string][] = [[planAt, PLAN, "planned"], [last[1], ACTUAL, "actual"]];
                return boxes.map(([v, color, label], k) => {
                  const by = Math.max(6, Math.min(bodyH - 40, y(Math.max(planAt, last[1])) - 70 + k * 38));
                  return (
                    <g key={label}>
                      <line x1={bx + 104} y1={by + 15} x2={x} y2={y(v)} stroke={color} strokeWidth={1.2} />
                      <rect x={bx} y={by} width={104} height={30} rx={4} fill={color} />
                      <text x={bx + 52} y={by + 13} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{pct(v)}</text>
                      <text x={bx + 52} y={by + 25} textAnchor="middle" fontSize="8.5" fill="#ffffffcc">{label}, week {at}</text>
                    </g>
                  );
                });
              })()}
            </svg>
          </div>
          {[["Planned this week", planned.map((v) => pct(v)), PLAN], ["Planned, cumulative", cum.map((v) => pct(v)), PLAN], ["Actual this week", Array.from({ length: weeks }, (_, k) => pct(weekly[k + 1])), ACTUAL, true], ["Actual, cumulative", Array.from({ length: weeks }, (_, k) => pct(actualByWeek[k + 1])), ACTUAL, true], ["Actual cost this week", Array.from({ length: weeks }, (_, k) => (costWeekly[k + 1] ? compact(costWeekly[k + 1]) : "")), SPENT, true], ["Actual cost, cumulative", Array.from({ length: weeks }, (_, k) => (costCum[k + 1] ? compact(costCum[k + 1]) : "")), SPENT, true]].map(([label, values, color, opens], n) => (
            <div key={label as string} className={`flex ${n % 2 ? "bg-[#151e28]" : "bg-[#1c2733]"}`} style={{ height: RH }}>
              <div className={`${left} ${n % 2 ? "bg-[#151e28]" : "bg-[#1c2733]"}`}><span className={`${cell} flex items-center gap-2 px-2 font-semibold text-white`} style={{ width: LEFT }}><span className="h-2 w-2 rounded-full" style={{ background: color as string }} />{label as string}</span></div>
              {(values as string[]).map((v, k) => {
                const look = `${cell} flex items-center justify-center text-[9.5px] tabular-nums ${k + 1 === now ? "font-bold text-white" : "text-[#d3d8de]"}`;
                return opens
                  ? <button key={k} onClick={() => setRecording(k + 1)} aria-label={`Record week ${k + 1}`} title={`Record week ${k + 1}`} className={`${look} hover:bg-[#f5b82e]/25`} style={{ width: CW }}>{v}</button>
                  : <span key={k} className={look} style={{ width: CW }}>{v}</span>;
              })}
              <span className={cell} style={{ width: AXIS }} />
            </div>
          ))}
        </div>
      </div>
      <p className="border-t border-white/10 px-3 py-2 text-[10.5px] text-[#8f99a8]">{data.source ? "The grid and the planned curve are the master schedule's own figures, so they match the contract." : "Each work package's weight is spread evenly over the days its baseline runs."} {data.site_recorded ? `The actual line is what was recorded week by week, and it is what the reports show; the Kanban cards read ${pct(data.board_progress)} on their own.` : "The actual line reads the Kanban cards: a point each month a report saves, and today."} Weeks nobody measured stay empty.{spentElsewhere > 0 ? ` Another ${money(spentElsewhere)} was spent without a week, in cost control, so it counts in the forecast but not in the cost rows.` : ""} Click a row to open it in the WBS, or an actual figure to record that week.</p>
      {recording != null && <RecordWeek key={recording} data={data} week={recording} err={err} onWeek={setRecording} onSave={save} onClose={() => setRecording(null)} />}
    </div>
  );
}
