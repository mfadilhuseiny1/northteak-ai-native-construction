"use client";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { SwarmView } from "@/components/aip/SwarmView";
import { AgentGraph, type ObjectLink } from "@/components/aip/AgentGraph";
import { aip, type Agent } from "@/components/aip/aipRun";
import { RfiView } from "@/components/aip/RfiView";
import { api } from "@/components/site/kit";
import { PlanView } from "@/components/site/PlanView";
import { ProjectView } from "@/components/site/ProjectView";
import { ScheduleView } from "@/components/site/ScheduleView";
import { BudgetView } from "@/components/site/BudgetView";
import { SubcontractorsView } from "@/components/site/SubcontractorsView";
import { ClaimsView, DailyReportsView, ProcurementView, QualityView } from "@/components/site/RecordsViews";
import { DecisionsView } from "@/components/site/DecisionsView";

const TABS: [string, string, IconName][] = [["project", "Project", "home"], ["plans", "Work plans", "pipeline"], ["swarm", "AI Agent Swarm", "graph"], ["agents", "Agents", "sparkle"], ["decisions", "Decisions", "check"], ["schedule", "Schedule", "clock"], ["budget", "Budget", "gauge"],
  ["subcontractors", "Subcontractors", "grid"], ["procurement", "Procurement", "layers"], ["reports", "Daily reports", "doc"], ["quality", "Quality", "eye"], ["rfis", "RFIs", "edit"], ["claims", "Claims", "table"]];

export default function Home() {
  const [tab, setTab] = useState("project");
  const [cat, setCat] = useState<{ agents: Agent[]; roles: Record<string, string>; links?: ObjectLink[] } | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [plansWaiting, setPlansWaiting] = useState(0);
  useEffect(() => {
    if (tab === "agents" && !cat) aip.agents().then(setCat).catch(() => {});
    api("/api/project/overview").then((o) => { setWaiting(o.counts.pending_decisions + o.counts.draft_messages); setPlansWaiting(o.counts.pending_plans); }).catch(() => {});
  }, [tab, cat]);
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#2f3c48] text-[#f6f7f9]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-black/40 bg-[#111418] px-3 text-[12px]">
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold"><Icon name="sparkle" className="h-4 w-4 text-[#9d8cff]" />SiteSwarm</span>
        <nav className="mx-auto flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {TABS.map(([k, label, icon]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 ${tab === k ? "bg-white/10 text-white" : "text-[#d3d8de] hover:bg-white/5"}`}>
              <Icon name={icon} className="h-3.5 w-3.5" />{label}
              {k === "decisions" && waiting > 0 && <span className="rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{waiting}</span>}
              {k === "plans" && plansWaiting > 0 && <span className="rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{plansWaiting}</span>}
            </button>
          ))}
        </nav>
        <span className="shrink-0 text-[11px] text-[#abb3bf] max-2xl:hidden">Synthetic data. No real project, company or person.</span>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {tab === "project" && <ProjectView onGo={setTab} />}
        {tab === "plans" && <PlanView onGo={setTab} />}
        {tab === "swarm" && <SwarmView />}
        {tab === "agents" && (cat
          ? <div className="min-h-0 flex-1 overflow-auto p-3"><AgentGraph agents={cat.agents} roles={cat.roles} links={cat.links ?? []} /></div>
          : <p className="p-6 text-[#abb3bf]">Loading the agents…</p>)}
        {tab === "decisions" && <DecisionsView />}
        {tab === "schedule" && <ScheduleView onGo={setTab} />}
        {tab === "budget" && <BudgetView />}
        {tab === "subcontractors" && <SubcontractorsView />}
        {tab === "procurement" && <ProcurementView />}
        {tab === "reports" && <DailyReportsView />}
        {tab === "quality" && <QualityView />}
        {tab === "rfis" && <RfiView />}
        {tab === "claims" && <ClaimsView />}
      </div>
    </div>
  );
}
