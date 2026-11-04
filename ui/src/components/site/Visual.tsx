"use client";
import type { ReactNode } from "react";
import { money } from "./kit";
import { PLAN } from "./ReportCharts";

/* The pieces a list of figures is drawn with instead of a table: a bar for how big, a strip for how a whole divides, a split bar for what a figure
   is made of, a mark either side of zero for a difference, and a span on a shared timeline. Groups take the eight categorical hues in a fixed
   order, checked for colour-blind readers on the dark panels; past eight they are grey, never a made-up hue. Every figure stays written beside
   its mark, so nothing is read from colour or length alone. */

export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const OTHER = "#8f99a8";
export const hue = (i: number) => SERIES[i] ?? OTHER;
export const hatch = (c: string) => `repeating-linear-gradient(45deg, ${c} 0 3px, transparent 3px 6px)`;
const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

export function Swatch({ color, hatched = false }: { color: string; hatched?: boolean }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: hatched ? hatch(color) : color, boxShadow: hatched ? `inset 0 0 0 1px ${color}` : undefined }} />;
}

export function Legend({ items }: { items: { label: string; color: string; hatched?: boolean }[] }) {
  return <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-normal text-[#8f99a8]">{items.map((x) => <span key={x.label} className="flex items-center gap-1.5"><Swatch color={x.color} hatched={x.hatched} />{x.label}</span>)}</span>;
}

/** How big, against the largest beside it. */
export function SizeBar({ value, max, color = PLAN, thick = false, title }: { value: number; max: number; color?: string; thick?: boolean; title?: string }) {
  return <div className={`w-full overflow-hidden rounded-full bg-white/[.06] ${thick ? "h-3" : "h-2"}`} title={title}><div className="h-full rounded-full" style={{ width: `${pct(value, max)}%`, minWidth: value > 0 ? 3 : 0, background: color }} /></div>;
}

/** How a whole divides: one strip, each part in its colour, named with its share beneath. A part opens what it stands for. */
export function ShareStrip({ parts, onPick }: { parts: { key: string; label: string; value: number; color: string }[]; onPick?: (key: string) => void }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0) || 1;
  return (
    <div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-md">
        {parts.filter((p) => p.value > 0).map((p) => <button key={p.key} type="button" title={`${p.label}: ${money(p.value)}, ${((p.value / total) * 100).toFixed(1)}%`} onClick={() => onPick?.(p.key)} className="h-full transition hover:brightness-125" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => <button key={p.key} type="button" onClick={() => onPick?.(p.key)} className="flex items-center gap-1.5 text-[11px] text-[#abb3bf] hover:text-white"><Swatch color={p.color} />{p.label}<b className="font-semibold tabular-nums text-white">{((p.value / total) * 100).toFixed(1)}%</b></button>)}
      </div>
    </div>
  );
}

/** What a figure is made of: its parts end to end on one bar, against the largest beside it. */
export function SplitBar({ parts, max, thick = false }: { parts: { label: string; value: number; color: string; hatched?: boolean }[]; max: number; thick?: boolean }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  return (
    <div className={`w-full overflow-hidden rounded-full bg-white/[.06] ${thick ? "h-3" : "h-2.5"}`} title={parts.filter((p) => p.value > 0).map((p) => `${p.label} ${money(p.value)}`).join(" · ")}>
      <div className="flex h-full gap-[2px]" style={{ width: `${pct(total, max)}%`, minWidth: total > 0 ? 3 : 0 }}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.hatched ? hatch(p.color) : p.color, boxShadow: p.hatched ? `inset 0 0 0 1px ${p.color}` : undefined }} />)}
      </div>
    </div>
  );
}

/** A difference from a reference, as a mark either side of zero, with the figure beside it: blue below, orange above. */
export function Diverge({ value, span = 10, loud = 5, title }: { value: number | null | undefined; span?: number; loud?: number; title?: string }) {
  if (value == null) return <span className="text-[11px] text-[#5c6b7a]">–</span>;
  const w = Math.min(50, (Math.abs(value) / span) * 50);
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className="relative h-2 w-14 shrink-0 rounded-full bg-white/[.06]">
        <span className="absolute -inset-y-0.5 left-1/2 w-px bg-white/35" />
        <span className="absolute inset-y-0 rounded-full" style={{ [value < 0 ? "right" : "left"]: "50%", width: `${w}%`, background: value < 0 ? SERIES[0] : SERIES[1] }} />
      </span>
      <span className={`whitespace-nowrap text-[11px] tabular-nums ${Math.abs(value) >= loud ? "font-semibold text-white" : "text-[#abb3bf]"}`}>{value > 0 ? "+" : value < 0 ? "−" : ""}{Math.abs(value)}%</span>
    </span>
  );
}

/** Done of a whole, with a tick where it should be by now. */
export function Progress({ done, planned, color = "#c08414" }: { done: number; planned?: number | null; color?: string }) {
  return (
    <span className="relative block h-1.5 w-full rounded-full bg-white/[.08]" title={`${done}% done${planned != null ? `, ${planned}% planned by today` : ""}`}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, done)}%`, background: color }} />
      {planned != null && <span className="absolute -inset-y-[3px] w-[2px] rounded" style={{ left: `calc(${Math.min(100, planned)}% - 1px)`, background: PLAN }} />}
    </span>
  );
}

/** When a piece of work runs, on a timeline every row shares, with today marked and how far it has got. */
export function Span({ start, finish, from, to, today, color = PLAN, progress, critical = false, slack }: { start: string; finish: string; from: string; to: string; today?: string; color?: string; progress?: number; critical?: boolean; slack?: string }) {
  const total = Math.max(1, Date.parse(to) - Date.parse(from));
  const at = (d: string) => Math.max(0, Math.min(100, ((Date.parse(d) - Date.parse(from)) / total) * 100));
  return (
    <span className="relative block h-3.5 w-full rounded-sm bg-white/[.03]" title={`${start} to ${finish}${slack ? `, can slip to ${slack}` : ""}`}>
      {today && today >= from && today <= to && <span className="absolute -inset-y-1 w-px bg-[#f5b82e]/60" style={{ left: `${at(today)}%` }} />}
      {slack && slack > finish && <span className="absolute inset-y-[3px] rounded-r-sm" style={{ left: `${at(finish)}%`, width: `${at(slack) - at(finish)}%`, background: hatch("#8f99a866") }} />}
      <span className="absolute inset-y-[3px] flex overflow-hidden rounded-sm" style={{ left: `${at(start)}%`, width: `max(3px, ${at(finish) - at(start)}%)`, background: `${color}55`, boxShadow: critical ? "inset 0 0 0 1.5px #f87171" : undefined }}>
        {progress != null && <span className="h-full" style={{ width: `${Math.min(100, progress)}%`, background: color }} />}
      </span>
    </span>
  );
}

/** A group of items in a card, its colour down the left edge, its figures on the right. */
export function Group({ id, color, code, title, sub, right, children, footer }: { id?: string; color?: string; code?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <section id={id} className="rise scroll-mt-3 overflow-hidden rounded-lg border border-white/10 bg-[#1c2733] shadow-[0_4px_16px_rgb(0_0_0/.25)]">
      <div className="flex items-center gap-3 border-b border-white/[.06] bg-white/[.02] px-3 py-2.5" style={color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-white">{code != null && <span className="mr-2 font-mono text-[10.5px] font-normal text-[#8f99a8]">{code}</span>}{title}</p>
          {sub && <p className="mt-0.5 text-[10.5px] text-[#8f99a8]">{sub}</p>}
        </div>
        {right}
      </div>
      {children && <div className="divide-y divide-white/[.04]">{children}</div>}
      {footer}
    </section>
  );
}

/** One item: its code, what it is with a line about it, the picture of its figure, and the figure. */
export function Item({ code, title, meta, visual, value, onClick, selected = false, wide = false }: { code?: ReactNode; title: ReactNode; meta?: ReactNode; visual?: ReactNode; value?: ReactNode; onClick?: () => void; selected?: boolean; wide?: boolean }) {
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      className={`grid items-center gap-x-3 gap-y-1 px-3 py-2 ${wide ? "grid-cols-[52px_minmax(0,1fr)_minmax(120px,38%)_auto]" : "grid-cols-[52px_minmax(0,1fr)_minmax(90px,30%)_auto]"} ${onClick ? "cursor-pointer outline-none hover:bg-white/[.04] focus-visible:bg-white/[.06]" : ""} ${selected ? "bg-white/[.07]" : ""}`}>
      <span className="truncate font-mono text-[10.5px] text-[#8f99a8]">{code}</span>
      <span className="min-w-0"><span className="block text-[12px] leading-snug text-[#e5e8eb]">{title}</span>{meta && <span className="mt-0.5 block text-[10.5px] leading-snug text-[#8f99a8]">{meta}</span>}</span>
      <span className="min-w-0">{visual}</span>
      <span className="whitespace-nowrap text-right text-[12px] tabular-nums text-white">{value}</span>
    </div>
  );
}
