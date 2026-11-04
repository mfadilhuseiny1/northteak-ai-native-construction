"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, useGo, type Rec } from "./kit";

/* The three-minute demo, for a presenter: each step opens its screen, lights up the part to look at, and says what to say and what to show.
   It changes nothing in the records; the presenter does the clicking. A clicker's Page Down and Page Up move it on and back. */

type Step = { route: string; target?: string; seconds: number; title: string; say: string; show: string };

const STEPS: Step[] = [
  { route: "home", target: '[data-tour="drop"]', seconds: 15, title: "One ZIP in",
    say: "A contractor wins access to a tender: nineteen PDFs. We drop the whole package here as one ZIP. From this moment the agents work on their own.",
    show: "Drop the package ZIP. Each file is read and sorted; offers naming other companies are set aside." },
  { route: "review", target: '[data-tour="tender"]', seconds: 20, title: "Can we even bid?",
    say: "Before any planning, code reads the qualification and bid rules from the tender sheets, each with its page, and works the thresholds out on the owner's estimate. Our price sits inside the safe band.",
    show: "Click Harga/Biaya, then drag the slider below 80% of the HPS." },
  { route: "swarm", target: '[data-tour="swarm"]', seconds: 20, title: "A swarm of agents plans the job",
    say: "This is the real run, replayed. A document controller finds the pages, one planner per work package writes the procedures side by side, a QA reviewer hunts for conflicts, and an RFI coordinator turns every open question into one ranked list. Circles are agents, squares are code.",
    show: "Press Replay, then click any node to see what it was told and what it made." },
  { route: "review", target: '[data-tour="map"]', seconds: 15, title: "A person decides",
    say: "Nothing is real yet. The whole proposal is on one map, every claim cites a page, and nothing reaches the site until a person approves it.",
    show: "Follow the map left to right, click Conflicts, then point at Approve above it." },
  { route: "wbs/tree", target: '[data-tour="wbs"]', seconds: 15, title: "Agents propose, code calculates",
    say: "The agents propose the breakdown. Code, not the model, works out every date, float and cost, so the numbers on screen can be trusted.",
    show: "Switch between Tree, Outline and Work packages." },
  { route: "critical", target: '[data-tour="cpm"]', seconds: 20, title: "Plan and site stay in sync",
    say: "This is the critical path, coloured live by the Kanban board. Move a task here and the board moves with it, and the rules refuse a move the logic forbids.",
    show: "Click a node and set it In progress, then try one that has to wait." },
  { route: "model", target: '[data-tour="model"]', seconds: 15, title: "Watch it get built",
    say: "The last stage of the swarm turns the plan into a 3D timeline: the building rises in the order the schedule says.",
    show: "Press play." },
  { route: "twin", target: '[data-tour="twin"]', seconds: 15, title: "Then it runs as a smart building",
    say: "After handover the same model becomes a digital twin. Its sensors come from the building's own MEP scope: fire, air, CCTV, power and water. These readings are simulated until the building's systems send real ones.",
    show: "Click an alert: the view goes to that device. Then switch on an add-on layer." },
  { route: "reports/project", target: '[data-tour="report-hero"]', seconds: 15, title: "Reporting writes itself",
    say: "Every month the project officer gets this: progress, money, variations, contingency, risks and decisions, saved so next month shows what changed.",
    show: "Scroll to the variation register and the contingency." },
  { route: "reports/funding", target: '[data-tour="print"]', seconds: 15, title: "And the bank gets its page",
    say: "Every quarter, one clear page per project for the CFO and the lending banks, with the money each quarter needs. One click to PDF.",
    show: "Click Print or save as PDF." },
  { route: "reports/funding", seconds: 15, title: "Agents propose. Code checks. People decide.",
    say: "That is agentic AI for construction: agents that read, plan and watch the job on their own, grounded in the documents, checked by code, and approved by people.",
    show: "" },
];
const TOTAL = STEPS.reduce((n, s) => n + s.seconds, 0);

/** Brings a part into view by scrolling the panel it sits in, never the page: the app's frame does not scroll, and moving it would shift every screen. */
function reveal(el: HTMLElement) {
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    const style = getComputedStyle(box);
    if (/(auto|scroll)/.test(style.overflowY) && box.scrollHeight > box.clientHeight + 4) {
      const outer = box.getBoundingClientRect(), r = el.getBoundingClientRect();
      const by = r.height > outer.height * 0.6 ? r.top - outer.top - 8 : r.top - outer.top - (outer.height - r.height) / 2;
      box.scrollBy({ top: by, behavior: "smooth" });
      return;
    }
  }
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The figures the closing card states, read live from this project's records. */
function useFacts(on: boolean) {
  const [facts, setFacts] = useState<Rec | null>(null);
  useEffect(() => {
    if (!on || facts) return;
    Promise.all([api("/api/project/package"), api("/api/project/wbs"), api("/api/project/tender-selection")]).then(([pkg, wbs, tender]) => setFacts({
      documents: (pkg.documents as Rec[]).length, used: pkg.used, packages: (wbs.activities as Rec[]).length, tasks: (wbs.root as Rec).roll?.tasks ?? 0,
      found: (tender.items as Rec[]).filter((x) => x.found.length).length, of: (tender.items as Rec[]).length,
    })).catch(() => setFacts({}));
  }, [on, facts]);
  return facts;
}

export function DemoTour({ onClose }: { onClose: () => void }) {
  const go = useGo();
  const [i, setI] = useState(0);
  const [began] = useState(() => Date.now());
  const [stepBegan, setStepBegan] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const step = STEPS[i], last = i === STEPS.length - 1;
  const facts = useFacts(last);

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(t); }, []);

  useEffect(() => {  // open the step's screen, then light up its part as soon as it has drawn, and keep the light on it as it moves
    go(step.route);
    setStepBegan(Date.now());
    setRect(null);
    (document.activeElement as HTMLElement | null)?.blur?.();  // a box that took the focus would swallow the arrows and the clicker
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    if (!step.target) return;
    let scrolled = false;
    const find = () => {
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      if (!scrolled && r.height > 0) { reveal(el); scrolled = true; }
      const top = Math.max(r.top, 52), bottom = Math.min(r.bottom, window.innerHeight - 6);
      const next = { left: Math.round(r.left), top: Math.round(top), width: Math.round(r.width), height: Math.round(Math.max(0, bottom - top)) };
      setRect((old) => (old && old.left === next.left && old.top === next.top && old.width === next.width && old.height === next.height ? old : next));
    };
    find();
    const t = window.setInterval(find, 250);
    return () => window.clearInterval(t);
  }, [i]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if (e.key === "Escape") onClose();
      else if (!typing && ["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); setI((n) => Math.min(STEPS.length - 1, n + 1)); }
      else if (!typing && ["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const elapsed = (now - began) / 1000, inStep = (now - stepBegan) / 1000;
  const due = STEPS.slice(0, i + 1).reduce((n, s) => n + s.seconds, 0);
  const late = elapsed > due;
  return (
    <>
      {rect && rect.height > 0 && <div aria-hidden className="pointer-events-none fixed z-[60] rounded-xl transition-all duration-300" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 3px #f5b82e, 0 0 32px 6px rgb(245 184 46 / .35), 0 0 0 9999px rgb(5 8 12 / .55)" }} />}
      <div role="dialog" aria-label="Demo" className="fixed bottom-5 left-5 z-[61] w-[440px] max-w-[calc(100vw-40px)] overflow-hidden rounded-2xl border border-[#f5b82e]/50 bg-[#141c25]/95 shadow-[0_18px_60px_rgb(0_0_0/.6)] backdrop-blur">
        <div className="flex h-1.5 gap-[2px] bg-black/30">
          {STEPS.map((s, n) => <span key={n} className="h-full overflow-hidden bg-white/10" style={{ width: `${(s.seconds / TOTAL) * 100}%` }}><span className="block h-full bg-[#f5b82e] transition-all" style={{ width: n < i ? "100%" : n > i ? "0%" : `${Math.min(100, (inStep / s.seconds) * 100)}%` }} /></span>)}
        </div>
        <div className="space-y-2.5 p-4">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold uppercase tracking-[.12em] text-[#f5b82e]"><Icon name="sparkle" className="h-3.5 w-3.5" />Agentic AI for construction</span>
            <span className="ml-auto tabular-nums text-[#8f99a8]">{i + 1} / {STEPS.length}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold tabular-nums ${late ? "bg-[#fab219]/20 text-[#fbd38d]" : "bg-white/10 text-white"}`} title="Time so far, against three minutes">{clock(elapsed)} / {clock(TOTAL)}</span>
            <button onClick={onClose} aria-label="End the demo" className="rounded p-1 text-[#8f99a8] hover:bg-white/10 hover:text-white"><Icon name="x" className="h-3.5 w-3.5" /></button>
          </div>
          <p className="text-[18px] font-bold leading-tight tracking-tight text-white">{step.title}</p>
          <p className="text-[13.5px] leading-relaxed text-[#e5e8eb]">{step.say}</p>
          {step.show && <p className="flex items-start gap-1.5 rounded-lg bg-white/[.05] px-2.5 py-2 text-[12px] leading-snug text-[#abb3bf]"><Icon name="right" className="mt-0.5 h-3 w-3 shrink-0 text-[#f5b82e]" /><span><b className="font-semibold text-white">Show: </b>{step.show}</span></p>}
          {last && facts && Object.keys(facts).length > 0 && (
            <div className="grid grid-cols-4 gap-2 pt-1">
              {[[facts.documents, "documents read"], [facts.packages, "work packages"], [facts.tasks, "tasks planned"], [`${facts.found}/${facts.of}`, "tender rules with their page"]].map(([v, label]) => (
                <div key={label as string} className="rounded-lg bg-white/[.05] px-2 py-2 text-center"><p className="text-[18px] font-bold tabular-nums text-white">{v as string}</p><p className="text-[10px] leading-tight text-[#8f99a8]">{label as string}</p></div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} className="rounded-md border border-white/15 px-3 py-1.5 text-[12px] text-[#d3d8de] hover:bg-white/[.07] disabled:opacity-30">Back</button>
            <span className="text-[10.5px] text-[#6f7c8b]">aim for {step.seconds}s · arrows or a clicker</span>
            <button onClick={() => (last ? onClose() : setI(i + 1))} className="ml-auto flex items-center gap-1.5 rounded-md bg-[#f5b82e] px-4 py-1.5 text-[12.5px] font-semibold text-[#171106] shadow-[0_2px_8px_rgb(245_184_46/.3)] hover:bg-[#ffc94d]">{last ? "Finish" : "Next"}{!last && <Icon name="right" className="h-3.5 w-3.5" />}</button>
          </div>
        </div>
      </div>
    </>
  );
}
