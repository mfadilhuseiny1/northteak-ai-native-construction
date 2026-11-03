"use client";
import { useMemo, useState, type ReactNode } from "react";
import { num, type Rec } from "./kit";

/* The tasks' dependency network, the logic the critical path is worked out from: each section a line running down from the top, the assembly section on the right, and each other section joining it just above the task that needs it. It adds no facts: every task and link is the plan's. */

const R = 17, ROW = 58, COL = 196, LABEL = 132, LANE = 10, JOIN = 12, TOP = 56, SIDE = 160, BOW = R + 10;
const LINE = "#8f99a8", SYMBOL = "#abb3bf", CRITICAL = "#fab219", HOLD = "#e5484d", SHEET = "#111820";
const HALO = { stroke: SHEET, strokeWidth: 3, strokeLinejoin: "round" as const, style: { paintOrder: "stroke" as const } };  // keeps text readable where a line passes behind it

function drawing(plan: Rec) {
  const steps = [...(plan.steps as Rec[])].sort((a, b) => a.seq - b.seq);
  const sections = plan.sections as Rec[];
  const by: Record<string, Rec> = Object.fromEntries(steps.map((s) => [s.id, s]));
  const before = (s: Rec) => (s.after as string[]).filter((a) => by[a]);
  const next: Record<string, string[]> = {};
  steps.forEach((s) => before(s).forEach((a) => { (next[a] ??= []).push(s.id); }));

  // the assembly section carries straight on from the section that starts it, and the others join it from the left
  const stem = sections.at(-1)?.id as string;
  const mine = (section: string) => steps.filter((s) => s.section === section);
  const opening = mine(stem)[0] as Rec | undefined;
  const carried = opening && before(opening).map((a) => by[a]).find((p) => p.section !== stem && mine(p.section).at(-1)?.id === p.id && next[p.id].length === 1);
  const last = (carried?.section ?? stem) as string;
  const lane = (s: Rec) => (s.section === stem ? last : s.section) as string;

  // down the sheet: below what a task waits for and what is above it in its column, with room for each extra section joining there
  const y: Record<string, number> = {}, lowest: Record<string, number> = {};
  for (const s of steps) {
    const placed = before(s).filter((a) => y[a] !== undefined);
    const joining = placed.filter((a) => lane(by[a]) !== lane(s)).length;
    y[s.id] = Math.max(lowest[lane(s)] ?? TOP - ROW, ...placed.map((a) => y[a])) + ROW + Math.max(0, joining - 1) * LANE;
    lowest[lane(s)] = y[s.id];
  }

  // across the sheet: the later a section joins, the further left it sits, so its line passes under the others instead of through them
  const joinsAt = (l: string) => Math.max(0, ...steps.filter((s) => lane(s) === l).flatMap((s) => (next[s.id] ?? []).filter((n) => lane(by[n]) !== l).map((n) => y[n])));
  const place = (l: string) => sections.findIndex((s) => s.id === l);
  const lanes = [...new Set(steps.map(lane))].filter((l) => l !== last).sort((a, b) => joinsAt(b) - joinsAt(a) || place(b) - place(a));
  if (steps.some((s) => lane(s) === last)) lanes.push(last);
  const x: Record<string, number> = Object.fromEntries(lanes.map((l, i) => [l, 8 + LABEL + R + i * COL]));
  const at: Record<string, { x: number; y: number }> = Object.fromEntries(steps.map((s) => [s.id, { x: x[lane(s)], y: y[s.id] }]));

  // a line that has to go round a step runs beside the column, each on its own track so two are never read as one
  const tracks: Record<number, number> = {};
  const track = (column: number) => { tracks[column] = (tracks[column] ?? -1) + 1; return column + BOW + tracks[column] * 7; };
  const lines = steps.flatMap((s) => {
    const q = at[s.id];
    const coming = before(s).filter((a) => at[a].x !== q.x && at[a].y < q.y).sort((a, b) => at[a].x - at[b].x);
    const links = before(s).map((a) => {
      const p = at[a], key = `${a}-${s.id}`, hot = Boolean(by[a].critical && s.critical);
      const blocked = (end: number) => steps.some((o) => at[o.id].x === p.x && at[o.id].y > p.y && at[o.id].y < end);
      if (p.y >= q.y) return { key, hot: false, loop: true, d: `M${p.x} ${p.y}H${track(Math.max(p.x, q.x))}V${q.y}H${q.x}` };
      if (p.x === q.x) return { key, hot, loop: false, d: blocked(q.y) ? `M${p.x} ${p.y}H${track(p.x)}V${q.y}H${q.x}` : `M${p.x} ${p.y}V${q.y}` };
      const join = q.y - R - JOIN - coming.indexOf(a) * LANE;
      return { key, hot, loop: false, d: `M${p.x} ${p.y}${blocked(join + R) ? `H${track(p.x)}` : ""}V${join}H${q.x}V${q.y}` };
    });
    return before(s).length ? links : [{ key: `in-${s.id}`, hot: Boolean(s.critical), loop: false, d: `M${q.x - 16} ${q.y - R - JOIN}H${q.x}V${q.y}` }];
  }).sort((a, b) => Number(a.hot) - Number(b.hot));

  const heads = lanes.filter((l) => l !== stem).map((l) => ({ x: x[l], name: sections.find((s) => s.id === l)?.name as string }));
  const stemTitle = opening && { x: at[opening.id].x + R + 12, y: at[opening.id].y, name: sections.at(-1)?.name as string };
  return { steps, at, lines, heads, stemTitle, width: (x[last] ?? 8 + LABEL + R) + R + SIDE, height: Math.max(TOP, ...Object.values(y)) + R + 16 };
}

/** The name in lines short enough to sit left of its symbol. The whole name is in the tooltip and the table. */
function wrap(text: string, width = 24, most = 3): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.length > most ? [...out.slice(0, most - 1), `${out[most - 1]}…`] : out;
}

/** Circle: operation. Square: inspection. Arrow: handling. */
function Outline({ kind, x, y, r, stroke, width = 1.5 }: { kind: string; x: number; y: number; r: number; stroke: string; width?: number }) {
  const paint = { fill: SHEET, stroke, strokeWidth: width };
  if (kind === "inspection") return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...paint} />;
  if (kind === "handling") return <polygon points={[[-1.3, -0.65], [0.35, -0.65], [0.35, -1], [1.3, 0], [0.35, 1], [0.35, 0.65], [-1.3, 0.65]].map(([a, b]) => `${x + a * r},${y + b * r}`).join(" ")} {...paint} strokeLinejoin="round" />;
  return <circle cx={x} cy={y} r={r} {...paint} />;
}

function Step({ s, x, y, onShow, onHide }: { s: Rec; x: number; y: number; onShow: () => void; onHide: () => void }) {
  const lines = wrap(s.name);
  const rows = lines.length + (s.hold_point ? 1 : 0);
  const reach = s.kind === "handling" ? 22 : R;
  return (
    <g tabIndex={0} aria-label={`${s.id}, ${s.kind}: ${s.name}`} className="group cursor-default outline-none" onMouseEnter={onShow} onFocus={onShow} onBlur={onHide}>
      <rect x={x - reach - LABEL - 6} y={y - R - 4} width={LABEL + reach * 2 + 12} height={R * 2 + 8} rx={3} className="fill-transparent group-hover:fill-white/[.05] group-focus:fill-white/[.05]" />
      <Outline kind={s.kind} x={x} y={y} r={R} stroke={s.hold_point ? HOLD : s.critical ? CRITICAL : SYMBOL} width={s.hold_point ? 2 : 1.5} />
      <text x={s.kind === "handling" ? x - 4 : x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="#ffffff">{s.id}</text>
      <text x={x - reach - 6} y={y - ((rows - 1) * 13) / 2} textAnchor="end" dominantBaseline="central" fontSize={11} fill="#e5e8eb" {...HALO}>
        {lines.map((l, i) => <tspan key={i} x={x - reach - 6} dy={i ? 13 : 0}>{l}</tspan>)}
        {s.hold_point && <tspan x={x - reach - 6} dy={lines.length ? 13 : 0} fill="#ffb4b4" fontWeight={600}>Hold point</tspan>}
      </text>
    </g>
  );
}

function Tip({ s, x, y, width, height }: { s: Rec; x: number; y: number; width: number; height: number }) {
  const crew = (s.crew as Rec[]).map((c) => `${c.count} ${c.role}`).join(", ");
  const place = y > height - 150 ? { bottom: height - y - R } : { top: y - R };
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 w-[240px] rounded border border-white/15 bg-[#151e28] p-2 text-[11px] leading-snug text-[#d3d8de] shadow-lg" style={{ left: x + R + 262 > width ? x - R - 252 : x + R + 12, ...place }}>
      <p className="font-semibold text-white">{s.id} · {s.name}</p>
      {s.hold_point && <p className="font-medium text-[#ffb4b4]">Hold point{s.itp ? ` ${s.itp}` : ""}: work stops until signed</p>}
      {crew && <p className="mt-1">{crew}</p>}
      <p className="text-[#abb3bf]">{num(s.hours)} {s.hours === 1 ? "hour" : "hours"} · {num(s.man_hours)} {s.man_hours === 1 ? "man-hour" : "man-hours"}{s.wait_days ? ` · then wait ${s.wait_days} ${s.wait_days === 1 ? "day" : "days"}` : ""}</p>
      {(s.materials as Rec[]).map((m) => <p key={m.key} className="mt-0.5">{m.name}: {num(m.gross)} {m.unit}{m.waste ? <span className="text-[#fbd38d]"> (waste {num(m.waste)})</span> : null}</p>)}
    </div>
  );
}

function Key({ kind, stroke = SYMBOL, children }: { kind: string; stroke?: string; children: ReactNode }) {
  return <span className="flex items-center gap-1.5"><svg width={20} height={16} aria-hidden="true"><Outline kind={kind} x={10} y={8} r={6.5} stroke={stroke} /></svg>{children}</span>;
}

export function NetworkSheet({ plan }: { plan: Rec }) {
  const { steps, at, lines, heads, stemTitle, width, height } = useMemo(() => drawing(plan), [plan]);
  const [hover, setHover] = useState<string | null>(null);
  const shown = steps.find((s) => s.id === hover);
  const count = (kind: string, hold = false) => steps.filter((s) => s.kind === kind && Boolean(s.hold_point) === hold).length;
  return (
    <div className="my-2 rounded border border-white/10 bg-[#111820]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/5 px-3 py-2 text-[10.5px] text-[#abb3bf]">
        <Key kind="operation">Operation ({count("operation")})</Key>
        <Key kind="inspection">Inspection ({count("inspection")})</Key>
        {count("inspection", true) > 0 && <Key kind="inspection" stroke={HOLD}>Hold point: work stops until signed ({count("inspection", true)})</Key>}
        <Key kind="handling">Material handling ({count("handling")})</Key>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-[#fab219]" />Critical path</span>
        {lines.some((l) => l.loop) && <span className="flex items-center gap-1.5"><i className="w-4 border-t border-dashed border-[#e5484d]" />A loop: see what code checked</span>}
        <span className="ml-auto text-[#8f99a8]">Hover a task for its crew, hours and material</span>
      </div>
      <div className="overflow-x-auto px-3 py-2">
        <div className="relative mx-auto" style={{ width, height }} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={height} role="group" aria-label={`Dependency network, ${steps.length} tasks.`}>
            {heads.map((h) => <text key={h.name} x={h.x - 8} y={TOP - R - JOIN - 8} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#ffffff">{h.name}</text>)}
            {lines.map((l) => <path key={l.key} d={l.d} fill="none" stroke={l.loop ? HOLD : l.hot ? CRITICAL : LINE} strokeWidth={l.hot ? 2 : 1.25} strokeDasharray={l.loop ? "4 3" : undefined} />)}
            {stemTitle && <text x={stemTitle.x} y={stemTitle.y - 7} fontSize={11.5} fontWeight={600} fill="#ffffff" {...HALO}>{stemTitle.name}<tspan x={stemTitle.x} dy={14} fontSize={10.5} fontWeight={400} fill="#8f99a8">assembly</tspan></text>}
            {steps.map((s) => <Step key={s.id} s={s} {...at[s.id]} onShow={() => setHover(s.id)} onHide={() => setHover(null)} />)}
          </svg>
          {shown && <Tip s={shown} {...at[shown.id]} width={width} height={height} />}
        </div>
      </div>
    </div>
  );
}
