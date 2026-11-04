"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Gate } from "@/components/site/Account";
import type { Rec } from "@/components/site/kit";
import { flush, queueJson, queuePhoto, waiting, type Refused } from "./queue";

/* The site's own screen: a phone, one hand, patchy signal. What is on today, a daily log, a photo, and nothing else. Everything done here is kept on the phone first and sent when it can be, so a basement with no signal loses nothing. The rules still hold: a move a hold point forbids is refused when it reaches the server, and the screen says so. */

const NEXT: Record<string, [string, string]> = { open: ["doing", "Start"], doing: ["review", "Ready for review"], review: ["done", "Done"] };
const STATE: Record<string, [string, string]> = { open: ["To do", "#8f99a8"], doing: ["In progress", "#3987e5"], review: ["In review", "#fab219"], done: ["Done", "#29a383"] };
const WEATHER = ["Sunny", "Cloudy", "Rain", "Heavy rain"];
const KEPT = "northteak.field.board";

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}

async function get(path: string) {
  const r = await fetch(path, { cache: "no-store" });
  if (r.status === 401) { window.dispatchEvent(new Event("signed-out")); throw new Error("Sign in first."); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `${r.status}`);
  return r.json();
}

function Tasks({ board, onMove }: { board: Rec | null; onMove: (c: Rec, status: string) => void }) {
  const [who, setWho] = useState("");
  const today = String(board?.today ?? "");
  const soon = useMemo(() => { const d = new Date(`${today || "2026-01-01"}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); }, [today]);
  if (!board) return <p className="p-6 text-center text-[#abb3bf]">Nothing kept on this phone yet. Open this once with signal.</p>;
  const cards = (board.cards as Rec[]).filter((c) => c.status !== "done" && c.status !== "proposed" && (!who || c.owner === who));
  const now = cards.filter((c) => c.status !== "open" || !c.start || c.start <= soon).sort((a, b) => (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) || (a.cpm_rank ?? 999) - (b.cpm_rank ?? 999));
  const shown = now.slice(0, 40);
  const owners = (board.owners ?? []) as string[];
  return (
    <div className="space-y-2 p-3">
      <select aria-label="Whose work" value={who} onChange={(e) => setWho(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-3 text-[15px] text-white"><option value="" className="bg-[#1c2733]">Everyone</option>{owners.map((o) => <option key={o} value={o} className="bg-[#1c2733]">{o.replace(" (fictional)", "")}</option>)}</select>
      <p className="text-[12.5px] text-[#8f99a8]">This week: {now.length} of {cards.length} open tasks</p>
      {shown.map((c) => {
        const state = STATE[c.status], step = NEXT[c.status];
        const held = ((c.blockers ?? []) as Rec[]).find((b) => b.stop);
        return (
          <article key={c.id} className="rounded-xl border border-white/10 bg-[#1c2733] p-3" style={{ borderLeft: `4px solid ${held ? "#e5484d" : state?.[1]}` }}>
            <p className="flex items-center gap-2 text-[12px] text-[#8f99a8]"><span className="font-mono">{c.wbs || c.id}</span><span>{state?.[0]}</span>{c.critical && <span className="ml-auto rounded-full bg-[#fab219]/15 px-2 text-[#fbd38d]">critical</span>}</p>
            <h2 className="mt-1 text-[16px] font-semibold leading-snug text-white">{c.title}</h2>
            {held && <p className="mt-1 flex items-start gap-1.5 text-[13.5px] leading-snug text-[#ffb4b4]"><Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />{held.text}</p>}
            {step && <button disabled={!!held && c.status === "open"} onClick={() => onMove(c, step[0])} className="mt-2 w-full rounded-lg bg-[#f5b82e] px-3 py-3 text-[15px] font-semibold text-[#171106] disabled:opacity-40">{step[1]}</button>}
          </article>
        );
      })}
      {!shown.length && <p className="p-6 text-center text-[#abb3bf]">Nothing on this week.</p>}
    </div>
  );
}

function Log({ board, today, onSave }: { board: Rec | null; today: string; onSave: (body: Rec) => void }) {
  const blank = { area: "", weather: "Sunny", crew: "", activity: "", text: "" };
  const [f, setF] = useState(() => read("northteak.field.draft", blank));
  useEffect(() => { try { localStorage.setItem("northteak.field.draft", JSON.stringify(f)); } catch {} }, [f]);
  const box = "w-full rounded-lg border border-white/15 bg-black/25 px-3 py-3 text-[16px] text-white placeholder:text-[#6b7480] focus:border-[#f5b82e]/70 focus:outline-none";
  const acts = useMemo(() => [...new Map(((board?.cards ?? []) as Rec[]).filter((c) => c.activity).map((c) => [c.activity, c.activity_name || c.title])).entries()], [board]);
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12.5px] text-[#8f99a8]">Daily log for {today || "today"}</p>
      <label className="block"><span className="mb-1 block text-[13px] text-[#abb3bf]">What was done, and what got in the way</span><textarea rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} className={box} /></label>
      <label className="block"><span className="mb-1 block text-[13px] text-[#abb3bf]">Where</span><input value={f.area} placeholder="e.g. Lantai 2, grid C" onChange={(e) => setF({ ...f, area: e.target.value })} className={box} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="mb-1 block text-[13px] text-[#abb3bf]">Crew on site</span><input inputMode="numeric" value={f.crew} onChange={(e) => setF({ ...f, crew: e.target.value.replace(/\D/g, "") })} className={box} /></label>
        <label className="block"><span className="mb-1 block text-[13px] text-[#abb3bf]">Weather</span><select value={f.weather} onChange={(e) => setF({ ...f, weather: e.target.value })} className={box}>{WEATHER.map((w) => <option key={w} className="bg-[#1c2733]">{w}</option>)}</select></label>
      </div>
      <label className="block"><span className="mb-1 block text-[13px] text-[#abb3bf]">Work package, if one</span><select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} className={box}><option value="" className="bg-[#1c2733]">The whole site</option>{acts.map(([id, name]) => <option key={id} value={id} className="bg-[#1c2733]">{name}</option>)}</select></label>
      <button disabled={!f.text.trim()} onClick={() => { onSave({ ...f, area: f.area.trim() || "Site", crew: f.crew ? Number(f.crew) : null }); setF(blank); }} className="w-full rounded-lg bg-[#f5b82e] px-3 py-3.5 text-[16px] font-semibold text-[#171106] disabled:opacity-40">Save the log</button>
    </div>
  );
}

function Photo({ onSave }: { onSave: (f: File, caption: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [seen, setSeen] = useState("");
  return (
    <div className="space-y-3 p-3">
      <input ref={input} type="file" accept="image/*" capture="environment" aria-label="Photo" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setSeen(f ? URL.createObjectURL(f) : ""); }} />
      {seen ? <img src={seen} alt="" className="max-h-[46vh] w-full rounded-xl object-contain" /> : <button onClick={() => input.current?.click()} className="flex h-[38vh] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 text-[16px] text-[#d3d8de]"><Icon name="camera" className="h-8 w-8" />Take a photo</button>}
      <input aria-label="What it shows" value={caption} placeholder="What it shows" onChange={(e) => setCaption(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-3 text-[16px] text-white placeholder:text-[#6b7480]" />
      <button disabled={!file} onClick={() => { if (file) { onSave(file, caption); setFile(null); setSeen(""); setCaption(""); } }} className="w-full rounded-lg bg-[#f5b82e] px-3 py-3.5 text-[16px] font-semibold text-[#171106] disabled:opacity-40">Save the photo</button>
    </div>
  );
}

function Site() {
  const [tab, setTab] = useState<"tasks" | "log" | "photo">("tasks");
  const [board, setBoard] = useState<Rec | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try {
      const b = await get("/api/project/board");
      setBoard(b);
      try { localStorage.setItem(KEPT, JSON.stringify(b)); } catch {}
    } catch { setBoard((old) => old ?? read<Rec | null>(KEPT, null)); }
  }, []);
  const sync = useCallback(async () => {
    const out = await flush();
    setPending(waiting());
    if (out.refused.length) setRefused((r) => [...out.refused, ...r].slice(0, 5));
    if (out.sent) await load();
  }, [load]);
  useEffect(() => {
    setOnline(navigator.onLine);
    setPending(waiting());
    void load().then(sync);
    const up = () => { setOnline(true); void sync(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const t = setInterval(() => void sync(), 20000);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/field" }).catch(() => {});
      navigator.serviceWorker.ready.then(() => {  // this page's own scripts loaded before the worker was running, and without them the next visit with no signal is a page with nothing behind it
        const mine = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.includes("/_next/static/"));
        return caches.open("northteak-field-1").then((c) => c.addAll(mine));
      }).catch(() => {});
    }
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(t); };
  }, [load, sync]);
  const did = (text: string) => { setNote(text); setPending(waiting()); void sync(); setTimeout(() => setNote(""), 2500); };
  const move = (c: Rec, status: string) => {
    queueJson(c.type === "activity" ? `/api/project/board/activity/${c.id}` : `/api/project/work-items/${c.id}`, { status }, `${c.title}: ${STATE[status]?.[0]}`);
    setBoard((b) => (b ? { ...b, cards: (b.cards as Rec[]).map((x) => (x.id === c.id ? { ...x, status } : x)) } : b));
    did("Saved");
  };
  const tabs: ["tasks" | "log" | "photo", string, "grid" | "report" | "camera"][] = [["tasks", "Tasks", "grid"], ["log", "Daily log", "report"], ["photo", "Photo", "camera"]];
  return (
    <div className="fixed inset-0 flex flex-col bg-[#111820] text-[15px]">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#151e28] px-3 py-2.5">
        <p className="min-w-0 flex-1 truncate font-bold text-white">{tab === "tasks" ? "This week" : tab === "log" ? "Daily log" : "Photo"}</p>
        {!online && <span className="rounded-full bg-[#fab219]/15 px-2 py-0.5 text-[12px] text-[#fbd38d]">No signal</span>}
        {pending > 0 && <button onClick={() => void sync()} className="rounded-full bg-[#3987e5]/20 px-2 py-0.5 text-[12px] text-[#9cc7f5]">{pending} waiting to send</button>}
        {note && <span className="rounded-full bg-[#29a383]/20 px-2 py-0.5 text-[12px] text-[#7ee2c0]">{note}</span>}
      </header>
      {refused.map((r, i) => <button key={i} onClick={() => setRefused((x) => x.filter((_, n) => n !== i))} className="shrink-0 border-b border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-left text-[13.5px] leading-snug text-[#ffb4b4]">{r.label}: {r.why}</button>)}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "tasks" && <Tasks board={board} onMove={move} />}
        {tab === "log" && <Log board={board} today={String(board?.today ?? "")} onSave={(body) => { queueJson("/api/project/daily-reports", body, "Daily log"); did("Log saved"); }} />}
        {tab === "photo" && <Photo onSave={(f, caption) => { void queuePhoto(f, caption).then(() => did("Photo saved")); }} />}
      </main>
      <nav className="grid shrink-0 grid-cols-3 border-t border-white/10 bg-[#151e28] pb-[env(safe-area-inset-bottom)]">
        {tabs.map(([k, label, icon]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2.5 text-[12px] ${tab === k ? "text-[#f5b82e]" : "text-[#abb3bf]"}`}><Icon name={icon} className="h-5 w-5" />{label}</button>)}
      </nav>
    </div>
  );
}

export default function FieldPage() {
  return <Gate><Site /></Gate>;
}
