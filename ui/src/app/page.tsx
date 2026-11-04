"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Icon, type IconName } from "@/components/Icon";
import { api, FocusContext, GoContext, notifyChanged, quiet, type Focus, type Rec } from "@/components/site/kit";
import { WbsModule } from "@/components/site/WbsModule";
import { ReportsModule } from "@/components/site/ReportsModule";
import { DemoTour } from "@/components/site/DemoTour";
import { DigitalTwinModule } from "@/components/site/DigitalTwinModule";
import { ScheduleModule } from "@/components/site/ScheduleModule";
import { CostModule } from "@/components/site/CostModule";
import { KanbanModule } from "@/components/site/KanbanModule";
import { DocumentsModule } from "@/components/site/DocumentsModule";
import { ProcurementModule } from "@/components/site/ProcurementModule";
import { QualityModule } from "@/components/site/QualityModule";
import { TowerModule } from "@/components/site/TowerModule";
import { AnalysisModule } from "@/components/site/AnalysisModule";
import { AnalysisView } from "@/components/site/AnalysisView";
import { HomeModule } from "@/components/site/HomeModule";
import { OperatorChat } from "@/components/site/OperatorChat";
import { ReviewModule } from "@/components/site/ReviewModule";
import { SourceDrawer } from "@/components/site/SourceDrawer";
import { CriticalModule } from "@/components/site/CriticalModule";
import { ProceduresModule } from "@/components/site/ProceduresModule";
import { RiskModule } from "@/components/site/RiskModule";

// three.js is large: the 3D timeline loads only when its tab is opened, and only in the browser
const Model3DModule = dynamic(() => import("@/components/site/Model3DModule").then((m) => m.Model3DModule), { ssr: false, loading: () => <p className="p-6 text-[12px] text-[#abb3bf]">Loading the 3D view…</p> });

/* Home is where a project starts, empty, and where a person tells the agents what is being planned. AI turns that into structured project data, and the project manager approves it on Review. Every view of the Workspace then reads the same work packages, and the copilot is at hand throughout. A link opens the record it names. */

const GROUPS: [string, [string, string, IconName][]][] = [
  ["Set up", [["review", "Review", "check"]]],
  ["Workspace", [["wbs", "WBS", "pipeline"], ["gantt", "Timeline", "clock"], ["critical", "Critical Path", "graph"], ["kanban", "Kanban", "grid"], ["model", "3D Timeline", "cube"], ["twin", "Digital Twin", "signal"]]],
  ["Records", [["procedures", "Procedures", "doc"], ["cost", "Cost", "gauge"], ["reports", "Reports", "report"]]],
];
const TABS = GROUPS.flatMap(([, tabs]) => tabs);
const OFF_MENU = ["documents", "schedule", "procurement", "quality", "tower", "risks", "agents"];  // out of the menu to keep the flow plain. A link that needs one still opens it: an RFI to answer, a hold point to sign
const MOVED: Record<string, string> = { "new": "home", "planning": "home", "analysis": "review", "wbs/plan": "review", "tower/swarm": "review", "list": "wbs/packages", "schedule": "gantt", "schedule/gantt": "gantt", "schedule/network": "critical" };
const SETUP_QUESTIONS = ["Where do the documents disagree, and what should I settle before approving?", "What is missing from this package?", "Which assumptions should I check first?", "Explain the critical path in plain words."];
const COPILOT = "siteswarm.copilot";

function readRoute() {
  const text = typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1));
  const [path, target] = text.split(":", 2);
  const [tab, sub] = (MOVED[path] ?? path).split("/");
  return { tab: tab === "home" || TABS.some(([k]) => k === tab) || OFF_MENU.includes(tab) ? tab : "home", sub: sub || "", target: target || "" };
}

/** Which project the whole app is on. A new one starts on Home. */
function ProjectSwitch() {
  const [list, setList] = useState<Rec | null>(null);
  useEffect(() => { api("/api/projects").then(setList).catch(() => {}); }, []);
  const open = async (id: string) => { await api(`/api/projects/${id}/open`, {}); window.location.hash = ""; window.location.reload(); };
  if (!list) return null;
  const rows = list.projects as Rec[];
  return (
    <select aria-label="Project" value={list.active} onChange={(e) => void open(e.target.value).catch((x) => window.alert((x as Error).message))} className="max-w-[190px] shrink-0 rounded border max-[1500px]:max-w-[140px] border-white/15 bg-black/20 px-1.5 py-0.5 text-[11.5px] text-white">
      {rows.map((p) => <option key={p.id} value={p.id} className="bg-[#1c2733]">{String(p.name).replace(" (fictional)", "")}</option>)}
    </select>
  );
}

export default function Home() {
  const [route, setRoute] = useState(() => ({ tab: "home", sub: "", target: "" }));
  const [focus, setFocus] = useState<Focus>(null);
  const [counts, setCounts] = useState<Rec>({});
  const [own, setOwn] = useState<boolean | null>(null);
  const [copilot, setCopilot] = useState<boolean | null>(null);  // null until a person says: then it opens by itself where the plan is being checked, on a screen with room for it
  const [wide, setWide] = useState(false);
  const [held, setHeld] = useState(false);  // kept mounted once opened, so that the conversation survives changing tab
  const [working, setWorking] = useState(false);
  const [demo, setDemo] = useState(false);  // the guided three-minute demo, for presenting  // the agents are at work on this project: when they finish, every tab reads its data again and fills in
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
  useEffect(() => {
    const read = () => api("/api/aip/analysis").then((a) => setWorking(a.run?.status === "running")).catch(() => {});
    void read();
    window.addEventListener("records-changed", read);
    return () => window.removeEventListener("records-changed", read);
  }, []);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void api("/api/aip/analysis").then((a) => { if (a.run?.status !== "running") { setWorking(false); notifyChanged(); } }).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [working]);
  const focusValue = useMemo(() => ({ focus, setFocus }), [focus]);
  const badge: Record<string, number> = { review: counts.pending_plans ?? 0 };
  const setup = route.tab === "home" || route.tab === "review";
  const showCopilot = copilot ?? (route.tab === "review" && own === true && wide);  // Home has the conversation and the documents side by side, so the copilot opens there only when asked
  useEffect(() => { if (showCopilot) setHeld(true); }, [showCopilot]);
  const toggleCopilot = () => {
    const next = !showCopilot;
    setCopilot(next);
    try { localStorage.setItem(COPILOT, next ? "on" : "off"); } catch { /* storage off */ }
  };
  return (
    <GoContext.Provider value={go}>
      <FocusContext.Provider value={focusValue}>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#111820] text-[#f6f7f9]">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-black/50 bg-[#151e28] px-3 text-[12px] shadow-[0_1px_0_rgb(255_255_255/.04)_inset]">
            <span className="flex shrink-0 items-center gap-2 whitespace-nowrap"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#f5b82e] shadow-[0_2px_8px_rgb(245_184_46/.35)]"><Icon name="sparkle" className="h-4 w-4 text-[#171106]" /></span><span className="leading-none max-[1500px]:hidden"><span className="block text-[13px] font-bold tracking-tight text-white">SiteSwarm</span><span className="mt-0.5 block text-[9px] font-medium uppercase tracking-[.14em] text-[#7d8b9b]">AI construction control</span></span></span>
            <nav className="no-scrollbar mx-auto flex min-w-0 items-center gap-2 overflow-x-auto">
              <button onClick={() => go("home")} aria-current={route.tab === "home" ? "page" : undefined} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-[12.5px] font-bold ${route.tab === "home" ? "border-[#f5b82e] bg-[#f5b82e] text-[#171106] shadow-[0_2px_10px_rgb(245_184_46/.30)]" : "border-[#f5b82e]/70 text-[#f5b82e] hover:bg-[#f5b82e]/15"}`}><Icon name="home" className="h-4 w-4" />Home</button>
              {GROUPS.map(([group, tabs]) => (
                <span key={group} className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-2">
                  <span className="mr-1 text-[9.5px] uppercase tracking-wider text-[#6b7480] max-[1800px]:hidden">{group}</span>
                  {tabs.map(([k, label, icon]) => {
                    const on = route.tab === k;
                    return (
                      <button key={k} onClick={() => go(k)} aria-current={on ? "page" : undefined} title={label} aria-label={label} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 max-[1700px]:px-2 ${on ? "bg-[#f5b82e] font-semibold text-[#171106] shadow-[0_2px_10px_rgb(245_184_46/.30)]" : "text-[#c3ccd6] hover:bg-white/[.07] hover:text-white"}`}>
                        <Icon name={icon} className="h-3.5 w-3.5" /><span className={on ? "" : "max-[1700px]:hidden"}>{label}</span>
                        {badge[k] > 0 && <span className={`rounded-full px-1.5 text-[10px] font-bold ${on ? "bg-[#171106] text-[#f5b82e]" : "bg-[#fab219] text-black"}`}>{badge[k]}</span>}
                      </button>
                    );
                  })}
                </span>
              ))}
            </nav>
            <button onClick={() => setDemo(true)} title="A three-minute guided demo: each step opens its screen and says what to show" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#f5b82e]/50 px-2.5 py-1 font-medium text-[#f5b82e] hover:bg-[#f5b82e]/10"><Icon name="play" className="h-3.5 w-3.5" />Demo</button>
            <button onClick={toggleCopilot} aria-pressed={showCopilot} title="Ask about this project. It reads the live records and only advises." className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 font-medium ${showCopilot ? "border-[#2dd4ee] bg-[#2dd4ee] text-[#062a33]" : "border-[#2dd4ee]/50 text-[#2dd4ee] hover:bg-[#2dd4ee]/10"}`}><Icon name="sparkle" className="h-3.5 w-3.5" />AI Copilot</button>
            <ProjectSwitch />
            {own === false && <span className="shrink-0 text-[11px] text-[#abb3bf] max-[1750px]:hidden">Synthetic data. No real project, company or person.</span>}
          </header>
          {working && route.tab !== "home" && (
            <div className="flex shrink-0 items-center gap-2 border-b border-[#2dd4ee]/30 bg-[#2dd4ee]/[.08] px-3 py-1.5 text-[11.5px] text-[#bdf0f8]">
              <Icon name="sparkle" className="h-3.5 w-3.5 animate-pulse" />The agents are working on this project. This tab fills in when they finish.
              <button onClick={() => go("home")} className={`${quiet} ml-auto`}>Watch them</button>
            </div>
          )}
          {focus && (
            <div className="flex shrink-0 items-center gap-2 border-b border-[#f5b82e]/40 bg-[#f5b82e]/[.08] px-3 py-1.5 text-[11.5px] text-[#ffe1a1]">
              <Icon name="fit" className="h-3.5 w-3.5" />Every tab shows only <b className="font-semibold text-white">{focus.code} {focus.name}</b>
              <button onClick={() => go(`wbs/tree:${focus.code}`)} className={quiet}>Open in the WBS</button>
              <button onClick={() => setFocus(null)} className={`${quiet} ml-auto`}>Show the whole project</button>
            </div>
          )}
          <div className="relative flex min-h-0 flex-1">
            {route.tab === "home" && <HomeModule />}
            {route.tab === "review" && own === true && <ReviewModule />}
            {route.tab === "review" && own === false && <AnalysisView />}
            {route.tab === "wbs" && <WbsModule sub={route.sub} target={route.target} />}
            {route.tab === "reports" && <ReportsModule sub={route.sub} target={route.target} />}
            {route.tab === "twin" && <DigitalTwinModule />}
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
          {demo && <DemoTour onClose={() => setDemo(false)} />}
        </div>
      </FocusContext.Provider>
    </GoContext.Provider>
  );
}
