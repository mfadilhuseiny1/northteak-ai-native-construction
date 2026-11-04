"use client";
import { useState } from "react";
import { AgentBar } from "./AgentBar";
import { api, Bar, clean, Empty, field, inFocus, inline, Kpi, Kpis, Label, Loading, money, num, Pill, primary, Problem, quiet, Ref, short, Side, SubTabs, useData, useFocus, useGo, type Rec, type Tone } from "./kit";
import { SubcontractorsView } from "./SubcontractorsView";
import { Item, SizeBar, SplitBar } from "./Visual";

/* Module 6, Procurement & Subcontractors: is the material and the crew there? Orders against the dates the schedule needs them, what the work plan needs against what is ordered, who supplies it, and who is programmed on what. */

const PO_TONE: Record<string, Tone> = { "delay reported": "bad", confirmed: "info", ordered: "info", received: "ok", requested: "warn" };
const STATE_COLOR: Record<string, string> = { available: "#29a383", on_order: "#3987e5", late: "#f87171", not_ordered: "#fab219", not_requested: "#8f99a8" };
const STATE: Record<string, [string, Tone]> = { available: ["on site", "ok"], on_order: ["on order", "info"], late: ["arrives late", "bad"], not_ordered: ["not ordered", "warn"], not_requested: ["waiting for the plan's approval", "none"] };

function Orders({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/procurement");
  const { focus } = useFocus();
  const [dates, setDates] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Rec | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const all = data.orders as Rec[];
  const rows = all.filter((p) => inFocus(focus, { activity: p.activity, package: p.package }));
  const late = rows.filter((p) => p.status !== "received" && p.promised > p.needed);
  const waiting = rows.filter((p) => p.status === "requested");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Orders" note="against the dates the schedule needs them">
        <button onClick={() => setForm({ item: "", supplier: "", activity: focus?.activities[0] ?? "", needed: "", promised: "", value: "" })} className={primary}>Place an order</button>
      </Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label="orders" value={rows.length} />
        <Kpi label="requests to place" value={waiting.length} tone={waiting.length ? "warn" : undefined} />
        <Kpi label="late against need" value={late.length} tone={late.length ? "bad" : "ok"} />
        <Kpi label="received" value={rows.filter((p) => p.status === "received").length} />
        <Kpi label="order value" value={money(rows.reduce((n, p) => n + p.value, 0))} />
      </Kpis>
      {form && (
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_180px_120px_130px_130px_110px_auto] gap-2 border-b border-white/5 bg-[#1c2733] p-2 max-lg:grid-cols-2">
          <input autoFocus value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="What" className={field} />
          <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Supplier" className={field} />
          <select aria-label="Activity" value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">No activity</option>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.id}</option>)}</select>
          <input type="date" aria-label="Needed" title="Needed" value={form.needed} onChange={(e) => setForm({ ...form, needed: e.target.value })} className={field} />
          <input type="date" aria-label="Promised" title="Promised" value={form.promised} onChange={(e) => setForm({ ...form, promised: e.target.value })} className={field} />
          <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Value, Rp" className={field} />
          <button disabled={!form.item.trim() || !form.supplier.trim() || !form.needed} onClick={async () => { if (await act(() => api("/api/project/orders", { ...form, value: Number(form.value) || 0 }))) setForm(null); }} className={primary}>Place</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
        <div className="divide-y divide-white/[.05]">
          {rows.map((p) => {
            const isLate = p.status !== "received" && p.promised > p.needed;
            const gap = p.promised && p.needed ? Math.round((Date.parse(p.promised) - Date.parse(p.needed)) / 86400000) : 0;
            return (
              <div key={p.id} className={target === p.id ? "bg-white/[.07]" : ""}>
                <Item code={p.id} title={<span className="font-medium text-white">{p.item}</span>}
                  meta={<>{clean(p.supplier)}{p.activity ? <> · holds <Ref to={`schedule/gantt:${p.activity}`}>{p.activity}</Ref></> : null}{p.note ? <span className="block">{p.note}</span> : null}</>}
                  visual={<span className="block text-[10.5px]"><span className="flex items-center gap-1.5 text-[#abb3bf]"><span>needed {short(p.needed)}</span><span className="h-px flex-1 bg-white/15" /><span className={isLate ? "font-semibold text-[#ffb4b4]" : ""}>promised {short(p.promised)}</span></span><span className={`mt-0.5 block ${isLate ? "text-[#ffb4b4]" : "text-[#7ee2c0]"}`}>{p.status === "received" ? "received" : isLate ? `${gap} day${gap === 1 ? "" : "s"} after it is needed` : "in time"}</span></span>}
                  value={<span className="flex items-center justify-end gap-2"><Pill tone={PO_TONE[p.status] ?? "none"}>{p.status}</Pill><b className="font-semibold">{money(p.value)}</b></span>} />
                {p.status !== "received" && (
                  <div className="flex flex-wrap items-center gap-1 px-3 pb-2 pl-[76px]">
                    {p.status === "requested" ? (
                      <>
                        <input value={names[p.id] ?? ""} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })} placeholder="Supplier" aria-label={`Supplier for ${p.id}`} className={`${inline} w-[140px]`} />
                        <input type="date" aria-label={`Promised date for ${p.id}`} value={dates[p.id] ?? ""} onChange={(e) => setDates({ ...dates, [p.id]: e.target.value })} className={`${inline} w-[126px]`} />
                        <button disabled={!names[p.id]?.trim()} onClick={() => act(() => api(`/api/project/orders/${p.id}/assign`, { supplier: names[p.id], promised: dates[p.id] ?? "" }))} className={quiet}>Place</button>
                      </>
                    ) : (
                      <>
                        <input type="date" aria-label={`New promised date for ${p.id}`} value={dates[p.id] ?? ""} onChange={(e) => setDates({ ...dates, [p.id]: e.target.value })} className={`${inline} w-[126px]`} />
                        <button disabled={!dates[p.id]} onClick={() => act(() => api(`/api/project/orders/${p.id}/promise`, { promised: dates[p.id] }))} className={quiet}>Update</button>
                        <button onClick={() => act(() => api(`/api/project/orders/${p.id}/receive`, {}))} className={quiet}>Received</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!rows.length && <Empty>No orders yet.</Empty>}
      </div>
    </div>
  );
}

function Materials() {
  const { data, err } = useData("/api/project/materials");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.materials as Rec[];
  if (!data.plan) return <div className="flex-1 bg-[#111820] text-[12px]"><Empty>What the work needs comes from a work plan. <button onClick={() => go("wbs/plan")} className="underline">Open Work plan</button>.</Empty></div>;
  const count = (s: string) => rows.filter((m) => m.state === s).length;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Material availability" note={`what ${data.plan.id}, ${data.plan.title}, needs against what is ordered`}><button onClick={() => go("cost/takeoff")} className={quiet}>The bill of materials</button></Bar>
      <Problem err={err} />
      <Kpis><Kpi label="on site" value={count("available")} tone="ok" /><Kpi label="on order" value={count("on_order")} /><Kpi label="not ordered" value={count("not_ordered") + count("not_requested")} tone={count("not_ordered") ? "warn" : undefined} /><Kpi label="arrive late" value={count("late")} tone={count("late") ? "bad" : "ok"} /></Kpis>
      <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
        <div className="divide-y divide-white/[.05]">
          {rows.map((m) => {
            const max = Math.max(...rows.map((x) => x.cost), 1);
            return (
              <Item key={m.key} wide code={m.order ? <Ref to={`procurement/orders:${m.order}`}>{m.order}</Ref> : "–"} title={<span className="font-medium text-white">{m.name}</span>}
                meta={<>{num(m.gross)} {m.unit} for {(m.tasks as string[]).join(", ")} · needed {short(m.needed)}{m.supplier ? ` · ${clean(m.supplier)}, promised ${short(m.promised)}` : ""}{(m.maybe_covered_by as string[]).length ? <span className="block text-[#fbd38d]">{(m.maybe_covered_by as string[]).join(", ")} may already cover this</span> : null}</>}
                visual={<SizeBar value={m.cost} max={max} color={STATE_COLOR[m.state] ?? "#8f99a8"} title={money(m.cost)} />}
                value={<span className="flex items-center justify-end gap-2"><Pill tone={STATE[m.state][1]}>{STATE[m.state][0]}</Pill><b className="font-semibold">{money(m.cost)}</b></span>} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Suppliers() {
  const { data, err } = useData("/api/project/suppliers");
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.suppliers as Rec[];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Suppliers" note="read from the orders" />
      <Problem err={err} />
      <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
        <div className="divide-y divide-white/[.05]">
          {rows.map((x) => (
            <Item key={x.name} code={`${x.orders} PO`} title={<span className="font-medium text-white">{clean(x.name)}</span>}
              meta={<span className="flex flex-wrap gap-1">{(x.items as string[]).map((o) => <Ref key={o} to={`procurement/orders:${o}`}>{o}</Ref>)}</span>}
              visual={<span className="block"><SplitBar parts={[{ label: "received", value: x.received, color: "#29a383" }, { label: "open, in time", value: Math.max(0, x.open - x.late), color: "#3987e5" }, { label: "late", value: x.late, color: "#f87171" }]} max={Math.max(...rows.map((y) => y.orders), 1)} /><span className="mt-0.5 block text-[10.5px] text-[#8f99a8]">{x.received} received · {x.open} open{x.late ? <span className="text-[#ffb4b4]"> · {x.late} late</span> : ""}</span></span>}
              value={<b className="font-semibold">{money(x.value)}</b>} />
          ))}
        </div>
        {!rows.length && <Empty>No suppliers yet: they come from the orders.</Empty>}
      </div>
    </div>
  );
}

function Assignments({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/assignments");
  const { focus } = useFocus();
  const [moving, setMoving] = useState<Rec | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = (data.rows as Rec[]).filter((r) => inFocus(focus, { activity: r.activity }));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Subcontractor assignments" note="who is programmed on what, against who the work plan needs" />
        <Problem err={err} />
        <Kpis><Kpi label="not programmed where the plan needs them" value={data.gaps} tone={data.gaps ? "warn" : "ok"} /><Kpi label="more than their crew" value={rows.filter((r) => r.over).length} tone={rows.some((r) => r.over) ? "bad" : "ok"} /></Kpis>
        <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
          <div className="divide-y divide-white/[.05]">
            {rows.map((r) => (
              <div key={r.id} className={target && r.by === target ? "bg-white/[.07]" : ""}>
                <Item code={r.code} title={<span className="flex flex-wrap items-center gap-1.5"><span className="text-white">{r.activity}</span><span className="text-[#e5e8eb]">{r.name}</span>{r.critical && <span className="text-[10px] font-semibold text-[#fbd38d]">critical</span>}</span>}
                  meta={<>{short(r.start)} – {short(r.finish)} · programmed: {r.programmed_name} · the work needs: {r.gap ? <span className="text-[#fbd38d]">{r.by_name}</span> : r.by_name}{(r.sections as string[]).length ? ` · sections ${(r.sections as string[]).join(", ")}` : ""}</>}
                  visual={r.peak != null ? <span className="block"><span className="relative block h-2.5 w-full rounded-full bg-white/[.06]"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.peak / Math.max(r.peak, r.crew ?? 0, 1)) * 100}%`, background: r.over ? "#f87171" : "#3987e5" }} />{r.crew != null && <span className="absolute -inset-y-1 w-[2px] rounded bg-white" style={{ left: `calc(${(r.crew / Math.max(r.peak, r.crew, 1)) * 100}% - 1px)` }} />}</span><span className={`mt-0.5 block text-[10.5px] ${r.over ? "text-[#ffb4b4]" : "text-[#8f99a8]"}`}>peak {r.peak} · crew {r.crew ?? "–"}</span></span> : null}
                  value={r.expired.length ? <Ref to={`procurement/subs:${r.by}`} tone="bad">{r.expired[0]} expired</Ref> : r.open_ncrs.length ? <Ref to={`quality/ncrs:${r.open_ncrs[0]}`} tone="bad">{r.open_ncrs[0]}</Ref> : r.rating ? <Pill tone={r.rating === "good" ? "ok" : "warn"}>{r.rating}</Pill> : null} />
                {(r.gap || (r.sections as string[]).length > 0) && <div className="flex gap-1 px-3 pb-2 pl-[76px]">{r.gap && <button onClick={() => act(() => api("/api/project/assignments", { activity: r.activity, by: r.by }))} className={quiet}>Programme them</button>}{(r.sections as string[]).length > 0 && <button onClick={() => setMoving({ activity: r.activity, section: (r.sections as string[])[0], sections: r.sections, by: r.by })} className={quiet}>Move to…</button>}</div>}
              </div>
            ))}
          </div>
          {!rows.length && <Empty>No activities yet.</Empty>}
        </div>
      </div>
      {moving && (
        <Side eyebrow={moving.activity} title="Move a section to another crew" onClose={() => setMoving(null)}>
          <label className="block"><Label>Section</Label><select value={moving.section} onChange={(e) => setMoving({ ...moving, section: e.target.value })} className={field}>{(moving.sections as string[]).map((s) => <option key={s} value={s} className="bg-[#1c2733]">{s}</option>)}</select></label>
          <label className="block"><Label>Crew</Label><select value={moving.by} onChange={(e) => setMoving({ ...moving, by: e.target.value })} className={field}><option value="self" className="bg-[#1c2733]">Own crew</option>{(data.subs as Rec[]).map((s) => <option key={s.id} value={s.id} className="bg-[#1c2733]">{s.name}</option>)}</select></label>
          <button onClick={async () => { if (await act(() => api("/api/project/assignments", { activity: moving.activity, section: moving.section, by: moving.by }))) setMoving(null); }} className={`${primary} w-full`}>Move its open tasks on the board</button>
          <p className="text-[11px] text-[#abb3bf]">Their cards go to that crew. The plan&apos;s figures stay as they were.</p>
        </Side>
      )}
    </div>
  );
}

export function ProcurementModule({ sub, target }: { sub: string; target: string }) {
  const tab = ["materials", "suppliers", "subs", "assignments"].includes(sub) ? sub : "orders";
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SubTabs base="procurement" sub={tab} tabs={[["orders", "Purchase orders"], ["materials", "Material availability"], ["suppliers", "Suppliers"], ["subs", "Subcontractors"], ["assignments", "Assignments"]]} />
      <AgentBar module="procurement" />
      {tab === "orders" && <Orders target={target} />}
      {tab === "materials" && <Materials />}
      {tab === "suppliers" && <Suppliers />}
      {tab === "subs" && <SubcontractorsView target={target} />}
      {tab === "assignments" && <Assignments target={target} />}
    </div>
  );
}
