"use client";
import { Fragment, useState } from "react";
import { Icon } from "@/components/Icon";
import { dates, inDays, Label, Loading, money, num, Pill, Problem, useData, useGo, type Rec, NotYet } from "./kit";
import { boardStatus, STATUS } from "./CpmNetwork";
import { Diverge, Group, hue, ShareStrip, SizeBar, Span } from "./Visual";
import { openSource } from "./SourceDrawer";

/* The WBS as a contractor reads it: the work packages, the control accounts above them, and the dictionary saying what each one is. Code lays these out from what the agents wrote and the records hold. */

const ORDER = ["proposed", "open", "doing", "review", "done"];

/** Month marks across the job, about four, with the year where one starts: the timeline can be narrow beside an open panel. */
function months(from: string, to: string, total: number) {
  const out: { at: number; label: string }[] = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const step = Math.max(1, Math.ceil(inDays(from, to) / 30.4 / 4));
  let year = 0;
  while (d.toISOString().slice(0, 10) <= to) {
    const name = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    out.push({ at: inDays(from, d.toISOString().slice(0, 10)) / total, label: d.getUTCFullYear() === year ? name : `${name} ’${String(d.getUTCFullYear()).slice(2)}` });
    year = d.getUTCFullYear();
    d.setUTCMonth(d.getUTCMonth() + step);
  }
  return out;
}

/** Where a share of the job's span falls inside a timeline cell, between its paddings. */
const at = (share: number) => `calc(0.75rem + (100% - 1.5rem) * ${Math.min(1, Math.max(0, share))})`;
const across = (share: number) => `max(3px, calc((100% - 1.5rem) * ${Math.min(1, Math.max(0, share))}))`;

/** How many work packages stand in each column of the board, as one bar in the board's colours. */
function Mix({ counts, total }: { counts: Record<string, number>; total: number }) {
  return (
    <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/10" title={ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${STATUS[s].label.toLowerCase()}`).join(", ")}>
      {ORDER.map((s) => (counts[s] ? <span key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: STATUS[s].color }} /> : null))}
    </span>
  );
}

function Chip({ status, on }: { status: string; on?: Rec }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color: s.color, background: `${s.color}1f`, boxShadow: `inset 0 0 0 1px ${s.color}40` }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
      {on?.stopped ? <span title="Stopped on the board: a hold point or an NCR" className="text-[#f87171]"><Icon name="alert" className="h-3 w-3" /></span> : on?.overdue ? <span title="Past its finish date" className="text-[#fbd38d]"><Icon name="clock" className="h-3 w-3" /></span> : null}
    </span>
  );
}

/** The work packages under their control accounts: where each stands on the Kanban board, when it runs against today, and what it is worth. A row opens the work package beside the list. */
export function WorkPackages({ sel, onSel }: { sel: string | null; onSel: (code: string) => void }) {
  const { data, err } = useData("/api/project/work-packages");
  const board = useData("/api/project/board");
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.packages as Rec[];
  if (!rows.length) return <div className="flex-1 bg-[#111820]"><Problem err={err} /><NotYet>No work packages yet.</NotYet></div>;
  const where = board.data ? boardStatus(board.data.cards as Rec[]) : {};
  const status = (w: Rec) => (where[w.id]?.status as string | undefined) ?? "";
  const from = rows.reduce((m, w) => (w.start < m ? w.start : m), rows[0].start as string);
  const to = rows.reduce((m, w) => (w.finish > m ? w.finish : m), rows[0].finish as string);
  const total = inDays(from, to) + 1;
  const today = data.today as string;
  const now = today >= from && today <= to ? inDays(from, today) / total : null;
  const line = now == null ? null : <span className="pointer-events-none absolute inset-y-0 w-px bg-[#f5b82e]/70" style={{ left: at(now) }} />;
  const groups: { account: string; name: string; code: string; rows: Rec[] }[] = [];
  for (const w of rows) {
    const g = groups.find((x) => x.account === w.account);
    if (g) g.rows.push(w);
    else groups.push({ account: w.account, name: w.account_name, code: String(w.code).split(".").slice(0, -1).join("."), rows: [w] });
  }
  const count = (list: Rec[]) => { const c: Record<string, number> = {}; for (const w of list) { const s = status(w); if (s) c[s] = (c[s] ?? 0) + 1; } return c; };
  const sum = (list: Rec[], k: string) => list.reduce((n, w) => n + (Number(w[k]) || 0), 0);
  const all = count(rows), tight = rows.filter((w) => w.critical).length, waiting = rows.filter((w) => !w.ready.ready).length;
  const cell = "px-3 py-1.5 align-middle";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Problem err={err || board.err} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-black/40 bg-[#151e28] px-4 py-2 text-[11px] text-[#abb3bf]">
        <span className="w-[160px]"><Mix counts={all} total={rows.length} /></span>
        {ORDER.filter((s) => all[s]).map((s) => <span key={s} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: STATUS[s].color }} />{STATUS[s].label}<b className="font-semibold tabular-nums text-white">{all[s]}</b></span>)}
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm shadow-[inset_0_0_0_1.5px_#f87171]" />no float<b className={`font-semibold tabular-nums ${tight ? "text-[#ffb4b4]" : "text-white"}`}>{tight}</b></span>
          {now != null && <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-[#f5b82e]" />today</span>}
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#fbd38d]" />info not ready<b className={`font-semibold tabular-nums ${waiting ? "text-[#fbd38d]" : "text-white"}`}>{waiting}</b></span>
          <span>worth <b className="font-semibold text-white">{money(sum(rows, "value"))}</b></span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
        <table className="w-full min-w-[1080px] text-left text-[12px]">
          <thead className="sticky top-0 z-[2] whitespace-nowrap bg-[#151e28] text-[10.5px] uppercase tracking-wide text-[#7d8b9b]">
            <tr>
              <th className="w-[124px] px-3 py-2 font-medium">Status</th>
              <th className="min-w-[250px] px-3 py-2 font-medium">Work package</th>
              <th className="w-[160px] px-3 py-2 font-medium">Responsible</th>
              <th className="relative w-[27%] px-3 py-2 font-medium normal-case tracking-normal">
                {line}
                <span className="relative block h-3.5">{months(from, to, total).map((m) => <span key={m.label} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${m.at * 100}%` }}>{m.label}</span>)}</span>
              </th>
              <th className="w-[56px] px-3 py-2 text-right font-medium">Days</th>
              <th className="w-[66px] px-3 py-2 font-medium">Float</th>
              <th className="w-[100px] px-3 py-2 text-right font-medium">Worth</th>
              <th className="w-[66px] px-3 py-2 text-right font-medium">Tasks</th>
              <th className="w-[88px] px-3 py-2 text-right font-medium">Man-hours</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const start = g.rows.reduce((m, w) => (w.start < m ? w.start : m), g.rows[0].start as string);
              const finish = g.rows.reduce((m, w) => (w.finish > m ? w.finish : m), g.rows[0].finish as string);
              return (
                <Fragment key={g.account}>
                  <tr onClick={() => onSel(g.code)} className={`cursor-pointer border-t border-white/10 ${sel === g.code ? "bg-white/[.1]" : "bg-[#1c2733]/70 hover:bg-[#1c2733]"}`}>
                    <td className={cell}><Mix counts={count(g.rows)} total={g.rows.length} /></td>
                    <td className={cell} colSpan={2}><span className="mr-2 font-mono text-[10.5px] text-[#8f99a8]">{g.code}</span><span className="font-semibold text-white">{g.name}</span><span className="ml-2 whitespace-nowrap text-[10.5px] text-[#8f99a8]">{g.account} · {g.rows.length} work package{g.rows.length === 1 ? "" : "s"}</span></td>
                    <td className={`relative ${cell}`} title={dates(start, finish)}>{line}<span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/40" style={{ left: at(inDays(from, start) / total), width: across((inDays(start, finish) + 1) / total) }} /></td>
                    <td className={`${cell} text-right tabular-nums text-[#abb3bf]`}>{inDays(start, finish) + 1}</td>
                    <td className={cell} />
                    <td className={`${cell} whitespace-nowrap text-right font-semibold text-white`}>{sum(g.rows, "value") ? money(sum(g.rows, "value")) : "–"}</td>
                    <td className={`${cell} text-right tabular-nums text-[#abb3bf]`}>{sum(g.rows, "tasks") || "–"}</td>
                    <td className={`${cell} text-right tabular-nums text-[#abb3bf]`}>{sum(g.rows, "man_hours") ? num(sum(g.rows, "man_hours"), 0) : "–"}</td>
                  </tr>
                  {g.rows.map((w) => {
                    const st = status(w), on = where[w.id] as Rec | undefined, color = st ? STATUS[st].color : "#8f99a8";
                    const why = (w.ready.reasons ?? []) as Rec[];
                    return (
                      <tr key={w.id} onClick={() => onSel(w.code)} className={`cursor-pointer border-t border-white/5 ${sel === w.code ? "bg-white/[.08]" : "hover:bg-white/[.04]"}`}>
                        <td className={cell}>{st && <Chip status={st} on={on} />}</td>
                        <td className={cell}>
                          <span className="flex items-baseline gap-2">
                            <span className="w-10 shrink-0 font-mono text-[10.5px] text-[#8f99a8]">{w.code}</span>
                            <span className="min-w-0 text-white">{w.name}{!w.ready.ready && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#fbd38d] align-middle" title={`Information not ready:\n${why.map((x) => x.text).join("\n")}`} />}</span>
                          </span>
                        </td>
                        <td className={`${cell} text-[11px] text-[#d3d8de]`}><span className="block w-[136px] truncate" title={w.responsible}>{w.responsible}</span></td>
                        <td className={`relative ${cell}`} title={`${dates(w.start, w.finish)} · ${w.progress}% done`}>
                          {line}
                          <span className="absolute top-1/2 flex h-2.5 -translate-y-1/2 overflow-hidden rounded-sm" style={{ left: at(inDays(from, w.start) / total), width: across((inDays(w.start, w.finish) + 1) / total), background: `${color}40`, boxShadow: w.critical ? "inset 0 0 0 1.5px #f87171" : undefined }}>
                            <span style={{ width: `${w.progress}%`, background: color }} />
                          </span>
                        </td>
                        <td className={`${cell} text-right tabular-nums`}>{w.duration}</td>
                        <td className={cell}>{w.critical ? <Pill tone="bad">none</Pill> : w.float_days ? <span className="tabular-nums text-[#abb3bf]">{w.float_days} d</span> : <span className="text-[#5c6b7a]">–</span>}</td>
                        <td className={`${cell} whitespace-nowrap text-right`}>{w.value ? money(w.value) : "–"}</td>
                        <td className={`${cell} text-right tabular-nums`}>{on?.tasks ? <>{on.done}<span className="text-[#8f99a8]">/{on.tasks}</span></> : w.tasks || "–"}</td>
                        <td className={`${cell} text-right tabular-nums`}>{w.man_hours ? num(w.man_hours, 0) : "–"}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ControlAccounts({ sel, onSel }: { sel: string | null; onSel: (code: string) => void }) {
  const { data, err } = useData("/api/project/control-accounts");
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.accounts as Rec[], t = data.total as Rec;
  const going = t.pv > 0 || t.ev > 0 || t.ac > 0;  // before work starts all of these are zero, and a green 1.00 would say all is well when nothing has been measured
  const owner = rows.some((a) => a.against_owner_pct != null);
  const span = rows.length ? { from: rows.reduce((m, a) => (a.start < m ? a.start : m), rows[0].start as string), to: rows.reduce((m, a) => (a.finish > m ? a.finish : m), rows[0].finish as string) } : { from: "", to: "" };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Problem err={err} />
      <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
        <div className="space-y-3 p-3">
          {rows.length > 0 && (
            <Group title="The budget, by control account" right={<span className="text-right"><span className="block text-[15px] font-bold tabular-nums text-white">{money(t.budget)}</span><span className="block text-[10.5px] text-[#8f99a8]">{rows.reduce((n, a) => n + a.packages, 0)} work packages</span></span>}>
              <div className="p-3"><ShareStrip parts={rows.map((a, i) => ({ key: a.code, label: a.name, value: a.budget, color: hue(i) }))} onPick={(code) => onSel(code)} /></div>
            </Group>
          )}
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {rows.map((a, i) => {
              const max = Math.max(...rows.map((x) => x.budget), 1);
              return (
                <button key={a.id} onClick={() => onSel(a.code)} className={`rise overflow-hidden rounded-lg border bg-[#1c2733] p-3 text-left shadow-[0_4px_16px_rgb(0_0_0/.25)] transition hover:border-white/25 ${sel === a.code ? "border-[#f5b82e]/60" : "border-white/10"}`} style={{ boxShadow: `inset 3px 0 0 ${hue(i)}` }}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-white"><span className="mr-2 font-mono text-[10.5px] font-normal text-[#8f99a8]">{a.code}</span>{a.name}</p><p className="mt-0.5 truncate text-[10.5px] text-[#8f99a8]">{a.id} · {a.responsible || "no one named"}</p></div>
                    <div className="text-right"><p className="text-[15px] font-bold tabular-nums text-white">{money(a.budget)}</p><p className="text-[10.5px] text-[#8f99a8]">{a.packages} work package{a.packages === 1 ? "" : "s"}</p></div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 text-[10.5px]"><span className="text-[#8f99a8]">budget</span><SizeBar value={a.budget} max={max} color={hue(i)} /></div>
                    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 text-[10.5px]"><span className="text-[#8f99a8]">runs</span><Span start={a.start} finish={a.finish} from={span.from} to={span.to} today={data.today} color={hue(i)} progress={a.progress} /></div>
                    <p className="text-[10.5px] text-[#8f99a8]">{dates(a.start, a.finish)} · {a.progress ?? 0}% done</p>
                  </div>
                  {(owner || going) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[.06] pt-2 text-[10.5px] text-[#8f99a8]">
                      {owner && <span className="flex items-center gap-1.5">against the owner&apos;s estimate <Diverge value={a.against_owner_pct} /></span>}
                      {going && <><span>earned <b className="text-white">{money(a.ev)}</b></span><span>spent <b className="text-white">{money(a.ac)}</b></span><Pill tone={a.cpi < 1 ? "warn" : "ok"}>CPI {Number(a.cpi).toFixed(2)}</Pill>{a.pv >= 0.01 * a.budget && <Pill tone={a.spi < 1 ? "warn" : "ok"}>SPI {Number(a.spi).toFixed(2)}</Pill>}</>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        {!rows.length && <NotYet>No control accounts yet.</NotYet>}
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
      <div className="w-[300px] shrink-0 overflow-y-auto border-r border-black/30 bg-[#1c2733] py-1">
        {rows.map((x) => (
          <button key={x.code} onClick={() => setSel(x.code)} aria-current={e?.code === x.code ? "true" : undefined} className={`block w-full px-3 py-1 text-left hover:bg-white/5 ${e?.code === x.code ? "bg-white/10" : ""} ${x.level === "Control account" ? "mt-1 font-semibold text-white" : "pl-5 text-[#d3d8de]"}`}>
            <span className="mr-1.5 font-mono text-[10.5px] font-normal text-[#8f99a8]">{x.code}</span>{x.name}
          </button>
        ))}
        {!rows.length && <NotYet>Nothing to describe yet.</NotYet>}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto bg-[#111820] p-4">
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 rounded border border-white/10 bg-[#1c2733] p-3">
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
