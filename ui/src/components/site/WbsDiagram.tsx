"use client";
import { useMemo, type ReactNode } from "react";
import { Markdown } from "@/components/aip/Briefing";
import { type Rec } from "./kit";

/* The WBS as a civil engineer draws it: the work at the top, the level below it side by side along a bar, and everything under each of those hanging down in an indented column, each level a step further in. However many work packages there are, the drawing grows down rather than across. */

const W = 172, H = 46, IND = 28, RAIL = 14, GAP = 8, COL = 26, BUS = 36;
const TONE: Record<string, string> = { project: "border-[#9d8cff]/60 bg-[#9d8cff]/15", work: "border-[#9d8cff]/60 bg-[#9d8cff]/15", package: "border-[#3987e5]/50 bg-[#3987e5]/15", activity: "border-[#29a383]/50 bg-[#29a383]/10", section: "border-white/20 bg-white/[.05]", task: "border-white/10 bg-[#1c2127]" };
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

/** The top box over a row of columns. When nothing below it has children of its own, a row says nothing, so it all hangs under the top box instead. */
function layout(root: WbsNode, hide: Set<string>): { top: Placed; width: number; height: number } {
  const first = below(root, hide);
  if (!first.some((c) => below(c, hide).length)) {
    const { p, bottom } = hang(root, 0, 0, hide);
    return { top: p, width: W + IND * levels(root, hide), height: bottom };
  }
  let x = 0, bottom = 0;
  const kids = first.map((c) => { const k = hang(c, x, tall(root) + BUS, hide); x += W + IND * levels(c, hide) + COL; bottom = Math.max(bottom, k.bottom); return k.p; });
  const width = x - COL;
  return { top: { node: root, x: (width - W) / 2, y: 0, h: tall(root), row: true, kids }, width, height: bottom };
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
  const { top, width, height, boxes } = useMemo(() => {
    const placed = layout(root, new Set(hide));
    return { ...placed, boxes: flat(placed.top) };
  }, [root, hide]);
  return (
    <div className="overflow-x-auto p-3">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} fill="none" stroke="#5f6b7c" strokeWidth={1.25} aria-hidden="true"><Lines p={top} /></svg>
        {boxes.map(({ node: n, x, y }) => {
          const small = n.type === "task";
          return (
            <button key={n.code} onClick={() => onSelect?.(n.code)} disabled={!onSelect} title={`${n.code} ${n.name}${n.by_name ? ` · ${n.by_name}` : ""}${n.kind ? ` · ${KIND[n.kind] ?? n.kind}` : ""}`}
              className={`absolute overflow-hidden rounded border px-1.5 py-0.5 text-left ${TONE[n.type] ?? TONE.task} ${n.hold_point ? "!border-l-2 !border-l-[#e5484d]" : n.critical ? "!border-l-2 !border-l-[#fab219]" : ""} ${sel === n.code ? "outline outline-2 outline-offset-1 outline-white" : ""} ${onSelect ? "hover:brightness-125" : "cursor-default"}`}
              style={{ left: x, top: y, width: W, height: small ? H - 6 : H }}>
              <span className="flex items-baseline gap-1 text-[9.5px] tabular-nums text-[#8f99a8]"><span className="truncate">{n.code}</span>{n.ref && n.type !== "section" && <span className="ml-auto shrink-0 font-semibold text-[#abb3bf]">{n.ref}</span>}</span>
              <span className={`block leading-[1.15] text-white ${small ? "line-clamp-2 text-[10px]" : "line-clamp-2 text-[10.5px] font-medium"}`}>{n.name}</span>
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
      <div className="my-2 rounded border border-white/10 bg-[#161a1f]">
        {!packages && <p className="flex flex-wrap gap-x-4 border-b border-white/5 px-3 py-1.5 text-[10.5px] text-[#abb3bf]"><span className="flex items-center gap-1.5"><i className="h-3 w-0.5 bg-[#fab219]" />Critical path</span><span className="flex items-center gap-1.5"><i className="h-3 w-0.5 bg-[#e5484d]" />Hold point: work stops until signed</span><span className="ml-auto text-[#8f99a8]">O operation · I inspection · H handling</span></p>}
        <WbsDiagram root={planTree(plan)} hide={packages ? ["section", "task"] : []} onSelect={onSelect} />
      </div>
      {network && <><Markdown text={"## Critical path\n\nThe planning engineer said what must finish before what. Code worked out the dates and the float from those links."} />{network}</>}
      {rest && <Markdown text={`## Each task\n\n${rest}`} />}
    </>
  );
}
