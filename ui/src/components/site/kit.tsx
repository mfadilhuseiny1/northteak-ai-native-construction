"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";

/* What the project screens share: calling the API, moving between modules, the WBS focus, and the few pieces every screen draws. */

/** A change in one module shows in the others: whoever changes a record says so, and every screen reads its data again. */
export const notifyChanged = () => window.dispatchEvent(new Event("records-changed"));

/** Move to a module: "kanban", "kanban/daily", or "documents/rfis:RFI-035" to open that record there. */
export const GoContext = createContext<(path: string) => void>(() => {});
export const useGo = () => useContext(GoContext);

/** One node of the WBS, picked out: every module then shows only what hangs on it. */
export type Focus = { code: string; name: string; type: string; package?: string; activities: string[] } | null;
export const FocusContext = createContext<{ focus: Focus; setFocus: (f: Focus) => void }>({ focus: null, setFocus: () => {} });
export const useFocus = () => useContext(FocusContext);
export const inFocus = (focus: Focus, r: { activity?: string; package?: string }) =>
  !focus || focus.type === "project" || (r.activity ? focus.activities.includes(r.activity) : !!focus.package && r.package === focus.package);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = Record<string, any>;

export async function api<T = Rec>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { cache: "no-store", ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `${r.status} ${r.statusText}`);
  return r.json();
}

/** A screen's data, and `act`: run a change, then read the data again, showing a refusal where the screen shows errors. */
export function useData<T = Rec>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(() => api<T>(path).then((d) => { setData(d); setErr(""); }).catch((e) => setErr((e as Error).message)), [path]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener("records-changed", again);
    return () => window.removeEventListener("records-changed", again);
  }, [reload]);
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); setErr(""); await reload(); notifyChanged(); return true; } catch (e) { setErr((e as Error).message); return false; }
  };
  return { data, err, reload, act };
}

export const money = (n?: number | null) => {
  if (n == null) return "–";
  const v = Number(n), a = Math.abs(v);
  return a >= 1e9 ? `Rp ${(v / 1e9).toFixed(2)} bn` : a >= 1e6 ? `Rp ${(v / 1e6).toFixed(1)} m` : `Rp ${v.toLocaleString("en-US")}`;
};
export const full = (n?: number | null) => (n == null ? "–" : `Rp ${Number(n).toLocaleString("en-US")}`);
export const num = (n: number, d = 1) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
export const inDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const short = (d?: string) => (d ? d.slice(5) : "–");
/** From when to when. The year shows when it changes: "11-09 to 11-07" reads as ending before it starts. */
export const dates = (a?: string, b?: string) => (a && b && a.slice(0, 4) !== b.slice(0, 4) ? `${a} to ${b}` : `${short(a)} to ${short(b)}`);
export const clean = (s?: string) => (s ?? "").replace(" (fictional)", "");

export type Tone = "ok" | "warn" | "bad" | "info" | "none" | "violet";
const PILL: Record<Tone, string> = { ok: "bg-[#29a383]/20 text-[#7ee2c0]", warn: "bg-[#fab219]/15 text-[#fbd38d]", bad: "bg-[#e5484d]/20 text-[#ffb4b4]", info: "bg-[#3987e5]/20 text-[#9cc7f5]", none: "bg-white/10 text-[#c5cbd3]", violet: "bg-[#c084fc]/20 text-[#e9d5ff]" };
export function Pill({ tone = "none", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] ${PILL[tone]}`}>{children}</span>;
}

export function Bar({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-[#1c2127] px-4 py-2">
      <p className="text-[13px] font-semibold text-white">{title}</p>
      {note && <span className="text-[11px] text-[#abb3bf]">{note}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Kpis({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap gap-x-7 gap-y-2 border-b border-white/5 bg-[#161a1f] px-4 py-2.5">{children}</div>;
}
export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  const color = tone === "bad" ? "text-[#ffb4b4]" : tone === "warn" ? "text-[#fbd38d]" : tone === "ok" ? "text-[#7ee2c0]" : "text-white";
  return <div><p className={`text-[16px] font-semibold tabular-nums ${color}`}>{value}</p><p className="text-[10.5px] text-[#8f99a8]">{label}{hint ? ` · ${hint}` : ""}</p></div>;
}

export function Card({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded border border-white/10 bg-[#1c2127]">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2"><div className="text-[12px] font-semibold text-white">{title}</div><div className="ml-auto flex items-center gap-1.5">{right}</div></div>
      {children}
    </section>
  );
}

export function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-left text-[12px]">
      <thead className="sticky top-0 z-[1] bg-[#1c2127] text-[10.5px] uppercase tracking-wide text-[#8f99a8]"><tr>{heads.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}
export const tr = "border-t border-white/5 hover:bg-white/[.04]";
export const td = "px-3 py-1.5 align-top text-[#d3d8de]";

export function Side({ eyebrow, title, onClose, children }: { eyebrow?: ReactNode; title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="w-[360px] shrink-0 space-y-3 overflow-y-auto border-l border-black/30 bg-[#1c2127] p-4 text-[12px] max-lg:w-[290px]">
      <div className="flex items-start gap-2">
        <div className="min-w-0">{eyebrow && <p className="text-[11px] text-[#8f99a8]">{eyebrow}</p>}<p className="text-[14px] font-semibold text-white">{title}</p></div>
        <button onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button>
      </div>
      {children}
    </aside>
  );
}
export function Label({ children }: { children: ReactNode }) {
  return <p className="text-[10.5px] uppercase tracking-wide text-[#8f99a8]">{children}</p>;
}

export const inline = "rounded border border-white/15 bg-black/20 px-2 py-1 text-[12px] text-white placeholder:text-[#6b7480]";
export const field = `w-full ${inline}`;
export const primary = "rounded bg-[#5b5fd6] px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-[#6a6ee0] disabled:opacity-40";
export const good = "rounded bg-[#29a383] px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-40";
export const quiet = "rounded border border-white/15 px-2 py-0.5 text-[11px] text-[#d3d8de] hover:bg-white/5 disabled:opacity-40";

/** A link to a record in another module. */
export function Ref({ to, tone = "none", children }: { to: string; tone?: Tone; children: ReactNode }) {
  const go = useGo();
  return <button onClick={(e) => { e.stopPropagation(); go(to); }} className="hover:brightness-125"><Pill tone={tone}>{children}</Pill></button>;
}

/** The module's own tabs, under the main ones. */
export function SubTabs({ base, tabs, sub, right }: { base: string; tabs: [string, string, (number | string)?][]; sub: string; right?: ReactNode }) {
  const go = useGo();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/10 bg-[#1c2127] px-3 pt-1.5" role="tablist">
      {tabs.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={sub === k} onClick={() => go(`${base}/${k}`)} className={`rounded-t px-2.5 py-1 text-[11.5px] ${sub === k ? "bg-[#161a1f] font-medium text-white" : "text-[#abb3bf] hover:text-white"}`}>
          {label}{n ? <span className="ml-1 rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{n}</span> : null}
        </button>
      ))}
      {right && <div className="mb-1 ml-auto flex items-center gap-1.5">{right}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-6 text-center text-[#8f99a8]">{children}</p>;
}

export function Problem({ err }: { err: string }) {
  return err ? <p className="shrink-0 bg-[#e5484d]/10 px-4 py-1 text-[11px] text-[#ffb4b4]">{err[0].toUpperCase() + err.slice(1)}</p> : null;
}
export function Loading() {
  return <p className="p-6 text-[#abb3bf]">Loading…</p>;
}
