"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { modelName, usd, type Rec } from "@/components/aip/aipRun";
import { useTampilBiaya } from "@/components/aip/costToggle";
import { firm, type FirmConfig, type Project, type ProjectForm as ProjectFields, type ReviewSummary, type Team } from "@/components/aip/firmApi";

/* Projects of the AI Agent Swarm: a tab of its own, empty and good-looking, with the button that starts a review.
   A project holds the construction project under review; the user sets a name and a focus only — the models, agents
   at once and cost limit are the firm's defaults (the API still takes them), the data source is a readiness line,
   not a setting. */

const field = "w-full rounded-sm border border-white/15 bg-[#111418] px-2 py-1.5 text-[12px] text-[#e5e8eb] outline-none focus:border-[#5b5fd6]";
/** A cost limit in whole dollars where it is whole ("$20", not "$20.000", which reads as twenty thousand in some locales). */
export const usdLimit = (n?: number | null) => (n == null ? "—" : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);
const modelLabel = (cfg: FirmConfig | null, id?: string) => cfg?.model.find((m) => m.id === id)?.label ?? modelName(id);
/** A project's seat models; the defaults for a seat it does not set (and for the reviews from before projects). */
const seatsOf = (cfg: FirmConfig | null, p?: Project | null): Record<string, string> =>
  Object.fromEntries((cfg?.kursi ?? []).map((s) => [s.kursi, p?.model?.[s.kursi] || s.default]));

/** A slowly turning network on a sphere behind a glowing ring: the empty project's mark. Canvas, no data; still for
 *  reduced motion; faster while `busy`. */
export function NetworkOrb({ size = 340, busy = false }: { size?: number; busy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr; c.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // points on a sphere (golden spiral, a little off it), each joined to its three nearest
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const N = 96;
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963, k = 0.86 + rnd() * 0.34;
      return [Math.cos(th) * r * k, y * k, Math.sin(th) * r * k];
    });
    const seen = new Set<string>();
    const edges: [number, number][] = [];
    pts.forEach((p, i) => {
      pts.map((q, j) => [j, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2])
        .filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3)
        .forEach(([j]) => { const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!seen.has(key)) { seen.add(key); edges.push([i, j]); } });
    });
    const R = size * 0.34, cx = size / 2, cy = size / 2, tilt = 0.42;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000, a = 0.6 + t * (busy ? 0.32 : 0.1), spin = t * 0.25;
      ctx.clearRect(0, 0, size, size);
      const haze = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.45);
      haze.addColorStop(0, "rgba(91,95,214,0.10)"); haze.addColorStop(0.7, "rgba(91,95,214,0.04)"); haze.addColorStop(1, "rgba(91,95,214,0)");
      ctx.fillStyle = haze; ctx.fillRect(0, 0, size, size);
      // the ring, brighter on the side the light turns to
      const ringR = R * 0.8, lx = Math.cos(spin) * ringR, ly = Math.sin(spin) * ringR;
      const light = ctx.createLinearGradient(cx + lx, cy + ly, cx - lx, cy - ly);
      light.addColorStop(0, "rgba(176,156,255,0.95)"); light.addColorStop(0.45, "rgba(124,108,240,0.4)"); light.addColorStop(1, "rgba(91,95,214,0.06)");
      ctx.save();
      ctx.shadowColor = "rgba(139,120,255,0.85)"; ctx.shadowBlur = 30; ctx.strokeStyle = light; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = light; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, ringR - 7, 0, Math.PI * 2); ctx.stroke();
      // the network: depth fades the back half
      const P = pts.map(([x, y, z]) => {
        const x1 = x * Math.cos(a) - z * Math.sin(a), z1 = x * Math.sin(a) + z * Math.cos(a);
        const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt), z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt), s = 3 / (3 - z2);
        return [cx + x1 * R * s, cy + y2 * R * s, (z2 + 1) / 2];
      });
      ctx.lineWidth = 0.8;
      for (const [i, j] of edges) {
        ctx.strokeStyle = `rgba(226,230,240,${0.04 + ((P[i][2] + P[j][2]) / 2) * 0.36})`;
        ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke();
      }
      for (const [x, y, d] of P) {
        ctx.fillStyle = `rgba(240,242,250,${0.22 + d * 0.72})`;
        ctx.beginPath(); ctx.arc(x, y, 0.9 + d * 1.7, 0, Math.PI * 2); ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, busy]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none max-w-[80vw]" style={{ width: size, aspectRatio: "1 / 1" }} />;
}

/** Whether the data is ready, in one line — the only thing a user may need to know before starting; the models and the
 *  rest are the firm's defaults, named in the tooltip. */
export function ConfigChips({ cfg, project, onEdit }: { cfg: FirmConfig | null; project: Project | null; onEdit?: () => void }) {
  if (!cfg) return null;
  const seats = seatsOf(cfg, project);
  const src = cfg.sumber;
  const models = cfg.kursi.map((s) => modelLabel(cfg, seats[s.kursi])).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px]">
      <span className={src.siap ? "text-[#7ee2c0]" : "text-[#ffb4b4]"} title={src.tipe.map((t) => `${t.tipe}: ${t.objek.toLocaleString("id-ID")} objects`).join("\n")}>
        {src.siap ? "✓ Data ready" : `✗ Data not ready: ${src.kurang.join(", ")}`}
      </span>
      <span className="text-[#8f99a8]" title={`Model: ${models}`}>Default AI models</span>
      {onEdit && <button onClick={onEdit} className="text-[#abb3bf] underline-offset-2 hover:text-white hover:underline">Edit name or focus</button>}
    </div>
  );
}

/** A project's own tab before its first review (or no project yet): the network, what the project covers, its
 *  settings, the button that starts a review. */
export function ProjectHome({ cfg, project, count, busy, running, onStart, onCreate, onEdit }: { cfg: FirmConfig | null; project: Project | null;
  count: number; busy: boolean; running: boolean; onStart: () => void; onCreate: () => void; onEdit?: () => void }) {
  return (
    <div className="flex min-h-[560px] flex-1 flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_38%,#262c3a_0%,#1a1e24_55%,#15181d_100%)] px-4 py-8">
      <NetworkOrb busy={busy || running} />
      {project ? (
        <>
          <p className="-mt-3 text-[10.5px] uppercase tracking-[0.2em] text-[#8f99a8]">AI Agent Swarm Project</p>
          <h2 className="mt-1 text-center text-[20px] font-semibold text-white">{project.nama}</h2>
          <p className="mt-1.5 line-clamp-3 max-w-[640px] text-center text-[12px] leading-relaxed text-[#abb3bf]">{project.brief}</p>
          {project.fokus && <p className="mt-1 max-w-[640px] text-center text-[11.5px] text-[#c9c0ff]">Focus: {project.fokus}</p>}
          <div className="mt-4"><ConfigChips cfg={cfg} project={project} onEdit={onEdit} /></div>
          <button disabled={busy || running || (cfg ? !cfg.sumber.siap : false)} onClick={onStart}
            title={running ? "one review is already running" : cfg && !cfg.sumber.siap ? `data source not ready: ${cfg.sumber.kurang.join(", ")}` : undefined}
            className="mt-6 flex items-center gap-2 rounded-md bg-[#5b5fd6] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_0_24px_rgba(91,95,214,0.45)] hover:bg-[#6a6ee0] disabled:opacity-40 disabled:shadow-none">
            <Icon name="play" className="h-3.5 w-3.5" />Start new review
          </button>
          <p className="mt-2 max-w-[520px] text-center text-[11px] text-[#8f99a8]">
            {count ? `${count} reviews in this project (list on the left). ` : "No reviews in this project yet. "}
            A disruption review's recovery plan arrives in the Decisions tab, and a planning review's chart in the Work plans tab. Nothing changes and nothing is sent until you approve it.
          </p>
        </>
      ) : (
        <>
          <h2 className="-mt-3 text-[20px] font-semibold text-white">No project yet</h2>
          <p className="mt-1.5 max-w-[520px] text-center text-[12px] leading-relaxed text-[#abb3bf]">
            Name a project, then start a review. Data, AI models and other settings are already set up.
          </p>
          <button onClick={onCreate} className="mt-6 flex items-center gap-2 rounded-md bg-[#5b5fd6] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_0_24px_rgba(91,95,214,0.45)] hover:bg-[#6a6ee0]">
            <Icon name="plus" className="h-3.5 w-3.5" />Create new project
          </button>
        </>
      )}
    </div>
  );
}

function Modal({ id, onClose, children }: { id: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby={id}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      {children}
    </div>
  );
}

/** A new project, or its name and focus changed: a name, an optional focus, the project scope folded away (the
 *  default brief); the models, parallel agents and cost limit stay the firm's defaults — a project made earlier
 *  keeps the ones it was saved with. */
export function ProjectFormDialog({ cfg, project, onSaved, onClose }: { cfg: FirmConfig | null; team?: Team | null; project?: Project | null;
  onSaved: (p: Project) => void; onClose: () => void }) {
  const [nama, setNama] = useState(project?.nama ?? "");
  const [brief, setBrief] = useState(project?.brief ?? cfg?.brief ?? "");
  const [fokus, setFokus] = useState(project?.fokus ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bad = nama.trim().length < 3 ? "Give the project a name (at least 3 characters)." : "";
  const save = async () => {
    setBusy(true); setErr("");
    const f: ProjectFields = { nama: nama.trim(), brief: brief.trim(), fokus: fokus.trim(), batas_usd: project?.batas_usd ?? null,
      paralel: project?.paralel ?? cfg?.paralel.default ?? 8, model: seatsOf(cfg, project) };
    try { onSaved(project ? await firm.updateProject(project.id, f) : await firm.createProject(f)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const label = "mt-3 block text-[11.5px] font-medium text-[#d3d8de]";
  return (
    <Modal id="proyek-judul" onClose={onClose}>
      <form className="w-full max-w-[560px] rounded-lg border border-white/10 bg-[#1c2127] p-5 shadow-2xl" onSubmit={(e) => { e.preventDefault(); if (!bad) save(); }}>
        <p id="proyek-judul" className="text-[15px] font-semibold text-white">{project ? `Edit project · ${project.nama}` : "New project"}</p>
        <label htmlFor="pr-nama" className={label}>Project name</label>
        <input id="pr-nama" autoFocus value={nama} onChange={(e) => setNama(e.target.value)} maxLength={120} placeholder="e.g. Riverside Tower — disruption" className={`${field} mt-1`} />
        <label htmlFor="pr-fokus" className={label}>Focus <span className="font-normal text-[#8f99a8]">(optional)</span></label>
        <input id="pr-fokus" value={fokus} onChange={(e) => setFokus(e.target.value)} maxLength={600} placeholder="e.g. Crane delay and concrete supply; access constraints" className={`${field} mt-1`} />
        <details className="mt-3">
          <summary className="cursor-pointer text-[11.5px] text-[#abb3bf] hover:text-white">Project scope <span className="text-[#8f99a8]">(default; edit if needed)</span></summary>
          <textarea id="pr-brief" aria-label="Project scope" value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} maxLength={4000} className={`${field} mt-1.5 resize-y leading-relaxed`} />
        </details>
        <div className="mt-3"><ConfigChips cfg={cfg} project={project ?? null} /></div>
        <div className="mt-5 flex items-center justify-end gap-2">
          {(bad && nama) || err ? <p className="mr-auto text-[11.5px] text-[#ffb4b4]">{err || bad}</p> : null}
          <button type="button" onClick={onClose} className="rounded-sm border border-white/15 px-3 py-1.5 text-[12px] text-[#d3d8de] hover:bg-white/10">Cancel</button>
          <button type="submit" disabled={busy || !!bad || !cfg} className="flex items-center gap-1 rounded-sm bg-[#5b5fd6] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#6a6ee0] disabled:opacity-40">
            <Icon name={project ? "save" : "plus"} className="h-3 w-3" />{busy ? "Saving…" : project ? "Save" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// starts offline unless the person picks the real models, so a stray click costs nothing
const DEFAULT_VERSION = "mock";

/** Before a project's review runs: a form, not a click that starts it — its name and focus, and whether real
 *  models answer or the offline script does; the rest is the project's configuration, shown,
 *  not asked again. */
export function StartForm({ cfg, project, count, agents, last, busy, err, onStart, onClose }: { cfg: FirmConfig | null; project: Project; count: number;
  agents?: number; last?: Rec; busy: boolean; err: string; onStart: (f: { nama: string; fokus: string; versi: string }) => void; onClose: () => void }) {
  const tampilBiaya = useTampilBiaya();
  const [nama, setNama] = useState(`${project.nama} · review ${count + 1}`);
  const [fokus, setFokus] = useState(project.fokus ?? "");
  const [versi, setVersi] = useState(DEFAULT_VERSION);
  const versions = Object.entries(cfg?.versi ?? { "1.0": { nama: "Swarm 1.0", ringkas: "AI Agent Swarm", tambahan: null } });
  const bad = nama.trim().length < 3 ? "Give the review a name (at least 3 characters)." : !cfg ? "Loading project configuration…"
    : !cfg.sumber.siap ? `Data source not ready: ${cfg.sumber.kurang.join(", ")}.` : "";
  const mins = last?.created_at && last?.finished_at ? Math.round((Date.parse(String(last.finished_at)) - Date.parse(String(last.created_at))) / 60000) : null;
  return (
    <Modal id="mulai-judul" onClose={onClose}>
      <form className="w-full max-w-[640px] rounded-lg border border-white/10 bg-[#1c2127] p-5 shadow-2xl"
        onSubmit={(e) => { e.preventDefault(); if (!bad) onStart({ nama: nama.trim(), fokus: fokus.trim(), versi }); }}>
        <p id="mulai-judul" className="text-[15px] font-semibold text-white">New disruption review · {project.nama}</p>
        <p className="mt-1 text-[11.5px] text-[#abb3bf]">
          {agents ? `${agents} agents read` : "The agents read"} the project's live records{mins ? ` for about ${mins} minutes` : ""}{tampilBiaya && last ? `; the last review cost ${usd(last.spent_usd)}` : ""}.
          Its recovery plan arrives in Decisions. Nothing changes and nothing is sent until you approve it.
        </p>
        <label htmlFor="pg-nama" className="mt-4 block text-[11.5px] font-medium text-[#d3d8de]">Review name</label>
        <input id="pg-nama" autoFocus value={nama} onChange={(e) => setNama(e.target.value)} maxLength={120} className={`${field} mt-1`} />
        <label htmlFor="pg-fokus" className="mt-3 block text-[11.5px] font-medium text-[#d3d8de]">Focus for this review <span className="font-normal text-[#8f99a8]">(optional; from the project)</span></label>
        <input id="pg-fokus" value={fokus} onChange={(e) => setFokus(e.target.value)} maxLength={600} placeholder="e.g. Crane delay and concrete supply; access constraints" className={`${field} mt-1`} />
        <p className="mt-3 text-[11.5px] font-medium text-[#d3d8de]" id="pg-versi">AI orchestration</p>
        <div role="radiogroup" aria-labelledby="pg-versi" className={`mt-1 grid gap-2 ${versions.length > 2 ? "grid-cols-3" : "grid-cols-2"}`}>
          {versions.map(([id, v]) => (
            <button key={id} type="button" role="radio" aria-checked={versi === id} onClick={() => setVersi(id)}
              className={`rounded border p-2 text-left ${versi === id ? "border-[#9d8cff] bg-[#9d8cff]/10" : "border-white/15 hover:bg-white/5"}`}>
              <span className="block text-[12.5px] font-semibold text-white">
                {v.nama}{id === DEFAULT_VERSION && <span className="ml-1 text-[10.5px] font-normal text-[#c9c0ff]">(Default)</span>}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-[#abb3bf]">{v.ringkas}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex"><ConfigChips cfg={cfg} project={project} /></div>
        {(bad && nama) || err ? <p className="mt-3 text-[11.5px] text-[#ffb4b4]">{err || bad}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm border border-white/15 px-3 py-1.5 text-[12px] text-[#d3d8de] hover:bg-white/10">Cancel</button>
          <button type="submit" disabled={busy || !!bad} className="flex items-center gap-1 rounded-sm bg-[#5b5fd6] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#6a6ee0] disabled:opacity-40">
            <Icon name="play" className="h-3 w-3" />{busy ? "Assembling firm…" : `Start: ${versions.find(([id]) => id === versi)?.[1].nama ?? ""}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
;
