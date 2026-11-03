"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Running } from "./AnalysisView";
import { CpmNetwork, linkReasons } from "./CpmNetwork";
import { CATEGORIES, CategorySelect, categoryOf } from "./DocCategory";
import { api, Empty, Loading, money, notifyChanged, Pill, primary, Problem, quiet, useData, useGo, type Rec } from "./kit";
import { MemoryPanel } from "./MemoryPanel";
import { NodePanel } from "./NodePanel";
import { ProceduresModule } from "./ProceduresModule";
import { ProjectStart } from "./ProjectStart";
import { openSource, SourceLink } from "./SourceDrawer";
import { UploadForm } from "./UploadForm";
import { planTree, WbsDiagram } from "./WbsDiagram";
import { Dictionary } from "./WbsViews";

/* The analysis workspace: on the left the consultant's documents, in the middle what the agents and code took from them, and beside it the copilot, which the page around this holds. Everything shown here comes from a real analysis on this project, and each item leads back to its source. It stays a proposal until a person approves it on the Review tab. */

const SECTIONS: [string, string][] = [["scope", "Scope"], ["wbs", "WBS and Activities"], ["schedule", "Schedule"], ["deps", "Dependencies"], ["boq", "BOQ and Costs"], ["eng", "Engineering"], ["proc", "Procedures"], ["risks", "Risks and Constraints"]];
const head = "whitespace-nowrap px-3 py-2 font-medium";
const cell = "px-3 py-2 align-top text-[#d3d8de]";
const row = "border-t border-white/5 hover:bg-white/[.04]";

function Grid({ heads, children }: { heads: string[]; children: ReactNode }) {
  return <table className="w-full text-left text-[13px]"><thead className="sticky top-0 z-[1] bg-[#1c2127] text-[11px] uppercase tracking-wide text-[#8f99a8]"><tr>{heads.map((h) => <th key={h} className={head}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>;
}

function Note({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" }) {
  return <p className={`shrink-0 border-b border-white/5 px-4 py-2 leading-snug ${tone === "warn" ? "bg-[#fab219]/[.07] text-[#fbd38d]" : "text-[#abb3bf]"}`}>{children}</p>;
}

/* ------------------------------------------------------------------------------------------------ the documents */

function DocRow({ d, act }: { d: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const unread = /no text to read|could not be read|kept as a file/.test(String(d.how_read ?? ""));
  return (
    <div className={`space-y-1 border-t border-white/5 px-3 py-2 first:border-t-0 ${d.use ? "" : "opacity-70"}`}>
      <button onClick={() => openSource({ doc: d.id, title: d.title })} title={`Open ${d.filename ?? d.title}`} className="block w-full text-left leading-snug text-white hover:underline">{d.title}</button>
      <p className="text-[11.5px] text-[#8f99a8]">{d.pages ? `${d.pages} page${d.pages === 1 ? "" : "s"} · ` : ""}in on {d.date}</p>
      {unread && <p className="text-[11.5px] leading-snug text-[#fbd38d]">{d.how_read}</p>}
      <p className={`text-[11.5px] leading-snug ${d.use ? "text-[#7ee2c0]" : "text-[#abb3bf]"}`}>{d.use ? "The agents read it" : `Set aside. ${d.why ?? ""}`}</p>
      <div className="flex items-center gap-1.5">
        <CategorySelect kind={d.kind} onChange={(kind) => void act(() => api(`/api/project/documents/${d.id}/kind`, { kind }))} />
        <button onClick={() => void act(() => api(`/api/project/documents/${d.id}/use`, { use: !d.use }))} title={d.use ? "Leave it out: it will not go to the agents" : "Send it to the agents"} className={`${quiet} shrink-0 whitespace-nowrap`}>{d.use ? "Leave out" : "Use it"}</button>
      </div>
    </div>
  );
}

function Repository({ review, act, activities }: { review: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean>; activities: Rec[] }) {
  const [adding, setAdding] = useState(false);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState(false);
  const docs = review.documents as Rec[];
  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-black/30 bg-[#1c2127]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1"><p className="font-semibold text-white">Documents</p><p className="text-[11.5px] text-[#8f99a8]">{docs.length} in, {review.used} go to the agents</p></div>
        <button onClick={() => setAdding(true)} className={`${quiet} flex items-center gap-1 !px-2 !py-1 !text-[12px]`}><Icon name="plus" className="h-3 w-3" />Add</button>
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
      {(review.missing as string[]).length > 0 && (
        <div className="max-h-[32%] shrink-0 space-y-1 overflow-y-auto border-t border-white/10 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[#8f99a8]">Not in the package</p>
          {(review.missing as string[]).map((m, i) => <p key={i} className="flex items-start gap-1.5 text-[12px] leading-snug text-[#fbd38d]"><Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0" />{m}</p>)}
        </div>
      )}
      <div className="shrink-0 border-t border-white/10">
        <button onClick={() => setMemory(!memory)} aria-expanded={memory} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-medium text-[#d3d8de] hover:text-white"><Icon name={memory ? "down" : "right"} className="h-3 w-3 shrink-0" />What the agents should know</button>
        {memory && <div className="max-h-[40vh] overflow-y-auto px-3 pb-3 text-[12px]"><MemoryPanel /></div>}
      </div>
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label="Add documents" onClick={() => setAdding(false)}>
          <div className="max-h-[92vh] w-full max-w-[520px] space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-[#1c2127] p-4 text-[12px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2"><p className="text-[14px] font-semibold text-white">Add documents</p><button onClick={() => setAdding(false)} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button></div>
            <UploadForm activities={activities} onDone={() => { setAdding(false); notifyChanged(); }} />
          </div>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------------------------------------ what was extracted */

function ScheduleSection({ plan, cp, docs, onOpen }: { plan: Rec; cp: Rec; docs: Rec[]; onOpen: (code: string) => void }) {
  const checks = plan.checks as Rec[];
  const code = checks.some((c) => c.rule === "schedule_read" && c.ok);
  const programme = docs.find((d) => d.kind === "programme");
  const source = (no: string) => {
    if (checks.some((c) => c.rule === `order_${no}`)) return <Pill tone="warn">moved by a person</Pill>;
    if (checks.some((c) => String(c.rule).startsWith("split_") && no.startsWith(`${String(c.rule).slice(6)}.`))) return <Pill tone="violet">agent&apos;s estimate, within its row</Pill>;
    if (code && programme) return <SourceLink doc={programme.id} page={1} title="Master schedule" />;
    return <Pill tone="violet">agent&apos;s estimate</Pill>;
  };
  const rows = [...(cp.activities as Rec[])].sort((a, b) => String(a.es).localeCompare(String(b.es)) || String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  return (
    <>
      <Note>{cp.days} days, against {plan.contract_days ?? "an unknown number of"} in the contract. Dates count from the project&apos;s start, {cp.start}, because the documents give weeks.</Note>
      <div className="min-h-0 flex-1 overflow-auto">
        <Grid heads={["WBS", "Work package", "Start", "Finish", "Days", "Float", "Source"]}>
          {rows.map((r) => {
            const no = String((plan.packages as Record<string, Rec>)?.[r.id]?.no ?? "");
            return (
              <tr key={r.id} onClick={() => onOpen(r.code)} className={`${row} cursor-pointer`}>
                <td className={`${cell} whitespace-nowrap font-mono text-[11.5px] text-[#8f99a8]`}>{r.code}</td><td className={`${cell} text-white`}>{r.name}</td>
                <td className={`${cell} whitespace-nowrap tabular-nums`}>{r.es}</td><td className={`${cell} whitespace-nowrap tabular-nums`}>{r.ef}</td><td className={`${cell} tabular-nums`}>{r.duration}</td>
                <td className={cell}>{r.critical ? <Pill tone="bad">none</Pill> : <span className="tabular-nums">{r.float_days}</span>}</td><td className={cell}>{source(no)}</td>
              </tr>
            );
          })}
        </Grid>
      </div>
    </>
  );
}

function DepsSection({ plan, cp, onOpen }: { plan: Rec; cp: Rec; onOpen: (code: string) => void }) {
  const rows = cp.activities as Rec[];
  const of = (no: string) => { const id = Object.entries((plan.packages ?? {}) as Record<string, Rec>).find(([, v]) => v.no === no)?.[0]; return rows.find((r) => r.id === id); };
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="px-3"><CpmNetwork rows={rows} path={cp.path as Rec[]} reasons={linkReasons(plan)} onOpen={onOpen} /></div>
      <Grid heads={["Must come first", "Then", "Why"]}>
        {(plan.links as Rec[]).map((l) => (
          <tr key={`${l.before}-${l.after}`} className={row}><td className={cell}>{of(l.before)?.code} {of(l.before)?.name ?? l.before}</td><td className={cell}>{of(l.after)?.code} {of(l.after)?.name ?? l.after}</td><td className={`${cell} text-[#abb3bf]`}>{l.why}</td></tr>
        ))}
      </Grid>
    </div>
  );
}

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
          <details key={s} open={i === 0} className="rounded border border-white/10 bg-[#1c2127]">
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

function BoqSection({ plan, docs }: { plan: Rec; docs: Rec[] }) {
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

function EngineeringSection({ plan }: { plan: Rec }) {
  const steps = (plan.steps as Rec[]).filter((s) => s.criteria || s.hold_point);
  const branches = (plan.tree as Rec[]).filter((b) => steps.some((s) => s.activity === b.activity));
  if (!steps.length) return <Empty>The planners stated no acceptance criteria.</Empty>;
  return (
    <>
      <Note>What each piece of work must meet and how it is checked, in the words of the pages the planners read. Hold points stop the work until signed.</Note>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {branches.map((b) => (
          <section key={b.activity} className="rounded border border-white/10 bg-[#1c2127]">
            <p className="border-b border-white/5 px-3 py-2 font-medium text-white"><span className="mr-1.5 font-mono text-[11.5px] font-normal text-[#8f99a8]">{b.code}</span>{b.name}</p>
            {steps.filter((s) => s.activity === b.activity).map((s) => (
              <div key={s.id} className="space-y-1 border-t border-white/5 px-3 py-2 first:border-t-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[#e5e8eb]">{s.name}{s.hold_point && <Pill tone="bad">hold point</Pill>}</p>
                {s.criteria && <p className="leading-snug text-[#abb3bf]">{s.criteria}</p>}
                <span className="flex flex-wrap gap-1">{(s.sources as Rec[]).map((x, i) => <SourceLink key={i} doc={x.doc} page={x.page} quote={x.quote} />)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

export function FindingCard({ f }: { f: Rec }) {
  return (
    <div className="space-y-1 border-t border-white/5 px-3 py-2 first:border-t-0">
      <p className="font-medium text-white">{f.subject}</p>
      <p className="leading-snug text-[#d3d8de]">{f.note}</p>
      <span className="flex flex-wrap gap-1">{((f.sources ?? []) as Rec[]).map((s, i) => <SourceLink key={i} doc={s.doc} page={s.page} quote={s.quote} />)}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded border border-white/10 bg-[#1c2127]"><p className="border-b border-white/5 px-3 py-2 font-semibold text-white">{title}</p>{children}</section>;
}

function RisksSection({ rec, plan }: { rec: Rec; plan: Rec }) {
  const go = useGo();
  const flagged = (plan.checks as Rec[]).filter((c) => !c.ok);
  const findings = rec.findings as Rec[], obligations = (plan.obligations ?? []) as Rec[];
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <Block title={`Where the documents disagree (${findings.length})`}>{findings.map((f, i) => <FindingCard key={i} f={f} />)}{!findings.length && <Empty>None found.</Empty>}</Block>
      <Block title={`What code flagged (${flagged.length})`}>{flagged.map((c) => <p key={c.rule} className="flex items-start gap-2 border-t border-white/5 px-3 py-2 leading-snug text-[#e5e8eb] first:border-t-0"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fbd38d]" />{c.text}</p>)}{!flagged.length && <Empty>Nothing flagged.</Empty>}</Block>
      {obligations.length > 0 && <Block title={`What the contract and regulations require (${obligations.length})`}><p className="px-3 py-2 text-[#abb3bf]">Before work starts, while it runs and at handover, with the package&apos;s own words for each. <button onClick={() => go("procedures")} className="text-[#9cc7f5] underline">Read them in Procedures</button></p></Block>}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ the workspace */

export function AnalysisWorkspace() {
  const sorted = useData("/api/project/package");
  const run = useData("/api/aip/analysis");
  const plans = useData("/api/project/plans");
  const cpm = useData("/api/project/critical-path");
  const uploads = useData("/api/project/documents");
  const go = useGo();
  const [section, setSection] = useState("scope");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const running = run.data?.run?.status === "running";
  const poll = run.reload;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void poll(), 1500);
    return () => { clearInterval(t); notifyChanged(); };
  }, [running, poll]);
  const err = sorted.err || run.err || plans.err || cpm.err || problem;
  if (!sorted.data || !run.data || !plans.data || !cpm.data) return <div className="flex-1 bg-[#161a1f]"><Problem err={err} />{!err && <Loading />}</div>;
  const review = sorted.data as Rec, docs = review.documents as Rec[];
  if (!docs.length && !running) return <ProjectStart create={false} />;
  const list = plans.data.plans as Rec[];
  const rec = list.find((p) => p.status === "approved") ?? list.find((p) => p.status === "pending") ?? null;
  const last = list.find((p) => p.status !== "superseded");
  const plan = rec?.plan as Rec | undefined;
  const start = async () => {
    setBusy(true); setProblem("");
    try { await api("/api/aip/konsultan", { nama: "Analysis of the documents", versi: "muse", jenis: "package" }); await run.reload(); } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  const failed = run.data.run && ["failed", "cancelled"].includes(run.data.run.status) && !rec;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[13px]">
      <Repository review={review} act={sorted.act} activities={(uploads.data?.activities ?? []) as Rec[]} />
      <main className="flex min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#161a1f]">
          <Problem err={err} />
          {running ? <Running data={run.data} onStop={() => void api(`/api/aip/runs/${run.data?.run.id}/cancel`, {}).then(() => run.reload())} /> : !plan ? (
            <div className="m-auto max-w-[560px] space-y-3 p-6 text-center">
              <p className="text-[18px] font-semibold text-white">{failed ? "The last analysis did not finish" : last?.status === "rejected" ? "You rejected the last proposal" : `${review.used} document${review.used === 1 ? " is" : "s are"} ready to analyze`}</p>
              <p className="leading-relaxed text-[#abb3bf]">{failed ? String((run.data.problems as string[])[0] ?? "Nothing was kept from it. You can try again.") : last?.status === "rejected" ? "The agents remember your reason. Change the documents if you need to, and analyze again." : "The agents read the documents and propose the WBS, the schedule, the critical path, the cost structure and the procedures. Nothing becomes the baseline until you approve it."}</p>
              <button disabled={busy || !review.used} title="This sends the pages the agents need to the Meta Model API, and uses API credit." onClick={() => void start()} className={`${primary} !px-4 !py-2 !text-[13.5px]`}>{busy ? "Starting…" : "Analyze the documents"}</button>
              <p className="text-[12px] text-[#8f99a8]">This sends the pages the agents need to the Meta Model API, and uses API credit.</p>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-[#1c2127] px-4 py-2">
                <Pill tone={rec?.status === "approved" ? "ok" : "warn"}>{rec?.status === "approved" ? "approved" : "proposal"}</Pill>
                <span className="min-w-0 truncate text-[#d3d8de]">{rec?.summary}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {rec?.status === "pending" && <button disabled={busy} title="A new analysis reads the documents as they stand now, and replaces this proposal. It uses API credit." onClick={() => void start()} className={`${quiet} !px-2.5 !py-1 !text-[12.5px]`}>{busy ? "Starting…" : "Analyze again"}</button>}
                  <button onClick={() => go(rec?.status === "approved" ? "list" : "review")} className={`${primary} !px-3 !py-1 !text-[12.5px]`}>{rec?.status === "approved" ? "Open the workspace" : "Review and approve"}</button>
                </span>
              </div>
              <nav className="flex shrink-0 flex-wrap gap-0.5 border-b border-white/10 bg-[#1c2127] px-2 pt-1" aria-label="What was extracted">
                {SECTIONS.map(([k, label]) => <button key={k} onClick={() => setSection(k)} aria-current={section === k ? "page" : undefined} className={`shrink-0 whitespace-nowrap rounded-t px-2.5 py-1.5 text-[12.5px] ${section === k ? "bg-[#161a1f] font-medium text-white" : "text-[#abb3bf] hover:text-white"}`}>{label}</button>)}
              </nav>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {section === "scope" && <Dictionary />}
                {section === "wbs" && <div className="min-h-0 flex-1 overflow-auto"><WbsDiagram root={planTree(plan)} hide={["section", "task"]} sel={sel} onSelect={setSel} /></div>}
                {section === "schedule" && <ScheduleSection plan={plan} cp={cpm.data} docs={docs} onOpen={setSel} />}
                {section === "deps" && <DepsSection plan={plan} cp={cpm.data} onOpen={setSel} />}
                {section === "boq" && <BoqSection plan={plan} docs={docs} />}
                {section === "eng" && <EngineeringSection plan={plan} />}
                {section === "proc" && <ProceduresModule />}
                {section === "risks" && <RisksSection rec={rec as Rec} plan={plan} />}
              </div>
            </>
          )}
        </div>
        {sel && plan && !running && <NodePanel key={sel} code={sel} onClose={() => setSel(null)} />}
      </main>
    </div>
  );
}
