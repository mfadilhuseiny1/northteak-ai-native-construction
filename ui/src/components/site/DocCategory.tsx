"use client";

/* The categories a person sorts planning documents into, over the kinds the server reads. Choosing one tells the agents how to read the file: each category stands for the kind that comes first in its list. */

export const CATEGORIES: { id: string; name: string; kinds: string[] }[] = [
  { id: "planning", name: "Project Planning Documents", kinds: ["scope", "contract", "clarification"] },
  { id: "schedule", name: "Project Schedule", kinds: ["programme"] },
  { id: "wbs", name: "WBS", kinds: ["wbs"] },
  { id: "boq", name: "BOQ / Cost Estimation", kinds: ["boq", "estimate", "rates"] },
  { id: "drawing", name: "Engineering Drawings", kinds: ["drawing"] },
  { id: "spec", name: "Technical Specifications", kinds: ["spec", "itp"] },
  { id: "procedure", name: "Construction Procedures", kinds: ["method"] },
  { id: "other", name: "Other Supporting Documents", kinds: ["other", "tender", "award", "note"] },
];

export const categoryOf = (kind: string) => CATEGORIES.find((c) => c.kinds.includes(kind)) ?? CATEGORIES[CATEGORIES.length - 1];

const SELECT = "w-full min-w-0 rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-[12px] text-[#d3d8de]";

/** `kind` empty means not decided: the server sorts the file when it comes in. */
export function CategorySelect({ kind, onChange, auto = false }: { kind: string; onChange: (kind: string) => void; auto?: boolean }) {
  const now = kind ? categoryOf(kind).id : "";
  return (
    <select aria-label="Category" value={now} onChange={(e) => { const c = CATEGORIES.find((x) => x.id === e.target.value); if (c?.id !== now) onChange(c?.kinds[0] ?? ""); }} className={SELECT}>
      {auto && <option value="" className="bg-[#1c2733]">Detect from the file</option>}
      {CATEGORIES.map((c) => <option key={c.id} value={c.id} className="bg-[#1c2733]">{c.name}</option>)}
    </select>
  );
}
