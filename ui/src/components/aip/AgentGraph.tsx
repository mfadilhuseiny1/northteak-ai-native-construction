"use client";
import { useMemo, useRef, useState } from "react";
import { modelName, type Agent } from "./aipRun";

/* SiteSwarm as a network: the orchestrator in the centre, the domain leads on the inner ring, the project objects each one
   owns on the outer ring in its sector, the relations between objects as curved links, and the quality chain
   (writer → validator → project manager composer) beside it. Hover a node to see its neighbourhood; click an object to open it in
   Object Explorer; wheel to zoom, drag to pan, double-click to reset. Live (during a run): the domain leads at work glow, the
   delegations flow, the objects their tools touched light up. A domain lead that forms analysts (the impact engine:
   one per technique) carries them as satellites on an arc around it; the ones at work glow. The layout is
   deterministic: the same catalogue draws the same picture. */

export type ObjectLink = { id: string; name: string; source: string; target: string };
type Node = { id: string; kind: "orch" | "agent" | "type" | "res" | "chain" | "sub"; label: string; sub?: string; x: number; y: number; r: number;
  color: string; agent?: string; angle?: number; href?: string; info?: string; place?: string };
type Edge = { id: string; from: string; to: string; kind: "delegate" | "owns" | "link" | "chain" | "spawn"; color: string; label?: string };

export const AGENT_COLOR = ["#c23030", "#2d72d2", "#238551", "#d1980b", "#7961db", "#5f6b7c", "#0d8050"];
// the map's semantic order (api/aip/domains.py SEMANTIC): neighbours on the ring answer neighbouring questions
const PLACES = ["on site", "commercial", "controls", "other"];
const ORCH = "#f5b82e";
const RESOURCES = ["Dataset", "Pipeline", "Lineage", "Code"];

type Box = [number, number, number, number];
type Spot = { x: number; y: number; anchor: "start" | "middle" | "end"; rot?: number };
type Cand = { spot: Spot; boxes: Box[] };
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const textW = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.6 : 0.55);
const hBox = (x: number, top: number, w: number, h: number, anchor: Spot["anchor"]): Box => {
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return [x0, top, x0 + w, top + h];
};
const nodeLive = (n: Node, active?: Set<string>, touched?: Set<string>) => {
  if (n.kind === "agent" || n.kind === "sub") return !!active?.has(n.agent!);
  if (n.kind === "orch") return !!active?.has("orchestrator");
  if (n.kind === "chain") return !!active?.has(n.id.slice(6));
  return !!touched?.has(n.id.replace(/^type:/, ""));
};

export function AgentGraph({ agents, roles, links = [], active, touched, compact = false, rules }: {
  agents: Agent[]; roles: Record<string, string>; links?: ObjectLink[]; active?: Set<string>; touched?: Set<string>; compact?: boolean;
  rules?: string;  // the planner's tuned rules version (aip/skills.py "rules"), when an admin switched one on
}) {
  const W = compact ? 980 : 1200, H = compact ? 500 : 780;
  const { nodes, edges } = useMemo(() => {
    const cx = compact ? W / 2 : W / 2 - 70, cy = H / 2;
    const R1 = compact ? 125 : 180, R2 = compact ? 210 : 320;
    const nodes: Node[] = [{ id: "orch", kind: "orch", label: "Orchestrator", sub: modelName(roles.planner), x: cx, y: cy, r: compact ? 30 : 36, color: ORCH,
      info: `Plans, assigns tasks to the domain leads that own each object, then reviews the results. Plan rules: ${rules ?? "default (code)"} — a GEPA-tuned version is used only after an admin enables it.` }];
    const edges: Edge[] = [];
    const ordered = [...agents].sort((x, y) => PLACES.indexOf(x.peta ?? "other") - PLACES.indexOf(y.peta ?? "other"));
    // each agent's sector grows with the objects it owns, and the ring turns so the crowded sectors sit left and right,
    // where horizontal labels stack; at the top and bottom they would run into each other
    const owns = (a: Agent) => a.object_types.length || RESOURCES.length;
    const weights = ordered.map((a) => Math.max(4, owns(a)));
    const total = weights.reduce((s, w) => s + w, 0) || 1;
    const spans = weights.map((w) => (360 * w) / total);
    const ring = (off: number) => {
      let at = off;
      return ordered.map((a, i) => {
        const deg = at + spans[i] / 2;
        at += spans[i];
        const k = owns(a), step = Math.min((spans[i] * 0.86) / Math.max(k, 1), 15);
        return { deg, objs: Array.from({ length: k }, (_, j) => deg + (j - (k - 1) / 2) * step) };
      });
    };
    const base = -90 - (spans[0] ?? 0) / 2;
    let off = base, best = Infinity;
    for (let o = 0; o < 360; o += 3) {
      const cand = base + o;
      const cost = ring(cand).reduce((s, r) => s + r.objs.reduce((t, d) => t + Math.sin((d * Math.PI) / 180) ** 2, 0), 0);
      if (cost < best - 1e-6) { best = cost; off = cand; }
    }
    const placed = ring(off);
    ordered.forEach((a, i) => {
      const deg = placed[i].deg;
      const rad = (deg * Math.PI) / 180;
      const color = AGENT_COLOR[agents.indexOf(a) % AGENT_COLOR.length];
      const id = `agent:${a.key}`;
      const ax = cx + R1 * Math.cos(rad), ay = cy + R1 * Math.sin(rad);
      nodes.push({ id, kind: "agent", label: a.name,
        sub: `${modelName(a.model)} · ${a.tools.length} tool${a.tools.length === 1 ? "" : "s"}${a.subagents?.length ? ` · ${a.subagents.length} ${a.subagents[0]?.family === "firm" ? "firm lines" : "sub-agents"}` : ""}`, x: ax,
        y: ay, r: compact ? 17 : 21, color, agent: a.key, angle: deg, place: a.peta,
        info: `${a.menjawab ? `Answers: ${a.menjawab} — ` : ""}${a.description}` });
      edges.push({ id: `d-${a.key}`, from: "orch", to: id, kind: "delegate", color });
      // sub-agents on an arc over the agent (the label sits below it): spokes from the agent, one satellite each
      const subs = a.subagents ?? [];
      const orbit = compact ? 34 : 46;
      subs.forEach((s, j) => {
        const sa = ((-200 + (subs.length > 1 ? (220 * j) / (subs.length - 1) : 110)) * Math.PI) / 180;
        nodes.push({ id: `sub:${s.key}`, kind: "sub", label: s.technique, sub: s.family, x: ax + orbit * Math.cos(sa), y: ay + orbit * Math.sin(sa),
          r: compact ? 4 : 5, color, agent: s.key, angle: (sa * 180) / Math.PI,
          info: s.family === "firm"
            ? `${s.name}: SiteSwarm firm line (orchestrator, domain lead, analyst) that flags signals and fills the risk register. ${s.research?.[0] ?? ""}`
            : s.family === "analyst"
            ? `${s.name}: analyst formed for this question, scope ${s.technique}; uses the tools and permissions of ${a.name}.`
            : `${s.name}: sub-agent formed by ${a.name} to test ${s.technique} on the same fold as the other techniques.`
              + (s.research?.length ? ` Research: ${s.research.join("; ")}.` : "") });
        edges.push({ id: `s-${s.key}`, from: id, to: `sub:${s.key}`, kind: "spawn", color });
      });
      const owned = a.object_types.length ? a.object_types.map((t) => ({ id: `type:${t.id}`, label: t.name, info: t.description,
        href: `/object-explorer?type=${t.id}`, size: t.properties.length, kind: "type" as const }))
        : RESOURCES.map((r) => ({ id: `res:${a.key}:${r}`, label: r, info: `Platform resource read by ${a.name}`, href: undefined, size: 8, kind: "res" as const }));
      owned.forEach((t, j) => {
        const td = placed[i].objs[j];
        const tr = (td * Math.PI) / 180;
        nodes.push({ id: t.id, kind: t.kind, label: t.label, x: cx + R2 * Math.cos(tr), y: cy + R2 * Math.sin(tr), r: t.kind === "res" ? 6 : 6 + Math.min(6, t.size / 8),
          color, agent: a.key, angle: td, href: t.href, info: t.info });
        edges.push({ id: `o-${t.id}`, from: id, to: t.id, kind: "owns", color });
      });
    });
    const known = new Set(nodes.map((x) => x.id));
    links.forEach((l) => {
      if (known.has(`type:${l.source}`) && known.has(`type:${l.target}`) && l.source !== l.target)
        edges.push({ id: `l-${l.id}`, from: `type:${l.source}`, to: `type:${l.target}`, kind: "link", color: "#8f99a8", label: l.name });
    });
    if (!compact) {
      const x = W - 105;
      // the quality path after the orchestrator writes (it plans and writes: one domain lead): code first, then a validator of another family
      const chain = [["scrutiny", "Validator scrutiny", "code", "Code check before the validator: [rN] references exist, every task has evidence, plan coverage is answered, numbers are sourced."],
        ["validator", "Validator", roles.validator, "Another model family; reviews the validation contract and rechecks every number against the data with its own tools."],
        ["ui", "Project manager decides", roles.ui, "Chooses visuals tied to the run results."]] as const;
      chain.forEach(([k, label, model, info], i) => {
        nodes.push({ id: `chain:${k}`, kind: "chain", label, sub: k === "scrutiny" ? "code (deterministic)" : modelName(model), x, y: cy - 150 + i * 150, r: 15,
          color: k === "validator" ? "#f0b14c" : k === "scrutiny" ? "#e5689b" : "#5f6b7c", info });
        if (i) edges.push({ id: `c-${k}`, from: `chain:${chain[i - 1][0]}`, to: `chain:${k}`, kind: "chain", color: "#5f6b7c" });
      });
      edges.push({ id: "c-orch", from: "orch", to: "chain:scrutiny", kind: "chain", color: "#5f6b7c" });
    }
    return { nodes, edges };
  }, [agents, roles, links, compact, H, W, rules]);

  const byId = useMemo(() => new Map(nodes.map((x) => [x.id, x])), [nodes]);
  const [hover, setHover] = useState<string | null>(null);
  const near = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    edges.forEach((e) => { if (e.from === hover) s.add(e.to); if (e.to === hover) s.add(e.from); });
    return s;
  }, [hover, edges]);

  // pan and zoom: the viewBox
  const [view, setView] = useState({ x: 0, y: 0, w: W, h: H });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; n: Node; maxX: number } | null>(null);

  const live = (id: string) => {
    const n = byId.get(id);
    return n ? nodeLive(n, active, touched) : false;
  };

  // labels placed greedily, most important first: each takes the first candidate spot that clears the labels already
  // placed, every node and the frame; an optional label with no room stays hidden until its node is hovered
  const labels = useMemo(() => {
    const taken: Box[] = [];
    const dots = nodes.map((n) => ({ id: n.id, b: [n.x - n.r - 2, n.y - n.r - 2, n.x + n.r + 2, n.y + n.r + 2] as Box }));
    const clear = (c: Cand, own: string) => c.boxes.every((b) => b[0] >= 2 && b[1] >= 2 && b[2] <= W - 2 && b[3] <= H - 2
      && !taken.some((t) => hit(t, b)) && !dots.some((d) => d.id !== own && hit(d.b, b)));
    const shown = new Map<string, Spot>(), fallback = new Map<string, Spot>(), boxOf = new Map<string, Box>();
    const put = (key: string, own: string, cands: Cand[], must: boolean) => {
      if (!cands.length) return;
      fallback.set(key, cands[0].spot);
      const c = cands.find((x) => clear(x, own)) ?? (must ? cands[0] : undefined);
      if (!c) return;
      shown.set(key, c.spot);
      taken.push(...c.boxes);
      boxOf.set(key, c.boxes.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] as Box));
    };
    const outward = (n: Node) => n.angle === undefined || Math.cos((n.angle * Math.PI) / 180) >= -0.1;
    // the name (and model line) of the orchestrator, an agent or a chain step: below, above, above its satellites, beside
    const block = (n: Node) => {
      const big = n.kind === "orch" ? 13 : 12;
      const w = Math.max(textW(n.label, big, true), n.sub ? textW(n.sub, 10) : 0), h = n.sub ? 28 : 15;
      const at = (top: number, x: number, anchor: Spot["anchor"]): Cand => ({ spot: { x, y: top + 11, anchor }, boxes: [hBox(x, top, w, h, anchor)] });
      const side = outward(n);
      const cands = [at(n.y + n.r + 4, n.x, "middle")];
      if (n.kind !== "orch") cands.push(at(n.y - n.r - 4 - h, n.x, "middle"), at(n.y - (compact ? 34 : 46) - 9 - h, n.x, "middle"),
        at(n.y - h / 2, n.x + (side ? n.r + 6 : -(n.r + 6)), side ? "start" : "end"));
      put(n.id, n.id, cands, true);
    };
    // an object or resource: beside it on the outer side, along its spoke, then beside it on the inner side
    const tag = (n: Node, bold: boolean) => {
      const size = 10.5, w = textW(n.label, size, bold), side = outward(n);
      const beside = (right: boolean): Cand => ({ spot: { x: n.x + (right ? n.r + 6 : -(n.r + 6)), y: n.y + 3.5, anchor: right ? "start" : "end" },
        boxes: [hBox(n.x + (right ? n.r + 6 : -(n.r + 6)), n.y - 6, w, 12, right ? "start" : "end")] });
      const cands = [beside(side)];
      if (n.angle !== undefined) {
        const rad = (n.angle * Math.PI) / 180, dx = Math.cos(rad), dy = Math.sin(rad);
        const px = n.x + (n.r + 5) * dx, py = n.y + (n.r + 5) * dy;
        const boxes: Box[] = [];
        for (let k = 3; k < w; k += 6) boxes.push([px + k * dx - 4.5, py + k * dy - 4.5, px + k * dx + 4.5, py + k * dy + 4.5]);
        cands.push({ spot: { x: px, y: py, anchor: side ? "start" : "end", rot: side ? n.angle : n.angle + 180 }, boxes });
      }
      cands.push(beside(!side));
      put(n.id, n.id, cands, bold);
    };
    const place = (n: Node) => {
      if (!n.place) return;
      const w = n.place.length * (9 * 0.62 + 1.2), b = boxOf.get(n.id);
      const at = (top: number, cx: number): Cand => ({ spot: { x: cx, y: top + 9, anchor: "middle" }, boxes: [hBox(cx, top, w, 11, "middle")] });
      const cands: Cand[] = [];
      if (b) cands.push(at(b[1] - 12, (b[0] + b[2]) / 2), at(b[3] + 1, (b[0] + b[2]) / 2));
      cands.push(at(n.y - n.r - 4 - 11, n.x), at(n.y - (compact ? 34 : 46) - 9 - 11, n.x));
      put(`place:${n.id}`, n.id, cands, false);
    };
    const isLive = (n: Node) => nodeLive(n, active, touched);
    const of = (k: Node["kind"]) => nodes.filter((n) => n.kind === k);
    [...of("orch"), ...of("agent"), ...of("chain")].forEach(block);
    const tags = [...of("type"), ...of("res")];
    tags.filter(isLive).forEach((n) => tag(n, true));
    of("sub").filter(isLive).forEach((n) => put(n.id, n.id, [-1, 1].map((s) => {
      const w = textW(n.label, 9.5, true), top = s < 0 ? n.y - n.r - 15 : n.y + n.r + 3;
      return { spot: { x: n.x, y: top + 9, anchor: "middle" as const }, boxes: [hBox(n.x, top, w, 11, "middle")] };
    }), true));
    of("agent").forEach(place);
    tags.filter((n) => !isLive(n)).forEach((n) => tag(n, false));
    return { shown, fallback };
  }, [nodes, active, touched, compact, W, H]);
  const spotFor = (key: string, hovered: boolean) => labels.shown.get(key) ?? (hovered ? labels.fallback.get(key) : undefined);
  const dim = (id: string) => near ? !near.has(id) : false;
  const curve = (a: Node, b: Node, kind: Edge["kind"]) => {
    if (kind !== "link") return `M${a.x},${a.y} L${b.x},${b.y}`;
    const cx = byId.get("orch")!.x, cy = byId.get("orch")!.y;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return `M${a.x},${a.y} Q${cx + (mx - cx) * 0.45},${cy + (my - cy) * 0.45} ${b.x},${b.y}`;
  };

  return (
    <div ref={wrap} className="relative h-full w-full select-none" onPointerLeave={() => { setHover(null); setTip(null); }}>
      <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-full w-full touch-none" role="img" aria-label="SiteSwarm agent network"
        onWheel={(e) => {
          const r = svg.current!.getBoundingClientRect();
          const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
          const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
          setView((v) => {
            const w = Math.min(W * 2, Math.max(W / 4, v.w * k)), h = (w * H) / W;
            return { x: v.x + (v.w - w) * fx, y: v.y + (v.h - h) * fy, w, h };
          });
        }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.buttons !== 1) return;
          const r = svg.current!.getBoundingClientRect();
          const s = view.w / r.width;
          // read the drag now: the updater runs later, after pointer-up may have cleared it
          const x = d.vx - (e.clientX - d.x) * s, y = d.vy - (e.clientY - d.y) * s;
          setView((v) => ({ ...v, x, y }));
        }}
        onPointerUp={() => { drag.current = null; }} onDoubleClick={() => setView({ x: 0, y: 0, w: W, h: H })}>
        <defs>
          <radialGradient id="aip-orch" cx="50%" cy="40%" r="65%"><stop offset="0%" stopColor="#c9c0ff" /><stop offset="100%" stopColor="#5b4fc7" /></radialGradient>
          <style>{`@keyframes aipflow { to { stroke-dashoffset: -24 } } .aip-flow { stroke-dasharray: 6 6; animation: aipflow 0.9s linear infinite }
            @keyframes aippulse { 0%,100% { opacity: .15 } 50% { opacity: .55 } } .aip-pulse { animation: aippulse 1.4s ease-in-out infinite }`}</style>
        </defs>
        {/* rings */}
        <circle cx={byId.get("orch")!.x} cy={byId.get("orch")!.y} r={compact ? 125 : 180} fill="none" stroke="#2c333b" strokeWidth={1} />
        <circle cx={byId.get("orch")!.x} cy={byId.get("orch")!.y} r={compact ? 210 : 320} fill="none" stroke="#2c333b" strokeWidth={1} />
        {/* edges: object relations under the ownership and delegation lines */}
        {(["link", "owns", "chain", "spawn", "delegate"] as const).map((kind) => edges.filter((e) => e.kind === kind).map((e) => {
          const a = byId.get(e.from)!, b = byId.get(e.to)!;
          const on = near ? near.has(e.from) && near.has(e.to) : false;
          const flowing = (e.kind === "delegate" || e.kind === "spawn") && live(e.to);
          return (
            <path key={e.id} d={curve(a, b, e.kind)} fill="none" className={flowing ? "aip-flow" : undefined}
              stroke={e.kind === "link" ? (on ? "#c5cbd3" : "#8f99a8") : e.color} strokeWidth={e.kind === "delegate" ? (flowing ? 2.5 : 1.6) : on ? 1.6 : 1}
              strokeOpacity={near && !on ? 0.08 : e.kind === "link" ? (on ? 0.9 : 0.22) : e.kind === "owns" ? 0.55 : e.kind === "spawn" ? (flowing ? 0.95 : 0.5) : 0.8}>
              {e.label && <title>{e.label}</title>}
            </path>
          );
        }))}
        {/* nodes */}
        {nodes.map((n) => {
          const isLive = live(n.id);
          const faded = dim(n.id);
          const spot = spotFor(n.id, hover === n.id);
          const placeSpot = n.place ? spotFor(`place:${n.id}`, hover === n.id) : undefined;
          return (
            <g key={n.id} opacity={faded ? 0.25 : 1} className={n.href ? "cursor-pointer" : "cursor-default"}
              onPointerEnter={(e) => {
                setHover(n.id);
                const r = wrap.current!.getBoundingClientRect();
                setTip({ x: e.clientX - r.left, y: e.clientY - r.top, n, maxX: r.width - 310 });
              }}
              onPointerLeave={() => { setHover(null); setTip(null); }}
              onClick={() => { if (n.href) window.open(n.href, "_blank", "noopener"); }}>
              {isLive && <circle cx={n.x} cy={n.y} r={n.r + 9} fill={n.color} className="aip-pulse" />}
              {n.kind === "orch" && <circle cx={n.x} cy={n.y} r={n.r + 8} fill={ORCH} fillOpacity={0.12} />}
              {n.kind === "res" ? (
                <rect x={n.x - n.r} y={n.y - n.r} width={n.r * 2} height={n.r * 2} rx={2} fill={n.color} fillOpacity={0.7} stroke="#1c2733" strokeWidth={2} />
              ) : (
                <circle cx={n.x} cy={n.y} r={n.r} fill={n.kind === "orch" ? "url(#aip-orch)" : n.color}
                  fillOpacity={n.kind === "type" ? (isLive ? 1 : 0.75) : 1} stroke={isLive ? "#f6f7f9" : "#1c2733"} strokeWidth={isLive ? 2 : 2} />
              )}
              {n.kind === "orch" && <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight={600} fill="#fff">SS</text>}
              {n.kind === "agent" && placeSpot && (
                <text x={placeSpot.x} y={placeSpot.y} textAnchor="middle" fontSize="9" letterSpacing="1.2" fill={n.color} stroke="#1c2733" strokeWidth={3}
                  paintOrder="stroke" style={{ textTransform: "uppercase" }}>{n.place}</text>
              )}
              {!spot ? null : n.kind === "agent" || n.kind === "orch" || n.kind === "chain" ? (
                <>
                  <text x={spot.x} y={spot.y} textAnchor={spot.anchor} fontSize={n.kind === "orch" ? 13 : 12} fontWeight={600} fill="#f6f7f9" stroke="#1c2733" strokeWidth={3} paintOrder="stroke">{n.label}</text>
                  {n.sub && <text x={spot.x} y={spot.y + 14} textAnchor={spot.anchor} fontSize="10" fill="#8f99a8" stroke="#1c2733" strokeWidth={3} paintOrder="stroke">{n.sub}</text>}
                </>
              ) : n.kind === "sub" ? (
                <text x={spot.x} y={spot.y} textAnchor="middle" fontSize="9.5" fill="#f6f7f9" fontWeight={600}
                  stroke="#1c2733" strokeWidth={3} paintOrder="stroke">{n.label}</text>
              ) : (
                <text x={spot.x} y={spot.y} textAnchor={spot.anchor} fontSize="10.5" dy={spot.rot !== undefined ? 3.5 : undefined}
                  transform={spot.rot !== undefined ? `rotate(${spot.rot} ${spot.x} ${spot.y})` : undefined}
                  fill={isLive || hover === n.id ? "#f6f7f9" : "#c5cbd3"} fontWeight={isLive ? 600 : 400} stroke="#1c2733" strokeWidth={3} paintOrder="stroke">{n.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute z-20 max-w-[300px] rounded-md border border-white/10 bg-[#151e28]/95 px-3 py-2 text-[11px] shadow-xl"
          style={{ left: Math.max(4, Math.min(tip.x + 14, tip.maxX)), top: tip.y + 14 }}>
          <p className="flex items-center gap-1.5 font-semibold text-white"><span className="h-2 w-2 rounded-full" style={{ background: tip.n.color }} />{tip.n.label}</p>
          {tip.n.sub && <p className="text-[10.5px] text-[#8f99a8]">{tip.n.sub}</p>}
          {tip.n.info && <p className="mt-1 leading-snug text-[#c5cbd3]">{tip.n.info.slice(0, 260)}</p>}
          {tip.n.kind === "type" && <p className="mt-1 text-[10.5px] text-[#8abbff]">Click to open in Object Explorer</p>}
        </div>
      )}
      {!compact && (
        <div className="pointer-events-none absolute left-3 top-2 w-[290px] rounded-md border border-white/10 bg-[#151e28]/85 p-2.5 text-[10.5px]">
          <p className="mb-1 font-semibold text-[#e5e8eb]">Who answers what</p>
          {PLACES.filter((p) => agents.some((a) => (a.peta ?? "other") === p)).map((p) => (
            <div key={p} className="mb-1">
              <p className="uppercase tracking-wider text-[#6b7480]">{p}</p>
              {agents.filter((a) => (a.peta ?? "other") === p).map((a) => (
                <p key={a.key} className="flex gap-1.5 leading-snug"><span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: AGENT_COLOR[agents.indexOf(a) % AGENT_COLOR.length] }} />
                  <span><b className="text-[#d3d8de]">{a.name.replace("Agent ", "")}</b> <span className="text-[#8f99a8]">{a.menjawab}</span></span></p>
              ))}
            </div>
          ))}
        </div>
      )}
      {!compact && (
        <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[#abb3bf]">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: ORCH }} />Orchestrator: splits the question · plan rules {rules ?? "default (code)"}</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#2d72d2]" />delegates to the domain lead that owns the object</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2d72d2]/75" />project object held by a domain lead (only that lead reads it)</span>
          <span className="flex items-center gap-1.5"><span className="h-px w-4 bg-[#8f99a8]" />relation between objects</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#d1980b]" />satellite: an analyst under its domain lead</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#f0b14c]" />quality path: orchestrator writes → scrutiny (code) → validator (another family, reviews the validation contract) → project manager</span>
          <span className="text-[#8f99a8]">Wheel: zoom · drag: pan · double-click: reset</span>
        </div>
      )}
    </div>
  );
}
