"use client";
import { useState, type FormEvent } from "react";
import { api, inline, primary, quiet, useData, type Rec } from "./kit";

/* What the agents remember, to read and correct. Only what people decided, did or wrote goes in. */

export function MemoryPanel() {
  const [text, setText] = useState("");
  const [sure, setSure] = useState("");
  const { data, err, act } = useData("/api/project/memory");
  if (!data) return err ? <p className="text-[11px] text-[#ffb4b4]">{err}</p> : null;
  const rows = data.memories as Rec[], status = data.status as Rec;
  const remember = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(() => api("/api/project/memory", { text }))) setText("");
  };
  return (
    <div className="space-y-2 text-[11.5px]">
      {!status.on && <p className="text-[#fbd38d]">Memory is off: {status.problem}. The app carries on without it.</p>}
      {err && <p className="text-[11px] text-[#ffb4b4]">{err}</p>}
      <form onSubmit={remember} className="flex items-center gap-1">
        <input aria-label="What the agents should remember" value={text} onChange={(e) => setText(e.target.value)} placeholder="Such as: the crane is free 3 hours a day" className={`${inline} min-w-0 flex-1`} />
        <button disabled={!text.trim()} className={primary}>Remember</button>
      </form>
      {rows.map((m) => (
        <div key={m.id} className="flex items-start gap-2 border-t border-white/5 pt-1.5">
          <p className="min-w-0 flex-1 leading-snug text-[#d3d8de]">{m.text} <span className="text-[10.5px] text-[#8f99a8]">{String(m.on).slice(0, 10)}</span></p>
          {sure === m.id ? (
            <span className="flex shrink-0 gap-1">
              <button onClick={() => { setSure(""); void act(() => api(`/api/project/memory/${m.id}/forget`, {})); }} className={quiet}>Yes, forget</button>
              <button onClick={() => setSure("")} className={quiet}>Keep</button>
            </span>
          ) : <button onClick={() => setSure(m.id)} className={`${quiet} shrink-0`}>Forget</button>}
        </div>
      ))}
      <p className="text-[10.5px] leading-snug text-[#8f99a8]">Kept on this machine. It goes to Meta only when agents run on Muse.</p>
    </div>
  );
}
