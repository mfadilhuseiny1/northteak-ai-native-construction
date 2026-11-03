"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { AgentBar } from "./AgentBar";
import { api, Bar, clean, Empty, field, good, inFocus, inline, Kpi, Kpis, Label, Loading, notifyChanged, Pill, primary, Problem, quiet, Ref, short, Side, SubTabs, Table, td, tr, useData, useFocus, useGo, type Rec, type Tone } from "./kit";

/* Module 7, QA/QC: was the work done right? An inspection's result is what closes its task on the board: a pass lets what waits for it go on, and a fail raises an NCR and stops it until that closes. Photos are the evidence, and an agent can look for defects in them, but a person raises the NCR. */

const INSPECTION: Record<string, Tone> = { passed: "ok", failed: "bad", planned: "info" };
const SEVERITY: Record<string, Tone> = { high: "bad", medium: "warn", low: "none" };

function InspectionPanel({ i, photos, act, onClose }: { i: Rec; photos: Rec[]; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void }) {
  const [items, setItems] = useState<Rec[]>(i.checklist);
  const [note, setNote] = useState(i.note ?? "");
  const [chosen, setChosen] = useState<string[]>(i.photos ?? []);
  const go = useGo();
  useEffect(() => { setItems(i.checklist); setNote(i.note ?? ""); setChosen(i.photos ?? []); }, [i.id, i.status]); // eslint-disable-line react-hooks/exhaustive-deps -- a fresh form for another inspection
  const set = (n: number, ok: boolean) => setItems(items.map((c, x) => (x === n ? { ...c, ok } : c)));
  const decided = i.status === "passed";
  const openNcr = i.status === "failed";
  const send = (result: string) => act(() => api(`/api/project/inspections/${i.id}/result`, { result, checklist: items, note, photos: chosen }));
  const ready = items.every((c) => c.ok === true), anyFail = items.some((c) => c.ok === false);
  return (
    <Side eyebrow={`${i.id}${i.wbs ? ` · ${i.wbs}` : ""}`} title={i.title} onClose={onClose}>
      <div className="flex flex-wrap gap-1"><Pill tone={INSPECTION[i.status] ?? "none"}>{i.status}</Pill>{i.hold_point && <Pill tone="bad">hold point: work stops until signed</Pill>}{i.by_name && <Pill>{clean(i.by_name)}</Pill>}{i.activity && <Ref to={`schedule/gantt:${i.activity}`}>{i.activity}</Ref>}</div>
      <p className="text-[#d3d8de]">{i.next ? `Planned for ${i.next}.` : i.date ? `Inspected on ${i.date}${i.signed_by ? ` by ${i.signed_by}` : ""}.` : ""}{i.wait_days ? ` Result in ${i.wait_days} days.` : ""}</p>
      {i.criteria && <div><Label>What passes</Label><p className="text-[#e5e8eb]">{i.criteria}</p></div>}
      {openNcr && <p className="rounded bg-[#e5484d]/10 p-2 text-[#ffb4b4]">Failed. <button onClick={() => go(`quality/ncrs:${i.ncr}`)} className="underline">{i.ncr}</button> must close first: closing it signs this inspection off, and work goes on.</p>}
      <div className="space-y-1">
        <Label>Checklist</Label>
        {items.map((c, n) => (
          <div key={n} className="flex items-center gap-2 rounded border border-white/10 px-2 py-1">
            <p className="min-w-0 flex-1 leading-snug text-[#e5e8eb]">{c.text}</p>
            <span className="flex shrink-0 gap-0.5" role="group" aria-label={c.text}>
              <button disabled={decided || openNcr} aria-pressed={c.ok === true} onClick={() => set(n, true)} className={`rounded px-1.5 py-0.5 text-[10.5px] ${c.ok === true ? "bg-[#29a383] text-white" : "bg-white/10 text-[#d3d8de] hover:bg-white/20"} disabled:opacity-50`}>OK</button>
              <button disabled={decided || openNcr} aria-pressed={c.ok === false} onClick={() => set(n, false)} className={`rounded px-1.5 py-0.5 text-[10.5px] ${c.ok === false ? "bg-[#e5484d] text-white" : "bg-white/10 text-[#d3d8de] hover:bg-white/20"} disabled:opacity-50`}>Not OK</button>
            </span>
          </div>
        ))}
        {!items.length && <p className="text-[#8f99a8]">No checklist on this one.</p>}
      </div>
      <div className="space-y-1">
        <Label>Photo evidence ({chosen.length})</Label>
        <div className="flex max-h-[132px] flex-wrap gap-1 overflow-y-auto">
          {photos.slice(0, 18).map((p) => {
            const on = chosen.includes(p.id);
            return (
              <button key={p.id} disabled={decided} aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])} title={p.caption} className={`overflow-hidden rounded border-2 ${on ? "border-[#9d8cff]" : "border-transparent opacity-70 hover:opacity-100"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${API_URL}/api/project/photos/${p.id}`} alt={p.caption} loading="lazy" className="h-[40px] w-[58px] object-cover" />
              </button>
            );
          })}
          {!photos.length && <p className="text-[#8f99a8]">No photos yet. Upload them in Photos.</p>}
        </div>
      </div>
      <label className="block"><Label>Note</Label><textarea disabled={decided} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={field} /></label>
      {!decided && !openNcr && (
        <div className="flex gap-1.5">
          <button disabled={anyFail || (items.length > 0 && !ready)} onClick={() => send("pass")} className={`${good} flex-1`}>{i.hold_point ? "Sign: it passes" : "It passes"}</button>
          <button disabled={!anyFail && !note.trim()} title={anyFail || note.trim() ? "" : "Mark what failed, or write a note"} onClick={() => send("fail")} className="rounded bg-[#e5484d] px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-40">It fails: raise an NCR</button>
        </div>
      )}
      {i.step && <p className="text-[11px] text-[#abb3bf]">This closes task {i.step} on the board{i.hold_point ? ", and lets what waits for it go on" : ""}.</p>}
    </Side>
  );
}

function Inspections({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/quality");
  const pics = useData("/api/project/photos");
  const wbs = useData("/api/project/daily-reports");
  const { focus } = useFocus();
  const go = useGo();
  const [sel, setSel] = useState<string | null>(target || null);
  const [form, setForm] = useState<Rec | null>(null);
  useEffect(() => { if (target) setSel(target); }, [target]);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const ins = (data.inspections as Rec[]).filter((i) => inFocus(focus, { activity: i.activity }));
  const open = (data.inspections as Rec[]).find((i) => i.id === sel);
  const order: Record<string, number> = { failed: 0, planned: 1, passed: 2 };
  const rows = [...ins].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Inspections and hold points" note="a result here closes the task on the board">
          <button onClick={() => { setSel(null); setForm({ title: "", activity: focus?.activities[0] ?? "", by: "", next: "", criteria: "", hold_point: false }); }} className={primary}>Plan an inspection</button>
        </Bar>
        <Problem err={err} />
        <Kpis>
          <Kpi label="passed" value={`${ins.filter((i) => i.status === "passed").length} of ${ins.length}`} />
          <Kpi label="failed, waiting for an NCR" value={ins.filter((i) => i.status === "failed").length} tone={ins.some((i) => i.status === "failed") ? "bad" : "ok"} />
          <Kpi label="planned" value={ins.filter((i) => i.status === "planned").length} />
          <Kpi label="hold points not signed" value={ins.filter((i) => i.hold_point && i.status !== "passed").length} tone={ins.some((i) => i.hold_point && i.status !== "passed") ? "warn" : "ok"} />
        </Kpis>
        <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
          <Table heads={["ID", "What", "By", "Holds", "Last inspected", "Next", "Checklist", "Result"]}>
            {rows.map((i) => (
              <tr key={i.id} onClick={() => { setForm(null); setSel(i.id); }} className={`${tr} cursor-pointer ${sel === i.id ? "bg-white/[.07]" : ""}`}>
                <td className={`${td} font-medium text-white`}>{i.id}{i.hold_point && <Icon name="lock" className="ml-1 inline h-3 w-3 text-[#ffb4b4]" />}</td><td className={td}>{i.title}</td><td className={td}>{clean(i.by_name)}</td><td className={td}>{i.activity ? <Ref to={`schedule/gantt:${i.activity}`}>{i.activity}</Ref> : "–"}</td><td className={`${td} whitespace-nowrap`}>{short(i.date)}</td><td className={`${td} whitespace-nowrap`}>{short(i.next)}</td>
                <td className={td}>{(i.checklist as Rec[]).length ? `${(i.checklist as Rec[]).filter((c) => c.ok === true).length}/${(i.checklist as Rec[]).length}` : "–"}</td><td className={td}><Pill tone={INSPECTION[i.status] ?? "none"}>{i.status}</Pill></td>
              </tr>
            ))}
          </Table>
          {!rows.length && <Empty>No inspections here. Approving a work plan plans its inspections, or plan one yourself.</Empty>}
        </div>
      </div>
      {form && (
        <Side title="Plan an inspection" onClose={() => setForm(null)}>
          <label className="block"><Label>What</Label><input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} /></label>
          <label className="block"><Label>On which activity</Label><select value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2127]">None</option>{((wbs.data?.activities ?? []) as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2127]">{a.id} {a.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label><Label>By</Label><input value={form.by} onChange={(e) => setForm({ ...form, by: e.target.value })} className={field} /></label><label><Label>On</Label><input type="date" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} className={field} /></label></div>
          <label className="block"><Label>What passes</Label><textarea value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} rows={2} placeholder="Separate points with commas: each becomes a line on the checklist" className={field} /></label>
          <label className="flex items-center gap-2 text-[#d3d8de]"><input type="checkbox" checked={form.hold_point} onChange={(e) => setForm({ ...form, hold_point: e.target.checked })} />Hold point: work stops until it is signed</label>
          <button disabled={!form.title.trim()} onClick={async () => { if (await act(() => api("/api/project/inspections", form))) setForm(null); }} className={`${primary} w-full`}>Plan it</button>
        </Side>
      )}
      {open && !form && <InspectionPanel i={open} photos={(pics.data?.photos ?? []) as Rec[]} act={act} onClose={() => { setSel(null); if (target) go("quality/inspections"); }} />}
    </div>
  );
}

function Ncrs({ target }: { target: string }) {
  const { data, err, act } = useData("/api/project/quality");
  const { focus } = useFocus();
  const [closing, setClosing] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [form, setForm] = useState<Rec | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const ncrs = (data.ncrs as Rec[]).filter((n) => inFocus(focus, { activity: n.activity }) || !n.activity);
  const open = ncrs.filter((n) => n.status === "open");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Non-conformance reports" note="closing an NCR signs off its inspection, and the work waiting for it goes on">
        <button onClick={() => setForm({ title: "", by: "", activity: focus?.activities[0] ?? "", due: "" })} className={primary}>Raise an NCR</button>
      </Bar>
      <Problem err={err} />
      <Kpis><Kpi label="open" value={open.length} tone={open.length ? "bad" : "ok"} /><Kpi label="closed" value={ncrs.length - open.length} /></Kpis>
      {form && (
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_170px_100px_140px_auto] gap-2 border-b border-white/5 bg-[#1c2127] p-2 max-lg:grid-cols-2">
          <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What is wrong" className={field} />
          <input value={form.by} onChange={(e) => setForm({ ...form, by: e.target.value })} placeholder="Responsible" className={field} />
          <input value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} placeholder="Activity" className={field} />
          <input type="date" aria-label="Due" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className={field} />
          <button disabled={!form.title.trim()} onClick={async () => { if (await act(() => api("/api/project/ncrs", form))) setForm(null); }} className={primary}>Raise</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["NCR", "What", "Responsible", "Holds", "Raised", "Due", "Status", ""]}>
          {ncrs.map((n) => (
            <tr key={n.id} className={`${tr} ${target === n.id ? "bg-white/[.07]" : ""}`}>
              <td className={`${td} font-medium text-white`}>{n.id}</td><td className={td}>{n.title}{n.action && <p className="text-[10.5px] text-[#8f99a8]">{n.action}</p>}{n.inspection && <p className="mt-0.5"><Ref to={`quality/inspections:${n.inspection}`}>{n.inspection}</Ref></p>}</td>
              <td className={td}>{clean(n.by_name)}</td><td className={td}>{n.activity ? <Ref to={`schedule/gantt:${n.activity}`}>{n.activity}</Ref> : "–"}</td><td className={`${td} whitespace-nowrap`}>{short(n.raised)}</td><td className={`${td} whitespace-nowrap`}>{short(n.due)}</td>
              <td className={td}><Pill tone={n.status === "open" ? "bad" : "ok"}>{n.status}{n.closed_on ? ` ${short(n.closed_on)}` : ""}</Pill></td>
              <td className={td}>
                {n.status === "open" && (closing === n.id ? (
                  <span className="flex items-center gap-1">
                    <input autoFocus value={action} onChange={(e) => setAction(e.target.value)} placeholder="What was done" className={`${inline} w-[170px]`} />
                    <button disabled={!action.trim()} onClick={async () => { if (await act(() => api(`/api/project/ncrs/${n.id}/close`, { action }))) { setClosing(null); setAction(""); } }} className={good}>Close</button>
                    <button onClick={() => setClosing(null)} className={quiet}>Cancel</button>
                  </span>
                ) : <button onClick={() => setClosing(n.id)} className={quiet}>Close…</button>)}
              </td>
            </tr>
          ))}
        </Table>
        {!ncrs.length && <Empty>No NCRs.</Empty>}
      </div>
    </div>
  );
}

function Photos() {
  const { data, err, act, reload } = useData("/api/project/photos");
  const wbs = useData("/api/project/daily-reports");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [upload, setUpload] = useState<Rec | null>(null);
  const [problem, setProblem] = useState("");
  const file = useRef<HTMLInputElement>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.photos as Rec[];
  const open = rows.find((p) => p.id === sel);
  const review = async (mode: string) => { setBusy(mode); await act(() => api(`/api/project/photos/${open?.id}/review`, { mode })); setBusy(""); };
  const send = async () => {
    const f = file.current?.files?.[0];
    if (!f || !upload) return;
    setProblem("");
    const body = new FormData();
    body.append("file", f);
    Object.entries(upload).forEach(([k, v]) => body.append(k, String(v)));
    try {
      const r = await fetch(`${API_URL}/api/project/photos`, { method: "POST", body });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText);
      setUpload(null);
      await reload();
      notifyChanged();
    } catch (e) { setProblem((e as Error).message); }
  };
  const flagged = rows.filter((p) => p.review?.defects?.length);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Photo evidence" note="an agent can look for defects: a person raises the NCR"><button onClick={() => { setSel(null); setUpload({ caption: "", activity: "", area: "", taken_by: "" }); }} className={primary}><Icon name="upload" className="mr-1 inline h-3 w-3" />Upload a photo</button></Bar>
        <Problem err={err || problem} />
        <Kpis><Kpi label="photos" value={rows.length} /><Kpi label="reviewed" value={rows.filter((p) => p.review).length} /><Kpi label="with possible defects" value={flagged.length} tone={flagged.length ? "bad" : "ok"} /></Kpis>
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(170px,1fr))] content-start gap-2 overflow-auto bg-[#161a1f] p-3">
          {rows.map((p) => (
            <button key={p.id} onClick={() => { setUpload(null); setSel(p.id); }} className={`overflow-hidden rounded border text-left ${sel === p.id ? "border-white" : p.review?.defects?.length ? "border-[#e5484d]/70" : "border-white/10 hover:border-white/30"} bg-[#1c2127]`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${API_URL}/api/project/photos/${p.id}`} alt={p.caption} loading="lazy" className="h-[110px] w-full object-cover" />
              <span className="block p-1.5"><span className="block truncate text-[11px] text-white">{p.caption}</span><span className="block truncate text-[10px] text-[#8f99a8]">{p.id} · {short(p.date)}{p.wbs ? ` · ${p.wbs}` : ""}</span>{p.review?.defects?.length > 0 && <span className="text-[10px] font-medium text-[#ffb4b4]">{p.review.defects.length} possible defect{p.review.defects.length === 1 ? "" : "s"}</span>}</span>
            </button>
          ))}
          {!rows.length && <Empty>No photos yet.</Empty>}
        </div>
      </div>
      {upload && (
        <Side title="Upload a photo" onClose={() => setUpload(null)}>
          <input ref={file} type="file" aria-label="Photo" accept=".png,.jpg,.jpeg" className="w-full text-[11px] text-[#d3d8de] file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" />
          <label className="block"><Label>Caption</Label><input value={upload.caption} onChange={(e) => setUpload({ ...upload, caption: e.target.value })} className={field} /></label>
          <label className="block"><Label>Activity</Label><select value={upload.activity} onChange={(e) => setUpload({ ...upload, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2127]">None</option>{((wbs.data?.activities ?? []) as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2127]">{a.id} {a.name}</option>)}</select></label>
          <button onClick={send} className={`${primary} w-full`}>Upload</button>
          {problem && <p className="text-[#ffb4b4]">{problem}</p>}
        </Side>
      )}
      {open && !upload && (
        <PhotoPanel open={open} busy={busy} review={review} act={act} onClose={() => setSel(null)} />
      )}
    </div>
  );
}

function PhotoPanel({ open, busy, review, act, onClose }: { open: Rec; busy: string; review: (mode: string) => void; act: (fn: () => Promise<unknown>) => Promise<boolean>; onClose: () => void }) {
  const go = useGo();
  const r = open.review as Rec | null;
  return (
    <Side eyebrow={`${open.id} · ${open.date ?? ""}`} title={open.caption} onClose={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${API_URL}/api/project/photos/${open.id}`} alt={open.caption} className="w-full rounded border border-white/10" />
      <p className="text-[11px] text-[#abb3bf]">{open.source === "upload" ? "Uploaded by you." : "Synthetic, AI-generated site photo."} Taken by {open.taken_by}.</p>
      {(open.inspections as string[]).length > 0 && <div><Label>Evidence for</Label><div className="mt-0.5 flex flex-wrap gap-1">{(open.inspections as string[]).map((x) => <Ref key={x} to={`quality/inspections:${x}`}>{x}</Ref>)}</div></div>}
      <div className="space-y-1">
        <Label>Look for defects</Label>
        <span className="flex gap-1"><button disabled={!!busy} onClick={() => review("mock")} className={`${quiet} flex-1`}>{busy === "mock" ? "Looking…" : "Review: offline"}</button><button disabled={!!busy} onClick={() => review("muse")} title="Sends this photo to the Meta Model API. About a cent." className={`${quiet} flex-1`}>{busy === "muse" ? "Looking…" : "Review: Muse"}</button></span>
        {r && (
          <div className="space-y-1 rounded border border-white/10 p-2">
            <p className="text-[10.5px] text-[#8f99a8]">{r.method} · {r.at}</p>
            {(r.defects as Rec[]).map((d, i) => (
              <div key={i} className="flex items-start gap-1.5"><Pill tone={SEVERITY[d.severity] ?? "warn"}>{d.severity}</Pill><p className="min-w-0 flex-1 leading-snug text-[#e5e8eb]">{d.what}{d.where ? `, ${d.where}` : ""}</p>
                <button onClick={async () => { if (await act(() => api("/api/project/ncrs", { title: `${d.what} (${open.caption})`, by: "", activity: open.activity ?? "", due: "", photo: open.id }))) go("quality/ncrs"); }} className={quiet}>Raise NCR</button></div>
            ))}
            {!(r.defects as Rec[]).length && <p className="text-[#7ee2c0]">No defects reported.</p>}
          </div>
        )}
      </div>
    </Side>
  );
}

export function QualityModule({ sub, target }: { sub: string; target: string }) {
  const tab = ["ncrs", "photos"].includes(sub) ? sub : "inspections";
  const { data } = useData("/api/project/overview");
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SubTabs base="quality" sub={tab} tabs={[["inspections", "Inspections"], ["ncrs", "NCRs", data?.counts?.open_ncrs || undefined], ["photos", "Photos"]]} />
      <AgentBar module="quality" />
      {tab === "inspections" && <Inspections target={target} />}
      {tab === "ncrs" && <Ncrs target={target} />}
      {tab === "photos" && <Photos />}
    </div>
  );
}
