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
const PILL: Record<Tone, string> = { ok: "bg-[#29a383]/20 text-[#7ee2c0]", warn: "bg-[#fab219]/15 text-[#fbd38d]", bad: "bg-[#e5484d]/20 text-[#ffb4b4]", info: "bg-[#3987e5]/20 text-[#9cc7f5]", none: "bg-white/10 text-[#c5cbd3]", violet: "bg-[#e879a8]/20 text-[#f4b8d4]" };
export function Pill({ tone = "none", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] ${PILL[tone]}`}>{children}</span>;
}

export function Bar({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/40 bg-[#151e28] px-4 py-2.5">
      <p className="text-[13.5px] font-bold tracking-tight text-white">{title}</p>
      {note && <span className="text-[11px] text-[#abb3bf]">{note}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Kpis({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap gap-x-8 gap-y-2 border-b border-black/40 bg-[#111820] px-4 py-3">{children}</div>;
}
export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  const color = tone === "bad" ? "text-[#ffb4b4]" : tone === "warn" ? "text-[#fbd38d]" : tone === "ok" ? "text-[#7ee2c0]" : "text-white";
  return <div><p className={`text-[20px] font-bold leading-none tabular-nums ${color}`}>{value}</p><p className="mt-1 text-[10px] font-medium uppercase tracking-[.08em] text-[#7d8b9b]">{label}{hint ? ` · ${hint}` : ""}</p></div>;
}

export function Card({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rise overflow-hidden rounded-lg border border-white/10 bg-[#1c2733] shadow-[0_4px_16px_rgb(0_0_0/.25)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-white/[.06] bg-white/[.02] px-3 py-2"><div className="text-[12px] font-bold tracking-tight text-white">{title}</div><div className="ml-auto flex items-center gap-1.5">{right}</div></div>
      {children}
    </section>
  );
}

export function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-left text-[12px]">
      <thead className="sticky top-0 z-[1] bg-[#151e28] text-[10.5px] uppercase tracking-wide text-[#7d8b9b]"><tr>{heads.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}
export const tr = "border-t border-white/5 hover:bg-white/[.04]";
export const td = "px-3 py-1.5 align-top text-[#d3d8de]";

export function Side({ eyebrow, title, onClose, children }: { eyebrow?: ReactNode; title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="rise w-[370px] shrink-0 space-y-3 overflow-y-auto border-l border-black/50 bg-[#151e28] p-4 text-[12px] shadow-[-12px_0_32px_rgb(0_0_0/.35)] max-lg:w-[300px]">
      <div className="flex items-start gap-2">
        <div className="min-w-0">{eyebrow && <p className="text-[10.5px] font-medium uppercase tracking-[.08em] text-[#f5b82e]">{eyebrow}</p>}<p className="mt-0.5 text-[15px] font-bold leading-snug tracking-tight text-white">{title}</p></div>
        <button onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button>
      </div>
      {children}
    </aside>
  );
}
export function Label({ children }: { children: ReactNode }) {
  return <p className="text-[10.5px] uppercase tracking-wide text-[#8f99a8]">{children}</p>;
}

export const inline = "rounded-md border border-white/15 bg-black/25 px-2 py-1.5 text-[12px] text-white placeholder:text-[#6b7480] focus:border-[#f5b82e]/60 focus:outline-none";
export const field = `w-full ${inline}`;
export const primary = "rounded-md bg-[#f5b82e] px-3 py-1.5 text-[11.5px] font-semibold text-[#171106] shadow-[0_2px_8px_rgb(245_184_46/.25)] hover:bg-[#ffc94d] disabled:opacity-40 disabled:shadow-none";
export const good = "rounded-md bg-[#29a383] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_2px_8px_rgb(41_163_131/.25)] hover:brightness-110 disabled:opacity-40";
export const quiet = "rounded-md border border-white/15 px-2 py-1 text-[11px] text-[#d3d8de] hover:border-white/30 hover:bg-white/[.07] hover:text-white disabled:opacity-40";

/** A link to a record in another module. */
export function Ref({ to, tone = "none", children }: { to: string; tone?: Tone; children: ReactNode }) {
  const go = useGo();
  return <button onClick={(e) => { e.stopPropagation(); go(to); }} className="hover:brightness-125"><Pill tone={tone}>{children}</Pill></button>;
}

/** The module's own tabs, under the main ones. */
export function SubTabs({ base, tabs, sub, right }: { base: string; tabs: [string, string, (number | string)?][]; sub: string; right?: ReactNode }) {
  const go = useGo();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-black/40 bg-[#151e28] px-3 pt-1.5" role="tablist">
      {tabs.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={sub === k} onClick={() => go(`${base}/${k}`)} className={`rounded-t-md px-2.5 py-1.5 text-[11.5px] ${sub === k ? "bg-[#111820] font-semibold text-[#f5b82e] shadow-[inset_0_2px_0_#f5b82e]" : "text-[#abb3bf] hover:bg-white/[.04] hover:text-white"}`}>
          {label}{n ? <span className="ml-1 rounded-full bg-[#fab219] px-1.5 text-[10px] font-semibold text-black">{n}</span> : null}
        </button>
      ))}
      {right && <div className="mb-1 ml-auto flex items-center gap-1.5">{right}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="m-4 rounded-lg border border-dashed border-white/15 p-8 text-center text-[12px] text-[#8f99a8]">{children}</div>;
}

/** A tab with nothing in it yet: it fills in when the agents have planned the project, and that starts on Home. */
export function NotYet({ children }: { children: ReactNode }) {
  const go = useGo();
  return <Empty>{children} This tab fills in when the agents have planned the project. <button onClick={() => go("home")} className="underline">Start on Home</button>.</Empty>;
}

export function Problem({ err }: { err: string }) {
  return err ? <p className="shrink-0 bg-[#e5484d]/10 px-4 py-1 text-[11px] text-[#ffb4b4]">{err[0].toUpperCase() + err.slice(1)}</p> : null;
}
export function Loading() {
  return <p className="animate-pulse p-6 text-[12px] text-[#abb3bf]">Loading…</p>;
}
