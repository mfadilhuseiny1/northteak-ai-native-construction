// @ts-nocheck -- only Markdown is used here; the rest of this file came along with it
"use client";
import { Fragment, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import type { AipEvent, Briefing } from "./aipRun";
import { STATUS } from "./viz";

/* The answer as a briefing: headline, key figures with their context, findings by severity, recommendations by
   priority, limitations — every number from the agents' findings and checked by the validator (aip/adk_runtime). A
   citation [r2] opens the data the number came from. Answers written as prose (voice, older runs) render as text. */

// ------------------------------------------------------------------------------------------------ text with citations

/** Inline text with **bold** and [r2] / [r1][r4] citations as chips (React elements only: model text is never HTML). */
export function RichText({ text, onRef }: { text: string; onRef?: (rid: string) => void }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[r\d+(?:\]\s*\[r\d+)*\]|\[r\d+(?:\s*,\s*r\d+)*\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>;
        const refs = p.match(/r\d+/g);
        if (refs && /^\[r\d+/.test(p)) return <Fragment key={i}>{refs.map((r) => <RefChip key={r} rid={r} onRef={onRef} />)}</Fragment>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

export function RefChip({ rid, onRef }: { rid: string; onRef?: (rid: string) => void }) {
  if (!rid) return null;
  return (
    <button type="button" onClick={() => onRef?.(rid)} title={`Open data ${rid}: source of this figure`}
      className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-[3px] border border-[#3987e5]/40 bg-[#3987e5]/10 px-1 font-mono text-[10px] leading-[15px] text-[#8abbff] hover:bg-[#3987e5]/25">
      {rid}
    </button>
  );
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row);
const NUMERIC = /^[-+]?(Rp\s?)?[\d.,]+\s*%?$/;

/** A pipe table; a column whose cells are all numbers or Rp is right-aligned. */
function Table({ rows, onRef }: { rows: string[]; onRef?: (rid: string) => void }) {
  const hasHead = rows.length > 1 && isRule(rows[1]);
  const head = hasHead ? cells(rows[0]) : null;
  const body = rows.slice(hasHead ? 2 : 0).filter((r) => !isRule(r)).map(cells);
  const n = Math.max(head?.length ?? 0, ...body.map((r) => r.length));
  const right = Array.from({ length: n }, (_, c) => body.length > 0 && body.every((r) => !r[c] || NUMERIC.test(r[c])));
  const align = (c: number) => (right[c] ? "text-right tabular-nums" : "text-left");
  return (
    <div className="my-2 overflow-x-auto rounded-md border border-white/[.08]">
      <table className="w-full border-collapse text-[12px]">
        {head && (
          <thead className="bg-white/[.04]">
            <tr>{Array.from({ length: n }, (_, c) => <th key={c} className={`whitespace-nowrap border-b border-white/[.08] px-2.5 py-1.5 font-semibold text-white ${align(c)}`}><RichText text={head[c] ?? ""} onRef={onRef} /></th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-b border-white/[.05] last:border-0 hover:bg-white/[.03]">
              {Array.from({ length: n }, (_, c) => <td key={c} className={`px-2.5 py-1.5 align-top ${align(c)}`}><RichText text={r[c] ?? ""} onRef={onRef} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Light markdown: paragraphs, "- " lists, "### " headings, pipe tables, **bold**, citations. */
export function Markdown({ text, onRef }: { text: string; onRef?: (rid: string) => void }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`} className="my-1.5 list-disc space-y-1 pl-5">{list.map((l, i) => <li key={i}><RichText text={l} onRef={onRef} /></li>)}</ul>);
    if (table.length) blocks.push(<Table key={`t${blocks.length}`} rows={table} onRef={onRef} />);
    list = [];
    table = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) { if (list.length) flush(); table.push(line); continue; }
    if (table.length && !line.trim()) continue;
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (item) { if (table.length) flush(); list.push(item[1]); continue; }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,6}\s+(.*)/);
    blocks.push(h ? <p key={`h${blocks.length}`} className="mt-2 font-semibold text-white"><RichText text={h[1]} onRef={onRef} /></p>
      : <p key={`p${blocks.length}`} className="my-1"><RichText text={line} onRef={onRef} /></p>);
  }
  flush();
  return <div className="text-[12.5px] leading-relaxed text-[#d3d8de]">{blocks}</div>;
}

// ------------------------------------------------------------------------------------------------ the briefing

const LEVEL: Record<Briefing["temuan"][number]["tingkat"], { label: string; icon: IconName }> = {
  kritis: { label: "Critical", icon: "alert" }, tinggi: { label: "High", icon: "alert" }, sedang: { label: "Medium", icon: "info" }, info: { label: "Info", icon: "info" },
};
const PRIORITY: Record<string, string> = { immediate: STATUS.tinggi, "this week": STATUS.sedang, routine: "#8f99a8" };

export function BriefingHero({ b, verdict, revised, onRef, children }: { b: Briefing; verdict?: AipEvent; revised?: boolean; onRef: (rid: string) => void; children?: ReactNode }) {
  const checks = verdict ? { passed: Number(verdict.passed ?? 0), total: Number(verdict.total ?? 0) } : null;
  return (
    <section className="overflow-hidden rounded-xl border border-white/[.08] bg-gradient-to-br from-[#1f2a3a] via-[#1c2127] to-[#1c2127]">
      <div className="px-5 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
          <span className="rounded-full bg-[#9d8cff]/15 px-2 py-0.5 font-medium uppercase tracking-wide text-[#c9c0ff]">Recovery plan</span>
          {checks && checks.total > 0 && (
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${checks.passed === checks.total ? "bg-emerald-500/15 text-emerald-300" : "bg-[#fab219]/15 text-[#f6c86b]"}`}>
              <Icon name={checks.passed === checks.total ? "check" : "alert"} className="h-3 w-3" />
              {verdict?.validator === "kode" ? `Figures checked by code ${checks.passed}/${checks.total}` : `Validated ${checks.passed}/${checks.total} checks`}{revised ? " · revised after validation" : ""}
            </span>
          )}
          {checks && checks.total === 0 && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[#abb3bf]">Not yet verified by validator</span>}
        </div>
        <h2 className="mt-2.5 text-[21px] font-semibold leading-snug text-white"><RichText text={b.judul} onRef={onRef} /></h2>
        {b.ringkasan && <p className="mt-2 max-w-[880px] text-[13.5px] leading-relaxed text-[#c5cbd3]"><RichText text={b.ringkasan} onRef={onRef} /></p>}
      </div>
      {b.angka_kunci.length > 0 && (
        <div className="grid gap-px border-t border-white/[.06] bg-white/[.06] sm:grid-cols-2 xl:grid-cols-4">
          {b.angka_kunci.map((k, i) => (
            <div key={i} className="bg-[#1c2127] px-5 py-3.5">
              <p className="text-[11px] text-[#abb3bf]">{k.label}</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-[26px] font-semibold leading-none text-white">{k.nilai}</span>
                {k.satuan && <span className="text-[12px] text-[#abb3bf]">{k.satuan}</span>}
              </p>
              {k.konteks && <p className="mt-1.5 text-[11.5px] leading-snug text-[#8f99a8]">{k.konteks}{k.rujukan && <RefChip rid={k.rujukan} onRef={onRef} />}</p>}
            </div>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}

export function Findings({ b, onRef }: { b: Briefing; onRef: (rid: string) => void }) {
  if (!b.temuan.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#8f99a8]">Findings</h3>
      <div className="grid gap-2.5 lg:grid-cols-2">
        {b.temuan.map((t, i) => {
          const lv = LEVEL[t.tingkat] ?? LEVEL.info;
          return (
            <article key={i} className="relative overflow-hidden rounded-lg border border-white/[.07] bg-[#1c2127] py-3 pl-4 pr-3.5">
              <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: STATUS[t.tingkat] ?? STATUS.info }} />
              <p className="flex items-center gap-1.5 text-[10.5px] font-medium" style={{ color: STATUS[t.tingkat] ?? STATUS.info }}>
                <Icon name={lv.icon} className="h-3 w-3" />{lv.label}
              </p>
              <h4 className="mt-1 text-[13.5px] font-semibold leading-snug text-white">{t.judul}</h4>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[#c5cbd3]"><RichText text={t.isi} onRef={onRef} />{t.rujukan.map((r) => <RefChip key={r} rid={r} onRef={onRef} />)}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function Recommendations({ b, children }: { b: Briefing; children?: ReactNode }) {
  if (!b.rekomendasi.length && !children) return null;
  return (
    <section className="rounded-lg border border-white/[.07] bg-[#1c2127] p-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-white"><Icon name="check" className="h-3.5 w-3.5 text-[#9d8cff]" />Recommendations for the project manager</h3>
      <p className="mt-0.5 text-[11px] text-[#8f99a8]">Analysts only propose; every action is decided and carried out by people.</p>
      <ol className="mt-3 space-y-2.5">
        {b.rekomendasi.map((r, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[.07] text-[11px] font-semibold text-white">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium leading-snug text-[#e5e8eb]">
                {r.tindakan}
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] font-normal" style={{ borderColor: `${PRIORITY[r.prioritas] ?? "#8f99a8"}66`, color: PRIORITY[r.prioritas] ?? "#abb3bf" }}>
                  <Icon name="clock" className="h-2.5 w-2.5" />{r.prioritas}
                </span>
              </p>
              {r.alasan && <p className="mt-0.5 text-[11.5px] leading-snug text-[#8f99a8]">{r.alasan}</p>}
            </div>
          </li>
        ))}
      </ol>
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </section>
  );
}

/** The briefing for leaders who are not technical (adk_runtime/main.py _plain): retold by another model, every number
    checked by code against the validated briefing; what code dropped is named, not hidden. */
export function PlainWords({ ev, writing }: { ev?: AipEvent; writing?: boolean }) {
  if (!ev) return writing ? <section className="rounded-lg border border-[#29a383]/25 bg-[#29a383]/[.05] px-4 py-3 text-[11.5px] text-[#8fd8bf]">Preparing executive summary…</section> : null;
  const figures = (ev.angka ?? []) as { angka: string; artinya: string }[];
  const decide = (ev.keputusan ?? []) as string[], mind = (ev.hati_hati ?? []) as string[], dropped = (ev.dibuang ?? []) as { bagian: string; teks: string; alasan: string }[];
  if (!ev.intinya && !figures.length && !decide.length) return null;
  return (
    <section className="rounded-lg border border-[#29a383]/30 bg-[#29a383]/[.06] p-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-white"><Icon name="eye" className="h-3.5 w-3.5 text-[#5fc4a8]" />Executive summary</h3>
      {ev.intinya && <p className="mt-2 text-[14px] font-medium leading-snug text-[#e5e8eb]">{String(ev.intinya)}</p>}
      {figures.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {figures.map((f, i) => (
            <div key={i} className="rounded-md border border-white/[.06] bg-black/15 px-3 py-2">
              <p className="text-[15px] font-semibold tabular-nums text-white">{f.angka}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-[#c5cbd3]">{f.artinya}</p>
            </div>
          ))}
        </div>
      )}
      {decide.length > 0 && (
        <div className="mt-3">
          <p className="text-[11.5px] font-semibold text-[#d3d8de]">Decisions needed</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[12px] leading-snug text-[#c5cbd3]">{decide.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      )}
      {mind.length > 0 && <p className="mt-2 text-[11.5px] leading-snug text-[#abb3bf]"><b className="text-[#d3d8de]">Keep in mind:</b> {mind.join(" ")}</p>}
      {dropped.length > 0 && (
        <details className="mt-2 text-[11px] text-[#8f99a8]">
          <summary className="cursor-pointer">{dropped.length} sentences not shown: figures not in the report</summary>
          <ul className="mt-1 space-y-0.5 pl-3">{dropped.map((d, i) => <li key={i}>{d.teks} <span className="text-[#6b7480]">— {d.alasan}</span></li>)}</ul>
        </details>
      )}
    </section>
  );
}

export function Limits({ b, onRef }: { b: Briefing; onRef: (rid: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2">
      {b.keterbatasan.length > 0 && (
        <div className="rounded-lg border border-white/[.06] bg-black/10 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#abb3bf]"><Icon name="info" className="h-3.5 w-3.5" />Data limitations</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11.5px] leading-snug text-[#8f99a8]">{b.keterbatasan.map((k, i) => <li key={i}>{k}</li>)}</ul>
        </div>
      )}
      {b.jawaban && (
        <div className="rounded-lg border border-white/[.06]">
          <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-[11.5px] text-[#abb3bf] hover:text-white">
            <Icon name="doc" className="h-3.5 w-3.5" />Full answer (validated text saved in history)<span className="ml-auto">{open ? "▾" : "▸"}</span>
          </button>
          {open && <div className="border-t border-white/[.06] px-4 py-2"><Markdown text={b.jawaban} onRef={onRef} /></div>}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ progress

const STAGES: { key: string; label: string }[] = [
  { key: "plan", label: "Plan" }, { key: "evidence", label: "Analyst evidence" }, { key: "write", label: "Report" },
  { key: "validate", label: "Validation" }, { key: "ui", label: "Visual" }, { key: "awam", label: "Executive summary" },
];

/** The run's steps; a lookup (the fast route) has no executive summary, and its numbers are checked by code; a project
 *  question reads the project pack instead of sending analysts */
export function Progress({ stage, done, activity, fast, audit }: { stage?: string; done: boolean; activity: { who: string; what: string; color: string }[];
  fast?: boolean; audit?: boolean }) {
  const stages = (fast ? STAGES.filter((s) => s.key !== "awam") : STAGES).map((s) => (audit && s.key === "evidence" ? { ...s, label: "Project pack" } : s));
  const at = stage === "revise" ? 3 : Math.max(0, stages.findIndex((s) => s.key === stage));
  return (
    <section className="rounded-xl border border-white/[.08] bg-[#1c2127] p-4">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {stages.map((s, i) => {
          const state = done || i < at ? "done" : i === at ? "now" : "next";
          return (
            <li key={s.key} className="flex items-center gap-1">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${state === "done" ? "bg-emerald-500/20 text-emerald-300" : state === "now" ? "bg-[#9d8cff]/25 text-white" : "bg-white/5 text-[#8f99a8]"}`}>
                {state === "done" ? <Icon name="check" className="h-3 w-3" /> : state === "now" ? <span className="h-2 w-2 animate-pulse rounded-full bg-[#c9c0ff]" /> : i + 1}
              </span>
              <span className={`text-[11.5px] ${state === "now" ? "font-medium text-white" : state === "done" ? "text-[#c5cbd3]" : "text-[#8f99a8]"}`}>{s.label}{stage === "revise" && i === 3 ? " · revision" : ""}{stage === "verify" && i === 0 ? " · verification (/verify)" : ""}</span>
              {i < stages.length - 1 && <span className="mx-1.5 h-px w-6 bg-white/10" />}
            </li>
          );
        })}
      </ol>
      {!done && activity.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-white/[.05] pt-2.5">
          {activity.map((a, i) => (
            <li key={i} className={`flex items-center gap-2 text-[11.5px] ${i === activity.length - 1 ? "text-[#e5e8eb]" : "text-[#8f99a8]"}`}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.color }} /><span className="shrink-0 font-medium">{a.who}</span><span className="truncate">{a.what}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
