"use client";
import { useEffect, useState } from "react";
import { api, Bar, clean, field, full, good, Kpi, Kpis, Label, Loading, money, Pill, primary, Problem, quiet, short, Side, Table, td, tr, useData, type Rec, type Tone } from "./kit";

/* Subcontractors: onboarding, documents and their expiry, packages, invoices and what each one owes. A subcontractor cannot be approved with a document missing or expired, and an invoice cannot be certified past the work verified. */

const RATING: Record<string, Tone> = { good: "ok", watch: "warn", new: "violet" };
const INVOICE: Record<string, Tone> = { submitted: "warn", certified: "info", paid: "ok" };
const EMPTY = { name: "", trade: "", scope: "", crew: "", contact: "", phone: "" };

export function SubcontractorsView({ target }: { target?: string }) {
  const { data, err, act } = useData("/api/project/subcontractors");
  const [sel, setSel] = useState<string | null>(target || null);
  useEffect(() => { if (target) setSel(target); }, [target]);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [doc, setDoc] = useState({ name: "", expires: "" });
  const [edit, setEdit] = useState<typeof EMPTY | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [sel]);
  const rows = (data?.subcontractors as Rec[] | undefined) ?? [];
  const open = rows.find((s) => s.id === sel);
  useEffect(() => { if (open) setEdit({ name: String(open.name).replace(" (fictional)", ""), trade: open.trade ?? "", scope: open.scope ?? "", crew: String(open.crew ?? ""), contact: open.contact ?? "", phone: open.phone ?? "" }); }, [sel]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const paid = rows.reduce((n, s) => n + s.paid_to_date, 0), held = rows.reduce((n, s) => n + s.retention_held, 0);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Bar title="Subcontractors" note="packages, documents, performance and payments">
          <button onClick={() => { void act(() => api("/api/project/subcontractors/sample", {})); }} title="Synthetic partner companies, so a new project has someone to give work to. Edit or remove them freely." className={quiet}>Load sample partners</button>
          <button onClick={() => { setForm({ ...EMPTY }); setSel(null); }} className={primary}>Add a subcontractor</button>
        </Bar>
        <Problem err={err} />
        <Kpis>
          <Kpi label="subcontractors" value={rows.length} />
          <Kpi label="on watch" value={rows.filter((s) => s.rating === "watch").length} tone={rows.some((s) => s.rating === "watch") ? "warn" : "ok"} />
          <Kpi label="under subcontract" value={money(rows.reduce((n, s) => n + s.contract_value, 0))} />
          <Kpi label="paid to date" value={money(paid)} />
          <Kpi label="retention held" value={money(held)} />
          <Kpi label="invoices to certify" value={rows.flatMap((s) => s.invoices as Rec[]).filter((i) => i.status === "submitted").length} />
        </Kpis>
        <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
          <Table heads={["Subcontractor", "Trade", "Standing", "Crew", "Contract", "Paid", "Next activity", "Open NCRs", "Documents"]}>
            {rows.map((s) => {
              const next = (s.activities as Rec[]).filter((a) => a.progress < 100).sort((a, b) => (a.start < b.start ? -1 : 1))[0];
              return (
                <tr key={s.id} onClick={() => { setSel(s.id); setForm(null); }} className={`${tr} cursor-pointer ${sel === s.id ? "bg-white/[.07]" : ""}`}>
                  <td className={`${td} font-medium text-white`}>{clean(s.name)}{s.contact ? <span className="block text-[10.5px] font-normal text-[#8f99a8]">{s.contact}{s.phone ? ` · ${s.phone}` : ""}</span> : null}</td><td className={td}>{s.trade}</td><td className={td}><Pill tone={RATING[s.rating]}>{s.rating}</Pill></td><td className={td}>{s.crew}</td>
                  <td className={td}>{money(s.contract_value)}</td><td className={td}>{money(s.paid_to_date)}</td>
                  <td className={td}>{next ? <>{next.id} on {short(next.start)}{next.critical && <span className="ml-1 text-[10px] text-[#fbd38d]">critical</span>}</> : "–"}</td>
                  <td className={td}>{s.open_ncrs.length ? <Pill tone="bad">{s.open_ncrs.join(", ")}</Pill> : "none"}</td>
                  <td className={td}>{s.expired.length ? <Pill tone="bad">{s.expired.length} expired</Pill> : s.missing.length ? <Pill tone="warn">{s.missing.length} missing</Pill> : s.expiring.length ? <Pill tone="warn">{s.expiring.length} expiring</Pill> : <Pill tone="ok">valid</Pill>}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      </div>
      {form && (
        <Side title="Add a subcontractor" onClose={() => setForm(null)}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Company name" className={field} />
          <input value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder="Trade" className={field} />
          <textarea value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} rows={2} placeholder="Scope of work" className={field} />
          <input type="number" value={form.crew} onChange={(e) => setForm({ ...form, crew: e.target.value })} placeholder="Crew size" className={field} />
          <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Contact person" className={field} />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone / WhatsApp" className={field} />
          <p className="text-[11px] text-[#abb3bf]">It starts in onboarding. It can be approved once {(data.required_documents as string[]).join(", ")} are recorded and valid. Once in the database it is an option wherever work is given out, including the WBS.</p>
          <button disabled={!form.name.trim() || !form.trade.trim()} onClick={async () => { if (await act(() => api("/api/project/subcontractors", { ...form, crew: Number(form.crew) || 0 }))) setForm(null); }} className={`${primary} w-full`}>Start onboarding</button>
        </Side>
      )}
      {open && (
        <Side eyebrow={open.trade} title={clean(open.name)} onClose={() => setSel(null)}>
          <div className="flex flex-wrap gap-1"><Pill tone={RATING[open.rating]}>{open.rating}</Pill><Pill>{open.status}</Pill>{open.package && <Pill>{open.package}</Pill>}<Pill>crew {open.crew}</Pill></div>
          {open.scope && <p className="text-[#d3d8de]">{open.scope}</p>}
          {(open.contact || open.phone) && <p className="text-[#d3d8de]">{open.contact}{open.phone ? ` · ${open.phone}` : ""}</p>}
          {edit && (
            <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-2">
              <Label>Database details</Label>
              <input aria-label="Company name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Company name" className={field} />
              <div className="flex gap-1.5"><input aria-label="Trade" value={edit.trade} onChange={(e) => setEdit({ ...edit, trade: e.target.value })} placeholder="Trade" className={field} /><input aria-label="Crew size" type="number" min={0} value={edit.crew} onChange={(e) => setEdit({ ...edit, crew: e.target.value })} placeholder="Crew" className={`${field} !w-[86px] shrink-0`} /></div>
              <textarea aria-label="Scope of work" value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} rows={2} placeholder="Scope of work" className={field} />
              <div className="flex gap-1.5"><input aria-label="Contact person" value={edit.contact} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} placeholder="Contact person" className={field} /><input aria-label="Phone" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="Phone / WhatsApp" className={field} /></div>
              <button disabled={!edit.name.trim() || !edit.trade.trim()} onClick={() => act(() => api(`/api/project/subcontractors/${open.id}`, { ...edit, crew: Number(edit.crew) || 0 }))} className={`${primary} w-full`}>Save the details</button>
            </div>
          )}
          {open.status === "onboarding" && <button onClick={() => act(() => api(`/api/project/subcontractors/${open.id}/approve`, {}))} className={`${good} w-full`}>Approve this subcontractor</button>}
          {confirming ? (
            <div className="space-y-1.5 rounded-lg border border-[#e5484d]/40 bg-[#e5484d]/10 p-2">
              <p className="text-[#ffb4b4]">Remove {clean(open.name)} from the database? Work already done and its history stay; a partner with work programmed or invoices cannot be removed.</p>
              <div className="flex gap-1.5"><button onClick={async () => { if (await act(() => api(`/api/project/subcontractors/${open.id}/remove`, {}))) setSel(null); }} className="flex-1 rounded-md bg-[#e5484d] px-3 py-1.5 text-[11.5px] font-semibold text-white hover:brightness-110">Yes, remove them</button><button onClick={() => setConfirming(false)} className={`${quiet} flex-1`}>Keep them</button></div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className="w-full rounded-md border border-[#e5484d]/50 px-3 py-1.5 text-[11.5px] font-medium text-[#ffb4b4] hover:bg-[#e5484d]/10">Remove from the database</button>
          )}
          <div className="space-y-1">
            <Label>Documents</Label>
            {(open.documents as Rec[]).map((d) => {
              const bad = d.expires < data.today, soon = (open.expiring as string[]).includes(d.name);
              return <p key={d.name} className="flex items-center justify-between gap-2 text-[#d3d8de]"><span>{d.name}</span><Pill tone={bad ? "bad" : soon ? "warn" : "ok"}>{bad ? "expired" : "valid to"} {d.expires}</Pill></p>;
            })}
            {(open.missing as string[]).map((n) => <p key={n} className="flex items-center justify-between gap-2 text-[#d3d8de]"><span>{n}</span><Pill tone="warn">missing</Pill></p>)}
            <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-1 pt-1">
              <input value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} placeholder="Document" className={field} />
              <input type="date" aria-label="Expires" value={doc.expires} onChange={(e) => setDoc({ ...doc, expires: e.target.value })} className={field} />
              <button disabled={!doc.name.trim() || !doc.expires} onClick={async () => { if (await act(() => api(`/api/project/subcontractors/${open.id}/documents`, doc))) setDoc({ name: "", expires: "" }); }} className={quiet}>Record</button>
            </div>
          </div>
          {(open.activities as Rec[]).length > 0 && (
            <div><Label>Activities</Label>{(open.activities as Rec[]).map((a) => <p key={a.id} className="text-[#d3d8de]"><span className="text-[#8f99a8]">{a.id}</span> {a.name}, {short(a.start)} to {short(a.finish)}{a.critical ? " (critical)" : ""}</p>)}</div>
          )}
          {(open.invoices as Rec[]).length > 0 && (
            <div className="space-y-1.5">
              <Label>Invoices</Label>
              {(open.invoices as Rec[]).map((i) => {
                const over = i.certified_to_date + i.claimed - i.earned_to_date;
                return (
                  <div key={i.id} className="rounded border border-white/10 p-2">
                    <div className="flex items-center gap-2"><span className="font-medium text-white">{i.id}</span><span className="text-[11px] text-[#abb3bf]">{i.period}</span><span className="ml-auto"><Pill tone={INVOICE[i.status]}>{i.status}</Pill></span></div>
                    <p className="mt-1 text-[11px] text-[#d3d8de]">Claimed {full(i.claimed)}{i.status !== "submitted" ? `, certified ${full(i.certified)}` : ""}</p>
                    <p className="text-[11px] text-[#abb3bf]">Verified work {full(i.earned_to_date)}, certified {full(i.certified_to_date)}, paid {full(i.paid_to_date)}</p>
                    {i.status === "submitted" && over > 0 && <p className="mt-1 text-[11px] text-[#fbd38d]">This bills {full(over)} past the verified work. Certifying caps it at what is verified.</p>}
                    {i.status === "submitted" && <button onClick={() => act(() => api(`/api/project/invoices/${i.id}/certify`, {}))} className={`${primary} mt-1.5 w-full`}>Certify</button>}
                    {i.status === "certified" && <button onClick={() => act(() => api(`/api/project/invoices/${i.id}/pay`, {}))} className={`${good} mt-1.5 w-full`}>Record the payment, less retention</button>}
                  </div>
                );
              })}
            </div>
          )}
        </Side>
      )}
    </div>
  );
}
