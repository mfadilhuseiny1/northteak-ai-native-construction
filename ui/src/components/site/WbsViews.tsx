"use client";
import { useState } from "react";
import { Bar, dates, Empty, Kpi, Kpis, Label, Loading, money, num, Pill, Problem, Table, td, tr, useData, useGo, type Rec } from "./kit";
import { openSource } from "./SourceDrawer";

/* The WBS as a contractor reads it: the work packages, the control accounts above them, and the dictionary saying what each one is. Code lays these out from what the agents wrote and the records hold. */

export function WorkPackages() {
  const { data, err } = useData("/api/project/work-packages");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.packages as Rec[];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Work packages" note="the lowest level at which cost and time are planned" />
      <Problem err={err} />
      <Kpis>
        <Kpi label="work packages" value={rows.length} />
        <Kpi label="worth" value={money(rows.reduce((n, w) => n + w.value, 0))} />
        <Kpi label="tasks" value={rows.reduce((n, w) => n + w.tasks, 0)} />
        <Kpi label="no float" value={rows.filter((w) => w.critical).length} tone={rows.some((w) => w.critical) ? "warn" : "ok"} />
        <Kpi label="information not ready" value={rows.filter((w) => !w.ready.ready).length} tone={rows.some((w) => !w.ready.ready) ? "warn" : "ok"} />
      </Kpis>
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["WBS", "Work package", "Control account", "Responsible", "Dates", "Days", "Float", "Worth", "Tasks", "Man-hours"]}>
          {rows.map((w) => (
            <tr key={w.id} onClick={() => go(`wbs/tree:${w.code}`)} className={`${tr} cursor-pointer`}>
              <td className={`${td} whitespace-nowrap font-mono text-[10.5px] text-[#8f99a8]`}>{w.code}</td>
              <td className={td}><span className="text-white">{w.name}</span>{w.no && <span className="ml-1.5 text-[10.5px] text-[#8f99a8]">schedule item {w.no}</span>}</td>
              <td className={`${td} whitespace-nowrap`}>{w.account}</td>
              <td className={td}>{w.responsible}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{dates(w.start, w.finish)}</td>
              <td className={`${td} tabular-nums`}>{w.duration}</td>
              <td className={td}>{w.critical ? <Pill tone="warn">none</Pill> : <span className="tabular-nums">{w.float_days || "–"}</span>}</td>
              <td className={`${td} whitespace-nowrap`}>{w.value ? money(w.value) : "–"}</td>
              <td className={`${td} tabular-nums`}>{w.tasks || "–"}</td>
              <td className={`${td} tabular-nums`}>{w.man_hours ? num(w.man_hours, 0) : "–"}</td>
            </tr>
          ))}
        </Table>
        {!rows.length && <Empty>No work packages yet. They come from the AI analysis of the documents.</Empty>}
      </div>
    </div>
  );
}

export function ControlAccounts() {
  const { data, err } = useData("/api/project/control-accounts");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.accounts as Rec[], t = data.total as Rec;
  const going = t.pv > 0 || t.ev > 0 || t.ac > 0;  // before work starts all of these are zero, and a green 1.00 would say all is well when nothing has been measured
  const owner = rows.some((a) => a.against_owner_pct != null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Control accounts" note="where scope, budget and schedule meet, each with one person answering for it" />
      <Problem err={err} />
      <Kpis>
        <Kpi label="control accounts" value={rows.length} />
        <Kpi label="budget" value={money(t.budget)} />
        {going && <>
          <Kpi label="planned value by today" value={money(t.pv)} />
          <Kpi label="earned value" value={money(t.ev)} />
          <Kpi label="actual cost" value={money(t.ac)} />
          <Kpi label="CPI · SPI" value={`${Number(t.cpi).toFixed(2)} · ${Number(t.spi).toFixed(2)}`} tone={t.cpi < 1 || t.spi < 1 ? "warn" : "ok"} />
        </>}
      </Kpis>
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <Table heads={["WBS", "Control account", "Responsible", "Work packages", "Dates", "Budget", ...(owner ? ["Against the owner's estimate"] : []), ...(going ? ["Earned", "Actual", "Forecast", "CPI", "SPI"] : [])]}>
          {rows.map((a) => (
            <tr key={a.id} onClick={() => go(`wbs/tree:${a.code}`)} className={`${tr} cursor-pointer`}>
              <td className={`${td} whitespace-nowrap font-mono text-[10.5px] text-[#8f99a8]`}>{a.code}</td>
              <td className={td}><span className="mr-1.5 text-[10.5px] text-[#8f99a8]">{a.id}</span><span className="text-white">{a.name}</span></td>
              <td className={td}>{a.responsible}</td>
              <td className={`${td} tabular-nums`}>{a.packages}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{dates(a.start, a.finish)}</td>
              <td className={`${td} whitespace-nowrap`}>{money(a.budget)}</td>
              {owner && <td className={td}>{a.against_owner_pct == null ? "–" : <Pill tone={a.against_owner_pct <= -5 ? "warn" : "none"}>{a.against_owner_pct > 0 ? "+" : ""}{a.against_owner_pct}%</Pill>}</td>}
              {going && <>
                <td className={`${td} whitespace-nowrap`}>{money(a.ev)}</td><td className={`${td} whitespace-nowrap`}>{money(a.ac)}</td><td className={`${td} whitespace-nowrap`}>{money(a.eac)}</td>
                <td className={td}><Pill tone={a.cpi < 1 ? "warn" : "ok"}>{Number(a.cpi).toFixed(2)}</Pill></td><td className={td}><Pill tone={a.spi < 1 ? "warn" : "ok"}>{Number(a.spi).toFixed(2)}</Pill></td>
              </>}
            </tr>
          ))}
        </Table>
        {!rows.length && <Empty>No control accounts yet. They come from the AI analysis of the documents.</Empty>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label}</Label><div className="mt-0.5 leading-snug text-[#e5e8eb]">{children}</div></div>;
}

export function Dictionary() {
  const { data, err } = useData("/api/project/wbs-dictionary");
  const [sel, setSel] = useState<string | null>(null);
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.entries as Rec[];
  const e = rows.find((x) => x.code === sel) ?? rows.find((x) => x.level === "Work package") ?? rows[0];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-[12px]">
      <div className="w-[300px] shrink-0 overflow-y-auto border-r border-black/30 bg-[#1c2127] py-1">
        {rows.map((x) => (
          <button key={x.code} onClick={() => setSel(x.code)} aria-current={e?.code === x.code ? "true" : undefined} className={`block w-full px-3 py-1 text-left hover:bg-white/5 ${e?.code === x.code ? "bg-white/10" : ""} ${x.level === "Control account" ? "mt-1 font-semibold text-white" : "pl-5 text-[#d3d8de]"}`}>
            <span className="mr-1.5 font-mono text-[10.5px] font-normal text-[#8f99a8]">{x.code}</span>{x.name}
          </button>
        ))}
        {!rows.length && <Empty>Nothing to describe yet.</Empty>}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto bg-[#161a1f] p-4">
        <Problem err={err} />
        {e && (
          <div className="mx-auto max-w-[820px] space-y-3">
            <div>
              <p className="text-[11px] text-[#8f99a8]">{e.level} · WBS {e.code}{e.no ? ` · schedule item ${e.no}` : ""}</p>
              <p className="text-[17px] font-semibold text-white">{e.name}</p>
            </div>
            {e.scope && <Field label="Scope of work">{e.scope}</Field>}
            {e.deliverable && <Field label="Deliverable">{e.deliverable}</Field>}
            {e.acceptance && <Field label="How it is accepted">{e.acceptance}</Field>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 rounded border border-white/10 bg-[#1c2127] p-3">
              <Field label="Responsible">{e.responsible || "–"}</Field>
              <Field label="Dates">{e.start ? `${e.start} to ${e.finish}` : "–"}</Field>
              <Field label="Duration">{e.duration ? `${e.duration} days` : "–"}</Field>
              <Field label="Worth">{e.value ? money(e.value) : "–"}</Field>
              <Field label="Tasks">{e.tasks || "–"}</Field>
              <Field label="Inspections">{e.inspections || "–"}</Field>
              <Field label="Man-hours, estimated">{e.man_hours ? num(e.man_hours, 0) : "–"}</Field>
            </div>
            {(e.before as Rec[]).length > 0 && <Field label="Comes before it">{(e.before as Rec[]).map((x) => <button key={x.id} onClick={() => setSel(x.code)} className="mr-2 text-[#9cc7f5] hover:underline">{x.code} {x.name}</button>)}</Field>}
            {(e.after as Rec[]).length > 0 && <Field label="Comes after it">{(e.after as Rec[]).map((x) => <button key={x.id} onClick={() => setSel(x.code)} className="mr-2 text-[#9cc7f5] hover:underline">{x.code} {x.name}</button>)}</Field>}
            {(e.references as Rec[]).length > 0 && <Field label="Where the documents say so">{(e.references as Rec[]).map((r, i) => <button key={i} onClick={() => openSource({ doc: r.doc, page: r.from, title: r.title })} className="mr-3 text-[#9cc7f5] hover:underline">{r.title}, pages {r.from} to {r.to}</button>)}</Field>}
            {(e.assumptions as string[]).length > 0 && <Field label="Assumed">{(e.assumptions as string[]).map((x, i) => <p key={i}>{x}</p>)}</Field>}
            {(e.questions as Rec[]).length > 0 && <Field label="Open questions for the consultant">{(e.questions as Rec[]).map((q, i) => <p key={i}><b className="font-medium text-white">{q.subject}.</b> {q.question}</p>)}</Field>}
            {e.level === "Work package" && <button onClick={() => go("procedures")} className="text-[#9cc7f5] hover:underline">Read its procedures</button>}
          </div>
        )}
      </div>
    </div>
  );
}
