"use client";
import { useEffect } from "react";
import { Empty, Loading, notifyChanged, Problem, useData, useGo, type Rec } from "./kit";
import { SwarmModule } from "./SwarmModule";
import { WorkPlan } from "./WbsModule";

/* The AI analysis: the agents at work on the documents, and then what they found, for a person to approve or reject. */

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
  if (running) return <SwarmModule />;
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
