"use client";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, Card, clean, Empty, field, inline, Kpi, Kpis, Label, Loading, Pill, primary, Problem, quiet, Side, Table, td, tr, useData, useGo, type Rec, type Tone } from "./kit";

/* The Risk Register: every risk on one page, scored probability by impact. Code detects what the records
   already show (open NCRs, late orders, overdue RFIs, a crew short on pour day) and those sit beside the risks
   a person puts on the register themselves. A detected risk opens the record it rests on; a registered risk is
   scored, owned and answered by a person, and its response can go straight onto the Kanban board. */

export const LEVEL_COLOR: Record<string, string> = { extreme: "#e5484d", high: "#ec835a", medium: "#fab219", low: "#29a383" };
const LEVEL_TEXT: Record<string, string> = { extreme: "#fff", high: "#1c1408", medium: "#1c1408", low: "#06231b" };
const STATUS_TONE: Record<string, Tone> = { open: "warn", mitigating: "info", monitoring: "none", closed: "ok", occurred: "bad" };
const P_WORD = ["", "Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
const I_WORD = ["", "Negligible", "Minor", "Moderate", "Major", "Catastrophic"];
export const levelOf = (score: number) => (score >= 20 ? "extreme" : score >= 10 ? "high" : score >= 5 ? "medium" : "low");

export function ScoreBadge({ score, big = false }: { score: number; big?: boolean }) {
  const level = levelOf(score);
  return <span title={`${level}: probability × impact = ${score}`} className={`inline-flex shrink-0 items-center justify-center rounded font-bold tabular-nums ${big ? "h-11 w-11 text-[17px]" : "h-7 w-7 text-[12.5px]"}`} style={{ background: LEVEL_COLOR[level], color: LEVEL_TEXT[level] }}>{score}</span>;
}

function Matrix({ risks, cell, onCell }: { risks: Rec[]; cell: string; onCell: (c: string) => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of risks) if (r.status !== "closed") m.set(`${r.probability}-${r.impact}`, (m.get(`${r.probability}-${r.impact}`) ?? 0) + 1);
    return m;
  }, [risks]);
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: "14px repeat(5, minmax(0,1fr))" }}>
        <span />
        {[1, 2, 3, 4, 5].map((p) => <span key={p} className="pb-0.5 text-center text-[10px] text-[#8f99a8]">{p}</span>)}
        {[5, 4, 3, 2, 1].map((i) => (
          <Fragment key={i}>
            <span className="flex items-center justify-center text-[10px] text-[#8f99a8]">{i}</span>
            {[1, 2, 3, 4, 5].map((p) => {
              const n = counts.get(`${p}-${i}`) ?? 0, score = p * i, level = levelOf(score), active = cell === `${p}-${i}`;
              return (
                <button key={`${p}-${i}`} disabled={!n} onClick={() => onCell(active ? "" : `${p}-${i}`)} title={`Probability ${p} (${P_WORD[p]}), impact ${i} (${I_WORD[i]}): ${n} risk${n === 1 ? "" : "s"}`}
                  className={`flex aspect-square items-center justify-center rounded text-[13px] font-bold tabular-nums disabled:cursor-default ${active ? "ring-2 ring-white" : n ? "hover:brightness-125" : ""}`}
                  style={n ? { background: LEVEL_COLOR[level], color: LEVEL_TEXT[level] } : { background: "rgba(255,255,255,.045)", color: "#5f6b7c" }}>{n || ""}</button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#8f99a8]"><span>Impact ↑</span><span>Probability →</span></div>
      <div className="mt-2 flex flex-wrap gap-1">{(["extreme", "high", "medium", "low"] as const).map((l) => <span key={l} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: LEVEL_COLOR[l], color: LEVEL_TEXT[l] }}>{l}{l === "extreme" ? " 20–25" : l === "high" ? " 10–19" : l === "medium" ? " 5–9" : " 1–4"}</span>)}</div>
      {cell && <p className="mt-2 text-[11px] text-[#d3d8de]">Showing probability {cell.split("-")[0]} × impact {cell.split("-")[1]} only. <button onClick={() => onCell("")} className="underline">Show all</button></p>}
    </div>
  );
}

function CategoryBars({ risks }: { risks: Rec[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { n: number; top: number }>();
    for (const r of risks) if (r.status !== "closed") { const c = m.get(r.category) ?? { n: 0, top: 0 }; c.n += 1; c.top = Math.max(c.top, r.score); m.set(r.category, c); }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.top - a.top || b.n - a.n);
  }, [risks]);
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <Empty>Nothing open.</Empty>;
  return (
    <div className="space-y-1.5 p-3">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="w-[118px] shrink-0 truncate text-[11px] text-[#d3d8de]">{r.name}</span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: LEVEL_COLOR[levelOf(r.top)] }} /></span>
          <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-white">{r.n}</span>
        </div>
      ))}
      <p className="pt-0.5 text-[10px] text-[#8f99a8]">Open risks per category, coloured by its highest score.</p>
    </div>
  );
}

function RiskDetail({ r, data, act, onClose, onRegister }: { r: Rec; data: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void; onRegister: (seed: Rec) => void }) {
  const go = useGo();
  const [f, setF] = useState<Rec>({ probability: r.probability, impact: r.impact, owner: r.owner ?? "", strategy: r.strategy || "Mitigate", response: r.response ?? "", due: r.due ?? "", status: r.status });
  const [boarded, setBoarded] = useState("");
  const score = Number(f.probability) * Number(f.impact);
  const save = () => act(() => api(`/api/project/risks/${r.id}`, { probability: Number(f.probability), impact: Number(f.impact), owner: f.owner, strategy: f.strategy, response: f.response, due: f.due, status: f.status }));
  const toBoard = async () => { if (await act(() => api("/api/project/work-items", { title: `Risk ${r.id}: ${f.response || r.title}`, owner: f.owner || "Project manager", due: f.due || "", activity: r.activity || "" }))) setBoarded("On the board: it waits in Kanban with the other agreed actions."); };
  const pi = (label: string, key: string, words: string[]) => (
    <label className="block"><Label>{label}</Label><select value={f[key]} onChange={(e) => setF({ ...f, [key]: Number(e.target.value) })} className={field}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n} className="bg-[#1c2127]">{n} · {words[n]}</option>)}</select></label>
  );
  return (
    <Side eyebrow={`${r.id} · ${r.source === "detected" ? "detected by code" : "on the register"} · ${r.category}`} title={clean(r.title)} onClose={onClose}>
      <div className="flex items-center gap-3 rounded border border-white/10 p-2.5">
        <ScoreBadge score={r.score} big />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold capitalize text-white">{r.level} risk</p>
          <p className="text-[11px] leading-snug text-[#abb3bf]">Probability {r.probability} ({P_WORD[r.probability]}) × impact {r.impact} ({I_WORD[r.impact]})</p>
          <p className="mt-0.5 flex flex-wrap gap-1"><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>{r.overdue && <Pill tone="bad">response overdue</Pill>}{!r.owner && r.status !== "closed" && <Pill tone="warn">no owner</Pill>}</p>
        </div>
      </div>
      {r.detail && <div><Label>What code or the register says</Label><p className="mt-0.5 leading-snug text-[#e5e8eb]">{clean(r.detail)}</p></div>}
      {r.source === "detected" ? (
        <>
          <p className="leading-snug text-[#abb3bf]">Code found this in the live records and scored it from the check&apos;s level. It stays here while the record says so; fixing the record is what clears it. To score it yourself, put it on the register.</p>
          <span className="flex gap-1"><button onClick={() => go(r.go)} className={`${primary} flex-1`}>Open {r.ref || "the record"}</button><button onClick={() => onRegister(r)} className={quiet}>Put it on the register</button></span>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">{pi("Probability", "probability", P_WORD)}{pi("Impact", "impact", I_WORD)}</div>
          <p className="flex items-center gap-2 text-[11px] text-[#abb3bf]">New score <ScoreBadge score={score} /> <span className="capitalize">{levelOf(score)}</span></p>
          <label className="block"><Label>Owner</Label><input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} placeholder="Who carries this risk" className={field} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label><Label>Response strategy</Label><select value={f.strategy} onChange={(e) => setF({ ...f, strategy: e.target.value })} className={field}>{(data.strategies as string[]).map((s) => <option key={s} value={s} className="bg-[#1c2127]">{s}</option>)}</select></label>
            <label><Label>Response due</Label><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className={field} /></label>
          </div>
          <label className="block"><Label>Response: what will be done</Label><textarea rows={3} value={f.response} onChange={(e) => setF({ ...f, response: e.target.value })} placeholder="The agreed action that brings this risk down" className={field} /></label>
          <label className="block"><Label>Status</Label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={field}>{(data.statuses as string[]).map((s) => <option key={s} value={s} className="bg-[#1c2127]">{s}</option>)}</select></label>
          {r.activity && <p className="text-[11px] text-[#abb3bf]">Hangs on activity <button onClick={() => go(`schedule/gantt:${r.activity}`)} className="underline">{r.activity}</button>{r.created ? ` · registered ${r.created}` : ""}</p>}
          <span className="flex gap-1"><button onClick={save} className={`${primary} flex-1`}>Save the risk</button><button disabled={!f.response && !r.response} onClick={toBoard} className={quiet}>Put the response on the board</button></span>
          {boarded && <p className="text-[#7ee2c0]">{boarded} <button onClick={() => go("kanban/board")} className="underline">Open Kanban</button></p>}
        </>
      )}
    </Side>
  );
}

function AddRisk({ data, seed, act, onClose }: { data: Rec; seed: Rec | null; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void }) {
  const [f, setF] = useState<Rec>({ title: seed ? clean(seed.title) : "", category: seed?.category ?? "Schedule", detail: seed ? clean(seed.detail ?? "") : "", activity: seed?.activity ?? "", probability: seed?.probability ?? 3, impact: seed?.impact ?? 3, owner: "", strategy: "Mitigate", response: "", due: "" });
  const score = Number(f.probability) * Number(f.impact);
  const save = async () => { if (await act(() => api("/api/project/risks", { ...f, probability: Number(f.probability), impact: Number(f.impact) }))) onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label="Add a risk" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-[520px] space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-[#1c2127] p-4 text-[12px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[14px] font-semibold text-white">{seed ? "Put this risk on the register" : "Add a risk"}</p>
        <label className="block"><Label>Risk</Label><input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What might happen, in one line" className={field} /></label>
        <label className="block"><Label>Detail: cause and consequence</Label><textarea rows={2} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="Why it might happen, and what it would do to the work" className={field} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label><Label>Category</Label><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={field}>{(data.categories as string[]).map((c) => <option key={c} value={c} className="bg-[#1c2127]">{c}</option>)}</select></label>
          <label><Label>Activity (WBS)</Label><select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2127]">Whole project</option>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2127]">{a.id} {a.name}</option>)}</select></label>
          <label><Label>Probability</Label><select value={f.probability} onChange={(e) => setF({ ...f, probability: Number(e.target.value) })} className={field}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n} className="bg-[#1c2127]">{n} · {P_WORD[n]}</option>)}</select></label>
          <label><Label>Impact</Label><select value={f.impact} onChange={(e) => setF({ ...f, impact: Number(e.target.value) })} className={field}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n} className="bg-[#1c2127]">{n} · {I_WORD[n]}</option>)}</select></label>
        </div>
        <p className="flex items-center gap-2 text-[11px] text-[#abb3bf]">Exposure <ScoreBadge score={score} /> <span className="capitalize">{levelOf(score)}</span> risk, before any response.</p>
        <div className="grid grid-cols-2 gap-2">
          <label><Label>Owner</Label><input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} placeholder="Who carries it" className={field} /></label>
          <label><Label>Response due</Label><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className={field} /></label>
        </div>
        <label className="block"><Label>Response strategy</Label><select value={f.strategy} onChange={(e) => setF({ ...f, strategy: e.target.value })} className={field}>{(data.strategies as string[]).map((s) => <option key={s} value={s} className="bg-[#1c2127]">{s}</option>)}</select></label>
        <label className="block"><Label>Response: what will be done</Label><textarea rows={2} value={f.response} onChange={(e) => setF({ ...f, response: e.target.value })} className={field} /></label>
        <div className="flex justify-end gap-1.5"><button onClick={onClose} className={quiet}>Cancel</button><button disabled={!String(f.title).trim()} onClick={save} className={primary}>Add to the register</button></div>
      </div>
    </div>
  );
}

export function RiskModule() {
  const { data, err, act } = useData("/api/project/risks");
  const go = useGo();
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [cell, setCell] = useState("");
  const [hideClosed, setHideClosed] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState<Rec | null | "new">(null);
  const risks = useMemo(() => ((data?.risks ?? []) as Rec[]), [data]);
  const shown = risks.filter((r) =>
    (!hideClosed || r.status !== "closed") && (!level || r.level === level) && (!status || r.status === status) && (!category || r.category === category) && (!source || r.source === source) &&
    (!cell || `${r.probability}-${r.impact}` === cell) && (!q || `${r.id} ${r.title} ${r.detail} ${r.owner} ${r.category} ${r.ref}`.toLowerCase().includes(q.toLowerCase())));
  const open = risks.filter((r) => r.status !== "closed");
  const top = open.slice(0, 4);
  const c = (data?.counts ?? {}) as Rec;
  const selected = risks.find((r) => r.id === sel) ?? null;
  if (!data) return <div className="flex-1 overflow-auto"><Problem err={err} />{!err && <Loading />}</div>;
  const chip = (value: string, label: string, n?: number) => (
    <button key={label} onClick={() => setLevel(value)} aria-pressed={level === value} className={`rounded-full px-2 py-0.5 text-[11px] ${level === value ? "bg-white/15 font-medium text-white" : "text-[#abb3bf] hover:text-white"}`}>{label}{n != null && n > 0 ? ` ${n}` : ""}</button>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Risk Register" note="every risk scored, owned and answered. Code detects, people register and decide">
          <button onClick={() => go("tower")} className={quiet}>Control Tower</button>
          <button onClick={() => setAdding("new")} className={primary}><Icon name="plus" className="mr-1 inline h-3 w-3" />Add a risk</button>
        </Bar>
        <Problem err={err} />
        <Kpis>
          <Kpi label="risks on the register" value={c.total} hint={`${c.detected} by code · ${c.register} registered`} />
          <Kpi label="extreme · high, still open" value={`${c.extreme} · ${c.high}`} tone={c.extreme ? "bad" : c.high ? "warn" : "ok"} />
          <Kpi label="still open" value={c.open} tone={c.open ? "warn" : "ok"} />
          <Kpi label="with no owner" value={c.unassigned} tone={c.unassigned ? "warn" : "ok"} />
          <Kpi label="responses overdue" value={c.overdue} tone={c.overdue ? "bad" : "ok"} />
          <Kpi label="closed" value={c.closed} tone="ok" />
        </Kpis>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#1c2127] px-3 py-1.5">
          <span className="flex rounded-full border border-white/10 p-0.5">{chip("", "All levels")}{chip("extreme", "Extreme", c.extreme)}{chip("high", "High", c.high)}{chip("medium", "Medium")}{chip("low", "Low")}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search risks, owners, records…" aria-label="Search risks" className={`${inline} !w-[210px]`} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className={`${inline} !w-auto`}><option value="" className="bg-[#1c2127]">All categories</option>{(data.categories as string[]).map((x) => <option key={x} value={x} className="bg-[#1c2127]">{x}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className={`${inline} !w-auto`}><option value="" className="bg-[#1c2127]">Any status</option>{(data.statuses as string[]).map((x) => <option key={x} value={x} className="bg-[#1c2127]">{x}</option>)}</select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className={`${inline} !w-auto`}><option value="" className="bg-[#1c2127]">Detected + registered</option><option value="detected" className="bg-[#1c2127]">Detected by code</option><option value="register" className="bg-[#1c2127]">Registered by people</option></select>
          <label className="flex items-center gap-1.5 text-[11px] text-[#abb3bf]"><input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} />Hide closed</label>
          <span className="ml-auto text-[11px] text-[#8f99a8]">{shown.length} of {risks.length} shown</span>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] items-start gap-3 overflow-y-auto bg-[#161a1f] p-3 max-xl:grid-cols-1">
          <section className="min-w-0 overflow-hidden rounded border border-white/10 bg-[#1c2127]">
            <div className="max-h-[calc(100vh-238px)] overflow-auto max-xl:max-h-none">
              <Table heads={["Score", "Risk", "Category", "WBS / record", "P × I", "Owner", "Due", "Status"]}>
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => setSel(r.id)} className={`${tr} cursor-pointer ${sel === r.id ? "bg-white/[.07]" : ""} ${r.status === "closed" ? "opacity-50" : ""}`}>
                    <td className={td}><span className="flex items-center gap-1.5"><ScoreBadge score={r.score} /><span className="text-[10px] capitalize leading-tight" style={{ color: LEVEL_COLOR[r.level] }}>{r.level}</span></span></td>
                    <td className={td}><span className="font-medium leading-snug text-white">{clean(r.title)}</span><span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-snug text-[#8f99a8]">{clean(r.detail)}</span><span className="mt-0.5 block text-[10px] text-[#8f99a8]">{r.id} · {r.source === "detected" ? "detected by code" : "registered"}</span></td>
                    <td className={td}><Pill>{r.category}</Pill></td>
                    <td className={`${td} whitespace-nowrap`}>{r.activity || r.ref || "—"}</td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{r.probability} × {r.impact}</td>
                    <td className={td}>{r.owner ? clean(r.owner) : <span className="text-[#fbd38d]">no owner</span>}</td>
                    <td className={`${td} whitespace-nowrap ${r.overdue ? "text-[#ffb4b4]" : ""}`}>{r.due || "—"}</td>
                    <td className={td}><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill></td>
                  </tr>
                ))}
              </Table>
              {!shown.length && <Empty>No risks match. Clear a filter, or add the risk yourself: code only sees what the records show.</Empty>}
            </div>
          </section>
          <div className="space-y-3">
            <Card title="Risk matrix: probability × impact"><div className="p-3"><Matrix risks={risks} cell={cell} onCell={setCell} /></div></Card>
            <Card title="By category"><CategoryBars risks={risks} /></Card>
            <Card title="Needs attention first">
              {top.map((r) => (
                <button key={r.id} onClick={() => setSel(r.id)} className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-1.5 text-left first:border-t-0 hover:bg-white/5">
                  <ScoreBadge score={r.score} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] leading-tight text-white">{clean(r.title)}</span><span className="text-[10px] text-[#8f99a8]">{r.owner ? clean(r.owner) : "no owner"}{r.overdue ? " · response overdue" : r.due ? ` · due ${r.due}` : ""}</span></span>
                </button>
              ))}
              {!top.length && <Empty>Nothing open. The register is clear.</Empty>}
            </Card>
          </div>
        </div>
      </div>
      {selected && <RiskDetail key={selected.id} r={selected} data={data} act={act} onClose={() => setSel(null)} onRegister={(seed) => setAdding(seed)} />}
      {adding && <AddRisk data={data} seed={adding === "new" ? null : adding} act={act} onClose={() => setAdding(null)} />}
    </div>
  );
}
