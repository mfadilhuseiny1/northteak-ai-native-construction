"use client";
import { useEffect, useRef } from "react";

/* The agent swarm as a constellation that turns slowly: a dot for each agent that reads a package, the links between their work, and
   signals passing along them, inside a glowing rim. Drawn on a canvas, because three.js is large and loads only with the 3D tab. It holds
   still for anyone whose browser asks for less motion, and the browser pauses it while the tab is hidden. */

const AGENTS = ["Orchestrator", "Document controller", "Planning engineer", "Planners", "QA reviewer", "RFI coordinator", "Project director", "Equipment illustrator", "Translator"];
const ON_SPHERE = 132;
const AROUND = 26;  // loose dots outside the sphere, as a network reaches past its core
const SIGNALS = 14;

type Dot = { x: number; y: number; z: number; agent: string };
type Seen = { x: number; y: number; z: number };
type Signal = { link: number; t: number; speed: number; back: boolean };
/** Stand to the right of a column of content once the canvas is at least `from` wide: `room` is the column's width, after 6% of margin. */
export type Beside = { from: number; room: number };

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same constellation every time: dots spread evenly over a sphere, a few loose ones around it, each linked to its nearest. */
function build(): { dots: Dot[]; links: [number, number][] } {
  const rand = seeded(7);
  const dots: Dot[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const every = ON_SPHERE / AGENTS.length;
  for (let i = 0; i < ON_SPHERE; i++) {
    const y = 1 - (2 * (i + 0.5)) / ON_SPHERE;
    const ring = Math.sqrt(1 - y * y);
    const r = 1 + (rand() - 0.5) * 0.14;
    const k = Math.floor(i / every);
    dots.push({ x: Math.cos(i * golden) * ring * r, y: y * r, z: Math.sin(i * golden) * ring * r, agent: i === Math.floor((k + 0.5) * every) ? AGENTS[k] : "" });
  }
  for (let i = 0; i < AROUND; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const ring = Math.sqrt(1 - u * u);
    const r = 1.14 + rand() * 0.34;
    dots.push({ x: Math.cos(a) * ring * r, y: u * r, z: Math.sin(a) * ring * r, agent: "" });
  }
  const links = new Map<string, [number, number]>();
  dots.forEach((d, i) => {
    const near = dots.map((e, j): [number, number] => [j, (d.x - e.x) ** 2 + (d.y - e.y) ** 2 + (d.z - e.z) ** 2]).filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]);
    for (const [j, gap] of near.slice(0, i < ON_SPHERE ? 3 : 2)) if (gap < 0.36) links.set(`${Math.min(i, j)}-${Math.max(i, j)}`, [Math.min(i, j), Math.max(i, j)]);
  });
  return { dots, links: [...links.values()] };
}

export function Constellation({ beside, className = "" }: { beside?: Beside; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const from = beside?.from ?? 0;
  const room = beside?.room ?? 0;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { dots, links } = build();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const font = `500 11px ${getComputedStyle(canvas).fontFamily}`;
    const seen: Seen[] = dots.map(() => ({ x: 0, y: 0, z: 0 }));
    const signals: Signal[] = [];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let frame = 0;
    let last = 0;
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const near = (z: number) => Math.max(0, Math.min(1, (z + 1.2) / 2.4));
    const disc = (x: number, y: number, r: number) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    const draw = (t: number) => {
      const dt = Math.min(64, t - last || 16);
      last = t;
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      ctx.clearRect(0, 0, w, h);
      const free = from && w >= from ? w * 0.06 + room : 0;  // where the content column ends, when the sphere stands beside it
      const cx = free ? (free + w) / 2 : w / 2;
      const cy = h / 2;
      const R = Math.max(50, Math.min(h * 0.34, free ? (w - free) * 0.34 : w * 0.4));
      const breathe = 0.88 + 0.12 * Math.sin(t / 900);

      // a dark heart, a wide haze and the glowing rim
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, "rgba(8,11,17,0.55)");
      g.addColorStop(1, "rgba(8,11,17,0)");
      ctx.fillStyle = g;
      disc(cx, cy, R);
      ctx.globalCompositeOperation = "lighter";
      g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
      g.addColorStop(0, `rgba(128,131,232,${0.08 * breathe})`);
      g.addColorStop(1, "rgba(128,131,232,0)");
      ctx.fillStyle = g;
      disc(cx, cy, R * 2.1);
      g = ctx.createRadialGradient(cx, cy, R * 0.74, cx, cy, R * 1.3);
      g.addColorStop(0, "rgba(128,131,232,0)");
      g.addColorStop(0.36, `rgba(139,132,255,${0.5 * breathe})`);
      g.addColorStop(0.5, `rgba(128,131,232,${0.28 * breathe})`);
      g.addColorStop(1, "rgba(128,131,232,0)");
      ctx.fillStyle = g;
      disc(cx, cy, R * 1.3);
      ctx.globalCompositeOperation = "source-over";

      // turn the sphere, a little towards the pointer, and look at it from in front
      const a = t / 14000 + pointer.x * 0.5;
      const b = 0.42 + Math.sin(t / 9000) * 0.06 + pointer.y * 0.3;
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      dots.forEach((d, i) => {
        const x = d.x * ca + d.z * sa;
        const z1 = -d.x * sa + d.z * ca;
        const y = d.y * cb - z1 * sb;
        const z = d.y * sb + z1 * cb;
        const s = 3.4 / (3.4 - z);
        seen[i] = { x: cx + x * R * s, y: cy + y * R * s, z };
      });

      ctx.lineWidth = 0.8;
      for (const [i, j] of links) {
        const p = seen[i], q = seen[j];
        ctx.strokeStyle = `rgba(214,210,255,${0.05 + 0.3 * near((p.z + q.z) / 2)})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }

      // what the agents pass each other
      if (!still) {
        if (signals.length < SIGNALS && Math.random() < dt / 160) signals.push({ link: Math.floor(Math.random() * links.length), t: 0, speed: 0.0004 + Math.random() * 0.0006, back: Math.random() < 0.5 });
        ctx.shadowColor = "rgba(245,184,46,0.9)";
        ctx.shadowBlur = 8;
        for (let k = signals.length - 1; k >= 0; k--) {
          const sig = signals[k];
          sig.t += sig.speed * dt;
          if (sig.t >= 1) { signals.splice(k, 1); continue; }
          const [i, j] = links[sig.link];
          const p = seen[sig.back ? j : i], q = seen[sig.back ? i : j];
          ctx.fillStyle = `rgba(245,184,46,${Math.sin(Math.PI * sig.t) * (0.35 + 0.65 * near((p.z + q.z) / 2))})`;
          disc(p.x + (q.x - p.x) * sig.t, p.y + (q.y - p.y) * sig.t, 1.8);
        }
        ctx.shadowBlur = 0;
      }

      // the dots, far ones first, and the agents in amber
      for (const i of seen.map((_, n) => n).sort((m, n) => seen[m].z - seen[n].z)) {
        const p = seen[i], f = near(p.z);
        if (dots[i].agent) {
          ctx.fillStyle = `rgba(245,184,46,${0.35 + 0.65 * f})`;
          ctx.shadowColor = "rgba(245,184,46,0.8)";
          ctx.shadowBlur = 10 * f;
          disc(p.x, p.y, 2.2 + 1.6 * f);
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = `rgba(236,234,255,${0.25 + 0.7 * f})`;
          disc(p.x, p.y, 0.8 + 1.5 * f);
        }
      }

      // each agent's name, while it is on the near side, and only where nothing is written over the sphere
      ctx.font = font;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      dots.forEach((d, i) => {
        const p = seen[i];
        const alpha = Math.min(1, (p.z - 0.1) * 2.5);
        if (!free || !d.agent || alpha <= 0) return;
        ctx.strokeStyle = `rgba(17,24,32,${0.8 * alpha})`;
        ctx.fillStyle = `rgba(255,243,214,${0.92 * alpha})`;
        ctx.strokeText(d.agent, p.x + 8, p.y + 4);
        ctx.fillText(d.agent, p.x + 8, p.y + 4);
      });
      if (!still) frame = requestAnimationFrame(draw);
    };
    const moved = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 0.6;
      pointer.ty = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 0.6;
    };
    const watch = new ResizeObserver(() => { size(); if (still) draw(performance.now()); });
    watch.observe(canvas);
    size();
    draw(performance.now());
    if (!still) window.addEventListener("pointermove", moved);
    return () => { cancelAnimationFrame(frame); watch.disconnect(); window.removeEventListener("pointermove", moved); };
  }, [from, room]);
  return <canvas ref={ref} aria-hidden className={`pointer-events-none block h-full w-full ${className}`} />;
}
