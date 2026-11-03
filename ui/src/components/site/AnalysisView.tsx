"use client";
import { useEffect } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, Empty, Loading, notifyChanged, Problem, quiet, useData, useGo, type Rec } from "./kit";
import { WorkPlan } from "./WbsModule";

/* The AI analysis: the agents at work on the documents, and then what they found, for a person to approve or reject. */

export function Running({ data, onStop }: { data: Rec; onStop: () => void }) {
  const run = data.run as Rec, stages = data.stages as Rec[], done = data.packages as Rec[];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="The agents are reading the documents" note={`$${Number(run.spent_usd).toFixed(2)} so far, on the Meta API`}>
        <button onClick={onStop} className={quiet}>Stop</button>
      </Bar>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#111820] p-4">
        <div className="mx-auto max-w-[760px] space-y-1.5">
          {stages.map((s) => (
            <div key={s.key} className="flex items-start gap-2 rounded border border-white/10 bg-[#1c2733] px-3 py-2">
              <Icon name={s.status === "done" ? "check" : s.status === "failed" ? "alert" : "sparkle"} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${s.status === "done" ? "text-[#7ee2c0]" : s.status === "failed" ? "text-[#ffb4b4]" : "animate-pulse text-[#f5b82e]"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">{s.label}{s.of ? <span className="ml-2 font-normal tabular-nums text-[#abb3bf]">{s.done} of {s.of}</span> : null}{s.by && <span className={`ml-2 text-[10.5px] font-normal ${s.by === "Code" ? "text-[#8f99a8]" : "text-[#d9d3ff]"}`}>{s.by === "Code" ? "code" : s.by}</span>}</p>
                {s.note && <p className="text-[11.5px] text-[#abb3bf]">{s.note}</p>}
                {s.of > 0 && s.status !== "done" && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-[#8083e8] transition-all" style={{ width: `${(s.done / s.of) * 100}%` }} /></span>}
              </div>
            </div>
          ))}
          {!stages.length && <Loading />}
          {done.length > 0 && <p className="pt-1 text-[11px] leading-snug text-[#8f99a8]">Written so far: {done.slice(-6).map((w) => w.name).join(", ")}{done.length > 6 ? ", and more" : ""}.</p>}
          {(data.problems as string[]).map((p, i) => <p key={i} className="text-[11px] text-[#fbd38d]">{p}</p>)}
        </div>
      </div>
    </div>
  );
}

export function AnalysisView() {
  const { data, err, reload } = useData("/api/aip/analysis");
  const plans = useData("/api/project/plans");
  const go = useGo();
  const running = data?.run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void reload().then(() => {}), 1500);
    return () => { clearInterval(t); notifyChanged(); };
  }, [running, reload]);
  if (!data || !plans.data) return <div className="flex-1"><Problem err={err || plans.err} />{!err && !plans.err && <Loading />}</div>;
  if (running) return <Running data={data} onStop={() => void api(`/api/aip/runs/${data.run.id}/cancel`, {}).then(() => reload())} />;
  const list = plans.data.plans as Rec[];
  if (!list.length) return (
    <div className="flex-1 bg-[#111820] text-[12px]">
      <Problem err={err || plans.err} />
      {data.run?.status === "failed" || data.run?.status === "cancelled"
        ? <Empty>The last analysis did not finish{(data.problems as string[])[0] ? `: ${(data.problems as string[])[0]}` : ""}. <button onClick={() => go("home")} className="underline">Back to Home</button> to try again.</Empty>
        : <Empty>The agents have not read the documents yet. Start on <button onClick={() => go("home")} className="underline">Home</button>.</Empty>}
    </div>
  );
  return <WorkPlan />;
}
