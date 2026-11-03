"use client";
import { Fragment, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { AgentGraph, type ObjectLink } from "@/components/aip/AgentGraph";
import { aip, type Agent } from "@/components/aip/aipRun";
import { SwarmView } from "@/components/aip/SwarmView";
import { AgentBar } from "./AgentBar";
import { DecisionsView } from "./DecisionsView";
import { api, Bar, Card, clean, Empty, Kpi, Kpis, Loading, money, Pill, primary, Problem, quiet, short, SubTabs, useData, useGo, type Rec, type Tone } from "./kit";

/* Module 8, the Control Tower: how does the whole project stand? Every figure here is its module's own, and every line opens that module. Decisions, the agent swarm and the map of agents live here too, because they cut across all of it. */

const STEPS = [["wbs", "WBS"], ["schedule", "Schedule"], ["cost", "Cost"], ["documents", "Documents"], ["kanban", "Kanban"], ["inspection", "QA/QC"], ["procurement", "Procurement"], ["subcontractor", "Subcontractor"], ["claim", "Claim"], ["payment", "Payment"]];
const CELL: Record<string, string> = { ok: "border-[#29a383]/40 bg-[#29a383]/10", warn: "border-[#fab219]/40 bg-[#fab219]/10", bad: "border-[#e5484d]/50 bg-[#e5484d]/15", info: "border-[#3987e5]/40 bg-[#3987e5]/10", none: "border-white/10 bg-white/[.03]" };
const LEVEL: Record<string, Tone> = { high: "bad", medium: "warn", low: "none" };
const DOT: Record<string, string> = { ok: "bg-[#29a383]", warn: "bg-[#fab219]", bad: "bg-[#e5484d]", none: "bg-[#5f6b7c]" };
const WORD: Record<string, string> = { ok: "on track", warn: "needs a look", bad: "needs action", none: "not started" };

function RecoveryCard({ d }: { d: Rec | null }) {
  const go = useGo();
  if (!d) return (
    <Card title="AI recommendation: recovery" right={<Pill>not run yet</Pill>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <p className="min-w-[240px] flex-1 leading-snug text-[#d3d8de]">The rules flag what is wrong. The swarm reads the messages, documents, photos and reports behind them, tests each way out, and brings back a plan for you to decide on.</p>
        <button onClick={() => go("tower/swarm")} className={primary}>Open the AI agent swarm</button>
      </div>
    </Card>
  );
  const pick = (d.options as Rec[]).find((o) => o.id === (d.status === "approved" ? d.option : d.recommended));
  return (
    <Card title="AI recommendation: recovery" right={<>{d.mode === "mock" && <Pill tone="violet">offline mock</Pill>}<Pill tone={d.status === "pending" ? "warn" : d.status === "approved" ? "ok" : "bad"}>{d.status === "pending" ? "waiting for you" : d.status}</Pill></>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-[240px] flex-1 leading-snug text-[#d3d8de]">
          {pick && <p><span className="font-medium text-white">{d.status === "approved" ? "Approved" : "The agents recommend"} {pick.id}:</span> {pick.name}. Pour on {short(pick.evaluation.pour_on)}, {pick.evaluation.days_late ? `${pick.evaluation.days_late} days late` : "milestone kept"}, {money(pick.evaluation.total_cost_rp)}.</p>}
          {d.status === "rejected" && <p>The plan was rejected. Run the swarm again when something changes.</p>}
        </div>
        <button onClick={() => go("tower/decisions")} className={d.status === "pending" ? primary : quiet}>{d.status === "pending" ? "Decide" : "Open Decisions"}</button>
      </div>
    </Card>
  );
}

function PlanCard({ p }: { p: Rec | null }) {
  const go = useGo();
  if (!p) return (
    <Card title="AI recommendation: work plan" right={<Pill>not planned yet</Pill>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <p className="min-w-[240px] flex-1 leading-snug text-[#d3d8de]">The swarm can break the work down from the consultant&apos;s documents: every task, its procedure, workforce, material and waste.</p>
        <button onClick={() => go("wbs/plan")} className={primary}>Open Work plan</button>
      </div>
    </Card>
  );
  const t = p.totals as Rec;
  return (
    <Card title={`AI recommendation: work plan, ${p.title}`} right={<>{p.mode === "mock" && <Pill tone="violet">offline mock</Pill>}<Pill tone={p.status === "pending" ? "warn" : p.status === "approved" ? "ok" : "bad"}>{p.status === "pending" ? "waiting for you" : p.status}</Pill></>}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <p className="min-w-[240px] flex-1 leading-snug text-[#d3d8de]">{t.operations} operations and {t.inspections} inspections. {Number(t.man_hours).toLocaleString("en-US", { maximumFractionDigits: 0 })} man-hours over {t.days} working days, {t.peak_crew} people at the peak. Material {money(t.material_cost)}, of which waste {money(t.waste_cost)}.{p.open_checks ? ` ${p.open_checks} things to look at.` : ""}</p>
        <button onClick={() => go("wbs/plan")} className={p.status === "pending" ? primary : quiet}>{p.status === "pending" ? "Decide" : "Open the plan"}</button>
      </div>
    </Card>
  );
}

function Dashboard() {
  const { data, err, act } = useData("/api/project/tower");
  const go = useGo();
  const [sure, setSure] = useState(false);
  if (!data) return <div className="flex-1 overflow-auto"><Problem err={err} />{!err && <Loading />}</div>;
  const k = data.kpis as Rec, m = data.milestone as Rec | null, c = data.counts as Rec, p = data.progress as Rec;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title={clean(data.project.name)} note={`${clean(data.project.contractor)} · ${data.project.notice ? `scenario date ${data.today}` : `today ${data.today}`}`}>
        {data.project.notice && (sure ? (
          <>
            <span className="text-[11px] text-[#ffb4b4]">Put every record back to the start of the scenario?</span>
            <button onClick={async () => { setSure(false); await act(() => api("/api/project/reset", {})); }} className={quiet}>Yes, reset</button>
            <button onClick={() => setSure(false)} className={quiet}>Cancel</button>
          </>
        ) : <button onClick={() => setSure(true)} className={quiet}>Reset the scenario</button>)}
      </Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label={`progress, ${p.expected}% expected by today`} value={`${p.actual}%`} tone={p.actual < p.expected ? "warn" : "ok"} />
        <Kpi label="schedule index (SPI)" value={k.spi} tone={k.spi < 1 ? "warn" : "ok"} />
        {m && <Kpi label={`milestone ${m.id}, due ${short(m.contract_date)}`} value={short(m.forecast)} tone={m.days_late ? "bad" : "ok"} hint={m.days_late ? `${m.days_late} days late` : "on time"} />}
        <Kpi label="cost index (CPI)" value={k.cpi} tone={k.cpi < 1 ? "warn" : "ok"} />
        <Kpi label="forecast at completion" value={money(k.eac)} hint={`${money(Math.abs(k.variance))} ${k.variance < 0 ? "over" : "under"}`} tone={k.variance < 0 ? "warn" : "ok"} />
        <Kpi label="contract value" value={money(k.contract)} />
        <Kpi label="high risks" value={(data.attention as Rec[]).filter((a) => a.level === "high").length} tone={(data.attention as Rec[]).some((a) => a.level === "high") ? "bad" : "ok"} />
        <Kpi label="open RFIs · NCRs · to do" value={`${c.open_rfis} · ${c.open_ncrs} · ${c.open_work_items}`} />
      </Kpis>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_370px] items-start gap-3 overflow-y-auto bg-[#161a1f] p-3 max-xl:grid-cols-1">
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(205px,1fr))] gap-2">
            {(data.health as Rec[]).map((h) => (
              <button key={h.key} onClick={() => go(h.key)} className="rounded border border-white/10 bg-[#1c2127] p-2 text-left hover:border-white/30">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#d3d8de]"><i className={`h-2 w-2 shrink-0 rounded-full ${DOT[h.tone]}`} />{h.name}<span className="ml-auto text-[10px] font-normal text-[#8f99a8]">{WORD[h.tone]}</span></span>
                <span className="mt-0.5 block text-[14px] font-semibold tabular-nums text-white">{h.value}</span>
                <span className="block text-[10.5px] leading-tight text-[#8f99a8]">{h.note}</span>
              </button>
            ))}
          </div>
          {data.project.notice && <PlanCard p={data.latest_plan as Rec | null} />}
          {data.project.notice && <RecoveryCard d={data.latest_decision as Rec | null} />}
          {(data.bottlenecks as Rec[]).length > 0 && (
            <Card title="What is holding the most work" right={<button onClick={() => go("kanban/board")} className={quiet}>The board</button>}>
              {(data.bottlenecks as Rec[]).map((b) => (
                <button key={b.kind + b.ref} onClick={() => go(b.go)} className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-1.5 text-left first:border-t-0 hover:bg-white/5">
                  <Pill tone={b.stop ? "bad" : LEVEL[b.level]}>{b.stop ? "stops work" : b.level}</Pill>
                  <span className="min-w-0 flex-1 truncate text-[#e5e8eb]">{clean(b.text)}</span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-[#abb3bf]">holds {b.held}{b.critical ? `, ${b.critical} critical` : ""}</span>
                </button>
              ))}
            </Card>
          )}
          <Card title="Every work package, across the modules" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">each cell opens that module</span>}>
            {(data.chain as Rec[]).length ? (
              <div className="overflow-x-auto p-2">
                <div className="grid min-w-[1000px] gap-1" style={{ gridTemplateColumns: `170px repeat(${STEPS.length}, minmax(0, 1fr))` }}>
                  <div />
                  {STEPS.map(([key, label], i) => <p key={key} className="flex items-center gap-1 px-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-[#8f99a8]">{label}{i < STEPS.length - 1 && <Icon name="right" className="h-2.5 w-2.5 text-[#5f6b7c]" />}</p>)}
                  {(data.chain as Rec[]).map((row) => (
                    <Fragment key={row.id}>
                      <div className="flex flex-col justify-center pr-1"><p className="font-medium leading-tight text-white">{row.name}</p><p className="text-[10.5px] text-[#8f99a8]">{row.code} · {row.id}</p></div>
                      {(row.steps as Rec[]).map((s) => (
                        <button key={s.key} onClick={() => go(s.tab)} title={`Open ${s.key}`} className={`min-h-[46px] rounded border px-1.5 py-1 text-left hover:brightness-125 ${CELL[s.tone]}`}>
                          <p className="truncate text-[11px] leading-tight text-[#e5e8eb]">{s.text}</p>
                          {s.sub && <p className="truncate text-[10px] leading-tight text-[#abb3bf]">{s.sub}</p>}
                        </button>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            ) : <Empty>No work packages yet. <button onClick={() => go("wbs/tree")} className="underline">Start the breakdown</button>.</Empty>}
          </Card>
        </div>
        <Card title={`Risks (${data.attention.length})`} right={<span className="text-[10.5px] font-normal text-[#8f99a8]">found by code, always on</span>}>
          <div className="max-h-[calc(100vh-205px)] overflow-y-auto">
            {(data.attention as Rec[]).map((a, i) => (
              <button key={i} onClick={() => go(a.ref ? `${a.tab}:${a.ref}` : a.tab)} className="block w-full border-t border-white/5 px-3 py-1.5 text-left first:border-t-0 hover:bg-white/5">
                <div className="flex items-start gap-1.5"><Pill tone={LEVEL[a.level]}>{a.level}</Pill><p className="min-w-0 text-[11.5px] leading-snug text-[#e5e8eb]">{clean(a.title)}</p></div>
                <p className="mt-0.5 text-[10.5px] leading-snug text-[#abb3bf]">{clean(a.detail)}</p>
              </button>
            ))}
            {!data.attention.length && <Empty>Nothing flagged.</Empty>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Agents() {
  const { data } = useData("/api/project/agents");
  const go = useGo();
  const [cat, setCat] = useState<{ agents: Agent[]; roles: Record<string, string>; links?: ObjectLink[] } | null>(null);
  useEffect(() => { aip.agents().then(setCat).catch(() => {}); }, []);
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#161a1f] p-3 text-[12px]">
      <Card title="An agent on each module" right={<span className="text-[10.5px] font-normal text-[#8f99a8]">agents propose, people decide. Built on CAMEL-AI, running on Muse through the Meta Model API</span>}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-2 p-2">
          {((data?.modules ?? []) as Rec[]).map((m) => (
            <button key={m.key} onClick={() => go(m.key)} className="rounded border border-white/10 bg-black/10 p-2 text-left hover:border-white/30">
              <span className="flex items-center gap-1.5 font-medium text-white"><Icon name="sparkle" className="h-3.5 w-3.5 text-[#9d8cff]" />{m.name}<span className="ml-auto text-[10px] font-normal text-[#8f99a8]">{m.module}</span></span>
              <span className="mt-0.5 block leading-snug text-[#d3d8de]">{m.does}</span>
              <span className="mt-0.5 block text-[10.5px] text-[#8f99a8]">Works with {(m.team as string[]).join(", ")}</span>
              <span className="mt-1 flex gap-1">{m.findings > 0 && <Pill tone="warn">{m.findings} from the swarm</Pill>}{m.advice ? <Pill tone="info">last looked {m.advice}</Pill> : <Pill>has not looked yet</Pill>}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="The swarm's leads, and the records each one owns">
        {cat ? <div className="p-2"><AgentGraph agents={cat.agents} roles={cat.roles} links={cat.links ?? []} /></div> : <Loading />}
      </Card>
    </div>
  );
}

export function TowerModule({ sub }: { sub: string }) {
  const tab = ["decisions", "swarm", "agents"].includes(sub) ? sub : "dashboard";
  const { data } = useData("/api/project/overview");
  const waiting = (data?.counts?.pending_decisions ?? 0) + (data?.counts?.draft_messages ?? 0);
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SubTabs base="tower" sub={tab} tabs={[["dashboard", "Dashboard"], ["decisions", "Decisions", waiting || undefined], ["swarm", "AI agent swarm"], ["agents", "Agents"]]} />
      {tab !== "swarm" && <AgentBar module="tower" />}
      {tab === "dashboard" && <Dashboard />}
      {tab === "decisions" && <DecisionsView />}
      {tab === "swarm" && (data && !data.project?.notice
        ? <div className="flex-1 bg-[#161a1f] text-[12px]"><Empty>A swarm review reads the scenario&apos;s documents and records, so it runs on the scenario for now. On your own project, ask the agent on each module.</Empty></div>
        : <div className="flex min-h-0 flex-1"><SwarmView /></div>)}
      {tab === "agents" && <Agents />}
    </div>
  );
}
