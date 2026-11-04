"use client";
import { useState } from "react";
import { Markdown } from "@/components/aip/Briefing";
import { SizeBar } from "./Visual";
import { api, Bar, Card, field, full, good, Kpi, Kpis, Label, Loading, Pill, Problem, quiet, short, useData, useGo, type Rec, type Tone } from "./kit";

/* Where agents' proposals become real, or don't. Approving a plan moves the schedule, adds its cost to the forecast and opens its work items on the board; a message waits here for its own approval. Every step lands in the audit trail. */

const VERDICT: Record<string, Tone> = { recommended: "ok", risky: "warn", rejected: "bad" };
const STATUS: Record<string, Tone> = { pending: "warn", approved: "ok", rejected: "bad", superseded: "none", proposed: "violet", open: "info", done: "ok", draft: "violet" };

function Decision({ d, act }: { d: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [option, setOption] = useState<string>(d.recommended ?? "");
  const [note, setNote] = useState("");
  const [showReport, setShowReport] = useState(false);
  const pending = d.status === "pending";
  const chosen = (d.options as Rec[]).find((o) => o.id === option);
  return (
    <Card title={<span className="flex items-center gap-2">{d.title}<Pill tone={STATUS[d.status]}>{d.status}</Pill>{d.mode === "mock" && <Pill tone="violet">offline mock: scripted answers</Pill>}</span>}
      right={<span className="text-[10.5px] font-normal text-[#8f99a8]">{d.id} · {d.created}</span>}>
      <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
        {(d.options as Rec[]).map((o) => {
          const picked = o.id === (pending ? option : d.option), max = Math.max(...(d.options as Rec[]).map((x) => x.evaluation.total_cost_rp || 0), 1);
          return (
            <button key={o.id} type="button" onClick={() => pending && setOption(o.id)} disabled={!pending} className={`rounded-lg border p-3 text-left transition ${picked ? "border-[#f5b82e]/70 bg-[#d99a16]/10" : "border-white/10 bg-white/[.02] hover:border-white/25"} disabled:cursor-default`}>
              <span className="flex items-center gap-2">{pending && <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${option === o.id ? "border-[#f5b82e] bg-[#f5b82e]" : "border-white/30"}`} />}<span className="font-mono text-[11px] text-[#8f99a8]">{o.id}</span><span className="flex-1 font-semibold text-white">{o.name}</span><Pill tone={VERDICT[o.verdict]}>{o.verdict}</Pill></span>
              {o.id === d.recommended && <span className="mt-1 block text-[10.5px] font-semibold text-[#7ee2c0]">the agents recommend this</span>}
              <span className="mt-2 grid grid-cols-2 gap-2 text-[10.5px]">
                <span><span className="block text-[#8f99a8]">pour</span><b className="text-[12px] text-white">{short(o.evaluation.pour_on)}</b></span>
                <span><span className="block text-[#8f99a8]">milestone</span><b className={`text-[12px] ${o.evaluation.days_late ? "text-[#ffb4b4]" : "text-[#7ee2c0]"}`}>{o.evaluation.days_late ? `${o.evaluation.days_late} days late` : "on time"}</b></span>
              </span>
              <span className="mt-2 block"><span className="flex justify-between text-[10.5px] text-[#8f99a8]"><span>cost</span><b className="text-white">{full(o.evaluation.total_cost_rp)}</b></span><span className="mt-0.5 block"><SizeBar value={o.evaluation.total_cost_rp || 0} max={max} color="#c08414" /></span></span>
              <span className="mt-2 block text-[11px] leading-snug text-[#d3d8de]">{o.reason}</span>
              <span className="mt-1 block text-[10px] text-[#8f99a8]">{(o.evidence as string[]).join(", ")}{o.attack ? ` · red team: ${o.attack.result}` : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-2 border-t border-white/5 p-3">
        {pending && chosen && (
          <div>
            <Label>If you approve {chosen.id}</Label>
            <ul className="mt-0.5 list-disc pl-4 text-[#d3d8de]">{(chosen.effects as string[]).map((e) => <li key={e}>{e}</li>)}<li>The work items proposed below open.</li></ul>
            {chosen.verdict === "rejected" && <p className="mt-1 text-[#ffb4b4]">The agents ruled this option out: {chosen.reason}</p>}
          </div>
        )}
        {!pending && d.status === "approved" && (
          <div>
            <Label>Approved {d.option} · {d.decided_by} · {d.decided_at}</Label>
            <ul className="mt-0.5 list-disc pl-4 text-[#d3d8de]">{(d.effects as string[]).map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {!pending && d.note && <p className="text-[#abb3bf]">Note: {d.note}</p>}
        {pending && (
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (optional)" className={`${field} max-w-[360px]`} />
            <button disabled={!option} onClick={() => act(() => api(`/api/project/decisions/${d.id}/approve`, { option, note }))} className={good}>Approve {option}</button>
            <button onClick={() => act(() => api(`/api/project/decisions/${d.id}/reject`, { note }))} className={quiet}>Reject the plan</button>
          </div>
        )}
        <button onClick={() => setShowReport(!showReport)} className={quiet}>{showReport ? "Hide" : "Read"} the full recovery plan</button>
        {showReport && <div className="rounded bg-black/20 p-3"><Markdown text={d.report} /></div>}
      </div>
    </Card>
  );
}

export function DecisionsView() {
  const { data, err, act } = useData("/api/project/decisions");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const decisions = data.decisions as Rec[], items = data.work_items as Rec[], messages = data.messages as Rec[], audit = data.audit as Rec[];
  const live = decisions.filter((d) => d.status !== "superseded");
  const openItems = items.filter((w) => w.status === "open");
  const drafts = messages.filter((m) => m.status === "draft");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Decisions" note="agents propose, people decide, and every step is recorded"><button onClick={() => go("kanban/board")} className={quiet}>Their work items are on the board</button></Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label="waiting for your decision" value={decisions.filter((d) => d.status === "pending").length} tone={decisions.some((d) => d.status === "pending") ? "warn" : undefined} />
        <Kpi label="open work items" value={openItems.length} />
        <Kpi label="messages to approve" value={drafts.length} tone={drafts.length ? "warn" : undefined} />
        <Kpi label="audit entries" value={audit.length} />
      </Kpis>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#111820] p-3">
        {!live.length && <p className="rounded border border-white/10 bg-[#1c2733] p-6 text-center text-[#8f99a8]">No decision yet. Run a review in the AI agent swarm, and its recovery plan arrives here.</p>}
        {live.slice(0, 3).map((d) => <Decision key={d.id} d={d} act={act} />)}
        <Card title={`Messages (${messages.length})`} right={<span className="text-[10.5px] font-normal text-[#8f99a8]">demo connector: approving records it, nothing is really sent</span>}>
          {messages.length ? messages.map((m) => (
            <div key={m.id} className="border-t border-white/5 px-3 py-2 first:border-t-0">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={STATUS[m.status] ?? "none"}>{m.status}</Pill><span className="text-white">{m.channel} to {m.to}</span><span className="text-[10.5px] text-[#8f99a8]">drafted by {m.agent}</span>
                {m.status === "draft" && <span className="ml-auto flex gap-1"><button onClick={() => act(() => api(`/api/project/messages/${m.id}/approve`, {}))} className={good}>Approve</button><button onClick={() => act(() => api(`/api/project/messages/${m.id}/reject`, {}))} className={quiet}>Reject</button></span>}</div>
              <p className="mt-1 text-[#d3d8de]">{m.text}</p>
            </div>
          )) : <p className="p-4 text-center text-[#8f99a8]">No drafts.</p>}
        </Card>
        <Card title="Audit trail">
          <div className="max-h-[320px] overflow-auto">
            <ol className="relative ml-4 border-l border-white/10 py-2">
              {audit.map((a) => (
                <li key={a.n} className="relative py-1.5 pl-4 pr-3">
                  <span className={`absolute -left-[5px] top-[11px] h-2.5 w-2.5 rounded-full ring-2 ring-[#1c2733] ${a.who === "Agent swarm" ? "bg-[#9085e9]" : "bg-[#3987e5]"}`} />
                  <span className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]"><span className="text-white">{a.action}</span>{a.id && <span className="font-mono text-[10.5px] text-[#8f99a8]">{a.id}</span>}<span className="ml-auto whitespace-nowrap text-[10.5px] tabular-nums text-[#8f99a8]">{a.t}</span></span>
                  <span className="block text-[10.5px] text-[#8f99a8]">{a.who}{a.detail ? ` · ${(a.detail ?? "").replace(/ \(fictional\)/g, "")}` : ""}</span>
                </li>
              ))}
            </ol>
            {!audit.length && <p className="p-4 text-center text-[#8f99a8]">Nothing recorded yet.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
