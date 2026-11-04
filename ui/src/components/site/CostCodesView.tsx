"use client";
import { useState } from "react";
import { useMe } from "./Account";
import { api, Bar, field, Kpi, Kpis, Label, Loading, money, notifyChanged, primary, Problem, quiet, Side, useData, type Rec } from "./kit";
import { Group, hue, Item } from "./Visual";

/* The firm's cost codes on this project: one list every job shares, so cost on one job can be compared with the next whatever its documents call the work. Each work package gets a code from the words in its name, and a person can change it. Accounting gets a file with a date and an amount on every line. */

function FirmList({ codes, onClose, onSaved }: { codes: Rec[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Rec[]>(codes.map((c) => ({ ...c, words: (c.words as string[]).join(", ") })));
  const [err, setErr] = useState("");
  const change = (i: number, key: string, value: string) => setRows(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
  const save = async () => {
    setErr("");
    try { await api("/api/standards/cost-codes", { codes: rows.map((r) => ({ ...r, words: String(r.words).split(",") })) }); notifyChanged(); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Side eyebrow="The firm's list" title="Cost codes" onClose={onClose}>
      <p className="leading-snug text-[#abb3bf]">Every project shares this list. The words decide which code a work package gets. A starting list, not a published standard: make it the firm&apos;s own.</p>
      {rows.map((r, i) => (
        <div key={i} className="space-y-1 rounded-lg bg-white/[.03] p-2">
          <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-1"><input aria-label="Code" value={r.code} onChange={(e) => change(i, "code", e.target.value)} className={field} /><input aria-label="Name" value={r.name} onChange={(e) => change(i, "name", e.target.value)} className={field} /></div>
          <input aria-label="Words" value={r.words} placeholder="words that point to it, separated by commas" onChange={(e) => change(i, "words", e.target.value)} className={field} />
        </div>
      ))}
      <button onClick={() => setRows([...rows, { code: "", name: "", words: "" }])} className={`${quiet} w-full`}>Add a code</button>
      {err && <p role="alert" className="text-[12px] text-[#ffb4b4]">{err}</p>}
      <button onClick={() => void save()} className={`${primary} w-full`}>Save the list</button>
    </Side>
  );
}

export function CostCodesView() {
  const { data, err, act, reload } = useData("/api/project/cost-codes");
  const firm = useData("/api/reports/cost-codes");
  const me = useMe();
  const [editing, setEditing] = useState(false);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const totals = data.totals as Rec[], rows = data.rows as Rec[], codes = data.codes as Rec[];
  const value = totals.reduce((n, t) => n + t.value, 0), actual = totals.reduce((n, t) => n + t.actual, 0);
  const names = (firm.data?.projects ?? []) as string[];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Bar title="Cost codes" note="the firm's own list, so one job compares with the next">
          {(me?.can as string[] | undefined)?.includes("team") && <button onClick={() => setEditing(true)} className={quiet}>The firm&apos;s list</button>}
          <a href="/api/project/export/accounting.csv" download className={primary}>Export for accounting</a>
        </Bar>
        <Problem err={err} />
        <Kpis>
          <Kpi label="contract value coded" value={money(value)} />
          <Kpi label="actual cost" value={money(actual)} />
          <Kpi label="codes in use" value={totals.length} />
          <Kpi label="left as other" value={data.other} tone={data.other ? "warn" : "ok"} hint={data.other ? "needs a code" : ""} />
        </Kpis>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#111820] p-3">
          {totals.map((t, i) => (
            <Group key={t.code} color={hue(i)} code={t.code} title={t.name} sub={`${t.packages} work package${t.packages === 1 ? "" : "s"}`} right={<span className="tabular-nums text-white">{money(t.value)}</span>}>
              <div className="divide-y divide-white/[.04]">
                {rows.filter((r) => r.code === t.code).map((r) => (
                  <Item key={r.id} code={r.wbs} title={r.name} meta={r.account} value={
                    <span className="flex items-center justify-end gap-2"><span className="tabular-nums text-[#d3d8de]">{money(r.value)}</span>
                      <select aria-label={`Cost code of ${r.name}`} value={r.by_hand ? r.code : ""} onChange={(e) => void act(() => api(`/api/project/cost-codes/${r.id}`, { code: e.target.value }))} className="max-w-[150px] rounded border border-white/15 bg-black/20 px-1 py-0.5 text-[11.5px] text-white"><option value="" className="bg-[#1c2733]">Automatic: {r.by_hand ? "by its words" : r.code}</option>{codes.map((c) => <option key={c.code} value={c.code} className="bg-[#1c2733]">{c.code} {c.name}</option>)}</select>
                    </span>} />
                ))}
              </div>
            </Group>
          ))}
          {names.length > 1 && (
            <section className="rounded-xl border border-white/10 bg-[#1c2733] p-3">
              <Label>Across the firm&apos;s projects</Label>
              <ul className="mt-2 space-y-2">{((firm.data?.codes ?? []) as Rec[]).map((c) => {
                const top = Math.max(...Object.values(c.projects as Record<string, number>), 1);
                return <li key={c.code}><p className="text-[#d3d8de]"><b className="font-mono text-[11px] text-white">{c.code}</b> {c.name}</p>{names.map((n, i) => c.projects[n] != null && <p key={n} className="mt-0.5 grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_90px] items-center gap-2 text-[11px] text-[#abb3bf]"><span className="truncate">{n}</span><span className="h-2 overflow-hidden rounded-sm bg-white/[.05]"><span className="block h-full" style={{ width: `${(c.projects[n] / top) * 100}%`, background: hue(i) }} /></span><span className="text-right tabular-nums">{money(c.projects[n])}</span></p>)}</li>;
              })}</ul>
            </section>
          )}
          <p className="px-1 text-[11px] leading-snug text-[#8f99a8]">Budget lines come per work package. An actual cost is recorded on a control account, so it goes to the code most of that account&apos;s value falls under.</p>
        </div>
      </div>
      {editing && <FirmList codes={codes} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />}
    </div>
  );
}
