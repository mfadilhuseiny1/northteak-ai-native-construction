"use client";
import { useMemo, useState } from "react";
import { dates, type Rec } from "./kit";

/* The critical path as a network, activity on node: a circle for each work package and an arrow for each link, from Start to End. Each column is one link deeper than the last, and the chain that holds the finish date runs straight along the middle in red. It adds no facts: the dates, the float and the links are the ones code worked out. */

const CW = 112, RH = 66, PADX = 46, PADT = 40, PADB = 44, R = 17, RE = 8, BEND = 0.62;
const LINE = "#8f99a8", CRIT = "#e5484d", NODE = "#29a383", SHEET = "#161a1f";
const HALO = { stroke: SHEET, strokeWidth: 3, strokeLinejoin: "round" as const, style: { paintOrder: "stroke" as const } };  // keeps a label readable where a line passes behind it

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

export function CpmNetwork({ rows, path, reasons = {}, onOpen }: { rows: Rec[]; path: Rec[]; reasons?: Record<string, string>; onOpen?: (code: string) => void }) {
  const g = useMemo(() => (rows.length ? layout(rows, path) : null), [rows, path]);
  const [hover, setHover] = useState<string | null>(null);
  if (!g) return null;
  const { by, next, at, edges, width, height } = g;
  const shown = hover ? by[hover] : null;
  const item = (id: string, why?: string) => <p key={id}>{by[id].code} {by[id].name}{why && <span className="text-[#8f99a8]"> ({why})</span>}</p>;
  return (
    <div className="my-2 rounded border border-white/10 bg-[#161a1f]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/5 px-3 py-2 text-[10.5px] text-[#abb3bf]">
        <span className="flex items-center gap-1.5"><svg width={26} height={10} aria-hidden="true"><path d="M0 5H19" stroke={CRIT} strokeWidth={2.2} /><path d="M19 1L26 5L19 9Z" fill={CRIT} /></svg>The chain that holds the finish date</span>
        <span className="flex items-center gap-1.5"><svg width={16} height={16} aria-hidden="true"><circle cx={8} cy={8} r={6} fill="#29a3832e" stroke={CRIT} strokeWidth={2.2} /></svg>No float</span>
        <span className="ml-auto text-[#8f99a8]">Hover a circle for its dates and links{onOpen ? ". Click it to open the work package" : ""}</span>
      </div>
      <div className="overflow-x-auto px-3 py-2">
        <div className="relative mx-auto" style={{ width, height }} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={height} role="group" aria-label={`Critical path network, ${rows.length} work packages from Start to End.`}>
            <defs>
              {[["cpm-n", LINE], ["cpm-c", CRIT]].map(([id, fill]) => <marker key={id} id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill={fill} /></marker>)}
            </defs>
            {edges.map((e) => {
              const lit = hover && (e.from === hover || e.to === hover);
              return <path key={e.key} d={e.d} fill="none" stroke={e.hot ? CRIT : LINE} strokeWidth={e.hot ? 2.2 : lit ? 2 : 1.2} opacity={hover && !lit ? 0.15 : 1} markerEnd={`url(#${e.hot ? "cpm-c" : "cpm-n"})`} />;
            })}
            {(["START", "END"] as const).map((k) => <g key={k}><circle cx={at[k].x} cy={at[k].y} r={RE} fill="#d3d8de" /><text x={at[k].x} y={at[k].y - 15} textAnchor="middle" fontSize={12} fontWeight={600} fill="#9cc7f5">{k === "START" ? "Start" : "End"}</text></g>)}
            {rows.map((r) => {
              const p = at[r.id], zero = r.critical && !r.float_days, on = hover === r.id;
              return (
                <g key={r.id} tabIndex={0} role={onOpen ? "button" : undefined} aria-label={`${r.code} ${r.name}, ${r.duration} days, ${r.critical ? "no float" : `float ${r.float_days} days`}`} className={`outline-none ${onOpen ? "cursor-pointer" : "cursor-default"}`}
                  onMouseEnter={() => setHover(r.id)} onFocus={() => setHover(r.id)} onBlur={() => setHover(null)} onClick={() => onOpen?.(r.code)} onKeyDown={(e) => { if (e.key === "Enter") onOpen?.(r.code); }}>
                  <circle cx={p.x} cy={p.y} r={R} fill="#29a3832e" stroke={on ? "#ffffff" : zero ? CRIT : NODE} strokeWidth={on ? 2.6 : zero ? 2.4 : 1.3} />
                  <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={9.5} fontWeight={600} fill="#ffffff" className="font-mono">{r.code}</text>
                  <text x={p.x} y={p.y - R - 5} textAnchor="middle" fontSize={10} fill="#8f99a8" {...HALO}>{r.duration} d</text>
                  <text x={p.x} y={p.y + R + 13} textAnchor="middle" fontSize={10.5} fill="#e5e8eb" {...HALO}>{label(String(r.name))}</text>
                </g>
              );
            })}
          </svg>
          {shown && (
            <div role="tooltip" className="pointer-events-none absolute z-10 w-[270px] rounded border border-white/15 bg-[#111418] p-2 text-[11px] leading-snug text-[#d3d8de] shadow-lg"
              style={{ left: at[shown.id].x + R + 282 > width ? at[shown.id].x - R - 282 : at[shown.id].x + R + 12, ...(at[shown.id].y > height - 170 ? { bottom: height - at[shown.id].y - R } : { top: at[shown.id].y - R }) }}>
              <p className="font-semibold text-white">{shown.code} · {shown.name}</p>
              <p className="tabular-nums">{dates(shown.es, shown.ef)} · {shown.duration} days</p>
              {g.apart.has(shown.id) ? <p className="text-[#8f99a8]">Nothing links to this work, so code cannot say how far it can slip</p> : shown.critical ? <p className="font-medium text-[#ffb4b4]">No float</p> : <p>Float: {shown.float_days} days</p>}
              {(shown.after as string[]).some((a) => by[a]) && <><p className="mt-1 text-[10px] uppercase tracking-wide text-[#8f99a8]">After</p>{(shown.after as string[]).filter((a) => by[a]).map((a) => item(a, reasons[`${a}>${shown.id}`]))}</>}
              {next[shown.id].length > 0 && <><p className="mt-1 text-[10px] uppercase tracking-wide text-[#8f99a8]">Before</p>{next[shown.id].map((n) => item(n, reasons[`${shown.id}>${n}`]))}</>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
