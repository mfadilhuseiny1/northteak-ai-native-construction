"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Icon, type IconName } from "@/components/Icon";
import { api, FocusContext, GoContext, quiet, useGo, type Focus, type Rec } from "@/components/site/kit";
import { WbsModule } from "@/components/site/WbsModule";
import { ScheduleModule } from "@/components/site/ScheduleModule";
import { CostModule } from "@/components/site/CostModule";
import { KanbanModule } from "@/components/site/KanbanModule";
import { DocumentsModule } from "@/components/site/DocumentsModule";
import { ProcurementModule } from "@/components/site/ProcurementModule";
import { QualityModule } from "@/components/site/QualityModule";
import { TowerModule } from "@/components/site/TowerModule";
import { AnalysisModule } from "@/components/site/AnalysisModule";
import { AnalysisView } from "@/components/site/AnalysisView";
import { AnalysisWorkspace } from "@/components/site/AnalysisWorkspace";
import { OperatorChat } from "@/components/site/OperatorChat";
import { ProjectStart } from "@/components/site/ProjectStart";
import { ReviewModule } from "@/components/site/ReviewModule";
import { SourceDrawer } from "@/components/site/SourceDrawer";
import { WorkPackages } from "@/components/site/WbsViews";
import { CriticalModule } from "@/components/site/CriticalModule";
import { PlanningModule } from "@/components/site/PlanningModule";
import { ProceduresModule } from "@/components/site/ProceduresModule";
import { RiskModule } from "@/components/site/RiskModule";

// three.js is large: the 3D timeline loads only when its tab is opened, and only in the browser
const Model3DModule = dynamic(() => import("@/components/site/Model3DModule").then((m) => m.Model3DModule), { ssr: false, loading: () => <p className="p-6 text-[12px] text-[#abb3bf]">Loading the 3D view…</p> });

/* The consultant provides the plan, AI turns it into structured project data, and the project manager approves it: that is Set up. Every view of the Workspace then reads the same work packages, and the copilot is at hand throughout. A link opens the record it names. */

const GROUPS: [string, [string, string, IconName][]][] = [
  ["Set up", [["planning", "Planning", "upload"], ["review", "Review", "check"]]],
  ["Workspace", [["list", "List", "list"], ["wbs", "WBS", "pipeline"], ["gantt", "Timeline", "clock"], ["critical", "Critical Path", "graph"], ["kanban", "Kanban", "grid"], ["model", "3D Timeline", "cube"]]],
  ["Records", [["procedures", "Procedures", "doc"], ["cost", "Cost", "gauge"]]],
];
const TABS = GROUPS.flatMap(([, tabs]) => tabs);
const OFF_MENU = ["new", "documents", "schedule", "procurement", "quality", "tower", "risks", "agents"];  // out of the menu to keep the flow plain. A link that needs one still opens it: an RFI to answer, a hold point to sign
const MOVED: Record<string, string> = { "analysis": "review", "wbs/plan": "review", "tower/swarm": "review", "wbs/packages": "list", "schedule": "gantt", "schedule/gantt": "gantt", "schedule/network": "critical" };
const SETUP_QUESTIONS = ["Where do the documents disagree, and what should I settle before approving?", "What is missing from this package?", "Which assumptions should I check first?", "Explain the critical path in plain words."];
const COPILOT = "siteswarm.copilot";

function readRoute() {
  const text = typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1));
  const [path, target] = text.split(":", 2);
  const [tab, sub] = (MOVED[path] ?? path).split("/");
  return { tab: TABS.some(([k]) => k === tab) || OFF_MENU.includes(tab) ? tab : "planning", sub: sub || "", target: target || "" };
}

/** Which project the whole app is on, and the way to a new one, which starts from its documents. */
function ProjectSwitch() {
  const go = useGo();
  const [list, setList] = useState<Rec | null>(null);
  useEffect(() => { api("/api/projects").then(setList).catch(() => {}); }, []);
  const open = async (id: string) => { await api(`/api/projects/${id}/open`, {}); window.location.hash = ""; window.location.reload(); };
  if (!list) return null;
  const rows = list.projects as Rec[];
  return (
    <span className="flex shrink-0 items-center gap-1">
      <select aria-label="Project" value={list.active} onChange={(e) => void open(e.target.value)} className="max-w-[190px] rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-[11.5px] text-white">
        {rows.map((p) => <option key={p.id} value={p.id} className="bg-[#1c2127]">{String(p.name).replace(" (fictional)", "")}</option>)}
      </select>
      <button onClick={() => go("new")} title="Start a new project from its planning documents" aria-label="New project" className="rounded p-1 text-[#abb3bf] hover:bg-white/10 hover:text-white"><Icon name="plus" className="h-3.5 w-3.5" /></button>
    </span>
  );
}

export default function Home() {
  const [route, setRoute] = useState(() => ({ tab: "planning", sub: "", target: "" }));
  const [focus, setFocus] = useState<Focus>(null);
  const [counts, setCounts] = useState<Rec>({});
  const [own, setOwn] = useState<boolean | null>(null);
  const [copilot, setCopilot] = useState<boolean | null>(null);  // null until a person says: then it opens by itself where the plan is being checked, on a screen with room for it
  const [wide, setWide] = useState(false);
  const [held, setHeld] = useState(false);  // kept mounted once opened, so that the conversation survives changing tab
  useEffect(() => {
    setWide(window.matchMedia("(min-width: 1400px)").matches);
    try { const saved = localStorage.getItem(COPILOT); if (saved) setCopilot(saved === "on"); } catch { /* storage off */ }
  }, []);
  useEffect(() => {
    const read = () => setRoute(readRoute());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = useCallback((path: string) => {
    const next = encodeURI(path);
    if (window.location.hash.slice(1) === next) setRoute(readRoute());
    else window.location.hash = next;
  }, []);
  useEffect(() => {
    const read = () => api("/api/project/overview").then((o) => { setCounts(o.counts); setOwn(!o.project.notice); }).catch(() => {});
    void read();
    window.addEventListener("records-changed", read);
    return () => window.removeEventListener("records-changed", read);
  }, [route.tab]);
  const focusValue = useMemo(() => ({ focus, setFocus }), [focus]);
  const badge: Record<string, number> = { review: counts.pending_plans ?? 0 };
  const setup = route.tab === "planning" || route.tab === "review";
  const showCopilot = route.tab !== "new" && (copilot ?? (setup && own === true && wide));
  useEffect(() => { if (showCopilot) setHeld(true); }, [showCopilot]);
  const toggleCopilot = () => {
    const next = !showCopilot;
    setCopilot(next);
    try { localStorage.setItem(COPILOT, next ? "on" : "off"); } catch { /* storage off */ }
  };
  return (
    <GoContext.Provider value={go}>
      <FocusContext.Provider value={focusValue}>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#2f3c48] text-[#f6f7f9]">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-black/40 bg-[#111418] px-3 text-[12px]">
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold"><Icon name="sparkle" className="h-4 w-4 text-[#9d8cff]" />SiteSwarm</span>
            <nav className="mx-auto flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
              {GROUPS.map(([group, tabs], g) => (
                <span key={group} className={`flex shrink-0 items-center gap-0.5 ${g ? "border-l border-white/10 pl-2" : ""}`}>
                  <span className="mr-1 text-[9.5px] uppercase tracking-wider text-[#6b7480] max-[1560px]:hidden">{group}</span>
                  {tabs.map(([k, label, icon]) => {
                    const on = (route.tab === "documents" ? "planning" : route.tab) === k;
                    return (
                      <button key={k} onClick={() => go(k)} aria-current={on ? "page" : undefined} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 ${on ? "bg-white/10 text-white" : "text-[#d3d8de] hover:bg-white/5"}`}>
                        <Icon name={icon} className="h-3.5 w-3.5" />{label}
                        {badge[k] > 0 && <span className="rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{badge[k]}</span>}
                      </button>
                    );
                  })}
                </span>
              ))}
            </nav>
            {route.tab !== "new" && <button onClick={toggleCopilot} aria-pressed={showCopilot} title="Ask about this project. It reads the live records and only advises." className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 ${showCopilot ? "border-[#9d8cff]/60 bg-[#9d8cff]/20 text-white" : "border-white/15 text-[#d3d8de] hover:bg-white/5"}`}><Icon name="sparkle" className="h-3.5 w-3.5 text-[#9d8cff]" />AI Copilot</button>}
            <ProjectSwitch />
            {own === false && <span className="shrink-0 text-[11px] text-[#abb3bf] max-[1750px]:hidden">Synthetic data. No real project, company or person.</span>}
          </header>
          {focus && (
            <div className="flex shrink-0 items-center gap-2 border-b border-[#9d8cff]/30 bg-[#9d8cff]/[.08] px-3 py-1 text-[11.5px] text-[#d9d3ff]">
              <Icon name="fit" className="h-3.5 w-3.5" />Every tab shows only <b className="font-semibold text-white">{focus.code} {focus.name}</b>
              <button onClick={() => go(`wbs/tree:${focus.code}`)} className={quiet}>Open in the WBS</button>
              <button onClick={() => setFocus(null)} className={`${quiet} ml-auto`}>Show the whole project</button>
            </div>
          )}
          <div className="relative flex min-h-0 flex-1">
            {route.tab === "new" && <ProjectStart create onCancel={() => go("planning")} />}
            {route.tab === "planning" && own === true && <AnalysisWorkspace />}
            {route.tab === "planning" && own === false && <PlanningModule />}
            {route.tab === "review" && own === true && <ReviewModule />}
            {route.tab === "review" && own === false && <AnalysisView />}
            {route.tab === "list" && <WorkPackages />}
            {route.tab === "wbs" && <WbsModule sub={route.sub} target={route.target} />}
            {route.tab === "procedures" && <ProceduresModule />}
            {route.tab === "critical" && <CriticalModule />}
            {route.tab === "gantt" && <ScheduleModule sub="gantt" target={route.target} />}
            {route.tab === "model" && <Model3DModule />}
            {route.tab === "schedule" && <ScheduleModule sub={route.sub} target={route.target} />}
            {route.tab === "cost" && <CostModule sub={route.sub} target={route.target} />}
            {route.tab === "kanban" && <KanbanModule sub={route.sub} target={route.target} />}
            {route.tab === "documents" && <DocumentsModule sub={route.sub} target={route.target} />}
            {route.tab === "procurement" && <ProcurementModule sub={route.sub} target={route.target} />}
            {route.tab === "quality" && <QualityModule sub={route.sub} target={route.target} />}
            {route.tab === "tower" && <TowerModule sub={route.sub} />}
            {route.tab === "risks" && <RiskModule />}
            {route.tab === "agents" && <AnalysisModule />}
            {held && <aside className={showCopilot ? "flex w-[380px] shrink-0 flex-col border-l border-black/40 max-lg:w-[320px]" : "hidden"} aria-label="AI Copilot"><OperatorChat compact tab={route.tab} starters={setup ? SETUP_QUESTIONS : undefined} onClose={toggleCopilot} /></aside>}
          </div>
          <SourceDrawer />
        </div>
      </FocusContext.Provider>
    </GoContext.Provider>
  );
}
