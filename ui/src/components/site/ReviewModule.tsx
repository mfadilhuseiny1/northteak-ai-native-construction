"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { api, Empty, field, good, Loading, money, notifyChanged, Pill, primary, Problem, quiet, useData, useGo, type Rec } from "./kit";
import { SourceLink } from "./SourceDrawer";
import { ContractChecklist } from "./ContractChecklist";
import { EquipmentList } from "./EquipmentList";
import { ReviewFlow, SectionDiagram, type Item, type Section } from "./ReviewMap";
import { SwarmModule } from "./SwarmModule";
import { TenderSelection } from "./TenderSelection";
import { hue, OTHER } from "./Visual";

/* Review: what the agents and code propose, sorted by what a project manager has to do about it, one item or a whole section at a time. The plan as a whole is what gets approved. Until then nothing reaches the board. Each section says what a decision there changes, because some change the plan and some only stand on the record. */

/* Kinds of conflict, as a person would name them. What the documents themselves disagree on comes first. */
const KINDS: [RegExp, string][] = [[/^wbs_/, "Asked for, not in the schedule"], [/^revoked_/, "Cites a revoked regulation"], [/^owner_/, "Far from the owner's estimate"], [/^(links$|order_|time$)/, "Order of the work"], [/^(boq_|model3d_)/, "Not covered by the BoQ or the 3D"]];
const DISAGREE = "The documents disagree";
const URGENCY: Record<string, [string, string]> = { stop: ["Stops work", "#e5484d"], rework: ["Risks rework", "#c98500"], clarify: ["Worth confirming", OTHER] };

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
        {item.edit && !editing && <p className="flex flex-wrap items-center gap-1.5 text-[#d3d8de]"><span className="text-[#8f99a8]">{item.edit.label}:</span> <span className="whitespace-pre-line">{item.edit.value || "not stated"}</span>{open && <button onClick={() => { setText(item.edit?.value ?? ""); setEditing(true); }} className="flex items-center gap-1 text-[12px] text-[#9cc7f5] hover:underline"><Icon name="pencil" className="h-3 w-3" />Edit</button>}</p>}
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

function sectionsOf(rec: Rec, cp: Rec, go: (to: string) => void, documents: Rec[]): Section[] {
  const plan = rec.plan as Rec;
  const packages = (plan.packages ?? {}) as Record<string, Rec>;
  const rows = (cp.activities ?? []) as Rec[];
  const tree = (plan.tree ?? []) as Rec[];
  const worth = Object.fromEntries((plan.accounts as Rec[]).flatMap((a) => a.packages as Rec[]).map((w) => [w.no, w.value]));
  const tasks = plan.steps as Rec[];
  const checks = (plan.checks as Rec[]).filter((c) => !c.ok && !SKIP.test(String(c.rule)));
  const flag = (c: Rec): Item => ({ key: `check:${c.rule}`, title: c.text });
  const accounts = plan.accounts as Rec[];
  const accountOf = (no?: string) => accounts.findIndex((a) => (a.packages as Rec[]).some((w) => w.no === no));
  const inAccount = (no?: string) => { const n = accountOf(no); return n < 0 ? { row: "The whole job", color: OTHER } : { row: String(accounts[n].name), color: hue(n) }; };
  const wpOf = Object.fromEntries(tree.map((b) => [packages[b.activity]?.no, b]));
  const plain = (name: unknown, no?: string) => { const a = accounts[accountOf(no)]?.name; return a && String(name).startsWith(`${a}: `) ? String(name).slice(String(a).length + 2) : String(name); };  // its row already says Elektrikal
  const from = plan.questions_from as Rec | undefined;
  const ranked = (q: Rec, i: number) => { const [row, color] = URGENCY[q.level], n = (q.activities as string[]).length; return { row, color, block: `q:${i}`, label: String(q.subject), sub: `${n ? `${n} work package${n === 1 ? "" : "s"}, from week ${q.week}` : "the whole job"}` }; };
  const conflict = (c: Rec): Item => {
    const kind = KINDS.find(([re]) => re.test(String(c.rule)))?.[1] ?? DISAGREE, text = String(c.text);
    const named = kind === DISAGREE ? documents.filter((d) => text.includes(String(d.title))).map((d) => String(d.id)) : [];
    return { ...flag(c), block: kind, label: kind, row: "", ...(named.length > 1 ? { docs: named, topic: text.split(":")[0] } : {}) };
  };
  const checked = (c: Rec): Item => ({ ...flag(c), row: "Flagged by code", color: OTHER, block: "flags", label: "Checks on the plan" });
  const successors = new Set(rows.flatMap((r) => r.after as string[]));
  const finish = String(cp.finish ?? "");
  const lateBy = (d: string) => (finish ? (new Date(finish).getTime() - new Date(d).getTime()) / 864e5 : 0);
  const loose = rows.filter((r) => !successors.has(r.id) && lateBy(String(r.ef)) >= 14);  // as the analysis counts them: work that ends with the job has nothing to come after it
  const whose = Object.fromEntries(tree.map((b) => [b.activity, b]));
  return [
    { id: "extracted", title: "Extracted work packages", hint: "the breakdown, by what each is worth", what: "Rejecting one keeps it in the consultant's schedule, but puts none of its tasks on the board when you approve the plan. To change its dates or links, use the Timeline tab.", items: tree.map((b) => {
      const r = rows.find((x) => x.id === b.activity);
      const count = tasks.filter((s) => s.activity === b.activity).length;
      const p = packages[b.activity] ?? {};
      return { ...inAccount(p.no), block: `wp:${b.activity}`, label: `${b.code} ${plain(b.name, p.no)}`, sub: `${worth[p.no] ? `${money(worth[p.no])} · ` : ""}${count} task${count === 1 ? "" : "s"}`, size: worth[p.no] || 1, key: `wp:${b.activity}`, title: <><span className="mr-1.5 font-mono text-[11.5px] text-[#8f99a8]">{b.code}</span>{b.name}</>, detail: `${r ? `${r.es} to ${r.ef}, ${r.duration} days · ` : ""}${count} task${count === 1 ? "" : "s"}${worth[p.no] ? ` · ${money(worth[p.no])}` : ""}`, edit: { label: "Answers for it", value: String(p.responsible ?? "") }, sources: ((p.references ?? []) as Rec[]).slice(0, 3).map((x) => ({ doc: x.doc, page: x.from })) };
    }) },
    { id: "missing", title: "Missing information", hint: "not in the package, and what that costs", what: "Your decision is recorded on the plan. It changes nothing else.", items: ((plan.missing ?? []) as string[]).map((m, i) => ({ key: `missing:${i}`, title: m })) },
    { id: "conflicts", title: "Conflicts between documents", hint: "where they disagree or fall short", what: "Your decision is recorded on the plan. It changes nothing else. To settle one with the consultant, use the question drafted under Needs your input.", items: [...(rec.findings as Rec[]).map((f, i): Item => ({ key: `finding:${i}`, title: f.subject, detail: f.note, sources: f.sources as Rec[], row: "", block: DISAGREE, label: DISAGREE, topic: String(f.subject), docs: [...new Set((f.sources as Rec[]).map((x) => String(x.doc)))] })), ...checks.filter((c) => CONFLICT.test(String(c.rule))).map(conflict)].sort((a, b) => Number(b.block === DISAGREE) - Number(a.block === DISAGREE)) },
    { id: "dependencies", title: "Unresolved dependencies", hint: "nothing is linked after them", what: "Nothing is linked after these, so their float only says how far they are from the end of the job. Accept one if that is right, or add the link on the Timeline tab.", items: loose.map((r) => ({ label: `${r.code} ${plain(r.name, packages[r.id]?.no)}`, when: { start: String(r.es), finish: String(r.ef), float: Number(r.float_days) }, key: `dep:${r.id}`, title: <><span className="mr-1.5 font-mono text-[11.5px] text-[#8f99a8]">{r.code}</span>{r.name}</>, detail: `Finishes ${r.ef}, float ${r.float_days} days`, link: <button onClick={() => go(`gantt:${r.id}`)} className="text-[12px] text-[#9cc7f5] hover:underline">Open it on the Timeline</button> })) },
    { id: "assumptions", title: "Unverified AI assumptions", hint: "what does not come from the documents", what: "Your decision is recorded on the plan. It changes nothing else. A task's figures can be corrected on the board once the plan is approved.", items: [
      ...checks.filter((c) => !CONFLICT.test(String(c.rule))).map(checked),
      ...tasks.filter((s) => !(s.sources as Rec[]).length).map((s): Item => ({ key: `task:${s.id}`, title: `${s.id} ${s.name}`, detail: `Cites nothing in the documents, under ${whose[s.activity]?.name ?? s.activity}.`, row: "Flagged by code", color: OTHER, block: "uncited", label: "Tasks citing nothing" })),
      ...tasks.filter((s) => ((s.unsourced ?? []) as string[]).length > 0).map((s): Item => ({ key: `figure:${s.id}`, title: `${s.id} ${s.name}`, detail: `States figures its pages do not: ${(s.unsourced as string[]).join(", ")}.`, sources: (s.sources as Rec[]).slice(0, 2), row: "Flagged by code", color: OTHER, block: "figures", label: "Tasks with figures not on their pages" })),
      ...Object.entries(packages).flatMap(([aid, p]) => ((p.assumptions ?? []) as string[]).map((a, i): Item => { const n = accountOf(p.no); return { key: `assume:${aid}:${i}`, title: a, detail: whose[aid]?.name, row: "Assumed by the planners", color: OTHER, block: `assumed:${n}`, label: String(accounts[n]?.name ?? "The whole job") }; })),
    ] },
    { id: "input", title: "Needs your input", hint: "questions drafted for the consultant", what: `${from ? `The agents drafted ${from.drafts} questions, and the RFI coordinator joined them into ${(rec.rfi_drafts as Rec[]).length}, most urgent first. ` : ""}Questions for the consultant, because the documents do not settle them. Edit the wording as you like. Rejecting one drops the draft when you approve the plan. Nothing is sent until a person issues it.`, items: (rec.rfi_drafts as Rec[]).map((q, i): Item => ({ ...(q.level ? ranked(q, i) : { ...inAccount(q.activity), block: `on:${q.activity ?? ""}`, label: q.activity ? `${wpOf[q.activity]?.code ?? q.activity} ${plain(wpOf[q.activity]?.name ?? "", q.activity)}` : "The whole job" }), key: `q:${i}`, title: q.subject, edit: { label: "Question", value: String(q.question) }, detail: q.level ? `${q.impact} To ${q.to}.` : `To ${q.to}${q.activity ? `, on ${q.activity}` : ""}` })) },
  ];
}

export function ReviewModule() {
  const { data, err, act } = useData("/api/project/plans");
  const run = useData("/api/aip/analysis");
  const cpm = useData("/api/project/critical-path");
  const docs = useData("/api/project/package");
  const go = useGo();
  const [picked, setPicked] = useState("conflicts");
  const [note, setNote] = useState("");
  const list = (data?.plans ?? []) as Rec[];
  const rec = list.find((p) => p.status === "pending") ?? list.find((p) => p.status === "approved") ?? list.find((p) => p.status !== "superseded");
  const sections = useMemo(() => (rec && cpm.data ? sectionsOf(rec, cpm.data, go, (docs.data?.documents ?? []) as Rec[]) : []), [rec, cpm.data, go, docs.data]);
  if (run.data?.run?.status === "running") return <SwarmModule />;
  if (!data || !cpm.data) return <div className="flex-1 bg-[#111820]"><Problem err={err || cpm.err} />{!err && !cpm.err && <Loading />}</div>;
  if (!rec) return <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#111820] p-3 text-[13px]"><Empty>Nothing to review yet. <button onClick={() => go("home")} className="underline">Start on Home</button>.</Empty><TenderSelection /><EquipmentList /><ContractChecklist /></div>;
  const pending = rec.status === "pending";
  const reviews = (rec.reviews ?? {}) as Record<string, Rec>;
  const send = (keys: string[], verdict: string) => act(() => api(`/api/project/plans/${rec.id}/review`, { keys, verdict }));
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const decided = sections.reduce((n, s) => n + s.items.filter((i) => reviews[i.key]).length, 0);
  const rejected = sections[0]?.items.filter((i) => reviews[i.key]?.verdict === "reject").length ?? 0;
  const conflicts = sections.find((s) => s.id === "conflicts");
  const unread = conflicts?.items.filter((i) => !reviews[i.key]).length ?? 0;
  const section = sections.find((s) => s.id === picked) ?? sections[0];
  const jump = (id: string) => document.getElementById(`review-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const itemRow = (i: Item) => <ItemRow item={i} verdict={reviews[i.key]?.verdict} open={pending} onSet={(v) => void send([i.key], v)} onSave={(text) => act(() => api(`/api/project/plans/${rec.id}/edit`, { key: i.key, text }))} />;
  const decide = (i: Item) => (pending ? <Decide verdict={reviews[i.key]?.verdict} onSet={(v) => void send([i.key], v)} /> : reviews[i.key] ? <Pill tone={reviews[i.key].verdict === "approve" ? "ok" : "bad"}>{reviews[i.key].verdict === "approve" ? "accepted" : "rejected"}</Pill> : null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111820] text-[13px]">
      <Problem err={err} />
      <div data-tour="proposal" className="shrink-0 border-b border-white/10 bg-[#1c2733] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-[240px] flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-white">Review the proposal <Pill tone={pending ? "warn" : rec.status === "approved" ? "ok" : "bad"}>{pending ? "waiting for you" : rec.status}</Pill></p>
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
        {pending && (unread > 0 || rejected > 0) && <p className="mt-1.5 text-[12.5px] text-[#fbd38d]">{unread > 0 ? `${unread} conflict${unread === 1 ? "" : "s"} not yet looked at. ` : ""}{rejected > 0 ? `${rejected} work package${rejected === 1 ? "" : "s"} you rejected will get no tasks.` : ""}</p>}
        {rec.status === "approved" && <p className="mt-1.5 leading-snug text-[#7ee2c0]"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />Approved by {rec.decided_by}, {rec.decided_at}. {(rec.effects as string[]).join(" ")}</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <ReviewFlow rec={rec} sections={sections} reviews={reviews} documents={docs.data} picked={section.id} onPick={setPicked} onHome={() => go("home")} onJump={jump} />
        <section className="rounded-lg border border-white/10 bg-[#1c2733]">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
            <p className="min-w-[220px] flex-1 font-semibold text-white">{section.title} <span className="ml-1 rounded-full bg-white/10 px-2 text-[12px] font-normal tabular-nums text-[#c5cbd3]">{section.items.length}</span></p>
            {pending && section.items.length > 0 && <span className="flex shrink-0 gap-1">
              <button onClick={() => void send(section.items.map((i) => i.key), "approve")} className={`${quiet} ${BTN}`}>Accept all</button>
              <button onClick={() => void send(section.items.map((i) => i.key), "reject")} className={`${quiet} ${BTN}`}>Reject all</button>
              {section.items.some((i) => reviews[i.key]) && <button onClick={() => void send(section.items.map((i) => i.key), "clear")} className={`${quiet} ${BTN}`}>Clear</button>}
            </span>}
          </div>
          <p className="bg-black/10 px-3 py-1.5 text-[12px] leading-snug text-[#8f99a8]">{section.what}</p>
          <SectionDiagram key={section.id} section={section} plan={rec.plan as Rec} reviews={reviews} documents={(docs.data?.documents ?? []) as Rec[]} from={String(cpm.data.start)} to={String(cpm.data.finish)} row={itemRow} decide={decide} />
        </section>
        <div id="review-tender" className="scroll-mt-3"><TenderSelection /></div>
        <div id="review-equipment" className="scroll-mt-3"><EquipmentList /></div>
        <div id="review-checklist" className="scroll-mt-3"><ContractChecklist /></div>
      </div>
    </div>
  );
}
