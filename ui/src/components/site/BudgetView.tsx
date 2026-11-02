"use client";
import { useState } from "react";
import { api, Bar, Card, field, full, Kpi, Kpis, Loading, money, Pill, primary, Problem, quiet, Table, td, tr, useData, type Rec } from "./kit";

/* Budget and cost control: earned value worked out from verified progress, per work package. A recovery plan's approved cost lands here. */

const EMPTY = { package: "WP-CON", description: "", amount: "", recoverable_from: "" };

export function BudgetView() {
  const { data, err, act } = useData("/api/project/budget");
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const t = data.total as Rec;
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Budget and cost" note="earned value from verified progress, by work package">
        <button onClick={() => setForm({ ...EMPTY })} className={quiet}>Add a cost</button>
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
        <Card title="Work packages">
          <Table heads={["Package", "Budget", "Committed", "Earned", "Actual", "Added by plans", "Forecast", "Variance", "CPI", "SPI"]}>
            {(data.packages as Rec[]).map((p) => (
              <tr key={p.id} className={tr}>
                <td className={td}><span className="mr-1.5 text-[10.5px] text-[#8f99a8]">{p.id}</span><span className="text-white">{p.name}</span></td>
                <td className={td}>{money(p.budget)}</td><td className={td}>{money(p.committed)}</td><td className={td}>{money(p.ev)}</td><td className={td}>{money(p.ac)}</td>
                <td className={td}>{p.recovery ? money(p.recovery) : "–"}</td><td className={td}>{money(p.eac)}</td>
                <td className={`${td} ${p.variance < 0 ? "text-[#fbd38d]" : "text-[#7ee2c0]"}`}>{money(p.variance)}</td>
                <td className={td}><Pill tone={p.cpi < 1 ? "warn" : "ok"}>{Number(p.cpi).toFixed(2)}</Pill></td><td className={td}><Pill tone={p.spi < 1 ? "warn" : "ok"}>{Number(p.spi).toFixed(2)}</Pill></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Costs added to the forecast (${data.cost_items.length})`}>
          {form && (
            <div className="grid grid-cols-[120px_minmax(0,1fr)_140px_minmax(0,1fr)_auto] gap-2 border-b border-white/5 p-2 max-lg:grid-cols-2">
              <select aria-label="Package" value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} className={field}>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2127]">{p.id}</option>)}</select>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it is for" className={field} />
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount, Rp" className={field} />
              <input value={form.recoverable_from} onChange={(e) => setForm({ ...form, recoverable_from: e.target.value })} placeholder="Recoverable from (optional)" className={field} />
              <button disabled={!form.description.trim() || !Number(form.amount)} onClick={async () => { if (await act(() => api("/api/project/cost-items", { ...form, amount: Number(form.amount) }))) setForm(null); }} className={primary}>Add</button>
            </div>
          )}
          {data.cost_items.length ? (
            <Table heads={["Item", "Package", "What", "Amount", "Recoverable from", "Source"]}>
              {(data.cost_items as Rec[]).map((i) => (
                <tr key={i.id} className={tr}><td className={td}>{i.id}</td><td className={td}>{i.package}</td><td className={`${td} text-white`}>{i.description}</td><td className={td}>{full(i.amount)}</td><td className={td}>{i.recoverable_from || "–"}</td><td className={td}>{i.source || "Added by hand"}</td></tr>
              ))}
            </Table>
          ) : <p className="p-4 text-center text-[#8f99a8]">Nothing yet. Costs land here when a recovery plan is approved.</p>}
        </Card>
      </div>
    </div>
  );
}
