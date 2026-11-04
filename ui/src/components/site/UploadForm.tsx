"use client";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { field, Label, Pill, primary, quiet, type Rec } from "./kit";

/* Uploading planning documents, one file or a whole package at once. Each file becomes its own record in the
   register, read by rules on the way in. The server sorts each by its name and first page (a schedule is a programme,
   a quantity list is the BoQ) unless a person picks one kind for all of them; titles come from the file names
   when there is more than one. A file that fails is named, and the rest still go in. */

const KINDS: Record<string, string> = { scope: "Work brief", drawing: "Drawing", spec: "Specification", itp: "Inspection plan", boq: "BoQ", programme: "Programme", contract: "Contract", other: "Other" };
export const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").replace(/^\d+[- ]+/, "").replace(/[-_]+/g, " ").trim() || name;
const sizeOf = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

type State = "waiting" | "uploading" | "done" | string;

export function UploadForm({ activities, onDone }: { activities: Rec[]; onDone: (saved: Rec[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [states, setStates] = useState<Record<number, State>>({});
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("auto");
  const [activity, setActivity] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Rec[]>([]);
  const pick = (list: FileList | null) => { setFiles(list ? [...list] : []); setStates({}); setSaved([]); };
  const upload = async () => {
    setBusy(true);
    const got: Rec[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setStates((s) => ({ ...s, [i]: "uploading" }));
      const body = new FormData();
      body.append("file", f);
      body.append("title", files.length === 1 && title.trim() ? title.trim() : titleOf(f.name));
      body.append("kind", kind);  // "auto" leaves it to the server, which also reads the file's first page
      body.append("activity", activity);
      body.append("issued_by", issuedBy);
      body.append("issued_on", issuedOn);
      try {
        const r = await fetch(`${API_URL}/api/project/documents`, { method: "POST", body });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText);
        const out = await r.json();
        if (out.documents) got.push(...(out.documents as Rec[]));  // a zip: each file in it is a document of its own
        else got.push(out);
        setStates((s) => ({ ...s, [i]: out.documents ? `done: ${(out.documents as Rec[]).length} documents from the zip${(out.skipped as Rec[]).length ? `, ${(out.skipped as Rec[]).length} set aside` : ""}` : "done" }));
      } catch (e) { setStates((s) => ({ ...s, [i]: `failed: ${(e as Error).message}` })); }
    }
    setSaved(got);
    setBusy(false);
  };
  const failed = files.filter((_, i) => String(states[i]).startsWith("failed"));
  const finished = saved.length > 0 && !busy;
  return (
    <div className="space-y-2">
      <input ref={input} type="file" multiple aria-label="Files" accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.dwg,.dxf,.xlsx,.docx,.zip" onChange={(e) => pick(e.target.files)} className="w-full text-[11px] text-[#d3d8de] file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white" />
      {files.length > 0 && (
        <div className="max-h-[220px] space-y-1 overflow-y-auto rounded border border-white/10 p-1.5">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-1.5 px-1 py-0.5">
              <Icon name="doc" className="h-3.5 w-3.5 shrink-0 text-[#8f99a8]" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-[#d3d8de]" title={f.name}>{titleOf(f.name)}<span className="ml-1 text-[10px] text-[#8f99a8]">{sizeOf(f.size)}</span></span>
              {kind !== "auto" && <Pill>{KINDS[kind]}</Pill>}
              {states[i] === "uploading" && <span className="shrink-0 text-[10px] text-[#fbd38d]">uploading…</span>}
              {String(states[i] ?? "").startsWith("done") && <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-[#7ee2c0]" />}{String(states[i] ?? "").startsWith("done: ") && <span className="shrink-0 text-[10px] text-[#7ee2c0]">{String(states[i]).slice(6)}</span>}
              {String(states[i] ?? "").startsWith("failed") && <span className="shrink-0 text-[10px] text-[#ffb4b4]">{String(states[i]).slice(8, 60)}</span>}
            </div>
          ))}
        </div>
      )}
      {files.length === 1 && <label className="block"><Label>Title</Label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={titleOf(files[0].name)} className={field} /></label>}
      {files.length > 1 && <p className="text-[11px] text-[#8f99a8]">Each file is titled from its file name. The kind, activity and issuer below apply to all of them.</p>}
      <div className="grid grid-cols-2 gap-2">
        <label><Label>Kind</Label><select value={kind} onChange={(e) => setKind(e.target.value)} className={field}><option value="auto" className="bg-[#1c2733]">Sort them for me</option>{Object.entries(KINDS).map(([k, label]) => <option key={k} value={k} className="bg-[#1c2733]">{label}</option>)}</select></label>
        <label><Label>Work package</Label><select value={activity} onChange={(e) => setActivity(e.target.value)} className={field}><option value="" className="bg-[#1c2733]">None yet</option>{activities.map((a) => <option key={a.id} value={a.id} className="bg-[#1c2733]">{a.id}</option>)}</select></label>
        <label><Label>Issued by</Label><input value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} className={field} /></label>
        <label><Label>Issued on</Label><input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={field} /></label>
      </div>
      {finished && <p className={failed.length ? "text-[#fbd38d]" : "text-[#7ee2c0]"}>{saved.length} of {files.length} uploaded and read by rules.{failed.length > 0 && ` ${failed.length} failed: ${failed.map((f) => f.name).join(", ")}`}</p>}
      <div className="flex justify-end gap-1.5">
        {finished && <button onClick={() => onDone(saved)} className={primary}>Done</button>}
        {!finished && <button disabled={!files.length || busy} onClick={upload} className={primary}>{busy ? `Uploading ${Object.values(states).filter((s) => String(s).startsWith("done")).length} of ${files.length}…` : files.length > 1 ? `Upload ${files.length} documents` : "Upload, and read it with rules"}</button>}
      </div>
      <p className="text-[11px] text-[#abb3bf]">They stay on this machine. Only what the agents need goes to Meta, and only when you start an analysis.</p>
    </div>
  );
}
