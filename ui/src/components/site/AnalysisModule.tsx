"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, Card, Empty, good, Kpi, Kpis, Loading, notifyChanged, Pill, primary, Problem, quiet, useGo, type Rec, type Tone } from "./kit";
import { OperatorChat } from "./OperatorChat";
import { MemoryPanel } from "./MemoryPanel";

/* Tab 9, AI Agent Analysis: every module's agent on one page. Each agent reads its module's live records and
   recommends; the swarm's findings for that module sit under the same heading. Agents propose, people decide:
   asking again replaces the last answer and changes nothing else, and a recommendation changes nothing until
   a person accepts it here. Offline, code works the recommendations out by rule at no cost; on Muse, one
   call per module, and code drops anything citing a record that does not exist. */

const KEYS = ["wbs", "schedule", "cost", "kanban", "documents", "procurement", "quality", "tower"];
const TAG: Record<string, string> = { DOCUMENT_CONFLICT: "Documents disagree", SUPERSEDED_DRAWING: "Superseded drawing", BOQ_MISMATCH: "BoQ mismatch", CREW_SHORT: "Crew short", TIME_SHORT: "Time short", SCOPE_GAP: "Scope gap", RFI_OPEN: "Open RFI", SEQUENCE_RISK: "Sequence risk", MATERIAL_WASTE: "Material waste", HANDLING_WASTE: "Handling waste", SAFETY: "Safety", COST_EXPOSURE: "Cost exposure", OTHER: "Other" };
const STATE: Record<string, Tone> = { accepted: "ok", dismissed: "none" };

function ModuleAnalysis({ v, busy, ask, decide }: { v: Rec; busy: string; ask: (module: string, mode: string) => void; decide: (module: string, index: number, verdict: string) => void }) {
  const go = useGo();
  const advice = v.advice as Rec | null;
  const findings = (v.findings ?? []) as Rec[];
  const items = ((advice?.items ?? []) as Rec[]);
  const open = items.filter((x) => x.state === "open").length;
  const mine = busy.startsWith(`${v.key}:`) || busy.startsWith("all:");
  return (
    <section id={`analysis-${v.key}`} className="scroll-mt-3">
      <Card
        title={<span className="flex flex-wrap items-center gap-1.5"><Icon name="sparkle" className="h-3.5 w-3.5 text-[#f5b82e]" />{v.name}<span className="text-[10.5px] font-normal text-[#8f99a8]">{v.module}</span></span>}
        right={<>
          {open > 0 && <Pill tone="violet">{open} to decide</Pill>}
          {findings.length > 0 && <Pill tone="warn">{findings.length} from the swarm</Pill>}
          <button onClick={() => go(v.key)} className={quiet}>Open the module</button>
          <button disabled={!!busy} onClick={() => ask(v.key, "mock")} title="Worked out by code from the records, with no model. Free." className={quiet}>{busy === `${v.key}:mock` ? "Looking…" : "Ask: offline"}</button>
          <button disabled={!!busy || !v.muse_ready} onClick={() => ask(v.key, "muse")} title={v.muse_ready ? "One call to Muse Spark on the Meta Model API, with this module's records. About a cent." : "Add META_API_KEY to .env.local"} className={quiet}>{busy === `${v.key}:muse` ? "Asking Muse…" : "Ask: Muse"}</button>
        </>}
      >
        <div className="space-y-2 p-3">
          <p className="leading-snug text-[#d3d8de]">{v.does}. <span className="text-[10.5px] text-[#8f99a8]">Works with {(v.team as string[]).join(", ")}.</span></p>
          {advice ? (
            <div className="space-y-1">
              <p className="text-[#d3d8de]"><b className="font-medium text-white">{advice.summary}</b> <span className="text-[10.5px] text-[#8f99a8]">{advice.mode === "mock" ? "Offline: code, no model" : `Muse Spark, $${advice.usd}`} · {advice.at}{advice.dropped ? ` · code dropped ${advice.dropped} that cited what the records do not hold` : ""}</span></p>
              {items.map((x, i) => (
                <div key={i} className={`flex flex-wrap items-start gap-2 rounded border border-white/10 px-2 py-1.5 ${x.state === "open" ? "bg-black/10" : "opacity-60"}`}>
                  <div className="min-w-[240px] flex-1">
                    <p className="font-medium leading-snug text-white">{x.title}</p>
                    <p className="leading-snug text-[#abb3bf]">{x.why}</p>
                    {((x.lessons ?? []) as Rec[]).map((l, j) => <p key={j} className="mt-0.5 leading-snug text-[#9cc7f5]">Learned: {l.text}</p>)}
                    {(x.refs as string[]).length > 0 && <p className="mt-0.5 text-[10.5px] text-[#8f99a8]">On {(x.refs as string[]).join(", ")}</p>}
                  </div>
                  {x.state !== "open" ? <span className="flex shrink-0 items-center gap-1"><Pill tone={STATE[x.state]}>{x.state}{x.made ? `: ${x.made}` : ""}</Pill>{x.state === "dismissed" && <button disabled={mine} onClick={() => decide(v.key, i, "reopen")} className={quiet}>Bring back</button>}</span> : (
                    <span className="flex shrink-0 gap-1">
                      {x.action.type === "open" && <button onClick={() => go(x.action.go)} className={quiet}>Open</button>}
                      {x.action.type === "work_item" && <button disabled={mine} onClick={() => decide(v.key, i, "accept")} className={good}>Put on the board</button>}
                      {x.action.type === "rfi" && <button disabled={mine} onClick={() => decide(v.key, i, "accept")} className={good}>Draft the RFI</button>}
                      {x.action.type === "none" && <button disabled={mine} onClick={() => decide(v.key, i, "accept")} className={quiet}>Noted</button>}
                      <button disabled={mine} onClick={() => decide(v.key, i, "dismiss")} className={quiet}>Dismiss</button>
                    </span>
                  )}
                </div>
              ))}
              {!items.length && <p className="text-[#8f99a8]">Nothing to act on.</p>}
            </div>
          ) : <p className="text-[#8f99a8]">It has not looked yet. Ask it, and it reads this module&apos;s records as they stand now.</p>}
          {findings.length > 0 && (
            <div>
              <p className="mb-1 text-[10.5px] uppercase tracking-wide text-[#8f99a8]">What the planning swarm found here</p>
              {findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2 border-t border-white/5 py-1 first:border-t-0">
                  <span className="shrink-0"><Pill tone="warn">{TAG[f.tag] ?? f.tag}</Pill></span>
                  <p className="min-w-0 flex-1 leading-snug text-[#d3d8de]">{f.note} <span className="text-[10.5px] text-[#8f99a8]">{(f.who as string[]).join(", ")}</span></p>
                  <span className="flex shrink-0 flex-wrap gap-1">{(f.evidence as string[]).slice(0, 3).map((e) => <button key={e} onClick={() => go(e.startsWith("RFI") ? `documents/rfis:${e}` : `documents/register:${e}`)} className="rounded bg-white/10 px-1.5 py-px text-[10px] text-[#d3d8de] hover:bg-white/20">{e}</button>)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}

function ModuleAgents() {
  const [views, setViews] = useState<Rec[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const reload = useCallback(() => Promise.all(KEYS.map((k) => api(`/api/project/agents/${k}`))).then((rows) => { setViews(rows); setErr(""); }).catch((e) => setErr((e as Error).message)), []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener("records-changed", again);
    return () => window.removeEventListener("records-changed", again);
  }, [reload]);
  const ask = async (module: string, mode: string) => {
    setBusy(`${module}:${mode}`); setErr("");
    try { await api(`/api/project/agents/${module}/ask`, { mode }); await reload(); notifyChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const askAll = async (mode: string) => {
    setBusy(`all:${mode}`); setErr("");
    try { for (const k of KEYS) await api(`/api/project/agents/${k}/ask`, { mode }); await reload(); notifyChanged(); } catch (e) { setErr((e as Error).message); await reload(); } finally { setBusy(""); }
  };
  const decide = async (module: string, index: number, verdict: string) => {
    setErr("");
    try { await api(`/api/project/agents/${module}/${index}/${verdict}`, {}); await reload(); notifyChanged(); } catch (e) { setErr((e as Error).message); }
  };
  if (!views) return <div className="flex-1 overflow-auto"><Problem err={err} />{!err && <Loading />}</div>;
  const allItems = views.flatMap((v) => ((v.advice?.items ?? []) as Rec[]));
  const openCount = allItems.filter((x) => x.state === "open").length;
  const findingsCount = views.reduce((n, v) => n + ((v.findings ?? []) as Rec[]).length, 0);
  const looked = views.filter((v) => v.advice).length;
  const museReady = views.some((v) => v.muse_ready);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="AI Agent Analysis" note="one agent per module, all of them on one page. Agents propose, people decide">
        <button disabled={!!busy} onClick={() => void reload()} className={quiet}>Refresh</button>
        <button disabled={!!busy} onClick={() => askAll("mock")} title="Every agent looks again, worked out by code from the records. Free." className={primary}>{busy === "all:mock" ? "Analysing…" : "Analyse all: offline"}</button>
        <button disabled={!!busy || !museReady} onClick={() => askAll("muse")} title={museReady ? "Every agent looks again on Muse Spark: one call per module." : "Add META_API_KEY to .env.local"} className={good}>{busy === "all:muse" ? "Asking Muse…" : "Analyse all: Muse"}</button>
      </Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label="agents, one per module" value={views.length} />
        <Kpi label="have looked" value={`${looked} of ${views.length}`} tone={looked ? "ok" : undefined} />
        <Kpi label="recommendations to decide" value={openCount} tone={openCount ? "warn" : "ok"} />
        <Kpi label="findings from the swarm" value={findingsCount} tone={findingsCount ? "warn" : undefined} />
        <Kpi label="already decided" value={allItems.filter((x) => x.state !== "open").length} />
      </Kpis>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#111820] p-3">
        <div className="flex flex-wrap gap-1">
          {views.map((v) => {
            const n = ((v.advice?.items ?? []) as Rec[]).filter((x) => x.state === "open").length;
            return (
              <button key={v.key} onClick={() => document.getElementById(`analysis-${v.key}`)?.scrollIntoView()} className="rounded border border-white/10 bg-[#1c2733] px-2 py-1 text-[11px] text-[#d3d8de] hover:border-white/30 hover:text-white">
                {v.module}{n > 0 && <span className="ml-1 rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{n}</span>}
              </button>
            );
          })}
          <button onClick={() => document.getElementById("analysis-memory")?.scrollIntoView()} className="rounded border border-[#f5b82e]/40 bg-[#1c2733] px-2 py-1 text-[11px] text-[#d9d3ff] hover:border-[#f5b82e] hover:text-white">What they remember</button>
        </div>
        {views.map((v) => <ModuleAnalysis key={v.key} v={v} busy={busy} ask={(m, mode) => void ask(m, mode)} decide={(m, i, verdict) => void decide(m, i, verdict)} />)}
        {!views.length && <Empty>No agents on this project.</Empty>}
        <section id="analysis-memory" className="scroll-mt-3">
          <Card title="What the agents remember"><div className="p-3"><MemoryPanel /></div></Card>
        </section>
      </div>
    </div>
  );
}

export function AnalysisModule() {
  const [tab, setTab] = useState("ask");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 gap-1 border-b border-white/10 bg-[#111820] px-3 pt-2">
        {([["ask", "Ask anything"], ["agents", "Module agents"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-t border border-b-0 px-3 py-1.5 text-[12px] ${tab === k ? "border-white/15 bg-[#1c2733] font-medium text-white" : "border-transparent text-[#8f99a8] hover:text-white"}`}>{label}</button>
        ))}
      </div>
      {tab === "ask" ? <OperatorChat /> : <ModuleAgents />}
    </div>
  );
}
