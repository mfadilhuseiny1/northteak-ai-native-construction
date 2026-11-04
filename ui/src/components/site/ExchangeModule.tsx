"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, field, Label, Loading, notifyChanged, Pill, primary, Problem, quiet, Side, SubTabs, useData, useGo, type Rec, type Tone } from "./kit";
import { SourceLink } from "./SourceDrawer";

/* What goes between the contractor and the people outside: RFIs and submittals, from draft to answer. A lane for where each one stands, urgent first. Sending makes a link for that one item, and the person sends it over their own email or WhatsApp: the app sends nothing by itself. The other side answers from the link, so the answer is the record. An answer that came some other way can still be written in, and the scorecard counts the difference. */

const URGENCY: Record<string, { word: string; color: string; rank: number }> = { stop: { word: "Stops work", color: "#e5484d", rank: 0 }, rework: { word: "Risks rework", color: "#c98500", rank: 1 }, clarify: { word: "Worth confirming", color: "#8f99a8", rank: 2 } };
const VERDICT: Record<string, [string, Tone]> = { approved: ["Approved", "ok"], noted: ["Approved as noted", "ok"], rejected: ["Rejected", "bad"], draft: ["Draft", "none"], submitted: ["With the consultant", "info"] };
const waited = (from: string, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(from)) / 864e5));

/** Makes the link for one item, and hands it to the person to send. */
export function Sender({ kind, id, to, onClose, onSent }: { kind: string; id: string; to?: string; onClose: () => void; onSent?: () => void }) {
  const [who, setWho] = useState(to ?? "");
  const [sent, setSent] = useState<Rec | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setErr("");
    try { setSent(await api(`/api/project/share/${kind}/${id}`, { to: who })); onSent?.(); notifyChanged(); } catch (e) { setErr((e as Error).message); }
  };
  const url = sent ? `${window.location.origin}${sent.path}` : "";
  const text = sent ? `${sent.message}\n${url}` : "";
  const here = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return (
    <Side eyebrow={`Send ${id}`} title={sent ? "Your link is ready" : "Send it to the other side"} onClose={onClose}>
      {!sent ? (
        <>
          <p className="leading-snug text-[#abb3bf]">They get a link to this one item and answer there, with no account. It sees nothing else in the project.</p>
          <label className="block"><Label>To</Label><input autoFocus value={who} onChange={(e) => setWho(e.target.value)} className={field} /></label>
          {err && <p role="alert" className="text-[12px] text-[#ffb4b4]">{err}</p>}
          <button onClick={() => void make()} className={`${primary} w-full`}>Make the link</button>
        </>
      ) : (
        <>
          <textarea aria-label="Message" readOnly rows={6} value={text} className={field} />
          <div className="grid grid-cols-3 gap-1.5">
            <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }} className={quiet}>{copied ? "Copied" : "Copy"}</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className={`${quiet} text-center`}>WhatsApp</a>
            <a href={`mailto:?subject=${encodeURIComponent(sent.subject)}&body=${encodeURIComponent(text)}`} className={`${quiet} text-center`}>Email</a>
          </div>
          <p className="leading-snug text-[#8f99a8]">It works for {sent.days} days and takes one answer. Sending again makes a new link and ends this one.</p>
          {here && <p className="flex items-start gap-1.5 leading-snug text-[#fbd38d]"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />This link opens only on this computer for now. For someone outside to use it, the app has to be hosted where they can reach it.</p>}
        </>
      )}
    </Side>
  );
}

function Lane({ title, hint, color, count, children }: { title: string; hint: string; color: string; count: number; children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-[280px] flex-1 basis-0 flex-col rounded-xl border border-t-2 border-white/[.07] bg-[#151e28]" style={{ borderTopColor: color }}>
      <div className="flex shrink-0 items-baseline gap-2 border-b border-white/[.05] px-3 py-2"><p className="text-[13px] font-bold text-white">{title}</p><span className="min-w-0 flex-1 truncate text-[11px] text-[#8f99a8]">{hint}</span><span className="rounded-full bg-white/10 px-2 text-[12px] tabular-nums text-[#c5cbd3]">{count}</span></div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">{children}{!count && <p className="m-1 rounded-lg border border-dashed border-white/10 p-4 text-center text-[12px] text-[#6b7480]">Nothing here</p>}</div>
    </div>
  );
}

function Tile({ on, color, title, line, right, onClick }: { on: boolean; color?: string; title: string; line: ReactNode; right?: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`block w-full rounded-lg border bg-[#1c2733] px-2.5 py-2 text-left transition hover:border-white/30 ${on ? "border-[#f5b82e]" : "border-white/10"}`} style={color ? { borderLeft: `3px solid ${color}` } : undefined}>
      <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-white">{title}</span>
      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-[#8f99a8]"><span className="min-w-0 flex-1 truncate">{line}</span>{right}</span>
    </button>
  );
}

function RfiDetail({ r, today, act, onSend, onClose }: { r: Rec; today: string; act: (fn: () => Promise<unknown>) => Promise<boolean>; onSend: () => void; onClose: () => void }) {
  const [answer, setAnswer] = useState("");
  const u = URGENCY[r.level];
  return (
    <Side eyebrow={r.id} title={r.subject} onClose={onClose}>
      <p className="flex flex-wrap items-center gap-1.5">{u && <span className="flex items-center gap-1.5 text-[11.5px] text-[#d3d8de]"><span className="h-2 w-2 rounded-full" style={{ background: u.color }} />{u.word}</span>}{(r.activities ?? []).length > 0 && <Pill>{r.activities.length} work package{r.activities.length === 1 ? "" : "s"}</Pill>}</p>
      <p className="whitespace-pre-line leading-snug text-[#e5e8eb]">{r.question}</p>
      {r.impact && <p className="leading-snug text-[#abb3bf]">{r.impact}</p>}
      <p className="text-[11.5px] text-[#8f99a8]">To {r.to}{r.sent ? `. Sent ${r.sent.on} by ${r.sent.by}, ${waited(r.sent.on, today)} days ago` : ""}</p>
      {r.status === "answered" ? (
        <div className="rounded-lg bg-[#29a383]/10 p-2.5"><Label>Answer{r.answered_by ? ` from ${r.answered_by}` : ""}, {r.answered_on}{r.answered_via === "link" ? ", by link" : ""}</Label><p className="mt-1 whitespace-pre-line leading-snug text-white">{r.answer}</p></div>
      ) : (
        <>
          <button onClick={onSend} className={`${primary} w-full`}>{r.sent ? "Send again" : "Send it"}</button>
          {r.status === "open" && <details className="rounded border border-white/10"><summary className="cursor-pointer px-2 py-1.5 text-[11.5px] text-[#d3d8de]">The answer came another way</summary><div className="space-y-1.5 border-t border-white/5 p-2"><textarea aria-label="Answer" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} className={field} /><button disabled={!answer.trim()} onClick={() => void act(() => api(`/api/rfis/${r.id}/answer`, { answer }))} className={quiet}>Write it in</button></div></details>}
        </>
      )}
    </Side>
  );
}

function Rfis({ target }: { target: string }) {
  const { data, err, act, reload } = useData("/api/rfis");
  const [sel, setSel] = useState(target);
  const [sending, setSending] = useState<Rec | null>(null);
  useEffect(() => { if (target) setSel(target); }, [target]);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const all = data.rfis as Rec[];
  const rank = (r: Rec) => URGENCY[r.level]?.rank ?? 3;
  const lane = (s: string) => all.filter((r) => r.status === s).sort((a, b) => rank(a) - rank(b) || String(a.id).localeCompare(String(b.id)));
  const open = all.find((r) => r.id === sel);
  const tile = (r: Rec) => <Tile key={r.id} on={r.id === sel} color={URGENCY[r.level]?.color} title={r.subject} line={r.status === "open" ? `${r.ball_in_court || r.to}` : (r.activities ?? []).length > 1 ? `${r.activities.length} work packages` : r.to} right={r.status === "open" ? <span className={`shrink-0 tabular-nums ${waited(r.issued_on || r.raised_on, data.today) > 7 ? "text-[#ffb4b4]" : ""}`}>{waited(r.issued_on || r.raised_on, data.today)}d</span> : r.answered_via === "link" ? <span className="shrink-0">by link</span> : null} onClick={() => setSel(r.id)} />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Bar title="RFIs" note="Questions for the consultant, most urgent first" />
        <Problem err={err} />
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-[#111820] p-3">
          <Lane title="To send" hint="drafted, not sent" color="#8f99a8" count={lane("draft").length}>{lane("draft").map(tile)}</Lane>
          <Lane title="With the other side" hint="days waiting" color="#3987e5" count={lane("open").length}>{lane("open").map(tile)}</Lane>
          <Lane title="Answered" hint="" color="#29a383" count={lane("answered").length}>{lane("answered").map(tile)}</Lane>
        </div>
      </div>
      {sending ? <Sender kind="rfi" id={sending.id} to={sending.to} onClose={() => setSending(null)} onSent={() => void reload()} /> : open && <RfiDetail key={open.id} r={open} today={data.today} act={act} onSend={() => setSending(open)} onClose={() => setSel("")} />}
    </div>
  );
}

function SubmittalDetail({ s, act, reload, onSend, onClose }: { s: Rec; act: (fn: () => Promise<unknown>) => Promise<boolean>; reload: () => Promise<unknown>; onSend: () => void; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const attach = async (f?: File) => {
    if (!f) return;
    const body = new FormData();
    body.append("file", f);
    const r = await fetch(`/api/project/submittals/${s.id}/file`, { method: "POST", body });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).detail ?? "That file could not be attached");
    else { setErr(""); await reload(); }
  };
  const decide = (decision: string) => act(() => api(`/api/project/submittals/${s.id}/decide`, { decision, note }));
  return (
    <Side eyebrow={`${s.id} · ${s.kind_name}`} title={s.title} onClose={onClose}>
      <p className="flex flex-wrap items-center gap-1.5"><Pill tone={VERDICT[s.status]?.[1]}>{VERDICT[s.status]?.[0] ?? s.status}</Pill>{s.rev > 0 && <Pill>Revision {s.rev}</Pill>}{s.late && <Pill tone="bad">Late</Pill>}</p>
      {s.activity_name && <p className="leading-snug text-[#d3d8de]">For <b className="font-mono text-[11px] text-white">{s.code}</b> {s.activity_name}{s.start ? `, which starts ${s.start}` : ""}</p>}
      {s.needed_by && <p className="text-[#abb3bf]">Wanted by {s.needed_by}</p>}
      {s.note && <p className="leading-snug text-[#abb3bf]">{s.note}</p>}
      {s.source?.doc && <SourceLink doc={s.source.doc} page={s.source.page} quote={s.source.quote} />}
      {(s.history as Rec[]).length > 0 && <div><Label>Decisions</Label><ul className="mt-1 space-y-1">{(s.history as Rec[]).map((h, i) => <li key={i} className="leading-snug text-[#d3d8de]"><Pill tone={VERDICT[h.decision]?.[1]}>Rev {h.rev}: {VERDICT[h.decision]?.[0]}</Pill> {h.note} <span className="text-[11px] text-[#8f99a8]">{h.by}, {h.on}</span></li>)}</ul></div>}
      <div className="flex flex-wrap items-center gap-1.5">
        {s.file ? <a href={`/api/project/submittals/${s.id}/file`} className={quiet}>{s.file_name}</a> : <span className="text-[11.5px] text-[#8f99a8]">No file attached</span>}
        <button onClick={() => file.current?.click()} className={quiet}>{s.file ? "Replace" : "Attach a file"}</button>
        <input ref={file} type="file" aria-label="File" className="hidden" onChange={(e) => void attach(e.target.files?.[0])} />
      </div>
      {err && <p role="alert" className="text-[12px] text-[#ffb4b4]">{err}</p>}
      {["draft", "rejected", "submitted"].includes(s.status) && <button onClick={onSend} className={`${primary} w-full`}>{s.sent && s.status === "submitted" ? "Send again" : s.status === "rejected" ? "Send the next revision" : "Send for approval"}</button>}
      {s.status === "submitted" && <details className="rounded border border-white/10"><summary className="cursor-pointer px-2 py-1.5 text-[11.5px] text-[#d3d8de]">The decision came another way</summary><div className="space-y-1.5 border-t border-white/5 p-2"><textarea aria-label="Note" rows={2} placeholder="What has to change, if anything" value={note} onChange={(e) => setNote(e.target.value)} className={field} /><span className="flex gap-1"><button onClick={() => void decide("approved")} className={quiet}>Approved</button><button disabled={!note.trim()} onClick={() => void decide("noted")} className={quiet}>As noted</button><button disabled={!note.trim()} onClick={() => void decide("rejected")} className={quiet}>Rejected</button></span></div></details>}
      {s.status === "draft" && <button onClick={() => void act(() => api(`/api/project/submittals/${s.id}/drop`, {})).then((ok) => { if (ok) onClose(); })} className={quiet}>Drop this draft</button>}
    </Side>
  );
}

function Submittals({ target }: { target: string }) {
  const { data, err, act, reload } = useData("/api/project/submittals");
  const [sel, setSel] = useState(target);
  const [sending, setSending] = useState<Rec | null>(null);
  const [adding, setAdding] = useState<Rec | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { if (target) setSel(target); }, [target]);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const all = data.submittals as Rec[];
  const lane = (...s: string[]) => all.filter((x) => s.includes(x.status));
  const open = all.find((x) => x.id === sel);
  const tile = (x: Rec) => <Tile key={x.id} on={x.id === sel} color={x.late ? "#e5484d" : x.status === "rejected" ? "#e5484d" : undefined} title={x.title} line={x.needed_by && ["draft", "submitted"].includes(x.status) ? `wanted by ${x.needed_by}` : x.kind_name} right={x.rev > 0 ? <span className="shrink-0">rev {x.rev}</span> : null} onClick={() => setSel(x.id)} />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Bar title="Submittals" note={note || "What must be approved before the work goes ahead"}>
          <button onClick={() => void act(async () => { const r = await api("/api/project/submittals/from-plan", {}); setNote(r.added ? `${r.added} drafts added from what the planners wrote` : "Nothing new in the plan"); })} title="Reads the plan's tasks for the approvals they ask for. It costs nothing, and nothing is sent." className={quiet}>Draft from the plan</button>
          <button onClick={() => setAdding({ title: "", kind: "material", activity: "", to: "", ref: "", note: "" })} className={primary}>Add a submittal</button>
        </Bar>
        <Problem err={err} />
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-[#111820] p-3">
          <Lane title="To send" hint="soonest first" color="#8f99a8" count={lane("draft").length}>{lane("draft").map(tile)}</Lane>
          <Lane title="With the consultant" hint="" color="#3987e5" count={lane("submitted").length}>{lane("submitted").map(tile)}</Lane>
          <Lane title="To correct" hint="rejected" color="#e5484d" count={lane("rejected").length}>{lane("rejected").map(tile)}</Lane>
          <Lane title="Approved" hint="" color="#29a383" count={lane("approved", "noted").length}>{lane("approved", "noted").map(tile)}</Lane>
        </div>
      </div>
      {adding ? (
        <Side eyebrow="Submittals" title="Add a submittal" onClose={() => setAdding(null)}>
          <label className="block"><Label>What needs approving</Label><input autoFocus value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} className={field} /></label>
          <label className="block"><Label>Kind</Label><select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })} className={field}>{Object.entries(data.kinds as Record<string, string>).map(([k, v]) => <option key={k} value={k} className="bg-[#1c2733]">{v}</option>)}</select></label>
          <label className="block"><Label>Work package, if one</Label><select value={adding.activity} onChange={(e) => setAdding({ ...adding, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">The whole job</option>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.name}</option>)}</select></label>
          <label className="block"><Label>To</Label><input value={adding.to} placeholder="Konsultan Pengawas" onChange={(e) => setAdding({ ...adding, to: e.target.value })} className={field} /></label>
          <label className="block"><Label>Reference</Label><input value={adding.ref} placeholder="e.g. RKS page 42" onChange={(e) => setAdding({ ...adding, ref: e.target.value })} className={field} /></label>
          <label className="block"><Label>Note</Label><textarea rows={3} value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} className={field} /></label>
          <button disabled={!adding.title.trim()} onClick={() => void act(() => api("/api/project/submittals", adding)).then((ok) => { if (ok) setAdding(null); })} className={`${primary} w-full`}>Add it</button>
        </Side>
      ) : sending ? <Sender kind="submittal" id={sending.id} to={sending.to} onClose={() => setSending(null)} onSent={() => void reload()} /> : open && <SubmittalDetail key={open.id} s={open} act={act} reload={reload} onSend={() => setSending(open)} onClose={() => setSel("")} />}
    </div>
  );
}

export function ExchangeModule({ sub, target }: { sub: string; target: string }) {
  const tab = sub === "submittals" ? "submittals" : "rfis";
  useGo();
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SubTabs base="exchange" sub={tab} tabs={[["rfis", "RFIs"], ["submittals", "Submittals"]]} />
      {tab === "rfis" ? <Rfis target={target} /> : <Submittals target={target} />}
    </div>
  );
}
