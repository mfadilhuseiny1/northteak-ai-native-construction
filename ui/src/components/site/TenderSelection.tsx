"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { api, Loading, money, Problem, useData, type Rec } from "./kit";
import { SourceLink } from "./SourceDrawer";
import { Diverge, SERIES, SizeBar } from "./Visual";

/* The selection of the contractor (pemilihan penyedia), inside Review: the tree the tender sets, from the selection down to what each branch
   asks, every requirement in the words the documents use with its page, and the priced BoQ (RAB) against the owner's estimate (HPS). Code reads
   it all, with no model; a person marks what is ready. Award records are never read: they name other companies. */

const COLOR: Record<string, string> = { kualifikasi: SERIES[0], penawaran: SERIES[1] };
const MARK: [string, string][] = [["todo", "To do"], ["ready", "Ready"], ["na", "Not needed"]];
const ON: Record<string, string> = { todo: "border-white/40 bg-white/10 text-white", ready: "border-[#29a383] bg-[#29a383]/25 text-white", na: "border-white/30 bg-white/[.06] text-[#d3d8de]" };
type Line = { d: string; on: boolean; color: string };

/** Where the bid falls against the HPS, and what follows from it. */
function zone(ratio: number) {
  if (ratio > 1) return { key: "over", short: "over it", color: "#f87171", label: "Over the HPS", text: "A bid above the HPS fails (gugur)." };
  if (ratio < 0.8) return { key: "low", short: "below 80%", color: "#fab219", label: "Below 80% of the HPS", text: "The selection team must check the price is reasonable (klarifikasi kewajaran harga), and the performance bond rises to 5% of the HPS." };
  return { key: "ok", short: "within it", color: "#29a383", label: "Within the HPS", text: "Between 80% and 100% of the HPS: no price check on the total, and the performance bond is 5% of the contract." };
}

function Count({ items }: { items: Rec[] }) {
  const counted = items.filter((x) => x.status !== "na"), ready = counted.filter((x) => x.status === "ready").length, missing = items.filter((x) => !x.found.length).length;
  return (
    <span className="mt-1.5 block">
      <span className="flex h-1.5 overflow-hidden rounded-full bg-white/10"><span className="h-full rounded-full bg-[#29a383]" style={{ width: `${counted.length ? (ready / counted.length) * 100 : 0}%` }} /></span>
      <span className="mt-1 flex items-center gap-2 text-[10.5px] text-[#8f99a8]"><span><b className="text-white">{ready}</b>/{counted.length} ready</span>{missing > 0 && <span className="text-[#fbd38d]">{missing} not in the documents</span>}</span>
    </span>
  );
}

function Node({ id, refs, children, color, selected = false, onClick, wide = false }: { id: string; refs: React.MutableRefObject<Record<string, HTMLElement | null>>; children: ReactNode; color: string; selected?: boolean; onClick?: () => void; wide?: boolean }) {
  return (
    <button type="button" ref={(el) => { refs.current[id] = el; }} onClick={onClick} disabled={!onClick}
      className={`relative z-[1] w-full rounded-lg border px-3 py-2 text-left shadow-[0_3px_0_rgb(0_0_0/.45)] transition disabled:cursor-default ${wide ? "" : "max-w-[190px]"} ${selected ? "border-[#f5b82e] bg-[#2a3644]" : "border-white/10 bg-[#1c2733] enabled:hover:-translate-y-0.5 enabled:hover:border-white/30"}`}
      style={{ boxShadow: `inset 3px 0 0 ${color}, 0 3px 0 rgb(0 0 0 / .45)` }}>
      {children}
    </button>
  );
}

/** The tree, as the tender sets it: the selection, its two branches, their stages, and the three things each stage looks at. */
function Tree({ data, sel, onSel }: { data: Rec; sel: string; onSel: (k: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const items = data.items as Rec[], tree = data.tree as Rec[], price = data.price as Rec | null;
  const draw = useCallback(() => {
    const root = box.current?.getBoundingClientRect();
    if (!root) return;
    const at = (id: string) => { const r = refs.current[id]?.getBoundingClientRect(); return r ? { l: r.left - root.left, r: r.right - root.left, y: r.top - root.top + r.height / 2 } : null; };
    const join = (a: string, b: string, on: boolean, color: string): Line | null => {
      const p = at(a), q = at(b);
      if (!p || !q) return null;
      const mid = p.r + (q.l - p.r) / 2, bend = Math.min(6, Math.abs(q.y - p.y) / 2), dir = q.y > p.y ? 1 : -1;
      const d = Math.abs(q.y - p.y) < 1 ? `M${p.r},${p.y} H${q.l}` : `M${p.r},${p.y} H${mid - bend} Q${mid},${p.y} ${mid},${p.y + dir * bend} V${q.y - dir * bend} Q${mid},${q.y} ${mid + bend},${q.y} H${q.l}`;
      return { d, on, color };
    };
    const out: (Line | null)[] = [];
    tree.forEach((b) => {
      const color = COLOR[b.stage], on = sel.startsWith(`${b.stage}:`);
      out.push(join("root", b.key, on, color), join(b.key, b.stage, on, color));
      (b.leaves as Rec[]).forEach((lf) => out.push(join(b.stage, `${b.stage}:${lf.key}`, sel === `${b.stage}:${lf.key}`, color)));
    });
    const next = out.filter(Boolean) as Line[];
    setLines((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [tree, sel]);
  useLayoutEffect(() => { draw(); }, [draw, data]);
  useEffect(() => {
    if (!box.current) return;
    const seen = new ResizeObserver(() => draw());
    seen.observe(box.current);
    return () => seen.disconnect();
  }, [draw]);
  const z = price ? zone(price.ratio) : null;
  return (
    <div ref={box} className="relative overflow-x-auto">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>{lines.map((l, i) => <path key={i} d={l.d} fill="none" stroke={l.on ? l.color : "#ffffff2e"} strokeWidth={l.on ? 2.5 : 1.5} strokeLinecap="round" />)}</svg>
      <div className="grid min-w-[880px] grid-cols-[150px_160px_170px_minmax(250px,1fr)] items-center gap-x-12 gap-y-2 py-1">
        <div style={{ gridColumn: 1, gridRow: "1 / span 6" }}>
          <Node id="root" refs={refs} color="#f5b82e"><span className="block text-[13px] font-bold text-white">Pemilihan</span><span className="block text-[10.5px] text-[#8f99a8]">selecting the contractor</span><Count items={items} /></Node>
        </div>
        {tree.map((b, bi) => (
          <div key={b.key} className="contents">
            <div style={{ gridColumn: 2, gridRow: `${1 + bi * 3} / span 3` }}>
              <Node id={b.key} refs={refs} color={COLOR[b.stage]} onClick={() => onSel(`${b.stage}:${(b.leaves as Rec[])[0].key}`)}><span className="block text-[13px] font-bold text-white">{b.name}</span><span className="block text-[10.5px] text-[#8f99a8]">{b.hint}</span></Node>
            </div>
            <div style={{ gridColumn: 3, gridRow: `${1 + bi * 3} / span 3` }}>
              <Node id={b.stage} refs={refs} color={COLOR[b.stage]} selected={false} onClick={() => onSel(`${b.stage}:${(b.leaves as Rec[])[0].key}`)}><span className="block text-[13px] font-bold text-white">{b.stage_name}</span><span className="block text-[10.5px] text-[#8f99a8]">{b.stage_hint}</span><Count items={items.filter((x) => x.stage === b.stage)} /></Node>
            </div>
            {(b.leaves as Rec[]).map((lf, li) => {
              const key = `${b.stage}:${lf.key}`, mine = items.filter((x) => x.stage === b.stage && x.leaf === lf.key);
              return (
                <div key={key} style={{ gridColumn: 4, gridRow: 1 + bi * 3 + li }}>
                  <Node id={key} refs={refs} color={COLOR[b.stage]} selected={sel === key} onClick={() => onSel(key)} wide>
                    <span className="flex items-baseline gap-2"><span className="text-[13px] font-bold text-white">{lf.name}</span><span className="truncate text-[10.5px] text-[#8f99a8]">{lf.hint}</span></span>
                    {lf.key === "harga" && z && price ? <span className="mt-1.5 flex items-center gap-2 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ background: z.color }} /><span className="text-[#d3d8de]">RAB <b className="text-white">{(price.ratio * 100).toFixed(1)}%</b> of the HPS</span><span className="text-[#8f99a8]">· {z.short}</span></span> : null}
                    <Count items={mine} />
                  </Node>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The RAB against the HPS: the total on the scale the regulation draws, a slider to try another price, and each section's gap. */
function Price({ data }: { data: Rec }) {
  const p = data.price as Rec | null, hps = data.hps as Rec, terms = data.terms as Rec[];
  const start = p ? Math.round(p.ratio * 1000) / 10 : 100;
  const [pct, setPct] = useState(start);
  useEffect(() => setPct(start), [start]);
  if (!p) return <div className="rounded-lg border border-dashed border-white/15 p-4 text-[12px] text-[#abb3bf]">The price can be set beside the HPS once the priced BoQ and the HPS are both read: upload them on Home and let the agents plan.</div>;
  const ratio = pct / 100, z = zone(ratio), bid = ratio * p.hps, weights = terms.find((t) => t.key === "weights");
  const lo = 70, hi = 110, at = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const bond = ratio < p.rules.low ? p.rules.bond * p.hps : p.rules.bond * bid;
  const moved = Math.abs(pct - start) > 0.05;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-[#151e28] p-3">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div><p className="text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">{moved ? "If the bid were" : "The RAB, the priced BoQ"}</p><p className="text-[22px] font-bold tabular-nums text-white">{money(bid)}</p><p className="text-[11px] text-[#abb3bf]"><b className="text-white">{pct.toFixed(1)}%</b> of the HPS, {money(p.hps)} · before tax on both</p></div>
          <div><p className="text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">Performance bond if it wins</p><p className="text-[16px] font-bold tabular-nums text-white">{money(bond)}</p><p className="text-[11px] text-[#abb3bf]">5% of {ratio < p.rules.low ? "the HPS" : "the contract"} · Perpres 12/2021, art. 33</p></div>
          {weights && <div><p className="text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">The price in the score</p><p className="text-[16px] font-bold text-white">{weights.cost != null ? `${weights.cost}%` : weights.value}</p><p className="text-[11px] text-[#abb3bf]">{weights.cost != null ? `technical ${weights.technical}%, cost ${weights.cost}%: a lower price scores more` : weights.note}</p></div>}
          {moved && <button onClick={() => setPct(start)} className="ml-auto rounded border border-white/15 px-2 py-1 text-[11.5px] text-[#d3d8de] hover:bg-white/[.07]">Back to the RAB</button>}
        </div>
        <div className="relative mt-5 pb-6">
          <div className="relative h-3 overflow-hidden rounded-full">
            <span className="absolute inset-y-0 left-0" style={{ width: `${at(80)}%`, background: "#fab21955" }} />
            <span className="absolute inset-y-0" style={{ left: `${at(80)}%`, width: `${at(100) - at(80)}%`, background: "#29a38355" }} />
            <span className="absolute inset-y-0 right-0" style={{ width: `${100 - at(100)}%`, background: "#f8717155" }} />
          </div>
          <span className="absolute top-[-5px] h-[22px] w-[3px] -translate-x-1/2 rounded bg-white/70" style={{ left: `${at(start)}%` }} title={`The RAB: ${start}%`} />
          <input type="range" min={lo} max={hi} step={0.1} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Bid as a share of the HPS" className="absolute inset-x-0 top-[-6px] h-6 w-full cursor-pointer appearance-none bg-transparent accent-[#f5b82e]" />
          {[70, 80, 90, 100, 110].map((v) => <span key={v} className="absolute top-5 -translate-x-1/2 text-[10px] tabular-nums text-[#8f99a8]" style={{ left: `${at(v)}%` }}>{v}%</span>)}
        </div>
        <p className="flex items-start gap-2 rounded-md px-2.5 py-2 text-[12px]" style={{ background: `${z.color}1a`, color: "#e5e8eb" }}><span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: z.color }} /><span><b className="font-semibold">{z.label}.</b> {z.text}</span></p>
        <p className="mt-2 text-[10.5px] text-[#8f99a8]">Drag to try another price; the white line is the RAB. The HPS with PPN 11% is {hps.with_tax ? money(hps.with_tax) : "not stated"}{hps.source ? <> (<SourceLink doc={hps.source.doc} page={hps.source.page} title={hps.source.title}>{hps.source.title}, p.{hps.source.page}</SourceLink>)</> : null}.</p>
      </div>
      {(p.sections as Rec[]).length > 0 && (
        <div className="rounded-lg border border-white/10 bg-[#151e28]">
          <p className="flex flex-wrap items-center gap-3 border-b border-white/[.06] px-3 py-2 text-[12px] font-semibold text-white">Section by section<span className="flex items-center gap-3 text-[10.5px] font-normal text-[#8f99a8]"><span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: "#c08414" }} />RAB</span><span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: SERIES[0] }} />HPS</span><span>a gap of 5% or more is worth explaining</span></span></p>
          <div className="divide-y divide-white/[.04]">
            {(p.sections as Rec[]).map((s) => {
              const max = Math.max(...(p.sections as Rec[]).flatMap((x) => [x.rab, x.hps]), 1), loud = Math.abs(s.gap_pct ?? 0) >= 5;
              return (
                <div key={s.no} className={`grid grid-cols-[40px_minmax(0,1fr)_minmax(140px,36%)_110px] items-center gap-3 px-3 py-2 ${loud ? "bg-[#fab219]/[.05]" : ""}`}>
                  <span className="font-mono text-[10.5px] text-[#8f99a8]">{s.no}</span>
                  <span className="min-w-0"><span className="block text-[12px] text-[#e5e8eb]">{s.name}</span><span className="block text-[10.5px] text-[#8f99a8]">RAB {money(s.rab)} · HPS {money(s.hps)}</span></span>
                  <span className="space-y-1"><SizeBar value={s.rab} max={max} color="#c08414" /><SizeBar value={s.hps} max={max} color={SERIES[0]} /></span>
                  <span className="text-right"><Diverge value={s.gap_pct} loud={5} title="The RAB against the HPS: blue is below, orange above" /></span>
                </div>
              );
            })}
          </div>
          <p className="border-t border-white/[.06] px-3 py-2 text-[10.5px] text-[#8f99a8]">This HPS gives section totals only, so unit prices cannot be checked line by line against it. A unit price far from the HPS&apos;s (harga satuan timpang) is checked when the HPS lists its lines.</p>
        </div>
      )}
    </div>
  );
}

function Requirement({ x, onMark }: { x: Rec; onMark: (status: string) => void }) {
  const found = x.found as Rec[];
  return (
    <div className={`flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5 ${x.status === "na" ? "opacity-55" : ""}`} style={{ boxShadow: `inset 3px 0 0 ${x.status === "ready" ? "#29a383" : !found.length ? "#fab219" : "transparent"}` }}>
      <div className="min-w-[280px] flex-1 space-y-1">
        <p className="flex items-start gap-1.5 font-medium leading-snug text-white">{x.status === "ready" && <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7ee2c0]" />}{x.what}</p>
        {found.length ? found.map((f, i) => <p key={i} className="text-[12px] leading-snug text-[#abb3bf]">“{f.quote}” <SourceLink doc={f.doc} page={f.page} quote={f.quote} title={f.title}>{f.title}, p.{f.page}</SourceLink></p>)
          : <p className="text-[12px] text-[#fbd38d]">Not in the tender documents read. Check with the selection team whether it is asked for.</p>}
        {x.comment && <p className="text-[12px] text-[#d3d8de]">{x.comment}</p>}
        {x.who && x.status !== "todo" && <p className="text-[11px] text-[#8f99a8]">{x.status === "ready" ? "Ready" : "Not needed"}, marked by {x.who}, {x.at}</p>}
      </div>
      <span className="flex shrink-0 gap-1" role="group" aria-label={`Status of ${x.what}`}>
        {MARK.map(([k, label]) => <button key={k} onClick={() => onMark(k)} aria-pressed={x.status === k} className={`rounded border px-2 py-0.5 text-[12px] ${x.status === k ? ON[k] : "border-white/15 text-[#abb3bf] hover:bg-white/5"}`}>{label}</button>)}
      </span>
    </div>
  );
}

export function TenderSelection() {
  const { data, err, act } = useData("/api/project/tender-selection");
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState("kualifikasi:adm");
  if (!data) return <section className="rounded-lg border border-white/10 bg-[#1c2733]"><Problem err={err} />{!err && <Loading />}</section>;
  const items = data.items as Rec[], tree = data.tree as Rec[], terms = data.terms as Rec[], price = data.price as Rec | null;
  const [stage, leaf] = sel.split(":");
  const branch = tree.find((b) => b.stage === stage)!, node = (branch.leaves as Rec[]).find((l) => l.key === leaf)!;
  const mine = items.filter((x) => x.stage === stage && x.leaf === leaf);
  const counted = items.filter((x) => x.status !== "na");
  return (
    <section data-tour="tender" className="rounded-lg border border-white/10 bg-[#1c2733]">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-[220px] flex-1 items-center gap-2 text-left font-semibold text-white hover:text-[#d9d3ff]">
          <Icon name={open ? "down" : "right"} className="h-3.5 w-3.5 shrink-0 text-[#8f99a8]" />Pemilihan penyedia: qualification and bid
          <span className="rounded-full bg-white/10 px-2 text-[12px] font-normal tabular-nums text-[#c5cbd3]">{items.length}</span>
          <span className="text-[12px] font-normal tabular-nums text-[#8f99a8]">{data.ready} of {counted.length} ready{data.not_found ? `, ${data.not_found} not in the documents` : ""}{price ? ` · RAB ${(price.ratio * 100).toFixed(1)}% of the HPS` : ""}</span>
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-white/5 p-3">
          <p className="text-[12px] leading-snug text-[#8f99a8]">What the tender asks of the bidder and of the bid, read by code from {data.tender_read ? "the instructions to bidders (LDK, LDP)" : "the documents"} and the documents beside them, each with its page. Click a box to see its requirements. Offers and evaluation records are not read: they name other companies.</p>
          {!data.tender_read && <p className="rounded bg-[#fab219]/10 px-2.5 py-1.5 text-[12px] text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3 w-3" />No LDK or LDP was uploaded, so the requirements come from the other documents only. Add them on Home for the full picture.</p>}
          {terms.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {terms.map((t) => (
                <div key={t.key} className="rounded-lg border border-white/10 bg-[#151e28] px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">{t.label}</p>
                  <p className="mt-0.5 text-[13px] font-semibold leading-snug text-white">{t.value}</p>
                  {t.amount != null && t.key !== "bid_bond" && t.key !== "appeal_bond" && <p className="text-[12px] font-semibold tabular-nums text-[#fbd38d]">= {money(t.amount)}</p>}
                  <p className="mt-0.5 text-[10.5px] text-[#8f99a8]">{t.note ? `${t.note} · ` : ""}<SourceLink doc={t.doc} page={t.page} title={t.title}>p.{t.page}</SourceLink></p>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-lg border border-white/10 bg-[#111820] p-3"><Tree data={data} sel={sel} onSel={setSel} /></div>
          <div className="overflow-hidden rounded-lg border border-white/10 bg-[#111820]" style={{ boxShadow: `inset 3px 0 0 ${COLOR[stage]}` }}>
            <div className="flex flex-wrap items-baseline gap-2 border-b border-white/[.06] px-3 py-2">
              <p className="text-[13px] font-bold text-white">{branch.stage_name} · {node.name}</p>
              <p className="text-[11.5px] text-[#8f99a8]">{node.hint}</p>
              <p className="ml-auto text-[11.5px] tabular-nums text-[#8f99a8]">{mine.filter((x) => x.status === "ready").length} of {mine.filter((x) => x.status !== "na").length} ready</p>
            </div>
            {leaf === "harga" && <div className="border-b border-white/[.06] p-3"><Price data={data} /></div>}
            <div className="divide-y divide-white/[.05]">
              {mine.map((x) => <Requirement key={x.key} x={x} onMark={(status) => void act(() => api(`/api/project/tender-selection/${x.key}`, { status }))} />)}
            </div>
          </div>
          <p className="text-[11px] text-[#8f99a8]">Read: {(data.read as Rec[]).map((d) => d.title).join(", ") || "nothing yet"}.</p>
        </div>
      )}
    </section>
  );
}
