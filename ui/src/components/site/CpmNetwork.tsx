"use client";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { dates, type Rec } from "./kit";

/* The critical path as a network, activity on node: a circle for each work package and an arrow for each link, from Start to End. Each column is one link deeper than the last, and the chain that holds the finish date runs straight along the middle in red. It adds no facts: the dates, the float and the links are the ones code worked out. Given the Kanban board, each circle takes the colour of where its work stands there, and a work package that is still one card can be moved from here, by the board's own rules. */

const CW = 112, RH = 66, PADX = 46, PADT = 40, PADB = 44, R = 17, RE = 8, BEND = 0.62;
const LINE = "#8f99a8", CRIT = "#e5484d", NODE = "#29a383", SHEET = "#111820";
const HALO = { stroke: SHEET, strokeWidth: 3, strokeLinejoin: "round" as const, style: { paintOrder: "stroke" as const } };  // keeps a label readable where a line passes behind it
export const STATUS: Record<string, { label: string; color: string; fill: string }> = {  // the Kanban board's columns, in its colours
  proposed: { label: "Proposed", color: "#e879a8", fill: "#e879a838" },
  open: { label: "To do", color: "#8f99a8", fill: "#8f99a826" },
  doing: { label: "In progress", color: "#3987e5", fill: "#3987e573" },
  review: { label: "In review", color: "#fab219", fill: "#fab21973" },
  done: { label: "Done", color: "#29a383", fill: "#29a383b3" },
};
const MOVES = ["open", "doing", "review", "done"];

/** Where each work package stands on the Kanban board. One that is still a single card stands where that card is. One broken into tasks stands where its tasks are: done when all are, in review when every task left is, in progress once any has started, and to do before that. */
export function boardStatus(cards: Rec[]): Record<string, Rec> {
  const out: Record<string, Rec> = {};
  const byActivity: Record<string, Rec[]> = {};
  for (const c of cards) if (c.activity) (byActivity[c.activity] ??= []).push(c);
  for (const [aid, list] of Object.entries(byActivity)) {
    const own = list.find((c) => c.type === "activity" && c.id === aid);
    if (own) { out[aid] = { status: own.status, card: own, stopped: own.stopped, overdue: own.overdue, blockers: own.blockers ?? [] }; continue; }
    const tasks = list.filter((c) => c.type !== "activity");
    if (!tasks.length) continue;
    const count = (s: string) => tasks.filter((c) => c.status === s).length;
    const done = count("done"), left = tasks.filter((c) => c.status !== "done");
    const status = done === tasks.length ? "done" : left.every((c) => c.status === "proposed") ? "proposed" : left.every((c) => c.status === "review") ? "review" : tasks.some((c) => ["doing", "review", "done"].includes(c.status)) ? "doing" : "open";
    out[aid] = { status, tasks: tasks.length, done, doing: count("doing") + count("review"), stopped: tasks.some((c) => c.stopped), overdue: tasks.some((c) => c.overdue) };
  }
  return out;
}

function layout(rows: Rec[], path: Rec[]) {
  const by: Record<string, Rec> = Object.fromEntries(rows.map((r) => [r.id, r]));
  const before = (id: string) => (by[id].after as string[]).filter((a) => by[a]);
  const next: Record<string, string[]> = Object.fromEntries(rows.map((r) => [r.id, []]));
  rows.forEach((r) => before(r.id).forEach((a) => next[a].push(r.id)));
  const depth: Record<string, number> = {};
  const dig = (id: string, seen: Set<string>): number => {
    if (depth[id] !== undefined) return depth[id];
    if (seen.has(id)) return 1;  // code refuses a loop, but a drawing must never hang on one
    seen.add(id);
    const b = before(id);
    return (depth[id] = b.length ? 1 + Math.max(...b.map((a) => dig(a, seen))) : 1);
  };
  rows.forEach((r) => dig(r.id, new Set()));
  const end = Math.max(0, ...Object.values(depth)) + 1;
  const chain = path.map((p) => p.id as string).filter((id) => by[id]);
  const onChain = new Set(chain);
  const apart = rows.filter((r) => !onChain.has(r.id) && !before(r.id).length && !next[r.id].length);  // tied to nothing, such as site overheads that run the whole job
  const row: Record<string, number> = Object.fromEntries(chain.map((id) => [id, 0]));

  // the small control accounts, often the services, above the chain, and the large ones below; a package crosses over only if the other side is far nearer
  const off = rows.filter((r) => !onChain.has(r.id) && !apart.includes(r));
  const account = (r: Rec) => String(r.code).split(".").slice(0, 2).join(".");
  const size: Record<string, number> = {};
  off.forEach((r) => { size[account(r)] = (size[account(r)] ?? 0) + 1; });
  const pull = (r: Rec) => { const b = before(r.id).map((a) => row[a] ?? 0); return b.length ? Math.abs(b.reduce((s, x) => s + x, 0) / b.length) : 0; };
  const taken: Record<string, number[]> = { "-1": [], "1": [] };
  for (const r of [...off].sort((a, b) => depth[a.id] - depth[b.id] || pull(a) - pull(b) || String(a.es).localeCompare(String(b.es)))) {
    const col = depth[r.id];
    const reach = Math.max(col, ...(next[r.id].length ? next[r.id].map((n) => depth[n]) : [end]).map((c) => c - 1));
    const free = (side: number) => { let k = 0; while (taken[side][k] !== undefined && taken[side][k] >= col) k++; return k; };
    const home = size[account(r)] < off.length / 4 ? -1 : 1;
    const side = free(-home) + 5 <= free(home) ? -home : home;
    const k = free(side);
    taken[side][k] = reach;  // the row is this package's until its arrows leave it, so no line runs through another circle
    row[r.id] = side * (k + 1);
  }
  apart.forEach((r, i) => { row[r.id] = -(taken["-1"].length + 1 + i); });

  const all = Object.values(row);
  const low = Math.min(0, ...all), high = Math.max(0, ...all);
  const X = (col: number) => PADX + col * CW, Y = (r: number) => PADT + (r - low) * RH;
  const at: Record<string, { x: number; y: number; r: number }> = { START: { x: X(0), y: Y(0), r: RE }, END: { x: X(end), y: Y(0), r: RE } };
  rows.forEach((r) => { at[r.id] = { x: X(depth[r.id]), y: Y(row[r.id]), r: R }; });

  const hot = new Set(chain.length ? [`START>${chain[0]}`, `${chain[chain.length - 1]}>END`, ...chain.slice(1).map((id, i) => `${chain[i]}>${id}`)] : []);
  const edges = rows.flatMap((r) => [...(before(r.id).length ? before(r.id) : ["START"]).map((a) => [a, r.id]), ...(next[r.id].length ? [] : [[r.id, "END"]])]).map(([from, to]) => {
    const a = at[from], b = at[to], sx = a.x + a.r, tx = b.x - b.r - 2;
    const bend = Math.min(CW * BEND, tx - sx), mx = tx - bend, c = mx + bend / 2;
    const d = a.y === b.y ? `M${sx} ${a.y}H${tx}` : `M${sx} ${a.y}H${mx}C${c} ${a.y} ${c} ${b.y} ${tx} ${b.y}`;
    return { key: `${from}>${to}`, from, to, d, hot: hot.has(`${from}>${to}`) };
  }).sort((a, b) => Number(a.hot) - Number(b.hot));
  return { by, next, at, edges, apart: new Set(apart.map((r) => r.id)), width: X(end) + PADX, height: Y(high) + PADB };
}

/** The name short enough to sit under its circle: without the trade it repeats, such as "Beton: ". The whole name is in the tooltip. */
function label(name: string) {
  const t = name.replace(/^[^:]{3,14}: /, "");
  return t.length > 19 ? `${t.slice(0, 18).trimEnd()}…` : t;
}

/** Why the planning engineer linked one work package to another, from the plan the links came from, keyed "before>after". */
export function linkReasons(plan?: Rec | null): Record<string, string> {
  if (!plan?.links || !plan.packages) return {};
  const id: Record<string, string> = Object.fromEntries(Object.entries(plan.packages as Record<string, Rec>).map(([k, v]) => [v.no, k]));
  return Object.fromEntries((plan.links as Rec[]).filter((l) => id[l.before] && id[l.after] && l.why).map((l) => [`${id[l.before]}>${id[l.after]}`, l.why]));
}

export function CpmNetwork({ rows, path, reasons = {}, onOpen, board, onMove, onBoard }: { rows: Rec[]; path: Rec[]; reasons?: Record<string, string>; onOpen?: (code: string) => void; board?: Rec[]; onMove?: (card: Rec, status: string) => Promise<string | null>; onBoard?: (code: string) => void }) {
  const g = useMemo(() => (rows.length ? layout(rows, path) : null), [rows, path]);
  const stand = useMemo(() => (board ? boardStatus(board) : {}), [board]);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [refused, setRefused] = useState("");
  useEffect(() => {
    if (!pinned) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setPinned(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [pinned]);
  if (!g) return null;
  const { by, next, at, edges, width, height } = g;
  const focus = pinned ?? hover;
  const shown = focus ? by[focus] : null;
  const pin = (id: string) => { setRefused(""); setPinned(pinned === id ? null : id); };
  const move = async (card: Rec, status: string) => {
    if (!onMove || busy) return;
    setBusy(status); setRefused("");
    const why = await onMove(card, status);
    setBusy("");
    if (why) setRefused(why[0].toUpperCase() + why.slice(1));
  };
  const counts = Object.fromEntries(MOVES.map((s) => [s, rows.filter((r) => stand[r.id]?.status === s).length]));
  const here = shown ? stand[shown.id] : null;
  const item = (id: string, why?: string) => <p key={id}>{by[id].code} {by[id].name}{why && <span className="text-[#8f99a8]"> ({why})</span>}</p>;
  return (
    <div className="my-2 rounded border border-white/10 bg-[#111820]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/5 px-3 py-2 text-[10.5px] text-[#abb3bf]">
        <span className="flex items-center gap-1.5"><svg width={26} height={10} aria-hidden="true"><path d="M0 5H19" stroke={CRIT} strokeWidth={2.2} /><path d="M19 1L26 5L19 9Z" fill={CRIT} /></svg>The chain that holds the finish date</span>
        <span className="flex items-center gap-1.5"><svg width={16} height={16} aria-hidden="true"><circle cx={8} cy={8} r={6} fill="#29a3832e" stroke={CRIT} strokeWidth={2.2} /></svg>No float</span>
        {board && MOVES.map((s) => <span key={s} className="flex items-center gap-1.5"><svg width={14} height={14} aria-hidden="true"><circle cx={7} cy={7} r={5.5} fill={STATUS[s].fill} stroke={STATUS[s].color} strokeWidth={1.4} /></svg>{STATUS[s].label} <span className="tabular-nums text-[#8f99a8]">{counts[s]}</span></span>)}
        <span className="ml-auto text-[#8f99a8]">Hover a circle for its dates and links{board ? ". Click it to see or change where it stands on the Kanban board" : onOpen ? ". Click it to open the work package" : ""}</span>
      </div>
      <div className="overflow-x-auto px-3 py-2">
        <div className="relative mx-auto" style={{ width, height }} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={height} role="group" aria-label={`Critical path network, ${rows.length} work packages from Start to End.`} onClick={() => setPinned(null)}>
            <defs>
              {[["cpm-n", LINE], ["cpm-c", CRIT]].map(([id, fill]) => <marker key={id} id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill={fill} /></marker>)}
            </defs>
            {edges.map((e) => {
              const lit = focus && (e.from === focus || e.to === focus);
              return <path key={e.key} d={e.d} fill="none" stroke={e.hot ? CRIT : LINE} strokeWidth={e.hot ? 2.2 : lit ? 2 : 1.2} opacity={focus && !lit ? 0.15 : 1} markerEnd={`url(#${e.hot ? "cpm-c" : "cpm-n"})`} />;
            })}
            {(["START", "END"] as const).map((k) => <g key={k}><circle cx={at[k].x} cy={at[k].y} r={RE} fill="#d3d8de" /><text x={at[k].x} y={at[k].y - 15} textAnchor="middle" fontSize={12} fontWeight={600} fill="#9cc7f5">{k === "START" ? "Start" : "End"}</text></g>)}
            {rows.map((r) => {
              const p = at[r.id], zero = r.critical && !r.float_days, on = focus === r.id, st = STATUS[stand[r.id]?.status ?? ""];
              const open = () => (board ? pin(r.id) : onOpen?.(r.code));
              return (
                <g key={r.id} tabIndex={0} role={board || onOpen ? "button" : undefined} aria-label={`${r.code} ${r.name}, ${r.duration} days, ${r.critical ? "no float" : `float ${r.float_days} days`}${st ? `, ${st.label} on the board` : ""}`} className={`outline-none ${board || onOpen ? "cursor-pointer" : "cursor-default"}`}
                  onMouseEnter={() => setHover(r.id)} onFocus={() => setHover(r.id)} onBlur={() => setHover(null)} onClick={(e) => { e.stopPropagation(); open(); }} onKeyDown={(e) => { if (e.key === "Enter") open(); }}>
                  <circle cx={p.x} cy={p.y} r={R} fill={st ? st.fill : "#29a3832e"} stroke={on ? "#ffffff" : zero ? CRIT : st ? st.color : NODE} strokeWidth={on ? 2.6 : zero ? 2.4 : 1.5} />
                  {stand[r.id]?.status === "done" && <path d={`M${p.x + R * 0.45} ${p.y - R * 0.95}l3 3l6 -7`} fill="none" stroke="#7ee2c0" strokeWidth={2} strokeLinecap="round" />}
                  <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={9.5} fontWeight={600} fill="#ffffff" className="font-mono">{r.code}</text>
                  <text x={p.x} y={p.y - R - 5} textAnchor="middle" fontSize={10} fill="#8f99a8" {...HALO}>{r.duration} d</text>
                  <text x={p.x} y={p.y + R + 13} textAnchor="middle" fontSize={10.5} fill="#e5e8eb" {...HALO}>{label(String(r.name))}</text>
                </g>
              );
            })}
          </svg>
          {shown && (
            <div role={pinned ? "dialog" : "tooltip"} aria-label={pinned ? `${shown.code} ${shown.name}` : undefined} className={`absolute z-10 w-[270px] rounded border bg-[#151e28] p-2 text-[11px] leading-snug text-[#d3d8de] shadow-lg ${pinned ? "pointer-events-auto border-white/30" : "pointer-events-none border-white/15"}`}
              style={{ left: at[shown.id].x + R + 282 > width ? at[shown.id].x - R - 282 : at[shown.id].x + R + 12, ...(at[shown.id].y > height - 230 ? { bottom: height - at[shown.id].y - R } : { top: at[shown.id].y - R }) }}>
              <p className="flex items-start gap-2 font-semibold text-white"><span className="min-w-0 flex-1">{shown.code} · {shown.name}</span>{pinned && <button onClick={() => setPinned(null)} aria-label="Close" className="shrink-0 rounded p-0.5 text-[#8f99a8] hover:bg-white/10 hover:text-white"><Icon name="x" className="h-3 w-3" /></button>}</p>
              <p className="tabular-nums">{dates(shown.es, shown.ef)} · {shown.duration} days</p>
              {g.apart.has(shown.id) ? <p className="text-[#8f99a8]">Nothing links to this work, so code cannot say how far it can slip</p> : shown.critical ? <p className="font-medium text-[#ffb4b4]">No float</p> : <p>Float: {shown.float_days} days</p>}
              {(shown.after as string[]).some((a) => by[a]) && <><p className="mt-1 text-[10px] uppercase tracking-wide text-[#8f99a8]">After</p>{(shown.after as string[]).filter((a) => by[a]).map((a) => item(a, reasons[`${a}>${shown.id}`]))}</>}
              {next[shown.id].length > 0 && <><p className="mt-1 text-[10px] uppercase tracking-wide text-[#8f99a8]">Before</p>{next[shown.id].map((n) => item(n, reasons[`${shown.id}>${n}`]))}</>}
              {board && (
                <div className="mt-1.5 space-y-1 border-t border-white/10 pt-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-[#8f99a8]">On the Kanban board</p>
                  {!here ? <p className="text-[#8f99a8]">Not on the board.</p> : here.card ? (
                    pinned ? (
                      <span className="flex flex-wrap gap-1" role="group" aria-label="Move it on the board">
                        {MOVES.map((s) => <button key={s} disabled={!!busy || here.status === s} onClick={() => void move(here.card, s)} aria-pressed={here.status === s}
                          className={`rounded border px-1.5 py-0.5 text-[11px] ${here.status === s ? "text-white" : "border-white/15 text-[#d3d8de] hover:bg-white/5"}`} style={here.status === s ? { borderColor: STATUS[s].color, background: STATUS[s].fill } : undefined}>{busy === s ? "Moving…" : STATUS[s].label}</button>)}
                      </span>
                    ) : <p style={{ color: STATUS[here.status]?.color }}>{STATUS[here.status]?.label ?? here.status}. Click to change it.</p>
                  ) : <p><span style={{ color: STATUS[here.status]?.color }}>{STATUS[here.status]?.label}</span>: {here.done} of {here.tasks} tasks done{here.doing ? `, ${here.doing} under way` : ""}. Its tasks are moved one by one on the board, where its hold points stop what follows.</p>}
                  {here?.stopped && <p className="text-[#ffb4b4]">Stopped by a rule on the board.</p>}
                  {!here?.stopped && !refused && here?.card && (here.blockers as Rec[]).length > 0 && <p className="text-[#fbd38d]">{(here.blockers as Rec[])[0].text}</p>}
                  {refused && <p role="alert" className="rounded bg-[#e5484d]/15 px-1.5 py-1 text-[#ffb4b4]">{refused}</p>}
                  {pinned && <span className="flex gap-2 pt-0.5">{onBoard && <button onClick={() => onBoard(shown.code)} className="text-[#9cc7f5] hover:underline">Open on the board</button>}{onOpen && <button onClick={() => onOpen(shown.code)} className="text-[#9cc7f5] hover:underline">Open in the WBS</button>}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
