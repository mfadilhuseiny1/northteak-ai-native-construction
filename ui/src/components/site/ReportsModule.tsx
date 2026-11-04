"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { api, Bar, Card, field, Label, Loading, money, notifyChanged, NotYet, Pill, primary, Problem, quiet, Side, useData, useGo, type Rec, type Tone } from "./kit";
import { ACTUAL, Meter, Milestones, PLAN, Ring, SCurve, STATE, STATE_WORD, Steps } from "./ReportCharts";
import { FundingPages } from "./FundingPages";

/* Reports, from the records: the project's month for the project officer, the portfolio's month for senior management and the board, and the quarter's
   funding report for the CFO and the banks. Code reads every figure from its module; a person adds only what the records cannot know. */

const VIEWS: [string, string, string][] = [
  ["project", "This project", "monthly, for the project officer: money, programme, variations, contingency, photos"],
  ["portfolio", "Portfolio", "monthly, for senior management and the board: every project, five questions"],
  ["funding", "Funding", "quarterly, for the CFO and the banks: one page per project"],
];
type Status = keyof typeof STATE;
const monthOf = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function Badge({ status, small = false }: { status: Status; small?: boolean }) {
  const icon: IconName = status === "green" ? "check" : status === "none" ? "info" : "alert";
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ${small ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11.5px]"}`} style={{ background: `${STATE[status]}1f`, color: STATE[status], boxShadow: `inset 0 0 0 1px ${STATE[status]}55` }}><Icon name={icon} className={small ? "h-3 w-3" : "h-3.5 w-3.5"} />{STATE_WORD[status]}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "warn" | "ok" }) {
  const color = tone === "bad" ? "text-[#ffb4b4]" : tone === "warn" ? "text-[#fbd38d]" : tone === "ok" ? "text-[#7ee2c0]" : "text-white";
  return <div className="min-w-[120px]"><p className="text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">{label}</p><p className={`mt-1 text-[22px] font-bold leading-none tabular-nums ${color}`}>{value}</p>{sub && <p className="mt-1 text-[11px] text-[#abb3bf]">{sub}</p>}</div>;
}

function Delta({ row }: { row: Rec }) {
  const d = Number(row.delta);
  if (!d) return <span className="text-[11px] text-[#8f99a8]">no change</span>;
  const text = row.unit === "rp" ? money(Math.abs(d)) : row.unit === "pts" ? `${Math.abs(d)} pts` : row.unit === "days" ? `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}` : Math.abs(d);
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-semibold" style={{ color: row.good ? STATE.green : STATE.red }}><Icon name="down" className={`h-3 w-3 ${d > 0 ? "rotate-180" : ""}`} />{d > 0 ? "+" : "−"}{text}</span>;
}

export function ReportsModule({ sub, target }: { sub: string; target: string }) {
  const go = useGo();
  const view = VIEWS.some(([k]) => k === sub) ? sub : "project";
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Reports" note={VIEWS.find(([k]) => k === view)![2]}>
        <span className="flex rounded-md border border-white/15 bg-black/20 p-0.5" role="tablist" aria-label="Report">
          {VIEWS.map(([k, label]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => go(`reports/${k}`)} className={`rounded px-2.5 py-0.5 text-[11.5px] ${view === k ? "bg-[#f5b82e] font-semibold text-[#171106]" : "text-[#abb3bf] hover:bg-white/[.07] hover:text-white"}`}>{label}</button>)}
        </span>
        {view === "funding" && <button data-tour="print" onClick={() => window.open("/print?r=funding", "_blank")} className={`${primary} flex items-center gap-1.5`}><Icon name="download" className="h-3.5 w-3.5" />Print or save as PDF</button>}
      </Bar>
      {view === "project" && <ProjectReport target={target} />}
      {view === "portfolio" && <PortfolioReport />}
      {view === "funding" && <FundingPreview />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the project's month

function ProjectReport({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/report");
  const go = useGo();
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (target && data) document.getElementById(`report-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [target, data]);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const r = data;
  if (!r.planned_any) return <div className="flex-1 bg-[#111820] p-6"><NotYet>Nothing is planned yet. The report fills in once work packages have dates: add the documents on Home and let the agents plan, or add work in the WBS.</NotYet></div>;
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#111820] p-4">
        <Problem err={err} />
        <div className="mx-auto grid max-w-[1400px] gap-3 xl:grid-cols-3">
          <Hero r={r} />
          <div className="xl:col-span-2"><Card className="h-full" title="Progress against the baseline" right={<span className="flex items-center gap-2 text-[11px] text-[#abb3bf]"><button onClick={() => go("cost")} className={quiet}>Standard Kurva-S</button><b className="text-white">{Math.round(r.progress)}%</b> done · {Math.round(r.planned)}% planned by today{r.spi != null ? ` · SPI ${r.spi.toFixed(2)}` : ""}</span>}><div className="p-3"><SCurve planned={r.curve} actual={r.actual_curve} today={r.today} height={290} /></div></Card></div>
          <MoneyCard r={r} />
          <div className="xl:col-span-2"><Programme r={r} /></div>
          <Changes r={r} />
          <div id="report-variations" className="scroll-mt-4 xl:col-span-2"><Variations r={r} act={act} onAdd={() => setAdding(true)} /></div>
          <div id="report-contingency" className="scroll-mt-4"><Contingency r={r} act={act} /></div>
          <Decisions items={r.decisions} />
          <Risks r={r} />
          <Activity rows={r.events} />
          <div className="xl:col-span-3"><Photos r={r} /></div>
        </div>
      </div>
      {adding && <VariationForm r={r} act={act} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Hero({ r }: { r: Rec }) {
  return (
    <section data-tour="report-hero" className="rise relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#1f2c3a] to-[#161f29] p-4 pl-5 shadow-[0_4px_16px_rgb(0_0_0/.25)] xl:col-span-3">
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: STATE[r.status as Status] }} />
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <div className="min-w-[280px] flex-1">
          <div className="flex flex-wrap items-center gap-2"><Badge status={r.status} /><span className="text-[11px] text-[#8f99a8]">{monthOf(r.period)} · month to date, {r.today}</span></div>
          <h2 className="mt-2 text-[20px] font-bold tracking-tight text-white">{r.name}</h2>
          <p className="text-[11.5px] text-[#abb3bf]">{r.contractor}{r.owner ? ` for ${r.owner}` : ""}{r.location ? ` · ${r.location}` : ""}</p>
          {(r.reasons as string[]).length > 0 && <ul className="mt-2.5 flex flex-wrap gap-1.5">{(r.reasons as string[]).map((x) => <li key={x} className="rounded-full bg-white/[.07] px-2.5 py-0.5 text-[11px] text-[#e5e8eb]">{x}</li>)}</ul>}
          {(r.notes as string[]).map((n) => <p key={n} className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#8f99a8]"><Icon name="info" className="h-3 w-3 shrink-0" />{n}</p>)}
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Stat label="Done" value={`${Math.round(r.progress)}%`} sub={`${Math.round(r.planned)}% planned by today`} tone={r.planned - r.progress > 10 ? "bad" : r.planned - r.progress > 3 ? "warn" : undefined} />
          <Stat label="Forecast cost" value={r.priced ? money(r.eac) : "–"} sub={!r.priced ? "no BoQ priced yet" : r.variance == null ? `the budget, ${money(r.budget)}` : `${money(Math.abs(r.variance))} ${r.variance < 0 ? "over" : "under"} budget`} tone={r.variance != null && r.variance < 0 ? "bad" : undefined} />
          <Stat label="Forecast finish" value={r.finish} sub={r.days_late ? `${r.days_late} days after the contract date` : `contract ${r.revised_finish}`} tone={r.days_late ? "bad" : undefined} />
          <Stat label="Contingency left" value={r.contingency ? money(r.contingency_left) : "–"} sub={r.contingency ? `of ${money(r.contingency)}` : "not set yet"} tone={r.contingency && r.contingency_left < 0 ? "bad" : r.contingency && r.contingency_left < 0.25 * r.contingency ? "warn" : undefined} />
        </div>
      </div>
    </section>
  );
}

function MoneyCard({ r }: { r: Rec }) {
  if (!r.priced) return <Card title="Money"><div className="p-3"><NotYet>No BoQ is priced on the work packages yet, so there is no contract value or budget to report. It fills in once the BoQ lines are on the plan.</NotYet></div></Card>;
  const over = r.variance != null && r.variance < 0;
  return (
    <Card title="Money" right={r.certified ? <span className="text-[11px] text-[#abb3bf]">certified to date <b className="text-white">{money(r.certified)}</b></span> : null}>
      <div className="space-y-4 p-3">
        <div>
          <p className="mb-2 text-[10.5px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">The contract</p>
          <Steps rows={[
            { label: "Original contract", to: r.contract, color: PLAN, value: money(r.contract) },
            { label: "Approved variations", from: r.contract, to: r.revised, color: ACTUAL, value: r.variations_approved ? `${r.variations_approved < 0 ? "−" : "+"}${money(Math.abs(r.variations_approved))}` : "none yet" },
            { label: "Revised contract", to: r.revised, color: PLAN, value: money(r.revised) },
            ...(r.variations_pending ? [{ label: "Variations not yet agreed", from: r.revised, to: r.revised + r.variations_pending, color: ACTUAL, hatch: true, value: `${money(r.variations_pending)} more if agreed` }] : []),
          ]} />
        </div>
        <div>
          <p className="mb-2 text-[10.5px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">The cost</p>
          <Steps rows={[
            { label: "Budget", to: r.budget, color: PLAN, value: money(r.budget) },
            { label: r.cost_measured ? "Spent to date" : "Earned to date, at budget rates", to: r.cost_measured ? r.ac : r.ev, color: ACTUAL, value: money(r.cost_measured ? r.ac : r.ev) },
            { label: "Forecast at completion", to: r.eac, color: over ? STATE.red : ACTUAL, hatch: true, value: money(r.eac), note: r.cost_measured ? "spent so far, plus the work left at today's cost rate" : "no cost recorded yet: the forecast is the budget" },
          ]} />
          {r.cpi != null && <p className="mt-2 text-[11px] text-[#abb3bf]">Cost performance index <b className="text-white">{r.cpi.toFixed(2)}</b>: {r.cpi >= 1 ? "each rupiah spent earns its worth or more" : "work costs more than its budget"}</p>}
        </div>
      </div>
    </Card>
  );
}

function Programme({ r }: { r: Rec }) {
  const rows = (r.milestones as Rec[]).length ? r.milestones : [{ id: "finish", name: "Completion", contract_date: r.revised_finish, forecast: r.finish, days_late: r.days_late }];
  return (
    <Card className="h-full" title="Programme" right={<span className="text-[11px] text-[#abb3bf]">hover a milestone for its dates</span>}>
      <div className="p-3">
        <Milestones start={r.start} end={r.revised_finish > r.finish ? r.revised_finish : r.finish} today={r.today} rows={rows as never} />
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[.06] pt-3 sm:grid-cols-4">
          <Stat label="Started" value={<span className="text-[15px]">{r.start}</span>} />
          <Stat label="Contract finish" value={<span className="text-[15px]">{r.revised_finish}</span>} sub={r.days_approved ? `${r.days_approved} days granted by variations` : "as signed"} />
          <Stat label="Forecast finish" value={<span className="text-[15px]">{r.finish}</span>} sub={r.days_late ? `${r.days_late} days late` : "on time"} tone={r.days_late ? "bad" : "ok"} />
          <Stat label="Next quarter's spend" value={<span className="text-[15px]">{r.priced ? money(r.next_quarter.spend) : "–"}</span>} sub={r.next_quarter.name} />
        </div>
      </div>
    </Card>
  );
}

function Changes({ r }: { r: Rec }) {
  const c = r.changes as Rec | null;
  return (
    <Card title="What changed since last month" right={c ? <span className="text-[11px] text-[#8f99a8]">since {c.since}</span> : null}>
      <div className="p-3">
        {!c ? (
          <div className="flex gap-3 rounded-lg border border-dashed border-white/15 p-3 text-[11.5px] text-[#abb3bf]"><Icon name="history" className="mt-0.5 h-4 w-4 shrink-0 text-[#8f99a8]" /><p>This is the first month saved. From next month this card shows what moved: progress, the cost forecast, the finish date, the risks and the contingency.</p></div>
        ) : (
          <ul className="divide-y divide-white/[.06]">
            {(c.rows as Rec[]).map((x) => (
              <li key={x.key} className="flex items-center gap-2 py-1.5">
                <span className="flex-1 text-[#d3d8de]">{x.label}</span>
                <span className="text-[11px] tabular-nums text-[#8f99a8]">{x.unit === "rp" ? money(x.now) : x.unit === "pts" ? `${x.now}%` : x.now}</span>
                <span className="w-[92px] text-right"><Delta row={x} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

const VO_STATUS: Record<string, [string, Tone]> = { proposed: ["Draft", "none"], submitted: ["With the owner", "info"], approved: ["Approved", "ok"], rejected: ["Rejected", "bad"] };

function Variations({ r, act, onAdd }: { r: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean>; onAdd: () => void }) {
  const v = r.variations as Rec, rows = v.variations as Rec[], t = v.totals as Rec;
  const move = (id: string, status: string) => act(() => api(`/api/project/variations/${id}`, { status }));
  const tile = (label: string, key: string, hint: string) => {
    const n = rows.filter((x) => x.status === key).length;
    return <div className="rounded-lg bg-white/[.03] p-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)]"><p className="text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">{label}</p><p className="mt-1 text-[16px] font-bold tabular-nums text-white">{n ? money(t[key]) : "–"}</p><p className="text-[10.5px] text-[#8f99a8]">{n} · {hint}</p></div>;
  };
  return (
    <Card className="h-full" title="Variation register" right={<button onClick={onAdd} className={`${quiet} flex items-center gap-1`}><span className="text-[13px] leading-none">+</span>Variation</button>}>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tile("Draft", "proposed", "ours to send")}
          {tile("With the owner", "submitted", "waiting for an answer")}
          {tile("Approved", "approved", r.days_approved ? `+${r.days_approved} days granted` : "in the revised contract")}
          {tile("Rejected", "rejected", "not paid")}
        </div>
        {!rows.length && <div className="rounded-lg border border-dashed border-white/15 p-4 text-center text-[11.5px] text-[#abb3bf]">No variations yet. Add one when the owner instructs a change, or when the site turns out different from the drawings.</div>}
        <ul className="space-y-1.5">
          {rows.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/[.025] px-3 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.05)]">
              <span className="font-mono text-[10.5px] text-[#8f99a8]">{x.id}</span>
              <span className="min-w-[160px] flex-1"><span className="text-white">{x.title}</span><span className="ml-2 text-[10.5px] text-[#8f99a8]">{x.reason}{x.wbs ? ` · WBS ${x.wbs}` : ""}{x.ref ? ` · ${x.ref}` : ""} · raised {x.raised}</span></span>
              <span className="whitespace-nowrap font-semibold tabular-nums text-white">{x.value < 0 ? "−" : "+"}{money(Math.abs(x.value))}</span>
              {x.days > 0 && <span className="whitespace-nowrap text-[11px] text-[#abb3bf]">+{x.days} days</span>}
              <Pill tone={VO_STATUS[x.status][1]}>{VO_STATUS[x.status][0]}</Pill>
              <span className="flex gap-1">
                {x.status === "proposed" && <button onClick={() => move(x.id, "submitted")} className={quiet}>Send to owner</button>}
                {x.status === "submitted" && <><button onClick={() => move(x.id, "approved")} className={quiet}>Owner approved</button><button onClick={() => move(x.id, "rejected")} className={quiet}>Owner rejected</button></>}
                {x.status === "rejected" && <button onClick={() => move(x.id, "proposed")} className={quiet}>Reopen</button>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function VariationForm({ r, act, onClose }: { r: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void }) {
  const [f, setF] = useState<Rec>({ title: "", reason: (r.variations.reasons as string[])[0], value: "", days: 0, wbs: "", ref: "", note: "" });
  const save = async () => { if (await act(() => api("/api/project/variations", { ...f, value: Number(f.value) || 0, days: Number(f.days) || 0 }))) onClose(); };
  return (
    <Side eyebrow="Variation register" title="Add a variation" onClose={onClose}>
      <label className="block"><Label>What changes</Label><input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Extra waterproofing to the basement" className={field} /></label>
      <label className="block"><Label>Why</Label><select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={field}>{(r.variations.reasons as string[]).map((x) => <option key={x} className="bg-[#1c2733]">{x}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2">
        <label><Label>Value, Rp</Label><input type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} className={field} /></label>
        <label><Label>Extra days asked</Label><input type="number" min={0} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} className={field} /></label>
      </div>
      <p className="text-[11px] text-[#8f99a8]">A negative value is work taken out of the contract.</p>
      <label className="block"><Label>Work package, if one</Label><select value={f.wbs} onChange={(e) => setF({ ...f, wbs: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">The whole job</option>{(r.packages as Rec[]).map((p) => <option key={p.id} value={p.code} className="bg-[#1c2733]">{p.code} {p.name}</option>)}</select></label>
      <label className="block"><Label>Instruction or letter</Label><input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="e.g. Site instruction SI-014" className={field} /></label>
      <label className="block"><Label>Note</Label><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={3} className={field} /></label>
      <button disabled={!f.title.trim()} onClick={save} className={`${primary} w-full`}>Add the variation</button>
      <p className="text-[11px] text-[#8f99a8]">It starts as a draft. It counts in the revised contract once you mark it approved by the owner.</p>
    </Side>
  );
}

function Contingency({ r, act }: { r: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const c = r.contingency_detail as Rec;
  const [mode, setMode] = useState<"" | "set" | "draw">(c.amount ? "" : "set");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [risk, setRisk] = useState("");
  const done = (ok: boolean) => { if (ok) { setMode(""); setAmount(""); setReason(""); setRisk(""); } };
  const left = c.left as number, share = c.amount ? left / c.amount : 1;
  return (
    <Card className="h-full" title="Contingency" right={c.amount ? <span className="flex gap-1">{mode !== "draw" && <button onClick={() => setMode("draw")} className={quiet}>Draw</button>}{mode !== "set" && <button onClick={() => { setMode("set"); setAmount(String(c.amount)); }} className={quiet}>Change amount</button>}</span> : null}>
      <div className="space-y-3 p-3">
        {c.amount > 0 && (
          <div>
            <div className="flex items-end justify-between"><Stat label="Left" value={money(left)} tone={left < 0 ? "bad" : share < 0.25 ? "warn" : "ok"} /><p className="text-right text-[11px] text-[#abb3bf]">{money(c.used)} drawn<br />of {money(c.amount)}, set {c.set_on}</p></div>
            <div className="mt-2"><Meter used={c.used} total={c.amount} /></div>
            {left < 0 && <p className="mt-1.5 text-[11px] text-[#ffb4b4]">Overdrawn by {money(-left)}.</p>}
          </div>
        )}
        {mode === "set" && (
          <div className="space-y-2 rounded-lg bg-white/[.03] p-2.5">
            {!c.amount && <p className="text-[11.5px] text-[#abb3bf]">The money held back for what may go wrong: the risks on the register. Set it once, then draw on it as things happen.</p>}
            <label className="block"><Label>Contingency, Rp</Label><input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={field} /></label>
            <div className="flex gap-1.5"><button disabled={amount === ""} onClick={async () => done(await act(() => api("/api/project/contingency", { amount: Number(amount) })))} className={primary}>Set it</button>{c.amount > 0 && <button onClick={() => setMode("")} className={quiet}>Cancel</button>}</div>
          </div>
        )}
        {mode === "draw" && (
          <div className="space-y-2 rounded-lg bg-white/[.03] p-2.5">
            <label className="block"><Label>Amount drawn, Rp</Label><input autoFocus type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={field} /></label>
            <label className="block"><Label>What for</Label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dewatering after the flood" className={field} /></label>
            {(r.risk_ids as Rec[]).length > 0 && <label className="block"><Label>The risk it answers, if one</Label><select value={risk} onChange={(e) => setRisk(e.target.value)} className={field}><option value="" className="bg-[#1c2733]">None</option>{(r.risk_ids as Rec[]).map((x) => <option key={x.id} value={x.id} className="bg-[#1c2733]">{x.id} {x.title}</option>)}</select></label>}
            <div className="flex gap-1.5"><button disabled={!Number(amount) || !reason.trim()} onClick={async () => done(await act(() => api("/api/project/contingency/use", { amount: Number(amount), reason, risk })))} className={primary}>Draw it</button><button onClick={() => setMode("")} className={quiet}>Cancel</button></div>
          </div>
        )}
        {(c.uses as Rec[]).length > 0 && (
          <ul className="divide-y divide-white/[.06]">
            {(c.uses as Rec[]).map((u) => <li key={u.id} className="flex items-baseline gap-2 py-1.5"><span className="w-[74px] shrink-0 text-[10.5px] tabular-nums text-[#8f99a8]">{u.date}</span><span className="min-w-0 flex-1 text-[#d3d8de]">{u.reason}{u.risk ? <span className="ml-1 text-[10.5px] text-[#8f99a8]">{u.risk}</span> : null}</span><b className="tabular-nums text-white">{money(u.amount)}</b></li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}

const TONE_DOT: Record<string, string> = { bad: STATE.red, warn: STATE.amber, info: "#8f99a8" };

export function Decisions({ items, onGo }: { items: Rec[]; onGo?: (item: Rec) => void }) {
  const go = useGo();
  return (
    <Card title={`Decisions needed${items.length ? ` (${items.length})` : ""}`}>
      <div className="p-2">
        {!items.length && <p className="p-2 text-[11.5px] text-[#abb3bf]">Nothing waits on a person.</p>}
        {items.map((d, i) => (
          <button key={i} onClick={() => (onGo ? onGo(d) : go(d.go))} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-white/[.05]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_DOT[d.tone] ?? "#8f99a8" }} />
            <span className="flex-1 text-[#e5e8eb]">{d.text}</span>
            <Icon name="right" className="h-3.5 w-3.5 text-[#8f99a8]" />
          </button>
        ))}
      </div>
    </Card>
  );
}

const LEVEL: Record<string, string> = { extreme: STATE.red, high: STATE.amber, medium: "#8f99a8", low: "#5c6b7a" };

function Risks({ r }: { r: Rec }) {
  const go = useGo();
  return (
    <Card title="Risks" right={<button onClick={() => go("risks")} className={quiet}>The register</button>}>
      <div className="space-y-2 p-3">
        <div className="flex gap-2">
          {[["Extreme", r.risks_extreme, STATE.red], ["High", r.risks_high, STATE.amber], ["Open", r.risks_open, "#8f99a8"]].map(([label, n, color]) => (
            <div key={label as string} className="flex-1 rounded-lg bg-white/[.03] p-2 text-center shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)]"><p className="text-[18px] font-bold tabular-nums text-white">{n as number}</p><p className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-[.08em] text-[#7d8b9b]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: color as string }} />{label as string}</p></div>
          ))}
        </div>
        {!(r.top_risks as Rec[]).length && <p className="text-[11.5px] text-[#abb3bf]">No open risks on the register.</p>}
        <ul className="space-y-1">
          {(r.top_risks as Rec[]).map((x) => (
            <li key={x.id}><button onClick={() => go(x.go || "risks")} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/[.05]">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: LEVEL[x.level] }} title={x.level} />
              <span className="min-w-0 flex-1"><span className="text-[#e5e8eb]">{x.title}</span><span className="block text-[10.5px] text-[#8f99a8]">{x.level}, score {x.score} · {x.owner || "no owner"}</span></span>
            </button></li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Activity({ rows }: { rows: Rec[] }) {
  return (
    <Card title="The last 30 days">
      <div className="p-2">
        {!rows.length && <p className="p-2 text-[11.5px] text-[#abb3bf]">Nothing recorded in the last 30 days.</p>}
        <ul>
          {rows.map((e, i) => (
            <li key={i} className="flex items-center gap-2.5 px-2 py-1.5">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/[.07] px-1.5 text-[10.5px] font-semibold tabular-nums text-white">{e.count}</span>
              <span className="min-w-0 flex-1"><span className="text-[#e5e8eb]">{e.action}</span><span className="block text-[10.5px] text-[#8f99a8]">{e.who} · last {String(e.last).slice(0, 10)}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Photos({ r }: { r: Rec }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [activity, setActivity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const photos = r.photos as Rec[];
  const upload = async () => {
    setBusy(true);
    setErr("");
    try {
      for (const f of files) {
        const body = new FormData();
        body.append("file", f);
        body.append("caption", caption.trim() || f.name.replace(/\.[^.]+$/, ""));
        body.append("activity", activity);
        const res = await fetch(`${API_URL}/api/project/photos`, { method: "POST", body });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `${res.status} ${res.statusText}`);
      }
      setOpen(false); setFiles([]); setCaption(""); setActivity("");
      notifyChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title={`Progress photos${photos.length ? (r.photos_this_month ? `, ${monthOf(r.period)}` : ", the latest") : ""}`} right={<button onClick={() => setOpen(!open)} className={`${quiet} flex items-center gap-1`}><Icon name="camera" className="h-3.5 w-3.5" />Add photos</button>}>
      <div className="space-y-3 p-3">
        {open && (
          <div className="grid gap-2 rounded-lg bg-white/[.03] p-2.5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="block"><Label>Photos</Label><input type="file" accept="image/*" multiple onChange={(e) => setFiles(e.target.files ? [...e.target.files] : [])} className="mt-1 block w-full text-[11px] text-[#abb3bf] file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" /></label>
            <label className="block"><Label>What they show</Label><input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Level 2 slab poured" className={field} /></label>
            <label className="block"><Label>Work package</Label><select value={activity} onChange={(e) => setActivity(e.target.value)} className={field}><option value="" className="bg-[#1c2733]">None</option>{(r.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2733]">{p.code} {p.name}</option>)}</select></label>
            <button disabled={!files.length || busy} onClick={upload} className={primary}>{busy ? "Uploading…" : `Upload ${files.length || ""}`}</button>
            {err && <p className="text-[11px] text-[#ffb4b4] sm:col-span-4">{err}</p>}
          </div>
        )}
        {!photos.length && !open && <div className="rounded-lg border border-dashed border-white/15 p-6 text-center text-[11.5px] text-[#abb3bf]">No photos yet. Add the month&apos;s progress photos: they go in this report, dated, with the work they show.</div>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          {photos.map((p) => (
            <a key={p.id} href={`${API_URL}/api/project/photos/${p.id}`} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg bg-black/30 shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${API_URL}/api/project/photos/${p.id}`} alt={p.caption} loading="lazy" className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.03]" />
              <p className="truncate px-2 pt-1.5 text-[11px] text-[#e5e8eb]">{p.caption}</p>
              <p className="truncate px-2 pb-1.5 text-[10px] text-[#8f99a8]">{p.date}{p.wbs ? ` · ${p.wbs}` : ""}</p>
            </a>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ the portfolio's month

async function openProject(p: Rec, where: string, go: (to: string) => void) {
  if (p.open) return go(where);
  await api(`/api/projects/${p.id}/open`, {});
  window.location.hash = where;
  window.location.reload();
}

function PortfolioReport() {
  const { data, err } = useData("/api/reports/portfolio");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.projects as Rec[], t = data.total as Rec;
  const live = rows.filter((p) => p.planned_any);
  if (!rows.length) return <div className="flex-1 bg-[#111820] p-6"><NotYet>No projects of the firm&apos;s own yet. Start one on Home.</NotYet></div>;
  const visit = (p: Rec, where: string) => void openProject(p, where, go).catch((e) => window.alert((e as Error).message));
  const starts = live.map((p) => p.start as string), ends = live.flatMap((p) => [p.finish as string, p.revised_finish as string]);
  const span = starts.length ? { from: starts.reduce((a, b) => (b < a ? b : a)), to: ends.reduce((a, b) => (b > a ? b : a)) } : null;
  const pos = (d: string) => (span ? ((Date.parse(d) - Date.parse(span.from)) / Math.max(1, Date.parse(span.to) - Date.parse(span.from))) * 100 : 0);
  const within = live.filter((p) => p.variance != null), over = within.filter((p) => p.variance < 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#111820] p-4">
      <Problem err={err} />
      <div className="mx-auto max-w-[1400px] space-y-3">
        <section className="rise flex flex-wrap items-center gap-x-10 gap-y-4 rounded-xl border border-white/10 bg-gradient-to-br from-[#1f2c3a] to-[#161f29] p-4 shadow-[0_4px_16px_rgb(0_0_0/.25)]">
          <div className="min-w-[220px]">
            <p className="text-[11px] text-[#8f99a8]">{monthOf(data.period)} · month to date</p>
            <h2 className="text-[20px] font-bold tracking-tight text-white">The portfolio</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">{(["red", "amber", "green", "none"] as Status[]).filter((s) => t.status[s]).map((s) => <span key={s} className="flex items-center gap-1.5"><Badge status={s} small /><b className="text-white">{t.status[s]}</b></span>)}</div>
          </div>
          <Stat label="Projects" value={rows.length} sub={`${live.length} planned`} />
          <Stat label="Revised contracts" value={t.revised ? money(t.revised) : "–"} sub={t.variations_approved ? `${money(t.variations_approved)} in approved variations` : "no variations approved"} />
          <Stat label="Forecast cost" value={t.eac ? money(t.eac) : "–"} sub={t.variance == null ? "no actual cost recorded yet" : `${money(Math.abs(t.variance))} ${t.variance < 0 ? "over" : "under"} budget`} tone={t.variance != null && t.variance < 0 ? "bad" : undefined} />
          <Stat label={`Spend in ${data.next_quarter}`} value={t.next_quarter ? money(t.next_quarter) : "–"} sub="from the programmes" />
          <Stat label="Decisions waiting" value={t.decisions} tone={t.decisions ? "warn" : "ok"} />
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <button key={p.id} onClick={() => visit(p, "reports/project")} className="rise group relative overflow-hidden rounded-xl border border-white/10 bg-[#1c2733] p-4 text-left shadow-[0_4px_16px_rgb(0_0_0/.25)] transition hover:-translate-y-0.5 hover:border-white/25">
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: STATE[(p.status as Status) ?? "none"] }} />
              <div className="flex items-start gap-3">
                <Ring done={p.progress ?? 0} planned={p.planned ?? null} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge status={p.status ?? "none"} small />{p.open && <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-[#d3d8de]">open now</span>}{p.stale && <span className="text-[10px] text-[#8f99a8]">as of {p.today}</span>}</div>
                  <p className="mt-1.5 truncate text-[14px] font-semibold text-white">{p.name}</p>
                  <p className="text-[11px] text-[#8f99a8]">{[p.location, p.planned_any && `${Math.round(p.planned)}% planned by today`].filter(Boolean).join(" · ") || "–"}</p>
                </div>
              </div>
              {p.planned_any ? (
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[.06] pt-3 text-[11px]">
                  <div><dt className="text-[#7d8b9b]">Contract</dt><dd className="font-semibold tabular-nums text-white">{p.priced ? money(p.revised) : "not priced"}</dd></div>
                  <div><dt className="text-[#7d8b9b]">Forecast</dt><dd className={`font-semibold tabular-nums ${p.variance != null && p.variance < 0 ? "text-[#ffb4b4]" : "text-white"}`}>{p.priced ? money(p.eac) : "–"}</dd></div>
                  <div><dt className="text-[#7d8b9b]">Finish</dt><dd className={`font-semibold tabular-nums ${p.days_late ? "text-[#ffb4b4]" : "text-white"}`}>{p.finish}</dd></div>
                </dl>
              ) : <p className="mt-3 text-[11px] text-[#8f99a8]">{(p.notes as string[])?.[0]}</p>}
              {(p.reasons as string[] | undefined)?.length ? <p className="mt-2 line-clamp-2 text-[11px] text-[#abb3bf]">{(p.reasons as string[]).join(" · ")}</p> : null}
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#9cc7f5] group-hover:underline">Open its report<Icon name="right" className="h-3 w-3" /></span>
            </button>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <Card title="Are we within budget?" right={<span className="text-[11px] text-[#abb3bf]">{within.length ? `${within.length - over.length} of ${within.length} measured within budget` : "no project has recorded cost yet"}</span>}>
            <div className="space-y-3 p-3">
              {live.map((p) => {
                const max = Math.max(p.budget, p.eac, 1);
                return (
                  <div key={p.id}>
                    <div className="mb-1 flex items-baseline gap-2 text-[11.5px]"><span className="flex-1 truncate text-white">{p.name}</span><span className="text-[11px] text-[#abb3bf]">{!p.priced ? "no BoQ priced yet" : p.variance == null ? "no cost recorded: forecast is the budget" : <b style={{ color: p.variance < 0 ? STATE.red : STATE.green }}>{money(Math.abs(p.variance))} {p.variance < 0 ? "over" : "under"}</b>}</span></div>
                    {p.priced ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2"><span className="w-[58px] text-[10px] text-[#7d8b9b]">Budget</span><div className="h-2.5 flex-1 rounded-sm bg-white/[.06]"><div className="h-full rounded-[3px]" style={{ width: `${(p.budget / max) * 100}%`, background: PLAN }} /></div><span className="w-[78px] text-right text-[10.5px] tabular-nums text-[#d3d8de]">{money(p.budget)}</span></div>
                        <div className="flex items-center gap-2"><span className="w-[58px] text-[10px] text-[#7d8b9b]">Forecast</span><div className="h-2.5 flex-1 rounded-sm bg-white/[.06]"><div className="h-full rounded-[3px]" style={{ width: `${(p.eac / max) * 100}%`, background: p.variance != null && p.variance < 0 ? STATE.red : ACTUAL }} /></div><span className="w-[78px] text-right text-[10.5px] tabular-nums text-[#d3d8de]">{money(p.eac)}</span></div>
                      </div>
                    ) : <div className="h-2.5 rounded-sm bg-[repeating-linear-gradient(45deg,#ffffff10_0_3px,transparent_3px_6px)]" />}
                  </div>
                );
              })}
              <div className="flex gap-4 pt-1"><span className="flex items-center gap-1.5 text-[10.5px] text-[#8f99a8]"><span className="h-2 w-3 rounded-sm" style={{ background: PLAN }} />budget</span><span className="flex items-center gap-1.5 text-[10.5px] text-[#8f99a8]"><span className="h-2 w-3 rounded-sm" style={{ background: ACTUAL }} />forecast at completion</span></div>
            </div>
          </Card>

          <Card title="What are we forecasting?" right={<span className="text-[11px] text-[#abb3bf]">{live.filter((p) => p.days_late).length ? `${live.filter((p) => p.days_late).length} finishing late` : "every project on time"}</span>}>
            <div className="space-y-3 p-3">
              {span && live.map((p) => (
                <div key={p.id}>
                  <div className="mb-1 flex items-baseline gap-2 text-[11.5px]"><span className="flex-1 truncate text-white">{p.name}</span><span className="text-[11px] text-[#abb3bf]">finish <b className={p.days_late ? "text-[#ffb4b4]" : "text-white"}>{p.finish}</b>{p.days_late ? `, ${p.days_late} days late` : ", on time"}</span></div>
                  <div className="relative h-3 rounded-sm bg-white/[.04]">
                    <div className="absolute inset-y-0 rounded-[3px]" style={{ left: `${pos(p.start)}%`, width: `${pos(p.finish) - pos(p.start)}%`, background: `${ACTUAL}55` }}><div className="h-full rounded-[3px]" style={{ width: `${Math.min(100, p.progress)}%`, background: ACTUAL }} /></div>
                    <div className="absolute -inset-y-1 w-[2px] rounded" style={{ left: `${pos(p.revised_finish)}%`, background: PLAN }} title={`contract finish ${p.revised_finish}`} />
                    <div className="absolute -inset-y-1.5 w-px bg-white/40" style={{ left: `${pos(data.today)}%` }} />
                  </div>
                  <p className="mt-1 text-[10.5px] text-[#8f99a8]">{p.priced ? `${money(p.next_quarter.spend)} to spend in ${p.next_quarter.name} · ${money(p.to_spend)} left to spend` : "no money figures yet"}</p>
                </div>
              ))}
              <div className="flex flex-wrap gap-4 pt-1 text-[10.5px] text-[#8f99a8]"><span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: ACTUAL }} />done, then still to do</span><span className="flex items-center gap-1.5"><span className="h-3 w-[2px]" style={{ background: PLAN }} />contract finish</span><span className="flex items-center gap-1.5"><span className="h-3 w-px bg-white/40" />today</span></div>
            </div>
          </Card>

          <Card title="What changed since last month?">
            <div className="divide-y divide-white/[.06] px-3">
              {live.map((p) => (
                <div key={p.id} className="py-2.5">
                  <p className="text-[11.5px] text-white">{p.name}</p>
                  {p.changes ? (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{(p.changes.rows as Rec[]).filter((x) => ["progress", "eac", "finish", "risks_high", "contingency_left"].includes(x.key)).map((x) => <span key={x.key} className="flex items-center gap-1.5 text-[11px] text-[#abb3bf]">{x.label}<Delta row={x} /></span>)}</div>
                  ) : <p className="mt-0.5 text-[11px] text-[#8f99a8]">First month saved: changes show from next month.</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Contingency and risks">
            <div className="divide-y divide-white/[.06] px-3">
              {live.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
                  <span className="min-w-[160px] flex-1 text-[11.5px] text-white">{p.name}</span>
                  <span className="w-[200px]">{p.contingency ? <><Meter used={p.contingency_used} total={p.contingency} /><span className="mt-0.5 block text-[10.5px] text-[#8f99a8]">{money(p.contingency_left)} left of {money(p.contingency)}</span></> : <span className="text-[11px] text-[#8f99a8]">no contingency set</span>}</span>
                  <span className="flex gap-2 text-[11px]">{[["extreme", p.risks_extreme, STATE.red], ["high", p.risks_high, STATE.amber]].map(([label, n, color]) => <span key={label as string} className="flex items-center gap-1 text-[#abb3bf]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: color as string }} /><b className="text-white">{n as number}</b> {label as string}</span>)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="xl:col-span-2">
            <Card title={`Decisions needed (${t.decisions})`}>
              <div className="grid gap-x-4 p-2 lg:grid-cols-2">
                {rows.filter((p) => (p.decisions as Rec[])?.length).map((p) => (
                  <div key={p.id} className="py-1">
                    <p className="px-2 pt-1 text-[10.5px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">{p.name}</p>
                    {(p.decisions as Rec[]).map((d, i) => (
                      <button key={i} onClick={() => visit(p, d.go)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-white/[.05]">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_DOT[d.tone] ?? "#8f99a8" }} /><span className="flex-1 text-[#e5e8eb]">{d.text}</span><Icon name="right" className="h-3.5 w-3.5 text-[#8f99a8]" />
                      </button>
                    ))}
                  </div>
                ))}
                {!t.decisions && <p className="p-2 text-[11.5px] text-[#abb3bf]">Nothing waits on a person in any project.</p>}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the quarter's funding report, as the paper the banks get

function FundingPreview() {
  const { data, err } = useData("/api/reports/portfolio");
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#0d131a] px-4 py-6">
      <Problem err={err} />
      <p className="mx-auto mb-4 max-w-[794px] text-center text-[11.5px] text-[#8f99a8]">A cover page for the portfolio, then one page per project. <b className="text-[#d3d8de]">Print or save as PDF</b> sends exactly these pages.</p>
      <FundingPages data={data} />
    </div>
  );
}
