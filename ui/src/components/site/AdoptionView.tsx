"use client";
import { Label, Loading, Pill, Problem, useData, useGo, type Rec, type Tone } from "./kit";
import { SizeBar } from "./Visual";

/* Is the app really being used? Each measure is read from what people leave by working in it, against a target, and one that cannot be measured yet says why, with no score. For an owner to hold a team to. */

const LOOK: Record<string, { word: string; tone: Tone; color: string }> = { good: { word: "On target", tone: "ok", color: "#29a383" }, behind: { word: "Behind", tone: "warn", color: "#c98500" }, none: { word: "Not measurable yet", tone: "none", color: "#8f99a8" } };

function Measure({ m, onGo }: { m: Rec; onGo: () => void }) {
  const look = LOOK[m.state];
  return (
    <button onClick={onGo} className="block rounded-xl border border-white/10 bg-[#1c2733] p-3 text-left transition hover:border-white/30">
      <p className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-semibold text-white">{m.name}</span><Pill tone={look.tone}>{look.word}</Pill></p>
      <p className="mt-1.5 text-[26px] font-bold leading-none tabular-nums text-white">{m.value == null ? "–" : m.value}<span className="ml-1 text-[13px] font-medium text-[#abb3bf]">{m.value == null ? "" : m.unit}</span></p>
      {m.unit === "%" && m.value != null && <div className="mt-2"><SizeBar value={m.value} max={100} color={look.color} /></div>}
      <p className="mt-1.5 text-[11.5px] leading-snug text-[#abb3bf]">{m.note}</p>
      <p className="text-[11px] text-[#8f99a8]">Target: {m.target}</p>
    </button>
  );
}

export function AdoptionView() {
  const here = useData("/api/project/scorecard");
  const all = useData("/api/reports/scorecard");
  const go = useGo();
  if (!here.data) return <div className="flex-1 bg-[#111820]"><Problem err={here.err} />{!here.err && <Loading />}</div>;
  const d = here.data, people = d.people as Rec[], top = people[0]?.actions ?? 1;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#111820] p-4 text-[12px]">
      <Problem err={here.err || all.err} />
      <div className="mx-auto max-w-[1200px] space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/10 bg-[#1c2733] p-4">
          <div><Label>On target</Label><p className="mt-1 text-[32px] font-bold leading-none tabular-nums text-white">{d.score == null ? "–" : `${d.score}%`}</p></div>
          <p className="min-w-[260px] flex-1 leading-snug text-[#abb3bf]">{d.scored ? `${d.scored} of ${d.of} measures can be read so far.` : "Nothing can be measured yet."} {d.started ? "Each comes from what people do in the app, so a job run by email and spreadsheets scores low here whatever the plan says." : "The job has not started, so most of these wait for the first working day."}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(d.measures as Rec[]).map((m) => <Measure key={m.key} m={m} onGo={() => go(m.go)} />)}</div>
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-xl border border-white/10 bg-[#1c2733] p-3">
            <p className="font-semibold text-white">Who has been working in it</p>
            <p className="text-[11.5px] text-[#8f99a8]">Last 30 days, {d.actions} actions. With accounts on, each person is named.</p>
            <ul className="mt-2 space-y-1.5">{people.map((p) => <li key={p.name}><p className="flex justify-between text-[#d3d8de]"><span className="truncate">{p.name}</span><span className="tabular-nums">{p.actions}</span></p><SizeBar value={p.actions} max={top} /></li>)}{!people.length && <li className="text-[#8f99a8]">Nobody yet.</li>}</ul>
          </section>
          <section className="rounded-xl border border-white/10 bg-[#1c2733] p-3">
            <p className="font-semibold text-white">Across the firm</p>
            <ul className="mt-2 space-y-2">{((all.data?.projects ?? []) as Rec[]).map((p) => (
              <li key={p.id}>
                <p className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-[#d3d8de]">{p.name}</span><b className="tabular-nums text-white">{p.score == null ? "–" : `${p.score}%`}</b></p>
                <p className="mt-0.5 flex gap-1" aria-label={`${p.scored} of ${p.of} measurable`}>{(p.measures as Rec[]).map((m) => <span key={m.key} title={`${m.key}: ${LOOK[m.state].word}`} className="h-2 flex-1 rounded-sm" style={{ background: LOOK[m.state].color, opacity: m.state === "none" ? 0.3 : 1 }} />)}</p>
              </li>
            ))}</ul>
          </section>
        </div>
      </div>
    </div>
  );
}
