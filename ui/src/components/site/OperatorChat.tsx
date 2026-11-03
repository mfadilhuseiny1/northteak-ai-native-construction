"use client";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { Markdown } from "@/components/aip/Briefing";
import { aip, modelName, usd, type AipEvent, type Run } from "@/components/aip/aipRun";
import { api, quiet, useGo, type Rec } from "./kit";

/* Ask anything: one Muse agent (the operator, swarm/operator.py) reads the project through a tool per app and
   answers in the open. Its steps say what it read and where, folded into one line under the answer; every figure
   is checked by code against what the tools returned. A follow-up continues the conversation: the server reads
   the thread of the run it follows. Replicated from the ai-jkn-audit AIP Operator, with Muse for DeepSeek. */

const APPS: Record<string, { label: string; icon: IconName; tab: string }> = {
  planning: { label: "Home", icon: "home", tab: "home" }, wbs: { label: "Project & WBS", icon: "pipeline", tab: "wbs" },
  schedule: { label: "AI Scheduling", icon: "clock", tab: "schedule" }, cost: { label: "BOQ & Cost", icon: "gauge", tab: "cost" },
  kanban: { label: "Kanban", icon: "grid", tab: "kanban" }, documents: { label: "Documents & RFI", icon: "doc", tab: "documents" },
  procurement: { label: "Procurement & Subs", icon: "project", tab: "procurement" }, quality: { label: "QA/QC", icon: "check", tab: "quality" },
  tower: { label: "Control Tower", icon: "graph", tab: "tower" }, risks: { label: "Risk Register", icon: "alert", tab: "risks" },
  analysis: { label: "AI Analysis", icon: "sparkle", tab: "home" },
};
const TOOLS: Record<string, string> = {
  ringkasan_proyek: "Project overview", catatan_modul: "Module records", jadwal: "Programme and delays", anggaran: "Budget and earned value",
  papan: "Kanban board", risiko: "Risk register", dokumen: "Documents", analisis: "The analysis of the documents", agen: "The module agents", memori: "What the agents remember",
};
const STARTERS = [
  "What is holding this project back today, and what should we do first?",
  "Which risks need a decision first, and who should own them?",
  "How is the money doing: budget against earned value, per work package?",
  "Summarize what the module agents last recommended and what still waits for a decision.",
  "Which RFIs are blocking work, and what happens if they stay unanswered?",
  "What is due or overdue in the next two weeks?",
];

type Turn = { id: string; q: string; status: string; events: AipEvent[]; spent?: number };
const LAST = "siteswarm.operator.last";
const remember = (id: string | null) => { try { if (id) sessionStorage.setItem(LAST, id); else sessionStorage.removeItem(LAST); } catch { /* storage off */ } };
const remembered = (): string | null => { try { return sessionStorage.getItem(LAST); } catch { return null; } };

function TurnView({ turn, busy, go }: { turn: Turn; busy: boolean; go: (to: string) => void }) {
  const [showSteps, setShowSteps] = useState(false);
  const ev = turn.events;
  const steps = ev.filter((e) => e.type === "tool");
  const results = new Map(ev.filter((e) => e.type === "result").map((e) => [String(e.rid), e]));
  const answer = ev.find((e) => e.type === "answer");
  const checks = ev.filter((e) => e.type === "cek_angka");
  const check = checks.at(-1);
  const running = turn.status === "running";
  const seg = Math.max(0, ...ev.filter((e) => e.type === "delta").map((e) => Number(e.seg ?? 1)));
  const draft = !answer && seg ? ev.filter((e) => e.type === "delta" && Number(e.seg ?? 1) === seg).map((e) => String(e.text ?? "")).join("") : "";
  const shown = answer ? String(answer.text ?? "") : draft;
  const apps = [...new Set(steps.map((e) => String(e.app ?? "")).filter((a) => APPS[a]))];
  const model = ev.find((e) => e.type === "run")?.model;
  return (
    <section className="space-y-2.5">
      <div className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm border border-white/10 bg-white/[.07] px-3 py-2 leading-relaxed text-white">{turn.q}</p></div>
      <div className="flex gap-2.5">
        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#d99a16] ${running ? "animate-pulse" : ""}`}><Icon name="sparkle" className="h-3.5 w-3.5 text-white" /></span>
        <div className="min-w-0 flex-1 space-y-2">
          {(steps.length > 0 || running) && (
            <div>
              <button onClick={() => setShowSteps(!showSteps)} aria-expanded={showSteps} className="flex max-w-full items-center gap-1.5 text-[11.5px] text-[#8f99a8] hover:text-white">
                <Icon name="right" className={`h-3 w-3 shrink-0 transition-transform ${showSteps ? "rotate-90" : ""}`} />
                <span className="truncate">{running && !shown ? "Reading the project…" : steps.length ? `Read ${apps.map((a) => APPS[a].label).join(", ") || "the records"} · ${steps.length} step${steps.length === 1 ? "" : "s"}` : "Working"}</span>
              </button>
              {showSteps && (
                <div className="mt-1.5 space-y-1">
                  {steps.map((e, i) => {
                    const app = APPS[String(e.app ?? "")];
                    const r = results.get(String(e.rid));
                    return (
                      <div key={i} className="flex items-center gap-2 rounded border border-white/[.07] bg-black/20 px-2 py-1 text-[11.5px]">
                        <span className="shrink-0 text-[#8f99a8]">{i + 1}</span>
                        {app && <Icon name={app.icon} className="h-3.5 w-3.5 shrink-0 text-[#2dd4ee]" />}
                        <span className="min-w-0 flex-1 truncate text-[#d3d8de]">{TOOLS[String(e.tool)] ?? String(e.tool)}{r?.title ? <span className="text-[#8f99a8]"> · {String(r.title)}</span> : ""}</span>
                        {app && <button onClick={() => go(app.tab)} className="shrink-0 text-[10.5px] text-[#9cc7f5] hover:underline">Open {app.label}</button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {shown ? <div className="max-w-none leading-relaxed text-[#e5e8eb] [&_p]:my-1.5"><Markdown text={shown} /></div>
            : running ? <p className="flex items-center gap-2 text-[12px] text-[#8f99a8]"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#2dd4ee]/30 border-t-[#2dd4ee]" />Working…</p>
            : <p className="text-[12px] text-[#ffb4b4]">The run ended without an answer. Ask again.</p>}
          {check && <p className={`text-[10.5px] ${check.ok ? "text-[#7ee2c0]" : "text-[#fbd38d]"}`}>{check.ok ? "Every figure in this answer was checked by code against the tool results." : `Code made the agent correct figures no tool returned: ${(check.foreign as string[]).join(", ")}`}</p>}
          {!running && (model || turn.spent != null) && <p className="text-[10.5px] text-[#8f99a8]">{model ? modelName(String(model)) : "Muse"}{turn.spent != null ? ` · ${usd(turn.spent)}` : ""}</p>}
          {busy && running && <p className="text-[10.5px] text-[#8f99a8]">Reading…</p>}
        </div>
      </div>
    </section>
  );
}

/** The whole page, or as `compact` the copilot held beside every tab. `tab` tells the agent what the person is looking at. */
export function OperatorChat({ compact = false, tab = "analysis", starters = STARTERS, onClose }: { compact?: boolean; tab?: string; starters?: string[]; onClose?: () => void }) {
  const go = useGo();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const epoch = useRef(0);
  const size = turns.reduce((n, t) => n + t.events.length, 0) + turns.length;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }, [size]);

  const track = async (id: string, mine: number) => {
    let after = 0;
    try {
      for (;;) {
        const r = await aip.run(id, after);
        if (mine !== epoch.current) return;
        after = r.next;
        if (r.events.length) setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, events: [...t.events, ...r.events.filter((e) => !t.events.some((x) => x.seq === e.seq))], status: r.run.status, spent: r.run.spent_usd } : t)));
        if (r.run.status !== "running") break;
        const writing = r.events.some((e) => e.type === "delta");
        await new Promise((res) => setTimeout(res, writing ? 250 : 600));
      }
    } catch (e) { if (mine === epoch.current) setErr(`The connection to the run was lost: ${(e as Error).message}`); }
    finally { if (mine === epoch.current) setBusy(false); }
  };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true); setErr(""); setQ("");
    const mine = epoch.current;
    try {
      const prev = turns.at(-1);
      const { run } = await api<{ run: string }>("/api/aip/operator", { q: question, follow: prev?.id ?? null, tab });
      remember(run);
      setTurns((ts) => [...ts, { id: run, q: question, status: "running", events: [] }]);
      await track(run, mine);
    } catch (e) { setBusy(false); setErr((e as Error).message); }
  };

  useEffect(() => {
    const kept = remembered();
    if (!kept) return;
    const mine = ++epoch.current;
    (async () => {
      const chain: Turn[] = [];
      try {
        for (let x: string | null = kept; x && chain.length < 20 && !chain.some((t) => t.id === x);) {
          const r = await aip.run(x, 0);
          chain.unshift({ id: x, q: r.run.q, status: r.run.status, events: r.events, spent: r.run.spent_usd });
          x = r.run.follow ?? null;
        }
      } catch { remember(null); return; }
      if (mine !== epoch.current) return;
      setTurns(chain);
      const last = chain.at(-1);
      if (last?.status === "running") { setBusy(true); void track(last.id, mine); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = () => { epoch.current++; remember(null); setTurns([]); setBusy(false); setErr(""); };
  const last = turns.at(-1);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#1c2733] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-white"><Icon name="sparkle" className="h-3.5 w-3.5 text-[#2dd4ee]" />{compact ? "AI Copilot" : "Ask anything"}</span>
        {!compact && <span className="text-[11px] text-[#8f99a8]">one Muse agent reads the whole project through its tools</span>}
        <button onClick={clear} disabled={!turns.length && !busy} className={`${quiet} ml-auto`}>{compact ? "New" : "New conversation"}</button>
        {onClose && <button onClick={onClose} aria-label="Close the copilot" className="rounded p-1 text-[#8f99a8] hover:bg-white/10 hover:text-white"><Icon name="x" className="h-3.5 w-3.5" /></button>}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-[#111820]">
        <div className={`mx-auto w-full space-y-6 ${compact ? "px-3 py-3" : "max-w-[820px] px-4 py-5"}`}>
          {!turns.length && (
            <div className={`space-y-3 ${compact ? "" : "pt-6"}`}>
              <p className={`font-semibold text-white ${compact ? "text-[14px]" : "text-center text-[16px]"}`}>What do you want to know?</p>
              <p className={`leading-relaxed text-[#8f99a8] ${compact ? "" : "mx-auto max-w-[520px] text-center"}`}>Ask about the documents, the schedule, the money, the risks, or what the agents found. It reads the live records first, cites them, and code checks every figure it states. Each question uses a little API credit.</p>
              <div className={`flex flex-wrap gap-1.5 pt-1 ${compact ? "" : "justify-center"}`}>
                {starters.map((t) => <button key={t} onClick={() => void ask(t)} className={`border border-white/10 bg-white/[.04] px-3 py-1.5 text-[11.5px] text-[#d3d8de] hover:border-white/30 hover:text-white ${compact ? "rounded-lg text-left" : "rounded-full"}`}>{t}</button>)}
              </div>
            </div>
          )}
          {turns.map((t) => <TurnView key={t.id} turn={t} busy={busy} go={go} />)}
          {err && <p className="rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-[#ffb4b4]">{err}</p>}
        </div>
      </div>
      <div className="shrink-0 border-t border-white/10 bg-[#1c2733] px-3 py-2.5">
        <div className={`mx-auto flex items-end gap-2 ${compact ? "" : "max-w-[820px]"}`}>
          <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} aria-label="Ask anything"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }}
            placeholder={last ? "Ask a follow-up…" : "Ask anything about this project…"}
            className="min-w-0 flex-1 resize-none rounded border border-white/15 bg-black/20 px-2.5 py-2 text-[12.5px] text-white outline-none placeholder:text-[#8f99a8] focus:border-white/40" />
          {busy && last ? (
            <button onClick={() => aip.cancel(last.id).catch(() => {})} className="flex h-9 shrink-0 items-center gap-1.5 rounded bg-white/10 px-3 text-[12px] text-white hover:bg-white/20"><span className="h-2.5 w-2.5 rounded-[2px] bg-white" />Stop</button>
          ) : (
            <button onClick={() => void ask(q)} disabled={busy || !q.trim()} className="flex h-9 shrink-0 items-center gap-1.5 rounded bg-[#d99a16] px-3.5 text-[12px] font-medium text-white hover:bg-[#6a6ee0] disabled:bg-white/10 disabled:text-[#8f99a8]"><Icon name="right" className="h-3.5 w-3.5 -rotate-90" />Ask</button>
          )}
        </div>
        <p className={`mx-auto mt-1 text-[10px] text-[#8f99a8] ${compact ? "" : "max-w-[820px]"}`}>Enter sends · Shift+Enter for a new line · it only reads; people decide and act</p>
      </div>
    </div>
  );
}
