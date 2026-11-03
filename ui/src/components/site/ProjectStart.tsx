"use client";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { CategorySelect, categoryOf } from "./DocCategory";
import { api, field, Label, primary, quiet, type Rec } from "./kit";
import { titleOf } from "./UploadForm";

/* The first screen of a project: its name and the consultant's planning package, on one page. One button uploads the files and sets the agents to work, so the person is told here what that sends and what it costs. No category is required: a project can go ahead on what it has, and more can come later. */

const TYPES = ".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.dwg,.dxf,.xlsx,.docx";
const sizeOf = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

type Row = { file: File; kind: string; state: "waiting" | "uploading" | "reading" | "done" | "failed"; pct: number; note: string; saved?: Rec };

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

export function ProjectStart({ create, onCancel }: { create: boolean; onCancel?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [err, setErr] = useState("");
  const [left, setLeft] = useState(false);  // the files are in and the agents did not start: the way on is the workspace
  const add = (list: FileList | File[] | null) => {
    const allowed = new Set(TYPES.split(","));
    const picked = [...(list ?? [])].filter((f) => allowed.has(`.${f.name.split(".").pop()?.toLowerCase()}`));
    setRows((old) => [...old, ...picked.filter((f) => !old.some((r) => r.file.name === f.name && r.file.size === f.size)).map((file): Row => ({ file, kind: "", state: "waiting", pct: 0, note: "" }))]);
  };
  const change = (i: number, patch: Partial<Row>) => setRows((old) => old.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const workspace = () => { window.location.hash = "planning"; window.location.reload(); };
  const go = async () => {
    setBusy(true); setErr(""); setLeft(false);
    try {
      if (create && !stage) {
        setStage("project");
        await api("/api/projects", { name: name.trim(), start, template: false });
      }
      setStage("upload");
      let read = 0;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].state === "done") { read += rows[i].saved?.use === false ? 0 : 1; continue; }
        change(i, { state: "uploading", pct: 0, note: "" });
        try {
          const saved = await send(rows[i], (pct) => change(i, pct >= 100 ? { state: "reading", pct } : { pct }));
          change(i, { state: "done", saved, note: saved.how_read ?? "" });
          read += saved.use === false ? 0 : 1;
        } catch (e) { change(i, { state: "failed", note: (e as Error).message }); }
      }
      if (!read) {
        setErr("No file went to the agents: each one failed, or was set aside as not for the site. Add a file, or open the workspace to overrule the sorting.");
        setLeft(true);
        return;
      }
      setStage("analysis");
      await api("/api/aip/konsultan", { nama: "Analysis of the documents", versi: "muse", jenis: "package" });
      workspace();
    } catch (e) {
      setErr((e as Error).message);
      setLeft(stage !== "" || !create);
    } finally { setBusy(false); }
  };
  const failed = rows.filter((r) => r.state === "failed").length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#161a1f] text-[13px]">
      <div className="mx-auto w-full max-w-[820px] space-y-5 px-6 py-10">
        <div className="space-y-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight text-white">Start with your planning documents.</h1>
          <p className="max-w-[640px] text-[14px] leading-relaxed text-[#abb3bf]">Upload your consultant&apos;s project planning package. AI will analyze your documents and build a structured construction project workspace.</p>
        </div>
        {create && (
          <div className="grid grid-cols-[minmax(0,1fr)_190px] gap-3 max-sm:grid-cols-1">
            <label className="block space-y-1"><Label>Project name</Label><input autoFocus aria-label="Project name" disabled={busy || !!stage} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gedung Pascasarjana FTP" className={`${field} !py-1.5 !text-[13px]`} /></label>
            <label className="block space-y-1"><Label>Work starts, if known</Label><input type="date" aria-label="Work starts" disabled={busy || !!stage} value={start} onChange={(e) => setStart(e.target.value)} className={`${field} !py-1.5 !text-[13px]`} /></label>
          </div>
        )}
        <button type="button" disabled={busy} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) add(e.dataTransfer.files); }}
          className={`flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors ${over ? "border-[#9d8cff] bg-[#9d8cff]/10" : "border-white/15 bg-[#1c2127] hover:border-white/30"}`}>
          <Icon name="upload" className="h-6 w-6 text-[#9d8cff]" />
          <span className="text-[14px] font-medium text-white">Drop the whole package here, or choose files</span>
          <span className="text-[12px] text-[#8f99a8]">Schedule, WBS, BOQ, drawings, specifications, procedures. PDF, Word, Excel, CAD, images or text, up to 64 MB each. You do not need every kind, and you can add more later.</span>
        </button>
        <input ref={input} type="file" multiple accept={TYPES} aria-label="Planning documents" onChange={(e) => { add(e.target.files); e.target.value = ""; }} className="hidden" />
        {rows.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-[#1c2127]">
            {rows.map((r, i) => (
              <div key={`${r.file.name}-${r.file.size}`} className="grid grid-cols-[minmax(0,1fr)_230px_24px] items-center gap-3 border-t border-white/5 px-3 py-2 first:border-t-0 max-sm:grid-cols-1">
                <div className="min-w-0">
                  <p className="truncate text-white" title={r.file.name}>{titleOf(r.file.name)}<span className="ml-1.5 text-[11.5px] text-[#8f99a8]">{sizeOf(r.file.size)}</span></p>
                  {r.state === "uploading" && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-[#8083e8] transition-all" style={{ width: `${r.pct}%` }} /></span>}
                  {r.state === "reading" && <p className="animate-pulse text-[12px] text-[#d9d3ff]">Reading and sorting it…</p>}
                  {r.state === "done" && <p className="truncate text-[12px] text-[#7ee2c0]" title={r.saved?.why}>{r.saved?.use === false ? <span className="text-[#abb3bf]">Set aside: {r.saved?.why}</span> : r.note || "Read"}</p>}
                  {r.state === "failed" && <p className="truncate text-[12px] text-[#ffb4b4]" title={r.note}>Failed: {r.note}</p>}
                </div>
                {r.state === "done"
                  ? <span className="truncate text-[12px] text-[#d3d8de]">{categoryOf(String(r.saved?.kind ?? "other")).name}</span>
                  : <CategorySelect auto kind={r.kind} onChange={(kind) => change(i, { kind })} />}
                {r.state === "done" ? <Icon name="check" className="h-4 w-4 text-[#7ee2c0]" /> : <button disabled={busy} aria-label={`Remove ${r.file.name}`} onClick={() => setRows((old) => old.filter((_, n) => n !== i))} className="rounded p-0.5 text-[#8f99a8] hover:bg-white/10 hover:text-white disabled:opacity-30"><Icon name="x" className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
        {err && <p role="alert" className="rounded border border-red-400/30 bg-red-500/10 px-3 py-2 leading-snug text-[#ffb4b4]">{err}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy || !rows.length || (create && !name.trim()) || rows.every((r) => r.state === "done")} onClick={() => void go()} className={`${primary} !px-4 !py-2 !text-[13.5px]`}>
            {!busy ? `Upload and analyze${rows.length ? ` ${rows.length} document${rows.length === 1 ? "" : "s"}` : ""}` : stage === "analysis" ? "Starting the agents…" : stage === "project" ? "Creating the project…" : `Uploading ${rows.filter((r) => r.state === "done").length + 1} of ${rows.length}…`}
          </button>
          {onCancel && !stage && <button onClick={onCancel} className={`${quiet} !px-3 !py-1.5 !text-[12.5px]`}>Cancel</button>}
          {left && <button onClick={workspace} className={`${quiet} !px-3 !py-1.5 !text-[12.5px]`}>Open the workspace</button>}
          {failed > 0 && !busy && <span className="text-[12px] text-[#fbd38d]">{failed} failed. Press again to retry them.</span>}
        </div>
        <p className="max-w-[640px] text-[12px] leading-relaxed text-[#8f99a8]">The files stay on this machine until you press the button. Then the pages the agents need go to the Meta Model API, which uses API credit: a 19-file package took about 6 minutes and cost $1.56. What they produce is a proposal, and nothing becomes the project&apos;s baseline until you approve it.</p>
      </div>
    </div>
  );
}
