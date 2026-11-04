"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { inFocus, notifyChanged, useFocus, useGo } from "@/components/site/kit";
import { API_URL } from "@/lib/api";

/* The RFI register: every request for information, who owes the answer, by when, and what it holds up on the schedule. People raise, issue and
   answer RFIs here; agents read the log and can only draft, so a draft waits here for a person to issue it. */

type Rfi = { id: string; subject: string; question: string; raised_by: string; raised_on: string; to: string; ball_in_court: string; due: string; status: "draft" | "open" | "answered"; answer: string; answered_on: string;
  activity: string; activity_start: string; critical: boolean; overdue: boolean; impact: string; drafted_by?: string };
type Register = { today: string; rfis: Rfi[]; counts: Record<string, number> };

const STATUS: Record<string, string> = { draft: "bg-[#e879a8]/20 text-[#e9d5ff]", open: "bg-[#fab219]/15 text-[#fbd38d]", answered: "bg-[#29a383]/20 text-[#7ee2c0]" };
const EDGE: Record<string, string> = { draft: "#e879a8", open: "#fab219", answered: "#29a383" };
const FILTERS = [["all", "All"], ["open", "Open"], ["draft", "Drafts"], ["answered", "Answered"]] as const;
const EMPTY = { subject: "", question: "", to: "Engineer", activity: "", due: "", impact: "" };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `${r.status} ${r.statusText}`);
  return r.json();
}

const field = "w-full rounded border border-white/15 bg-black/20 px-2 py-1 text-[12px] text-white placeholder:text-[#6b7480]";

export function RfiView({ target }: { target?: string }) {
  const { focus } = useFocus();
  const go = useGo();
  const [reg, setReg] = useState<Register | null>(null);
  const [sel, setSel] = useState<string | null>(target || null);
  const [filter, setFilter] = useState("all");
  const [err, setErr] = useState("");
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [answer, setAnswer] = useState("");
  const load = useCallback(() => call<Register>("/api/rfis").then((r) => { setReg(r); setErr(""); }).catch((e) => setErr((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (target) setSel(target); }, [target]);
  useEffect(() => {
    const again = () => void load();
    window.addEventListener("records-changed", again);
    return () => window.removeEventListener("records-changed", again);
  }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); setErr(""); await load(); notifyChanged(); } catch (e) { setErr((e as Error).message); }
  };
  const rows = (reg?.rfis ?? []).filter((r) => (filter === "all" || r.status === filter) && (!focus || focus.type === "project" || inFocus(focus, { activity: r.activity })));
  const open = reg?.rfis.find((r) => r.id === sel) ?? null;
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#1c2733] px-4 py-2">
          <p className="text-[13px] font-semibold text-white">RFI register</p>
          <span className="text-[11px] text-[#abb3bf]">{reg ? `${reg.counts.open ?? 0} open · ${reg.counts.draft ?? 0} drafts · ${reg.counts.answered ?? 0} answered · today ${reg.today}` : "Loading…"}</span>
          <div className="ml-auto flex items-center gap-1">
            {FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded px-2 py-0.5 text-[11px] ${filter === k ? "bg-white/15 text-white" : "text-[#abb3bf] hover:bg-white/10"}`}>{label}</button>
            ))}
            <button onClick={() => setForm({ ...EMPTY })} className="ml-1 flex items-center gap-1 rounded bg-[#d99a16] px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-[#6a6ee0]"><Icon name="plus" className="h-3 w-3" />New RFI</button>
          </div>
        </div>
        {err && <p className="bg-[#e5484d]/10 px-4 py-1 text-[11px] text-[#ffb4b4]">{err}</p>}
        <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
          {rows.length > 0 && (
            <div className="border-b border-white/[.05] px-3 py-2">
              <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">{(["draft", "open", "answered"] as const).map((k) => { const n = rows.filter((r) => r.status === k).length; return n ? <span key={k} className="h-full" title={`${n} ${k}`} style={{ width: `${(n / rows.length) * 100}%`, background: EDGE[k] }} /> : null; })}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 text-[10.5px] text-[#8f99a8]">{(["draft", "open", "answered"] as const).map((k) => <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: EDGE[k] }} />{k}<b className="text-white">{rows.filter((r) => r.status === k).length}</b></span>)}{rows.some((r) => r.overdue) && <span className="text-[#ffb4b4]">{rows.filter((r) => r.overdue).length} overdue</span>}</div>
            </div>
          )}
          <div className="divide-y divide-white/[.05]">
            {rows.map((r) => (
              <div key={r.id} onClick={() => { setSel(r.id); setAnswer(""); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") { setSel(r.id); setAnswer(""); } }} className={`flex cursor-pointer gap-3 px-3 py-2.5 outline-none hover:bg-white/[.04] focus-visible:bg-white/[.06] ${sel === r.id ? "bg-white/[.07]" : ""}`} style={{ boxShadow: `inset 3px 0 0 ${EDGE[r.status] ?? "#8f99a8"}` }}>
                <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[10.5px] text-[#8f99a8]">{r.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block leading-snug text-[#e5e8eb]">{r.subject}{r.drafted_by && <span className="ml-1.5 rounded bg-[#e879a8]/20 px-1 text-[9.5px] text-[#e9d5ff]">agent draft</span>}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-[#8f99a8]">
                    {r.ball_in_court && <span>with <b className="font-medium text-[#d3d8de]">{r.ball_in_court}</b></span>}
                    {r.activity && <button onClick={(e) => { e.stopPropagation(); go(`schedule/gantt:${r.activity}`); }} className="hover:underline">holds <b className="font-medium text-[#d3d8de]">{r.activity}</b>{r.critical && <span className="ml-1 text-[#fbd38d]">critical</span>}</button>}
                    {r.due && <span className={r.overdue ? "font-semibold text-[#ffb4b4]" : ""}>due {r.due}{r.overdue ? ", overdue" : ""}</span>}
                    <span>raised by {r.raised_by}</span>
                  </span>
                </span>
                <span className="shrink-0 pt-0.5"><span className={`rounded-full px-2 py-0.5 text-[10.5px] ${STATUS[r.status]}`}>{r.status}</span></span>
              </div>
            ))}
          </div>
          {reg && !rows.length && <p className="py-10 text-center text-[#8f99a8]">No RFIs here.</p>}
        </div>
      </div>
      {open && !form && (
        <aside className="w-[360px] shrink-0 space-y-3 overflow-y-auto border-l border-black/30 bg-[#1c2733] p-4 max-lg:w-[280px]">
          <div className="flex items-start gap-2">
            <div className="min-w-0"><p className="text-[11px] text-[#8f99a8]">{open.id}</p><p className="text-[14px] font-semibold text-white">{open.subject}</p></div>
            <button onClick={() => setSel(null)} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button>
          </div>
          <div><p className="text-[10.5px] uppercase tracking-wide text-[#8f99a8]">Question</p><p className="text-[#e5e8eb]">{open.question}</p></div>
          {open.impact && <div><p className="text-[10.5px] uppercase tracking-wide text-[#8f99a8]">What it holds up</p><p className="text-[#e5e8eb]">{open.impact}{open.activity_start ? ` ${open.activity} starts on ${open.activity_start}.` : ""}</p></div>}
          <p className="text-[11px] text-[#abb3bf]">From {open.raised_by} on {open.raised_on}, to {open.to}{open.drafted_by ? `. Drafted by agent ${open.drafted_by}.` : "."}</p>
          {open.status === "draft" && (
            <button onClick={() => act(() => call(`/api/rfis/${open.id}/issue`, {}))} className="w-full rounded bg-[#d99a16] py-1.5 font-medium text-white hover:bg-[#6a6ee0]">Issue this RFI</button>
          )}
          {open.status === "answered" && <div className="rounded border border-[#29a383]/30 bg-[#29a383]/10 p-2"><p className="text-[10.5px] uppercase tracking-wide text-[#7ee2c0]">Answer, {open.answered_on}</p><p className="text-[#e5e8eb]">{open.answer}</p></div>}
          {open.status === "open" && (
            <div className="space-y-1.5">
              <p className="text-[10.5px] uppercase tracking-wide text-[#8f99a8]">Record the answer</p>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder="The answer received" className={field} />
              <button disabled={!answer.trim()} onClick={() => act(() => call(`/api/rfis/${open.id}/answer`, { answer }))} className="w-full rounded bg-[#29a383] py-1.5 font-medium text-white hover:brightness-110 disabled:opacity-40">Save answer</button>
            </div>
          )}
        </aside>
      )}
      {form && (
        <aside className="w-[360px] shrink-0 space-y-2 overflow-y-auto border-l border-black/30 bg-[#1c2733] p-4 max-lg:w-[280px]">
          <div className="flex items-center"><p className="text-[14px] font-semibold text-white">New RFI</p><button onClick={() => setForm(null)} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button></div>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject" className={field} />
          <textarea value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} rows={4} placeholder="Question" className={field} />
          <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="To" className={field} />
          <input value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} placeholder="Activity it holds up, such as A50" className={field} />
          <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} aria-label="Answer due" className={field} />
          <input value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })} placeholder="What it holds up" className={field} />
          <button disabled={!form.subject.trim() || !form.question.trim()} onClick={() => act(async () => { await call("/api/rfis", form); setForm(null); })} className="w-full rounded bg-[#d99a16] py-1.5 font-medium text-white hover:bg-[#6a6ee0] disabled:opacity-40">Issue RFI</button>
        </aside>
      )}
    </div>
  );
}
