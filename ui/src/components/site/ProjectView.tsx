"use client";
import { Fragment, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, Card, clean, Kpi, Kpis, Loading, money, Pill, primary, Problem, quiet, short, useData, type Rec, type Tone } from "./kit";

/* The project on one page: each work package followed along the whole workflow, and what the records already show is wrong. Every cell opens its record's screen. */

const STEPS = [["budget", "Budget"], ["procurement", "Procurement"], ["subcontractor", "Subcontractor"], ["schedule", "Schedule"], ["report", "Daily reports"], ["inspection", "Inspection"], ["claim", "Claim"], ["payment", "Payment"], ["handover", "Handover"]];
const CELL: Record<string, string> = { ok: "border-[#29a383]/40 bg-[#29a383]/10", warn: "border-[#fab219]/40 bg-[#fab219]/10", bad: "border-[#e5484d]/50 bg-[#e5484d]/15", none: "border-white/10 bg-white/[.03]" };
const LEVEL: Record<string, Tone> = { high: "bad", medium: "warn", low: "none" };

/** The main job: the consultant's documents into a chart the site can build from. */
function WorkPlan({ p, onGo }: { p: Rec | null; onGo: (tab: string) => void }) {
  if (!p) return (
    <Card title="Work plan" right={<Pill>not planned yet</Pill>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <p className="min-w-[280px] flex-1 leading-snug text-[#d3d8de]">Turn the consultant&apos;s documents for Level 4 columns into an Operation Process Chart: every step in order, with its procedure, workforce, material and waste.</p>
        <button onClick={() => onGo("plans")} className={primary}>Open Work plans</button>
      </div>
    </Card>
  );
  const t = p.totals as Rec;
  return (
    <Card title={`Work plan: ${p.title}`} right={<>{p.mode === "mock" && <Pill tone="violet">offline mock</Pill>}<Pill tone={p.status === "pending" ? "warn" : p.status === "approved" ? "ok" : "bad"}>{p.status === "pending" ? "waiting for you" : p.status}</Pill></>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <p className="min-w-[280px] flex-1 leading-snug text-[#d3d8de]">{t.operations} operations and {t.inspections} inspections. {Number(t.man_hours).toLocaleString("en-US", { maximumFractionDigits: 0 })} man-hours over {t.days} working days, {t.peak_crew} people at the peak. Material {money(t.material_cost)}, of which waste {money(t.waste_cost)}.{p.open_checks ? ` ${p.open_checks} things to look at.` : ""}</p>
        <button onClick={() => onGo("plans")} className={p.status === "pending" ? primary : quiet}>{p.status === "pending" ? "Decide" : "Open the plan"}</button>
      </div>
    </Card>
  );
}

/** Where the swarm stands: the rules below flag what is wrong, the swarm works out what to do about it, and a person decides. */
function Plan({ d, onGo }: { d: Rec | null; onGo: (tab: string) => void }) {
  if (!d) return (
    <Card title="Recovery plan" right={<Pill>not run yet</Pill>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <p className="min-w-[280px] flex-1 leading-snug text-[#d3d8de]">The rules on the right flag what is wrong. The swarm reads the messages, documents, photos and reports behind them, tests each way out, and brings back a plan for you to decide on.</p>
        <button onClick={() => onGo("swarm")} className={primary}>Open the AI Agent Swarm</button>
      </div>
    </Card>
  );
  const pick = (d.options as Rec[]).find((o) => o.id === (d.status === "approved" ? d.option : d.recommended));
  return (
    <Card title="Recovery plan" right={<>{d.mode === "mock" && <Pill tone="violet">offline mock</Pill>}<Pill tone={d.status === "pending" ? "warn" : d.status === "approved" ? "ok" : "bad"}>{d.status === "pending" ? "waiting for you" : d.status}</Pill></>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-[280px] flex-1 leading-snug text-[#d3d8de]">
          {pick && <p><span className="font-medium text-white">{d.status === "approved" ? "Approved" : "The agents recommend"} {pick.id}:</span> {pick.name}. Pour on {short(pick.evaluation.pour_on)}, {pick.evaluation.days_late ? `${pick.evaluation.days_late} days late` : "milestone kept"}, {money(pick.evaluation.total_cost_rp)}.</p>}
          {d.status === "rejected" && <p>The plan was rejected. Run the swarm again when something changes.</p>}
        </div>
        <button onClick={() => onGo("decisions")} className={d.status === "pending" ? primary : quiet}>{d.status === "pending" ? "Decide" : "Open Decisions"}</button>
      </div>
    </Card>
  );
}

export function ProjectView({ onGo }: { onGo: (tab: string) => void }) {
  const { data, err, act } = useData("/api/project/overview");
  const [sure, setSure] = useState(false);
  if (!data) return <div className="flex-1 overflow-auto"><Problem err={err} />{!err && <Loading />}</div>;
  const k = data.kpis as Rec, m = data.milestone as Rec, c = data.counts as Rec;
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title={clean(data.project.name)} note={`${clean(data.project.contractor)} · scenario date ${data.today}`}>
        {sure ? (
          <>
            <span className="text-[11px] text-[#ffb4b4]">Put every record back to the start of the scenario?</span>
            <button onClick={async () => { setSure(false); await act(() => api("/api/project/reset", {})); }} className={quiet}>Yes, reset</button>
            <button onClick={() => setSure(false)} className={quiet}>Cancel</button>
          </>
        ) : <button onClick={() => setSure(true)} className={quiet}>Reset the scenario</button>}
      </Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label="contract value" value={money(k.contract)} />
        <Kpi label="control budget" value={money(k.budget)} hint={`${money(k.committed)} committed`} />
        <Kpi label="forecast at completion" value={money(k.eac)} hint={`${money(Math.abs(k.variance))} ${k.variance < 0 ? "over" : "under"}`} tone={k.variance < 0 ? "warn" : "ok"} />
        <Kpi label="cost index (CPI)" value={k.cpi} tone={k.cpi < 1 ? "warn" : "ok"} />
        <Kpi label="schedule index (SPI)" value={k.spi} tone={k.spi < 1 ? "warn" : "ok"} />
        <Kpi label={`milestone ${m.id}, due ${short(m.contract_date)}`} value={short(m.forecast)} tone={m.days_late ? "bad" : "ok"} hint={m.days_late ? `${m.days_late} days late` : "on time"} />
        <Kpi label="next pour" value={short(data.pour.start)} hint={data.pour.critical ? "no float" : ""} />
        <Kpi label="open RFIs · NCRs · work items" value={`${c.open_rfis} · ${c.open_ncrs} · ${c.open_work_items}`} />
      </Kpis>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_370px] items-start gap-3 overflow-y-auto bg-[#161a1f] p-3 max-xl:grid-cols-1">
        <div className="min-w-0 space-y-3">
        <WorkPlan p={data.latest_plan as Rec | null} onGo={onGo} />
        <Plan d={data.latest_decision as Rec | null} onGo={onGo} />
        <Card title="The workflow, by work package" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">each cell opens that record</span>}>
          <div className="overflow-x-auto p-2">
            <div className="grid min-w-[900px] gap-1" style={{ gridTemplateColumns: `170px repeat(${STEPS.length}, minmax(0, 1fr))` }}>
              <div />
              {STEPS.map(([key, label], i) => (
                <p key={key} className="flex items-center gap-1 px-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-[#8f99a8]">{label}{i < STEPS.length - 1 && <Icon name="right" className="h-2.5 w-2.5 text-[#5f6b7c]" />}</p>
              ))}
              {(data.chain as Rec[]).map((row) => (
                <Fragment key={row.id}>
                  <div className="flex flex-col justify-center pr-1"><p className="font-medium leading-tight text-white">{row.name}</p><p className="text-[10.5px] text-[#8f99a8]">{row.id}</p></div>
                  {(row.steps as Rec[]).map((s) => (
                    <button key={s.key} disabled={!s.tab} onClick={() => onGo(s.tab)} title={s.tab ? `Open ${s.key}` : "Not built yet"}
                      className={`min-h-[46px] rounded border px-1.5 py-1 text-left ${CELL[s.tone]} ${s.tab ? "hover:brightness-125" : "cursor-default"}`}>
                      <p className="truncate text-[11px] leading-tight text-[#e5e8eb]">{s.text}</p>
                      {s.sub && <p className="truncate text-[10px] leading-tight text-[#abb3bf]">{s.sub}</p>}
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        </Card>
        </div>
        <Card title={`Needs attention (${data.attention.length})`} right={<span className="text-[10.5px] font-normal text-[#8f99a8]">found by code, always on</span>}>
          <div className="max-h-[calc(100vh-205px)] overflow-y-auto">
            {(data.attention as Rec[]).map((a, i) => (
              <button key={i} onClick={() => onGo(a.tab)} className="block w-full border-t border-white/5 px-3 py-1.5 text-left first:border-t-0 hover:bg-white/5">
                <div className="flex items-start gap-1.5"><Pill tone={LEVEL[a.level]}>{a.level}</Pill><p className="min-w-0 text-[11.5px] leading-snug text-[#e5e8eb]">{clean(a.title)}</p></div>
                <p className="mt-0.5 text-[10.5px] leading-snug text-[#abb3bf]">{clean(a.detail)}</p>
              </button>
            ))}
            {!data.attention.length && <p className="p-4 text-center text-[#8f99a8]">Nothing flagged.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
