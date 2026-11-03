"use client";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { api, Bar, Card, Empty, Loading, notifyChanged, Pill, primary, Problem, quiet, useData, useGo, type Rec, type Tone } from "./kit";
import { MemoryPanel } from "./MemoryPanel";
import { UploadForm } from "./UploadForm";

/* The start of the flow: the planning consultant's documents come in, code sorts them and says what is missing, and one button sets the agents to work. */

const KINDS: Record<string, string> = { scope: "Work brief", drawing: "Drawing", spec: "Specification", itp: "Inspection plan", boq: "BoQ", estimate: "Owner's estimate", programme: "Master schedule", clarification: "Clarification", contract: "Contract", method: "Site logistics", rates: "Rates", tender: "Tender instructions", award: "Bid or award record", note: "Empty note", other: "Other" };
const STATUS: Record<string, Tone> = { current: "info", received: "warn", approved: "ok", rejected: "bad", superseded: "bad" };
const MUSE = "Muse reads the documents and writes the plan. This uses API credit.";

export function PlanningModule() {
  const docs = useData("/api/project/documents");
  const pack = useData("/api/project/plan-package");
  const plans = useData("/api/project/plans");
  const sorted = useData("/api/project/package");
  const run = useData("/api/aip/analysis");
  const go = useGo();
  const [upload, setUpload] = useState(false);
  const [uploaded, setUploaded] = useState<Rec[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const err = docs.err || pack.err || plans.err || sorted.err || problem;
  if (!docs.data || !pack.data || !plans.data || !sorted.data) return <div className="flex-1 overflow-auto"><Problem err={err} />{!err && <Loading />}</div>;
  const scenario = pack.data.scenario !== false;
  const review = sorted.data as Rec;
  const rows = (scenario ? docs.data.documents : review.documents) as Rec[];
  const planRows = (plans.data.plans ?? []) as Rec[];
  const plan = planRows.find((p) => p.status !== "superseded") ?? planRows[0] ?? null;
  const running = run.data?.run?.status === "running";
  const startPlan = async () => {
    setBusy(true); setProblem("");
    try {
      await api("/api/aip/konsultan", scenario ? { nama: `${pack.data?.scope.title ?? "Work"}: work plan`, versi: "muse", jenis: "plan" } : { nama: "Analysis of the documents", versi: "muse", jenis: "package" });
      go("analysis");
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  const planIt = (label: string) => <button disabled={busy} title={MUSE} onClick={startPlan} className={`${primary} w-full`}>{busy ? "Starting…" : label}</button>;
  const toggle = (d: Rec) => void sorted.act(() => api(`/api/project/documents/${d.id}/use`, { use: !d.use }));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Documents" note="the planning consultant's documents, from which everything else follows">
        <button onClick={() => setUpload(true)} className={primary}><Icon name="upload" className="mr-1 inline h-3 w-3" />Upload documents</button>
      </Bar>
      <Problem err={err} />
      {uploaded.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#29a383]/30 bg-[#29a383]/[.07] px-4 py-1.5 text-[#7ee2c0]">
          <span><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />{uploaded.length} document{uploaded.length === 1 ? "" : "s"} uploaded and sorted.</span>
          <button onClick={() => setUploaded([])} className={`${quiet} ml-auto`}>Dismiss</button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] items-start gap-3 overflow-y-auto bg-[#161a1f] p-3 max-xl:grid-cols-1">
        <Card title={scenario ? `Documents (${rows.length})` : `Documents (${rows.length}): the agents read ${review.used}`}>
          {rows.map((d) => (
            <div key={d.id} className={`flex items-center gap-2 border-t border-white/5 px-3 py-1.5 first:border-t-0 ${!scenario && !d.use ? "opacity-60" : ""}`}>
              <button onClick={() => go(`documents/register:${d.id}`)} className="min-w-0 flex-1 text-left hover:underline">
                <span className="text-white">{d.title}</span>
                <span className="ml-1.5 text-[10.5px] text-[#8f99a8]">{KINDS[d.kind] ?? d.kind}{d.pages ? `, ${d.pages} page${d.pages === 1 ? "" : "s"}` : ""}</span>
                {!scenario && <span className="block text-[10.5px] leading-snug text-[#8f99a8]">{d.why}</span>}
              </button>
              {scenario ? <Pill tone={STATUS[d.status] ?? "none"}>{d.status === "superseded" ? "replaced" : d.status}</Pill> : <button onClick={() => toggle(d)} title={d.use ? "Leave it out: it will not go to the agents" : "Send it to the agents"} className={quiet}>{d.use ? "Leave out" : "Use it"}</button>}
            </div>
          ))}
          {!rows.length && <Empty>No documents yet. Upload the whole package: code sorts it, and sets aside what is not for the site.</Empty>}
        </Card>
        <div className="space-y-3">
          <Card title="Next step">
            <div className="space-y-2 p-3">
              {running ? (
                <>
                  <p className="leading-snug text-[#d3d8de]">The agents are reading the documents.</p>
                  <button onClick={() => go("analysis")} className={`${primary} w-full`}>Watch them work</button>
                </>
              ) : plan?.status === "pending" ? (
                <>
                  <p className="leading-snug text-[#d3d8de]">Work plan <b className="font-medium text-white">{plan.id}</b> is waiting for you.</p>
                  <button onClick={() => go("analysis")} className={`${primary} w-full`}>Decide on the plan</button>
                </>
              ) : plan?.status === "approved" && !scenario ? (
                <>
                  <p className="leading-snug text-[#d3d8de]">The plan is approved.</p>
                  <button onClick={() => go("procedures")} className={`${primary} w-full`}>Read the procedures</button>
                </>
              ) : scenario ? (
                <>
                  <p className="leading-snug text-[#d3d8de]">{plan ? `Latest plan: ${plan.id}, ${plan.status}.` : "No work plan yet."}</p>
                  {planIt(plan ? "Plan again with Muse" : "Plan it with Muse")}
                </>
              ) : review.used ? (
                <>
                  <p className="leading-snug text-[#d3d8de]">{plan ? "The last plan was rejected. The agents remember why." : `${review.used} documents are ready for the agents.`}</p>
                  {planIt("Plan it with Muse")}
                </>
              ) : <p className="leading-snug text-[#d3d8de]">Upload the consultant&apos;s documents to start.</p>}
            </div>
          </Card>
          {!scenario && rows.length > 0 && (review.missing as string[]).length > 0 && (
            <Card title="What the package does not have">
              <div className="space-y-1.5 p-3">{(review.missing as string[]).map((m, i) => <p key={i} className="flex items-start gap-1.5 leading-snug text-[#fbd38d]"><Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0" />{m}</p>)}</div>
            </Card>
          )}
          <Card title="What the agents should know"><div className="p-3"><MemoryPanel /></div></Card>
        </div>
      </div>
      {upload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-label="Upload planning documents" onClick={() => setUpload(false)}>
          <div className="max-h-[92vh] w-full max-w-[520px] space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-[#1c2127] p-4 text-[12px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2"><p className="text-[14px] font-semibold text-white">Upload planning documents</p><button onClick={() => setUpload(false)} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button></div>
            <UploadForm activities={(docs.data.activities ?? []) as Rec[]} onDone={(saved) => { setUpload(false); setUploaded(saved); void docs.reload(); void sorted.reload(); notifyChanged(); }} />
          </div>
        </div>
      )}
    </div>
  );
}
