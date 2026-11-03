"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { api, field, Label, money, num, Pill, primary, quiet, Ref, Side, dates, short, useData, useFocus, useGo, type Rec, type Tone } from "./kit";

/* One node of the WBS with everything every module holds on it: the place to see the whole of a piece of work, and to jump to any part of it. */

const LEVEL: Record<string, string> = { package: "control account", activity: "work package" };
export const CARD: Record<string, [string, Tone]> = { proposed: ["proposed", "violet"], open: ["to do", "none"], doing: ["in progress", "info"], review: ["in review", "warn"], done: ["done", "ok"] };
const INSPECTION: Record<string, Tone> = { passed: "ok", failed: "bad", planned: "info" };

function Block({ title, go, children }: { title: string; go?: string; children: ReactNode }) {
  const jump = useGo();
  return (
    <div>
      <div className="mb-0.5 flex items-center"><Label>{title}</Label>{go && <button onClick={() => jump(go)} className="ml-auto text-[10.5px] text-[#9cc7f5] hover:underline">Open the module</button>}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Actuals({ plan, s, onDone }: { plan: string; s: Rec; onDone: (fn: () => Promise<unknown>) => void }) {
  const [hours, setHours] = useState(s.actual?.man_hours != null ? String(s.actual.man_hours) : "");
  const [used, setUsed] = useState<Record<string, string>>(Object.fromEntries((s.materials as Rec[]).map((m) => [m.key, s.actual?.materials?.[m.key] != null ? String(s.actual.materials[m.key]) : ""])));
  return (
    <div className="space-y-1.5 rounded border border-white/10 p-2">
      <Label>What it really took</Label>
      <label className="flex items-center justify-between gap-2 text-[#d3d8de]">Man-hours <span className="flex items-center gap-1 text-[10.5px] text-[#8f99a8]">plan {s.man_hours}<input type="number" min={0} aria-label="Actual man-hours" value={hours} onChange={(e) => setHours(e.target.value)} className={`${field} !w-[84px]`} /></span></label>
      {(s.materials as Rec[]).map((m) => (
        <label key={m.key} className="flex items-center justify-between gap-2 text-[#d3d8de]"><span className="min-w-0 truncate">{m.name}</span><span className="flex shrink-0 items-center gap-1 text-[10.5px] text-[#8f99a8]">plan {num(m.gross)} {m.unit}<input type="number" min={0} aria-label={`Actual ${m.name}`} value={used[m.key]} onChange={(e) => setUsed({ ...used, [m.key]: e.target.value })} className={`${field} !w-[84px]`} /></span></label>
      ))}
      <button disabled={hours === "" && !Object.values(used).some((v) => v !== "")} onClick={() => onDone(() => api(`/api/project/plans/${plan}/steps/${s.id}/actual`, { man_hours: hours === "" ? null : Number(hours), materials: Object.fromEntries(Object.entries(used).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) }))} className={`${primary} w-full`}>Record, and compare with the plan</button>
      {(s.actual?.lines ?? []).map((l: Rec) => (
        <p key={l.key} className={l.over ? "text-[#ffb4b4]" : "text-[#7ee2c0]"}><Icon name={l.over ? "alert" : "check"} className="mr-1 inline h-3 w-3" />{l.name}: {num(l.used)} {l.unit} used, waste {num(l.waste)} ({l.waste_pct}%){l.over ? ", over plan" : ""}</p>
      ))}
    </div>
  );
}

export function nodeFocus(n: Rec, kids: Rec[] = []): NonNullable<ReturnType<typeof useFocus>["focus"]> {
  const activities = n.type === "activity" ? [n.ref] : n.activity ? [n.activity] : kids.filter((k) => k.type === "activity").map((k) => k.ref);
  return { code: n.code, name: n.name, type: n.type, package: n.package, activities };
}

export function NodePanel({ code, onClose }: { code: string; onClose: () => void }) {
  const { data, err, act } = useData(`/api/project/wbs/node?code=${encodeURIComponent(code)}`);
  const { setFocus } = useFocus();
  const go = useGo();
  const [fail, setFail] = useState("");
  useEffect(() => setFail(""), [code]);
  if (!data) return <Side title={code} onClose={onClose}><p className="text-[#abb3bf]">{err || "Loading…"}</p></Side>;
  const n = data.node as Rec, s = data.step as Rec | undefined, cards = data.cards as Rec[], kids = data.children as Rec[];
  const card = n.type === "task" ? cards.find((c) => c.step === n.ref || c.id === n.ref) : null;
  const doit = async (fn: () => Promise<unknown>) => { setFail(""); if (!(await act(fn))) setFail("Refused."); };
  const r = n.roll as Rec | undefined;
  return (
    <Side eyebrow={`${n.code} · ${LEVEL[n.type] ?? n.type}${n.ref && n.type !== "section" ? ` · ${n.type === "package" ? String(n.ref).replace("WP-", "CA-") : n.ref}` : ""}`} title={n.name} onClose={onClose}>
      <div className="flex flex-wrap gap-1">
        {n.critical && <Pill tone="warn">critical</Pill>}
        {n.hold_point && <Pill tone="bad">hold point {n.itp}</Pill>}
        {n.status && <Pill tone={CARD[n.status]?.[1] ?? "none"}>{CARD[n.status]?.[0] ?? n.status}</Pill>}
        {n.by_name && <Pill>{n.by_name}</Pill>}
        {n.ready && <Pill tone={n.ready.ready ? "ok" : "warn"}>{n.ready.ready ? "information ready" : "information not ready"}</Pill>}
        {typeof n.float_days === "number" && !n.critical && <Pill tone="info">float {n.float_days} days</Pill>}
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => { setFocus(nodeFocus(n, kids)); }} className={`${quiet} flex-1`}>Show only this in every tab</button>
        {card && <button onClick={() => go(`kanban/board:${card.id}`)} className={quiet}>Open its card</button>}
      </div>
      {(err || fail) && <p className="text-[#ffb4b4]">{err}</p>}
      {(n.start || n.finish) && <p className="text-[#d3d8de]">{dates(n.start, n.finish)}{typeof n.progress === "number" ? `, ${n.progress}% done` : ""}{n.progress_from === "tasks" ? ", from its tasks on the board" : ""}</p>}
      {n.ready && !n.ready.ready && <div className="rounded bg-[#fab219]/10 p-2 text-[#fbd38d]">{(n.ready.reasons as Rec[]).map((x) => <p key={x.ref + x.text}><button onClick={() => go(x.go)} className="text-left hover:underline">{x.text}</button></p>)}</div>}
      {(n.milestones ?? []).map((m: Rec) => <p key={m.id} className={m.days_late ? "text-[#ffb4b4]" : "text-[#d3d8de]"}>◆ {m.id} {m.name}: due {short(m.contract_date)}, forecast {short(m.forecast)}{m.days_late ? `, ${m.days_late} days late` : ""}</p>)}
      {n.cost && <div className="grid grid-cols-3 gap-2 rounded border border-white/10 p-2 text-[#d3d8de]"><div><Label>Budget</Label><p>{money(n.cost.budget)}</p></div><div><Label>Forecast</Label><p>{money(n.cost.eac)}</p></div><div><Label>CPI · SPI</Label><p>{n.cost.cpi} · {n.cost.spi}</p></div></div>}
      {r && r.tasks > 0 && <div className="grid grid-cols-3 gap-2 rounded border border-white/10 p-2 text-[#d3d8de]"><div><Label>Tasks done</Label><p>{r.done} of {r.tasks}</p></div><div><Label>Man-hours</Label><p>{num(r.man_hours, 0)}</p></div><div><Label>Planned cost</Label><p>{money(r.planned_cost)}</p></div></div>}
      {s && (
        <>
          <div><Label>Procedure</Label><p className="mt-0.5 whitespace-pre-line leading-snug text-[#e5e8eb]">{s.procedure}</p>{s.criteria && <p className="mt-1 leading-snug text-[#d3d8de]"><b className="font-medium text-white">Passes if:</b> {s.criteria}</p>}</div>
          <div>
            <Label>Workforce</Label>
            <p className="mt-0.5 text-[#e5e8eb]">{(s.crew as Rec[]).map((c) => `${c.count} ${c.role}`).join(", ") || "None"}</p>
            <p className="text-[11px] text-[#abb3bf]">{num(s.hours)} hours · {num(s.man_hours)} man-hours · {money(s.labour_cost)}{s.wait_days ? ` · then wait ${s.wait_days} days` : ""} · {s.basis}</p>
          </div>
          {(s.materials as Rec[]).length > 0 && (
            <div>
              <Label>Material and waste</Label>
              <table className="mt-1 w-full text-[11px] text-[#d3d8de]"><thead className="text-[10px] text-[#8f99a8]"><tr><th className="text-left font-normal">Material</th><th className="text-right font-normal">Net</th><th className="text-right font-normal">Waste</th><th className="text-right font-normal">To order</th></tr></thead><tbody>
                {(s.materials as Rec[]).map((m) => <tr key={m.key} className="border-t border-white/5" title={`${m.waste_pct}%: ${m.basis}`}><td className="py-0.5">{m.name}</td><td className="text-right tabular-nums">{num(m.net)}</td><td className={`text-right tabular-nums ${m.waste ? "text-[#fbd38d]" : "text-[#8f99a8]"}`}>{m.waste ? num(m.waste) : "–"}</td><td className="text-right tabular-nums">{num(m.gross)} {m.unit}</td></tr>)}
              </tbody></table>
            </div>
          )}
          {(data.flags as Rec[]).map((f, i) => <p key={i} className="rounded bg-[#fab219]/10 p-2 leading-snug text-[#fbd38d]"><b className="font-semibold">Waste to take out ({f.kind}).</b> {f.note}{f.saving_rp ? ` About ${money(f.saving_rp)}, the agent's estimate.` : ""}</p>)}
          <div><Label>Source documents</Label><div className="mt-1 flex flex-wrap gap-1">{(s.evidence as string[]).map((e) => <Ref key={e} to={e.startsWith("RFI") ? `documents/rfis:${e}` : `documents/register:${e}`}>{e}</Ref>)}</div></div>
          {data.plan?.status === "approved" && s.kind !== "inspection" && <Actuals key={s.id} plan={data.plan.id} s={s} onDone={doit} />}
        </>
      )}
      {kids.length > 0 && (
        <Block title={`Broken down into ${kids.length}`}>
          {kids.map((k) => <button key={k.code} onClick={() => go(`wbs/tree:${k.code}`)} className="block w-full truncate rounded px-1 text-left text-[#d3d8de] hover:bg-white/5"><span className="mr-1.5 text-[10.5px] tabular-nums text-[#8f99a8]">{k.code}</span>{k.name}</button>)}
        </Block>
      )}
      {!s && (data.activities as Rec[]).length > 0 && n.type !== "project" && (
        <Block title="Schedule" go={`schedule/gantt:${(data.activities as Rec[])[0].id}`}>
          {(data.activities as Rec[]).slice(0, 6).map((a) => <p key={a.id} className="text-[#d3d8de]"><span className="text-[#8f99a8]">{a.id}</span> {short(a.start)} to {short(a.finish)}, {a.progress}%{a.critical ? <span className="ml-1 text-[10.5px] text-[#fbd38d]">critical</span> : ` · float ${a.float_days}`}</p>)}
        </Block>
      )}
      {cards.length > 0 && n.type !== "task" && (
        <Block title={`On the board (${cards.length})`} go="kanban/board">
          {cards.slice(0, 8).map((c) => <button key={c.id} onClick={() => go(`kanban/board:${c.id}`)} className="flex w-full items-center gap-1.5 rounded px-1 text-left text-[#d3d8de] hover:bg-white/5"><span className="min-w-0 flex-1 truncate">{c.title}</span>{c.stopped && <Pill tone="bad">stopped</Pill>}<Pill tone={CARD[c.status]?.[1]}>{CARD[c.status]?.[0]}</Pill></button>)}
          {cards.length > 8 && <p className="text-[10.5px] text-[#8f99a8]">and {cards.length - 8} more</p>}
        </Block>
      )}
      {(data.rfis as Rec[]).length > 0 && <Block title="RFIs" go="documents/rfis">{(data.rfis as Rec[]).slice(0, 6).map((x) => <button key={x.id} onClick={() => go(`documents/rfis:${x.id}`)} className="flex w-full items-center gap-1.5 rounded px-1 text-left text-[#d3d8de] hover:bg-white/5"><span className="min-w-0 flex-1 truncate">{x.id} {x.subject}</span><Pill tone={x.status === "open" ? "warn" : x.status === "draft" ? "violet" : "ok"}>{x.status}</Pill></button>)}</Block>}
      {((data.inspections as Rec[]).length > 0 || (data.ncrs as Rec[]).length > 0) && (
        <Block title="Quality" go="quality/inspections">
          {(data.inspections as Rec[]).slice(0, 6).map((x) => <button key={x.id} onClick={() => go(`quality/inspections:${x.id}`)} className="flex w-full items-center gap-1.5 rounded px-1 text-left text-[#d3d8de] hover:bg-white/5"><span className="min-w-0 flex-1 truncate">{x.id} {x.title}</span><Pill tone={INSPECTION[x.status]}>{x.status}</Pill></button>)}
          {(data.ncrs as Rec[]).map((x) => <button key={x.id} onClick={() => go(`quality/ncrs:${x.id}`)} className="flex w-full items-center gap-1.5 rounded px-1 text-left text-[#d3d8de] hover:bg-white/5"><span className="min-w-0 flex-1 truncate">{x.id} {x.title}</span><Pill tone={x.status === "open" ? "bad" : "ok"}>{x.status}</Pill></button>)}
        </Block>
      )}
      {(data.orders as Rec[]).length > 0 && <Block title="Orders" go="procurement/orders">{(data.orders as Rec[]).slice(0, 6).map((x) => <button key={x.id} onClick={() => go(`procurement/orders:${x.id}`)} className="flex w-full items-center gap-1.5 rounded px-1 text-left text-[#d3d8de] hover:bg-white/5"><span className="min-w-0 flex-1 truncate">{x.id} {x.item}</span><Pill tone={x.status === "received" ? "ok" : x.promised > x.needed ? "bad" : "info"}>{x.status}</Pill></button>)}{(data.orders as Rec[]).length > 6 && <p className="text-[10.5px] text-[#8f99a8]">and {(data.orders as Rec[]).length - 6} more</p>}</Block>}
      {!s && (data.documents as Rec[]).length > 0 && n.type !== "project" && <Block title={`Documents (${(data.documents as Rec[]).length})`} go="documents/register">{(data.documents as Rec[]).slice(0, 5).map((d) => <button key={d.id} onClick={() => go(`documents/register:${d.id}`)} className="block w-full truncate rounded px-1 text-left text-[#d3d8de] hover:bg-white/5">{d.title}{d.status === "superseded" ? <span className="ml-1 text-[10.5px] text-[#ffb4b4]">replaced</span> : null}</button>)}</Block>}
      {(data.reports as Rec[]).length > 0 && n.type !== "project" && <Block title="Daily log" go="kanban/daily">{(data.reports as Rec[]).slice(0, 3).map((x) => <p key={x.id} className="truncate text-[#d3d8de]" title={x.text}><span className="mr-1.5 text-[10.5px] text-[#8f99a8]">{short(x.date)}</span>{x.text}</p>)}</Block>}
    </Side>
  );
}
