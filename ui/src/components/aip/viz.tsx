"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Rec } from "./aipRun";

/* Charts and cell formatting of SiteSwarm's dynamic screen, drawn natively (SVG) on the app's dark surface. Specs from the
   data-viz method: thin marks with 4px rounded data ends, a 2px surface gap, hairline grid, a hover tooltip on every
   mark, a table view for every chart, the categorical palette validated on #1c2127 (blue, orange, aqua, yellow,
   magenta, green: all checks pass), one hue for magnitude, emphasis (the entity the answer is about) over rainbow. */

export const SURFACE = "#1c2127";
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const MUTED_MARK = "#4b5866"; // the rest, when one entity is emphasised
export const GRID = "#2c333b";
export const AXIS = "#8f99a8";
export const STATUS = { kritis: "#d03b3b", tinggi: "#ec835a", sedang: "#fab219", info: "#3987e5" } as const;

// ------------------------------------------------------------------------------------------------ formatting

const CODE_COL = /(^|_)(code|id|key|no)(_|$)|_id$|^id$/i;
const MONEY_COL = /cost|rate|rupiah|billed|paid|amount|price|loss/i;
const PCT_COL = /(^|_)(pct|percent|percentage|share)(_|$)/i;
const HASH = /^[0-9a-f]{24,}$/i;

export const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && /^-?[\d.]+(e-?\d+)?$/i.test(v.trim()) ? Number(v) : null;

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toLocaleString("en-US", { maximumFractionDigits: 1 })} T`;
  if (a >= 1e9) return `${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })} B`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e4) return `${(n / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })} k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: a < 10 ? 2 : 1 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A cell as a reviewer reads it: codes as codes (district_code 3213, not 3,213), money in Rp, dates, yes/no, short hashes. */
export function fmtCell(v: unknown, col: string, type?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean" || v === "true" || v === "false") return v === true || v === "true" ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (type === "date" || (/^\d{4}-\d{2}-\d{2}/.test(s) && type !== "string")) {
    const d = new Date(s.slice(0, 10) + "T00:00:00");
    if (!isNaN(d.getTime())) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (/^\d{4}-\d{2}$/.test(s)) return `${MONTHS[Number(s.slice(5)) - 1] ?? s.slice(5)} ${s.slice(0, 4)}`;
  if (HASH.test(s)) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  const n = num(v);
  if (n === null || type === "string" || CODE_COL.test(col)) return s;
  if (MONEY_COL.test(col)) return `Rp ${compact(n)}`;
  if (PCT_COL.test(col)) return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  return Math.abs(n) >= 1e6 ? compact(n) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const HEADERS: Record<string, string> = {
  nama: "Name", group: "Group", value: "Value", count: "Count", _judul: "Title", _kunci: "Key", nama_profil: "Item profile",
  kabkota: "District", provinsi: "Province", readmisi_30: "30-day readmission", los_hari: "LOS (days)", skor_risiko: "Risk score",
  indikasi_utama: "Main signal", alasan_risiko: "Risk reason", tgl_datang: "Arrival date", tgl_pulang: "Departure date",
};
export const header = (c: string) => HEADERS[c] ?? (c.replace(/__nama$/, " (name)").replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase()));

/** The label a row is known by: its name when the run resolved one, else the column asked for. */
export function labelOf(r: Rec, col: string): string {
  const keyLike = col === "group" || CODE_COL.test(col) || HASH.test(String(r[col] ?? ""));
  const v = keyLike && r.nama ? r.nama : r[col];
  return v === undefined || v === null || v === "" ? "—" : fmtCell(v, col, "string");
}

// ------------------------------------------------------------------------------------------------ tooltip

export type Tip = { x: number; y: number; lines: { key?: string; value: string; label: string }[]; title?: string } | null;

export function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-20 min-w-[140px] max-w-[280px] rounded-md border border-white/10 bg-[#111418]/95 px-2.5 py-1.5 text-[11px] shadow-xl"
      style={{ left: tip.x + 12, top: tip.y + 12 }}>
      {tip.title && <p className="mb-1 truncate text-[#abb3bf]">{tip.title}</p>}
      {tip.lines.map((l, i) => (
        <p key={i} className="flex items-center gap-1.5">
          {l.key && <span className="h-[2px] w-3 shrink-0 rounded" style={{ background: l.key }} />}
          <span className="font-semibold tabular-nums text-white">{l.value}</span>
          <span className="truncate text-[#abb3bf]">{l.label}</span>
        </p>
      ))}
    </div>
  );
}

export function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const at = (e: React.PointerEvent | React.FocusEvent, t: Omit<NonNullable<Tip>, "x" | "y">) => {
    const r = box.current?.getBoundingClientRect();
    const target = (e.target as Element).getBoundingClientRect();
    const px = "clientX" in e ? e.clientX : target.left + target.width / 2;
    const py = "clientY" in e ? e.clientY : target.top;
    setTip({ ...t, x: px - (r?.left ?? 0), y: py - (r?.top ?? 0) });
  };
  return { box, tip, at, clear: () => setTip(null) };
}

// ------------------------------------------------------------------------------------------------ ranked bars

/** onPick: a bar is a way into its row (the review drill-down) */
export function BarRank({ rows, label, value, highlight = [], max = 12, onPick }: { rows: Rec[]; label: string; value: string; highlight?: string[]; max?: number;
  onPick?: (row: Rec) => void }) {
  const { box, tip, at, clear } = useTip();
  const data = useMemo(() => rows.map((r) => ({ label: labelOf(r, label), v: num(r[value]) ?? 0, row: r })).sort((a, b) => b.v - a.v), [rows, label, value]);
  const total = data.reduce((s, d) => s + d.v, 0);
  const shown = data.slice(0, max);
  const top = Math.max(1e-9, ...shown.map((d) => d.v));
  const hl = new Set(highlight.map((h) => h.toLowerCase()));
  const emphasis = shown.some((d) => hl.has(d.label.toLowerCase()) || [...hl].some((h) => d.label.toLowerCase().includes(h)));
  // names that share their leading parts ("Project · Tower A · …"): the shared part once above, the distinct part per bar
  const parts = shown.map((d) => d.label.split(" · "));
  let k = 0;
  while (parts.length > 1 && parts.every((p) => p.length > k + 1 && p[k] === parts[0][k])) k++;
  const shared = k ? parts[0].slice(0, k).join(" · ") : "";
  const short = (i: number) => (k ? parts[i].slice(k).join(" · ") : shown[i].label);
  const stacked = shown.some((_, i) => short(i).length > 26); // long names on their own line, never cut before the part that differs
  const isOn = (d: { label: string }) => !emphasis || hl.has(d.label.toLowerCase()) || [...hl].some((h) => d.label.toLowerCase().includes(h));
  return (
    <div ref={box} className="relative" onPointerLeave={clear}>
      {shared && <p className="mb-2 text-[10.5px] text-[#8f99a8]">All: {shared}</p>}
      <div className={stacked ? "space-y-2" : "space-y-[6px]"}>
        {shown.map((d, i) => {
          const on = isOn(d);
          const name = <span className={`min-w-0 text-[11.5px] leading-snug ${on ? "text-[#e5e8eb]" : "text-[#abb3bf]"} ${emphasis && on ? "font-semibold" : ""}`} title={d.label}>{short(i)}</span>;
          const bar = (
            // stacked, the bar sits in a column: flex-1 there would take its height (basis 0) and hide it
            <span className={`relative flex h-[14px] min-w-0 items-center ${stacked ? "w-full shrink-0" : "flex-1"}`}>
              <span className="h-full rounded-r-[4px] transition-[filter] group-hover:brightness-125" style={{ width: `${Math.max(1.5, (100 * d.v) / top)}%`, background: on ? SERIES[0] : MUTED_MARK }} />
              <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-[#c5cbd3]">{compact(d.v)}</span>
            </span>
          );
          return (
            <div key={`${d.label}-${i}`} tabIndex={0} className={`group flex items-start gap-2 rounded outline-none focus-visible:ring-1 focus-visible:ring-[#3987e5] ${onPick ? "cursor-pointer hover:bg-white/[.04]" : ""}`}
              onClick={onPick ? () => onPick(d.row) : undefined} onKeyDown={onPick ? (e) => { if (e.key === "Enter") onPick(d.row); } : undefined}
              onPointerMove={(e) => at(e, { title: `#${i + 1} of ${data.length}`, lines: [{ value: compact(d.v), label: d.label }, ...(total ? [{ value: `${((100 * d.v) / total).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`, label: "of total" }] : [])] })}
              onFocus={(e) => at(e, { title: `#${i + 1} of ${data.length}`, lines: [{ value: compact(d.v), label: d.label }] })} onBlur={clear}>
              <span className="w-6 shrink-0 pt-px text-right text-[10px] tabular-nums text-[#8f99a8]">{i + 1}</span>
              {stacked ? (
                <span className="flex min-w-0 flex-1 flex-col gap-1">{name}{bar}</span>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-2"><span className="w-[36%] shrink-0 truncate">{name}</span>{bar}</span>
              )}
            </div>
          );
        })}
      </div>
      {data.length > shown.length && <p className="mt-2 text-[10.5px] text-[#8f99a8]">{shown.length} top of {data.length} · total {compact(total)}</p>}
      <Tooltip tip={tip} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ impact engine leaderboard

const pctNum = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3, minimumFractionDigits: 3 });
const METRIC_NAMES: Record<string, string> = {
  auprc: "AUPRC", auroc: "AUROC", f1: "F1", presisi: "Precision", recall: "Recall", akurasi: "Accuracy", akurasi_seimbang: "Balanced accuracy",
  lift_top_0_1pct: "Top 0.1% lift", presisi_top_0_1pct: "Top 0.1% precision", recall_top_1pct: "Top 1% recall", detik_latih: "Training seconds",
};

/** Techniques ranked by one metric: a thin bar to the mean, a whisker over the 95 % interval, reference rows muted. */
export function Leaderboard({ rows, label = "model", value = "auprc", highlight = [] }: { rows: Rec[]; label?: string; value?: string; highlight?: string[] }) {
  const { box, tip, at, clear } = useTip();
  const data = useMemo(() => rows.map((r) => {
    const ci = Array.isArray(r[`${value}_ci95`]) ? (r[`${value}_ci95`] as unknown[]).map((x) => num(x) ?? 0) : null;
    return { r, name: String(r[label] ?? "—"), v: num(r[value]) ?? 0, ci, ref: !!r.pembanding };
  }).sort((a, b) => b.v - a.v), [rows, label, value]);
  const top = Math.max(1e-9, ...data.map((d) => Math.max(d.v, d.ci?.[1] ?? 0)));
  const best = new Set(highlight.length ? highlight : data.filter((d) => !d.ref).slice(0, 1).map((d) => d.name));
  const extra = ["auroc", "f1", "presisi", "recall", "lift_top_0_1pct"].filter((k) => k !== value && rows.some((r) => num(r[k]) !== null));
  return (
    <div ref={box} className="relative" onPointerLeave={clear}>
      <div className="mb-1.5 flex items-center gap-3 text-[10.5px] text-[#8f99a8]">
        <span>{METRIC_NAMES[value] ?? value} (fold mean)</span>
        <span className="flex items-center gap-1"><span className="h-px w-4 bg-[#e5e8eb]" />95% interval (bootstrap per item)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: MUTED_MARK }} />reference</span>
      </div>
      <div className="space-y-[7px]">
        {data.map((d, i) => {
          const on = best.has(d.name);
          const color = d.ref ? MUTED_MARK : on ? SERIES[0] : "#2f6db3";
          return (
            <div key={d.name} tabIndex={0} className="group flex items-center gap-2 rounded outline-none focus-visible:ring-1 focus-visible:ring-[#3987e5]"
              onPointerMove={(e) => at(e, { title: `#${i + 1} ${d.name}${d.ref ? " (reference)" : ""}`, lines: [
                { value: pctNum(d.v), label: METRIC_NAMES[value] ?? value, key: color },
                ...(d.ci ? [{ value: `${pctNum(d.ci[0])}–${pctNum(d.ci[1])}`, label: "95% interval" }] : []),
                ...extra.map((k) => ({ value: k.startsWith("lift") ? `${compact(num(d.r[k]) ?? 0)}×` : pctNum(num(d.r[k]) ?? 0), label: METRIC_NAMES[k] ?? k })),
              ] })}
              onFocus={(e) => at(e, { title: d.name, lines: [{ value: pctNum(d.v), label: METRIC_NAMES[value] ?? value }] })} onBlur={clear}>
              <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-[#8f99a8]">{i + 1}</span>
              <span className={`w-[32%] shrink-0 truncate text-[11.5px] ${d.ref ? "italic text-[#8f99a8]" : on ? "font-semibold text-white" : "text-[#d3d8de]"}`} title={d.name}>{d.name}</span>
              <span className="relative h-[14px] min-w-0 flex-1">
                <span className="absolute inset-y-[3px] left-0 rounded-r-[4px] group-hover:brightness-125" style={{ width: `${Math.max(0.8, (100 * d.v) / top)}%`, background: color }} />
                {d.ci && <span className="absolute top-1/2 h-px -translate-y-1/2 bg-[#e5e8eb]/80" style={{ left: `${(100 * d.ci[0]) / top}%`, width: `${Math.max(0.3, (100 * (d.ci[1] - d.ci[0])) / top)}%` }} />}
                {d.ci && [d.ci[0], d.ci[1]].map((c, j) => <span key={j} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[#e5e8eb]/80" style={{ left: `${(100 * c) / top}%` }} />)}
              </span>
              <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[#c5cbd3]">{pctNum(d.v)}</span>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** What pushed one prediction up or down: diverging bars around zero, each with the item's value. */
export function Contrib({ rows, label = "label", value = "kontribusi", valueCol = "nilai" }: { rows: Rec[]; label?: string; value?: string; valueCol?: string }) {
  const { box, tip, at, clear } = useTip();
  const data = rows.map((r) => ({ name: String(r[label] ?? r.fitur ?? "—"), v: num(r[value]) ?? 0, val: r[valueCol] })).slice(0, 10);
  const top = Math.max(1e-9, ...data.map((d) => Math.abs(d.v)));
  const UP = SERIES[1], DOWN = SERIES[0];
  return (
    <div ref={box} className="relative" onPointerLeave={clear}>
      <div className="mb-1.5 flex items-center gap-3 text-[10.5px] text-[#8f99a8]">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: UP }} />raises risk</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: DOWN }} />lowers risk</span>
      </div>
      <div className="space-y-[6px]">
        {data.map((d, i) => (
          <div key={`${d.name}-${i}`} tabIndex={0} className="group flex items-center gap-2 outline-none"
            onPointerMove={(e) => at(e, { title: d.name, lines: [{ value: d.v.toLocaleString("en-US", { maximumFractionDigits: 4 }), label: "contribution", key: d.v >= 0 ? UP : DOWN },
              ...(d.val !== undefined && d.val !== null ? [{ value: String(d.val), label: "item value" }] : [])] })} onBlur={clear}>
            <span className="w-[38%] shrink-0 text-[11.5px] leading-snug text-[#e5e8eb]">
              <span className="block truncate" title={d.name}>{d.name}</span>
              {d.val !== undefined && d.val !== null && <span className="block truncate text-[10.5px] text-[#8f99a8]">= {String(d.val)}</span>}
            </span>
            <span className="relative h-[14px] min-w-0 flex-1">
              <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
              <span className="absolute inset-y-[2px] group-hover:brightness-125" style={d.v >= 0
                ? { left: "50%", width: `${(50 * d.v) / top}%`, background: UP, borderRadius: "0 4px 4px 0" }
                : { right: "50%", width: `${(50 * -d.v) / top}%`, background: DOWN, borderRadius: "4px 0 0 4px" }} />
            </span>
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** A result of one row is a number, not a chart. */
export function Stat({ rows, label, value }: { rows: Rec[]; label: string; value: string }) {
  const r = rows[0] ?? {};
  const v = num(r[value]);
  return (
    <div className="py-2">
      <p className="text-[30px] font-semibold leading-none text-white">{v === null ? fmtCell(r[value], value) : compact(v)}</p>
      <p className="mt-1.5 text-[11.5px] text-[#abb3bf]">{labelOf(r, label) === "all" ? header(value) : labelOf(r, label)}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ composition

export function Donut({ rows, label, value }: { rows: Rec[]; label: string; value: string }) {
  const { box, tip, at, clear } = useTip();
  const parts = useMemo(() => {
    const all = rows.map((r) => ({ label: labelOf(r, label), v: Math.max(0, num(r[value]) ?? 0) })).sort((a, b) => b.v - a.v);
    const head = all.slice(0, 5);
    const rest = all.slice(5).reduce((s, d) => s + d.v, 0);
    return rest > 0 ? [...head, { label: "Other", v: rest }] : head;
  }, [rows, label, value]);
  const total = parts.reduce((s, d) => s + d.v, 0) || 1;
  const R = 62, r = 40, C = 80;
  // where each segment starts and ends, from the running sum (no mutation during render)
  const cum = parts.reduce<number[]>((acc, d) => [...acc, acc[acc.length - 1] + d.v], [0]);
  const angle = (v: number) => -Math.PI / 2 + (2 * Math.PI * v) / total;
  const arcs = parts.map((d, i) => {
    const a0 = angle(cum[i]), a1 = angle(cum[i + 1]);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const path = parts.length === 1 ? `M${C},${C - R}A${R},${R} 0 1 1 ${C - 0.01},${C - R}L${C - 0.01},${C - r}A${r},${r} 0 1 0 ${C},${C - r}Z`
      : `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large} 0 ${p(r, a0)}Z`;
    return { ...d, path, color: SERIES[i % SERIES.length] };
  });
  return (
    <div ref={box} className="relative flex flex-wrap items-center gap-4" onPointerLeave={clear}>
      <svg viewBox="0 0 160 160" className="h-[150px] w-[150px] shrink-0" role="img" aria-label="Composition">
        {arcs.map((d) => (
          <path key={d.label} d={d.path} fill={d.color} stroke={SURFACE} strokeWidth={2} tabIndex={0} className="outline-none transition-[filter] hover:brightness-125 focus:brightness-125"
            onPointerMove={(e) => at(e, { lines: [{ key: d.color, value: `${((100 * d.v) / total).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`, label: `${d.label} · ${compact(d.v)}` }] })}
            onFocus={(e) => at(e, { lines: [{ key: d.color, value: compact(d.v), label: d.label }] })} onBlur={clear} />
        ))}
        <text x={C} y={C - 2} textAnchor="middle" className="fill-white text-[17px] font-semibold">{compact(total)}</text>
        <text x={C} y={C + 14} textAnchor="middle" className="fill-[#8f99a8] text-[9.5px]">total</text>
      </svg>
      <ul className="min-w-[160px] flex-1 space-y-1.5 text-[11.5px]">
        {arcs.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate text-[#e5e8eb]" title={d.label}>{d.label}</span>
            <span className="tabular-nums text-[#c5cbd3]">{compact(d.v)}</span>
            <span className="w-12 text-right tabular-nums text-[#8f99a8]">{((100 * d.v) / total).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</span>
          </li>
        ))}
      </ul>
      <Tooltip tip={tip} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ trend

export function TrendLine({ rows, x, value, series }: { rows: Rec[]; x: string; value: string; series?: string | null }) {
  const { box, tip, at, clear } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const { xs, lines } = useMemo(() => {
    const xs = Array.from(new Set(rows.map((r) => String(r[x] ?? "")).filter(Boolean))).sort();
    const keys = series ? Array.from(new Set(rows.map((r) => labelOf(r, series)))) : ["Value"];
    // more than three series: the three largest, by total (the rest are in the table view)
    const totals = keys.map((k) => ({ k, t: rows.filter((r) => !series || labelOf(r, series) === k).reduce((s, r) => s + (num(r[value]) ?? 0), 0) }))
      .sort((a, b) => b.t - a.t).slice(0, 3).map((o) => o.k);
    const lines = totals.map((k, i) => ({
      key: k, color: SERIES[i],
      pts: xs.map((xv) => rows.filter((r) => String(r[x]) === xv && (!series || labelOf(r, series) === k)).reduce((s, r) => s + (num(r[value]) ?? 0), 0)),
    }));
    return { xs, lines };
  }, [rows, x, value, series]);
  const W = 560, H = 190, L = 44, B = 24, T = 10, Rr = 70;
  const maxV = Math.max(1e-9, ...lines.flatMap((l) => l.pts));
  const px = (i: number) => L + (xs.length <= 1 ? 0 : (i * (W - L - Rr)) / (xs.length - 1));
  const py = (v: number) => T + (H - T - B) * (1 - v / maxV);
  const ticks = [0, maxV / 2, maxV];
  return (
    <div ref={box} className="relative" onPointerLeave={() => { clear(); setHover(null); }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trend"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const sx = ((e.clientX - r.left) / r.width) * W;
          const i = Math.max(0, Math.min(xs.length - 1, Math.round(((sx - L) / (W - L - Rr)) * (xs.length - 1))));
          setHover(i);
          at(e, { title: fmtCell(xs[i], x), lines: lines.map((l) => ({ key: l.color, value: compact(l.pts[i]), label: l.key })) });
        }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - Rr} y1={py(t)} y2={py(t)} stroke={i === 0 ? "#383f47" : GRID} strokeWidth={1} />
            <text x={L - 6} y={py(t) + 3} textAnchor="end" fontSize="9.5" fill={AXIS}>{compact(t)}</text>
          </g>
        ))}
        {[0, Math.floor((xs.length - 1) / 2), xs.length - 1].filter((v, i, a) => a.indexOf(v) === i && v >= 0).map((i) => (
          <text key={i} x={px(i)} y={H - 6} textAnchor="middle" fontSize="9.5" fill={AXIS}>{fmtCell(xs[i], x)}</text>
        ))}
        {lines.length === 1 && <path d={`M${px(0)},${py(0)} ${lines[0].pts.map((v, i) => `L${px(i)},${py(v)}`).join(" ")} L${px(xs.length - 1)},${py(0)}Z`} fill={lines[0].color} fillOpacity={0.1} />}
        {lines.map((l) => (
          <g key={l.key}>
            <path d={l.pts.map((v, i) => `${i ? "L" : "M"}${px(i)},${py(v)}`).join(" ")} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={px(xs.length - 1)} cy={py(l.pts[l.pts.length - 1] ?? 0)} r={4} fill={l.color} stroke={SURFACE} strokeWidth={2} />
            <text x={px(xs.length - 1) + 8} y={py(l.pts[l.pts.length - 1] ?? 0) + 3} fontSize="10" fill="#e5e8eb">{compact(l.pts[l.pts.length - 1] ?? 0)}</text>
          </g>
        ))}
        {hover !== null && <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} stroke="#8f99a8" strokeWidth={1} />}
      </svg>
      {lines.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[#c5cbd3]">{lines.map((l) => <span key={l.key} className="flex items-center gap-1.5"><span className="h-[2px] w-3 rounded" style={{ background: l.color }} />{l.key}</span>)}</div>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ regions

// Indonesia's coastline (Natural Earth 1:50m, public/geo/indonesia.json: rings of [lon, lat]), fetched once per page
let coast: Promise<number[][][]> | null = null;
const loadCoast = () => (coast ??= fetch("/geo/indonesia.json").then((r) => (r.ok ? r.json() : { rings: [] })).then((d) => d.rings ?? []).catch(() => []));

/** Where the values are: a circle per region with a "lat,lon" location on Indonesia's extent (lon 94–142, lat -11.5–6.5),
 *  drawn over the coastline, area ∝ value; the regions the answer is about stand out; the largest carry a label where
 *  it does not cover another one. */
export function RegionMap({ rows, label, value, highlight = [] }: { rows: Rec[]; label: string; value: string; highlight?: string[] }) {
  const { box, tip, at, clear } = useTip();
  const [rings, setRings] = useState<number[][][]>([]);
  useEffect(() => { let on = true; loadCoast().then((r) => { if (on) setRings(r); }); return () => { on = false; }; }, []);
  const pts = useMemo(() => rows.map((r) => {
    const [la, lo] = String(r.lokasi ?? "").split(",").map(Number);
    return { la, lo, v: num(r[value]) ?? 0, label: labelOf(r, label) };
  }).filter((p) => isFinite(p.la) && isFinite(p.lo)).sort((a, b) => b.v - a.v), [rows, label, value]);
  const W = 760, H = 300;
  const x = (lo: number) => ((lo - 94) / 48) * W, y = (la: number) => ((6.5 - la) / 18) * H;
  const max = Math.max(1e-9, ...pts.map((p) => p.v));
  const hl = new Set(highlight.map((h) => h.toLowerCase()));
  const total = pts.reduce((s, p) => s + p.v, 0);
  const land = useMemo(() => rings.map((r) => `M${r.map(([lo, la]) => `${x(lo).toFixed(1)},${y(la).toFixed(1)}`).join("L")}Z`).join(""), [rings]);
  // labels of the largest regions, each above its circle, else below, else beside; one that would cover a placed label is left to the tooltip
  const labels = useMemo(() => {
    const taken: [number, number, number, number][] = [];
    const out: { p: (typeof pts)[number]; x: number; y: number; anchor: "middle" | "start" | "end" }[] = [];
    for (const p of pts.slice(0, 8)) {
      const cx = x(p.lo), cy = y(p.la), rad = 3 + 26 * Math.sqrt(p.v / max), text = `${p.label} · ${compact(p.v)}`, w = text.length * 5.9;
      const spots = [{ x: cx, y: cy - rad - 5, anchor: "middle" as const }, { x: cx, y: cy + rad + 12, anchor: "middle" as const },
        { x: cx + rad + 4, y: cy + 4, anchor: "start" as const }, { x: cx - rad - 4, y: cy + 4, anchor: "end" as const }];
      for (const s of spots) {
        const x0 = s.anchor === "middle" ? s.x - w / 2 : s.anchor === "start" ? s.x : s.x - w, b: [number, number, number, number] = [x0, s.y - 10, x0 + w, s.y + 3];
        if (b[0] < 0 || b[2] > W || b[1] < 0 || b[3] > H || taken.some((t) => b[0] < t[2] && t[0] < b[2] && b[1] < t[3] && t[1] < b[3])) continue;
        taken.push(b);
        out.push({ p, ...s });
        break;
      }
      if (out.length >= 5) break;
    }
    return out;
  }, [pts, max]);
  return (
    <div ref={box} className="relative" onPointerLeave={clear}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md bg-[#151a1f]" role="img" aria-label="Region map">
        {[100, 110, 120, 130, 140].map((lo) => <line key={lo} x1={x(lo)} x2={x(lo)} y1={0} y2={H} stroke={GRID} strokeWidth={1} strokeOpacity={0.5} />)}
        {[5, 0, -5, -10].map((la) => <line key={la} x1={0} x2={W} y1={y(la)} y2={y(la)} stroke={GRID} strokeWidth={1} strokeOpacity={la === 0 ? 1 : 0.5} />)}
        <path d={land} fill="#2a333d" stroke="#3d4853" strokeWidth={0.6} strokeLinejoin="round" />
        <text x={6} y={y(0) - 4} fontSize="9" fill="#5f6b7c">equator</text>
        {[...pts].reverse().map((p, i) => {
          const on = hl.size === 0 || hl.has(p.label.toLowerCase());
          const rad = 3 + 26 * Math.sqrt(p.v / max);
          return (
            <circle key={`${p.label}-${i}`} cx={x(p.lo)} cy={y(p.la)} r={rad} fill={on ? SERIES[0] : MUTED_MARK} fillOpacity={on ? 0.55 : 0.4}
              stroke={on && hl.size ? "#f6f7f9" : SURFACE} strokeWidth={on && hl.size ? 1.5 : 2} tabIndex={0} className="outline-none hover:brightness-125 focus:brightness-125"
              onPointerMove={(e) => at(e, { lines: [{ value: compact(p.v), label: p.label }, ...(total ? [{ value: `${((100 * p.v) / total).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`, label: "of total" }] : [])] })}
              onFocus={(e) => at(e, { lines: [{ value: compact(p.v), label: p.label }] })} onBlur={clear} />
          );
        })}
        {labels.map(({ p, x: lx, y: ly, anchor }) => (
          <text key={`l-${p.label}`} x={lx} y={ly} textAnchor={anchor} fontSize="10.5" fill="#e5e8eb" pointerEvents="none"
            stroke="#151a1f" strokeWidth={3} paintOrder="stroke">{p.label} · {compact(p.v)}</text>
        ))}
      </svg>
      <p className="mt-1 text-[10.5px] text-[#8f99a8]">Circle area proportional to value · {pts.length} regions</p>
      <Tooltip tip={tip} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ table

/** onRow: a row is a way into its scope (the review drill-down) */
export function DataTable({ rows, fields, types, limit = 50, onRow }: { rows: Rec[]; fields: string[]; types?: Record<string, string>; limit?: number;
  onRow?: (row: Rec) => void }) {
  const [all, setAll] = useState(false);
  // a name column first; a key column whose name is shown is left to the tooltip
  const cols = useMemo(() => {
    const named = new Set(fields.filter((f) => f.endsWith("__nama")).map((f) => f.replace(/__nama$/, "")));
    const ordered = [...fields.filter((f) => f === "nama" || f.endsWith("__nama") || f === "nama_profil"), ...fields.filter((f) => !(f === "nama" || f.endsWith("__nama") || f === "nama_profil"))];
    return ordered.filter((f) => !named.has(f));
  }, [fields]);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div>
      <div className="max-h-[360px] overflow-auto rounded border border-white/5">
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-[#20262d]">
            <tr>{cols.map((f) => <th key={f} title={f} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-[#abb3bf]">{header(f)}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} onClick={onRow ? () => onRow(r) : undefined} className={`border-t border-white/[.04] hover:bg-white/[.03] ${onRow ? "cursor-pointer" : ""}`}>
                {cols.map((f) => {
                  const isNum = num(r[f]) !== null && types?.[f] !== "string" && !CODE_COL.test(f);
                  return <td key={f} title={String(r[f] ?? "")} className={`max-w-[280px] truncate px-2 py-1 ${isNum ? "text-right tabular-nums" : ""} text-[#e5e8eb]`}>{fmtCell(r[f], f, types?.[f])}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button onClick={() => setAll(!all)} className="mt-1 text-[10.5px] text-[#8abbff] hover:underline">{all ? "Show less" : `Show all ${rows.length} rows`}</button>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ card

export function ChartCard({ title, insight, source, children, table }: { title: string; insight?: string; source?: ReactNode; children: ReactNode; table?: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-white/[.07] bg-[#1c2127] p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold leading-snug text-white">{title}</h3>
          {insight && <p className="mt-0.5 text-[11.5px] leading-snug text-[#abb3bf]">{insight}</p>}
        </div>
        {table && (
          <div className="flex shrink-0 rounded border border-white/10 p-0.5 text-[10.5px]">
            {(["chart", "table"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-sm px-1.5 py-0.5 ${view === v ? "bg-white/10 text-white" : "text-[#8f99a8] hover:text-white"}`}>{v === "chart" ? "Chart" : "Table"}</button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 min-w-0">{view === "chart" || !table ? children : table}</div>
      {source && <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/[.05] pt-2 text-[10.5px] text-[#8f99a8]">{source}</div>}
    </section>
  );
}
