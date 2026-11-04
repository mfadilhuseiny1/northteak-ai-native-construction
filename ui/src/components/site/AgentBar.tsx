"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { api, good, Pill, quiet, useData, useGo, type Rec, type Tone } from "./kit";

/* The agents working on this module, not a chatbot beside it. They read the module's live records and recommend; a person accepts or dismisses each one. */

const TAG: Record<string, string> = { DOCUMENT_CONFLICT: "Documents disagree", SUPERSEDED_DRAWING: "Superseded drawing", BOQ_MISMATCH: "BoQ mismatch", CREW_SHORT: "Crew short", TIME_SHORT: "Time short", SCOPE_GAP: "Scope gap", RFI_OPEN: "Open RFI", SEQUENCE_RISK: "Sequence risk", MATERIAL_WASTE: "Material waste", HANDLING_WASTE: "Handling waste", SAFETY: "Safety", COST_EXPOSURE: "Cost exposure", OTHER: "Other" };
const STATE: Record<string, Tone> = { accepted: "ok", dismissed: "none" };

export function AgentBar({ module }: { module: string }) {
  const { data, err, act } = useData(`/api/project/agents/${module}`);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const go = useGo();
  if (!data) return null;
  const advice = data.advice as Rec | null, findings = data.findings as Rec[];
  const waiting = ((advice?.items ?? []) as Rec[]).filter((x) => x.state === "open");
  const ask = async (mode: string) => {
    setBusy(mode);
    await act(() => api(`/api/project/agents/${module}/ask`, { mode }));
    setBusy("");
    setOpen(true);
  };
  return (
    <div className="shrink-0 border-b border-[#f5b82e]/20 bg-[#f5b82e]/[.05] text-[11.5px]">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 items-center gap-1.5 text-left text-[#d9d3ff] hover:text-white">
          <Icon name="sparkle" className="h-3.5 w-3.5 shrink-0 text-[#f5b82e]" />
          <b className="font-semibold">{data.name}</b>
          <span className="truncate text-[#abb3bf] max-lg:hidden">{data.does}</span>
          {waiting.length > 0 && <Pill tone="violet">{waiting.length} to decide</Pill>}
          {findings.length > 0 && <Pill tone="warn">{findings.length} from the swarm</Pill>}
          <Icon name={open ? "down" : "right"} className="h-3 w-3 shrink-0" />
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button disabled={!!busy} onClick={() => ask("mock")} title="Worked out by code from the records, with no model. Free." className={quiet}>{busy === "mock" ? "Looking…" : "Ask: offline"}</button>
          <button disabled={!!busy || !data.muse_ready} onClick={() => ask("muse")} title={data.muse_ready ? "One call to Muse Spark on the Meta Model API, with this module's records. About a cent." : "Add META_API_KEY to .env.local"} className={quiet}>{busy === "muse" ? "Asking Muse…" : "Ask: Muse"}</button>
        </span>
      </div>
      {err && <p className="px-3 pb-1 text-[11px] text-[#ffb4b4]">{err}</p>}
      {open && (
        <div className="max-h-[38vh] space-y-2 overflow-y-auto border-t border-white/5 bg-[#111820] p-3">
          <p className="text-[10.5px] text-[#8f99a8]">Works with: {(data.team as string[]).join(", ")}. Agents propose, people decide: nothing changes until you accept it.</p>
          {advice ? (
            <div className="space-y-1">
              <p className="text-[#d3d8de]"><b className="font-medium text-white">{advice.summary}</b> <span className="text-[10.5px] text-[#8f99a8]">{advice.mode === "mock" ? "Offline: code, no model" : `Muse Spark, $${advice.usd}`} · {advice.at}{advice.dropped ? ` · code dropped ${advice.dropped} that cited what the records do not hold` : ""}</span></p>
              {(advice.items as Rec[]).map((x, i) => (
                <div key={i} className={`flex flex-wrap items-start gap-2 rounded border border-white/10 px-2 py-1.5 ${x.state === "open" ? "bg-[#1c2733]" : "opacity-60"}`}>
                  <div className="min-w-[240px] flex-1">
                    <p className="font-medium leading-snug text-white">{x.title}</p>
                    <p className="leading-snug text-[#abb3bf]">{x.why}</p>
                    {((x.lessons ?? []) as Rec[]).map((l, j) => <p key={j} className="mt-0.5 leading-snug text-[#9cc7f5]">Learned: {l.text}</p>)}
                  </div>
                  {x.state !== "open" ? <span className="flex shrink-0 items-center gap-1"><Pill tone={STATE[x.state]}>{x.state}{x.made ? `: ${x.made}` : ""}</Pill>{x.state === "dismissed" && <button onClick={() => act(() => api(`/api/project/agents/${module}/${i}/reopen`, {}))} className={quiet}>Bring back</button>}</span> : (
                    <span className="flex shrink-0 gap-1">
                      {x.action.type === "open" && <button onClick={() => go(x.action.go)} className={quiet}>Open</button>}
                      {x.action.type === "work_item" && <button onClick={() => act(() => api(`/api/project/agents/${module}/${i}/accept`, {}))} className={good}>Put on the board</button>}
                      {x.action.type === "rfi" && <button onClick={() => act(() => api(`/api/project/agents/${module}/${i}/accept`, {}))} className={good}>Draft the RFI</button>}
                      {x.action.type === "none" && <button onClick={() => act(() => api(`/api/project/agents/${module}/${i}/accept`, {}))} className={quiet}>Noted</button>}
                      <button onClick={() => act(() => api(`/api/project/agents/${module}/${i}/dismiss`, {}))} className={quiet}>Dismiss</button>
                    </span>
                  )}
                </div>
              ))}
              {!(advice.items as Rec[]).length && <p className="text-[#8f99a8]">Nothing to act on.</p>}
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
      )}
    </div>
  );
}
