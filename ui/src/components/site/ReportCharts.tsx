"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* The reports' charts, drawn from the records' own figures. Two series colours, checked for colour-blind readers on the dark panels and on white
   paper alike: the baseline in blue, what was actually done in amber. Status colours mean state only, and always come with a word. */

export const PLAN = "#3987e5";
export const ACTUAL = "#c08414";
export const STATE = { green: "#29a383", amber: "#fab219", red: "#f87171", none: "#8f99a8" } as const;
export const STATE_WORD = { green: "On track", amber: "Watch", red: "At risk", none: "Not planned yet" } as const;

type Pt = [string, number];
type Ink = { text: string; muted: string; grid: string; surface: string; tip: string; tipText: string };
const DARK: Ink = { text: "#e5e8eb", muted: "#8f99a8", grid: "#ffffff14", surface: "#1c2733", tip: "#0d131a", tipText: "#e5e8eb" };
const LIGHT: Ink = { text: "#1f2933", muted: "#6b7684", grid: "#e4e7eb", surface: "#ffffff", tip: "#1f2933", tipText: "#ffffff" };

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
export const compact = (n: number) => { const a = Math.abs(n); return a >= 1e12 ? `${(n / 1e12).toFixed(1)} tn` : a >= 1e9 ? `${(n / 1e9).toFixed(1)} bn` : a >= 1e6 ? `${Math.round(n / 1e6)} m` : `${Math.round(n / 1e3)} k`; };
const monthName = (d: string, year = false) => new Date(ms(d)).toLocaleString("en-US", { month: "short", timeZone: "UTC", ...(year ? { year: "2-digit" } : {}) });

function at(points: Pt[], d: string): number | null {
  const t = ms(d);
  if (!points.length || t < ms(points[0][0]) || t > ms(points[points.length - 1][0])) return null;
  for (let i = 1; i < points.length; i++) {
    const [a, va] = points[i - 1], [b, vb] = points[i];
    if (t <= ms(b)) return va + ((vb - va) * (t - ms(a))) / Math.max(1, ms(b) - ms(a));
  }
  return points[points.length - 1][1];
}

/** A chart drawn at the width it is given, so its text stays at its own size in a wide card and on a narrow page alike. */
function useWidth(fallback = 600) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seen = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return [ref, width] as const;
}

function Tip({ x, y, children, ink }: { x: number; y: number; children: ReactNode; ink: Ink }) {
  return <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] shadow-lg" style={{ left: x, top: y - 8, background: ink.tip, color: ink.tipText }}>{children}</div>;
}

function Key({ color, label, ink }: { color: string; label: string; ink: Ink }) {
  return <span className="flex items-center gap-1.5 text-[11px]" style={{ color: ink.muted }}><span className="h-[2px] w-4 rounded" style={{ background: color }} />{label}</span>;
}

/** Progress against the baseline: the plan's S-curve, and the months actually reached, to today. */
export function SCurve({ planned, actual, today, light = false, height = 210 }: { planned: Pt[]; actual: Pt[]; today: string; light?: boolean; height?: number }) {
  const ink = light ? LIGHT : DARK;
  const [box, W] = useWidth();
  const [hover, setHover] = useState<{ d: string; px: number; vx: number } | null>(null);
  if (planned.length < 2) return <div ref={box} />;
  const H = height, L = 34, R = 44, T = 14, B = 24;
  const x0 = ms(planned[0][0]), x1 = ms(planned[planned.length - 1][0]);
  const X = (d: string) => L + ((ms(d) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const line = (pts: Pt[]) => pts.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const ticks = planned.slice(1, -1).filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 6)) === 0);
  const last = actual[actual.length - 1];
  const move = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const t = x0 + ((Math.min(W - R, Math.max(L, vx)) - L) / (W - L - R)) * (x1 - x0);
    const snap = [...planned.map((p) => p[0]), ...actual.map((p) => p[0])].reduce((best, d) => (Math.abs(ms(d) - t) < Math.abs(ms(best) - t) ? d : best), planned[0][0]);
    setHover({ d: snap, px: (X(snap) / W) * r.width, vx: X(snap) });
  };
  const hp = hover ? at(planned, hover.d) : null, ha = hover ? at(actual, hover.d) : null;
  return (
    <div>
      <div className="mb-1 flex gap-4"><Key color={PLAN} label="Planned, the baseline" ink={ink} /><Key color={ACTUAL} label="Actually done" ink={ink} /></div>
      <div ref={box} className="relative" onPointerMove={move} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`S-curve: ${last ? `${last[1]}% done on ${last[0]}` : "nothing done yet"}, against the baseline`}>
          {[0, 50, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke={ink.grid} /><text x={L - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" fill={ink.muted}>{v}%</text></g>)}
          {ticks.map(([d]) => <text key={d} x={X(d)} y={H - 6} textAnchor="middle" fontSize="10" fill={ink.muted}>{monthName(d, d.slice(5, 7) === "01" || d === ticks[0][0])}</text>)}
          {ms(today) >= x0 && ms(today) <= x1 && <g><line x1={X(today)} x2={X(today)} y1={T} y2={H - B} stroke={ink.muted} strokeOpacity=".6" /><text x={X(today) + 4} y={T + 9} fontSize="9.5" fill={ink.muted}>today</text></g>}
          <path d={`${line(planned)}L${X(planned[planned.length - 1][0])},${Y(0)}L${X(planned[0][0])},${Y(0)}Z`} fill={PLAN} fillOpacity=".08" />
          <path d={line(planned)} fill="none" stroke={PLAN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {actual.length > 1 && <path d={line(actual)} fill="none" stroke={ACTUAL} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {last && <><circle cx={X(last[0])} cy={Y(last[1])} r="5" fill={ACTUAL} stroke={ink.surface} strokeWidth="2" /><text x={X(last[0]) + 9} y={Y(last[1]) + 4} fontSize="11" fontWeight="700" fill={ink.text}>{Math.round(last[1])}%</text></>}
          {hover && <line x1={hover.vx} x2={hover.vx} y1={T} y2={H - B} stroke={ink.text} strokeOpacity=".35" />}
        </svg>
        {hover && (
          <Tip x={hover.px} y={8} ink={ink}>
            <div className="mb-0.5 opacity-70">{hover.d}</div>
            {hp != null && <div className="flex items-center gap-1.5"><span className="h-[2px] w-3" style={{ background: PLAN }} /><b>{hp.toFixed(1)}%</b> planned</div>}
            {ha != null && <div className="flex items-center gap-1.5"><span className="h-[2px] w-3" style={{ background: ACTUAL }} /><b>{ha.toFixed(1)}%</b> done</div>}
          </Tip>
        )}
      </div>
    </div>
  );
}

/** Money the forecast programme spends, quarter by quarter: what has to be funded, and when. */
export function CashBars({ rows, light = false, height = 170 }: { rows: { name: string; spend: number }[]; light?: boolean; height?: number }) {
  const ink = light ? LIGHT : DARK;
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth();
  if (!rows.length) return <div ref={box} />;
  const H = height, T = 18, B = 22, max = Math.max(...rows.map((r) => r.spend), 1);
  const slot = W / rows.length, bw = Math.min(24, slot * 0.5);
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Spend by quarter">
        <line x1="0" x2={W} y1={H - B} y2={H - B} stroke={ink.grid} />
        {rows.map((r, i) => {
          const cx = slot * i + slot / 2, y = Y(r.spend), h = H - B - y;
          return (
            <g key={r.name} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} style={{ outline: "none" }}>
              <rect x={slot * i} y={T - 14} width={slot} height={H - T + 14} fill="transparent" />
              {h > 0 && <path d={`M${cx - bw / 2},${H - B}V${y + Math.min(4, h)}q0,-4 4,-4h${bw - 8}q4,0 4,4V${H - B}Z`} fill={PLAN} fillOpacity={hover === i ? 1 : 0.85} />}
              <text x={cx} y={y - 5} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={ink.text}>{r.spend ? compact(r.spend) : "–"}</text>
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill={ink.muted}>{r.name}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && box.current && <Tip x={((slot * hover + slot / 2) / W) * box.current.getBoundingClientRect().width} y={(Y(rows[hover].spend) / H) * box.current.getBoundingClientRect().height} ink={ink}><b>Rp {rows[hover].spend.toLocaleString("en-US")}</b> <span className="opacity-70">in {rows[hover].name}</span></Tip>}
    </div>
  );
}

export type Step = { label: string; from?: number; to: number; color: string; hatch?: boolean; value: string; note?: string };

/** Horizontal bars on one money axis: a bar can start where another ends, so a waterfall reads as steps. */
export function Steps({ rows, light = false }: { rows: Step[]; light?: boolean }) {
  const ink = light ? LIGHT : DARK;
  const max = Math.max(...rows.map((r) => Math.max(r.to, r.from ?? 0)), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const lo = Math.min(r.from ?? 0, r.to), hi = Math.max(r.from ?? 0, r.to);
        return (
          <div key={r.label} title={r.note || `${r.label}: ${r.value}`}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]"><span style={{ color: ink.muted }}>{r.label}</span><b className="tabular-nums" style={{ color: ink.text }}>{r.value}</b></div>
            <div className="relative h-3 rounded-sm" style={{ background: ink.grid }}>
              <div className="absolute inset-y-0 rounded-[3px]" style={{ left: `${(lo / max) * 100}%`, width: hi > lo ? `max(3px, ${((hi - lo) / max) * 100}%)` : 0, background: r.hatch ? `repeating-linear-gradient(45deg, ${r.color} 0 3px, transparent 3px 6px)` : r.color, boxShadow: r.hatch ? `inset 0 0 0 1px ${r.color}` : undefined }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** How much of something is gone and how much is left, with the line it must not cross. */
export function Meter({ used, total, light = false, color = ACTUAL }: { used: number; total: number; light?: boolean; color?: string }) {
  const ink = light ? LIGHT : DARK;
  const over = used > total, share = total ? Math.min(1, used / total) : 0;
  return (
    <div className="relative h-3 overflow-hidden rounded-full" style={{ background: ink.grid }} role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used}>
      <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: over ? STATE.red : color }} />
    </div>
  );
}

/** The milestones on one line from start to finish: where the contract puts each, and where the forecast does. */
export function Milestones({ start, end, today, rows, light = false }: { start: string; end: string; today: string; rows: { id: string; name: string; contract_date: string; forecast: string; days_late: number }[]; light?: boolean }) {
  const ink = light ? LIGHT : DARK;
  const [hover, setHover] = useState<number | null>(null);
  const last = [end, ...rows.map((m) => m.forecast), ...rows.map((m) => m.contract_date)].reduce((a, b) => (b > a ? b : a), end);
  const pct = (d: string) => Math.max(0, Math.min(100, ((ms(d) - ms(start)) / Math.max(1, ms(last) - ms(start))) * 100));
  const marks: string[] = [];
  for (let t = ms(`${start.slice(0, 7)}-01`); t <= ms(last); ) { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + 1); t = d.getTime(); if (t <= ms(last)) marks.push(day(t)); }
  const step = Math.max(1, Math.ceil(marks.length / 6));
  return (
    <div className="px-2 pt-7">
      <div className="relative h-[3px] rounded" style={{ background: ink.grid }}>
        <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${pct(today)}%`, background: ink.muted, opacity: 0.5 }} />
        {ms(today) <= ms(last) && <div className="absolute -top-5 -translate-x-1/2 text-[9.5px]" style={{ left: `${pct(today)}%`, color: ink.muted }}>today<div className="mx-auto mt-0.5 h-[18px] w-px" style={{ background: ink.muted }} /></div>}
        {marks.filter((_, i) => i % step === 0).map((d) => <span key={d} className="absolute top-3 -translate-x-1/2 text-[9.5px]" style={{ left: `${pct(d)}%`, color: ink.muted }}>{monthName(d, d.slice(5, 7) === "01")}</span>)}
        {rows.map((m, i) => {
          const late = m.days_late > 0;
          const show = { onPointerEnter: () => setHover(i), onPointerLeave: () => setHover(null), onFocus: () => setHover(i), onBlur: () => setHover(null), tabIndex: 0 };
          return (
            <div key={m.id}>
              {late && <div className="absolute top-0 h-[3px]" style={{ left: `${pct(m.contract_date)}%`, width: `${pct(m.forecast) - pct(m.contract_date)}%`, background: STATE.red }} />}
              <div {...show} aria-label={`${m.name}: contract ${m.contract_date}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] outline-none" style={{ left: `${pct(m.contract_date)}%`, boxShadow: `inset 0 0 0 2px ${ink.text}`, background: ink.surface }} />
              <div {...show} aria-label={`${m.name}: forecast ${m.forecast}${late ? `, ${m.days_late} days late` : ""}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] outline-none" style={{ left: `${pct(m.forecast)}%`, background: late ? STATE.red : ACTUAL, boxShadow: `0 0 0 2px ${ink.surface}` }} />
              {hover === i && <div className="pointer-events-none absolute bottom-3 z-10 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] shadow-lg" style={{ left: `${Math.min(88, Math.max(12, pct(m.forecast)))}%`, background: ink.tip, color: ink.tipText }}><div className="font-semibold">{m.name}</div><div className="opacity-80">contract {m.contract_date} · forecast {m.forecast}</div><div>{late ? `${m.days_late} days late` : "on time"}</div></div>}
            </div>
          );
        })}
      </div>
      <div className="mt-8 flex flex-wrap gap-3 text-[10px]" style={{ color: ink.muted }}>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rotate-45 rounded-[1px]" style={{ boxShadow: `inset 0 0 0 1.5px ${ink.text}` }} />contract date</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rotate-45 rounded-[1px]" style={{ background: ACTUAL }} />forecast</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rotate-45 rounded-[1px]" style={{ background: STATE.red }} />forecast, late</span>
      </div>
    </div>
  );
}

/** Progress as a ring: done in amber, with a tick where the baseline says it should be. */
export function Ring({ done, planned, size = 76, light = false }: { done: number; planned: number | null; size?: number; light?: boolean }) {
  const ink = light ? LIGHT : DARK;
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  const angle = ((planned ?? 0) / 100) * 2 * Math.PI - Math.PI / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(done)}% done${planned != null ? `, ${Math.round(planned)}% planned` : ""}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ink.grid} strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ACTUAL} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(Math.min(100, done) / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {planned != null && <line x1={size / 2 + (r - 6) * Math.cos(angle)} y1={size / 2 + (r - 6) * Math.sin(angle)} x2={size / 2 + (r + 6) * Math.cos(angle)} y2={size / 2 + (r + 6) * Math.sin(angle)} stroke={PLAN} strokeWidth="2.5" strokeLinecap="round" />}
      <text x="50%" y="50%" dy="1" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.22} fontWeight="700" fill={ink.text}>{Math.round(done)}%</text>
    </svg>
  );
}
