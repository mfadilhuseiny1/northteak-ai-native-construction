"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { api, Empty, Loading, primary, Problem, useData, type Rec } from "./kit";
import { SourceLink } from "./SourceDrawer";

/* What the package asks the contractor to bring, inside Review, so a project manager can see at a glance what to rent. Code reads the list and its quantities from the documents, with no model. An agent draws what each machine looks like, and SAM must find the machine in the drawing. It only shows: nothing here changes the plan. */

function Card({ x }: { x: Rec }) {
  const also = (x.also ?? []) as Rec[], answers = (x.answers ?? []) as Rec[];
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-white/10 bg-black/15">
      {x.drawn
        ? <img src={`${API_URL}/api/project/equipment/picture/${x.picture}`} alt={x.name} loading="lazy" className="aspect-[4/3] w-full bg-white/5 object-cover" />
        : <div className="flex aspect-[4/3] w-full items-center justify-center bg-white/[.03] text-[#5f6b7a]" title="No picture yet"><Icon name="image" className="h-7 w-7" /></div>}
      <div className="flex flex-1 flex-col gap-1 p-2">
        <p className="flex items-baseline justify-between gap-2 leading-snug"><span className="min-w-0 font-semibold text-white">{x.name}</span><span className="shrink-0 text-[14px] font-bold tabular-nums text-[#f5b82e]">{x.quantity}</span></p>
        {x.spec && <p className="text-[12px] leading-snug text-[#d3d8de]">{x.spec}</p>}
        {also.map((a, i) => <p key={i} className="rounded bg-[#fab219]/10 px-1.5 py-1 text-[11.5px] leading-snug text-[#fbd38d]">Another list says {a.quantity}{a.spec ? `, ${a.spec}` : ""}. <SourceLink doc={a.doc} page={a.page} quote={a.quote} title={a.title}>p.{a.page}</SourceLink></p>)}
        {answers.map((a, i) => <p key={i} className="rounded bg-[#29a383]/10 px-1.5 py-1 text-[11.5px] leading-snug text-[#7ee2c0]">Pre-bid: “{a.question}” “{a.answer}” <SourceLink doc={a.doc} page={a.page} quote={`${a.question} ${a.answer}`} title={a.title}>p.{a.page}</SourceLink></p>)}
        <span className="mt-auto pt-0.5"><SourceLink doc={x.doc} page={x.page} quote={x.quote} title={x.title}>Source, p.{x.page}</SourceLink></span>
      </div>
    </div>
  );
}

export function EquipmentList() {
  const { data, err, act } = useData("/api/project/equipment");
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<Rec[]>([]);
  if (!data) return <section className="rounded-lg border border-white/10 bg-[#1c2733]"><Problem err={err} />{!err && <Loading />}</section>;
  const items = data.items as Rec[];
  const main = items.filter((x) => x.group === "main"), support = items.filter((x) => x.group !== "main");
  const draw = async () => {
    setBusy(true);
    await act(async () => setLeft(((await api("/api/project/equipment/draw", {})).failed ?? []) as Rec[]));
    setBusy(false);
  };
  return (
    <section className="rounded-lg border border-white/10 bg-[#1c2733]">
      <Problem err={err} />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-[220px] flex-1 items-center gap-2 text-left font-semibold text-white hover:text-[#d9d3ff]">
          <Icon name={open ? "down" : "right"} className="h-3.5 w-3.5 shrink-0 text-[#8f99a8]" />Equipment to rent
          <span className="rounded-full bg-white/10 px-2 text-[12px] font-normal tabular-nums text-[#c5cbd3]">{items.length}</span>
        </button>
        {open && data.missing > 0 && data.muse_ready && <button disabled={busy} onClick={() => void draw()} title="An agent describes each machine, Muse Image draws it, and SAM 3.1 checks that the machine is in the drawing. About $0.02 a picture, and up to $0.05 if it has to be redrawn." className={`${primary} !px-2.5 !py-1 !text-[12px]`}>{busy ? "Drawing…" : `Draw ${data.missing} picture${data.missing === 1 ? "" : "s"}`}</button>}
      </div>
      {open && <>
        <p className="border-t border-white/5 bg-black/10 px-3 py-1.5 text-[12px] leading-snug text-[#8f99a8]">What the documents ask the contractor to provide, with each one&apos;s page. These are the tender&apos;s minimums, not a count of what the site will need, so check them against what you already own. Pictures are AI-generated examples of the kind of machine, not the unit you will get.</p>
        {left.length > 0 && <p className="border-t border-white/5 px-3 py-1.5 text-[12px] leading-snug text-[#fbd38d]">Not drawn: {left.map((x) => `${x.name} (${x.why})`).join("; ")}.</p>}
        {!items.length && <Empty>No list of equipment found in the documents read.</Empty>}
        {main.length > 0 && <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2 border-t border-white/5 p-3">{main.map((x, i) => <Card key={i} x={x} />)}</div>}
        {support.length > 0 && <>
          <p className="border-t border-white/10 bg-white/[.03] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[#abb3bf]">Supporting equipment</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 p-3">{support.map((x, i) => <Card key={i} x={x} />)}</div>
        </>}
      </>}
    </section>
  );
}
