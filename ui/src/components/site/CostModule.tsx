"use client";
import { useState } from "react";
import { api, Bar, Card, Empty, field, full, inFocus, Kpi, Kpis, Loading, money, num, Pill, primary, Problem, quiet, Ref, SubTabs, Table, td, tr, useData, useFocus, useGo, type Rec, NotYet } from "./kit";
import { ClaimsView } from "./RecordsViews";
import { ACTUAL, PLAN } from "./ReportCharts";
import { Diverge, Group, hue, Item, Legend, Progress, SERIES, ShareStrip, SizeBar, SplitBar } from "./Visual";

/* Cost estimation: what is the work worth? By control account and work package, spread over time as a Kurva-S, and the contract BoQ and the take-off beside it. It says which kind of estimate it is, because a top-down figure must not read like a measured one. */

const EMPTY = { package: "", description: "", amount: "", recoverable_from: "", actual: false };

/** The Kurva-S: one measure over time, so one line. Hover a week for its figures, or read it as a table. */
function SCurve({ points }: { points: Rec[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 1000, H = 175, L = 34, R = 14, T = 10, B = 20;
  const x = (i: number) => L + (i / Math.max(points.length - 1, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const h = hover == null ? null : points[hover];
  return (
    <div className="p-3">
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Planned progress over ${points.length} weeks, reaching ${points[points.length - 1]?.cumulative}%`} className="w-full">
          {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#ffffff" strokeOpacity={v ? 0.07 : 0.2} /><text x={L - 6} y={y(v) + 2.5} textAnchor="end" fontSize="7.5" fill="#8f99a8">{v}%</text></g>)}
          {points.map((p, i) => (p.week === 1 || p.week % 4 === 0) && <text key={p.week} x={x(i)} y={H - 6} textAnchor="middle" fontSize="7.5" fill="#8f99a8">W{p.week}</text>)}
          <path d={points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(" ")} fill="none" stroke="#8083e8" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {h && hover != null && <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#ffffff" strokeOpacity="0.25" /><circle cx={x(hover)} cy={y(h.cumulative)} r="3.5" fill="#8083e8" stroke="#1c2733" strokeWidth="1.5" /></g>}
          {points.map((p, i) => <rect key={p.week} x={x(i) - (W - L - R) / points.length / 2} y={T} width={(W - L - R) / points.length} height={H - T - B} fill="transparent" tabIndex={0} aria-label={`Week ${p.week}: ${p.cumulative}%`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} className="outline-none" />)}
        </svg>
        {h && hover != null && (
          <div className="pointer-events-none absolute top-1 z-10 w-[190px] rounded border border-white/15 bg-[#151e28] p-2 text-[11px] text-[#d3d8de] shadow-lg" style={hover > points.length / 2 ? { right: `${100 - (x(hover) / W) * 100 + 1}%` } : { left: `${(x(hover) / W) * 100 + 1}%` }}>
            <p className="font-semibold text-white">Week {h.week}, to {h.ends}</p>
            <p>{h.cumulative}% planned by then</p>
            <p>{money(h.value)} of work</p>
          </div>
        )}
      </div>
      <button onClick={() => setAsTable(!asTable)} className={`${quiet} mt-1`}>{asTable ? "Hide the table" : "Show as a table"}</button>
      {asTable && <div className="mt-2 max-h-[260px] overflow-y-auto"><Table heads={["Week", "To", "Planned by then", "Worth"]}>{points.map((p) => <tr key={p.week} className={tr}><td className={td}>{p.week}</td><td className={td}>{p.ends}</td><td className={td}>{p.cumulative}%</td><td className={td}>{money(p.value)}</td></tr>)}</Table></div>}
    </div>
  );
}

const METHOD: Record<string, string> = { top_down: "Top-down: the priced BoQ recap, spread over the work packages by the master schedule's weights. The package has no unit rates or detailed quantities, so this is not a measured take-off, and man-hours are the agents' estimates.", bottom_up: "From the contract BoQ. Where a work plan covers the work, its quantities, workforce and material are worked out in Take-off.", boq: "From the BoQ lines on this project." };

function Estimate() {
  const { data, err } = useData("/api/project/cost-estimate");
  const go = useGo();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.accounts as Rec[], curve = data.curve as Rec[];
  const toggle = (id: string) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next); };
  const gap = data.owner_total ? (data.total / data.owner_total - 1) * 100 : null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Cost estimation" note={METHOD[data.method]} />
      <Problem err={err} />
      <Kpis>
        <Kpi label="worth of the work, before tax" value={money(data.total)} />
        {data.owner_total && <Kpi label="the owner's estimate" value={money(data.owner_total)} hint={gap != null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%` : ""} />}
        <Kpi label="control accounts" value={rows.length} />
        <Kpi label="work packages" value={rows.reduce((n, a) => n + (a.packages as Rec[]).length, 0)} />
        {data.man_hours > 0 && <Kpi label="man-hours, estimated" value={num(data.man_hours, 0)} />}
      </Kpis>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#111820] p-3">
        {curve.length > 0 && <Card title="Planned progress over time: the Kurva-S" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">read from the master schedule</span>}><SCurve points={curve} /></Card>}
        {rows.length > 0 && (
          <Card title="Where the money goes" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">click a part to jump to it</span>}>
            <div className="p-3"><ShareStrip parts={rows.map((a, i) => ({ key: a.id, label: a.name, value: a.value, color: hue(i) }))} onPick={(k) => document.getElementById(`ca-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} /></div>
          </Card>
        )}
        {!rows.length && <NotYet>Nothing to estimate yet.</NotYet>}
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((a, i) => {
            const packages = (a.packages as Rec[]), max = Math.max(...rows.flatMap((x) => (x.packages as Rec[]).map((w) => w.value || 0)), 1);
            const many = packages.length > 8 && !open.has(a.id);
            return (
              <Group key={a.id} id={`ca-${a.id}`} color={hue(i)} code={a.code} title={a.name}
                sub={`${a.id} · ${packages.length} work package${packages.length === 1 ? "" : "s"} · ${a.tasks || 0} tasks · ${a.man_hours ? num(a.man_hours, 0) : "–"} man-hours`}
                right={<div className="text-right"><p className="text-[15px] font-bold tabular-nums text-white">{money(a.value)}</p><p className="text-[10.5px] text-[#8f99a8]">{data.total ? `${((a.value / data.total) * 100).toFixed(1)}% of the work` : ""}</p>{a.against_owner_pct != null && <div className="mt-0.5"><Diverge value={a.against_owner_pct} title="Against the owner's estimate: blue is below it, orange above" /></div>}</div>}
                footer={packages.length > 8 ? <button onClick={() => toggle(a.id)} className="w-full border-t border-white/[.06] py-1.5 text-[11px] text-[#9cc7f5] hover:bg-white/[.03]">{many ? `Show all ${packages.length}` : "Show fewer"}</button> : null}>
                {(many ? packages.slice(0, 8) : packages).map((w) => (
                  <Item key={w.id} code={w.code} title={w.name} meta={`${w.tasks || 0} tasks · ${w.man_hours ? num(w.man_hours, 0) : "–"} man-hours`} onClick={() => go(`wbs/tree:${w.code}`)}
                    visual={<SizeBar value={w.value || 0} max={max} color={hue(i)} title={money(w.value)} />}
                    value={<><span className="block font-semibold">{w.value ? money(w.value) : "–"}</span>{w.weight != null && <span className="block text-[10.5px] font-normal text-[#8f99a8]">{w.weight}% of the job</span>}</>} />
                ))}
              </Group>
            );
          })}
        </div>
        {data.takeoff && <button onClick={() => go("cost/takeoff")} className={quiet}>The take-off and bill of materials</button>}
      </div>
    </div>
  );
}

function Control({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/budget");
  const { focus } = useFocus();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const t = data.total as Rec;
  const packages = (data.packages as Rec[]).filter((p) => !focus || focus.type === "project" || p.id === focus.package);
  const items = (data.cost_items as Rec[]).filter((i) => !focus || focus.type === "project" || i.package === focus.package);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Budget and cost" note="earned value from verified progress, by control account">
        <button disabled={!(data.packages as Rec[]).length} onClick={() => setForm({ ...EMPTY, package: focus?.package ?? (data.packages as Rec[])[0]?.id ?? "" })} className={quiet}>Add a cost</button>
      </Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label="contract value (BoQ)" value={money(t.boq_value)} />
        <Kpi label="control budget" value={money(t.budget)} />
        <Kpi label="committed" value={money(t.committed)} />
        <Kpi label="planned value" value={money(t.pv)} />
        <Kpi label="earned value" value={money(t.ev)} />
        <Kpi label="actual cost" value={money(t.ac)} />
        <Kpi label="forecast at completion" value={money(t.eac)} tone={t.variance < 0 ? "warn" : "ok"} hint={`${money(Math.abs(t.variance))} ${t.variance < 0 ? "over" : "under"}`} />
        <Kpi label="CPI" value={Number(t.cpi).toFixed(2)} tone={t.cpi < 1 ? "warn" : "ok"} />
        <Kpi label="SPI" value={Number(t.spi).toFixed(2)} tone={t.spi < 1 ? "warn" : "ok"} />
      </Kpis>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#111820] p-3">
        <Card title="Control accounts" right={<Legend items={[{ label: "budget", color: PLAN }, { label: "earned", color: ACTUAL }, { label: "spent", color: "#8f99a8" }, { label: "forecast at completion", color: ACTUAL, hatched: true }]} />}>
          <div className="grid gap-px bg-white/[.04] md:grid-cols-2">
            {packages.map((p) => {
              const max = Math.max(...packages.map((x) => Math.max(x.budget, x.eac)), 1), over = p.variance < 0;
              return (
                <div key={p.id} className={`space-y-1.5 bg-[#1c2733] p-3 ${target && p.id === target ? "!bg-[#243241]" : ""}`}>
                  <div className="flex items-baseline gap-2"><span className="text-[10.5px] text-[#8f99a8]">{p.id}</span><span className="flex-1 truncate font-semibold text-white">{p.name}</span><Pill tone={p.cpi < 1 ? "warn" : "ok"}>CPI {Number(p.cpi).toFixed(2)}</Pill>{p.pv >= 0.01 * p.budget && <Pill tone={p.spi < 1 ? "warn" : "ok"}>SPI {Number(p.spi).toFixed(2)}</Pill>}</div>
                  {[["Budget", p.budget, PLAN, false], ["Earned", p.ev, ACTUAL, false], ["Spent", p.ac, "#8f99a8", false], ["Forecast", p.eac, over ? "#f87171" : ACTUAL, true]].map(([label, v, color, hatched]) => (
                    <div key={label as string} className="grid grid-cols-[62px_minmax(0,1fr)_86px] items-center gap-2 text-[11px]"><span className="text-[#8f99a8]">{label as string}</span><SplitBar parts={[{ label: label as string, value: v as number, color: color as string, hatched: hatched as boolean }]} max={max} /><span className="text-right tabular-nums text-[#d3d8de]">{money(v as number)}</span></div>
                  ))}
                  <p className="text-[10.5px] text-[#8f99a8]"><span className={over ? "text-[#ffb4b4]" : "text-[#7ee2c0]"}>{money(Math.abs(p.variance))} {over ? "over" : "under"} budget</span> · {money(p.committed)} committed{p.recovery ? ` · ${money(p.recovery)} added by plans` : ""}</p>
                </div>
              );
            })}
          </div>
          {!packages.length && <NotYet>No control accounts yet.</NotYet>}
        </Card>
        <Card title={`Costs recorded (${items.length})`}>
          {form && (
            <div className="grid grid-cols-[120px_minmax(0,1fr)_140px_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-white/5 p-2 max-lg:grid-cols-2">
              <select aria-label="Package" value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} className={field}>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2733]">{p.id}</option>)}</select>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it is for" className={field} />
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount, Rp" className={field} />
              <input value={form.recoverable_from} onChange={(e) => setForm({ ...form, recoverable_from: e.target.value })} placeholder="Recoverable from (optional)" className={field} />
              <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-[#d3d8de]"><input type="checkbox" checked={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.checked })} />Already spent</label>
              <button disabled={!form.description.trim() || !Number(form.amount)} onClick={async () => { if (await act(() => api("/api/project/cost-items", { ...form, amount: Number(form.amount) }))) setForm(null); }} className={primary}>Add</button>
            </div>
          )}
          {items.length ? (
            <div className="divide-y divide-white/[.04]">
              {items.map((i) => {
                const max = Math.max(...items.map((x) => x.amount), 1);
                return <Item key={i.id} code={i.id} title={i.description} meta={`${i.package} · ${i.source || "added by hand"}${i.recoverable_from ? ` · recoverable from ${i.recoverable_from}` : ""}`} visual={<SizeBar value={i.amount} max={max} color={i.actual ? "#8f99a8" : ACTUAL} />} value={<span className="flex items-center justify-end gap-2"><Pill tone={i.actual ? "info" : "none"}>{i.actual ? "spent" : "forecast"}</Pill><b className="font-semibold">{full(i.amount)}</b></span>} />;
              })}
            </div>
          ) : <Empty>Nothing yet. A recovery plan&apos;s cost lands here when it is approved.</Empty>}
        </Card>
      </div>
    </div>
  );
}

function Boq() {
  const { data, err, act } = useData("/api/project/boq");
  const { focus } = useFocus();
  const [form, setForm] = useState<Rec | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const lines = (data.lines as Rec[]).filter((l) => inFocus(focus, { activity: l.activity, package: l.package }) || (focus && !l.activity && l.package === focus.package));
  const value = lines.reduce((n, l) => n + l.value, 0);
  const groups = [...new Set(lines.map((l) => l.package))];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Bill of quantities" note="the contract's lines, each on its control account">
        <button disabled={!(data.packages as Rec[]).length} onClick={() => setForm({ name: "", unit: "m3", qty: "", unit_price: "", package: (data.packages as Rec[])[0]?.id, activity: "", area: "" })} className={quiet}>Add a line</button>
      </Bar>
      <Problem err={err} />
      <Kpis><Kpi label="lines" value={lines.length} /><Kpi label="value" value={money(value)} /><Kpi label="control accounts" value={groups.length} /></Kpis>
      {form && (
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_70px_90px_120px_150px_150px_auto] gap-2 border-b border-white/5 bg-[#1c2733] p-2 max-lg:grid-cols-2">
          <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item" className={field} />
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Unit" className={field} />
          <input type="number" min={0} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="Quantity" className={field} />
          <input type="number" min={0} value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="Rate, Rp" className={field} />
          <select aria-label="Package" value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} className={field}>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2733]">{p.name}</option>)}</select>
          <select aria-label="Work package it earns from" title="If you name a work package, this line earns value as it progresses" value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">No work package</option>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.id} {a.name}</option>)}</select>
          <button disabled={!form.name.trim() || !Number(form.qty) || !Number(form.unit_price)} onClick={async () => { if (await act(() => api("/api/project/boq", { ...form, qty: Number(form.qty), unit_price: Number(form.unit_price) }))) setForm(null); }} className={primary}>Add</button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#111820] p-3">
        {lines.length > 0 && (
          <Card title="The contract's value, by control account" right={<Legend items={[{ label: "verified done", color: ACTUAL }, { label: "where it should be by now", color: PLAN }]} />}>
            <div className="p-3"><ShareStrip parts={groups.map((g, i) => ({ key: g, label: lines.find((l) => l.package === g)?.package_name || "No package", value: lines.filter((l) => l.package === g).reduce((n, l) => n + l.value, 0), color: hue(i) }))} onPick={(k) => document.getElementById(`boq-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} /></div>
          </Card>
        )}
        {groups.map((g, i) => {
          const mine = lines.filter((l) => l.package === g), max = Math.max(...lines.map((l) => l.value), 1), total = mine.reduce((n, l) => n + l.value, 0);
          return (
            <Group key={g} id={`boq-${g}`} color={hue(i)} code={mine[0]?.wbs.split(".").slice(0, 2).join(".")} title={mine[0]?.package_name || "No package"} sub={`${mine.length} line${mine.length === 1 ? "" : "s"}`}
              right={<div className="text-right"><p className="text-[15px] font-bold tabular-nums text-white">{money(total)}</p><p className="text-[10.5px] text-[#8f99a8]">{value ? `${((total / value) * 100).toFixed(1)}% of the BoQ` : ""}</p></div>}>
              {mine.map((l) => (
                <Item key={l.id} wide code={l.wbs} title={l.name} meta={`${l.id}${l.area ? ` · ${l.area}` : ""} · ${num(l.qty)} ${l.unit} × Rp ${Number(l.unit_price).toLocaleString("en-US")}`}
                  visual={<span className="block space-y-1"><SizeBar value={l.value} max={max} color={hue(i)} title={money(l.value)} /><Progress done={l.verified_pct} planned={l.planned_pct} /></span>}
                  value={<><span className="block font-semibold">{money(l.value)}</span><span className="block text-[10.5px] font-normal text-[#8f99a8]">{l.verified_pct}% done · {l.planned_pct}% due</span></>} />
              ))}
            </Group>
          );
        })}
        {!lines.length && <Empty>No BoQ lines yet.</Empty>}
      </div>
    </div>
  );
}

function Takeoff() {
  const { data, err } = useData("/api/project/boq");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const v = data.takeoff as Rec | null;
  if (!v) return <div className="flex-1 bg-[#111820] text-[12px]"><Empty>The take-off and bill of materials come from the AI analysis. <button onClick={() => go("analysis")} className="underline">Open it</button>.</Empty></div>;
  const t = v.totals as Rec, track = v.tracking as Rec, flags = v.waste_flags as Rec[];
  const saving = flags.reduce((n, f) => n + (f.saving_rp || 0), 0);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title={`Take-off and bill of materials: ${v.plan.title}`} note={<span className="inline-flex items-center gap-1.5"><Pill tone={v.plan.status === "approved" ? "ok" : "warn"}>{v.plan.status}</Pill>{v.plan.id}</span>} />
      <Kpis>
        <Kpi label={`planned cost, BoQ ${money(t.boq_value)}`} value={money(track.planned)} tone={t.margin < 0 ? "warn" : "ok"} />
        <Kpi label="earned, from the board" value={money(track.earned)} />
        <Kpi label={`actual, from ${track.steps_recorded} tasks recorded`} value={money(track.actual)} />
        <Kpi label="material" value={money(t.material_cost)} />
        <Kpi label="material waste" value={money(t.waste_cost)} tone="warn" hint={saving ? `${money(saving)} could come out` : ""} />
      </Kpis>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#111820] p-3">
        <Card title="Quantity take-off: each worked out by code from the agent's sum, against the BoQ" right={<Legend items={[{ label: "worked out", color: ACTUAL }, { label: "in the BoQ", color: PLAN }]} />}>
          <div className="divide-y divide-white/[.04]">
            {(v.quantities as Rec[]).map((q) => {
              const max = Math.max(q.value, q.boq_qty ?? 0, 1);
              return (
                <Item key={q.id} wide code={q.id} title={<span className="font-medium text-white">{q.element}</span>}
                  meta={<><span className="font-mono">{q.expression}</span><span className="ml-2 inline-flex flex-wrap gap-1 align-middle">{(q.evidence as string[]).map((e) => <Ref key={e} to={`documents/register:${e}`}>{e}</Ref>)}</span></>}
                  visual={<span className="block space-y-1"><span className="flex items-center gap-2"><SizeBar value={q.value} max={max} color={ACTUAL} /><span className="w-[92px] shrink-0 text-right text-[10.5px] tabular-nums text-[#d3d8de]">{num(q.value, 2)} {q.unit}</span></span>{q.boq_qty != null && <span className="flex items-center gap-2"><SizeBar value={q.boq_qty} max={max} color={PLAN} /><span className="w-[92px] shrink-0 text-right text-[10.5px] tabular-nums text-[#8f99a8]">{num(q.boq_qty, 2)} {q.unit}</span></span>}</span>}
                  value={<span className="block text-right">{q.boq_diff_pct != null ? <Diverge value={q.boq_diff_pct} loud={3} title="Worked out against the BoQ" /> : <span className="text-[11px] text-[#8f99a8]">not in the BoQ</span>}{q.boq_exposure_rp ? <span className="mt-0.5 block text-[10.5px] text-[#fbd38d]">{money(q.boq_exposure_rp)} exposure</span> : null}</span>} />
              );
            })}
          </div>
        </Card>
        <Card title="Bill of materials: what to order, and the waste in it" right={<span className="flex items-center gap-3"><Legend items={[{ label: "used", color: SERIES[0] }, { label: "wasted", color: SERIES[1], hatched: true }]} /><button onClick={() => go("procurement/materials")} className={quiet}>Is it on order?</button></span>}>
          <p className="border-b border-white/[.04] px-3 py-1.5 text-[10.5px] text-[#8f99a8]">{String(v.source).split(",")[0]}</p>
          <div className="divide-y divide-white/[.04]">
            {(v.materials as Rec[]).map((m) => {
              const max = Math.max(...(v.materials as Rec[]).map((x) => x.cost), 1);
              return (
                <Item key={m.key} wide code={(m.steps as string[]).slice(0, 2).join(", ")} title={<span className="font-medium text-white">{m.name}</span>}
                  meta={<><span>Order {num(m.gross)} {m.unit}: {num(m.net)} needed{m.waste ? <span className="text-[#fbd38d]"> + {num(m.waste)} waste ({m.waste_pct}%)</span> : ", no waste stated"} · Rp {m.rate.toLocaleString("en-US")} a {m.unit}</span><span className="block text-[10px] text-[#6f7c8b]">{m.basis}</span></>}
                  visual={<SplitBar parts={[{ label: "used", value: m.cost - (m.waste_cost || 0), color: SERIES[0] }, { label: "wasted", value: m.waste_cost || 0, color: SERIES[1], hatched: true }]} max={max} />}
                  value={<><span className="block font-semibold">{money(m.cost)}</span>{m.waste_cost ? <span className="block text-[10.5px] font-normal text-[#fbd38d]">{money(m.waste_cost)} wasted</span> : null}</>} />
              );
            })}
          </div>
        </Card>
        <Card title="Cost by WBS section" right={<Legend items={[{ label: "labour", color: SERIES[0] }, { label: "material", color: SERIES[3] }, { label: "material wasted", color: SERIES[1], hatched: true }]} />}>
          <div className="divide-y divide-white/[.04]">
            {(v.by_section as Rec[]).map((s) => {
              const max = Math.max(...(v.by_section as Rec[]).map((x) => x.labour + x.material), 1);
              return (
                <Item key={s.code} wide code={s.code} title={s.name} meta={`${s.activity} · ${num(s.man_hours)} man-hours`} onClick={() => go(`wbs/tree:${s.code}`)}
                  visual={<SplitBar parts={[{ label: "labour", value: s.labour, color: SERIES[0] }, { label: "material", value: s.material - (s.waste || 0), color: SERIES[3] }, { label: "material wasted", value: s.waste || 0, color: SERIES[1], hatched: true }]} max={max} />}
                  value={<><span className="block font-semibold">{money(s.labour + s.material)}</span><span className="block text-[10.5px] font-normal text-[#8f99a8]">{money(s.labour)} labour</span></>} />
              );
            })}
          </div>
        </Card>
        <Card title={`Waste the agents would take out (${flags.length})`} right={saving ? <span className="text-[10.5px] font-normal text-[#8f99a8]">about {money(saving)}, their estimate</span> : undefined}>
          {flags.length ? flags.map((f, i) => (
            <div key={i} className="flex items-start gap-3 border-t border-white/5 px-3 py-2 first:border-t-0">
              <span className="shrink-0"><Pill tone="warn">{f.step}</Pill></span>
              <div className="min-w-0 flex-1"><p className="leading-snug text-[#e5e8eb]">{f.note}</p><p className="mt-0.5 text-[10.5px] text-[#8f99a8]">{f.kind} · {f.saving_rp ? `about ${full(f.saving_rp)} (${f.saving_expression})` : "no figure"}</p></div>
              <span className="flex flex-wrap gap-1">{(f.evidence as string[]).map((e) => <Ref key={e} to={`documents/register:${e}`}>{e}</Ref>)}</span>
            </div>
          )) : <Empty>None flagged.</Empty>}
        </Card>
      </div>
    </div>
  );
}

export function CostModule({ sub, target }: { sub: string; target: string }) {
  const tab = ["boq", "takeoff", "control", "claims"].includes(sub) ? sub : "estimate";
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SubTabs base="cost" sub={tab} tabs={[["estimate", "Estimate"], ["boq", "BOQ"], ["takeoff", "Take-off and BoM"]]} />
      {tab === "estimate" && <Estimate />}
      {tab === "control" && <Control target={target} />}
      {tab === "boq" && <Boq />}
      {tab === "takeoff" && <Takeoff />}
      {tab === "claims" && <ClaimsView />}
    </div>
  );
}
