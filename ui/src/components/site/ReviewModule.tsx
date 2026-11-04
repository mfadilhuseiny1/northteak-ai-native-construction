"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { Running } from "./AnalysisView";
import { api, Empty, field, good, Loading, money, notifyChanged, Pill, primary, Problem, quiet, useData, useGo, type Rec } from "./kit";
import { SourceLink } from "./SourceDrawer";
import { ContractChecklist } from "./ContractChecklist";
import { TenderSelection } from "./TenderSelection";

/* Review: what the agents and code propose, sorted by what a project manager has to do about it, one item or a whole section at a time. The plan as a whole is what gets approved. Until then nothing reaches the board. Each section says what a decision there changes, because some change the plan and some only stand on the record. */

type Item = { key: string; title: ReactNode; detail?: ReactNode; sources?: Rec[]; edit?: { label: string; value: string }; link?: ReactNode };
type Section = { id: string; title: string; what: string; items: Item[] };

const CONFLICT = /^(stated_|owner_|revoked_|order_|links$|time$|boq_uncovered_|boq_other_work$|wbs_gap_|wbs_rows$|model3d_absent$)/;
const SKIP = /^(missing_|links_open$|links_read$)/;
const BTN = "!px-2 !py-0.5 !text-[12px]";

function Decide({ verdict, onSet }: { verdict?: string; onSet: (v: string) => void }) {
  const one = (v: string, label: string, on: string, icon: "check" | "x") => (
    <button onClick={() => onSet(verdict === v ? "clear" : v)} aria-pressed={verdict === v} title={verdict === v ? "Take the decision back" : label} className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[12px] ${verdict === v ? on : "border-white/15 text-[#d3d8de] hover:bg-white/5"}`}><Icon name={icon} className="h-3 w-3" />{label}</button>
  );
  return <span className="flex shrink-0 gap-1">{one("approve", "Accept", "border-[#29a383] bg-[#29a383]/25 text-white", "check")}{one("reject", "Reject", "border-[#e5484d] bg-[#e5484d]/25 text-white", "x")}</span>;
}

function ItemRow({ item, verdict, open, onSet, onSave }: { item: Item; verdict?: string; open: boolean; onSet: (v: string) => void; onSave: (text: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.edit?.value ?? "");
  return (
    <div className={`flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-white/5 px-3 py-2 ${verdict === "reject" ? "opacity-60" : ""}`}>
      <div className="min-w-[280px] flex-1 space-y-1">
        <div className="leading-snug text-white">{item.title}</div>
        {item.detail && <div className="leading-snug text-[#abb3bf]">{item.detail}</div>}
        {item.edit && !editing && <p className="flex flex-wrap items-center gap-1.5 text-[#d3d8de]"><span className="text-[#8f99a8]">{item.edit.label}:</span> {item.edit.value || "not stated"}{open && <button onClick={() => { setText(item.edit?.value ?? ""); setEditing(true); }} className="flex items-center gap-1 text-[12px] text-[#9cc7f5] hover:underline"><Icon name="pencil" className="h-3 w-3" />Edit</button>}</p>}
        {editing && (
          <div className="flex flex-wrap items-center gap-1.5">
            <textarea value={text} rows={text.length > 70 ? 3 : 1} aria-label={item.edit?.label} onChange={(e) => setText(e.target.value)} className={`${field} min-w-[240px] flex-1 !text-[13px]`} />
            <button disabled={!text.trim()} onClick={async () => { if (await onSave(text)) setEditing(false); }} className={`${primary} ${BTN}`}>Save</button>
            <button onClick={() => setEditing(false)} className={`${quiet} ${BTN}`}>Cancel</button>
          </div>
        )}
        {(item.sources?.length ?? 0) > 0 && <span className="flex flex-wrap gap-1">{(item.sources as Rec[]).map((s, i) => <SourceLink key={i} doc={s.doc} page={s.page} quote={s.quote} />)}</span>}
        {item.link}
      </div>
      {open ? <Decide verdict={verdict} onSet={onSet} /> : verdict && <Pill tone={verdict === "approve" ? "ok" : "bad"}>{verdict === "approve" ? "accepted" : "rejected"}</Pill>}
    </div>
  );
}

function sectionsOf(rec: Rec, cp: Rec, go: (to: string) => void): Section[] {
  const plan = rec.plan as Rec;
  const packages = (plan.packages ?? {}) as Record<string, Rec>;
  const rows = (cp.activities ?? []) as Rec[];
  const tree = (plan.tree ?? []) as Rec[];
  const worth = Object.fromEntries((plan.accounts as Rec[]).flatMap((a) => a.packages as Rec[]).map((w) => [w.no, w.value]));
  const tasks = plan.steps as Rec[];
  const checks = (plan.checks as Rec[]).filter((c) => !c.ok && !SKIP.test(String(c.rule)));
  const flag = (c: Rec): Item => ({ key: `check:${c.rule}`, title: c.text });
  const successors = new Set(rows.flatMap((r) => r.after as string[]));
  const finish = String(cp.finish ?? "");
  const lateBy = (d: string) => (finish ? (new Date(finish).getTime() - new Date(d).getTime()) / 864e5 : 0);
  const loose = rows.filter((r) => !successors.has(r.id) && lateBy(String(r.ef)) >= 14);  // as the analysis counts them: work that ends with the job has nothing to come after it
  const whose = Object.fromEntries(tree.map((b) => [b.activity, b]));
  return [
    { id: "extracted", title: "Extracted work packages", what: "Rejecting one keeps it in the consultant's schedule, but puts none of its tasks on the board when you approve the plan. To change its dates or links, use the Timeline tab.", items: tree.map((b) => {
      const r = rows.find((x) => x.id === b.activity);
      const count = tasks.filter((s) => s.activity === b.activity).length;
      const p = packages[b.activity] ?? {};
      return { key: `wp:${b.activity}`, title: <><span className="mr-1.5 font-mono text-[11.5px] text-[#8f99a8]">{b.code}</span>{b.name}</>, detail: `${r ? `${r.es} to ${r.ef}, ${r.duration} days · ` : ""}${count} task${count === 1 ? "" : "s"}${worth[p.no] ? ` · ${money(worth[p.no])}` : ""}`, edit: { label: "Answers for it", value: String(p.responsible ?? "") }, sources: ((p.references ?? []) as Rec[]).slice(0, 3).map((x) => ({ doc: x.doc, page: x.from })) };
    }) },
    { id: "missing", title: "Missing information", what: "Your decision is recorded on the plan. It changes nothing else.", items: ((plan.missing ?? []) as string[]).map((m, i) => ({ key: `missing:${i}`, title: m })) },
    { id: "conflicts", title: "Conflicts between documents", what: "Your decision is recorded on the plan. It changes nothing else. To settle one with the consultant, use the question drafted under Needs your input.", items: [...(rec.findings as Rec[]).map((f, i): Item => ({ key: `finding:${i}`, title: f.subject, detail: f.note, sources: f.sources as Rec[] })), ...checks.filter((c) => CONFLICT.test(String(c.rule))).map(flag)] },
    { id: "dependencies", title: "Unresolved dependencies", what: "Nothing is linked after these, so their float only says how far they are from the end of the job. Accept one if that is right, or add the link on the Timeline tab.", items: loose.map((r) => ({ key: `dep:${r.id}`, title: <><span className="mr-1.5 font-mono text-[11.5px] text-[#8f99a8]">{r.code}</span>{r.name}</>, detail: `Finishes ${r.ef}, float ${r.float_days} days`, link: <button onClick={() => go(`gantt:${r.id}`)} className="text-[12px] text-[#9cc7f5] hover:underline">Open it on the Timeline</button> })) },
    { id: "assumptions", title: "Unverified AI assumptions", what: "Your decision is recorded on the plan. It changes nothing else. A task's figures can be corrected on the board once the plan is approved.", items: [
      ...checks.filter((c) => !CONFLICT.test(String(c.rule))).map(flag),
      ...tasks.filter((s) => !(s.sources as Rec[]).length).map((s): Item => ({ key: `task:${s.id}`, title: `${s.id} ${s.name}`, detail: `Cites nothing in the documents, under ${whose[s.activity]?.name ?? s.activity}.` })),
      ...tasks.filter((s) => ((s.unsourced ?? []) as string[]).length > 0).map((s): Item => ({ key: `figure:${s.id}`, title: `${s.id} ${s.name}`, detail: `States figures its pages do not: ${(s.unsourced as string[]).join(", ")}.`, sources: (s.sources as Rec[]).slice(0, 2) })),
      ...Object.entries(packages).flatMap(([aid, p]) => ((p.assumptions ?? []) as string[]).map((a, i): Item => ({ key: `assume:${aid}:${i}`, title: a, detail: whose[aid]?.name }))),
    ] },
    { id: "input", title: "Needs your input", what: "Questions drafted for the consultant, because the documents do not settle them. Edit the wording as you like. Rejecting one drops the draft when you approve the plan. Nothing is sent until a person issues it.", items: (rec.rfi_drafts as Rec[]).map((q, i): Item => ({ key: `q:${i}`, title: q.subject, edit: { label: "Question", value: String(q.question) }, detail: `To ${q.to}${q.activity ? `, on ${q.activity}` : ""}` })) },
  ];
}

export function ReviewModule() {
  const { data, err, act } = useData("/api/project/plans");
  const run = useData("/api/aip/analysis");
  const cpm = useData("/api/project/critical-path");
  const go = useGo();
  const [open, setOpen] = useState<Set<string>>(new Set(["conflicts"]));
  const [note, setNote] = useState("");
  const list = (data?.plans ?? []) as Rec[];
  const rec = list.find((p) => p.status === "pending") ?? list.find((p) => p.status === "approved") ?? list.find((p) => p.status !== "superseded");
  const sections = useMemo(() => (rec && cpm.data ? sectionsOf(rec, cpm.data, go) : []), [rec, cpm.data, go]);
  if (run.data?.run?.status === "running") return <Running data={run.data} onStop={() => void api(`/api/aip/runs/${run.data?.run.id}/cancel`, {}).then(() => run.reload())} />;
  if (!data || !cpm.data) return <div className="flex-1 bg-[#111820]"><Problem err={err || cpm.err} />{!err && !cpm.err && <Loading />}</div>;
  if (!rec) return <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#111820] p-3 text-[13px]"><Empty>Nothing to review yet. <button onClick={() => go("home")} className="underline">Start on Home</button>.</Empty><TenderSelection /><ContractChecklist /></div>;
  const pending = rec.status === "pending";
  const reviews = (rec.reviews ?? {}) as Record<string, Rec>;
  const send = (keys: string[], verdict: string) => act(() => api(`/api/project/plans/${rec.id}/review`, { keys, verdict }));
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const decided = sections.reduce((n, s) => n + s.items.filter((i) => reviews[i.key]).length, 0);
  const rejected = sections[0]?.items.filter((i) => reviews[i.key]?.verdict === "reject").length ?? 0;
  const conflicts = sections.find((s) => s.id === "conflicts");
  const unread = conflicts?.items.filter((i) => !reviews[i.key]).length ?? 0;
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111820] text-[13px]">
      <Problem err={err} />
      <div data-tour="proposal" className="shrink-0 border-b border-white/10 bg-[#1c2733] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-[240px] flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-white">Review the proposal <Pill tone={pending ? "warn" : rec.status === "approved" ? "ok" : "bad"}>{pending ? "waiting for you" : rec.status}</Pill></p>
            <p className="truncate text-[#abb3bf]">{rec.summary}</p>
          </div>
          <span className="flex shrink-0 gap-1">
            <a href={`${API_URL}/api/project/plans/${rec.id}/procedure.md`} download={`${rec.id}-procedure.md`} className={`${quiet} ${BTN}`}>Procedure</a>
            <a href={`${API_URL}/api/project/plans/${rec.id}/table.csv`} download={`${rec.id}-tasks.csv`} className={`${quiet} ${BTN}`}>Spreadsheet</a>
          </span>
          {pending && <>
            <span className="shrink-0 tabular-nums text-[#d3d8de]">{decided} of {total} reviewed</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your reason, if you reject it" aria-label="Your reason" className={`${field} !w-[220px] !py-1`} />
            <button onClick={() => act(() => api(`/api/project/plans/${rec.id}/reject`, { note }))} className={`${quiet} !px-3 !py-1.5 !text-[12.5px]`}>Reject the plan</button>
            <button onClick={() => act(() => api(`/api/project/plans/${rec.id}/approve`, { note })).then((ok) => { if (ok) notifyChanged(); })} title="This puts the tasks on the Kanban board and plans the inspections. The WBS, Timeline, Critical Path, Kanban and 3D Timeline all read the same work packages." className={`${good} !px-3 !py-1.5 !text-[12.5px]`}>Approve the plan</button>
          </>}
          {rec.status === "approved" && <button onClick={() => go("wbs/packages")} className={`${primary} !px-3 !py-1.5 !text-[12.5px]`}>Open the workspace</button>}
          {rec.status === "rejected" && <button onClick={() => go("home")} className={`${primary} !px-3 !py-1.5 !text-[12.5px]`}>Tell the agents what to change</button>}
        </div>
        {pending && (unread > 0 || rejected > 0) && <p className="mt-1.5 text-[12.5px] text-[#fbd38d]">{unread > 0 ? `${unread} conflict${unread === 1 ? "" : "s"} between the documents not yet looked at. ` : ""}{rejected > 0 ? `${rejected} work package${rejected === 1 ? "" : "s"} you rejected will get no tasks.` : ""}</p>}
        {rec.status === "approved" && <p className="mt-1.5 leading-snug text-[#7ee2c0]"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />Approved by {rec.decided_by}, {rec.decided_at}. {(rec.effects as string[]).join(" ")}</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {sections.map((s) => {
          const shown = open.has(s.id), done = s.items.filter((i) => reviews[i.key]).length, keys = s.items.map((i) => i.key);
          return (
            <section key={s.id} className="rounded-lg border border-white/10 bg-[#1c2733]">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button onClick={() => toggle(s.id)} aria-expanded={shown} className="flex min-w-[220px] flex-1 items-center gap-2 text-left font-semibold text-white hover:text-[#d9d3ff]">
                  <Icon name={shown ? "down" : "right"} className="h-3.5 w-3.5 shrink-0 text-[#8f99a8]" />{s.title}
                  <span className="rounded-full bg-white/10 px-2 text-[12px] font-normal tabular-nums text-[#c5cbd3]">{s.items.length}</span>
                  {done > 0 && <span className="text-[12px] font-normal tabular-nums text-[#8f99a8]">{done} reviewed</span>}
                </button>
                {pending && s.items.length > 0 && <span className="flex shrink-0 gap-1">
                  <button onClick={() => void send(keys, "approve")} className={`${quiet} ${BTN}`}>Accept all</button>
                  <button onClick={() => void send(keys, "reject")} className={`${quiet} ${BTN}`}>Reject all</button>
                  {done > 0 && <button onClick={() => void send(keys, "clear")} className={`${quiet} ${BTN}`}>Clear</button>}
                </span>}
              </div>
              {shown && <>
                <p className="border-t border-white/5 bg-black/10 px-3 py-1.5 text-[12px] leading-snug text-[#8f99a8]">{s.what}</p>
                {s.items.map((i) => <ItemRow key={i.key} item={i} verdict={reviews[i.key]?.verdict} open={pending} onSet={(v) => void send([i.key], v)} onSave={(text) => act(() => api(`/api/project/plans/${rec.id}/edit`, { key: i.key, text }))} />)}
                {!s.items.length && <Empty>Nothing here.</Empty>}
              </>}
            </section>
          );
        })}
        <TenderSelection />
        <ContractChecklist />
      </div>
    </div>
  );
}
