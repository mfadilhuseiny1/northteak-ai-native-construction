"use client";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Label, money, type Rec } from "./kit";
import { hue, OTHER, SizeBar, Span } from "./Visual";

/* Review as pictures, so a newcomer sees the whole proposal before reading any of it: a map from the documents to what approving does, and a diagram for each thing to check. Each diagram's shape is what that check is about: work by what it is worth, documents joined by what they disagree on, work on the calendar with nothing after it. Every block opens its items below, with their sources and the decision, and the words stay the same as they were. */

export type Item = { key: string; title: ReactNode; detail?: ReactNode; sources?: Rec[]; edit?: { label: string; value: string }; link?: ReactNode; row?: string; color?: string; block?: string; label?: string; sub?: string; size?: number; topic?: string; docs?: string[]; when?: { start: string; finish: string; float: number } };
export type Section = { id: string; title: string; what: string; hint: string; items: Item[] };
type Reviews = Record<string, Rec>;
type Block = { key: string; label: string; sub?: string; size: number; items: Item[] };
type Row = { name: string; color: string; blocks: Block[] };

const GOLD = "#f5b82e";

/** Items as the diagram's rows and blocks, in the order they came. */
function rowsOf(items: Item[]): Row[] {
  const rows: Row[] = [];
  for (const i of items) {
    const name = i.row ?? "";
    let row = rows.find((r) => r.name === name);
    if (!row) rows.push(row = { name, color: i.color ?? OTHER, blocks: [] });
    const key = i.block ?? i.key;
    let block = row.blocks.find((b) => b.key === key);
    if (!block) row.blocks.push(block = { key, label: i.label ?? String(i.key), sub: i.sub, size: 0, items: [] });
    block.size += i.size ?? 1;
    block.items.push(i);
  }
  return rows;
}

const docName = (d?: Rec, id?: string) => String(d?.title ?? id ?? "").replace(/^\d+[-_.\s]*/, "").replace(/(\.pdf)+$/i, "").replace(/[-_]+/g, " ");

/** The proposal from end to end. Each thing to check opens below it. */
export function ReviewFlow({ rec, sections, reviews, documents, picked, onPick, onHome, onJump }: { rec: Rec; sections: Section[]; reviews: Reviews; documents: Rec | null; picked: string; onPick: (id: string) => void; onHome: () => void; onJump: (id: string) => void }) {
  const plan = rec.plan as Rec, accounts = plan.accounts as Rec[], steps = plan.steps as Rec[];
  const total = accounts.reduce((n, a) => n + (a.value ?? (a.packages as Rec[]).reduce((m, w) => m + (w.value ?? 0), 0)), 0) || 1;
  const kept = steps.filter((s) => reviews[`wp:${s.activity}`]?.verdict !== "reject");
  const drafts = (rec.rfi_drafts as Rec[]).filter((_, i) => reviews[`q:${i}`]?.verdict !== "reject").length;
  const all = sections.reduce((n, s) => n + s.items.length, 0), done = sections.reduce((n, s) => n + s.items.filter((i) => reviews[i.key]).length, 0);
  const stage = "flex min-w-0 flex-col rounded-lg border border-white/10 bg-[#1c2733] p-3";
  const step = (n: number, label: string) => <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em] text-[#8f99a8]"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] text-white">{n}</span>{label}</p>;
  const arrow = <div aria-hidden="true" className="hidden items-center justify-center text-[#6f7c8b] @4xl:flex"><Icon name="right" className="h-4 w-4" /></div>;
  const at = sections.findIndex((s) => s.id === picked), rowsOfMap = sections.length;
  return (
    <div data-tour="map" className="@container">
      <div className="grid grid-cols-1 gap-2 @4xl:grid-cols-[130px_16px_minmax(170px,1fr)_32px_minmax(240px,1.3fr)_16px_170px]">
        <div className={stage}>
          {step(1, "The agents read")}
          <button onClick={onHome} title="See the documents on Home" className="text-left hover:opacity-80"><p className="text-[26px] font-bold leading-none tabular-nums text-white">{documents?.used ?? "–"}</p><p className="mt-1 text-[12px] leading-snug text-[#d3d8de]">of {(documents?.documents as Rec[] | undefined)?.length ?? "–"} documents</p></button>
          <p className="mt-1.5 text-[11.5px] leading-snug text-[#8f99a8]">{documents?.set_aside ?? 0} set aside, each with its reason on Home</p>
          <span className="mt-auto flex flex-col items-start gap-1 pt-2 text-[11.5px]">
            <button onClick={() => onJump("tender")} className="text-[#9cc7f5] hover:underline">Can we bid?</button>
            <button onClick={() => onJump("checklist")} className="text-[#9cc7f5] hover:underline">Contract checklist</button>
          </span>
        </div>
        {arrow}
        <button onClick={() => onPick("extracted")} className={`${stage} text-left transition hover:border-white/30`}>
          {step(2, "They propose")}
          <span className="flex gap-4">
            <span><span className="block text-[26px] font-bold leading-none tabular-nums text-white">{plan.tree ? (plan.tree as Rec[]).length : 0}</span><span className="mt-1 block text-[12px] text-[#d3d8de]">work packages</span></span>
            <span><span className="block text-[26px] font-bold leading-none tabular-nums text-white">{steps.length}</span><span className="mt-1 block text-[12px] text-[#d3d8de]">tasks</span></span>
          </span>
          <span className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded">
            {accounts.map((a, i) => <span key={a.name} title={`${a.name}: ${money(a.value)}`} style={{ width: `${((a.value ?? 0) / total) * 100}%`, background: hue(i) }} />)}
          </span>
          <span className="mt-2 space-y-0.5">
            {accounts.map((a, i) => <span key={a.name} className="flex items-center gap-1.5 text-[11.5px] text-[#d3d8de]"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: hue(i) }} /><span className="min-w-0 flex-1 truncate">{a.name}</span><span className="shrink-0 tabular-nums text-[#abb3bf]">{money(a.value)}</span></span>)}
          </span>
        </button>
        <div aria-hidden="true" className="hidden pt-[26px] @4xl:block">
          <svg viewBox={`0 0 100 ${rowsOfMap * 10}`} preserveAspectRatio="none" className="h-full w-full">
            {sections.map((s, i) => { const y = i * 10 + 5, on = i === at; return <path key={s.id} d={`M0 ${rowsOfMap * 5} C50 ${rowsOfMap * 5} 50 ${y} 100 ${y}`} fill="none" stroke={on ? GOLD : "#ffffff33"} strokeWidth={on ? 2 : 1} vectorEffect="non-scaling-stroke" />; })}
          </svg>
        </div>
        <div className="flex min-w-0 flex-col gap-1" role="group" aria-label="What you check">
          <div className="flex h-[22px] items-end">{step(3, "You check")}</div>
          {sections.map((s) => {
            const reviewed = s.items.filter((i) => reviews[i.key]).length, on = picked === s.id, loud = s.id === "conflicts" && reviewed < s.items.length;
            return (
              <button key={s.id} onClick={() => onPick(s.id)} aria-pressed={on} className={`flex min-h-0 flex-1 items-center gap-2.5 rounded-lg border px-2.5 py-1 text-left transition ${on ? "border-[#f5b82e] bg-[#f5b82e]/10" : "border-white/10 bg-[#1c2733] hover:border-white/30"}`}>
                <span className={`w-9 shrink-0 text-right text-[17px] font-bold tabular-nums ${loud ? "text-[#fbd38d]" : "text-white"}`}>{s.items.length}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium leading-tight text-white">{s.title}</span><span className="block truncate text-[11px] leading-tight text-[#8f99a8]">{s.hint}</span></span>
                <span className="w-[58px] shrink-0"><span className="mb-0.5 block text-right text-[10.5px] tabular-nums text-[#8f99a8]">{reviewed} reviewed</span><SizeBar value={reviewed} max={s.items.length || 1} color="#29a383" /></span>
              </button>
            );
          })}
        </div>
        {arrow}
        <div className={stage}>
          {step(4, rec.status === "approved" ? "Approved" : "If you approve")}
          <ul className="space-y-2 text-[12px] leading-snug text-[#d3d8de]">
            <li><b className="tabular-nums text-white">{kept.length}</b> tasks go on the Kanban, <b className="tabular-nums text-white">{kept.filter((s) => s.kind === "inspection").length}</b> of them inspections</li>
            <li>WBS, Timeline, Critical Path and 3D all read the same work</li>
            <li><b className="tabular-nums text-white">{drafts}</b> questions stay drafts until a person issues them</li>
          </ul>
          <p className="mt-auto pt-2 text-[11.5px] text-[#8f99a8]"><b className="tabular-nums text-[#d3d8de]">{done}</b> of {all} reviewed</p>
        </div>
      </div>
    </div>
  );
}

function Mark({ items, reviews }: { items: Item[]; reviews: Reviews }) {
  const yes = items.filter((i) => reviews[i.key]?.verdict === "approve").length, no = items.filter((i) => reviews[i.key]?.verdict === "reject").length;
  if (!yes && !no) return null;
  if (items.length > 1) return <span className="shrink-0 text-[10.5px] tabular-nums text-[#abb3bf]">{yes + no}/{items.length}</span>;
  return <span aria-label={yes ? "accepted" : "rejected"} className={yes ? "text-[#7ee2c0]" : "text-[#ffb4b4]"}><Icon name={yes ? "check" : "x"} className="h-3.5 w-3.5" /></span>;
}

/** Blocks sized by what each is worth, in rows with a name and their total: work by money, questions by how many. */
function Tiles({ rows, reviews, picked, onPick, worth, unit }: { rows: Row[]; reviews: Reviews; picked: string; onPick: (key: string) => void; worth: (n: number) => string; unit: string }) {
  const most = Math.max(...rows.map((r) => r.blocks.reduce((n, b) => n + b.size, 0)), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const sum = r.blocks.reduce((n, b) => n + b.size, 0);
        return (
          <div key={r.name} className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)]">
            {r.name && <div className="min-w-0"><p className="flex items-center gap-1.5 text-[12.5px] font-semibold leading-tight text-white"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />{r.name}</p><p className="my-1 text-[11.5px] tabular-nums text-[#abb3bf]">{worth(sum)}{worth === money ? "" : ` ${unit}`}</p><SizeBar value={sum} max={most} color={r.color} /></div>}
            <div className={`flex flex-wrap gap-1 ${r.name ? "" : "md:col-span-2"}`}>
              {r.blocks.map((b) => {
                const on = picked === b.key, gone = b.items.every((i) => reviews[i.key]?.verdict === "reject");
                return (
                  <button key={b.key} onClick={() => onPick(b.key)} aria-pressed={on} title={`${b.label}${b.sub ? `: ${b.sub}` : ""}`} style={{ flexGrow: Math.max(b.size, sum / 40), flexBasis: 150, borderLeftColor: r.color }}
                    className={`min-w-0 rounded border border-l-[3px] px-2 py-1 text-left transition ${on ? "border-[#f5b82e] bg-[#f5b82e]/10" : "border-white/10 bg-black/15 hover:border-white/30"} ${gone ? "opacity-50" : ""}`}>
                    <span className="flex items-start gap-1"><span className="line-clamp-2 min-w-0 flex-1 text-[12px] font-medium leading-snug text-white">{b.label}</span><Mark items={b.items} reviews={reviews} /></span>
                    <span className="block truncate text-[11px] tabular-nums text-[#8f99a8]">{b.sub ?? `${b.items.length} ${b.items.length === 1 ? unit.replace(/s$/, "") : unit}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What is missing, and what the plan does without it. Code writes these as "what: so what". */
function Gaps({ items, decide }: { items: Item[]; decide: (i: Item) => ReactNode }) {
  return (
    <div className="space-y-1.5">
      {items.map((i) => {
        const text = String(i.title), at = text.indexOf(": ");
        return (
          <div key={i.key} className="grid items-stretch gap-1 md:grid-cols-[minmax(0,1fr)_20px_minmax(0,1.6fr)_auto]">
            <div className="rounded border border-[#fab219]/50 bg-[#fab219]/[.07] px-2.5 py-1.5 text-[12.5px] font-medium leading-snug text-white">{at > 0 ? text.slice(0, at) : text}</div>
            <div aria-hidden="true" className="hidden items-center justify-center text-[#6f7c8b] md:flex"><Icon name="right" className="h-4 w-4" /></div>
            <div className="rounded border border-white/10 bg-black/15 px-2.5 py-1.5 text-[12.5px] leading-snug text-[#d3d8de]">{at > 0 ? text.slice(at + 2) : ""}</div>
            <div className="flex items-center justify-end pl-1">{decide(i)}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Which documents disagree, and on what: each document joined to each thing it is in conflict over. */
function DocumentGraph({ items, documents, picked, onPick }: { items: Item[]; documents: Rec[]; picked: string; onPick: (key: string) => void }) {
  const [doc, setDoc] = useState("");
  const ids = [...new Set(items.flatMap((i) => i.docs ?? []))].sort();
  const height = Math.max(ids.length * 62, items.length * 46);
  const y = (n: number, of: number) => ((n + 0.5) / of) * 100;
  return (
    <div className="grid grid-cols-[minmax(130px,220px)_minmax(50px,110px)_minmax(0,1fr)]" style={{ height }}>
      <div className="flex flex-col justify-around" role="group" aria-label="Documents">
        {ids.map((id) => {
          const d = documents.find((x) => x.id === id), n = items.filter((i) => i.docs?.includes(id)).length;
          return <button key={id} onClick={() => setDoc(doc === id ? "" : id)} aria-pressed={doc === id} title={docName(d, id)} className={`rounded border px-2 py-1 text-left transition ${doc === id ? "border-[#f5b82e] bg-[#f5b82e]/10" : "border-white/15 bg-black/15 hover:border-white/30"}`}><span className="line-clamp-2 text-[12px] font-medium leading-snug text-white">{docName(d, id)}</span><span className="text-[11px] tabular-nums text-[#8f99a8]">{id} · in {n} conflict{n === 1 ? "" : "s"}</span></button>;
        })}
      </div>
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        {items.flatMap((it, j) => (it.docs ?? []).map((id) => {
          const on = picked === it.key || doc === id, y1 = y(ids.indexOf(id), ids.length), y2 = y(j, items.length);
          return <path key={`${id}-${it.key}`} d={`M0 ${y1} C50 ${y1} 50 ${y2} 100 ${y2}`} fill="none" stroke={on ? GOLD : "#ffffff40"} strokeWidth={on ? 2 : 1} vectorEffect="non-scaling-stroke" />;
        }))}
      </svg>
      <div className="flex min-w-0 flex-col justify-around" role="group" aria-label="What they disagree on">
        {items.map((i) => <button key={i.key} onClick={() => onPick(i.key)} aria-pressed={picked === i.key} className={`truncate rounded border px-2.5 py-1.5 text-left text-[12.5px] font-medium transition ${picked === i.key ? "border-[#f5b82e] bg-[#f5b82e]/10 text-white" : doc && i.docs?.includes(doc) ? "border-[#f5b82e]/60 text-white" : "border-[#fab219]/40 bg-[#fab219]/[.07] text-white hover:border-[#fab219]"}`}>{i.topic}</button>)}
      </div>
    </div>
  );
}

/** Work with nothing linked after it, on the calendar: the hatched stretch is how far its float can only be said to run, to the end of the job. */
function LooseEnds({ items, from, to, picked, onPick, row }: { items: Item[]; from: string; to: string; picked: string; onPick: (key: string) => void; row: (i: Item) => ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#abb3bf]"><span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm" style={{ background: "#3987e555" }} />the work</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, #8f99a866 0 3px, transparent 3px 6px)" }} />nothing after it, up to the end of the job</span></p>
      <div className="divide-y divide-white/[.05]">
        {items.map((i) => (
          <div key={i.key}>
            <button onClick={() => onPick(picked === i.key ? "" : i.key)} aria-expanded={picked === i.key} className="grid w-full grid-cols-[minmax(120px,240px)_minmax(0,1fr)_64px] items-center gap-3 py-1.5 text-left hover:bg-white/[.03]">
              <span className="truncate text-[12.5px] text-white" title={i.label}>{i.label}</span>
              {i.when && <Span start={i.when.start} finish={i.when.finish} from={from} to={to} slack={to} />}
              <span className="text-right text-[11.5px] tabular-nums text-[#abb3bf]">{i.when?.float} days</span>
            </button>
            {picked === i.key && row(i)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** How much of the plan rests on the documents, task by task. */
function Backing({ steps }: { steps: Rec[] }) {
  const none = steps.filter((s) => !(s.sources as Rec[]).length).length, figures = steps.filter((s) => (s.sources as Rec[]).length && ((s.unsourced ?? []) as string[]).length).length;
  const parts: [string, number, string][] = [["cite their pages, nothing flagged", steps.length - none - figures, "#199e70"], ["state figures their pages do not", figures, "#c98500"], ["cite nothing", none, "#e66767"]];
  return (
    <div className="mb-3">
      <Label>Are the {steps.length} tasks backed by the documents?</Label>
      <div className="mt-1.5 flex h-4 gap-[2px] overflow-hidden rounded">{parts.filter(([, n]) => n > 0).map(([label, n, color]) => <span key={label} title={`${n} ${label}`} style={{ flexGrow: n, flexBasis: 4, background: color }} />)}</div>
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#abb3bf]">{parts.map(([label, n, color]) => <span key={label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: color }} /><b className="tabular-nums text-white">{n}</b> {label}</span>)}</p>
    </div>
  );
}

/** The diagram for one thing to check, and below it the items of the block picked, as they always were: their words, their sources, and the decision. */
export function SectionDiagram({ section, plan, reviews, documents, from, to, row, decide }: { section: Section; plan: Rec; reviews: Reviews; documents: Rec[]; from: string; to: string; row: (i: Item) => ReactNode; decide: (i: Item) => ReactNode }) {
  const [picked, setPicked] = useState("");
  const rows = rowsOf(section.items);
  const blocks = rows.flatMap((r) => r.blocks);
  if (!section.items.length) return <p className="px-3 py-4 text-center text-[12.5px] text-[#8f99a8]">Nothing here.</p>;
  if (section.id === "missing") return <div className="p-3"><Gaps items={section.items} decide={decide} /></div>;
  if (section.id === "dependencies") return <div className="p-3"><LooseEnds items={section.items} from={from} to={to} picked={picked} onPick={setPicked} row={row} /></div>;
  const block = blocks.find((b) => b.key === picked || b.items.some((i) => i.key === picked)) ?? blocks[0];
  const between = block.items.filter((i) => i.docs?.length);  // the documents' own disagreements can be drawn; what code flagged has no second document to join
  const shown = between.length > 1 ? between.filter((i) => i.key === picked).concat(block.items.filter((i) => !i.docs?.length)) : block.items;
  const open = between.length > 1 && !between.some((i) => i.key === picked) ? [between[0]].concat(shown) : shown;
  return (
    <div>
      <div className="space-y-3 p-3">
        {section.id === "assumptions" && <Backing steps={plan.steps as Rec[]} />}
        <Tiles rows={rows} reviews={reviews} picked={block.key} onPick={setPicked} worth={section.id === "extracted" ? money : String} unit={section.id === "input" ? "questions" : "items"} />
        {between.length > 1 && <DocumentGraph items={between} documents={documents} picked={between.some((i) => i.key === picked) ? picked : between[0].key} onPick={setPicked} />}
      </div>
      <p className="border-t border-white/5 bg-black/10 px-3 py-1.5 text-[11.5px] font-semibold text-[#d3d8de]">{block.label}{between.length > 1 ? ` · 1 of ${between.length} shown, click another in the diagram` : block.items.length > 1 ? ` · ${block.items.length} items` : ""}</p>
      {open.map((i, n) => <div key={`${i.key}:${n}`}>{row(i)}</div>)}
    </div>
  );
}
