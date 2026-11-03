"use client";
import { Icon } from "@/components/Icon";
import { Bar, Empty, Kpi, Kpis, Loading, Pill, Problem, Table, td, tr, useData, useGo, type Rec } from "./kit";
import { NetworkSheet } from "./NetworkSheet";
import { CpmNetwork, linkReasons } from "./CpmNetwork";

/* The critical path, as a planner writes it: code works out the earliest and latest dates and the float from the links. What it means: work with no float holds the finish date. */

export function CriticalModule() {
  const { data, err } = useData("/api/project/critical-path");
  const plans = useData("/api/project/plans");
  const go = useGo();
  if (!data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  const rows = data.activities as Rec[], path = data.path as Rec[], m = (data.milestones as Rec[])[0];
  const live = ((plans.data?.plans ?? []) as Rec[]).find((p) => p.plan?.kind === "package" && (p.status === "pending" || p.status === "approved"));  // the plan these links came from, which says why each one is there
  const tied = (r: Rec) => (r.after as string[]).length > 0 || rows.some((y) => (y.after as string[]).includes(r.id));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Critical path" note={`worked out by code from ${data.links} links. Dates are calendar days`} />
      <Problem err={err} />
      <Kpis>
        <Kpi label="project duration" value={`${data.days} days`} />
        <Kpi label="start" value={data.start} />
        <Kpi label="finish" value={data.finish} />
        {m && <Kpi label={`${m.name}, due ${m.contract_date}`} value={m.days_late ? `${m.days_late} days late` : "on time"} tone={m.days_late ? "bad" : "ok"} />}
        <Kpi label="work packages with no float" value={`${rows.filter((r) => r.critical).length} of ${rows.length}`} tone={rows.some((r) => r.critical) ? "warn" : "ok"} />
      </Kpis>
      <div className="min-h-0 flex-1 overflow-auto bg-[#161a1f]">
        <div className="border-b border-white/5 px-3 py-2">
          {path.length ? (
            <>
              <p className="mb-1 text-[10.5px] uppercase tracking-wide text-[#8f99a8]">{path.every((p) => !p.float_days) ? "The critical path: any day lost here is a day lost at the end" : "The chain that holds the finish date: work in red has no float, and the rest can slip only by the days shown"}</p>
              <div className="flex flex-wrap items-center gap-1">
                {path.map((p, i) => (
                  <span key={p.id} className="flex items-center gap-1">
                    <button onClick={() => go(`wbs/tree:${p.code}`)} className={`rounded border px-2 py-0.5 text-left text-white ${p.float_days ? "border-white/20 bg-white/5 hover:bg-white/10" : "border-[#e5484d]/50 bg-[#e5484d]/10 hover:bg-[#e5484d]/20"}`}><span className="mr-1 font-mono text-[10px] text-[#d3d8de]">{p.code}</span>{p.name}<span className="ml-1 text-[10.5px] text-[#d3d8de]">{p.duration}d{p.float_days ? `, float ${p.float_days}` : ""}</span></button>
                    {i < path.length - 1 && <Icon name="right" className="h-3 w-3 text-[#8f99a8]" />}
                  </span>
                ))}
              </div>
            </>
          ) : <p className="text-[#abb3bf]">No work is linked yet, so there is no chain to show.</p>}
        </div>
        {rows.length > 0 && <div className="border-b border-white/5 px-3 py-1"><CpmNetwork rows={rows} path={path} reasons={linkReasons(live?.plan)} onOpen={(code) => go(`wbs/tree:${code}`)} /></div>}
        <Table heads={["WBS", "Work package", "Days", "Earliest start", "Earliest finish", "Latest start", "Latest finish", "Float", "Waits for"]}>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => go(`wbs/tree:${r.code}`)} className={`${tr} cursor-pointer`}>
              <td className={`${td} whitespace-nowrap font-mono text-[10.5px] text-[#8f99a8]`}>{r.code}</td>
              <td className={`${td} text-white`}>{r.name}</td>
              <td className={`${td} tabular-nums`}>{r.duration}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{r.es}</td><td className={`${td} whitespace-nowrap tabular-nums`}>{r.ef}</td><td className={`${td} whitespace-nowrap tabular-nums`}>{r.ls}</td><td className={`${td} whitespace-nowrap tabular-nums`}>{r.lf}</td>
              <td className={td}>{r.critical ? <Pill tone="bad">none</Pill> : tied(r) ? <span className="tabular-nums">{r.float_days}</span> : <span title="Nothing links to this work, so code cannot say how far it can slip" className="text-[#8f99a8]">not linked</span>}</td>
              <td className={`${td} text-[11px]`}>{(r.after as string[]).map((x) => rows.find((y) => y.id === x)?.code ?? x).join(", ") || "–"}</td>
            </tr>
          ))}
        </Table>
        {!rows.length && <Empty>No work packages yet. They come from the AI analysis of the documents.</Empty>}
        {data.network && <div className="border-t border-white/10 p-3"><p className="mb-2 text-[#abb3bf]">The links between the tasks of {data.network.title}.</p><NetworkSheet plan={data.network} /></div>}
      </div>
    </div>
  );
}
