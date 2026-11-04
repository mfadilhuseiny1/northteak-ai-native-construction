"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { BoqSection, ExecutiveSummary, Repository } from "./AnalysisWorkspace";
import { SwarmModule } from "./SwarmModule";
import { Constellation } from "./Constellation";
import { CategorySelect } from "./DocCategory";
import { api, field, Label, Loading, money, notifyChanged, primary, Problem, quiet, useData, useGo, type Rec } from "./kit";
import { forgetThread } from "./OperatorChat";
import { PlanningModule } from "./PlanningModule";
import { openSource } from "./SourceDrawer";
import { titleOf } from "./UploadForm";
import { Dictionary } from "./WbsViews";

/* Home: every project, and the way a new one starts. A new project is empty. A person tells the agents what is being planned, in words, documents or both, in one box, and the other tabs fill in from what the agents make of it. Under their reply are the proposal's executive summary, scope and BOQ, and beside the conversation the project's documents. What comes back is a proposal until a person approves it on the Review tab. */

const TYPES = ".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.dwg,.dxf,.xlsx,.docx,.zip";
const isZip = (f: File) => f.name.toLowerCase().endsWith(".zip");
/** What a zip gave: how many documents came out, and what was set aside. */
const unpacked = (out: Rec) => `${many((out.documents as Rec[]).length, "document")} from the zip${(out.skipped as Rec[]).length ? `, ${(out.skipped as Rec[]).length} set aside: ${(out.skipped as Rec[]).map((x) => `${x.name} (${x.why})`).join("; ")}` : ""}`;
const sizeOf = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const many = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const reopen = () => { forgetThread(); window.location.hash = "home"; window.location.reload(); };  // the copilot's last conversation was about the project left behind

type Row = { file: File; kind: string; state: "waiting" | "uploading" | "reading" | "done" | "failed"; pct: number; note: string };

/** One file up, with its progress. The server reads and sorts it before it answers, which on a long specification takes a while. */
function send(row: Row, onProgress: (pct: number) => void): Promise<Rec> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("file", row.file);
    body.append("title", titleOf(row.file.name));
    body.append("kind", row.kind || "auto");
    const x = new XMLHttpRequest();
    x.open("POST", `${API_URL}/api/project/documents`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      let out: Rec = {};
      try { out = JSON.parse(x.responseText); } catch { /* an error page */ }
      if (x.status >= 200 && x.status < 300) resolve(out);
      else reject(new Error(out.detail ?? `${x.status} ${x.statusText}`));
    };
    x.onerror = () => reject(new Error("the connection was lost"));
    x.send(body);
  });
}

/* ------------------------------------------------------------------------------------------------ telling the agents */

/** One box for words and files, and one button. The agents start as soon as it is sent. */
function Composer({ used, proposal, hero }: { used: number; proposal: Rec | null; hero: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const add = (list: FileList | File[] | null) => {
    const allowed = new Set(TYPES.split(","));
    const picked = [...(list ?? [])].filter((f) => allowed.has(`.${f.name.split(".").pop()?.toLowerCase()}`));
    setRows((old) => [...old, ...picked.filter((f) => !old.some((r) => r.file.name === f.name && r.file.size === f.size)).map((file): Row => ({ file, kind: "", state: "waiting", pct: 0, note: "" }))]);
  };
  const change = (i: number, patch: Partial<Row>) => setRows((old) => old.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const fresh = !!text.trim() || rows.some((r) => r.state !== "done");
  const start = async () => {
    if (proposal?.edits && !window.confirm(`The agents will plan again and replace this proposal, and the ${many(proposal.edits, "change")} you made to it. Send?`)) return;
    setBusy(true); setErr("");
    try {
      if (text.trim()) { await api("/api/project/brief", { text }); setText(""); notifyChanged(); }
      let failed = 0;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].state === "done") continue;
        change(i, { state: "uploading", pct: 0, note: "" });
        try {
          const out = await send(rows[i], (pct) => change(i, pct >= 100 ? { state: "reading", pct } : { pct }));
          change(i, { state: "done", note: out.documents ? unpacked(out) : "" });
        } catch (e) { failed++; change(i, { state: "failed", note: (e as Error).message }); }
      }
      notifyChanged();
      if (failed) { setErr(`${many(failed, "file")} did not upload, so the agents have not started. Send again to retry, or remove ${failed === 1 ? "it" : "them"}.`); return; }
      if (!(await api("/api/project/package")).used) { setErr("Nothing can go to the agents: each file was set aside as not for the site, or has no text to read. Add another file, or say what you are planning."); return; }
      await api("/api/aip/konsultan", { nama: "Analysis of the documents", versi: "muse", jenis: "package" });
      setRows([]);
      notifyChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div data-tour="drop" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) add(e.dataTransfer.files); }}
        className={`rounded-xl border bg-[#1c2733] shadow-[0_8px_24px_rgb(0_0_0/.25)] transition-colors ${over ? "border-[#f5b82e] bg-[#f5b82e]/10" : "border-white/15 focus-within:border-[#f5b82e]/60"}`}>
        <textarea aria-label="Tell the agents what you are planning" autoFocus={hero} disabled={busy} rows={hero ? 5 : 2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy && (fresh || (!proposal && used > 0))) void start(); }}
          placeholder={hero ? "What is being built, where, by when, and anything the agents should plan around. For example: a 5-storey campus building in Yogyakarta, about 12 months, piled foundations and a concrete frame, with the structure finished before the rainy season." : proposal ? "Tell the agents what to change, and they plan it again." : "Tell the agents more about the job."}
          className="block w-full resize-y rounded-t-xl bg-transparent px-4 py-3 text-[14px] leading-relaxed text-white placeholder:text-[#6b7480] focus:outline-none" />
        {rows.length > 0 && (
          <div className="border-t border-white/10">
            {rows.map((r, i) => (
              <div key={`${r.file.name}-${r.file.size}`} className="flex items-center gap-2 border-t border-white/5 px-4 py-1.5 first:border-t-0">
                <Icon name={r.state === "done" ? "check" : r.state === "failed" ? "alert" : "doc"} className={`h-3.5 w-3.5 shrink-0 ${r.state === "done" ? "text-[#7ee2c0]" : r.state === "failed" ? "text-[#ffb4b4]" : "text-[#8f99a8]"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-white" title={r.file.name}>{titleOf(r.file.name)}<span className="ml-1.5 text-[11.5px] text-[#8f99a8]">{sizeOf(r.file.size)}</span></p>
                  {r.state === "uploading" && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-[#8083e8] transition-all" style={{ width: `${r.pct}%` }} /></span>}
                  {r.state === "reading" && <p className="animate-pulse text-[11.5px] text-[#d9d3ff]">{isZip(r.file) ? "Unpacking it, then reading and sorting each document…" : "Reading and sorting it…"}</p>}
                  {r.state === "done" && r.note && <p className="truncate text-[11.5px] text-[#7ee2c0]" title={r.note}>{r.note}</p>}
                  {r.state === "failed" && <p className="truncate text-[11.5px] text-[#ffb4b4]" title={r.note}>Failed: {r.note}</p>}
                </div>
                {r.state !== "done" && (isZip(r.file) ? <span className="w-[210px] shrink-0 text-[11.5px] text-[#8f99a8] max-md:hidden">each file in it sorted on its own</span> : <span className="w-[210px] shrink-0 max-md:hidden"><CategorySelect auto kind={r.kind} onChange={(kind) => change(i, { kind })} /></span>)}
                {r.state !== "done" && <button disabled={busy} aria-label={`Remove ${r.file.name}`} onClick={() => setRows((old) => old.filter((_, n) => n !== i))} className="rounded p-0.5 text-[#8f99a8] hover:bg-white/10 hover:text-white disabled:opacity-30"><Icon name="x" className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} title="Schedule, WBS, BOQ, drawings, specifications, procedures. PDF, Word, Excel, CAD, images or text, up to 64 MB each, or the whole package in one ZIP." className={`${quiet} flex items-center gap-1.5 !px-2.5 !py-1.5 !text-[12.5px]`}><Icon name="upload" className="h-3.5 w-3.5" />Add documents</button>
          <span className="min-w-0 truncate text-[11.5px] text-[#8f99a8] max-md:hidden">or drop them here. You do not need every kind.</span>
          <button disabled={busy || !(fresh || (!proposal && used > 0))} onClick={() => void start()} className={`${primary} ml-auto flex shrink-0 items-center gap-1.5 !px-4 !py-2 !text-[13.5px]`}><Icon name="sparkle" className="h-3.5 w-3.5" />{busy ? "Sending…" : "Send to the agents"}</button>
        </div>
        <input ref={input} type="file" multiple accept={TYPES} aria-label="Documents" onChange={(e) => { add(e.target.files); e.target.value = ""; }} className="hidden" />
      </div>
      {err && <p role="alert" className="rounded border border-red-400/30 bg-red-500/10 px-3 py-2 leading-snug text-[#ffb4b4]">{err}</p>}
      <p className="text-[12px] leading-relaxed text-[#8f99a8]">Nothing leaves this machine until you send it. Then what you wrote and the pages the agents need go to the Meta Model API, which uses API credit. What comes back is a proposal, and nothing becomes the baseline until you approve it.</p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ the conversation */

function You({ children }: { children: ReactNode }) {
  return <div className="ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-[#f5b82e]/[.14] px-3.5 py-2.5 leading-relaxed text-[#fff3d6]">{children}</div>;
}

function Agents({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2dd4ee]/15"><Icon name="sparkle" className="h-3.5 w-3.5 text-[#2dd4ee]" /></span>
      <div className="min-w-0 flex-1 space-y-3 rounded-xl rounded-tl-sm border border-white/10 bg-[#1c2733] px-3.5 py-2.5 leading-relaxed text-[#e5e8eb]">{children}</div>
    </div>
  );
}

/** What was said and sent, in order. Files sent together read as one message. */
function Thread({ docs }: { docs: Rec[] }) {
  const groups: Rec[][] = [];
  for (const d of docs) {
    const last = groups[groups.length - 1];
    if (last && !d.typed && !last[0].typed) last.push(d); else groups.push([d]);
  }
  return (
    <>
      {groups.map((g) => g[0].typed
        ? <You key={g[0].id}><p className="whitespace-pre-wrap break-words">{g[0].text}</p>{!g[0].use && <p className="mt-1 text-[11.5px] text-[#abb3bf]">Left out: the agents do not read this.</p>}</You>
        : <You key={g[0].id}><p className="mb-1 text-[11.5px] text-[#d9c189]">{many(g.length, "document")}</p>{g.map((d) => <p key={d.id} className="truncate"><button onClick={() => openSource({ doc: d.id, title: d.title })} className={`text-left hover:underline ${d.use ? "" : "text-[#abb3bf] line-through decoration-white/30"}`} title={d.use ? d.filename : `Set aside: ${d.why}`}>{d.title}</button></p>)}</You>)}
    </>
  );
}

/** What the agents came back with, and where it now is. */
function Reply({ rec }: { rec: Rec }) {
  const go = useGo();
  const plan = rec.plan as Rec;
  const accounts = (plan.accounts ?? []) as Rec[];
  const work = accounts.reduce((n, a) => n + (a.packages as Rec[]).length, 0);
  const approved = rec.status === "approved";
  const tiles: [string, string, string, IconName][] = [
    ["wbs", "WBS", `${many(accounts.length, "control account")}, ${many(work, "work package")}`, "pipeline"],
    ["gantt", "Timeline", many(plan.weeks ?? 0, "week"), "clock"],
    ["critical", "Critical Path", `${many(((plan.links ?? []) as Rec[]).length, "link")} between the work`, "graph"],
    ["cost", "Cost", plan.total ? money(plan.total) : "No prices to go on yet", "gauge"],
    ["procedures", "Procedures", `${many(plan.totals?.steps ?? 0, "task")}${(plan.obligations ?? []).length ? `, and ${many(plan.obligations.length, "contract and regulation requirement")}` : ""}`, "doc"],
    ["model", "3D Timeline", "Drawn from the WBS and dates", "cube"],
    ["kanban", "Kanban", approved ? "The tasks are on the board" : "Fills when you approve", "grid"],
  ];
  return (
    <Agents>
      <p>{rec.summary}</p>
      <p className="text-[#abb3bf]">{approved ? `You approved this plan${rec.decided_at ? ` on ${String(rec.decided_at).slice(0, 10)}` : ""}.` : "It is in the tabs now, as a proposal. Nothing is the baseline until you approve it."}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-1.5">
        {tiles.map(([tab, label, note, icon]) => (
          <button key={tab} onClick={() => go(tab)} className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/15 px-2.5 py-2 text-left hover:border-[#f5b82e]/50 hover:bg-white/[.05]">
            <Icon name={icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f5b82e]" />
            <span className="min-w-0"><span className="block text-[12.5px] font-medium text-white">{label}</span><span className="block text-[11.5px] leading-snug text-[#8f99a8]">{note}</span></span>
          </button>
        ))}
      </div>
      {!approved && <button onClick={() => go("review")} className={`${primary} !px-3 !py-1.5 !text-[12.5px]`}>Review and approve</button>}
    </Agents>
  );
}

function Fold({ title, open = false, tall = false, children }: { title: string; open?: boolean; tall?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group overflow-hidden rounded-lg border border-white/10 bg-[#151e28]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 font-semibold text-white hover:bg-white/[.04] [&::-webkit-details-marker]:hidden"><Icon name="right" className="h-3.5 w-3.5 text-[#f5b82e] transition-transform group-open:rotate-90" />{title}</summary>
      <div className={`border-t border-white/10 ${tall ? "flex h-[540px] flex-col overflow-hidden" : ""}`}>{children}</div>
    </details>
  );
}

/** The proposal, to read here before deciding on it. Where the documents conflict, what is missing and what was assumed are on Review, and what the contract and regulations require is in Procedures. */
function Proposal({ rec, docs }: { rec: Rec; docs: Rec[] }) {
  return (
    <div className="space-y-2 pl-[38px]">
      <Fold title="Executive summary" open><ExecutiveSummary /></Fold>
      <Fold title="Scope" tall><Dictionary /></Fold>
      <Fold title="BOQ and costs" tall><BoqSection plan={rec.plan as Rec} docs={docs} /></Fold>
    </div>
  );
}

function Conversation({ project }: { project: Rec }) {
  const go = useGo();
  const sorted = useData("/api/project/package");
  const run = useData("/api/aip/analysis");
  const plans = useData("/api/project/plans");
  const uploads = useData("/api/project/documents");
  const running = run.data?.run?.status === "running";
  const poll = run.reload;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void poll(), 1500);
    return () => { clearInterval(t); notifyChanged(); };
  }, [running, poll]);
  const err = sorted.err || run.err || plans.err;
  if (!sorted.data || !run.data || !plans.data) return <div className="flex-1"><Problem err={err} />{!err && <Loading />}</div>;
  if (running) return <SwarmModule />;
  const docs = sorted.data.documents as Rec[];
  const list = plans.data.plans as Rec[];
  const rec = list.find((p) => p.status === "approved") ?? list.find((p) => p.status === "pending") ?? null;
  const last = list.find((p) => p.status !== "superseded");
  const ended = run.data.run && ["failed", "cancelled"].includes(run.data.run.status);
  const problem = ended && !rec;
  const kept = Number(run.data.kept ?? 0);
  if (!docs.length && !problem) return (
    <div className="@container relative min-h-0 flex-1 overflow-hidden">
      <Constellation beside={{ from: 1280, room: 720 }} className="absolute inset-0 opacity-40 @min-[1280px]:opacity-100" />
      <div className="relative flex h-full overflow-y-auto">
        <div className="m-auto w-full max-w-[720px] space-y-5 px-6 py-10 @min-[1280px]:ml-[6%]">
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium uppercase tracking-[.1em] text-[#f5b82e]">{project.name}</p>
            <h1 className="text-[26px] font-semibold tracking-tight text-white">What are you planning?</h1>
            <p className="max-w-[640px] text-[14px] leading-relaxed text-[#abb3bf]">This project is empty. Describe the job, add the documents you have, or both. The agents build the WBS, Timeline, Critical Path, Cost and Procedures from it, and those tabs fill in when they finish.</p>
          </div>
          <Composer used={0} proposal={null} hero />
        </div>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Problem err={err} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] space-y-3 px-6 py-5">
          <Thread docs={docs} />
          {kept > 0 && <Agents><p className="font-medium text-white">The last analysis was stopped, and nothing was lost.</p><p>{rec ? "The proposal here is as it was, and " : ""}{many(kept, "finished answer")} {kept === 1 ? "is" : "are"} kept, so carrying on pays only for the rest. Adding anything for the agents starts them over, because each of them has to hear it.</p><button onClick={() => go("swarm")} className={quiet}>Carry on in Agent Swarm</button></Agents>}
          {rec ? <Reply rec={rec} /> : problem ? <Agents><p className="font-medium text-white">That did not finish.</p><p>{String((run.data.problems as string[])[0] ?? "Nothing was kept from it.")}</p><p className="text-[#abb3bf]">Send again to retry, with anything you want to add.</p></Agents>
            : last?.status === "rejected" ? <Agents><p className="font-medium text-white">You rejected the last proposal.</p><p className="text-[#abb3bf]">The agents remember your reason. Tell them what to change, and they plan it again.</p></Agents>
            : <Agents><p>{many(sorted.data.used, "document")} ready, and the agents have not started. Add anything else you want them to know, then send.</p></Agents>}
          {rec && <Proposal rec={rec} docs={docs} />}
        </div>
      </div>
      {rec?.status === "approved"
        ? <p className="shrink-0 border-t border-white/10 bg-[#151e28] px-6 py-3 text-center text-[12.5px] text-[#abb3bf]">This plan is approved, so the agents do not plan it again. Changes from here are made on the WBS and Timeline tabs.</p>
        : <div className="shrink-0 border-t border-white/10 bg-[#151e28] px-6 py-3"><div className="mx-auto w-full max-w-[900px]"><Composer used={sorted.data.used} proposal={rec} hero={false} /></div></div>}
    </div>
    <Repository review={sorted.data} act={sorted.act} activities={(uploads.data?.activities ?? []) as Rec[]} missing={rec ? [] : sorted.data.missing as string[]} canAdd={rec?.status === "approved"} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ the projects */

function standing(p: Rec): [string, string] {
  const work = p.work_packages ? `, ${many(p.work_packages, "work package")}` : "";
  if (p.scenario) return ["Fictional demo", "text-[#8f99a8]"];
  if (p.running) return ["Agents working…", "animate-pulse text-[#2dd4ee]"];
  if (p.plan === "approved") return [`Approved${work}`, "text-[#7ee2c0]"];
  if (p.plan === "pending") return [`To review${work}`, "text-[#fbd38d]"];
  if (p.plan === "rejected") return ["Proposal rejected", "text-[#abb3bf]"];
  if (p.documents) return [`${many(p.documents, "document")}, not planned yet`, "text-[#abb3bf]"];
  return ["Empty", "text-[#8f99a8]"];
}

function NewProject({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const create = async () => {
    setBusy(true); setErr("");
    try { await api("/api/projects", { name: name.trim(), start, template: false }); reopen(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  useEffect(() => {
    const away = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", away);
    return () => window.removeEventListener("keydown", away);
  }, [busy, onCancel]);
  return (
    <div role="dialog" aria-modal="true" aria-label="New project" className="@container fixed inset-0 z-[70] overflow-hidden bg-[#0d131a] text-[13px]">
      <Constellation beside={{ from: 1000, room: 460 }} className="absolute inset-0 opacity-50 @min-[1000px]:opacity-100" />
      <span role="img" aria-label="NorthTeak" className="logo-full absolute left-6 top-5 h-7 w-[144px] text-white" />
      <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel" title="Cancel (Esc)" className="absolute right-5 top-4 z-10 rounded-md p-1.5 text-[#abb3bf] hover:bg-white/10 hover:text-white disabled:opacity-30"><Icon name="x" className="h-5 w-5" /></button>
      <div className="relative flex h-full overflow-y-auto">
        <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="m-auto w-full max-w-[460px] px-6 py-16 @min-[1000px]:ml-[6%]">
          <div className="space-y-4 rounded-2xl border border-white/10 bg-[#111820]/75 p-6 shadow-[0_24px_80px_rgb(0_0_0/.5)] backdrop-blur-md">
            <div className="space-y-1.5">
              <h1 className="text-[26px] font-semibold tracking-tight text-white">New project</h1>
              <p className="text-[14px] leading-relaxed text-[#abb3bf]">It starts empty. Next you tell the agents what you are planning.</p>
            </div>
            <label className="block space-y-1"><Label>Project name</Label><input autoFocus aria-label="Project name" disabled={busy} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gedung Pascasarjana FTP" className={`${field} !py-2 !text-[14px]`} /></label>
            <label className="block space-y-1"><Label>Work starts, if known</Label><input type="date" aria-label="Work starts" disabled={busy} value={start} onChange={(e) => setStart(e.target.value)} className={`${field} !py-2 !text-[14px]`} /></label>
            {err && <p role="alert" className="rounded border border-red-400/30 bg-red-500/10 px-3 py-2 leading-snug text-[#ffb4b4]">{err[0].toUpperCase() + err.slice(1)}</p>}
            <div className="flex items-center gap-2">
              <button type="submit" disabled={busy || !name.trim()} className={`${primary} !px-4 !py-2 !text-[13.5px]`}>{busy ? "Creating…" : "Create project"}</button>
              <button type="button" onClick={onCancel} disabled={busy} className={`${quiet} !px-3 !py-2 !text-[12.5px]`}>Cancel</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function HomeModule() {
  const { data, err } = useData("/api/projects");
  const [creating, setCreating] = useState(false);
  const [refused, setRefused] = useState("");
  const rows = (data?.projects ?? []) as Rec[];
  const open = rows.find((p) => p.id === data?.active);
  const choose = async (id: string) => {
    setRefused(""); setCreating(false);
    if (id === data?.active) return;
    try { await api(`/api/projects/${id}/open`, {}); reopen(); } catch (e) { setRefused((e as Error).message); }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#111820] text-[13px]">
      <aside className="flex min-h-0 w-[280px] shrink-0 flex-col border-r border-black/30 bg-[#1c2733] max-md:w-[210px]">
        <div className="shrink-0 border-b border-white/10 p-3">
          <button onClick={() => { setRefused(""); setCreating(true); }} className={`${primary} flex w-full items-center justify-center gap-1.5 !py-2 !text-[13px]`}><Icon name="plus" className="h-4 w-4" />New project</button>
        </div>
        <p className="shrink-0 px-3 pb-1 pt-2.5 text-[10.5px] uppercase tracking-wide text-[#8f99a8]">Projects</p>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2" role="list">
          {[...rows].reverse().map((p) => {
            const [note, tone] = standing(p);
            const on = p.id === data?.active && !creating;
            return (
              <button key={p.id} role="listitem" aria-current={on ? "true" : undefined} onClick={() => void choose(p.id)} className={`block w-full border-l-2 px-3 py-2 text-left ${on ? "border-[#f5b82e] bg-white/[.07]" : "border-transparent hover:bg-white/[.04]"}`}>
                <span className="block truncate font-medium text-white" title={String(p.name)}>{String(p.name).replace(" (fictional)", "")}</span>
                <span className={`block truncate text-[11.5px] ${tone}`}>{note}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Problem err={err || refused} />
        {creating ? <NewProject onCancel={() => setCreating(false)} />
          : !open ? (!err && <Loading />)
          : open.scenario ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <p className="flex shrink-0 items-center gap-2 border-b border-[#f5b82e]/30 bg-[#f5b82e]/[.07] px-4 py-2 text-[12.5px] text-[#fbd38d]"><Icon name="alert" className="h-3.5 w-3.5 shrink-0" />{String(open.name).replace(" (fictional)", "")} is a fictional demo: its records are made up, for trying out the screens. For a real job, start a new project.</p>
              <PlanningModule />
            </div>
          ) : <Conversation key={open.id} project={open} />}
      </main>
    </div>
  );
}
