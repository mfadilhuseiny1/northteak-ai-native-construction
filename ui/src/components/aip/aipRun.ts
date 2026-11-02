"use client";
import { API_URL } from "@/lib/api";

/* AIP runs (api/aip/runs.py): a question goes to the orchestrator and the domain leads on Google ADK; the page polls
   the run's events — plan, tool steps with their receipts, the validator's verdict, proposals, the dynamic screen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = Record<string, any>;

export type Receipt = {
  type: "tool"; agent: string; tool: string; args: Rec; ok: boolean; ms: number; summary: string; seq: number; t?: string;
  request?: { endpoint: string; body?: Rec }; rid?: string | null; rows?: number;
  links?: { app: string; type_id?: string; type?: string; pk?: string; node?: string; node_id?: string; id?: string; name?: string; path?: string }[];
};
export type Check = { statement: string; ok: boolean; evidence?: string };
// a visual of the dynamic screen, bound to a run result (aip/adk_runtime/main.py _spec); y/note/kpi: runs before 2026-10-23
export type Panel = {
  widget: "bar" | "donut" | "line" | "map" | "table" | "text" | "kpi" | "leaderboard" | "contrib"; title: string; insight?: string; rid: string | null; fields: string[];
  label?: string | null; value?: string | null; x?: string | null; series?: string | null; highlight?: string[]; y?: string | null; note?: string | null;
};
export type UiSpec = { title: string; panels: Panel[] };
// the writer's briefing (aip/adk_runtime/agents.py BRIEFING_TASK): every number in it is checked by the validator
export type Briefing = Rec;
export type AipEvent = Rec & { type: string; seq: number };
export type Run = { simulasi?: boolean;  id: string; status: string; q: string; spent_usd: number; follow?: string | null; created_at: string; finished_at?: string | null; agents_usage?: Rec; answer?: string; ui_spec?: UiSpec;
  /** a review's orchestration version: "1.0" or "1.1" */
  version?: string;
  /** a simulation: an animation only, no model called */
  simulation?: boolean };
export type SubAgent = { key: string; name: string; technique: string; family: string; research?: string[] };
export type Agent = { peta?: string; menjawab?: string;  key: string; name: string; description: string; group_id: string | null; model: string; tools: string[]; subagents?: SubAgent[];
  map?: string; answers?: string; object_types: { id: string; name: string; api_name: string; primary_key: string; title: string; description: string; properties: { api_name: string; type: string }[] }[] };
export type Result = { columns: string[]; rows: Rec[]; types?: Record<string, string>; total?: number; title?: string; object_type?: { id: string; name: string } | null };

async function req<T = Rec>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `${r.status} ${r.statusText}`);
  return r.json();
}

type RunData = { run: Run; events: AipEvent[]; next: number };
// A finished run's trail never changes: kept after its first load; a review's trail is ~9 MB and the swarm tab and its
// chart each asked for it, on every visit. A running or interrupted run is always fetched; two loads of the same run at
// once share one request. Each caller gets its own copy of the list.
const FINISHED = new Set(["succeeded", "failed", "cancelled"]);
const runCache = new Map<string, Promise<RunData>>();
const copyRun = (r: RunData): RunData => ({ ...r, events: r.events.slice() });

export const aip = {
  agents: () => req<{ agents: Agent[]; roles: Record<string, string>; apps?: Record<string, string>; links?: { id: string; name: string; source: string; target: string }[];
    rules?: { plan?: { id: string; model: string; label: string } } }>("/api/aip/agents"),
  // follow: the run this question follows up (the server reads that run's thread as the conversation)
  ask: (q: string, history: { role: string; text: string }[], follow?: string) =>
    req<{ run: string }>("/api/aip/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, history, follow }) }),
  run: (id: string, after = 0): Promise<RunData> => {
    if (after !== 0) return req<RunData>(`/api/aip/runs/${id}?after=${after}`);
    let p = runCache.get(id);
    if (!p) {
      p = req<RunData>(`/api/aip/runs/${id}?after=0`);
      runCache.set(id, p);
      p.then((r) => {
        if (!FINISHED.has(r.run.status)) runCache.delete(id);
        while (runCache.size > 8) runCache.delete(runCache.keys().next().value as string);
      }, () => runCache.delete(id));
    }
    return p.then(copyRun);
  },
  runs: () => req<Run[]>("/api/aip/runs?limit=60"),  // turns, grouped into conversations on the page
  result: (id: string, rid: string) => req<Result>(`/api/aip/runs/${id}/results/${rid}`),
  cancel: (id: string) => req(`/api/aip/runs/${id}/cancel`, { method: "POST" }),
  spend: () => req<Rec>("/api/aip/spend"),
};

/** Poll a run until it ends: every new event goes to onEvent, the run as it stands (its spend so far) to onRun; resolves
    with the final run. */
export async function follow(id: string, onEvent: (e: AipEvent) => void, stop?: { current: boolean }, onRun?: (r: Run) => void): Promise<Run> {
  let after = 0;
  for (;;) {
    const r = await aip.run(id, after);
    r.events.forEach(onEvent);
    onRun?.(r.run);
    after = r.next;
    if (r.run.status !== "running" || stop?.current) return r.run;
    await new Promise((res) => setTimeout(res, 900));
  }
}

/** Where a receipt's link opens: the connected app, as the viewer. */
export function appHref(l: NonNullable<Receipt["links"]>[number]): string {
  switch (l.app) {
    case "objects": return `/object-explorer?type=${encodeURIComponent(l.type_id ?? "")}`;
    case "object": return `/object-explorer?type=${encodeURIComponent(l.type_id ?? "")}&q=${encodeURIComponent(l.pk ?? "")}`;
    case "lineage": return l.node_id ? `/lineage?node=${encodeURIComponent(l.node_id)}` : "/lineage";
    case "function": return `/functions/${encodeURIComponent(l.id ?? "")}`;
    case "code": return `/code-repositories/${encodeURIComponent(l.id ?? "")}`;
    default: return "/";
  }
}
export const APP_LABEL: Record<string, string> = { objects: "Object Explorer", object: "Object", lineage: "Data Lineage", function: "Function", code: "Code Repository" };

/** What an agent wrote, as text: a string as it is, anything else readable — a validator sometimes answers its evidence as
    an object or a list ({size, total_value, result_id}; [{group, value}]), which React cannot render as a child. */
export const txt = (x: unknown): string =>
  x == null ? "" : typeof x === "string" ? x : typeof x === "number" || typeof x === "boolean" ? String(x)
    : Array.isArray(x) ? x.map(txt).join("; ") : typeof x === "object" ? Object.entries(x as Rec).map(([k, v]) => `${k}: ${txt(v)}`).join(", ") : String(x);
export const usd = (n: number | undefined) => (n == null ? "—" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const WIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  second: "2-digit", hourCycle: "h23" });
/** A time from the API in Western Indonesia Time: "2026-10-24 08:15 WIB". The API writes UTC, with an offset
    ("…+00:00") or without one (event times "2026-10-24T01:15:26"), which is UTC too. */
export const wib = (iso?: string | null, seconds = false): string => {
  if (!iso) return "";
  const s = String(iso);
  const d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16).replace("T", " ");
  const p = Object.fromEntries(WIB.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${seconds ? `:${p.second}` : ""} WIB`;
};
// display the model of a role without the route prefix
export const modelName = (id?: string) => (id ?? "").split("/").pop()?.replace(/-maas$/, "") ?? "";
