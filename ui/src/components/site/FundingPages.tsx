"use client";
import type { ReactNode } from "react";
import { money, num, type Rec } from "./kit";
import { CashBars, SCurve, STATE, STATE_WORD } from "./ReportCharts";

/* The quarterly funding report, as paper: a cover page for the portfolio, then one clear page per project. The same pages show in the app and print,
   so what the CFO checks is what the banks receive. Nothing on it is typed by hand: each figure comes from the project's records. */

type Status = keyof typeof STATE;

function Sheet({ children }: { children: ReactNode }) {
  return <section className="sheet mx-auto mb-6 flex min-h-[1123px] w-full max-w-[794px] flex-col bg-white px-12 py-11 text-[12px] leading-snug text-[#1f2933] shadow-[0_10px_40px_rgb(0_0_0/.45)] print:mb-0 print:min-h-[297mm] print:max-w-none print:break-after-page print:shadow-none">{children}</section>;
}

function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="border-t-2 border-[#1f2933] pt-1.5"><p className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-[#6b7684]">{label}</p><p className="mt-0.5 text-[17px] font-bold tabular-nums">{value}</p>{sub && <p className="text-[10.5px] text-[#6b7684]">{sub}</p>}</div>;
}

function Word({ status }: { status: Status }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold" style={{ borderColor: STATE[status], color: "#1f2933" }}><span className="h-2 w-2 rounded-full" style={{ background: STATE[status] }} />{STATE_WORD[status]}</span>;
}

function Foot({ data, page, of }: { data: Rec; page: number; of: number }) {
  return <p className="mt-auto flex justify-between border-t border-[#e4e7eb] pt-2 text-[9.5px] text-[#6b7684]"><span>Quarterly funding report, {data.quarter} · figures from the project records on {data.today}. A figure nothing has measured yet is said so.</span><span>Page {page} of {of}</span></p>;
}

/** What one project's page says in one sentence, from its figures. */
function sentence(p: Rec): string {
  const parts = [`${num(p.progress, 2)}% complete against ${num(p.planned, 2)}% planned`];
  parts.push(p.days_late ? `forecast to finish ${p.days_late} days after the contract date, on ${p.finish}` : `forecast to finish on time, on ${p.finish}`);
  if (p.priced) parts.push(p.variance == null ? `no actual cost recorded yet, so the forecast is the budget of ${money(p.budget)}` : `forecast cost ${money(p.eac)}, ${money(Math.abs(p.variance))} ${p.variance < 0 ? "over" : "under"} budget`);
  return `${parts.join("; ")}.`;
}

export function FundingPages({ data }: { data: Rec }) {
  const rows = (data.projects as Rec[]).filter((p) => p.planned_any);
  const t = data.total as Rec;
  const quarters: Record<string, number> = {};
  for (const p of rows) for (const q of (p.cash as Rec[]) ?? []) quarters[q.name] = (quarters[q.name] ?? 0) + q.spend;
  const cash = Object.entries(quarters).map(([name, spend]) => ({ name, spend })).slice(0, 8);
  const pages = rows.length + 1;
  return (
    <div>
      <Sheet>
        <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#6b7684]">Quarterly funding report</p>
        <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-tight">{data.quarter}</h1>
        <p className="text-[12.5px] text-[#4b5563]">For the CFO and the lending banks · prepared {data.today}</p>
        <div className="mt-8 grid grid-cols-4 gap-5">
          <Figure label="Projects" value={rows.length} sub={`${t.status.red} at risk · ${t.status.amber} to watch · ${t.status.green} on track`} />
          <Figure label="Contract value" value={t.revised ? money(t.revised) : "–"} sub={t.variations_approved ? `incl. ${money(t.variations_approved)} variations` : "as signed"} />
          <Figure label="Forecast cost" value={t.eac ? money(t.eac) : "–"} sub={t.variance == null ? "no actual cost recorded yet" : `${money(Math.abs(t.variance))} ${t.variance < 0 ? "over" : "under"} budget`} />
          <Figure label={`Spend in ${data.next_quarter}`} value={t.next_quarter ? money(t.next_quarter) : "–"} sub="from the programmes" />
        </div>
        <h2 className="mt-9 text-[13px] font-bold">Money the portfolio needs, quarter by quarter</h2>
        <p className="text-[10.5px] text-[#6b7684]">The budget not yet earned on each activity, spread over the days its forecast leaves it. Summed across the projects below.</p>
        <div className="mt-2">{cash.length ? <CashBars rows={cash} light height={190} /> : <p className="text-[#6b7684]">No priced work left to fund.</p>}</div>
        <h2 className="mt-8 text-[13px] font-bold">The projects</h2>
        <div className="mt-2 divide-y divide-[#e4e7eb] border-y border-[#e4e7eb]">
          {rows.map((p, i) => (
            <div key={p.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-2">
              <div><p className="font-semibold">{p.name}</p><p className="text-[10.5px] text-[#6b7684]">{[p.location, `page ${i + 2}`].filter(Boolean).join(" · ")}</p></div>
              <Word status={p.status} />
              <p className="w-[110px] text-right tabular-nums">{p.priced ? money(p.revised) : "not priced"}</p>
              <p className="w-[90px] text-right tabular-nums">{num(p.progress, 2)}% done</p>
            </div>
          ))}
        </div>
        <Foot data={data} page={1} of={pages} />
      </Sheet>

      {rows.map((p, i) => (
        <Sheet key={p.id}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#6b7684]">{data.quarter} · project {i + 1} of {rows.length}</p>
              <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-tight">{p.name}</h1>
              <p className="text-[11.5px] text-[#4b5563]">{[p.owner && `For ${p.owner}`, p.location, `${p.start} to ${p.revised_finish}`].filter(Boolean).join(" · ")}</p>
            </div>
            <Word status={p.status} />
          </div>
          <p className="mt-4 rounded bg-[#f4f6f8] px-3 py-2 text-[12px]">{sentence(p)}</p>
          <div className="mt-5 grid grid-cols-4 gap-4">
            <Figure label="Contract value" value={p.priced ? money(p.revised) : "–"} sub={p.priced ? (p.variations_approved ? `${money(p.contract)} + ${money(p.variations_approved)} variations` : "as signed") : "no BoQ priced yet"} />
            <Figure label="Complete" value={`${num(p.progress, 2)}%`} sub={`${num(p.planned, 2)}% planned by ${p.planned_by ?? "today"}`} />
            <Figure label={p.cost_measured ? "Spent to date" : "Earned to date"} value={p.priced ? money(p.cost_measured ? p.ac : p.ev) : "–"} sub={p.cost_measured ? `CPI ${Number(p.cpi).toFixed(2)}` : "at budget rates, no cost recorded"} />
            <Figure label="Forecast cost" value={p.priced ? money(p.eac) : "–"} sub={p.variance == null ? "the budget" : `${money(Math.abs(p.variance))} ${p.variance < 0 ? "over" : "under"}`} />
            <Figure label="Forecast finish" value={p.finish} sub={p.days_late ? `${p.days_late} days late` : "on time"} />
            <Figure label={`Spend in ${p.next_quarter.name}`} value={p.priced ? money(p.next_quarter.spend) : "–"} sub="the funding to arrange" />
            <Figure label="Left to spend" value={p.priced ? money(p.to_spend) : "–"} sub="forecast less spent" />
            <Figure label="Contingency left" value={p.contingency ? money(p.contingency_left) : "–"} sub={p.contingency ? `of ${money(p.contingency)}` : "not set"} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-6">
            <div><h2 className="text-[12px] font-bold">Progress against the baseline</h2><div className="mt-1"><SCurve planned={p.curve ?? []} actual={p.actual_curve ?? []} today={p.today} light height={200} /></div></div>
            <div><h2 className="text-[12px] font-bold">Spend by quarter</h2><p className="text-[10px] text-[#6b7684]">from the forecast programme</p><div className="mt-1">{p.priced ? <CashBars rows={p.cash ?? []} light height={200} /> : <p className="mt-6 text-[#6b7684]">No BoQ priced yet.</p>}</div></div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-6">
            <div>
              <h2 className="text-[12px] font-bold">Key risks</h2>
              {(p.top_risks as Rec[] ?? []).length ? <ul className="mt-1 space-y-1">{(p.top_risks as Rec[]).slice(0, 3).map((r) => <li key={r.id} className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: r.level === "extreme" ? STATE.red : r.level === "high" ? STATE.amber : "#9aa5b1" }} /><span><b className="font-semibold">{r.title}</b><span className="text-[#6b7684]"> · {r.level}{r.owner ? `, ${r.owner}` : ", no owner yet"}</span></span></li>)}</ul> : <p className="mt-1 text-[#6b7684]">No open risks on the register.</p>}
            </div>
            <div>
              <h2 className="text-[12px] font-bold">Milestones</h2>
              <ul className="mt-1 space-y-1">{(p.milestones as Rec[] ?? []).slice(0, 4).map((m) => <li key={m.id} className="flex justify-between gap-2"><span>{m.name}</span><span className="tabular-nums text-[#4b5563]">{m.forecast}{m.days_late ? <b className="text-[#b42318]"> +{m.days_late}d</b> : ""}</span></li>)}</ul>
            </div>
          </div>
          {[...(p.reasons ?? []), ...(p.notes ?? [])].length > 0 && <div className="mt-5 border-l-2 border-[#9aa5b1] pl-3 text-[11px] text-[#4b5563]">{[...(p.reasons ?? []), ...(p.notes ?? [])].map((x: string) => <p key={x}>{x[0].toUpperCase() + x.slice(1)}.</p>)}</div>}
          <Foot data={data} page={i + 2} of={pages} />
        </Sheet>
      ))}
    </div>
  );
}
