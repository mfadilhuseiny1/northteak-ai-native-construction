"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { RfiView } from "@/components/aip/RfiView";
import { API_URL } from "@/lib/api";
import { UploadForm } from "./UploadForm";
import { Item } from "./Visual";
import { api, Bar, Empty, field, good, inFocus, Kpi, Kpis, Label, Loading, notifyChanged, Pill, primary, Problem, quiet, Ref, Side, SubTabs, useData, useFocus, useGo, type Rec, type Tone } from "./kit";

/* Module 5, Documents & RFI: is the technical information ready? Every drawing and specification in one register: what each states, whether it is still in force, who approved it and which tasks rest on it. Upload your own; rules read the facts for free, and a real model reads it only when a person asks. */

const STATUS: Record<string, Tone> = { current: "info", received: "warn", approved: "ok", rejected: "bad", superseded: "bad" };
const KINDS: Record<string, string> = { scope: "Work brief", drawing: "Drawing", spec: "Specification", itp: "Inspection plan", boq: "BoQ", programme: "Programme", method: "Site logistics", rates: "Rates", inspection: "Inspection", weather: "Weather", contract: "Contract", purchase_order: "Purchase order", cost: "Cost", subcontract: "Subcontract", manpower: "Manpower", other: "Other" };
const FACTS: Record<string, string> = { drawings: "Drawings", concrete: "Concrete", rebar: "Reinforcement", dimensions: "Dimensions", quantities: "Quantities", tolerances: "Tolerances", money: "Money", dates: "Dates", activities: "Activities", records: "Records", standards: "Standards" };

function Viewer({ d, activities, act, onClose }: { d: Rec; activities: Rec[]; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void }) {
  const { data: full } = useData(`/api/project/documents/${d.id}/text`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<Rec | null>(null);
  const go = useGo();
  const read = async (mode: string) => { setBusy(mode); await act(() => api(`/api/project/documents/${d.id}/read`, { mode })); setBusy(""); };
  const startDraft = (q?: Rec) => setDraft({ subject: q?.subject ?? "", question: q?.question ?? "", to: q?.to ?? "Engineer", activity: (d.activities as string[])[0] ?? "", impact: `From ${d.title}.` });
  const r = d.reading as Rec | null;
  return (
    <Side eyebrow={`${d.id} · ${KINDS[d.kind] ?? d.kind}${d.from ? ` · ${d.from}` : ""}${d.date ? ` · ${d.date}` : ""}`} title={d.title} onClose={onClose}>
      <div className="flex flex-wrap gap-1"><Pill tone={STATUS[d.status]}>{d.status === "superseded" ? "replaced" : d.status}</Pill>{d.source === "upload" ? <Pill tone="violet">uploaded: your document</Pill> : <Pill>synthetic</Pill>}{d.decided_by && <Pill>{d.decided_by}, {d.decided_on}</Pill>}</div>
      {d.replaced_by && <p className="rounded bg-[#e5484d]/10 p-2 text-[#ffb4b4]">Replaced by <button onClick={() => go(`documents/register:${d.replaced_by}`)} className="underline">{d.replaced_by}</button>.{(d.cited_by as string[]).length ? ` ${(d.cited_by as string[]).join(", ")} still cite it.` : ""}</p>}
      {d.how_read && <p className="text-[11px] text-[#abb3bf]">{d.how_read}.{d.file ? <> <a href={`${API_URL}/api/project/documents/${d.id}/file`} className="underline">Download the file</a></> : null}</p>}
      {d.status !== "superseded" && (
        <div className="space-y-1">
          <Label>Approval</Label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (optional)" className={field} />
          <span className="flex gap-1"><button disabled={d.status === "approved"} onClick={() => act(() => api(`/api/project/documents/${d.id}/decide`, { status: "approved", note }))} className={`${good} flex-1`}>Approve for construction</button><button disabled={d.status === "rejected"} onClick={() => act(() => api(`/api/project/documents/${d.id}/decide`, { status: "rejected", note }))} className={quiet}>Reject</button></span>
          {d.note && <p className="text-[11px] text-[#abb3bf]">Note: {d.note}</p>}
        </div>
      )}
      <div className="space-y-1">
        <Label>Connected to</Label>
        <div className="flex flex-wrap gap-1">
          {(d.activities as string[]).map((a) => <Ref key={a} to={`schedule/gantt:${a}`}>{a}</Ref>)}
          {(d.rfis as string[]).map((x) => <Ref key={x} to={`documents/rfis:${x}`} tone="warn">{x}</Ref>)}
          {(d.cited_by as string[]).map((x) => <Pill key={x} tone="info">{x}</Pill>)}
          {!(d.activities as string[]).length && !(d.cited_by as string[]).length && !(d.rfis as string[]).length && <span className="text-[#8f99a8]">Nothing yet</span>}
        </div>
        {d.source === "upload" && <select aria-label="Link to an activity" value="" onChange={(e) => e.target.value && act(() => api(`/api/project/documents/${d.id}/link`, { activity: e.target.value }))} className={field}><option value="" className="bg-[#1c2733]">Link to an activity…</option>{activities.map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.id} {a.name}</option>)}</select>}
      </div>
      {(d.findings as Rec[]).length > 0 && <div><Label>What the agents found in it</Label>{(d.findings as Rec[]).map((f, i) => <p key={i} className="mt-0.5 rounded bg-[#fab219]/10 p-1.5 leading-snug text-[#fbd38d]">{f.note}</p>)}</div>}
      <div className="space-y-1">
        <Label>What it states, read by rules</Label>
        {Object.entries(d.facts as Record<string, string[]>).map(([k, v]) => <p key={k} className="leading-snug text-[#d3d8de]"><span className="text-[10.5px] text-[#8f99a8]">{FACTS[k] ?? k}: </span>{v.slice(0, 10).join(", ")}{v.length > 10 ? ` and ${v.length - 10} more` : ""}</p>)}
        {!Object.keys(d.facts as Rec).length && <p className="text-[#8f99a8]">Nothing a rule can pick out.</p>}
      </div>
      <div className="space-y-1">
        <Label>Ask the document agent</Label>
        <span className="flex gap-1"><button disabled={!!busy} onClick={() => read("mock")} className={`${quiet} flex-1`}>{busy === "mock" ? "Reading…" : "Read: offline"}</button><button disabled={!!busy} onClick={() => read("muse")} title="Sends this document's text to the Meta Model API. About a cent." className={`${quiet} flex-1`}>{busy === "muse" ? "Reading…" : "Read: Muse"}</button></span>
        {d.source === "upload" && <p className="text-[10.5px] text-[#8f99a8]">&quot;Read: Muse&quot; sends this document&apos;s text to the Meta Model API. Offline it stays on this machine.</p>}
        {r && (
          <div className="space-y-1 rounded border border-white/10 p-2">
            <p className="leading-snug text-[#e5e8eb]">{r.summary}</p>
            {(r.key_points as Rec[]).map((p, i) => <p key={i} className="leading-snug text-[#d3d8de]">{p.point} <span className="text-[10.5px] italic text-[#8f99a8]">&quot;{p.quote}&quot;</span></p>)}
            {r.dropped > 0 && <p className="text-[10.5px] text-[#fbd38d]">Code dropped {r.dropped} point{r.dropped === 1 ? "" : "s"} quoting words that are not in the document.</p>}
            {(r.questions as Rec[]).map((q, i) => <div key={i} className="flex items-start gap-2"><p className="min-w-0 flex-1 leading-snug text-[#fbd38d]">{q.subject}: {q.question}</p><button onClick={() => startDraft(q)} className={quiet}>Draft RFI</button></div>)}
            <p className="text-[10.5px] text-[#8f99a8]">{r.mode === "mock" ? "Offline: code, no model" : `Muse Spark, $${r.usd}`} · {r.at}</p>
          </div>
        )}
      </div>
      {draft ? (
        <div className="space-y-1 rounded border border-[#e879a8]/30 p-2">
          <Label>Draft an RFI</Label>
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Subject" className={field} />
          <textarea value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} rows={3} placeholder="Question" className={field} />
          <div className="grid grid-cols-2 gap-1"><input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="To" className={field} /><select aria-label="Activity it holds" value={draft.activity} onChange={(e) => setDraft({ ...draft, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">No activity</option>{activities.map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.id}</option>)}</select></div>
          <span className="flex gap-1"><button disabled={!draft.subject.trim() || !draft.question.trim()} onClick={async () => { if (await act(() => api("/api/project/rfi-drafts", draft))) setDraft(null); }} className={`${primary} flex-1`}>Save the draft</button><button onClick={() => setDraft(null)} className={quiet}>Cancel</button></span>
          <p className="text-[10.5px] text-[#8f99a8]">It waits in the register for a person to issue it.</p>
        </div>
      ) : <button onClick={() => startDraft()} className={`${quiet} w-full`}>Draft an RFI from this document</button>}
      <div><Label>The document</Label><p className="mt-1 max-h-[340px] overflow-y-auto whitespace-pre-line rounded bg-black/20 p-2 text-[11.5px] leading-relaxed text-[#e5e8eb]">{full?.text || "No text to show."}</p></div>
    </Side>
  );
}

function Register({ target }: { target: string }) {
  const { data, err, act, reload } = useData("/api/project/documents");
  const { focus } = useFocus();
  const go = useGo();
  const [sel, setSel] = useState<string | null>(target || null);
  const [filter, setFilter] = useState("");
  const [upload, setUpload] = useState(false);
  useEffect(() => { if (target) setSel(target); }, [target]);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = (data.documents as Rec[]).filter((d) => (!filter || d.status === filter || d.kind === filter) && (!focus || focus.type === "project" || (d.activities as string[]).some((a) => inFocus(focus, { activity: a }))));
  const open = (data.documents as Rec[]).find((d) => d.id === sel);
  const c = data.counts as Rec;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Document register" note="what each states, whether it is in force, and who approved it">
          <select aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-[11px] text-white"><option value="" className="bg-[#1c2733]">All documents</option>{["superseded", "received", "approved", "rejected", "drawing", "spec", "boq"].map((k) => <option key={k} value={k} className="bg-[#1c2733]">{k === "superseded" ? "Replaced" : KINDS[k] ?? k[0].toUpperCase() + k.slice(1)}</option>)}</select>
          <button onClick={() => { setSel(null); setUpload(true); }} className={primary}><Icon name="upload" className="mr-1 inline h-3 w-3" />Upload documents</button>
        </Bar>
        <Problem err={err} />
        <Kpis>
          <Kpi label="documents" value={(data.documents as Rec[]).length} /><Kpi label="in force" value={c.current + c.approved} /><Kpi label="waiting for approval" value={c.received} tone={c.received ? "warn" : undefined} /><Kpi label="replaced" value={c.superseded} tone={c.superseded ? "warn" : undefined} /><Kpi label="rejected" value={c.rejected} tone={c.rejected ? "bad" : undefined} />
        </Kpis>
        <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
          <div className="divide-y divide-white/[.05]">
            {rows.map((d) => {
              const cited = (d.cited_by as string[]).length, found = (d.findings as Rec[]).length;
              return (
                <Item key={d.id} selected={sel === d.id} onClick={() => { setUpload(false); setSel(d.id); }}
                  code={<span className="flex items-center gap-1"><Icon name="doc" className="h-3.5 w-3.5 text-[#8f99a8]" />{d.id}</span>}
                  title={<span className="text-white">{d.title}</span>}
                  meta={<>{KINDS[d.kind] ?? d.kind}{d.from ? ` · from ${d.from}` : ""}{d.date ? ` · ${d.date}` : ""}{d.source === "upload" ? " · uploaded" : ""}{(d.activities as string[]).length ? ` · for ${(d.activities as string[]).join(", ")}` : ""}</>}
                  visual={<span className="flex flex-wrap items-center gap-1.5 text-[10.5px]">{cited > 0 && <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[#d3d8de]"><b className="text-white">{cited}</b> task{cited === 1 ? "" : "s"} cite it</span>}{found > 0 && <span className="rounded-full bg-[#fab219]/15 px-2 py-0.5 text-[#fbd38d]"><b>{found}</b> finding{found === 1 ? "" : "s"} in it</span>}{!cited && !found && <span className="text-[#5c6b7a]">not cited yet</span>}</span>}
                  value={<Pill tone={STATUS[d.status]}>{d.status === "superseded" ? "replaced" : d.status}</Pill>} />
              );
            })}
          </div>
          {!rows.length && <Empty>No documents here. Upload drawings and technical documents, and rules read what they state.</Empty>}
        </div>
      </div>
      {upload && (
        <Side title="Upload documents" onClose={() => setUpload(false)}>
          <UploadForm activities={data.activities as Rec[]} onDone={async (saved) => { setUpload(false); await reload(); notifyChanged(); if (saved[0]) setSel(saved[0].id); }} />
          <p className="text-[11px] text-[#abb3bf]">A drawing titled with a later revision replaces the earlier one.</p>
        </Side>
      )}
      {open && !upload && <Viewer key={open.id} d={open} activities={data.activities} act={act} onClose={() => { setSel(null); if (target) go("documents/register"); }} />}
    </div>
  );
}

function Readiness() {
  const { data, err } = useData("/api/project/readiness");
  const { focus } = useFocus();
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = (data.activities as Rec[]).filter((a) => inFocus(focus, { activity: a.id }));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Is the technical information ready?" note="an activity is not ready while an RFI on it is open or still a draft, or a task on it cites a replaced drawing" />
      <Problem err={err} />
      <Kpis><Kpi label="activities ready" value={`${data.ready} of ${data.of}`} tone={data.ready < data.of ? "warn" : "ok"} /><Kpi label="not ready, and critical" value={rows.filter((a) => !a.ready && a.critical).length} tone={rows.some((a) => !a.ready && a.critical) ? "bad" : "ok"} /></Kpis>
      <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
        <div className="divide-y divide-white/[.05]">
          {rows.map((a) => (
            <div key={a.id} style={{ boxShadow: `inset 3px 0 0 ${a.ready ? "#29a383" : a.critical ? "#f87171" : "#fab219"}` }}>
              <Item code={a.code} onClick={() => go(`wbs/tree:${a.code}`)}
                title={<span className="flex flex-wrap items-center gap-1.5"><span className="text-white">{a.id} {a.name}</span>{a.critical && <span className="text-[10px] font-semibold text-[#fbd38d]">critical</span>}</span>}
                meta={<>starts {a.start} · {a.documents} document{a.documents === 1 ? "" : "s"}{(a.reasons as Rec[]).map((r, i) => <button key={i} onClick={(e) => { e.stopPropagation(); go(r.go); }} className="block text-left text-[#fbd38d] hover:underline">{r.text}</button>)}</>}
                value={<Pill tone={a.ready ? "ok" : "warn"}>{a.ready ? "ready" : "not ready"}</Pill>} />
            </div>
          ))}
        </div>
        {!rows.length && <Empty>No activities yet.</Empty>}
      </div>
    </div>
  );
}

export function DocumentsModule({ sub, target }: { sub: string; target: string }) {
  const tab = ["rfis", "readiness"].includes(sub) ? sub : "register";
  const { data } = useData("/api/project/overview");
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SubTabs base="documents" sub={tab} tabs={[["register", "Documents"], ["rfis", "RFIs", data?.counts?.draft_rfis || undefined], ["readiness", "Readiness"]]} />
      {tab === "register" && <Register target={target} />}
      {tab === "rfis" && <RfiView target={target} />}
      {tab === "readiness" && <Readiness />}
    </div>
  );
}
