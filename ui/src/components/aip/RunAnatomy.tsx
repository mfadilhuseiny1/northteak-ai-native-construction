"use client";
/** Where a review spent its time, agents, tokens and money. Everything from the run itself: each agent's model calls
 *  and tokens as the gateway booked them (run.agents_usage: calls, prompt incl. cached, cached, output, usd, model),
 *  its working spans (agent_status events) and the phases (phase events). An agent's tokens count to the phase it
 *  started working in. */
import { useMemo, useState } from "react";
import { modelName, type AipEvent, type Run } from "./aipRun";
import type { FirmAgent } from "./firmApi";
import { SERIES, Tooltip, useTip } from "./viz";

type Use = { calls?: number; prompt?: number; cached?: number; output?: number; usd?: number; model?: string };
type Part = { label: string; value: number; color: string; note?: string };

// the role groups, as a review is staffed: who plans and writes, who reads the data, who checks it
const GROUPS = [
  { key: "orchestration", label: "Orchestration", hint: "orchestrator, domain leads, report writer", color: SERIES[0] },
  { key: "analysts", label: "Analysts", hint: "site analysts, planning analysts, cost analysts, option analysts, impact engine sub-agents", color: SERIES[1] },
  { key: "validation", label: "Validation", hint: "QA, red team, validator", color: SERIES[2] },
] as const;
type Group = (typeof GROUPS)[number]["key"];
const LINE: Record<string, string> = { pimpinan: "Orchestrator", site: "Site operations", procurement: "Procurement", planning: "Planning", cost: "Cost control", quality: "Quality & safety", contract: "Contract", qa: "QA & red team", laporan: "Report desk" };
const TYPES = [{ key: "fresh", label: "New input", color: SERIES[0] }, { key: "cache", label: "Cached input", color: SERIES[1] }, { key: "output", label: "Output", color: SERIES[2] }];

const t = (s?: string | null) => (s ? Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`) : NaN);
const tok = (n: number) => n >= 1e6 ? `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}m` : n >= 1e3 ? `${(n / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : `${n}`;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "–");
const mins = (ms: number) => `${(ms / 60000).toLocaleString("en-US", { maximumFractionDigits: 1 })} min`;

function lineOf(key: string, roster: Map<string, FirmAgent>): string {
  const lini = roster.get(key)?.lini;
  if (lini) return lini;
  if (/^(qa|red|validator)/.test(key)) return "qa";
  return "pimpinan";
}
const groupOf = (line: string): Group => (line === "pimpinan" || line === "laporan" ? "orchestration" : line === "qa" || line === "validator" ? "validation" : "analysts");

/** A whole split into parts: one bar, 2px surface gaps between parts, the legend under it with each part's value */
function Split({ parts, fmt, total }: { parts: Part[]; fmt: (n: number) => string; total?: number }) {
  const { box, tip, at, clear } = useTip();
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div ref={box} className="relative" onPointerLeave={clear}>
      <div className="flex h-[10px] gap-[2px] overflow-hidden rounded-[4px]">
        {shown.map((p) => (
          <span key={p.label} className="h-full min-w-[3px] transition-[filter] hover:brightness-125" style={{ width: `${(100 * p.value) / (sum || 1)}%`, background: p.color }}
            onPointerMove={(e) => at(e, { title: p.label, lines: [{ key: p.color, value: fmt(p.value), label: pct(p.value, sum) }, ...(p.note ? [{ value: "", label: p.note }] : [])] })} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {shown.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-[#abb3bf]">{p.label}</span>
            <span className="font-semibold tabular-nums text-white">{fmt(p.value)}</span>
            {p.note && p.note.length <= 14 && <span className="text-[#8f99a8]">{p.note}</span>}
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** The agents at work over the review, per role group: stacked columns, one per time slice */
function Activity({ buckets, step }: { buckets: Record<Group, number>[]; step: number }) {
  const { box, tip, at, clear } = useTip();
  const top = Math.max(1, ...buckets.map((b) => GROUPS.reduce((s, g) => s + b[g.key], 0)));
  const H = 96;
  return (
    <div ref={box} className="relative" onPointerLeave={clear}>
      <div className="flex items-end gap-[2px]" style={{ height: H }}>
        {buckets.map((b, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-[2px]"
            onPointerMove={(e) => at(e, { title: `minute ${Math.round((i * step) / 60000)}–${Math.round(((i + 1) * step) / 60000)}`,
              lines: GROUPS.map((g) => ({ key: g.color, value: String(b[g.key]), label: `${g.label} working` })) })}>
            {[...GROUPS].reverse().map((g) => b[g.key] > 0 && (
              <span key={g.key} className="w-full rounded-t-[2px]" style={{ height: `${(100 * b[g.key]) / top}%`, background: g.color }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between border-t border-[#2c333b] pt-1 text-[10px] tabular-nums text-[#8f99a8]">
        <span>0</span><span>{mins((buckets.length * step) / 2)}</span><span>{mins(buckets.length * step)}</span>
      </div>
      <p className="mt-0.5 text-[10px] text-[#8f99a8]">column height: agents working at once (peak {top})</p>
      <Tooltip tip={tip} />
    </div>
  );
}

/** inReport: the closing chapter of the review's report, set as one of its sections rather than as a card of its own */
export function RunAnatomy({ run, events, roster, inReport = false }: { run: Run; events: AipEvent[]; roster: FirmAgent[]; inReport?: boolean }) {
  const [all, setAll] = useState(false);
  const a = useMemo(() => {
    const team = new Map(roster.map((x) => [x.key, x]));
    const start = t(run.created_at);
    const end = t(run.finished_at) || Math.max(start, ...events.map((e) => t(e.t)).filter((x) => !Number.isNaN(x)));
    // the phases, in the order they began
    const ph: { key: string; label: string; a: number; b: number }[] = [];
    for (const e of events.filter((x) => x.type === "phase")) {
      const p = ph.find((x) => x.key === e.phase);
      if (e.status === "mulai" && !p) ph.push({ key: e.phase, label: String(e.label ?? e.phase), a: t(e.t), b: NaN });
      else if (p && e.status === "selesai") p.b = t(e.t);
    }
    ph.forEach((p, i) => { if (Number.isNaN(p.b)) p.b = ph[i + 1]?.a ?? end; });
    // each agent's working spans
    const open: Record<string, number> = {};
    const spans: { agent: string; a: number; b: number }[] = [];
    const first: Record<string, number> = {};
    for (const e of events.filter((x) => x.type === "agent_status")) {
      const at0 = t(e.t);
      if (e.status === "bekerja") { open[e.agent] ??= at0; first[e.agent] ??= at0; } else if (open[e.agent] != null) { spans.push({ agent: e.agent, a: open[e.agent], b: at0 }); delete open[e.agent]; }
    }
    Object.entries(open).forEach(([agent, a0]) => spans.push({ agent, a: a0, b: end }));
    const phaseOf = (agent: string) => { const s = first[agent]; const p = ph.find((x) => s >= x.a && s < x.b); return p?.key ?? ph[0]?.key ?? "-"; };
    // what each agent spent
    const usage = (run.agents_usage ?? {}) as Record<string, Use>;
    const rows = Object.entries(usage).map(([key, u]) => {
      const line = lineOf(key, team);
      const prompt = u.prompt ?? 0, cached = Math.min(u.cached ?? 0, prompt), output = u.output ?? 0;
      return { key, name: team.get(key)?.name ?? key, line, group: groupOf(line), model: u.model ?? "?", calls: u.calls ?? 0, fresh: prompt - cached, cached, output,
        tokens: prompt + output, usd: u.usd ?? 0, phase: phaseOf(key) };
    }).sort((x, y) => y.usd - x.usd);
    const sum = (f: (r: (typeof rows)[number]) => number, of = rows) => of.reduce((s, r) => s + f(r), 0);
    const models = [...new Set(rows.map((r) => r.model))].map((m) => ({ model: m, rows: rows.filter((r) => r.model === m) }))
      .map((m) => ({ ...m, usd: sum((r) => r.usd, m.rows), tokens: sum((r) => r.tokens, m.rows), calls: sum((r) => r.calls, m.rows),
        fresh: sum((r) => r.fresh, m.rows), cached: sum((r) => r.cached, m.rows), output: sum((r) => r.output, m.rows) })).sort((x, y) => y.usd - x.usd);
    // time slices of about a minute (at most 72)
    const step = Math.max(60000, Math.ceil((end - start) / 72 / 60000) * 60000);
    const n = Math.max(1, Math.ceil((end - start) / step));
    const buckets = Array.from({ length: n }, () => Object.fromEntries(GROUPS.map((g) => [g.key, 0])) as Record<Group, number>);
    for (const s of spans) {
      const g = groupOf(lineOf(s.agent, team));
      for (let i = Math.max(0, Math.floor((s.a - start) / step)); i <= Math.min(n - 1, Math.floor((s.b - start - 1) / step)); i++) buckets[i][g] += 1;
    }
    return { start, end, ph, rows, models, buckets, step, sum, agents: new Set([...rows.map((r) => r.key), ...spans.map((s) => s.agent)]).size };
  }, [run, events, roster]);

  const { rows, models, sum } = a;
  const total = { usd: sum((r) => r.usd), tokens: sum((r) => r.tokens), calls: sum((r) => r.calls), fresh: sum((r) => r.fresh), cached: sum((r) => r.cached), output: sum((r) => r.output) };
  const dur = a.end - a.start;
  const modelColor = (m: string) => SERIES[Math.max(0, models.findIndex((x) => x.model === m)) % SERIES.length];
  const byGroup = (f: (r: (typeof rows)[number]) => number): Part[] => GROUPS.map((g) => ({ label: g.label, color: g.color, value: sum(f, rows.filter((r) => r.group === g.key)) }));
  if (!rows.length) return null;
  const head = (title: string, value: string) => (
    <div className="mb-2"><p className="text-[10.5px] font-semibold uppercase tracking-[.12em] text-[#d95926]">{title}</p><p className="mt-0.5 text-[15px] font-semibold tabular-nums text-white">{value}</p></div>
  );
  const sub = (s: string) => <p className="mb-1 mt-3 text-[10px] uppercase tracking-[.1em] text-[#8f99a8]">{s}</p>;
  return (
    <section id="review-cost" className={inReport ? "mt-5 border-t border-white/10 pt-4" : "rounded border border-white/10 bg-[#1c2127] p-4"}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <p className={inReport ? "text-[12.5px] font-semibold text-white" : "text-[13px] font-semibold text-white"}>{inReport ? "Review cost and resources" : "Review anatomy"}</p>
        <p className="text-[11px] text-[#8f99a8]">{money(total.usd)} · {tok(total.tokens)} tokens · {total.calls.toLocaleString("en-US")} model calls · {a.agents} agents · {mins(dur)} — from the gateway cost ledger per agent</p>
      </div>
      {inReport && (
        <p className="mb-3 max-w-[880px] text-[12.5px] leading-relaxed text-[#d3d8de]">
          This review used {tok(total.tokens)} tokens in {total.calls.toLocaleString("en-US")} model calls by {a.agents} agents over {mins(dur)}, at a cost of {money(total.usd)}.
          {" "}{models[0] ? `${modelName(models[0].model)} accounts for ${pct(models[0].usd, total.usd)} of cost. ` : ""}
          {(() => { const top = [...new Set(rows.map((r) => r.line))].map((l) => ({ l, usd: sum((r) => r.usd, rows.filter((r) => r.line === l)) })).sort((x, y) => y.usd - x.usd)[0];
            return top ? `The ${LINE[top.l] ?? top.l} line accounts for ${pct(top.usd, total.usd)} of cost. ` : ""; })()}
          {pct(total.cached, total.fresh + total.cached)} of input was read from cache.
        </p>
      )}
      <div className="grid gap-x-8 gap-y-5 xl:grid-cols-2">
        <div>
          {head("Time", `Total ${mins(dur)}`)}
          <div className="space-y-2">
            {a.ph.map((p) => {
              const inPhase = rows.filter((r) => r.phase === p.key);
              return (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between text-[11.5px]"><span className="text-[#e5e8eb]">{p.label}</span>
                    <span className="tabular-nums text-[#abb3bf]">{mins(p.b - p.a)} · {pct(p.b - p.a, dur)} · {money(sum((r) => r.usd, inPhase))} · {tok(sum((r) => r.tokens, inPhase))} tokens</span></div>
                  <div className="mt-1 h-[6px] rounded-[3px] bg-white/[.05]"><div className="h-full rounded-[3px]" style={{ width: `${Math.max(1, (100 * (p.b - p.a)) / (dur || 1))}%`, marginLeft: `${(100 * (p.a - a.start)) / (dur || 1)}%`, background: SERIES[0] }} /></div>
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-[#8f99a8]">bar position: when the phase ran in the review; cost and tokens: agents that started work in that phase</p>
          {sub(`Agents working over time · ${a.agents} agents`)}
          <Activity buckets={a.buckets} step={a.step} />
          <div className="mt-2"><Split parts={GROUPS.map((g) => ({ label: g.label, color: g.color, value: rows.filter((r) => r.group === g.key).length, note: g.hint }))} fmt={(v) => `${v} agents`} /></div>
        </div>
        <div>
          {head("Tokens", `${tok(total.tokens)} tokens`)}
          {sub("By type")}
          <Split parts={[{ ...TYPES[0], value: total.fresh }, { ...TYPES[1], value: total.cached }, { ...TYPES[2], value: total.output }]} fmt={tok} />
          {sub("By role")}
          <Split parts={byGroup((r) => r.tokens)} fmt={tok} />
          {sub("By model")}
          <Split parts={models.map((m) => ({ label: modelName(m.model), color: modelColor(m.model), value: m.tokens }))} fmt={tok} />
          <div className="mt-5">{head("Cost", `${money(total.usd)} total`)}</div>
          {sub("By model")}
          <Split parts={models.map((m) => ({ label: modelName(m.model), color: modelColor(m.model), value: m.usd, note: `${pct(m.usd, total.usd)}` }))} fmt={money} />
          <div className="mt-2 overflow-x-auto"><table className="w-full whitespace-nowrap text-[11px]">
            <thead><tr className="text-[#8f99a8]"><th className="py-1 text-left font-medium">Model</th><th className="px-1.5 text-right font-medium">Agents</th><th className="px-1.5 text-right font-medium">Calls</th>
              <th className="px-1.5 text-right font-medium">New input</th><th className="px-1.5 text-right font-medium">Cache</th><th className="px-1.5 text-right font-medium">Output</th><th className="px-1.5 text-right font-medium">$ / 1m tokens</th><th className="px-1.5 text-right font-medium">Cost</th></tr></thead>
            <tbody>{models.map((m) => (
              <tr key={m.model} className="border-t border-white/[.05] tabular-nums text-[#e5e8eb]">
                <td className="py-1"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: modelColor(m.model) }} />{modelName(m.model)}</td>
                <td className="px-1.5 text-right">{m.rows.length}</td><td className="px-1.5 text-right">{m.calls.toLocaleString("en-US")}</td><td className="px-1.5 text-right">{tok(m.fresh)}</td>
                <td className="px-1.5 text-right">{tok(m.cached)}</td><td className="px-1.5 text-right">{tok(m.output)}</td><td className="px-1.5 text-right">{money(m.tokens ? (1e6 * m.usd) / m.tokens : 0)}</td>
                <td className="px-1.5 text-right font-semibold text-white">{money(m.usd)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {sub("By role")}
          <Split parts={byGroup((r) => r.usd)} fmt={money} />
        </div>
      </div>
      <div className="mt-5">
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.12em] text-[#d95926]">Cost per agent</p>
        <p className="mb-2 text-[10.5px] text-[#8f99a8]">Each agent with its model, calls and tokens; bar = its share of {money(total.usd)}.</p>
        <div className="max-h-[420px] overflow-auto rounded border border-white/5">
          <table className="w-full whitespace-nowrap text-[11px]">
            <thead className="sticky top-0 bg-[#20262d] text-[#8f99a8]"><tr>
              <th className="px-2 py-1.5 text-left font-medium">Agent</th><th className="px-1.5 text-left font-medium">Line</th><th className="px-1.5 text-left font-medium">Model</th><th className="px-1.5 text-right font-medium">Calls</th>
              <th className="px-1.5 text-right font-medium">New input</th><th className="px-1.5 text-right font-medium">Cache</th><th className="px-1.5 text-right font-medium">Output</th><th className="px-2 text-right font-medium">Cost</th><th className="w-[22%] px-2 text-left font-medium">Share</th></tr></thead>
            <tbody>{(all ? rows : rows.slice(0, 15)).map((r) => (
              <tr key={r.key} className="border-t border-white/[.04] tabular-nums text-[#e5e8eb] hover:bg-white/[.03]" title={r.key}>
                <td className="max-w-[260px] truncate px-2 py-1">{r.name}</td><td className="px-1.5 text-[#abb3bf]">{LINE[r.line] ?? r.line}</td>
                <td className="px-1.5"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: modelColor(r.model) }} />{modelName(r.model)}</td>
                <td className="px-1.5 text-right">{r.calls}</td><td className="px-1.5 text-right">{tok(r.fresh)}</td><td className="px-1.5 text-right">{tok(r.cached)}</td><td className="px-1.5 text-right">{tok(r.output)}</td>
                <td className="px-2 text-right font-semibold text-white">{money(r.usd)}</td>
                <td className="px-2"><div className="flex items-center gap-1.5"><span className="h-[6px] rounded-r-[3px]" style={{ width: `${Math.max(1, (100 * r.usd) / (rows[0]?.usd || 1))}%`, background: modelColor(r.model) }} />
                  <span className="shrink-0 text-[10px] text-[#8f99a8]">{pct(r.usd, total.usd)}</span></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {rows.length > 15 && <button onClick={() => setAll(!all)} className="mt-1 text-[10.5px] text-[#8abbff] hover:underline">{all ? "Show less" : `Show all ${rows.length} agents`}</button>}
      </div>
    </section>
  );
}
