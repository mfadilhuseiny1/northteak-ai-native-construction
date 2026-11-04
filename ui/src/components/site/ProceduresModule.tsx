"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { Bar, dates, Empty, Label, Loading, num, Pill, Problem, quiet, useData, useGo, type Rec, NotYet } from "./kit";
import { SourceLink } from "./SourceDrawer";

/* The point of it all: every task's procedure, as a foreman would follow it, with who, what and how it is checked, the documents it rests on, and whether it is ready to start. First, what the contract and Indonesian regulations require around all of it. The words quoted stay one click away, in the source beside it, so the screen reads as the procedure. */

function Rule({ r }: { r: Rec }) {
  return <a href={r.url} target="_blank" rel="noreferrer" title={`“${r.quote}”`} className="inline-flex items-center gap-1 rounded bg-white/[.08] px-1.5 py-px text-[11.5px] text-[#9cc7f5] hover:bg-white/15">{r.name}, {r.article}</a>;
}

/** One link a page: several quotes from the same page read as one passage, not as the same link three times. */
function Sources({ rows }: { rows: Rec[] }) {
  const pages = new Map<string, Rec>();
  for (const s of rows) {
    const k = `${s.doc}:${s.page ?? ""}`, seen = pages.get(k);
    pages.set(k, seen ? { ...seen, quote: [seen.quote, s.quote].filter(Boolean).join(" … ") } : s);
  }
  return <span className="flex flex-wrap gap-1">{[...pages.values()].map((s, i) => <SourceLink key={i} doc={s.doc} page={s.page} quote={s.quote} title={s.title} />)}</span>;
}

const PHASES: [string, string][] = [["before", "Before any work starts"], ["during", "While the work runs"], ["handover", "At handover"]];

function Obligations({ rows, permits }: { rows: Rec[]; permits: number }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-semibold text-white">What the contract and regulations require</p>
        <p className="mt-0.5 leading-snug text-[#abb3bf]">Code found these by their words. Open a source to check one.</p>
      </div>
      {PHASES.map(([phase, title]) => {
        const list = rows.filter((o) => o.phase === phase);
        return list.length > 0 && (
          <div key={phase} className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#abb3bf]">{title}</p>
            {list.map((o) => (
              <section key={o.key} className={`space-y-1.5 rounded border bg-[#1c2733] px-3 py-2.5 ${o.conflict ? "border-[#fab219]/50" : "border-white/10"}`}>
                <p className="text-[13px] font-medium text-white">{o.what}</p>
                {o.note && <p className="leading-snug text-[#d3d8de]">{o.note}</p>}
                {o.key === "permits" && <p className="leading-snug text-[#d3d8de]">{permits ? `${permits} task${permits === 1 ? "" : "s"} in this plan need${permits === 1 ? "s" : ""} one, and each says so.` : "No task in this plan reads as special work."}</p>}
                {o.conflict && <p className="rounded bg-[#fab219]/10 px-2 py-1 leading-snug text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3 w-3" />{o.conflict}</p>}
                <span className="flex flex-wrap items-center gap-1">
                  {(o.found as Rec[]).length ? <Sources rows={o.found as Rec[]} /> : <span className="text-[11.5px] text-[#8f99a8]">The documents read do not say.</span>}
                  {o.rule && <Rule r={o.rule} />}
                </span>
              </section>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Task({ t, rule }: { t: Rec; rule: Rec }) {
  const go = useGo();
  const [why, setWhy] = useState(false);
  const holds = t.holds as Rec[], sources = t.sources as Rec[], crew = t.crew as Rec[], steps = t.steps as string[], needs = t.needs as string[], equipment = t.equipment as string[], unsourced = t.unsourced as string[], permit = (t.permit ?? []) as Rec[];
  return (
    <section className={`rounded border bg-[#1c2733] ${t.ready ? "border-[#29a383]/40" : "border-white/10"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
        <span className="font-mono text-[10.5px] text-[#8f99a8]">{t.code}</span>
        <span className="text-[10.5px] text-[#8f99a8]">{t.id}</span>
        <p className="min-w-0 flex-1 text-[13px] font-medium text-white">{t.name}</p>
        {t.hold_point && <Pill tone="bad">hold point</Pill>}
        {t.kind === "inspection" && !t.hold_point && <Pill tone="info">inspection</Pill>}
        {t.critical && <Pill tone="warn">no float</Pill>}
        {t.ready ? <Pill tone="ok">ready to work</Pill> : <button onClick={() => setWhy(!why)} aria-expanded={why} className="hover:brightness-125"><Pill tone="none">not ready: {holds.length} {holds.length === 1 ? "thing" : "things"}</Pill></button>}
      </div>
      {why && !t.ready && (
        <div className="space-y-0.5 border-b border-white/5 px-3 py-1.5">
          {holds.map((h, i) => <button key={i} onClick={() => go(h.go)} className={`flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left text-[11.5px] hover:brightness-125 ${h.stop ? "bg-[#e5484d]/15 text-[#ffb4b4]" : "bg-[#fab219]/10 text-[#fbd38d]"}`}><Icon name={h.stop ? "lock" : "alert"} className="mt-0.5 h-3 w-3 shrink-0" /><span className="leading-snug">{h.text}</span></button>)}
        </div>
      )}
      <div className="grid gap-x-5 gap-y-2 p-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-2">
          <div>
            <Label>Procedure</Label>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 leading-snug text-[#e5e8eb]">{steps.map((s, i) => <li key={i}>{s.replace(/^\d+\.\s*/, "")}</li>)}</ol>
          </div>
          {permit.length > 0 && <p className="rounded bg-[#fab219]/10 px-2 py-1 leading-snug text-[#fbd38d]"><Icon name="lock" className="mr-1 inline h-3 w-3" />Work permit first: {permit.map((p) => p.what).join(", ")}. The permit carries its method statement, safety analysis (AKK) and inspection plan: <a href={rule.url} target="_blank" rel="noreferrer" className="underline">{rule.name}, {rule.article}</a>.</p>}
          {t.criteria && <div><Label>Passes if</Label><p className="mt-0.5 leading-snug text-[#e5e8eb]">{t.criteria}</p></div>}
          {t.safety && <div><Label>Safety</Label><p className="mt-0.5 leading-snug text-[#e5e8eb]">{t.safety}</p></div>}
          {unsourced.length > 0 && <p className="rounded bg-[#fab219]/10 px-2 py-1 leading-snug text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3 w-3" />Check {unsourced.length === 1 ? "this figure" : "these figures"}: {unsourced.join(", ")}. The pages the agent read do not state {unsourced.length === 1 ? "it" : "them"}.</p>}
          {sources.length ? <Sources rows={sources} /> :<p className="rounded bg-[#fab219]/10 px-2 py-1 leading-snug text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3 w-3" />Nothing in the documents backs this task: it rests on the agent&apos;s knowledge. Check it before use.</p>}
        </div>
        <div className="space-y-2 text-[11.5px] text-[#d3d8de]">
          <div><Label>When</Label><p className="mt-0.5 tabular-nums">{dates(t.start, t.finish)}</p></div>
          {crew.length > 0 && <div><Label>Crew, estimated</Label><p className="mt-0.5">{crew.map((c) => `${c.count} ${c.role}`).join(", ")}</p>{t.man_hours > 0 && <p className="text-[10.5px] text-[#8f99a8]">{num(t.man_hours, 0)} man-hours</p>}</div>}
          {needs.length > 0 && <div><Label>Material</Label>{needs.map((x, i) => <p key={i} className="mt-0.5 leading-snug">{x}</p>)}</div>}
          {equipment.length > 0 && <div><Label>Equipment</Label><p className="mt-0.5 leading-snug">{equipment.join(", ")}</p></div>}
          {(t.after as string[]).length > 0 && <div><Label>Waits for</Label><p className="mt-0.5">{(t.after as string[]).join(", ")}</p></div>}
        </div>
      </div>
    </section>
  );
}

export function ProceduresModule() {
  const { data, err } = useData("/api/project/procedures");
  const [sel, setSel] = useState<string | null>(null);
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const groups = data.groups as Rec[], c = data.counts as Rec, plan = data.plan as Rec | null;
  if (!plan) return <div className="flex-1 bg-[#111820] text-[12px]"><Problem err={err} /><NotYet>No procedures yet.</NotYet></div>;
  const duties = (data.obligations ?? []) as Rec[];
  const first = sel === "before" || (sel === null && duties.length > 0);
  const g = first ? null : groups.find((x) => x.code === sel) ?? groups[0];
  const count = (x: Rec) => (x.sections as Rec[]).reduce((n, s) => n + (s.tasks as Rec[]).length, 0);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Procedures" note={<span className="inline-flex items-center gap-1.5">{plan.status === "pending" ? <Pill tone="warn">waiting for your approval</Pill> : <>{c.ready} of {c.tasks} tasks ready to work</>}{plan.mode === "mock" && <Pill tone="violet">offline mock: scripted answers</Pill>}</span>}>
        <a href={`${API_URL}/api/project/plans/${plan.id}/procedure.md`} download={`${plan.id}-procedure.md`} className={quiet}>Download all</a>
      </Bar>
      <Problem err={err} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-[290px] shrink-0 overflow-y-auto border-r border-black/30 bg-[#1c2733] py-1 max-md:w-[150px]">
          {duties.length > 0 && (
            <button onClick={() => setSel("before")} aria-current={first ? "true" : undefined} className={`flex w-full items-baseline gap-1.5 px-3 py-1 text-left hover:bg-white/5 ${first ? "bg-white/10 text-white" : "text-[#d3d8de]"}`}>
              <Icon name="doc" className="h-3 w-3 shrink-0 self-center text-[#8f99a8]" /><span className="min-w-0 flex-1">Contract and regulations</span><span className="text-[10.5px] tabular-nums text-[#8f99a8]">{duties.length}</span>
            </button>
          )}
          {groups.map((x) => (
            <button key={x.code} onClick={() => setSel(x.code)} aria-current={g?.code === x.code ? "true" : undefined} className={`flex w-full items-baseline gap-1.5 px-3 py-1 text-left hover:bg-white/5 ${g?.code === x.code ? "bg-white/10 text-white" : "text-[#d3d8de]"}`}>
              <span className="font-mono text-[10.5px] text-[#8f99a8]">{x.code}</span><span className="min-w-0 flex-1">{x.name}</span><span className="text-[10.5px] tabular-nums text-[#8f99a8]">{count(x) || "–"}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto bg-[#111820] p-3"><div className="max-w-[1200px] space-y-4">
          {first && <Obligations rows={duties} permits={data.permit_tasks ?? 0} />}
          {g && <p className="text-[15px] font-semibold text-white"><span className="mr-2 font-mono text-[11px] font-normal text-[#8f99a8]">{g.code}</span>{g.name}</p>}
          {(g?.sections as Rec[] ?? []).map((s) => (
            <div key={s.code} className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#abb3bf]">{s.name}</p>
              {(s.tasks as Rec[]).map((t) => <Task key={t.id} t={t} rule={data.permit_rule} />)}
            </div>
          ))}
          {g && !count(g) && <Empty>No procedures for this work package: its planner&apos;s answer could not be read. Plan it again to retry.</Empty>}
        </div></div>
      </div>
    </div>
  );
}
