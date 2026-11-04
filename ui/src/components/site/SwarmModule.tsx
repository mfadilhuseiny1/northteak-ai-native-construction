"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, iconPath, type IconName } from "@/components/Icon";
import { api, Bar, Empty, Label, Loading, notifyChanged, Pill, primary, Problem, quiet, useGo, type Rec, type Tone } from "./kit";
import { SizeBar } from "./Visual";

/* The agent swarm at work: each stage and each planner a node, wired in the order the work goes. Every state drawn comes from the run's own events, each with its time, so what is on the screen is what happened and nothing is acted. A run is one list of moments and the screen stands at a point in it, so following a run live, going back to its start and replaying it are the same picture at a different moment. */

type State = "idle" | "queued" | "working" | "done" | "failed" | "stopped";
type Who = { key: string; name: string; role: string; model: string; no?: string; state: State; since: number; took: number; kept: boolean; usd: number };
type Stage = { key: string; label: string; by: string; state: State; note: string; done: number; of: number; since: number; until: number };
type Line = { at: number; text: string; tone: Tone };
type Frame = { stages: Record<string, Stage>; agents: Record<string, Who>; work: Record<string, Rec>; planner: Record<string, string>; log: Line[]; usd: number; now: string };
type Spot = { key: string; x: number; y: number; agent: boolean };
type Chip = { no: string; name: string; short: string; x: number; y: number };
type Lane = { name: string; x: number; y: number; n: number };

const BLUE = "#3987e5", GREEN = "#29a383", RED = "#e5484d", GREY = "#8f99a8", GOLD = "#f5b82e";
const LOOK: Record<State, { fill: string; stroke: string; word: string; tone: Tone }> = {
  idle: { fill: "#161f29", stroke: "#ffffff2e", word: "Not started", tone: "none" },
  queued: { fill: "#1c2733", stroke: GREY, word: "Waiting for a free slot", tone: "none" },
  working: { fill: "#1d3f66", stroke: BLUE, word: "Working", tone: "info" },
  done: { fill: "#14574a", stroke: GREEN, word: "Finished", tone: "ok" },
  failed: { fill: "#5a2326", stroke: RED, word: "Failed", tone: "bad" },
  stopped: { fill: "#4a3a14", stroke: "#fab219", word: "Stopped here", tone: "warn" },
};
const STAGE_STATE: Record<string, State> = { running: "working", done: "done", failed: "failed" };
const AGENT_STATE: Record<string, State> = { antre: "queued", bekerja: "working", selesai: "done", gagal: "failed" };
const ICON: Record<string, IconName> = { sort: "filter", read: "table", rules: "logic", wbs: "pipeline", pages: "search", links: "graph", review: "eye", equipment: "image", questions: "comment", summary: "report", plan: "layers", model3d: "cube" };
const TASK: Record<string, string> = { sort: "Sorts the package", read: "Reads schedule and prices", rules: "Applies the regulations", wbs: "Writes the WBS", pages: "Finds the pages", links: "Links the work", review: "Cross-checks the documents", equipment: "Draws the equipment", questions: "Joins the questions", summary: "Writes the summary", plan: "Puts the plan together", model3d: "Builds the 3D timeline" };
const AGENT: Record<string, string> = { wbs: "engineer", pages: "controller", links: "engineer", review: "reviewer", equipment: "illustrator", questions: "rfi", summary: "director" };
const WORD: Record<string, string> = { sort: "Sort", read: "Read", rules: "Rules", wbs: "WBS", pages: "Pages", procedures: "Planners", links: "Links", review: "Review", equipment: "Equipment", questions: "Questions", summary: "Summary", plan: "Plan", model3d: "3D" };
const SPEEDS = [10, 30, 60];
const LIT = 1.4;  // real seconds a planner stays lit after it finishes, whatever the replay's speed

const clock = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const dollars = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const cut = (t: string, most: number) => (t.length > most ? `${t.slice(0, most - 1)}…` : t);
const opens = (onPick: () => void) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** The run as it stood at a moment: every event up to it, in order. */
function frameAt(events: Rec[], t: number, by: Record<string, string>, ended: boolean): Frame {
  const stages: Record<string, Stage> = {}, agents: Record<string, Who> = {}, work: Record<string, Rec> = {}, planner: Record<string, string> = {};
  const log: Line[] = [];
  let usd = 0, now = "";
  const add = (a: Rec) => { if (!agents[a.key]) agents[a.key] = { key: a.key, name: a.name, role: a.role, model: a.model, no: a.no, state: "idle", since: 0, took: 0, kept: false, usd: 0 }; if (a.no) planner[a.no] = a.key; };
  for (const e of events) {
    if (e.at > t) break;
    if (e.type === "firm") {
      for (const s of e.stages as Rec[]) stages[s.key] = { key: s.key, label: s.label, by: by[s.key] ?? "Code", state: "idle", note: "", done: 0, of: 0, since: 0, until: 0 };
      (e.team as Rec[]).forEach(add);
    } else if (e.type === "instances") {
      (e.agents as Rec[]).forEach(add);
    } else if (e.type === "stage") {
      const s = stages[e.key] ??= { key: e.key, label: e.label, by: e.by ?? by[e.key] ?? "Code", state: "idle", note: "", done: 0, of: 0, since: 0, until: 0 };
      const state = STAGE_STATE[e.status] ?? "working";
      if (s.state === "idle") { s.since = e.at; if (state === "working") log.unshift({ at: e.at, text: `${s.by}: ${TASK[e.key] ?? s.label}`, tone: "none" }); }
      if (state !== "working") { s.until = e.at; if (s.state !== "done") log.unshift({ at: e.at, text: e.note ? `${TASK[e.key] ?? s.label}: ${e.note}` : `${TASK[e.key] ?? s.label}: finished`, tone: state === "failed" ? "bad" : "ok" }); }
      s.state = state;
      s.note = e.note ?? s.note;
      s.done = e.done ?? s.done;
      s.of = e.of ?? s.of;
      if (state === "working") now = `${s.by}: ${s.label}`;
    } else if (e.type === "agent_status") {
      const a = agents[e.agent];
      if (!a) continue;
      a.state = AGENT_STATE[e.status] ?? a.state;
      if (e.status === "bekerja") a.since = e.at;
      if (e.status === "selesai" || e.status === "gagal") {
        a.took = e.at - a.since;
        a.usd += e.usd ?? 0;
        usd += e.usd ?? 0;
        if (e.kept) { a.kept = true; log.unshift({ at: e.at, text: `${a.name}: picked up from the stopped run`, tone: "info" }); }
      }
    } else if (e.type === "wp") {
      work[e.no] = { ...e, finished: e.at };
      log.unshift({ at: e.at, text: e.status === "done" ? `${e.no} ${e.name}: ${e.tasks} tasks written` : `${e.no} ${e.name}: could not be written`, tone: e.status === "done" ? "ok" : "bad" });
    } else if (e.type === "error") {
      log.unshift({ at: e.at, text: String(e.message ?? "An error"), tone: "bad" });
    }
  }
  if (ended && t >= (events[events.length - 1]?.at ?? 0)) {  // a run stopped part way says nothing more about what was under way: it did not go on, and it did not finish
    for (const s of Object.values(stages)) if (s.state === "working") s.state = "stopped";
    for (const a of Object.values(agents)) if (a.state === "working" || a.state === "queued") a.state = "stopped";
    now = "";
  }
  return { stages, agents, work, planner, log: log.slice(0, 60), usd, now };
}

/** What the whole run looks like: how many agents were at work at each moment, and when each stage ran. */
function measure(events: Rec[], ended: number | null) {
  const working = new Set<string>();
  const series: [number, number][] = [[0, 0]];
  const spans: Record<string, Rec> = {};
  let usd = 0, end = 0;
  for (const e of events) {
    end = Math.max(end, e.at);
    if (e.type === "agent_status") {
      if (e.status === "bekerja") working.add(e.agent);
      if (e.status === "selesai" || e.status === "gagal") { working.delete(e.agent); usd += e.usd ?? 0; }
      if (series[series.length - 1][0] === e.at) series[series.length - 1][1] = working.size;
      else series.push([e.at, working.size]);
    } else if (e.type === "stage") {
      const s = spans[e.key] ??= { key: e.key, label: e.label, by: e.by, start: e.at, end: e.at, closed: false };
      s.end = Math.max(s.end, e.at);
      s.by = e.by ?? s.by;
      s.closed = e.status !== "running";
    }
  }
  const peak = Math.max(0, ...series.map(([, n]) => n));
  if (ended != null) { series.push([ended, 0]); end = ended; for (const s of Object.values(spans)) if (s.end >= end - 1 || !s.closed) s.end = s.closed ? s.end : ended; }
  return { series, spans: Object.values(spans), usd, end, peak };
}

/** Where everything stands on the picture. The planners sit in the middle by control account, between the work that leads to them and the work that follows. */
function layout(order: Rec[], outline: Rec[]) {
  const W = 1200, left = 278, right = 922, step = 42;
  const across = Math.max(6, Math.floor((right - left) / step));
  const rows = outline.reduce((n, a) => n + Math.ceil(a.packages.length / across), 0);
  const middle = 40 + rows * step + outline.length * 30;
  const H = Math.max(590, middle + 60);
  const at = order.findIndex((s) => s.key === "procedures");
  const before = at < 0 ? order : order.slice(0, at), after = at < 0 ? [] : order.slice(at + 1);
  const spots: Spot[] = [];
  const column = (list: Rec[], x: number) => list.forEach((s, i) => spots.push({ key: s.key, x, y: ((i + 0.5) / list.length) * (H - 16) + 2, agent: !!AGENT[s.key] }));
  column(before.slice(0, -1), 72);
  column(after.slice(1), W - 72);
  if (before.length) spots.push({ key: before[before.length - 1].key, x: 196, y: H / 2, agent: !!AGENT[before[before.length - 1].key] });
  if (after.length) spots.push({ key: after[0].key, x: W - 196, y: H / 2, agent: !!AGENT[after[0].key] });
  const chips: Chip[] = [], lanes: Lane[] = [];
  let y = (H - middle) / 2 + 44;
  for (const a of outline) {
    const list = a.packages as Rec[], wide = Math.min(list.length, across) * step;
    const x0 = (left + right) / 2 - wide / 2 + step / 2;
    lanes.push({ name: a.name, x: x0 - 16, y: y + 8, n: list.length });
    y += 30;
    list.forEach((w, i) => {
      const parts = String(w.no).split(".");
      chips.push({ no: w.no, name: w.name, short: parts.length > 1 ? parts.slice(1).join(".") : w.no, x: x0 + (i % across) * step, y: y + 12 + Math.floor(i / across) * step });
    });
    y += Math.ceil(list.length / across) * step;
  }
  return { W, H, top: (H - middle) / 2 + 22, spots, chips, lanes, chain: [...before.map((s) => s.key), ...after.map((s) => s.key)], hubIn: before[before.length - 1]?.key, hubOut: after[0]?.key };
}

const curve = (x0: number, y0: number, x1: number, y1: number) => { const m = (x1 - x0) * 0.5; return `M${x0} ${y0} C${x0 + m} ${y0} ${x1 - m} ${y1} ${x1} ${y1}`; };

function Wire({ d, state }: { d: string; state: "off" | "done" | "live" }) {
  return <path d={d} fill="none" className={state === "live" ? "sw-flow" : undefined} stroke={state === "live" ? BLUE : state === "done" ? GREEN : "#ffffff"} strokeOpacity={state === "live" ? 1 : state === "done" ? 0.5 : 0.1} strokeWidth={state === "live" ? 2 : 1.25} />;
}

function Station({ s, spot, on, onPick }: { s: Stage; spot: Spot; on: boolean; onPick: () => void }) {
  const look = LOOK[s.state], { x, y, agent } = spot, R = 25;
  const shape = (r: number, extra: Rec) => (agent ? <circle cx={x} cy={y} r={r} {...extra} /> : <rect x={x - r + 2} y={y - r + 2} width={r * 2 - 4} height={r * 2 - 4} rx={9} {...extra} />);
  return (
    <g role="button" tabIndex={0} aria-label={`${s.by}: ${TASK[s.key] ?? s.label}. ${look.word}`} onClick={onPick} onKeyDown={opens(onPick)} className="sw-node cursor-pointer">
      <title>{s.by}: {s.label}. {look.word}{s.note ? `. ${s.note}` : ""}</title>
      {s.state === "working" && shape(R, { className: "sw-ping", fill: "none", stroke: BLUE, strokeWidth: 2 })}
      {on && shape(R + 5, { fill: "none", stroke: GOLD, strokeWidth: 2 })}
      {shape(R, { fill: look.fill, stroke: look.stroke, strokeWidth: s.state === "idle" ? 1.25 : 2 })}
      <g transform={`translate(${x - 10} ${y - 10}) scale(.84)`}><path d={iconPath(ICON[s.key] ?? "cpu")} fill="none" stroke={s.state === "idle" ? "#8f99a8" : "#ffffff"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></g>
      {s.state === "done" && <g><circle cx={x + 18} cy={y - 18} r={7} fill={GREEN} stroke="#111820" strokeWidth={1.5} /><path d={`M${x + 14.5} ${y - 18}l2.5 2.5l4.5 -5`} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" /></g>}
      <text x={x} y={y + R + 15} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={s.state === "idle" ? "#abb3bf" : "#ffffff"}>{s.by}</text>
      <text x={x} y={y + R + 29} textAnchor="middle" fontSize={10} fill="#abb3bf">{TASK[s.key] ?? s.label}</text>
      {s.note && s.state !== "idle" && <text x={x} y={y + R + 42} textAnchor="middle" fontSize={9.5} fill="#8f99a8">{cut(s.note, 30)}</text>}
    </g>
  );
}

function PlannerNode({ c, state, fresh, on, onPick }: { c: Chip; state: State; fresh: boolean; on: boolean; onPick: () => void }) {
  const look = LOOK[state], R = 16;
  return (
    <g role="button" tabIndex={0} aria-label={`Planner for ${c.no} ${c.name}. ${look.word}`} onClick={onPick} onKeyDown={opens(onPick)} className="sw-node cursor-pointer">
      <title>{c.no} {c.name}: {look.word}</title>
      {state === "working" && <circle cx={c.x} cy={c.y} r={R} className="sw-ping" fill="none" stroke={BLUE} strokeWidth={2} />}
      {fresh && <circle cx={c.x} cy={c.y} r={R} className="sw-done" fill="none" stroke={GREEN} strokeWidth={3} />}
      {on && <circle cx={c.x} cy={c.y} r={R + 4} fill="none" stroke={GOLD} strokeWidth={2} />}
      <circle cx={c.x} cy={c.y} r={R} fill={look.fill} stroke={look.stroke} strokeWidth={state === "idle" ? 1 : 1.75} strokeDasharray={state === "queued" ? "3 3" : undefined} />
      <text x={c.x} y={c.y + 3.5} textAnchor="middle" fontSize={c.short.length > 3 ? 9 : 10.5} fontWeight={600} fill={state === "idle" ? "#8f99a8" : "#ffffff"}>{c.short}</text>
    </g>
  );
}

/** The network itself. Wires run under the nodes, so a planner at work is seen to draw from the pages found, and one finished is seen to feed what follows. */
function Network({ order, outline, frame, at, lit, pick, onPick }: { order: Rec[]; outline: Rec[]; frame: Frame; at: number; lit: number; pick: string; onPick: (p: string) => void }) {
  const map = useMemo(() => layout(order, outline), [order, outline]);
  const spot = Object.fromEntries(map.spots.map((s) => [s.key, s]));
  const stateOf = (c: Chip): State => {
    const w = frame.work[c.no], a = frame.agents[frame.planner[c.no]];
    return w?.status === "failed" ? "failed" : w?.status === "done" ? "done" : a?.state ?? "idle";
  };
  const links = map.chain.slice(0, -1).map((k, i) => [k, map.chain[i + 1]]).filter(([a, b]) => a !== map.hubIn || b !== map.hubOut);
  const stateOfLink = (b: string) => { const s = frame.stages[b]?.state; return s === "working" ? "live" : s === "done" ? "done" : "off"; };
  const procedures = frame.stages.procedures;
  const hubIn = spot[map.hubIn], hubOut = spot[map.hubOut];
  const fresh = (c: Chip) => stateOf(c) === "done" && at - (frame.work[c.no]?.finished ?? -1e9) < lit;
  return (
    <svg viewBox={`0 0 ${map.W} ${map.H}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label="The agents at work">
      <defs>
        <pattern id="sw-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#ffffff0d" /></pattern>
      </defs>
      <rect width={map.W} height={map.H} fill="url(#sw-grid)" />
      {links.map(([a, b]) => { const p = spot[a], q = spot[b]; return p && q ? <Wire key={`${a}-${b}`} d={p.x === q.x ? `M${p.x} ${p.y + 62} L${q.x} ${q.y - 27}` : curve(p.x, p.y, q.x, q.y)} state={stateOfLink(b)} /> : null; })}
      {hubIn && map.chips.map((c) => { const s = stateOf(c); return s === "working" ? <Wire key={`in-${c.no}`} d={curve(hubIn.x, hubIn.y, c.x, c.y)} state="live" /> : null; })}
      {hubOut && map.chips.map((c) => {
        if (stateOf(c) !== "done") return null;
        return <Wire key={`out-${c.no}`} d={curve(c.x, c.y, hubOut.x, hubOut.y)} state={fresh(c) ? "live" : "done"} />;
      })}
      {hubIn && map.lanes.map((l) => <Wire key={`lane-${l.name}`} d={curve(hubIn.x, hubIn.y, l.x, l.y + 34)} state={procedures?.state === "idle" || !procedures ? "off" : "done"} />)}
      {map.chips.length > 0 && <text x={map.W / 2} y={map.top} textAnchor="middle" fontSize={13.5} fontWeight={700} fill="#ffffff">One planner per work package{procedures?.of ? `: ${procedures.done} of ${procedures.of} written` : ""}</text>}
      {!map.chips.length && <><text x={map.W / 2} y={map.H / 2 - 8} textAnchor="middle" fontSize={14} fontWeight={700} fill="#d3d8de">One planner per work package will work here</text><text x={map.W / 2} y={map.H / 2 + 12} textAnchor="middle" fontSize={11.5} fill="#8f99a8">They start once the schedule is read and the pages are found</text></>}
      {map.lanes.map((l) => {
        const mine = map.chips.filter((c) => outline.find((a) => a.name === l.name)?.packages.some((w: Rec) => w.no === c.no));
        const done = mine.filter((c) => stateOf(c) === "done").length;
        return <text key={l.name} x={l.x} y={l.y} fontSize={11} fontWeight={600} fill="#d3d8de" stroke="#111820" strokeWidth={4} paintOrder="stroke">{l.name}<tspan fill="#8f99a8" fontWeight={400}>{`   ${done} of ${l.n}`}</tspan></text>;
      })}
      {map.spots.map((s) => frame.stages[s.key] && <Station key={s.key} s={frame.stages[s.key]} spot={s} on={pick === `stage:${s.key}`} onPick={() => onPick(`stage:${s.key}`)} />)}
      {map.chips.map((c) => <PlannerNode key={c.no} c={c} state={stateOf(c)} fresh={fresh(c)} on={pick === `planner:${c.no}`} onPick={() => onPick(`planner:${c.no}`)} />)}
    </svg>
  );
}

/** The run from end to end: how many agents worked at once, when each stage ran, and where the screen stands. Dragging it goes to that moment. */
function Track({ stats, end, at, onSeek }: { stats: ReturnType<typeof measure>; end: number; at: number; onSeek: (t: number) => void }) {
  const [peek, setPeek] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const span = Math.max(1, end), W = 1000, H = 44;
  const x = (t: number) => (t / span) * W, y = (n: number) => H - (n / Math.max(1, stats.peak)) * (H - 4);
  let d = `M0 ${H}`, last = 0;
  for (const [t, n] of stats.series) { d += ` L${x(t)} ${y(last)} L${x(t)} ${y(n)}`; last = n; }
  d += ` L${x(end)} ${y(last)} L${x(end)} ${H} Z`;
  const pct = (t: number) => `${Math.min(100, (t / span) * 100)}%`;
  const till = (s: Rec) => (s.closed ? s.end : end);  // a stage still going reaches the present, however long since it last said anything
  const working = (t: number) => { let n = 0; for (const [a, b] of stats.series) { if (a > t) break; n = b; } return n; };
  const stageAt = (t: number) => (stats.spans as Rec[]).filter((s) => s.start <= t && t <= till(s)).pop();
  return (
    <div ref={box} data-tour="swarm-track" className="relative h-[66px] select-none" onMouseMove={(e) => { const r = box.current?.getBoundingClientRect(); if (r) setPeek(((e.clientX - r.left) / r.width) * span); }} onMouseLeave={() => setPeek(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-[44px] w-full" aria-hidden="true">
        <path d={d} fill={BLUE} fillOpacity={0.3} stroke={BLUE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-x-0 top-[47px] h-[18px] overflow-hidden rounded-sm bg-white/[.05]">
        {(stats.spans as Rec[]).map((s) => <span key={s.key} title={s.label} className="absolute inset-y-0 overflow-hidden whitespace-nowrap rounded-sm px-1 text-[10px] font-medium leading-[18px] text-white" style={{ left: pct(s.start), width: `max(3px, calc(${pct(till(s) - s.start)} - 1px))`, background: s.by === "Code" ? "#5f6b79" : s.key === "procedures" ? "#2f6fbd" : "#6f62d6" }}>{WORD[s.key] ?? s.label}</span>)}
      </div>
      <span className="pointer-events-none absolute inset-y-0 w-[2px] bg-[#f5b82e]" style={{ left: pct(at) }}><span className="absolute -left-[4px] -top-[1px] h-[10px] w-[10px] rounded-full bg-[#f5b82e]" /></span>
      {peek != null && <span className="pointer-events-none absolute -top-[26px] z-10 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-2 py-0.5 text-[11px] tabular-nums text-white" style={{ left: `clamp(90px, ${pct(peek)}, calc(100% - 90px))` }}>{clock(peek)} · {working(peek)} at work{stageAt(peek)?.label ? ` · ${stageAt(peek)?.label}` : ""}</span>}
      <input type="range" min={0} max={span} step={1} value={Math.min(at, span)} onChange={(e) => onSeek(Number(e.target.value))} aria-label="Move through the run" className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
    </div>
  );
}

function Kind({ kind }: { kind?: string }) {
  const letter = kind === "inspection" ? "I" : kind === "handling" ? "H" : "O";
  return <span title={kind} className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border border-[#abb3bf] text-[9.5px] font-bold text-[#d3d8de] ${kind === "inspection" ? "rounded-[2px]" : "rounded-full"}`}>{letter}</span>;
}

const LEVEL: Record<string, [string, string]> = { stop: ["Stops work", RED], rework: ["Risks rework", "#c98500"], clarify: ["Worth confirming", GREY] };

function Made({ made, onOpen }: { made: Rec; onOpen: (code: string) => void }) {
  const tasks = (made.tasks ?? []) as Rec[], findings = (made.findings ?? []) as string[], questions = (made.questions ?? []) as Rec[], links = (made.links ?? []) as Rec[];
  if (!made.scope && !tasks.length && !findings.length && !questions.length && !links.length && !made.summary) return null;
  return (
    <div className="space-y-2">
      <Label>What it made</Label>
      {made.scope && <p className="leading-snug text-[#d3d8de]">{made.scope}</p>}
      {tasks.length > 0 && <ul className="space-y-1">{tasks.map((t, i) => <li key={i} className="flex items-start gap-1.5 leading-snug text-[#d3d8de]"><Kind kind={t.kind} />{t.name}</li>)}</ul>}
      {findings.length > 0 && <ul className="space-y-1">{findings.map((f, i) => <li key={i} className="leading-snug text-[#d3d8de]">{f}</li>)}</ul>}
      {questions.length > 0 && <><p className="text-[11.5px] text-[#abb3bf]">{questions.length} questions, most urgent first</p><ul className="space-y-1">{questions.slice(0, 12).map((q, i) => <li key={i} className="flex items-start gap-1.5 leading-snug text-[#d3d8de]">{LEVEL[q.level] && <span title={LEVEL[q.level][0]} className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: LEVEL[q.level][1] }} />}{q.subject}</li>)}</ul>{questions.length > 12 && <p className="text-[11.5px] text-[#8f99a8]">and {questions.length - 12} more, on Review</p>}</>}
      {links.length > 0 && <><p className="text-[11.5px] text-[#abb3bf]">{links.length} links between the work</p><ul className="space-y-1">{links.slice(0, 10).map((l, i) => <li key={i} className="leading-snug text-[#d3d8de]"><b className="font-mono text-[11px] text-white">{l.before} → {l.after}</b> {l.why}</li>)}</ul></>}
      {made.summary && <p className="whitespace-pre-line leading-snug text-[#d3d8de]">{made.summary}</p>}
      {made.code && <button onClick={() => onOpen(made.code)} className={quiet}>Open it in the WBS</button>}
    </div>
  );
}

/** One node, opened: what it is, how it went, what it was told and what it made. What it made shows once the screen has reached the moment it finished. */
function Detail({ run, pick, frame, onClose, onOpen }: { run: string; pick: string; frame: Frame; onClose: () => void; onOpen: (code: string) => void }) {
  const [kind, id] = pick.split(":");
  const stage = kind === "stage" ? frame.stages[id] : null;
  const key = kind === "planner" ? frame.planner[id] : stage ? AGENT[stage.key] : "";
  const who = key ? frame.agents[key] : null;
  const [info, setInfo] = useState<Rec | null>(null);
  const state: State = stage ? stage.state : frame.work[id]?.status === "failed" ? "failed" : frame.work[id]?.status === "done" ? "done" : who?.state ?? "idle";
  useEffect(() => {
    if (!key) { setInfo(null); return; }
    let live = true;
    api(`/api/aip/runs/${run}/agents/${key}${stage ? `?stage=${stage.key}` : ""}`).then((r) => { if (live) setInfo(r); }).catch(() => { if (live) setInfo(null); });
    return () => { live = false; };
  }, [run, key, state, stage?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const work = kind === "planner" ? frame.work[id] : null;
  const title = stage ? stage.by : who?.name ?? `Planner · ${id}`;
  const line = stage ? stage.label : info?.role ?? work?.name ?? "";
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><p className="text-[14px] font-bold leading-snug text-white">{title}</p><p className="leading-snug text-[#abb3bf]">{line}</p></div>
        <button onClick={onClose} aria-label="Close" className="shrink-0 rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] tabular-nums text-[#abb3bf]">
        <Pill tone={LOOK[state].tone}>{LOOK[state].word}</Pill>
        {who?.kept && <Pill tone="info">Picked up, not paid again</Pill>}
        {stage && stage.until > stage.since && <span>{clock(stage.until - stage.since)}</span>}
        {!stage && who && who.took > 0 && <span>{clock(who.took)}</span>}
        {info && info.usd > 0 && <span>{dollars(info.usd)}{stage ? " in all" : ""}</span>}
        {stage && !key && <span>Code, no model</span>}
      </p>
      {stage?.note && <p className="leading-snug text-[#d3d8de]">{stage.note}</p>}
      {info?.told && <details className="rounded border border-white/10 bg-black/15"><summary className="cursor-pointer px-2 py-1.5 text-[11.5px] font-medium text-[#d3d8de]">What it was told{info.looks > 1 ? `, in the first of ${info.looks} turns` : ""}</summary><p className="max-h-[220px] overflow-auto whitespace-pre-wrap border-t border-white/5 px-2 py-1.5 text-[11px] leading-snug text-[#abb3bf]">{info.told}</p></details>}
      {info?.made && state === "done" && <Made made={info.made} onOpen={onOpen} />}
      {info?.model && <p className="text-[10.5px] text-[#8f99a8]">Model: {info.model}</p>}
    </div>
  );
}

function Tiles({ items }: { items: [string, ReactNode][] }) {
  return <div className="grid grid-cols-2 gap-px bg-white/[.05]">{items.map(([label, value]) => <div key={label} className="bg-[#151e28] px-3 py-2"><p className="text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">{label}</p><p className="mt-0.5 text-[17px] font-bold leading-none tabular-nums text-white">{value}</p></div>)}</div>;
}

/** Who is at work at this moment, or, when no one is, where the money went. */
function Now({ frame, at, onPick }: { frame: Frame; at: number; onPick: (p: string) => void }) {
  const working = Object.values(frame.agents).filter((a) => a.state === "working");
  const groups: Record<string, number> = {};
  for (const a of Object.values(frame.agents)) if (a.usd > 0) groups[a.no ? "Planners" : a.name] = (groups[a.no ? "Planners" : a.name] ?? 0) + a.usd;
  const spent = Object.entries(groups).sort((x, y) => y[1] - x[1]);
  if (working.length) return (
    <div>
      <Label>At work now</Label>
      <ul className="mt-1 divide-y divide-white/[.05]">
        {working.map((a) => (
          <li key={a.key}><button onClick={() => onPick(a.no ? `planner:${a.no}` : `stage:${Object.keys(AGENT).filter((k) => AGENT[k] === a.key).reverse().find((k) => frame.stages[k]?.state === "working") ?? Object.keys(AGENT).find((k) => AGENT[k] === a.key)}`)} className="flex w-full items-center gap-2 py-1 text-left hover:bg-white/[.04]">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: BLUE }} />
            <span className="min-w-0 flex-1 truncate text-[#e5e8eb]" title={a.role}>{a.no ? a.role.replace("writes the tasks and procedures of ", "") : a.name}</span>
            <span className="shrink-0 tabular-nums text-[#8f99a8]">{clock(at - a.since)}</span>
          </button></li>
        ))}
      </ul>
    </div>
  );
  if (!spent.length) return <p className="leading-snug text-[#8f99a8]">Click any node to see what it was told and what it made.</p>;
  return (
    <div>
      <Label>Where the money went</Label>
      <ul className="mt-1.5 space-y-1.5">{spent.map(([name, usd]) => <li key={name}><p className="flex justify-between text-[#d3d8de]"><span className="truncate">{name}</span><span className="tabular-nums">{dollars(usd)}</span></p><SizeBar value={usd} max={spent[0][1]} /></li>)}</ul>
      <p className="mt-2 leading-snug text-[#8f99a8]">Click any node to see what it was told and what it made.</p>
    </div>
  );
}

function Legend({ stopped }: { stopped: boolean }) {
  const dot = (state: State) => <svg width={14} height={14} aria-hidden="true"><circle cx={7} cy={7} r={5.5} fill={LOOK[state].fill} stroke={LOOK[state].stroke} strokeWidth={1.5} strokeDasharray={state === "queued" ? "2 2" : undefined} /></svg>;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#abb3bf]">
      {(["idle", "queued", "working", "done", "failed", ...(stopped ? ["stopped"] : [])] as State[]).map((s) => <span key={s} className="flex items-center gap-1.5">{dot(s)}{s === "queued" ? "Waiting" : LOOK[s].word}</span>)}
      <span className="ml-2 flex items-center gap-1.5"><svg width={14} height={14} aria-hidden="true"><circle cx={7} cy={7} r={5.5} fill="none" stroke="#abb3bf" strokeWidth={1.5} /></svg>An agent</span>
      <span className="flex items-center gap-1.5"><svg width={14} height={14} aria-hidden="true"><rect x={2} y={2} width={10} height={10} rx={2.5} fill="none" stroke="#abb3bf" strokeWidth={1.5} /></svg>Code</span>
    </p>
  );
}

export function SwarmModule() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<Rec | null>(null);
  const [events, setEvents] = useState<Rec[]>([]);
  const [err, setErr] = useState("");
  const [at, setAt] = useState<number | null>(null);  // null follows the end of the run
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const seen = useRef({ id: "", next: 0, loading: false });
  const go = useGo();

  const load = useCallback(async () => {
    const s = seen.current;
    if (s.loading) return;
    s.loading = true;
    try {
      const ask = (after: number) => api<Rec>(`/api/aip/swarm?run=${encodeURIComponent(runId)}&after=${after}`);
      let got = await ask(s.next);
      const id = got.run?.id ?? "";
      if (id !== s.id) {
        if (s.next) got = await ask(0);
        s.id = id;
        setEvents(got.events as Rec[]);
        setAt(null);
        setPlaying(false);
        setPick("");
      } else if ((got.events as Rec[]).length) {
        setEvents((old) => { const from = old.length ? old[old.length - 1].seq : -1; return [...old, ...(got.events as Rec[]).filter((e) => e.seq > from)]; });
      }
      s.next = got.next;
      setData({ ...got, fetched: Date.now() });
      setErr("");
    } catch (e) { setErr((e as Error).message); } finally { s.loading = false; }
  }, [runId]);

  useEffect(() => { seen.current = { id: "", next: 0, loading: false }; void load(); }, [load]);
  useEffect(() => {
    const again = () => void load();
    window.addEventListener("records-changed", again);
    return () => window.removeEventListener("records-changed", again);
  }, [load]);
  const running = data?.run?.status === "running";
  const started = useSwarmLive();
  useEffect(() => { if (started && !runId && started !== seen.current.id) void load(); }, [started, runId, load]);  // a run begun anywhere comes up here, unless a person has picked an older one to look at
  useEffect(() => {
    if (!running) return;
    const a = setInterval(() => void load(), 1500), b = setInterval(() => setTick((n) => n + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); notifyChanged(); };
  }, [running, load]);

  const closedAt = data?.run && !running ? data.run.elapsed as number : null;
  const stats = useMemo(() => measure(events, closedAt), [events, closedAt]);
  useEffect(() => {  // the demo starts the replay for the person presenting
    const replay = () => { setSpeed(60); setAt(0); setPlaying(true); };
    window.addEventListener("swarm-replay", replay);
    return () => window.removeEventListener("swarm-replay", replay);
  }, []);
  const liveEnd = data?.run ? (running ? data.run.elapsed + (Date.now() - data.fetched) / 1000 : Math.max(stats.end, data.run.elapsed ?? 0)) : 0;
  const end = Math.max(1, liveEnd);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now(), by = ((now - last) / 1000) * speed;
      last = now;
      setAt((was) => { const next = (was ?? 0) + by; if (next >= end) { setPlaying(false); return null; } return next; });
    }, 70);
    return () => clearInterval(t);
  }, [playing, speed, end]);

  const by = (data?.by ?? {}) as Record<string, string>;
  const standing = at ?? end;
  const ended = !!data?.run && ["failed", "cancelled"].includes(data.run.status);
  const frame = useMemo(() => frameAt(events, at ?? Number.MAX_SAFE_INTEGER, by, ended), [events, at, data?.by, ended]); // eslint-disable-line react-hooks/exhaustive-deps
  const order = useMemo(() => (events.find((e) => e.type === "firm")?.stages ?? []) as Rec[], [events]);
  const outline = (data?.outline ?? []) as Rec[];

  if (!data) return <div className="flex-1 bg-[#111820]"><Problem err={err} />{!err && <Loading />}</div>;
  const run = data.run as Rec | null;
  if (!run) return <div className="min-h-0 flex-1 bg-[#111820]"><Problem err={err} /><Empty>The agents have not run on this project yet. Add the documents on <button onClick={() => go("home")} className="underline">Home</button>, and this tab shows them at work, and lets you watch it again afterwards.</Empty></div>;

  const replaying = at != null;
  const stopped = ended;
  const latest = (data.runs as Rec[])[0]?.id === run.id;
  const done = frame.stages.procedures;
  const working = Object.values(frame.agents).filter((a) => a.state === "working").length;
  const shownUsd = !replaying ? run.spent_usd : stats.usd ? (frame.usd / stats.usd) * run.spent_usd : 0;
  const start = async (fresh: boolean) => {
    if (!window.confirm(fresh ? "The agents start over from the first document, and pay for everything again. When they finish, their plan replaces the one waiting for you. Start over?" : "The agents carry on from where they stopped. When they finish, their plan replaces the one waiting for you. Carry on?")) return;
    setBusy(true);
    try {
      if (fresh) await api("/api/aip/analysis/forget", {});
      await api("/api/aip/konsultan", { nama: "Analysis of the documents", versi: "muse", jenis: "package" });
      setRunId("");
      notifyChanged();
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const stop = async () => { await api(`/api/aip/runs/${run.id}/cancel`, {}); notifyChanged(); await load(); };
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111820] text-[12px] ${replaying && !playing ? "sw-still" : ""}`}>
      <Bar title="Agent swarm" note={running && !replaying ? "Every node is a real agent or a real step of code, moving as it happens" : replaying ? "Watching it again, as it happened" : run.summary || "How the agents worked through the documents"}>
        {running && !replaying && <span className="flex items-center gap-1.5 rounded-full bg-[#e5484d]/15 px-2 py-0.5 text-[11px] font-semibold text-[#ffb4b4]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#e5484d]" />Live</span>}
        {(data.runs as Rec[]).length > 1 && <select aria-label="Which run" value={run.id} onChange={(e) => setRunId(e.target.value)} className="max-w-[260px] rounded border border-white/15 bg-black/20 px-2 py-1 text-[12px] text-white">{(data.runs as Rec[]).map((r) => <option key={r.id} value={r.id} className="bg-[#1c2733]">{when(r.created_at)} · {r.status === "succeeded" ? "finished" : r.status === "running" ? "running" : "stopped"} · {dollars(r.spent_usd)}</option>)}</select>}
        {running && <button onClick={() => void stop()} title="Stopping keeps every finished answer, and the plan already waiting" className={quiet}>Stop</button>}
        {!running && run.status === "succeeded" && latest && <button onClick={() => go("review")} className={quiet}>Review the proposal</button>}
      </Bar>
      <Problem err={err} />
      {(stopped || data.kept > 0) && latest && !running && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#fab219]/25 bg-[#fab219]/[.07] px-4 py-2 text-[#fbd38d]"><Icon name="alert" className="h-3.5 w-3.5 shrink-0" /><p className="min-w-[260px] flex-1 leading-snug">{stopped ? `Stopped after ${clock(end)}, at ${dollars(run.spent_usd)}.` : "An analysis was cut off."} Nothing was lost: {data.kept > 0 ? `${data.kept} finished answers are kept, and ` : ""}any plan waiting for you is as it was.{data.kept > 0 ? " Carrying on picks those answers up, so you pay only for the rest." : ""}</p><button disabled={busy} onClick={() => void start(false)} className={primary}>{data.kept > 0 ? "Carry on" : "Run again"}</button>{data.kept > 0 && <button disabled={busy} onClick={() => void start(true)} className={quiet}>Start over</button>}</div>}
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <div data-tour="swarm" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 px-2 pt-1">{order.length ? <Network order={order} outline={outline} frame={frame} at={standing} lit={running || replaying ? LIT * (playing ? speed : 1) : 0} pick={pick} onPick={(p) => setPick(p === pick ? "" : p)} /> : <Loading />}</div>
          <div className="shrink-0 space-y-2 border-t border-white/10 bg-[#151e28] px-4 pb-2.5 pt-3">
            <div className="flex items-center gap-3">
              <button onClick={() => { if (playing) { setPlaying(false); return; } if (at == null) setAt(0); setPlaying(true); }} className={`${primary} flex shrink-0 items-center gap-1.5`}><Icon name={playing ? "pause" : "play"} className="h-3.5 w-3.5" />{playing ? "Pause" : replaying ? "Play" : "Replay"}</button>
              {replaying && <button onClick={() => setAt(0)} title="From the start" aria-label="From the start" className={`${quiet} shrink-0`}><Icon name="restore" className="h-3.5 w-3.5" /></button>}
              <span className="flex shrink-0 rounded-md border border-white/15 bg-black/20 p-0.5" role="group" aria-label="Replay speed">{SPEEDS.map((s) => <button key={s} onClick={() => setSpeed(s)} aria-pressed={speed === s} className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ${speed === s ? "bg-white/15 font-semibold text-white" : "text-[#abb3bf] hover:text-white"}`}>{s}×</button>)}</span>
              {replaying && <button onClick={() => { setAt(null); setPlaying(false); }} className={`${quiet} shrink-0`}>{running ? "Back to live" : "To the end"}</button>}
              <p className="min-w-0 flex-1 truncate text-[#abb3bf]">{frame.now && (running || replaying) ? frame.now : ""}</p>
              <p className="shrink-0 text-[11px] text-[#8f99a8]"><span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: BLUE, opacity: 0.6 }} /> agents at work at once, {stats.peak} at most</p>
            </div>
            <Track stats={stats} end={end} at={standing} onSeek={(t) => { setPlaying(false); setAt(t); }} />
            <div className="flex items-center justify-between gap-3"><span className="text-[11px] tabular-nums text-[#8f99a8]">0:00</span><Legend stopped={stopped} /><span className="text-[11px] tabular-nums text-[#8f99a8]">{clock(end)}</span></div>
          </div>
        </div>
        <aside className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-black/50 bg-[#151e28] max-lg:h-[300px] max-lg:w-full max-lg:border-l-0 max-lg:border-t">
          <Tiles items={[["Time", clock(standing)], ["Cost", dollars(shownUsd)], ["At work now", working], ["Work packages", done?.of ? `${done.done} of ${done.of}` : "–"]]} />
          <div className="min-h-0 flex-[3] space-y-2 overflow-y-auto border-t border-white/5 p-3">
            {pick ? <Detail run={run.id} pick={pick} frame={frame} onClose={() => setPick("")} onOpen={(code) => go(`wbs/tree:${code}`)} /> : <Now frame={frame} at={standing} onPick={setPick} />}
          </div>
          <div className="min-h-0 flex-[2] overflow-y-auto border-t border-white/10 p-3">
            <Label>What happened</Label>
            <ul className="mt-1 space-y-1">{frame.log.map((l, i) => <li key={`${l.at}-${i}`} className="flex items-baseline gap-2 leading-snug"><span className="w-[34px] shrink-0 text-right text-[10.5px] tabular-nums text-[#6f7c8b]">{clock(l.at)}</span><span className={l.tone === "bad" ? "text-[#ffb4b4]" : l.tone === "info" ? "text-[#9cc7f5]" : l.tone === "ok" ? "text-[#d3d8de]" : "text-white"}>{l.text}</span></li>)}</ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The run going now, if one is. */
export function useSwarmLive() {
  const [live, setLive] = useState("");
  useEffect(() => {
    let on = true;
    const read = () => api<Rec>("/api/aip/running").then((r) => { if (on) setLive(r.run ?? ""); }).catch(() => {});
    void read();
    const t = setInterval(() => void read(), 3000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return live;
}
