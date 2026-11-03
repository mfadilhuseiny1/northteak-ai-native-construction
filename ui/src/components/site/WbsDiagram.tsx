"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Markdown } from "@/components/aip/Briefing";
import { type Rec } from "./kit";

/* The WBS as a civil engineer draws it: the work at the top, the level below it side by side along a bar, and everything under each of those hanging down in an indented column, each level a step further in. However many work packages there are, the drawing grows down rather than across. */

const W = 172, H = 46, IND = 28, RAIL = 14, GAP = 8, COL = 26, BUS = 36;
const TONE: Record<string, string> = { project: "border-[#6db3e8]/90 bg-[#3987e5]/[.22]", work: "border-[#6db3e8]/90 bg-[#3987e5]/[.22]", package: "border-[#3987e5]/60 bg-[#3987e5]/[.13]", activity: "border-[#4cae9c]/55 bg-[#2f8f7d]/[.13]", section: "border-white/20 bg-[#1c2733]", task: "border-white/10 bg-[#1c2733]" };
const KIND: Record<string, string> = { operation: "Operation", inspection: "Inspection", handling: "Handling" };

export type WbsNode = { code: string; name: string; type: string; ref?: string; kind?: string; critical?: boolean; hold_point?: boolean; status?: string; by_name?: string; children?: WbsNode[] };
type Placed = { node: WbsNode; x: number; y: number; h: number; row: boolean; kids: Placed[] };

const tall = (n: WbsNode) => (n.type === "task" ? H - 6 : H);
const below = (n: WbsNode, hide: Set<string>) => (n.children ?? []).filter((c) => !hide.has(c.type));
const levels = (n: WbsNode, hide: Set<string>): number => { const k = below(n, hide); return k.length ? 1 + Math.max(...k.map((c) => levels(c, hide))) : 0; };

/** A box with what is under it hanging beneath, one step in. */
function hang(n: WbsNode, x: number, y: number, hide: Set<string>): { p: Placed; bottom: number } {
  const kids: Placed[] = [];
  let at = y + tall(n);
  for (const c of below(n, hide)) { const k = hang(c, x + IND, at + GAP, hide); kids.push(k.p); at = k.bottom; }
  return { p: { node: n, x, y, h: tall(n), row: false, kids }, bottom: at };
}

/** The top box over a row of columns. When nothing below it has children of its own, a row says nothing, so it all hangs under the top box instead. When the row would run wider than the screen, the columns wrap into bands under the same top box, each band on its own bus from the one spine: the drawing fits the width, boxes stay full size, and the page scrolls down a little instead of sideways. */
type LaidOut = { top: Placed; width: number; height: number; boxes: Placed[]; lines: Placed[]; extra: string[] };
function layout(root: WbsNode, hide: Set<string>, avail = Infinity): LaidOut {
  const first = below(root, hide);
  if (!first.some((c) => below(c, hide).length)) {
    const { p, bottom } = hang(root, 0, 0, hide);
    return { top: p, width: W + IND * levels(root, hide), height: bottom, boxes: flat(p), lines: [p], extra: [] };
  }
  const cols = first.map((c) => ({ node: c, w: W + IND * levels(c, hide) }));
  const rowWidth = cols.reduce((n, c) => n + c.w, 0) + COL * (cols.length - 1);
  if (rowWidth <= avail) {
    let x = 0, bottom = 0;
    const kids = cols.map((c) => { const k = hang(c.node, x, tall(root) + BUS, hide); x += c.w + COL; bottom = Math.max(bottom, k.bottom); return k.p; });
    const top: Placed = { node: root, x: (rowWidth - W) / 2, y: 0, h: tall(root), row: true, kids };
    return { top, width: rowWidth, height: bottom, boxes: flat(top), lines: [top], extra: [] };
  }
  const bands: (typeof cols)[] = [];
  let band: typeof cols = [], bandW = 0;
  for (const c of cols) {
    if (band.length && bandW + COL + c.w > avail) { bands.push(band); band = []; bandW = 0; }
    band.push(c);
    bandW += (band.length > 1 ? COL : 0) + c.w;
  }
  if (band.length) bands.push(band);
  const width = Math.max(...bands.map((b) => b.reduce((n, c) => n + c.w, 0) + COL * (b.length - 1)));
  const top: Placed = { node: root, x: (width - W) / 2, y: 0, h: tall(root), row: false, kids: [] };
  const spine = top.x + W / 2;
  const boxes: Placed[] = [top], lines: Placed[] = [], extra: string[] = [];
  let y = tall(root) + BUS, lastBus = y - BUS / 2, height = y;
  for (const b of bands) {
    const bus = y - BUS / 2;
    lastBus = bus;
    let x = 0, bottom = y;
    const centers: number[] = [];
    for (const c of b) {
      const k = hang(c.node, x, y, hide);
      boxes.push(...flat(k.p));
      lines.push(k.p);
      centers.push(k.p.x + W / 2);
      bottom = Math.max(bottom, k.bottom);
      x += c.w + COL;
    }
    extra.push(`M${Math.min(spine, ...centers)} ${bus}H${Math.max(spine, ...centers)}`);
    for (const cx of centers) extra.push(`M${cx} ${bus}V${y}`);
    height = bottom;
    y = bottom + BUS;
  }
  extra.push(`M${spine} ${tall(root)}V${lastBus}`);
  return { top, width, height, boxes, lines, extra };
}

function flat(p: Placed): Placed[] {
  return [p, ...p.kids.flatMap(flat)];
}

function Lines({ p }: { p: Placed }) {
  if (!p.kids.length) return null;
  if (p.row) {
    const cx = (k: Placed) => k.x + W / 2, mid = p.x + W / 2, bus = p.y + p.h + BUS / 2;
    return (
      <g>
        <path d={`M${mid} ${p.y + p.h}V${bus}`} />
        <path d={`M${Math.min(mid, ...p.kids.map(cx))} ${bus}H${Math.max(mid, ...p.kids.map(cx))}`} />
        {p.kids.map((k) => <path key={k.node.code} d={`M${cx(k)} ${bus}V${k.y}`} />)}
        {p.kids.map((k) => <Lines key={k.node.code} p={k} />)}
      </g>
    );
  }
  const rail = p.x + RAIL, last = p.kids[p.kids.length - 1];
  return (
    <g>
      <path d={`M${rail} ${p.y + p.h}V${last.y + last.h / 2}`} />
      {p.kids.map((k) => <path key={k.node.code} d={`M${rail} ${k.y + k.h / 2}H${k.x}`} />)}
      {p.kids.map((k) => <Lines key={k.node.code} p={k} />)}
    </g>
  );
}

export function WbsDiagram({ root, hide = [], sel, onSelect }: { root: WbsNode; hide?: string[]; sel?: string | null; onSelect?: (code: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setAvail(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { width, height, boxes, lines, extra } = useMemo(() => layout(root, new Set(hide), Math.max(avail - 32, W)), [root, hide, avail]);
  return (
    <div ref={wrap} className="dotgrid overflow-x-auto rounded-lg p-4">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} fill="none" stroke="#7186a0" strokeWidth={1.5} aria-hidden="true">{extra.map((d) => <path key={d} d={d} />)}{lines.map((p) => <Lines key={p.node.code} p={p} />)}</svg>
        {boxes.map(({ node: n, x, y }) => {
          const small = n.type === "task";
          return (
            <button key={n.code} onClick={() => onSelect?.(n.code)} disabled={!onSelect} title={`${n.code} ${n.name}${n.by_name ? ` · ${n.by_name}` : ""}${n.kind ? ` · ${KIND[n.kind] ?? n.kind}` : ""}`}
              className={`absolute overflow-hidden rounded-md border px-2 py-1 text-left shadow-[0_3px_10px_rgb(0_0_0/.30)] ${TONE[n.type] ?? TONE.task} ${n.hold_point ? "!border-l-[3px] !border-l-[#e5484d]" : n.critical ? "!border-l-[3px] !border-l-[#fab219]" : ""} ${sel === n.code ? "outline outline-2 outline-offset-2 outline-[#f5b82e] brightness-125" : ""} ${onSelect ? "hover:-translate-y-px hover:brightness-125 hover:shadow-[0_6px_16px_rgb(0_0_0/.4)]" : "cursor-default"}`}
              style={{ left: x, top: y, width: W, height: small ? H - 6 : H }}>
              <span className="flex items-baseline gap-1 text-[9.5px] tabular-nums text-[#8f99a8]"><span className="truncate">{n.code}</span>{n.ref && n.type !== "section" && <span className="ml-auto shrink-0 font-semibold text-[#abb3bf]">{n.ref}</span>}</span>
              <span className={`block leading-[1.15] text-white ${small ? "line-clamp-2 text-[10px]" : "line-clamp-2 text-[10.5px] font-semibold"}`}>{n.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A work plan's breakdown as a tree: the work item, its programme activities, their sections, their tasks. A plan from a consultant's documents has its control accounts between the project and the work packages. */
export function planTree(plan: Rec): WbsNode {
  const steps: Record<string, Rec> = Object.fromEntries((plan.steps as Rec[]).map((s) => [s.id, s]));
  const branches = ((plan.tree ?? []) as Rec[]).filter((b) => (b.sections as Rec[]).length);
  const branch = (b: Rec): WbsNode => ({
    code: b.code, name: b.name, ref: b.activity, type: "activity",
    children: (b.sections as Rec[]).map((sec) => ({
      code: sec.code, name: sec.name, type: "section",
      children: (sec.tasks as string[]).map((id) => ({ code: steps[id].code, name: steps[id].name, ref: id, type: "task", kind: steps[id].kind, critical: steps[id].critical, hold_point: steps[id].hold_point })),
    })),
  });
  if (plan.kind === "package" && plan.accounts) {
    return { code: "1", name: plan.title, type: "project", children: (plan.accounts as Rec[]).map((a, i) => ({ code: `1.${i + 1}`, name: a.name, ref: a.no, type: "package", children: branches.filter((b) => String(b.code).startsWith(`1.${i + 1}.`)).map(branch) })) };
  }
  const parent = String(branches[0]?.code ?? "1").split(".").slice(0, -1).join(".") || "1";
  return { code: parent, name: plan.title, type: "work", children: branches.map(branch) };
}

/** A work plan's report with its WBS drawn in place, and its critical path when there is one. The table stays below them for each task's crew and material. A review from before reports carried the data keeps its report as it was written. */
export function WbsReport({ text, plan, onSelect, network }: { text: string; plan?: Rec | null; onSelect?: (code: string) => void; network?: ReactNode }) {
  const heading = /^## The WBS[ \t]*$/m;
  const at = plan?.tree ? text.search(heading) : -1;
  if (!plan || at < 0) return <Markdown text={text} />;
  const packages = plan.kind === "package";  // to the work packages, as the breakdown is drawn: their tasks are in the Procedures tab
  const rest = text.slice(at).replace(heading, "").trim();
  const checks = (plan.checks ?? []) as Rec[];
  const split = checks.filter((c) => String(c.rule).startsWith("split_")).length;
  const source = !packages ? "" : `${checks.some((c) => c.rule === "schedule_read" && c.ok) ? "The planning engineer wrote a breakdown from the documents, and code compared it with the consultant's master schedule. The schedule's rows, dates and weights stand, and any difference is flagged." : "The planning engineer wrote this breakdown from the documents, so its weeks and weights are estimates."}${split ? ` ${split === 1 ? "One schedule row was" : `${split} schedule rows were`} split by an agent, so the weeks and values of those parts are estimates.` : ""}`;
  return (
    <>
      <Markdown text={`${text.slice(0, at)}## The WBS${source ? `\n\n${source}` : ""}`} />
      <div className="my-2 overflow-hidden rounded-lg border border-white/10 bg-[#111820] shadow-[0_4px_16px_rgb(0_0_0/.25)]">
        {!packages && <p className="flex flex-wrap gap-x-4 border-b border-white/5 px-3 py-1.5 text-[10.5px] text-[#abb3bf]"><span className="flex items-center gap-1.5"><i className="h-3 w-0.5 bg-[#fab219]" />Critical path</span><span className="flex items-center gap-1.5"><i className="h-3 w-0.5 bg-[#e5484d]" />Hold point: work stops until signed</span><span className="ml-auto text-[#8f99a8]">O operation · I inspection · H handling</span></p>}
        <WbsDiagram root={planTree(plan)} hide={packages ? ["section", "task"] : []} onSelect={onSelect} />
      </div>
      {network && <><Markdown text={"## Critical path\n\nThe planning engineer said what must finish before what. Code worked out the dates and the float from those links."} />{network}</>}
      {rest && <Markdown text={`## Each task\n\n${rest}`} />}
    </>
  );
}
