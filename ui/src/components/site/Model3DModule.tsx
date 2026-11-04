"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Bar, Label, Loading, Problem, quiet, useData, useGo, type Rec, NotYet } from "./kit";
import { buildScene, inOrder, LOOK, PIN, progressOf, type Model, type Scene } from "./Model3DScene";

/* The 3D timeline: the building as the master schedule builds it, day by day, so a contractor can see what comes first and how.
   A schematic model, not BIM: its floors come from the WBS, its size from the drawings' grid, and each kind of work is drawn
   the same way on every project (Model3DScene). The numbered pins in the view are the numbers of the work listed on the right,
   each with a sentence of what is being done that day. Click a line to go to that work; click a part to see its work package. */

const KIND: Record<string, string> = {
  site: "Site set-up", earthworks: "Earthworks", foundation: "Foundations", structure: "Structure", lift: "Lift core", walls: "Walls", openings: "Doors and windows", facade: "Facade", roof: "Roof", interior: "Interior and finishes",
  electrical: "Electrical", mechanical: "Mechanical and plumbing", external: "External works", tank: "Water tank", stp: "Sewage treatment", canopy: "Canopy", catwalk: "Catwalk", entrance: "Entrance steps and ramp", joint: "Expansion joint", services: "Mechanical and electrical", architecture: "Architecture", other: "Not drawn",
};
const READING: [string, string][] = [["Formwork", LOOK.formwork], ["Rebar", LOOK.rebar], ["Fresh concrete", LOOK.fresh], ["Cured concrete", LOOK.concrete], ["Brickwork", LOOK.brick], ["Plaster", LOOK.plaster]];

const dateOf = (start: string, day: number) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

export function Model3DModule() {
  const { data, err } = useData("/api/project/model-3d");
  const go = useGo();
  const holder = useRef<HTMLDivElement>(null);
  const view = useRef<Scene | null>(null);
  const goTo = useRef<string[] | null>(null);  // the work to bring into view, once the day it starts has been drawn
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [firstPerson, setFirstPerson] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [told, setTold] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState("");
  const model = data as Model | null;
  const ready = !!model && model.elements.length > 0;

  useEffect(() => {
    if (!ready || !holder.current) return;
    try {
      view.current = buildScene(model as Model, holder.current, setPicked, setFirstPerson);
    } catch (e) {
      setFailed(`This browser could not draw the 3D view: ${(e as Error).message}`);
      return;
    }
    return () => { view.current?.dispose(); view.current = null; setFirstPerson(false); };
  }, [model, ready]);
  useEffect(() => {
    if (!view.current) return;
    setTold(view.current.update(day, ghost));
    if (goTo.current) { view.current.focus(goTo.current); goTo.current = null; }
  }, [day, ghost, model]);
  useEffect(() => {
    if (!playing || !model) return;
    const step = Math.max(1, Math.round(model.days / 400));
    const t = setInterval(() => setDay((d) => Math.min(model.days - 1, d + step)), 55);
    return () => clearInterval(t);
  }, [playing, model]);
  useEffect(() => { if (playing && model && day >= model.days - 1) setPlaying(false); }, [playing, day, model]);

  const stages = useMemo(() => inOrder(model?.elements ?? []), [model]);
  const starts = useMemo(() => [...new Set(stages.filter((e) => e.kind !== "other").map((e) => e.start))].sort((a, b) => a - b), [stages]);
  if (!model) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  if (!ready) return <div className="flex-1 bg-[#111820] text-[12px]"><Problem err={err} /><NotYet>No work packages yet, so there is nothing to draw.</NotYet></div>;

  const active = stages.filter((e) => day >= e.start && day < e.end);
  const before = [...starts].reverse().find((s) => s < day), after = starts.find((s) => s > day);
  const chosen = picked ? stages.filter((e) => picked.includes(e.id)) : [];
  const jump = (d: number) => { setPlaying(false); setDay(d); };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="3D timeline" note="a schematic model: the floors from the WBS, the size from the drawings, the dates from the master schedule. The methods and machines shown are the usual ones, not from a BIM model">
 
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#d3d8de]"><input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />Show the finished outline</label>
      </Bar>
      <Problem err={err || failed} />
      <div data-tour="model" className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1 bg-[#111820]">
          <div ref={holder} className="absolute inset-x-0 top-0 bottom-[46px] cursor-grab active:cursor-grabbing" aria-label="3D model of the building on the chosen day" role="img" />
          <div className="absolute bottom-[56px] left-3 flex gap-1.5">
            <button onClick={() => { if (firstPerson) { setFirstPerson(false); view.current?.setFirstPerson(false); } view.current?.overview(); }} title="Whole site" aria-label="Whole site" className="grid h-8 w-8 place-items-center rounded-md border border-white/15 bg-[#111820]/85 text-[#d3d8de] hover:border-white/30 hover:bg-[#111820] hover:text-white"><Icon name="fit" className="h-4 w-4" /></button>
            <button onClick={(e) => { const on = !firstPerson; setFirstPerson(on); view.current?.setFirstPerson(on); e.currentTarget.blur(); }} title={firstPerson ? "Back to 3D view" : "First person"} aria-label={firstPerson ? "Back to 3D view" : "First person"} className={`grid h-8 w-8 place-items-center rounded-md border hover:border-white/30 ${firstPerson ? "border-[#f5b82e] bg-[#f5b82e] text-[#171106]" : "border-white/15 bg-[#111820]/85 text-[#d3d8de] hover:bg-[#111820] hover:text-white"}`}><Icon name={firstPerson ? "cube" : "person"} className="h-4 w-4" /></button>
          </div>
          <div className="pointer-events-none absolute left-3 top-3 flex max-w-[70%] flex-wrap gap-x-3 gap-y-1 rounded bg-[#111820]/85 px-2 py-1 text-[10.5px] text-[#d3d8de]">
            {READING.map(([name, color]) => <span key={name} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />{name}</span>)}
            <span className="flex items-center gap-1"><span className="inline-grid h-3 w-3 place-items-center rounded-full text-[8.5px] font-bold text-[#111]" style={{ background: PIN }}>1</span>Work on this day</span>
          </div>
          {firstPerson && <div className="pointer-events-none absolute bottom-[56px] left-[92px] rounded bg-[#111820]/85 px-2 py-2 text-[10.5px] text-[#d3d8de]">First person — <b className="text-white">W A S D</b> move · <b className="text-white">Space</b> jump · <b className="text-white">E</b> up · <b className="text-white">Q</b> down · drag to look · click a part to open it</div>}
          <div className="absolute inset-x-0 bottom-0 flex h-[46px] items-center gap-2 border-t border-white/10 bg-[#1c2733] px-3">
            <button onClick={() => { if (day >= model.days - 1) setDay(0); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Play"} className={`${quiet} !px-2 !py-1`}><Icon name={playing ? "pause" : "play"} className="h-3.5 w-3.5" /></button>
            <button onClick={() => before !== undefined && jump(before)} disabled={before === undefined} aria-label="The stage before" title="The stage before" className={`${quiet} !px-2 !py-1`}><Icon name="left" className="h-3.5 w-3.5" /></button>
            <button onClick={() => after !== undefined && jump(after)} disabled={after === undefined} aria-label="The next stage" title="The next stage" className={`${quiet} !px-2 !py-1`}><Icon name="right" className="h-3.5 w-3.5" /></button>
            <input type="range" min={0} max={model.days - 1} value={day} onChange={(e) => jump(Number(e.target.value))} aria-label="Day of the project" className="min-w-0 flex-1 accent-[#f59e0b]" />
            <span className="w-[230px] shrink-0 text-right tabular-nums text-[#d3d8de]"><b className="font-semibold text-white">Day {day + 1}</b> of {model.days} · {dateOf(model.start, day)}</span>
          </div>
        </div>
        <aside className="w-[340px] shrink-0 space-y-4 overflow-y-auto border-l border-black/30 bg-[#1c2733] p-3">
          {(model.absent?.length ?? 0) > 0 && (
            <div className="space-y-1 rounded border border-[#fab219]/40 bg-[#fab219]/[.07] p-2.5 text-[12px] leading-snug text-[#fbd38d]">
              <p className="font-medium">The plan has no work for {(model.absent as string[]).join(", ").replace(/, ([^,]*)$/, " or $1")}.</p>
              <p className="text-[#d3d8de]">{(model.absent as string[]).some((a) => a !== "a façade") ? "So the building ends as the plan leaves it, not ready to use." : "So the building is drawn without one."} That work is not in the documents as read, or not in this contract. See Review for what is missing.</p>
              <button onClick={() => go("review")} className="text-[#9cc7f5] hover:underline">Open Review</button>
            </div>
          )}
          {chosen.length > 0 && (
            <div className="space-y-1.5 rounded border border-[#f59e0b]/40 bg-[#f59e0b]/[.06] p-2.5">
              <div className="flex items-center gap-2"><Label>You clicked</Label><button onClick={() => setPicked(null)} aria-label="Close" className="ml-auto text-[#8f99a8] hover:text-white"><Icon name="x" className="h-3 w-3" /></button></div>
              {chosen.map((e) => (
                <div key={e.id}>
                  <p className="leading-snug text-white"><span className="mr-1.5 font-mono text-[10.5px] text-[#8f99a8]">{e.code}</span>{e.name}</p>
                  <p className="text-[11px] text-[#abb3bf]">{KIND[e.kind]} · day {e.start + 1} to {e.end} · {e.start_date} to {e.finish_date} · {Math.round(progressOf(e, day) * 100)}% on this day{e.critical ? " · no float" : ""}</p>
                  <p className="mt-0.5 flex gap-3 text-[11px]"><button onClick={() => go(`wbs/tree:${e.code}`)} className="text-[#9cc7f5] hover:underline">In the WBS</button><button onClick={() => go("procedures")} className="text-[#9cc7f5] hover:underline">Its procedures</button></p>
                </div>
              ))}
            </div>
          )}
          <div>
            <Label>Being worked on, day {day + 1}</Label>
            {active.length ? active.map((e, i) => (
              <button key={e.id} onClick={() => { setPicked([e.id]); view.current?.focus([e.id]); }} title="Show it in the view" className="mt-1 flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-white/5">
                <span className="mt-px inline-grid h-[17px] min-w-[17px] shrink-0 place-items-center rounded-full px-0.5 text-[10px] font-bold tabular-nums text-[#111]" style={{ background: PIN }}>{i + 1}</span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="text-white">{e.name}</span>
                  {told[e.id] && <span className="block text-[11px] text-[#fbd38d]">{told[e.id]}</span>}
                  <span className="block text-[10.5px] text-[#8f99a8]">{e.code} · day {e.start + 1} to {e.end}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[11px] text-[#fbd38d]">{Math.round(progressOf(e, day) * 100)}%</span>
              </button>
            )) : <p className="mt-1 text-[#8f99a8]">Nothing is scheduled on this day.</p>}
          </div>
          <div>
            <Label>Step by step</Label>
            <div className="mt-1 space-y-px">
              {stages.map((e) => {
                const state = day >= e.end ? "done" : day >= e.start ? "now" : "later";
                return (
                  <button key={e.id} onClick={() => { if (day === e.start) view.current?.focus([e.id]); else goTo.current = [e.id]; jump(e.start); }} title="Go to the day it starts" className={`flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-white/5 ${state === "now" ? "bg-[#f59e0b]/10" : ""}`}>
                    <span className="w-[74px] shrink-0 pt-px tabular-nums text-[10.5px] text-[#8f99a8]">Day {e.start + 1}–{e.end}</span>
                    <span className={`min-w-0 flex-1 leading-snug ${state === "done" ? "text-[#8f99a8]" : state === "now" ? "text-white" : "text-[#d3d8de]"}`}>{e.name}{e.kind === "other" ? <span className="text-[10.5px] text-[#8f99a8]"> (not drawn)</span> : null}</span>
                    {state === "done" && <Icon name="check" className="mt-0.5 h-3 w-3 shrink-0 text-[#7ee2c0]" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1 text-[11px] leading-snug text-[#abb3bf]">
            <Label>Where the size comes from</Label>
            {(model.read as Rec[]).map((r, i) => <p key={i}><button onClick={() => go(`documents/register:${r.doc}`)} className="text-[#9cc7f5] hover:underline">{r.title}, page {r.page}</button>: {r.what} ({r.words}).</p>)}
            {model.assumed.map((a, i) => <p key={`a${i}`} className="text-[#8f99a8]">{a}</p>)}
          </div>
        </aside>
      </div>
    </div>
  );
}
