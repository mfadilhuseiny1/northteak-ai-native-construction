"use client";
import { useState } from "react";
import { AgentBar } from "./AgentBar";
import { api, Bar, clean, Empty, field, inFocus, inline, Kpi, Kpis, Label, Loading, money, num, Pill, primary, Problem, quiet, Ref, short, Side, SubTabs, Table, td, tr, useData, useFocus, useGo, type Rec, type Tone } from "./kit";
import { SubcontractorsView } from "./SubcontractorsView";

/* Module 6, Procurement & Subcontractors: is the material and the crew there? Orders against the dates the schedule needs them, what the work plan needs against what is ordered, who supplies it, and who is programmed on what. */

const PO_TONE: Record<string, Tone> = { "delay reported": "bad", confirmed: "info", ordered: "info", received: "ok", requested: "warn" };
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
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_180px_120px_130px_130px_110px_auto] gap-2 border-b border-white/5 bg-[#1c2127] p-2 max-lg:grid-cols-2">
          <input autoFocus value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="What" className={field} />
          <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Supplier" className={field} />
          <select aria-label="Activity" value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2127]">No activity</option>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2127]">{a.id}</option>)}</select>
          <input type="date" aria-label="Needed" title="Needed" value={form.needed} onChange={(e) => setForm({ ...form, needed: e.target.value })} className={field} />
          <input type="date" aria-label="Promised" title="Promised" value={form.promised} onChange={(e) => setForm({ ...form, promised: e.target.value })} className={field} />
          <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Value, Rp" className={field} />
          <button disabled={!form.item.trim() || !form.supplier.trim() || !form.needed} onClick={async () => { if (await act(() => api("/api/project/orders", { ...form, value: Number(form.value) || 0 }))) setForm(null); }} className={primary}>Place</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["Order", "Item", "Supplier", "Holds", "Needed", "Promised", "Status", "Value", ""]}>
          {rows.map((p) => {
            const isLate = p.status !== "received" && p.promised > p.needed;
            return (
              <tr key={p.id} className={`${tr} ${target === p.id ? "bg-white/[.07]" : ""}`}>
                <td className={`${td} font-medium text-white`}>{p.id}</td>
                <td className={td}>{p.item}{p.note && <p className="text-[10.5px] text-[#8f99a8]">{p.note}</p>}</td>
                <td className={td}>{clean(p.supplier)}</td><td className={td}>{p.activity ? <Ref to={`schedule/gantt:${p.activity}`}>{p.activity}</Ref> : "–"}</td><td className={`${td} whitespace-nowrap`}>{short(p.needed)}</td>
                <td className={`${td} whitespace-nowrap ${isLate ? "font-medium text-[#ffb4b4]" : ""}`}>{short(p.promised)}</td>
                <td className={td}><Pill tone={PO_TONE[p.status] ?? "none"}>{p.status}</Pill></td><td className={`${td} whitespace-nowrap`}>{money(p.value)}</td>
                <td className={td}>
                  {p.status === "requested" ? (
                    <span className="flex items-center gap-1">
                      <input value={names[p.id] ?? ""} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })} placeholder="Supplier" aria-label={`Supplier for ${p.id}`} className={`${inline} w-[120px]`} />
                      <input type="date" aria-label={`Promised date for ${p.id}`} value={dates[p.id] ?? ""} onChange={(e) => setDates({ ...dates, [p.id]: e.target.value })} className={`${inline} w-[126px]`} />
                      <button disabled={!names[p.id]?.trim()} onClick={() => act(() => api(`/api/project/orders/${p.id}/assign`, { supplier: names[p.id], promised: dates[p.id] ?? "" }))} className={quiet}>Place</button>
                    </span>
                  ) : p.status !== "received" && (
                    <span className="flex items-center gap-1">
                      <input type="date" aria-label={`New promised date for ${p.id}`} value={dates[p.id] ?? ""} onChange={(e) => setDates({ ...dates, [p.id]: e.target.value })} className={`${inline} w-[126px]`} />
                      <button disabled={!dates[p.id]} onClick={() => act(() => api(`/api/project/orders/${p.id}/promise`, { promised: dates[p.id] }))} className={quiet}>Update</button>
                      <button onClick={() => act(() => api(`/api/project/orders/${p.id}/receive`, {}))} className={quiet}>Received</button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
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
  if (!data.plan) return <div className="flex-1 bg-[#161a1f] text-[12px]"><Empty>What the work needs comes from a work plan. <button onClick={() => go("wbs/plan")} className="underline">Open Work plan</button>.</Empty></div>;
  const count = (s: string) => rows.filter((m) => m.state === s).length;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Material availability" note={`what ${data.plan.id}, ${data.plan.title}, needs against what is ordered`}><button onClick={() => go("cost/takeoff")} className={quiet}>The bill of materials</button></Bar>
      <Problem err={err} />
      <Kpis><Kpi label="on site" value={count("available")} tone="ok" /><Kpi label="on order" value={count("on_order")} /><Kpi label="not ordered" value={count("not_ordered") + count("not_requested")} tone={count("not_ordered") ? "warn" : undefined} /><Kpi label="arrive late" value={count("late")} tone={count("late") ? "bad" : "ok"} /></Kpis>
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["Material", "To order", "Value", "First needed", "For tasks", "Order", "Supplier", "Promised", "State", "Worth a check"]}>
          {rows.map((m) => (
            <tr key={m.key} className={tr}>
              <td className={`${td} font-medium text-white`}>{m.name}</td><td className={`${td} whitespace-nowrap`}>{num(m.gross)} {m.unit}</td><td className={`${td} whitespace-nowrap`}>{money(m.cost)}</td><td className={`${td} whitespace-nowrap`}>{short(m.needed)}</td><td className={td}>{(m.tasks as string[]).join(", ")}</td>
              <td className={td}>{m.order ? <Ref to={`procurement/orders:${m.order}`}>{m.order}</Ref> : "–"}</td><td className={td}>{m.supplier ? clean(m.supplier) : "–"}</td><td className={`${td} whitespace-nowrap`}>{short(m.promised)}</td>
              <td className={td}><Pill tone={STATE[m.state][1]}>{STATE[m.state][0]}</Pill></td>
              <td className={td}>{(m.maybe_covered_by as string[]).length ? <span className="text-[#fbd38d]">{(m.maybe_covered_by as string[]).join(", ")} may already cover this</span> : ""}</td>
            </tr>
          ))}
        </Table>
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
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["Supplier", "Orders", "Open", "Received", "Late", "Value", "Which"]}>
          {rows.map((s) => <tr key={s.name} className={tr}><td className={`${td} font-medium text-white`}>{clean(s.name)}</td><td className={td}>{s.orders}</td><td className={td}>{s.open}</td><td className={td}>{s.received}</td><td className={td}>{s.late ? <Pill tone="bad">{s.late}</Pill> : "–"}</td><td className={`${td} whitespace-nowrap`}>{money(s.value)}</td><td className={td}><span className="flex flex-wrap gap-1">{(s.items as string[]).map((x) => <Ref key={x} to={`procurement/orders:${x}`}>{x}</Ref>)}</span></td></tr>)}
        </Table>
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
        <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
          <Table heads={["WBS", "Activity", "Dates", "Programmed", "The work needs", "Sections", "Peak · crew", "Standing", ""]}>
            {rows.map((r) => (
              <tr key={r.id} className={`${tr} ${target && r.by === target ? "bg-white/[.07]" : ""}`}>
                <td className={`${td} whitespace-nowrap font-mono text-[10.5px] text-[#8f99a8]`}>{r.code}</td><td className={td}><span className="text-white">{r.activity}</span> {r.name}{r.critical && <span className="ml-1 text-[10px] text-[#fbd38d]">critical</span>}</td><td className={`${td} whitespace-nowrap`}>{short(r.start)} – {short(r.finish)}</td><td className={td}>{r.programmed_name}</td>
                <td className={td}>{r.gap ? <Pill tone="warn">{r.by_name}</Pill> : r.by_name}</td><td className={td}>{(r.sections as string[]).join(", ") || "–"}</td><td className={td}>{r.peak != null ? <span className={r.over ? "font-medium text-[#ffb4b4]" : ""}>{r.peak} · {r.crew ?? "–"}</span> : "–"}</td>
                <td className={td}>{r.expired.length ? <Ref to={`procurement/subs:${r.by}`} tone="bad">{r.expired[0]} expired</Ref> : r.open_ncrs.length ? <Ref to={`quality/ncrs:${r.open_ncrs[0]}`} tone="bad">{r.open_ncrs[0]}</Ref> : r.rating ? <Pill tone={r.rating === "good" ? "ok" : "warn"}>{r.rating}</Pill> : "–"}</td>
                <td className={td}><span className="flex gap-1">{r.gap && <button onClick={() => act(() => api("/api/project/assignments", { activity: r.activity, by: r.by }))} className={quiet}>Programme them</button>}{(r.sections as string[]).length > 0 && <button onClick={() => setMoving({ activity: r.activity, section: (r.sections as string[])[0], sections: r.sections, by: r.by })} className={quiet}>Move to…</button>}</span></td>
              </tr>
            ))}
          </Table>
          {!rows.length && <Empty>No activities yet.</Empty>}
        </div>
      </div>
      {moving && (
        <Side eyebrow={moving.activity} title="Move a section to another crew" onClose={() => setMoving(null)}>
          <label className="block"><Label>Section</Label><select value={moving.section} onChange={(e) => setMoving({ ...moving, section: e.target.value })} className={field}>{(moving.sections as string[]).map((s) => <option key={s} value={s} className="bg-[#1c2127]">{s}</option>)}</select></label>
          <label className="block"><Label>Crew</Label><select value={moving.by} onChange={(e) => setMoving({ ...moving, by: e.target.value })} className={field}><option value="self" className="bg-[#1c2127]">Own crew</option>{(data.subs as Rec[]).map((s) => <option key={s.id} value={s.id} className="bg-[#1c2127]">{s.name}</option>)}</select></label>
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
