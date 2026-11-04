"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Bar, Loading, NotYet, Pill, Problem, quiet, useData, type Rec } from "./kit";
import { buildScene, type Marker, type Model, type Scene } from "./Model3DScene";

/* The digital twin: the finished building and the sensors a smart building puts in it. Which systems are there comes from the project's own MEP
   scope; what clients often add is shown apart as an add-on. A device's readings are live once the building's systems send them; until then they
   are simulated, and the screen says so on every figure. */

const GLYPH: Record<string, string> = { fire: "F", hvac: "H", cctv: "C", energy: "E", water: "W", lift: "L", lighting: "O", access: "K", structure: "S" };
const LABEL: Record<string, string> = { alarm: "Alarm", flow: "Water flow", temperature: "Temperature", humidity: "Humidity", co2: "CO₂", online: "Online", people: "People in view", power: "Power", generation: "Generation", level: "Level", running: "Running", pressure: "Pressure", ph: "pH", trips: "Trips today", fault: "Fault", occupancy: "Occupancy", lux: "Light", entries: "Entries today", vibration: "Vibration", tilt: "Tilt" };
const YES_NO = new Set(["alarm", "flow", "online", "running", "fault"]);

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; };

/** A reading: the building's own if it has sent one, else a simulated one that moves with time, inside the metric's normal range. */
function read(d: Rec, metric: string, t: number, metrics: Rec, real: Rec): { value: number; live: boolean; at?: string } {
  const sent = real[d.id]?.[metric];
  if (sent) return { value: sent.value, live: true, at: sent.at };
  const [lo, hi] = metrics[metric].normal as [number, number], r = hash(`${d.id}:${metric}`);
  if (metric === "online") return { value: r < 0.04 ? 0 : 1, live: false };  // a few cameras offline, as there always are
  if (YES_NO.has(metric)) return { value: metric === "running" ? (Math.sin(t / 40 + r * 9) > 0 ? 1 : 0) : 0, live: false };
  let v = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(t / (30 + r * 60) + r * 12));
  if (metric === "co2" && r > 0.97) v = 1050 + 120 * Math.max(0, Math.sin(t / 25));  // one meeting room running out of fresh air, to show how an alert reads
  return { value: Math.round(v * 100) / 100, live: false };
}

export function DigitalTwinModule() {
  const model = useData<Model & Rec>("/api/project/model-3d");
  const twin = useData("/api/project/twin");
  const holder = useRef<HTMLDivElement>(null);
  const view = useRef<Scene | null>(null);
  const [t, setT] = useState(() => Date.now() / 1000);
  const [layers, setLayers] = useState<Set<string> | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { const k = window.setInterval(() => setT(Date.now() / 1000), 2000); return () => window.clearInterval(k); }, []);

  const data = twin.data, devices = useMemo(() => ((data?.devices ?? []) as Rec[]), [data]), systems = (data?.systems ?? []) as Rec[];
  const on = layers ?? new Set(systems.filter((s) => s.in_scope).map((s) => s.key as string));
  const color = Object.fromEntries(systems.map((s) => [s.key, s.color])) as Record<string, string>;
  const metrics = (data?.metrics ?? {}) as Rec, real = (data?.readings ?? {}) as Rec;
  const values = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, Object.fromEntries((d.metrics as string[]).map((m) => [m, read(d, m, t, metrics, real)]))])), [devices, t, metrics, real]);
  const alertOf = (d: Rec) => (d.metrics as string[]).filter((m) => { const a = metrics[m]?.alert; const v = values[d.id]?.[m]?.value; return (a != null && v >= a) || (m === "online" && v === 0); });
  const shown = devices.filter((d) => on.has(d.system));
  const alerts = shown.filter((d) => alertOf(d).length);
  const liveCount = Object.keys(real).length;

  useEffect(() => {  // the finished building, drawn once the model is in
    if (!model.data || !holder.current || view.current || !(model.data.elements as unknown[])?.length) return;
    const v = buildScene(model.data as Model, holder.current, (ids) => { const id = ids?.find((x) => x.startsWith("marker:")); if (id) setSel(id.slice(7)); });
    v.update((model.data as Model).days, false);
    view.current = v;
    return () => { v.dispose(); view.current = null; };
  }, [model.data]);

  useEffect(() => {
    view.current?.markers(shown.map((d): Marker => ({ id: d.id, x: d.x, y: d.y, z: d.z, color: color[d.system] ?? "#8f99a8", glyph: GLYPH[d.system] ?? "?", alert: alertOf(d).length > 0, dim: !!floor && d.floor !== floor })));
  }, [shown.length, floor, alerts.map((d) => d.id).join(","), view.current]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!model.data || !data) return <div className="flex-1"><Problem err={model.err || twin.err} />{!model.err && !twin.err && <Loading />}</div>;
  if (!devices.length) return <div className="flex-1 bg-[#111820] p-6"><NotYet>{data.note ?? "No building to place sensors in yet."}</NotYet></div>;
  const pick = (d: Rec) => { setSel(d.id); view.current?.look({ x: d.x, y: d.y, z: d.z }); };
  const chosen = devices.find((d) => d.id === sel);
  const toggle = (key: string) => { const next = new Set(on); if (next.has(key)) next.delete(key); else next.add(key); setLayers(next); };
  const stat = (key: string): string => {
    const mine = shown.filter((d) => d.system === key), avg = (m: string) => { const xs = mine.filter((d) => values[d.id][m]).map((d) => values[d.id][m].value); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; };
    const sum = (m: string) => mine.filter((d) => values[d.id][m]).reduce((n, d) => n + values[d.id][m].value, 0);
    if (key === "fire") return `${mine.filter((d) => values[d.id].alarm?.value).length} alarms · ${mine.length} devices`;
    if (key === "hvac") return `${avg("temperature").toFixed(1)}°C · ${avg("humidity").toFixed(0)}% · CO₂ up to ${Math.round(Math.max(0, ...mine.filter((d) => values[d.id].co2).map((d) => values[d.id].co2.value)))} ppm`;
    if (key === "cctv") return `${mine.filter((d) => values[d.id].online?.value).length} of ${mine.length} online · ${Math.round(sum("people"))} people in view`;
    if (key === "energy") return `${sum("power").toFixed(0)} kW drawn${mine.some((d) => d.kind === "solar") ? ` · ${sum("generation").toFixed(0)} kW solar` : ""}`;
    if (key === "water") return `tanks ${avg("level").toFixed(0)}% · pH ${avg("ph").toFixed(1)}`;
    if (key === "lift") return `${Math.round(sum("trips"))} trips today`;
    if (key === "lighting") return `${avg("occupancy").toFixed(0)}% occupied`;
    if (key === "access") return `${Math.round(sum("entries"))} entries today`;
    if (key === "structure") return `vibration up to ${Math.max(0, ...mine.filter((d) => values[d.id].vibration).map((d) => values[d.id].vibration.value)).toFixed(2)} mm/s`;
    return `${mine.length} devices`;
  };
  const floors = (data.floors as Rec[]).filter((f) => shown.some((d) => d.floor === f.name)).reverse();
  const found = query.trim() ? shown.filter((d) => `${d.id} ${d.name} ${d.floor}`.toLowerCase().includes(query.toLowerCase())) : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-[12px]">
      <Bar title="Digital twin" note={`the finished building, ${data.area} m² a floor, with the sensors a smart building puts in it`}>
        {liveCount ? <Pill tone="ok">live from {liveCount} devices</Pill> : <Pill tone="warn">simulated readings</Pill>}
        <button onClick={() => setConnect(!connect)} className={`${quiet} flex items-center gap-1.5`}><Icon name="plug" className="h-3.5 w-3.5" />Connect the building</button>
      </Bar>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-black/40 bg-[#151e28] px-4 py-2">
        {systems.map((s) => (
          <button key={s.key} onClick={() => toggle(s.key)} aria-pressed={on.has(s.key)} title={typeof s.why === "string" ? `Add-on: ${s.why}` : `In the scope: ${(s.why as string[]).join("; ")}`}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition ${on.has(s.key) ? "border-white/25 bg-white/[.08] text-white" : "border-white/10 text-[#8f99a8] hover:text-white"} ${s.in_scope ? "" : "border-dashed"}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color, opacity: on.has(s.key) ? 1 : 0.4 }} />{s.name}<b className="tabular-nums">{s.devices}</b>{!s.in_scope && <span className="text-[10px] text-[#8f99a8]">add-on</span>}
          </button>
        ))}
      </div>
      {connect && (
        <div className="shrink-0 space-y-1.5 border-b border-black/40 bg-[#0f151c] px-4 py-3 text-[11.5px] text-[#d3d8de]">
          <p className="font-semibold text-white">How the building&apos;s systems send their readings</p>
          <p>A building management system, an IoT gateway or a script posts readings here; from then on that device shows live. Each device has its own MQTT topic too, for a broker that forwards them.</p>
          <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-[#9cc7f5]">{`POST /api/project/twin/readings\n[{ "device": "${devices[0].id}", "metric": "${(devices[0].metrics as string[])[0]}", "value": 0, "at": "2026-11-04T10:00:00" }]\n\nMQTT topic: ${devices[0].topic}/<metric>`}</pre>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-[290px] shrink-0 space-y-2 overflow-y-auto border-r border-black/40 bg-[#111820] p-3 max-lg:hidden">
          <div className={`rounded-lg border p-2.5 ${alerts.length ? "border-[#e5484d]/50 bg-[#e5484d]/10" : "border-white/10 bg-[#1c2733]"}`}>
            <p className="flex items-center gap-1.5 font-semibold text-white"><Icon name="bell" className="h-3.5 w-3.5" />Alerts<span className="ml-auto tabular-nums">{alerts.length}</span></p>
            {!alerts.length && <p className="mt-1 text-[11px] text-[#8f99a8]">Nothing out of range.</p>}
            {alerts.slice(0, 6).map((d) => <button key={d.id} onClick={() => pick(d)} className="mt-1 block w-full rounded px-1.5 py-1 text-left text-[11px] hover:bg-white/[.06]"><span className="text-[#ffb4b4]">{alertOf(d).map((m) => (m === "online" ? "offline" : LABEL[m])).join(", ")}</span><span className="block text-[#d3d8de]">{d.name} · {d.floor}</span></button>)}
          </div>
          {systems.filter((s) => on.has(s.key)).map((s) => (
            <div key={s.key} className="rounded-lg border border-white/10 bg-[#1c2733] p-2.5" style={{ boxShadow: `inset 3px 0 0 ${s.color}` }}>
              <p className="flex items-center gap-1.5 font-semibold text-white">{s.name}{!s.in_scope && <span className="rounded bg-white/10 px-1 text-[9.5px] font-normal text-[#abb3bf]">add-on</span>}<span className="ml-auto text-[10.5px] font-normal tabular-nums text-[#8f99a8]">{s.devices}</span></p>
              <p className="mt-1 text-[12px] tabular-nums text-[#e5e8eb]">{stat(s.key)}</p>
              <p className="mt-0.5 text-[10px] text-[#6f7c8b]">{typeof s.why === "string" ? `Not in the documents: ${s.why}.` : `In the scope: ${(s.why as string[])[0]}`}</p>
            </div>
          ))}
          <p className="px-1 text-[10px] leading-snug text-[#6f7c8b]">How many devices a floor gets follows a rule of thumb per floor area, for the MEP designer to check. {liveCount ? "" : "Every reading here is simulated until the building sends its own."}</p>
        </aside>
        <div data-tour="twin" className="relative min-w-0 flex-1 bg-[#0d131a]">
          <div ref={holder} className="absolute inset-0" />
          {floor && <button onClick={() => setFloor(null)} className="absolute left-3 top-3 rounded-full bg-[#0d131a]/85 px-3 py-1 text-[11.5px] text-white shadow hover:bg-[#1c2733]">Showing {floor} · show every floor ×</button>}
          {chosen && (
            <div className="absolute bottom-3 right-3 w-[300px] rounded-xl border border-white/15 bg-[#0d131a]/95 p-3 shadow-[0_12px_40px_rgb(0_0_0/.5)] backdrop-blur">
              <div className="flex items-start gap-2"><span className="mt-0.5 h-3 w-3 rounded-full" style={{ background: color[chosen.system] }} /><div className="min-w-0 flex-1"><p className="font-semibold text-white">{chosen.name}</p><p className="text-[10.5px] text-[#8f99a8]">{chosen.id} · {chosen.floor}</p></div><button onClick={() => setSel(null)} aria-label="Close" className="rounded p-0.5 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button></div>
              <div className="mt-2 space-y-1">
                {(chosen.metrics as string[]).map((m) => { const r = values[chosen.id][m], unit = metrics[m]?.unit ?? "", bad = alertOf(chosen).includes(m); return (
                  <p key={m} className="flex items-baseline justify-between gap-2"><span className="text-[#abb3bf]">{LABEL[m] ?? m}</span><span className={`tabular-nums ${bad ? "font-semibold text-[#ffb4b4]" : "text-white"}`}>{YES_NO.has(m) ? (r.value ? "yes" : "no") : `${r.value}${unit ? ` ${unit}` : ""}`}</span></p>
                ); })}
              </div>
              <p className="mt-2 text-[10px] text-[#8f99a8]">{(chosen.metrics as string[]).some((m) => values[chosen.id][m].live) ? `Live, last sent ${values[chosen.id][(chosen.metrics as string[])[0]].at}` : "Simulated: this device has sent nothing yet."}</p>
              <p className="mt-1 break-all font-mono text-[9.5px] text-[#6f7c8b]">{chosen.topic}</p>
            </div>
          )}
        </div>
        <aside className="w-[270px] shrink-0 overflow-y-auto border-l border-black/40 bg-[#111820] max-xl:hidden">
          <div className="sticky top-0 z-[1] bg-[#111820] p-2"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a device, a floor…" className="w-full rounded border border-white/15 bg-black/20 px-2 py-1 text-[12px] text-white placeholder:text-[#6b7480]" /></div>
          {found ? found.slice(0, 60).map((d) => <button key={d.id} onClick={() => pick(d)} className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-white/[.05] ${sel === d.id ? "bg-white/[.08]" : ""}`}><span className="h-2 w-2 rounded-full" style={{ background: color[d.system] }} /><span className="min-w-0 flex-1 truncate text-[#e5e8eb]">{d.name}</span><span className="text-[10px] text-[#8f99a8]">{d.floor}</span></button>)
            : floors.map((f) => {
              const mine = shown.filter((d) => d.floor === f.name), bad = mine.filter((d) => alertOf(d).length).length, open = floor === f.name;
              return (
                <div key={f.name}>
                  <button onClick={() => setFloor(open ? null : f.name)} className={`flex w-full items-center gap-2 border-t border-white/5 px-3 py-1.5 text-left hover:bg-white/[.05] ${open ? "bg-white/[.07]" : ""}`}>
                    <Icon name={open ? "down" : "right"} className="h-3 w-3 text-[#8f99a8]" /><span className="flex-1 font-medium text-white">{f.name}</span>{bad > 0 && <span className="rounded-full bg-[#e5484d] px-1.5 text-[10px] font-semibold text-white">{bad}</span>}<span className="text-[10.5px] tabular-nums text-[#8f99a8]">{mine.length}</span>
                  </button>
                  {open && mine.map((d) => <button key={d.id} onClick={() => pick(d)} className={`flex w-full items-center gap-2 py-1 pl-8 pr-3 text-left hover:bg-white/[.05] ${sel === d.id ? "bg-white/[.08]" : ""}`}><span className="h-2 w-2 rounded-full" style={{ background: color[d.system] }} /><span className="min-w-0 flex-1 truncate text-[11.5px] text-[#d3d8de]">{d.name}</span>{alertOf(d).length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[#e5484d]" />}<span className="font-mono text-[9.5px] text-[#6f7c8b]">{d.id.split("-").pop()}</span></button>)}
                </div>
              );
            })}
        </aside>
      </div>
    </div>
  );
}
