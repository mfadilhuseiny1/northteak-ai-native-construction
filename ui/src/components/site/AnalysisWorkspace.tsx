"use client";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { CATEGORIES, CategorySelect, categoryOf } from "./DocCategory";
import { api, Empty, Kpi, Kpis, Loading, money, notifyChanged, Pill, Problem, quiet, useData, useGo, type Rec } from "./kit";
import { MemoryPanel } from "./MemoryPanel";
import { openSource, SourceLink } from "./SourceDrawer";
import { UploadForm } from "./UploadForm";

/* What Home shows of a project beside the conversation: its documents, and what the agents and code took from them, the executive summary and the BOQ. Everything shown here comes from a real analysis on this project, and each item leads back to its source. It stays a proposal until a person approves it on the Review tab, which also lists the conflicts, gaps and assumptions. The WBS, schedule, dependencies and procedures have their own tabs, so they are not repeated here. */
const head = "whitespace-nowrap px-3 py-2 font-medium";
const cell = "px-3 py-2 align-top text-[#d3d8de]";
const row = "border-t border-white/5 hover:bg-white/[.04]";

function Grid({ heads, children }: { heads: string[]; children: ReactNode }) {
  return <table className="w-full text-left text-[13px]"><thead className="sticky top-0 z-[1] bg-[#1c2733] text-[11px] uppercase tracking-wide text-[#8f99a8]"><tr>{heads.map((h) => <th key={h} className={head}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>;
}

function Note({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" }) {
  return <p className={`shrink-0 border-b border-white/5 px-4 py-2 leading-snug ${tone === "warn" ? "bg-[#fab219]/[.07] text-[#fbd38d]" : "text-[#abb3bf]"}`}>{children}</p>;
}

/* ------------------------------------------------------------------------------------------------ the documents */

/** A document, quietly: only what is out of the ordinary shows. Moving it to another group or leaving it out are rare, so those come up when the row is pointed at. */
function DocRow({ d, act }: { d: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const unread = /no text to read|could not be read|kept as a file/.test(String(d.how_read ?? ""));
  return (
    <div className="group space-y-0.5 border-t border-white/5 px-3 py-1.5 first:border-t-0">
      <button onClick={() => openSource({ doc: d.id, title: d.title })} title={`Open ${d.filename ?? d.title}`} className={`block w-full break-words text-left leading-snug hover:underline ${d.use ? "text-white" : "text-[#8f99a8] line-through decoration-white/30"}`}>{d.title}</button>
      {unread && <p className="text-[11.5px] leading-snug text-[#fbd38d]">{d.how_read}</p>}
      {!d.use && <p className="text-[11.5px] leading-snug text-[#abb3bf]">Left out: the agents do not read it.{d.why ? ` ${d.why}` : ""}</p>}
      <div className="relative min-h-[22px] text-[11.5px] leading-[22px] text-[#8f99a8]">
        {d.pages ? `${d.pages} page${d.pages === 1 ? "" : "s"}` : ""}
        <span className="invisible absolute inset-y-0 right-0 flex w-[212px] items-center gap-1.5 bg-[#1c2733] pl-1.5 group-focus-within:visible group-hover:visible">
          <CategorySelect kind={d.kind} onChange={(kind) => void act(() => api(`/api/project/documents/${d.id}/kind`, { kind }))} />
          <button onClick={() => void act(() => api(`/api/project/documents/${d.id}/use`, { use: !d.use }))} title={d.use ? "Leave it out: it will not go to the agents" : "Send it to the agents"} className={`${quiet} shrink-0 whitespace-nowrap`}>{d.use ? "Leave out" : "Use it"}</button>
        </span>
      </div>
    </div>
  );
}

/** The project's documents by category. Adding is here only once the plan is approved: before that, documents go to the agents with a message, from the box on Home. */
export function Repository({ review, act, activities, missing, canAdd }: { review: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean>; activities: Rec[]; missing: string[]; canAdd: boolean }) {
  const [adding, setAdding] = useState(false);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState(false);
  const docs = review.documents as Rec[];
  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-l border-black/30 bg-[#1c2733] max-lg:w-[250px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1"><p className="font-semibold text-white">Documents</p><p className="text-[11.5px] text-[#8f99a8]">{docs.length} in, {review.used} go to the agents</p></div>
        {canAdd && <button onClick={() => setAdding(true)} className={`${quiet} flex items-center gap-1 !px-2 !py-1 !text-[12px]`}><Icon name="plus" className="h-3 w-3" />Add</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {CATEGORIES.map((c) => {
          const mine = docs.filter((d) => categoryOf(String(d.kind)).id === c.id);
          const open = !shut.has(c.id) && mine.length > 0;
          return (
            <section key={c.id}>
              <button disabled={!mine.length} onClick={() => setShut((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} aria-expanded={open} className={`flex w-full items-center gap-1.5 border-t border-white/5 bg-black/10 px-3 py-1.5 text-left text-[12px] font-medium ${mine.length ? "text-[#d3d8de] hover:text-white" : "text-[#6b7480]"}`}>
                <Icon name={open ? "down" : "right"} className={`h-3 w-3 shrink-0 ${mine.length ? "" : "opacity-0"}`} /><span className="min-w-0 flex-1 truncate">{c.name}</span><span className="tabular-nums">{mine.length || "–"}</span>
              </button>
              {open && mine.map((d) => <DocRow key={d.id} d={d} act={act} />)}
            </section>
          );
        })}
      </div>
      {missing.length > 0 && (
        <div className="max-h-[32%] shrink-0 space-y-1 overflow-y-auto border-t border-white/10 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[#8f99a8]">Not in the package</p>
          {missing.map((m, i) => <p key={i} className="flex items-start gap-1.5 text-[12px] leading-snug text-[#fbd38d]"><Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0" />{m}</p>)}
        </div>
      )}
      <div className="shrink-0 border-t border-white/10">
        <button onClick={() => setMemory(!memory)} aria-expanded={memory} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-medium text-[#d3d8de] hover:text-white"><Icon name={memory ? "down" : "right"} className="h-3 w-3 shrink-0" />What the agents should know</button>
        {memory && <div className="max-h-[40vh] overflow-y-auto px-3 pb-3 text-[12px]"><MemoryPanel /></div>}
      </div>
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label="Add documents" onClick={() => setAdding(false)}>
          <div className="max-h-[92vh] w-full max-w-[520px] space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-[#1c2733] p-4 text-[12px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2"><p className="text-[14px] font-semibold text-white">Add documents</p><button onClick={() => setAdding(false)} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button></div>
            <UploadForm activities={activities} onDone={() => { setAdding(false); notifyChanged(); }} />
          </div>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------------------------------------ what was extracted */

const figure = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** The BoQ's own lines, section by section, each leading to its page. */
function BoqLines({ lines }: { lines: Rec[] }) {
  const sections = [...new Set(lines.map((x) => String(x.section)))];
  const priced = lines.filter((x) => x.amount).length;
  return (
    <div className="space-y-2 p-3">
      <p className="leading-snug text-[#abb3bf]">Code read {lines.length} lines of the BoQ, {priced ? `${priced} of them priced` : "and it states no prices"}. Each leads to its page. They are not yet tied to work packages, and materials are not listed apart from the work.</p>
      {sections.map((s, i) => {
        const mine = lines.filter((x) => String(x.section) === s);
        return (
          <details key={s} open={i === 0} className="rounded border border-white/10 bg-[#1c2733]">
            <summary className="cursor-pointer px-3 py-2 font-medium text-white">{s || "Before the first section"} <span className="ml-1 text-[12px] font-normal tabular-nums text-[#8f99a8]">{mine.length} lines</span></summary>
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-[#8f99a8]"><tr>{["Work", "Volume", "Unit", ...(priced ? ["Rate", "Amount"] : []), "Source"].map((h) => <th key={h} className={head}>{h}</th>)}</tr></thead>
              <tbody>
                {mine.map((x, n) => (
                  <tr key={n} className={row}>
                    <td className={cell}>{x.group && x.group !== mine[n - 1]?.group && <span className="block text-[12px] text-[#8f99a8]">{x.group}</span>}{x.name || <span className="text-[#fbd38d]">Description not readable: open its page</span>}</td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>{figure(Number(x.qty))}</td><td className={cell}>{x.unit}</td>
                    {priced > 0 && <><td className={`${cell} whitespace-nowrap`}>{x.rate ? money(x.rate) : "–"}</td><td className={`${cell} whitespace-nowrap`}>{x.amount ? money(x.amount) : "–"}</td></>}
                    <td className={cell}><SourceLink doc={x.doc} page={x.page}>p.{x.page}</SourceLink></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        );
      })}
    </div>
  );
}

export function BoqSection({ plan, docs }: { plan: Rec; docs: Rec[] }) {
  const accounts = plan.accounts as Rec[];
  const boq = docs.filter((d) => d.use && (d.kind === "boq" || d.kind === "estimate"));
  const owner = accounts.some((a) => a.owner_value);
  const lines = (plan.boq_lines ?? []) as Rec[];
  const valued = accounts.some((a) => a.value);  // with no prices the table of worth is empty, and the BoQ's own lines are what there is to read
  return (
    <>
      {(plan.missing as string[]).filter((m) => /BoQ|quantit/i.test(m)).map((m, i) => <Note key={i} tone="warn">{m}</Note>)}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2 text-[#d3d8de]">
        <span><b className="font-semibold text-white">{plan.total ? money(plan.total) : "No priced total"}</b>{plan.owner_total ? <span className="text-[#abb3bf]"> against the owner&apos;s {money(plan.owner_total)}</span> : null}</span>
        <span className="ml-auto flex flex-wrap gap-1">{boq.map((d) => <SourceLink key={d.id} doc={d.id} page={1} title={String(d.title)} />)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {valued && <Grid heads={["No.", "Work", "Worth", ...(owner ? ["Against the owner's estimate"] : [])]}>
          {accounts.flatMap((a) => [
            <tr key={a.no} className="border-t border-white/10 bg-white/[.03]"><td className={`${cell} font-semibold text-white`}>{a.no}</td><td className={`${cell} font-semibold text-white`}>{a.name}</td><td className={`${cell} whitespace-nowrap font-semibold text-white`}>{a.value ? money(a.value) : "–"}</td>{owner && <td className={cell}>{a.against_owner_pct == null ? "–" : <Pill tone={a.against_owner_pct <= -5 ? "warn" : "none"}>{a.against_owner_pct > 0 ? "+" : ""}{a.against_owner_pct}%</Pill>}</td>}</tr>,
            ...(a.packages as Rec[]).filter((w) => w.no !== a.no).map((w) => <tr key={w.no} className={row}><td className={`${cell} whitespace-nowrap text-[#8f99a8]`}>{w.no}</td><td className={cell}>{w.name}</td><td className={`${cell} whitespace-nowrap`}>{w.value ? money(w.value) : "–"}</td>{owner && <td className={cell} />}</tr>),
          ])}
        </Grid>}
        {lines.length > 0
          ? <BoqLines lines={lines} />
          : <p className="px-4 py-3 text-[12px] leading-snug text-[#8f99a8]">Values are the priced recap spread by the schedule&apos;s weights. This package has no line-by-line BoQ to read.</p>}
      </div>
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded border border-white/10 bg-[#1c2733]"><p className="border-b border-white/5 px-3 py-2 font-semibold text-white">{title}</p>{children}</section>;
}

/** The project on one page. What is written is the project director's, from when the plan was made; the figures are code's, as things stand now. */
export function ExecutiveSummary() {
  const { data, err } = useData("/api/project/executive");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  if (!data.plan) return <Empty>Nothing to summarise yet.</Empty>;
  const written = data.written as Rec | null, path = (data.path ?? []) as Rec[];
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Kpis>
        <Kpi label="Worth" value={data.total ? money(data.total) : "No prices yet"} hint={data.owner_total ? `owner's ${money(data.owner_total)}` : undefined} />
        <Kpi label={data.start ? `${data.start} to ${data.finish}` : "Runs"} value={`${data.days} days`} hint={data.contract_days ? `contract ${data.contract_days}` : undefined} tone={data.contract_days && data.days > data.contract_days ? "bad" : undefined} />
        <Kpi label={`Work packages, in ${data.accounts} control account${data.accounts === 1 ? "" : "s"}`} value={data.work_packages} />
        <Kpi label="Tasks" value={data.tasks} />
        <Kpi label="With no float" value={data.critical} />
        <Kpi label="Conflicts in the documents" value={data.conflicts} tone={data.conflicts ? "warn" : undefined} />
        <Kpi label="Questions drafted" value={data.questions} tone={data.questions ? "warn" : undefined} />
      </Kpis>
      <div className="mx-auto w-full max-w-[860px] space-y-4 px-5 py-5">
        {written ? (written.text as string).split("\n\n").map((p, i) => <p key={i} className="text-[14px] leading-relaxed text-[#e5e8eb]">{p}</p>)
          : <p className="leading-relaxed text-[#abb3bf]">The agents did not write a summary for this analysis, which was made before they did. The figures above are as things stand now.</p>}
        {written && (written.unsourced as string[])?.length > 0 && <p className="rounded bg-[#fab219]/10 px-3 py-2 leading-snug text-[#fbd38d]"><Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />This summary states figures it was not given: {(written.unsourced as string[]).join(", ")}. Check them before quoting it.</p>}
        {written && (written.watch as string[]).length > 0 && (
          <Block title="What to settle first">{(written.watch as string[]).map((w, i) => <p key={i} className="flex items-start gap-2 border-t border-white/5 px-3 py-2 leading-snug text-[#e5e8eb] first:border-t-0"><span className="font-semibold tabular-nums text-[#f5b82e]">{i + 1}</span>{w}</p>)}</Block>
        )}
        {path.length > 0 && (
          <Block title={`The chain that holds the finish date (${path.length})`}>
            <p className="px-3 py-2 leading-relaxed text-[#d3d8de]">{path.map((p) => p.name).join("  →  ")}</p>
            <p className="border-t border-white/5 px-3 py-2"><button onClick={() => go("critical")} className="text-[#9cc7f5] underline">Open the Critical Path</button></p>
          </Block>
        )}
      </div>
    </div>
  );
}
