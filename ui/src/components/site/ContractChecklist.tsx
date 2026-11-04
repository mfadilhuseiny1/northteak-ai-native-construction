"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { api, Empty, Loading, Problem, useData, type Rec } from "./kit";
import { SourceLink } from "./SourceDrawer";

/* The contract's legal and administration checklist, inside Review: what the contractor must hand over, hold or arrange, from signing to handover, each with the words the documents use for it. Code builds it from the documents, with no model. An item no document mentions says so, and a person decides whether it applies. Marking an item is recorded with who and when. */

const MARK: [string, string][] = [["todo", "To do"], ["done", "Done"], ["na", "Not needed"]];
const ON: Record<string, string> = { todo: "border-white/40 bg-white/10 text-white", done: "border-[#29a383] bg-[#29a383]/25 text-white", na: "border-white/30 bg-white/[.06] text-[#d3d8de]" };

function Row({ x, onMark }: { x: Rec; onMark: (status: string) => void }) {
  const found = (x.found ?? []) as Rec[];
  return (
    <div className={`flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-white/5 px-3 py-2 ${x.status === "na" ? "opacity-60" : ""}`}>
      <div className="min-w-[280px] flex-1 space-y-1">
        <p className="flex items-start gap-1.5 leading-snug text-white">{x.status === "done" && <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7ee2c0]" />}{x.what}</p>
        {found.length ? found.map((f, i) => (
          <p key={i} className="leading-snug text-[12px] text-[#abb3bf]">“{f.quote}” <SourceLink doc={f.doc} page={f.page} quote={f.quote} title={f.title}>{f.title}, p.{f.page}</SourceLink></p>
        )) : <p className="text-[12px] text-[#fbd38d]">Not found in the documents read. Check whether it applies to this contract.</p>}
        {x.note && <p className="text-[12px] leading-snug text-[#d3d8de]">{x.note}</p>}
        {x.conflict && <p className="rounded bg-[#fab219]/10 px-2 py-1 text-[12px] leading-snug text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3 w-3" />{x.conflict}</p>}
        {x.rule && <p className="text-[11.5px] text-[#8f99a8]">Required by <a href={x.rule.url} target="_blank" rel="noreferrer" className="text-[#9cc7f5] hover:underline">{x.rule.name}, {x.rule.article}</a></p>}
        {x.who && x.status !== "todo" && <p className="text-[11px] text-[#8f99a8]">{x.status === "done" ? "Done" : "Marked not needed"} by {x.who}, {x.at}</p>}
      </div>
      <span className="flex shrink-0 gap-1" role="group" aria-label={`Status of ${x.what}`}>
        {MARK.map(([k, label]) => <button key={k} onClick={() => onMark(k)} aria-pressed={x.status === k} className={`rounded border px-2 py-0.5 text-[12px] ${x.status === k ? ON[k] : "border-white/15 text-[#abb3bf] hover:bg-white/5"}`}>{label}</button>)}
      </span>
    </div>
  );
}

export function ContractChecklist() {
  const { data, err, act } = useData("/api/project/contract-checklist");
  const [open, setOpen] = useState(false);
  if (!data) return <section className="rounded-lg border border-white/10 bg-[#1c2733]"><Problem err={err} />{!err && <Loading />}</section>;
  const items = data.items as Rec[], phases = data.phases as Rec[];
  const left = items.length - data.done - data.not_needed;
  return (
    <section className="rounded-lg border border-white/10 bg-[#1c2733]">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-[220px] flex-1 items-center gap-2 text-left font-semibold text-white hover:text-[#d9d3ff]">
          <Icon name={open ? "down" : "right"} className="h-3.5 w-3.5 shrink-0 text-[#8f99a8]" />Contract checklist: legal and administration
          <span className="rounded-full bg-white/10 px-2 text-[12px] font-normal tabular-nums text-[#c5cbd3]">{items.length}</span>
          <span className="text-[12px] font-normal tabular-nums text-[#8f99a8]">{data.done} done{left ? `, ${left} to do` : ""}{data.not_found ? `, ${data.not_found} not in the documents` : ""}</span>
        </button>
      </div>
      {open && <>
        <p className="border-t border-white/5 bg-black/10 px-3 py-1.5 text-[12px] leading-snug text-[#8f99a8]">What the contract asks the contractor to hand over, hold or arrange, from signing to handover, in the documents&apos; own words. Code found these by their words, so read each against its page. Marking one changes nothing else in the plan.</p>
        {phases.map((p) => {
          const mine = items.filter((x) => x.phase === p.key);
          return mine.length > 0 && (
            <div key={p.key}>
              <p className="border-t border-white/10 bg-white/[.03] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[#abb3bf]">{p.label}</p>
              {mine.map((x) => <Row key={x.key} x={x} onMark={(status) => void act(() => api(`/api/project/contract-checklist/${x.key}`, { status }))} />)}
            </div>
          );
        })}
        {!items.length && <Empty>No documents to read yet.</Empty>}
      </>}
    </section>
  );
}
