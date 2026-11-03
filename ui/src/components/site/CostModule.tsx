"use client";
import { Fragment, useState } from "react";
import { api, Bar, Card, Empty, field, full, inFocus, Kpi, Kpis, Loading, money, num, Pill, primary, Problem, quiet, Ref, SubTabs, Table, td, tr, useData, useFocus, useGo, type Rec } from "./kit";
import { ClaimsView } from "./RecordsViews";

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
          {h && hover != null && <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#ffffff" strokeOpacity="0.25" /><circle cx={x(hover)} cy={y(h.cumulative)} r="3.5" fill="#8083e8" stroke="#1c2127" strokeWidth="1.5" /></g>}
          {points.map((p, i) => <rect key={p.week} x={x(i) - (W - L - R) / points.length / 2} y={T} width={(W - L - R) / points.length} height={H - T - B} fill="transparent" tabIndex={0} aria-label={`Week ${p.week}: ${p.cumulative}%`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} className="outline-none" />)}
        </svg>
        {h && hover != null && (
          <div className="pointer-events-none absolute top-1 z-10 w-[190px] rounded border border-white/15 bg-[#111418] p-2 text-[11px] text-[#d3d8de] shadow-lg" style={hover > points.length / 2 ? { right: `${100 - (x(hover) / W) * 100 + 1}%` } : { left: `${(x(hover) / W) * 100 + 1}%` }}>
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
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#161a1f] p-3">
        {curve.length > 0 && <Card title="Planned progress over time: the Kurva-S" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">read from the master schedule</span>}><SCurve points={curve} /></Card>}
        <Card title="By control account and work package">
          <Table heads={["WBS", "Work", "Worth", "Share", "Against the owner's estimate", "Tasks", "Man-hours"]}>
            {rows.map((a) => (
              <Fragment key={a.id}>
                <tr onClick={() => toggle(a.id)} className={`${tr} cursor-pointer bg-white/[.02]`}>
                  <td className={`${td} whitespace-nowrap font-mono text-[10.5px] text-[#8f99a8]`}>{a.code}</td>
                  <td className={`${td} font-semibold text-white`}><span className="mr-1.5 inline-block w-3 text-[#abb3bf]">{open.has(a.id) ? "▾" : "▸"}</span>{a.name}<span className="ml-1.5 text-[10.5px] font-normal text-[#8f99a8]">{a.id}</span></td>
                  <td className={`${td} whitespace-nowrap font-semibold text-white`}>{money(a.value)}</td>
                  <td className={`${td} tabular-nums`}>{data.total ? `${((a.value / data.total) * 100).toFixed(1)}%` : "–"}</td>
                  <td className={td}>{a.against_owner_pct == null ? "–" : <Pill tone={a.against_owner_pct <= -5 ? "warn" : "none"}>{a.against_owner_pct > 0 ? "+" : ""}{a.against_owner_pct}%</Pill>}</td>
                  <td className={`${td} tabular-nums`}>{a.tasks || "–"}</td><td className={`${td} tabular-nums`}>{a.man_hours ? num(a.man_hours, 0) : "–"}</td>
                </tr>
                {open.has(a.id) && (a.packages as Rec[]).map((w) => (
                  <tr key={w.id} onClick={() => go(`wbs/tree:${w.code}`)} className={`${tr} cursor-pointer`}>
                    <td className={`${td} whitespace-nowrap font-mono text-[10.5px] text-[#8f99a8]`}>{w.code}</td>
                    <td className={`${td} pl-8`}>{w.name}</td>
                    <td className={`${td} whitespace-nowrap`}>{w.value ? money(w.value) : "–"}</td>
                    <td className={`${td} tabular-nums`}>{w.weight != null ? `${w.weight}%` : "–"}</td><td className={td} />
                    <td className={`${td} tabular-nums`}>{w.tasks || "–"}</td><td className={`${td} tabular-nums`}>{w.man_hours ? num(w.man_hours, 0) : "–"}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </Table>
          {!rows.length && <Empty>Nothing to estimate yet. It comes from the AI analysis of the documents.</Empty>}
        </Card>
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
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#161a1f] p-3">
        <Card title="Control accounts">
          <Table heads={["Account", "Budget", "Committed", "Earned", "Actual", "Added by plans", "Forecast", "Variance", "CPI", "SPI"]}>
            {packages.map((p) => (
              <tr key={p.id} className={`${tr} ${target && p.id === target ? "bg-white/[.07]" : ""}`}>
                <td className={td}><span className="mr-1.5 text-[10.5px] text-[#8f99a8]">{p.id}</span><span className="text-white">{p.name}</span></td>
                <td className={td}>{money(p.budget)}</td><td className={td}>{money(p.committed)}</td><td className={td}>{money(p.ev)}</td><td className={td}>{money(p.ac)}</td>
                <td className={td}>{p.recovery ? money(p.recovery) : "–"}</td><td className={td}>{money(p.eac)}</td>
                <td className={`${td} ${p.variance < 0 ? "text-[#fbd38d]" : "text-[#7ee2c0]"}`}>{money(p.variance)}</td>
                <td className={td}><Pill tone={p.cpi < 1 ? "warn" : "ok"}>{Number(p.cpi).toFixed(2)}</Pill></td><td className={td}><Pill tone={p.spi < 1 ? "warn" : "ok"}>{Number(p.spi).toFixed(2)}</Pill></td>
              </tr>
            ))}
          </Table>
          {!packages.length && <Empty>No control accounts yet. They come from the AI analysis of the documents.</Empty>}
        </Card>
        <Card title={`Costs recorded (${items.length})`}>
          {form && (
            <div className="grid grid-cols-[120px_minmax(0,1fr)_140px_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-white/5 p-2 max-lg:grid-cols-2">
              <select aria-label="Package" value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} className={field}>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2127]">{p.id}</option>)}</select>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it is for" className={field} />
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount, Rp" className={field} />
              <input value={form.recoverable_from} onChange={(e) => setForm({ ...form, recoverable_from: e.target.value })} placeholder="Recoverable from (optional)" className={field} />
              <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-[#d3d8de]"><input type="checkbox" checked={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.checked })} />Already spent</label>
              <button disabled={!form.description.trim() || !Number(form.amount)} onClick={async () => { if (await act(() => api("/api/project/cost-items", { ...form, amount: Number(form.amount) }))) setForm(null); }} className={primary}>Add</button>
            </div>
          )}
          {items.length ? (
            <Table heads={["Item", "Package", "What", "Amount", "Kind", "Recoverable from", "Source"]}>
              {items.map((i) => <tr key={i.id} className={tr}><td className={td}>{i.id}</td><td className={td}>{i.package}</td><td className={`${td} text-white`}>{i.description}</td><td className={td}>{full(i.amount)}</td><td className={td}><Pill tone={i.actual ? "info" : "none"}>{i.actual ? "actual" : "forecast"}</Pill></td><td className={td}>{i.recoverable_from || "–"}</td><td className={td}>{i.source || "Added by hand"}</td></tr>)}
            </Table>
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
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_70px_90px_120px_150px_150px_auto] gap-2 border-b border-white/5 bg-[#1c2127] p-2 max-lg:grid-cols-2">
          <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item" className={field} />
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Unit" className={field} />
          <input type="number" min={0} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="Quantity" className={field} />
          <input type="number" min={0} value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="Rate, Rp" className={field} />
          <select aria-label="Package" value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} className={field}>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2127]">{p.name}</option>)}</select>
          <select aria-label="Work package it earns from" title="If you name a work package, this line earns value as it progresses" value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2127]">No work package</option>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2127]">{a.id} {a.name}</option>)}</select>
          <button disabled={!form.name.trim() || !Number(form.qty) || !Number(form.unit_price)} onClick={async () => { if (await act(() => api("/api/project/boq", { ...form, qty: Number(form.qty), unit_price: Number(form.unit_price) }))) setForm(null); }} className={primary}>Add</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["WBS", "Code", "Item", "Area", "Quantity", "Rate", "Value", "Planned", "Verified"]}>
          {groups.flatMap((g) => [
            <tr key={g} className="border-t border-white/10 bg-white/[.03]"><td className={`${td} font-mono text-[10.5px] text-[#8f99a8]`}>{lines.find((l) => l.package === g)?.wbs.split(".").slice(0, 2).join(".")}</td><td className={`${td} font-semibold text-white`} colSpan={5}>{lines.find((l) => l.package === g)?.package_name || "No package"}</td><td className={`${td} font-semibold text-white`}>{money(lines.filter((l) => l.package === g).reduce((n, l) => n + l.value, 0))}</td><td className={td} colSpan={2} /></tr>,
            ...lines.filter((l) => l.package === g).map((l) => (
              <tr key={l.id} className={tr}><td className={`${td} font-mono text-[10.5px] text-[#8f99a8]`}>{l.wbs}</td><td className={td}>{l.id}</td><td className={`${td} text-white`}>{l.name}</td><td className={td}>{l.area || "–"}</td><td className={td}>{num(l.qty)} {l.unit}</td><td className={td}>{Number(l.unit_price).toLocaleString("en-US")}</td><td className={td}>{money(l.value)}</td><td className={td}>{l.planned_pct}%</td><td className={td}>{l.verified_pct}%</td></tr>
            )),
          ])}
        </Table>
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
  if (!v) return <div className="flex-1 bg-[#161a1f] text-[12px]"><Empty>The take-off and bill of materials come from the AI analysis. <button onClick={() => go("analysis")} className="underline">Open it</button>.</Empty></div>;
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
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#161a1f] p-3">
        <Card title="Quantity take-off: each worked out by code from the agent's sum, against the BoQ">
          <Table heads={["Quantity", "The sum", "Worked out", "BoQ", "Difference", "Exposure", "Source"]}>
            {(v.quantities as Rec[]).map((q) => <tr key={q.id} className={tr}><td className={`${td} font-medium text-white`}>{q.element}</td><td className={`${td} font-mono text-[11px]`}>{q.expression}</td><td className={td}>{num(q.value, 2)} {q.unit}</td><td className={td}>{q.boq_qty != null ? `${num(q.boq_qty, 2)} ${q.unit}` : "–"}</td><td className={td}>{q.boq_diff_pct != null ? <Pill tone={Math.abs(q.boq_diff_pct) > 3 ? "bad" : "ok"}>{q.boq_diff_pct > 0 ? "+" : ""}{q.boq_diff_pct}%</Pill> : "–"}</td><td className={td}>{q.boq_exposure_rp ? money(q.boq_exposure_rp) : "–"}</td><td className={td}><span className="flex flex-wrap gap-1">{(q.evidence as string[]).map((e) => <Ref key={e} to={`documents/register:${e}`}>{e}</Ref>)}</span></td></tr>)}
          </Table>
        </Card>
        <Card title="Bill of materials: what to order, and the waste in it" right={<span className="flex items-center gap-2"><span className="text-[10.5px] font-normal text-[#8f99a8]">{String(v.source).split(",")[0]}</span><button onClick={() => go("procurement/materials")} className={quiet}>Is it on order?</button></span>}>
          <Table heads={["Material", "Net need", "Waste", "To order", "Rate (Rp)", "Cost (Rp)", "Waste (Rp)", "Tasks", "Where the waste figure comes from"]}>
            {(v.materials as Rec[]).map((m) => <tr key={m.key} className={tr}><td className={`${td} font-medium text-white`}>{m.name}</td><td className={td}>{num(m.net)} {m.unit}</td><td className={`${td} ${m.waste ? "text-[#fbd38d]" : "text-[#8f99a8]"}`}>{m.waste ? `${num(m.waste)} (${m.waste_pct}%)` : "none stated"}</td><td className={td}>{num(m.gross)} {m.unit}</td><td className={td}>{m.rate.toLocaleString("en-US")}</td><td className={td}>{m.cost.toLocaleString("en-US")}</td><td className={td}>{m.waste_cost ? m.waste_cost.toLocaleString("en-US") : "–"}</td><td className={td}>{(m.steps as string[]).join(", ")}</td><td className={`${td} text-[11px] text-[#abb3bf]`}>{m.basis}</td></tr>)}
          </Table>
        </Card>
        <Card title="Cost by WBS section">
          <Table heads={["WBS", "Section", "Work package", "Man-hours", "Labour", "Material", "Waste", "Total"]}>
            {(v.by_section as Rec[]).map((s) => <tr key={s.code} onClick={() => go(`wbs/tree:${s.code}`)} className={`${tr} cursor-pointer`}><td className={`${td} font-mono text-[10.5px] text-[#8f99a8]`}>{s.code}</td><td className={`${td} text-white`}>{s.name}</td><td className={td}>{s.activity}</td><td className={td}>{num(s.man_hours)}</td><td className={td}>{money(s.labour)}</td><td className={td}>{money(s.material)}</td><td className={td}>{s.waste ? money(s.waste) : "–"}</td><td className={td}>{money(s.labour + s.material)}</td></tr>)}
          </Table>
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
