"use client";
import { useState } from "react";
import { api, Bar, Card, clean, field, full, good, inline, Kpi, Kpis, Label, Loading, money, Pill, primary, Problem, quiet, short, Side, Table, td, tr, useData, type Rec, type Tone } from "./kit";

/* The smaller record screens: procurement, daily reports, quality, and claims with their payments. */

const PO_TONE: Record<string, Tone> = { "delay reported": "bad", confirmed: "info", received: "ok" };

export function ProcurementView() {
  const { data, err, act } = useData("/api/project/procurement");
  const [dates, setDates] = useState<Record<string, string>>({});
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.orders as Rec[];
  const late = rows.filter((p) => p.status !== "received" && p.promised > p.needed);
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Procurement" note="orders against the dates the schedule needs them" />
      <Problem err={err} />
      <Kpis>
        <Kpi label="orders" value={rows.length} />
        <Kpi label="late against need" value={late.length} tone={late.length ? "bad" : "ok"} />
        <Kpi label="received" value={rows.filter((p) => p.status === "received").length} />
        <Kpi label="order value" value={money(rows.reduce((n, p) => n + p.value, 0))} />
      </Kpis>
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["Order", "Item", "Supplier", "Holds", "Needed", "Promised", "Status", "Value", ""]}>
          {rows.map((p) => {
            const isLate = p.status !== "received" && p.promised > p.needed;
            return (
              <tr key={p.id} className={tr}>
                <td className={`${td} font-medium text-white`}>{p.id}</td>
                <td className={td}>{p.item}{p.note && <p className="text-[10.5px] text-[#8f99a8]">{p.note}</p>}</td>
                <td className={td}>{clean(p.supplier)}</td><td className={td}>{p.activity || "–"}</td><td className={td}>{short(p.needed)}</td>
                <td className={`${td} ${isLate ? "font-medium text-[#ffb4b4]" : ""}`}>{short(p.promised)}</td>
                <td className={td}><Pill tone={PO_TONE[p.status] ?? "none"}>{p.status}</Pill></td><td className={td}>{money(p.value)}</td>
                <td className={td}>
                  {p.status !== "received" && (
                    <span className="flex items-center gap-1">
                      <input type="date" aria-label={`New promised date for ${p.id}`} value={dates[p.id] ?? ""} onChange={(e) => setDates({ ...dates, [p.id]: e.target.value })} className={`${inline} w-[126px]`} />
                      <button disabled={!dates[p.id]} onClick={() => act(() => api(`/api/project/orders/${p.id}/promise`, { promised: dates[p.id] }))} className={quiet}>Update</button>
                      <button onClick={() => act(() => api(`/api/project/orders/${p.id}/receive`, {}))} className={quiet}>Received</button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}

export function DailyReportsView() {
  const { data, err, act } = useData("/api/project/daily-reports");
  const [form, setForm] = useState<Rec | null>(null);
  const [area, setArea] = useState("");
  const [photo, setPhoto] = useState<Rec | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const AREAS = [...new Set((data.reports as Rec[]).map((r) => r.area as string))].sort();
  const reports = (data.reports as Rec[]).filter((r) => !area || r.area === area);
  const days = [...new Set(reports.map((r) => r.date as string))];
  return (
    <div className="flex min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Daily reports" note={`${data.reports.length} entries, ${(data.reports as Rec[]).filter((r) => !r.verified).length} waiting for verification. The swarm reads these live.`}>
          <select aria-label="Filter by area" value={area} onChange={(e) => setArea(e.target.value)} className={`${inline} w-[130px]`}><option value="" className="bg-[#1c2127]">All areas</option>{AREAS.map((a) => <option key={a} className="bg-[#1c2127]">{a}</option>)}</select>
          <button onClick={() => { setForm({ date: data.today, area: "Level 3", package: "", crew: "", weather: "", author: "", text: "" }); setPhoto(null); }} className={primary}>File a report</button>
        </Bar>
        <Problem err={err} />
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/5 bg-[#161a1f] p-2">
          {(data.photos as Rec[]).map((p) => (
            <button key={p.id} onClick={() => { setPhoto(p); setForm(null); }} title={p.caption} className="shrink-0 overflow-hidden rounded border border-white/10 hover:border-white/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/project/photos/${p.id}`} alt={p.caption} loading="lazy" className="h-[60px] w-[90px] object-cover" />
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f] p-3">
          {days.map((d) => (
            <div key={d} className="mb-3">
              <p className="mb-1 text-[11px] font-semibold text-[#d3d8de]">{d}</p>
              <div className="rounded border border-white/10 bg-[#1c2127]">
                {reports.filter((r) => r.date === d).map((r) => (
                  <div key={r.id} className="flex items-start gap-2 border-t border-white/5 px-3 py-1.5 first:border-t-0">
                    <span className="w-[62px] shrink-0 text-[10.5px] text-[#8f99a8]">{r.id}</span>
                    <span className="w-[76px] shrink-0 text-[11px] text-[#abb3bf]">{r.area}</span>
                    <p className="min-w-0 flex-1 text-[#e5e8eb]">{r.text}{(r.crew || r.weather) && <span className="ml-2 text-[10.5px] text-[#8f99a8]">{r.crew ? `crew ${r.crew}` : ""}{r.crew && r.weather ? " · " : ""}{r.weather}</span>}</p>
                    <span className="shrink-0 text-[10.5px] text-[#8f99a8]">{r.author}</span>
                    {r.verified ? <Pill tone="ok">verified</Pill> : <button onClick={() => act(() => api(`/api/project/daily-reports/${r.id}/verify`, {}))} className={quiet}>Verify</button>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {form && (
        <Side title="File a daily report" onClose={() => setForm(null)}>
          <div className="grid grid-cols-2 gap-2">
            <label><Label>Date</Label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={field} /></label>
            <label><Label>Area</Label><select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className={field}>{AREAS.map((a) => <option key={a} className="bg-[#1c2127]">{a}</option>)}</select></label>
            <label><Label>Crew on site</Label><input type="number" value={form.crew} onChange={(e) => setForm({ ...form, crew: e.target.value })} className={field} /></label>
            <label><Label>Weather</Label><input value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} className={field} /></label>
          </div>
          <label className="block"><Label>Work package</Label><select value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} className={field}><option value="" className="bg-[#1c2127]">None</option>{(data.packages as Rec[]).map((p) => <option key={p.id} value={p.id} className="bg-[#1c2127]">{p.name}</option>)}</select></label>
          <label className="block"><Label>Filed by</Label><input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Name or role" className={field} /></label>
          <label className="block"><Label>What happened</Label><textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={5} className={field} /></label>
          <button disabled={!form.text.trim()} onClick={async () => { if (await act(() => api("/api/project/daily-reports", { ...form, crew: form.crew === "" ? null : Number(form.crew) }))) setForm(null); }} className={`${primary} w-full`}>File the report</button>
          <p className="text-[11px] text-[#abb3bf]">It stays unverified until a supervisor verifies it.</p>
        </Side>
      )}
      {photo && (
        <Side eyebrow={`${photo.id} · ${photo.date}`} title={photo.caption} onClose={() => setPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/project/photos/${photo.id}`} alt={photo.caption} className="w-full rounded border border-white/10" />
          <p className="text-[11px] text-[#abb3bf]">Synthetic, AI-generated site photo. Taken by {photo.taken_by}.</p>
        </Side>
      )}
    </div>
  );
}

const INSPECTION: Record<string, Tone> = { passed: "ok", failed: "bad" };

export function QualityView() {
  const { data, err, act } = useData("/api/project/quality");
  const [closing, setClosing] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [form, setForm] = useState<Rec | null>(null);
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const ncrs = data.ncrs as Rec[], ins = data.inspections as Rec[];
  const open = ncrs.filter((n) => n.status === "open");
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Quality" note="inspections, hold points and non-conformance reports. Closing an NCR signs off its hold point, and the swarm sees it.">
        <button onClick={() => setForm({ title: "", by: "besi", activity: "", due: "" })} className={primary}>Raise an NCR</button>
      </Bar>
      <Problem err={err} />
      <Kpis>
        <Kpi label="open NCRs" value={open.length} tone={open.length ? "bad" : "ok"} />
        <Kpi label="inspections passed" value={`${ins.filter((i) => i.status === "passed").length} of ${ins.length}`} />
        <Kpi label="inspections coming up" value={ins.filter((i) => i.next).length} />
      </Kpis>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#161a1f] p-3">
        {form && (
          <Card title="Raise an NCR">
            <div className="grid grid-cols-[minmax(0,1fr)_170px_100px_140px_auto] gap-2 p-2 max-lg:grid-cols-2">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What is wrong" className={field} />
              <input value={form.by} onChange={(e) => setForm({ ...form, by: e.target.value })} placeholder="Responsible" className={field} />
              <input value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} placeholder="Activity" className={field} />
              <input type="date" aria-label="Due" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className={field} />
              <button disabled={!form.title.trim()} onClick={async () => { if (await act(() => api("/api/project/ncrs", form))) setForm(null); }} className={primary}>Raise</button>
            </div>
          </Card>
        )}
        <Card title="Non-conformance reports">
          <Table heads={["NCR", "What", "Responsible", "Holds", "Raised", "Due", "Status", ""]}>
            {ncrs.map((n) => (
              <tr key={n.id} className={tr}>
                <td className={`${td} font-medium text-white`}>{n.id}</td><td className={td}>{n.title}{n.action && <p className="text-[10.5px] text-[#8f99a8]">{n.action}</p>}</td>
                <td className={td}>{clean(n.by_name)}</td><td className={td}>{n.activity || "–"}</td><td className={td}>{short(n.raised)}</td><td className={td}>{short(n.due)}</td>
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
        </Card>
        <Card title="Inspections and hold points">
          <Table heads={["ID", "What", "By", "Holds", "Last inspected", "Next", "Result"]}>
            {ins.map((i) => (
              <tr key={i.id} className={tr}><td className={`${td} font-medium text-white`}>{i.id}</td><td className={td}>{i.title}</td><td className={td}>{clean(i.by_name)}</td><td className={td}>{i.activity || "–"}</td><td className={td}>{short(i.date)}</td><td className={td}>{short(i.next)}</td><td className={td}><Pill tone={INSPECTION[i.status]}>{i.status}</Pill></td></tr>
            ))}
          </Table>
        </Card>
      </div>
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
  const t = data.totals as Rec, c = data.certificate as Rec, lines = data.lines as Rec[];
  const open = lines.find((l) => l.code === sel);
  return (
    <div className="flex min-w-0 flex-1 overflow-hidden text-[12px]">
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
        <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
          <Table heads={["Item", "Package", "Value", "Claimed", "Photos", "Daily log", "Result", "Draft amount", "Adjusted"]}>
            {lines.map((l) => (
              <tr key={l.code} onClick={() => setSel(l.code)} className={`${tr} cursor-pointer ${sel === l.code ? "bg-white/[.07]" : ""}`}>
                <td className={td}><span className="mr-1.5 text-[10.5px] text-[#8f99a8]">{l.code}</span><span className="text-white">{l.name}</span></td>
                <td className={td}>{l.package}</td><td className={td}>{money(l.value)}</td><td className={td}>{l.claimed_pct}%</td><td className={td}>{pct(l.photo_pct)}</td><td className={td}>{pct(l.log_pct)}</td>
                <td className={td}><Pill tone={LINE[l.status][1]}>{LINE[l.status][0]}</Pill></td><td className={td}>{money(l.amount)}</td>
                <td className={`${td} ${l.recommended !== l.amount ? "font-medium text-[#fbd38d]" : ""}`}>{money(l.recommended)}</td>
              </tr>
            ))}
          </Table>
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
        <aside className="w-[290px] shrink-0 space-y-1.5 border-l border-black/30 bg-[#1c2127] p-4 text-[12px] max-xl:hidden">
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
