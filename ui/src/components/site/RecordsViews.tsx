"use client";
import { useState } from "react";
import { API_URL } from "@/lib/api";
import { Item, Legend, SERIES, SizeBar } from "./Visual";
import { api, Bar, Empty, field, full, good, inFocus, inline, Kpi, Kpis, Label, Loading, money, Pill, primary, Problem, quiet, Ref, Side, useData, useFocus, type Rec, type Tone } from "./kit";

/* The daily log, under Kanban: what happened on site each day. And claims with their payments, under BOQ & Cost. */

export function DailyReportsView() {
  const { data, err, act } = useData("/api/project/daily-reports");
  const { focus } = useFocus();
  const [form, setForm] = useState<Rec | null>(null);
  const [area, setArea] = useState("");
  const [photo, setPhoto] = useState<Rec | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const AREAS = [...new Set((data.reports as Rec[]).map((r) => r.area as string))].sort();
  const reports = (data.reports as Rec[]).filter((r) => (!area || r.area === area) && (!focus || focus.type === "project" || inFocus(focus, { activity: r.activity, package: r.package })));
  const days = [...new Set(reports.map((r) => r.date as string))];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Daily log" note={`${data.reports.length} entries, ${(data.reports as Rec[]).filter((r) => !r.verified).length} waiting for verification. The swarm reads these live.`}>
          <select aria-label="Filter by area" value={area} onChange={(e) => setArea(e.target.value)} className={`${inline} w-[130px]`}><option value="" className="bg-[#1c2733]">All areas</option>{AREAS.map((a) => <option key={a} className="bg-[#1c2733]">{a}</option>)}</select>
          <button onClick={() => { setForm({ date: data.today, area: AREAS[0] ?? "", package: "", activity: focus?.activities[0] ?? "", crew: "", weather: "", author: "", text: "" }); setPhoto(null); }} className={primary}>File a report</button>
        </Bar>
        <Problem err={err} />
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/5 bg-[#111820] p-2">
          {(data.photos as Rec[]).map((p) => (
            <button key={p.id} onClick={() => { setPhoto(p); setForm(null); }} title={p.caption} className="shrink-0 overflow-hidden rounded border border-white/10 hover:border-white/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${API_URL}/api/project/photos/${p.id}`} alt={p.caption} loading="lazy" className="h-[60px] w-[90px] object-cover" />
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#111820] p-3">
          {days.map((d) => (
            <div key={d} className="mb-3">
              <p className="mb-1 text-[11px] font-semibold text-[#d3d8de]">{d}</p>
              <div className="rounded border border-white/10 bg-[#1c2733]">
                {reports.filter((r) => r.date === d).map((r) => (
                  <div key={r.id} className="flex items-start gap-2 border-t border-white/5 px-3 py-1.5 first:border-t-0">
                    <span className="w-[62px] shrink-0 text-[10.5px] text-[#8f99a8]">{r.id}</span>
                    <span className="w-[76px] shrink-0 text-[11px] text-[#abb3bf]">{r.area}{r.activity ? <span className="block text-[10px] text-[#8f99a8]">{r.activity}</span> : null}</span>
                    <p className="min-w-0 flex-1 text-[#e5e8eb]">{r.text}{(r.crew || r.weather) && <span className="ml-2 text-[10.5px] text-[#8f99a8]">{r.crew ? `crew ${r.crew}` : ""}{r.crew && r.weather ? " · " : ""}{r.weather}</span>}</p>
                    <span className="shrink-0 text-[10.5px] text-[#8f99a8]">{r.author}</span>
                    {r.verified ? <Pill tone="ok">verified</Pill> : <button onClick={() => act(() => api(`/api/project/daily-reports/${r.id}/verify`, {}))} className={quiet}>Verify</button>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!days.length && <Empty>No reports yet.</Empty>}
        </div>
      </div>
      {form && (
        <Side title="File a daily report" onClose={() => setForm(null)}>
          <div className="grid grid-cols-2 gap-2">
            <label><Label>Date</Label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={field} /></label>
            <label><Label>Area</Label><input list="daily-areas" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className={field} /><datalist id="daily-areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist></label>
            <label><Label>Crew on site</Label><input type="number" value={form.crew} onChange={(e) => setForm({ ...form, crew: e.target.value })} className={field} /></label>
            <label><Label>Weather</Label><input value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} className={field} /></label>
          </div>
          <label className="block"><Label>Work package</Label><select value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">None</option>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2733]">{p.name}</option>)}</select></label>
          <label className="block"><Label>Activity</Label><select value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} className={field}><option value="" className="bg-[#1c2733]">None</option>{(data.activities as Rec[]).map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.id} {a.name}</option>)}</select></label>
          <label className="block"><Label>Filed by</Label><input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Name or role" className={field} /></label>
          <label className="block"><Label>What happened</Label><textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={5} className={field} /></label>
          <button disabled={!form.text.trim()} onClick={async () => { if (await act(() => api("/api/project/daily-reports", { ...form, crew: form.crew === "" ? null : Number(form.crew) }))) setForm(null); }} className={`${primary} w-full`}>File the report</button>
          <p className="text-[11px] text-[#abb3bf]">It stays unverified until a supervisor verifies it.</p>
        </Side>
      )}
      {photo && (
        <Side eyebrow={`${photo.id} · ${photo.date}`} title={photo.caption} onClose={() => setPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${API_URL}/api/project/photos/${photo.id}`} alt={photo.caption} className="w-full rounded border border-white/10" />
          <p className="text-[11px] text-[#abb3bf]">{photo.source === "upload" ? "Uploaded by you." : "Synthetic, AI-generated site photo."} Taken by {photo.taken_by}. <Ref to="quality/photos">Review it in QA/QC</Ref></p>
        </Side>
      )}
    </div>
  );
}

const LINE: Record<string, [string, Tone]> = { supported: ["Supported", "ok"], weak_evidence: ["Beyond evidence", "bad"], unbilled: ["Not billed yet", "info"], needs_inspection: ["Site check", "warn"], billing_error: ["Billing error", "violet"] };
const CLAIM: Record<string, Tone> = { draft: "warn", submitted: "info", certified: "violet", paid: "ok" };
const pct = (v: number | null) => (v == null ? <span className="text-[#6b7480]">–</span> : `${v}%`);

export function ClaimsView() {
  const { data, err, act } = useData("/api/project/claim");
  const [sel, setSel] = useState<string | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  if (data.none) return <div className="flex-1 bg-[#111820] text-[12px]"><Empty>No progress claim on this project yet. Claims are in the scenario only for now.</Empty></div>;
  const t = data.totals as Rec, c = data.certificate as Rec, lines = data.lines as Rec[];
  const open = lines.find((l) => l.code === sel);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title={`Progress claim ${data.no}`} note={`${data.period} · cut-off ${data.cutoff}`}>
          <Pill tone={CLAIM[data.status]}>{data.status}</Pill>
          {data.status === "draft" && <>
            <button onClick={() => act(() => api("/api/project/claim/submit", { adjusted: false }))} className={quiet}>Submit as drafted</button>
            <button onClick={() => act(() => api("/api/project/claim/submit", { adjusted: true }))} className={primary}>Submit, adjusted to the evidence</button>
          </>}
          {data.status === "submitted" && <button onClick={() => act(() => api("/api/project/claim/certify", {}))} className={primary}>Record the owner&apos;s certificate</button>}
          {data.status === "certified" && <button onClick={() => act(() => api("/api/project/claim/paid", {}))} className={good}>Record the owner&apos;s payment</button>}
        </Bar>
        <Problem err={err} />
        <Kpis>
          <Kpi label="draft claim" value={money(t.claimed)} />
          <Kpi label="adjusted to the evidence" value={money(t.recommended)} />
          <Kpi label="claimed beyond evidence" value={money(t.beyond_evidence)} tone={t.beyond_evidence ? "bad" : "ok"} />
          <Kpi label="work not billed yet" value={money(t.not_billed)} tone={t.not_billed ? "warn" : "ok"} />
          <Kpi label="billing errors" value={money(t.billing_errors)} tone={t.billing_errors ? "warn" : "ok"} />
          <Kpi label="lines needing a site check" value={t.site_checks} tone={t.site_checks ? "warn" : "ok"} />
          <Kpi label="this certificate" value={money(c.this_period)} hint={`${money(c.payable)} after retention`} />
        </Kpis>
        <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/[.05] px-3 py-1.5"><Legend items={[{ label: "claimed", color: SERIES[1] }, { label: "seen in photos", color: SERIES[0] }, { label: "in the daily log", color: SERIES[2] }]} /><span className="text-[10.5px] text-[#8f99a8]">each bar is % of the line done</span></div>
          <div className="divide-y divide-white/[.05]">
            {lines.map((l) => (
              <Item key={l.code} wide code={l.code} selected={sel === l.code} onClick={() => setSel(l.code)}
                title={<span className="text-white">{l.name}</span>}
                meta={`${l.package} · worth ${money(l.value)}`}
                visual={<span className="block space-y-[3px]">{[["claimed", l.claimed_pct, SERIES[1]], ["photos", l.photo_pct, SERIES[0]], ["daily log", l.log_pct, SERIES[2]]].map(([label, v, color]) => <span key={label as string} className="flex items-center gap-2"><span className="w-[52px] shrink-0 text-[10px] text-[#8f99a8]">{label as string}</span><SizeBar value={(v as number | null) ?? 0} max={100} color={color as string} /><span className="w-[34px] shrink-0 text-right text-[10px] tabular-nums text-[#d3d8de]">{v == null ? "–" : `${v}%`}</span></span>)}</span>}
                value={<span className="block text-right"><Pill tone={LINE[l.status][1]}>{LINE[l.status][0]}</Pill><span className="mt-1 block text-[11px] font-normal text-[#8f99a8]">draft {money(l.amount)}</span>{l.recommended !== l.amount && <span className="block text-[11px] font-semibold text-[#fbd38d]">adjusted {money(l.recommended)}</span>}</span>} />
            ))}
          </div>
        </div>
      </div>
      {open ? (
        <Side eyebrow={`${open.code} · ${open.area}`} title={open.name} onClose={() => setSel(null)}>
          <Pill tone={LINE[open.status][1]}>{LINE[open.status][0]}</Pill>
          <p className="text-[#d3d8de]">{open.reason}</p>
          <div className="grid grid-cols-2 gap-2 text-[#d3d8de]">
            <div><Label>Draft amount</Label><p>{full(open.amount)}</p></div>
            <div><Label>Adjusted</Label><p>{full(open.recommended)}</p></div>
          </div>
        </Side>
      ) : (
        <aside className="w-[290px] shrink-0 space-y-1.5 border-l border-black/30 bg-[#1c2733] p-4 text-[12px] max-xl:hidden">
          <Label>Payment certificate</Label>
          {[["Cumulative value", c.cumulative], ["Previously certified", c.previous], ["This certificate", c.this_period], ["Retention, 5%", c.retention]].map(([k, v]) => (
            <p key={String(k)} className="flex justify-between gap-2 text-[#d3d8de]"><span>{k}</span><span className="tabular-nums">{full(v as number)}</span></p>
          ))}
          <p className="flex justify-between gap-2 border-t border-white/10 pt-1.5 font-semibold text-white"><span>Payable</span><span className="tabular-nums">{full(c.payable)}</span></p>
          {data.submitted_on && <p className="pt-2 text-[11px] text-[#abb3bf]">Submitted on {data.submitted_on}{data.adjusted ? ", adjusted to the evidence" : ", as drafted"}.</p>}
          {data.certified_on && <p className="text-[11px] text-[#abb3bf]">Certified on {data.certified_on}.</p>}
          {data.paid_on && <p className="text-[11px] text-[#abb3bf]">Paid on {data.paid_on}.</p>}
        </aside>
      )}
    </div>
  );
}
