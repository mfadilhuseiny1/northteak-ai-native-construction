"use client";
import { Icon } from "@/components/Icon";
import { api, Bar, Kpi, Kpis, Loading, notifyChanged, Problem, useData, useGo, type Rec, NotYet } from "./kit";
import { PLAN } from "./ReportCharts";
import { Group, Item, Legend, Span } from "./Visual";
import { NetworkSheet } from "./NetworkSheet";
import { CpmNetwork, linkReasons } from "./CpmNetwork";

/* The critical path, as a planner writes it: code works out the earliest and latest dates and the float from the links. What it means: work with no float holds the finish date. */

export function CriticalModule() {
  const { data, err } = useData("/api/project/critical-path");
  const plans = useData("/api/project/plans");
  const board = useData("/api/project/board");
  const go = useGo();
  const move = async (card: Rec, status: string) => {  // the board's own move, so its rules hold here too, and every tab hears of it
    try { await api(`/api/project/board/activity/${card.id}`, { status }); notifyChanged(); return null; } catch (e) { return (e as Error).message; }
  };
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
      <div className="min-h-0 flex-1 overflow-auto bg-[#111820]">
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
        {rows.length > 0 && <div data-tour="cpm" className="border-b border-white/5 px-3 py-1"><CpmNetwork rows={rows} path={path} reasons={linkReasons(live?.plan)} onOpen={(code) => go(`wbs/tree:${code}`)} board={board.data?.cards as Rec[] | undefined} onMove={move} onBoard={() => go("kanban")} /></div>}
        {rows.length > 0 && (
          <div className="p-3">
            <Group title="Every work package on one timeline" sub="the bar runs from the earliest start to the earliest finish; the hatched tail is how far it can slip before the finish date moves"
              right={<Legend items={[{ label: "no float", color: "#f87171", hatched: false }, { label: "float", color: "#8f99a8", hatched: true }]} />}>
              {rows.map((r) => (
                <Item key={r.id} wide code={r.code} onClick={() => go(`wbs/tree:${r.code}`)}
                  title={<span className="flex flex-wrap items-center gap-1.5"><span className={r.critical ? "font-medium text-white" : "text-[#e5e8eb]"}>{r.name}</span>{r.critical && <span className="text-[10px] font-semibold text-[#f87171]">critical</span>}</span>}
                  meta={`${r.es} to ${r.ef}${(r.after as string[]).length ? ` · waits for ${(r.after as string[]).map((x) => rows.find((y) => y.id === x)?.code ?? x).join(", ")}` : ""}`}
                  visual={<Span start={r.es} finish={r.ef} from={data.start} to={data.finish} today={data.today} color={r.critical ? "#f87171" : PLAN} progress={r.progress} critical={r.critical} slack={!r.critical && tied(r) ? r.lf : undefined} />}
                  value={<><span className="block font-semibold">{r.duration} d</span><span className="block text-[10.5px] font-normal">{r.critical ? <span className="text-[#f87171]">no float</span> : tied(r) ? <span className="text-[#8f99a8]">{r.float_days} d float</span> : <span className="text-[#8f99a8]" title="Nothing links to this work, so code cannot say how far it can slip">not linked</span>}</span></>} />
              ))}
            </Group>
          </div>
        )}
        {!rows.length && <NotYet>No work packages yet.</NotYet>}
        {data.network && <div className="border-t border-white/10 p-3"><p className="mb-2 text-[#abb3bf]">The links between the tasks of {data.network.title}.</p><NetworkSheet plan={data.network} /></div>}
      </div>
    </div>
  );
}
