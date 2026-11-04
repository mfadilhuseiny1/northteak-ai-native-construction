"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import { api, Loading, NotYet, Problem, useData, type Rec } from "./kit";
import { buildScene, type Marker, type Model, type Scene, type Twin } from "./Model3DScene";

/* The digital twin: the finished building and the sensors a smart building puts in it. The 3D fills the screen and the dashboard floats on it; an
   alert and a device's readings stand in the 3D, pinned to where they are. Which systems are there comes from the project's own MEP scope; what
   clients often add is shown apart as an add-on. A device's readings are live once the building's systems send them; until then they are
   simulated, and the screen says so. */

const PATH: Record<string, string> = {
  fire: "M12 3c1 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.7.1 1.8.8 3 2 3.2C12.3 9 10.8 6.5 12 3z",
  hvac: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5",
  cctv: "M3 8h12v8H3zM15 11l6-3v8l-6-3",
  energy: "M13 2 4 14h7l-1 8 9-12h-7z",
  water: "M12 3s6.5 6.5 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 9.5 12 3 12 3z",
  lift: "M8 20V5M4 9l4-4 4 4M16 4v15M12 15l4 4 4-4",
  lighting: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  access: "M3 6h18v12H3zM3 10h18M7 15h4",
  structure: "M2 12h5l2.5-7 5 14 2.5-7h5",
};
const LABEL: Record<string, string> = { alarm: "Alarm", flow: "Water flow", temperature: "Temperature", humidity: "Humidity", co2: "CO₂", online: "Online", people: "People in view", power: "Power", generation: "Generation", level: "Level", running: "Running", pressure: "Pressure", ph: "pH", trips: "Trips today", fault: "Fault", occupancy: "Occupancy", lux: "Light", entries: "Entries today", vibration: "Vibration", tilt: "Tilt" };
const YES_NO = new Set(["alarm", "flow", "online", "running", "fault"]);
const SHORT: Record<string, (v: number) => string | null> = {  // a reading as it stands beside its device. Null: nothing worth saying
  alarm: (v) => (v ? "ALARM" : "OK"), flow: (v) => (v ? "Flowing" : "OK"), temperature: (v) => `${v.toFixed(1)}°C`, humidity: (v) => `${v.toFixed(0)}%`, co2: (v) => `${Math.round(v).toLocaleString("en-US")} ppm`,
  online: () => null, people: (v) => (Math.round(v) === 1 ? "1 person" : `${Math.round(v)} people`), power: (v) => `${v.toFixed(0)} kW`, generation: (v) => `${v.toFixed(0)} kW`, level: (v) => `${v.toFixed(0)}%`, running: (v) => (v ? "On" : "Off"), pressure: (v) => `${v.toFixed(1)} bar`,
  ph: (v) => `pH ${v.toFixed(1)}`, trips: (v) => `${Math.round(v)} trips`, fault: (v) => (v ? "Fault" : null), occupancy: (v) => `${v.toFixed(0)}%`, lux: (v) => `${Math.round(v)} lx`, entries: (v) => `${Math.round(v)} entries`, vibration: (v) => `${v.toFixed(2)} mm/s`, tilt: (v) => `${v.toFixed(2)}°`,
};
const FIRST = ["energy", "water", "lift", "hvac", "cctv", "lighting", "access", "structure", "fire"];  // whose readings get the room first: the few and telling before the many that mostly say OK
const FOLD = 900;  // below this width the panels start closed, for the building to be seen at all
const MOST_PINS = 6, SPREAD = 2.2;  // metres between devices that share a spot
const DOWN = 0.1, STALE = 15 * 60, OFF = "#5d6773";  // the share of simulated devices that are offline, as a real building always has a few; how long a live one may go quiet; the grey they turn
const POLL = 15_000;  // how often the screen asks what the building has sent since

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; };
const stuffy = (d: Rec) => (d.metrics as string[]).includes("co2") && hash(`${d.id}:co2`) > 0.97;  // one meeting room running out of fresh air, to show how an alert reads
const ago = (s: number) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`; };

/** A reading: the building's own if it has sent one, else a simulated one that moves with time, inside the metric's normal range. */
function read(d: Rec, metric: string, t: number, metrics: Rec, real: Rec): { value: number; live: boolean; at?: string } {
  const sent = real[d.id]?.[metric];
  if (sent) return { value: sent.value, live: true, at: sent.at };
  const [lo, hi] = metrics[metric].normal as [number, number], r = hash(`${d.id}:${metric}`);
  if (YES_NO.has(metric)) return { value: metric === "running" ? (Math.sin(t / 40 + r * 9) > 0 ? 1 : 0) : metric === "online" ? 1 : 0, live: false };
  let v = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(t / (30 + r * 60) + r * 12));
  if (metric === "co2" && stuffy(d)) v = 1050 + 120 * Math.max(0, Math.sin(t / 25));
  return { value: Math.round(v * 100) / 100, live: false };
}

/** When an offline device was last heard from; null while it is up. A live device is offline once it has sent nothing for STALE, or its recorder
    says so; a simulated one is, one in ten, but never the one simulated alert the screen is there to show. */
function down(d: Rec, t: number, start: number, real: Rec): number | null {
  const sent = real[d.id] as Rec | undefined;
  if (sent) {
    const last = Math.max(...Object.values(sent).map((s) => Date.parse((s as Rec).at) / 1000).filter(Number.isFinite));
    return Number.isFinite(last) && (t - last > STALE || sent.online?.value === 0) ? last : null;
  }
  const r = hash(`${d.id}:down`);
  return r < DOWN && !stuffy(d) ? start - 600 - (r / DOWN) * 5 * 3600 : null;
}

const glass = "rounded-xl border border-white/10 bg-[#0f1923]/90 text-[#d3d8de] shadow-[0_10px_28px_rgb(10_20_30/.32)] backdrop-blur";
const tool = (on = false) => `flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-medium transition ${on ? "border-[#f5b82e]/45 bg-[#f5b82e]/15 text-[#f5b82e]" : "border-white/[.07] bg-white/[.05] text-[#e5e8eb] hover:bg-white/[.1] hover:text-white"}`;
const Glyph = ({ path, color, size = 14 }: { path: string; color?: string; size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color ?? "currentColor"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0"><path d={path} /></svg>;
/** Something standing in the 3D with its foot on the point. */
const Foot = ({ color, children }: { color: string; children: ReactNode }) => <div className="flex flex-col items-center"><div className="pointer-events-auto">{children}</div><span className="h-5 w-px" style={{ background: color }} /></div>;
type Row = { value: string; unit?: string; label: string; bad?: boolean };

export function DigitalTwinModule() {
  const model = useData<Model & Rec>("/api/project/model-3d");
  const twin = useData("/api/project/twin");
  const holder = useRef<HTMLDivElement>(null);
  const view = useRef<Scene | null>(null);
  const shell = useRef<Twin | null>(null);
  const [built, setBuilt] = useState(0);
  const [failed, setFailed] = useState("");
  const [t, setT] = useState(() => Date.now() / 1000);
  const [start] = useState(() => Date.now() / 1000);
  const [fresh, setFresh] = useState<Rec | null>(null);
  const [layers, setLayers] = useState<Set<string> | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [panel, setPanel] = useState<"dashboard" | "connect" | null>(() => (typeof window !== "undefined" && window.innerWidth < FOLD ? null : "dashboard"));
  const [xray, setXray] = useState(true);
  const [walk, setWalk] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [query, setQuery] = useState("");
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [tags, setTags] = useState<Record<string, HTMLDivElement>>({});
  useEffect(() => { const k = window.setInterval(() => setT(Date.now() / 1000), 2000); return () => window.clearInterval(k); }, []);
  useEffect(() => {  // what the building has sent since the page opened: a bridge from its broker posts readings as they come
    const k = window.setInterval(() => { if (!document.hidden) api<Rec>("/api/project/twin/readings").then(setFresh).catch(() => {}); }, POLL);
    return () => window.clearInterval(k);
  }, []);
  useEffect(() => setFresh(null), [twin.data]);  // another project opened, or the twin read again: its own readings stand

  const data = twin.data, systems = (data?.systems ?? []) as Rec[];
  const devices = useMemo(() => {  // several kinds of device can land on or beside one spot of a floor: they stand apart, towards the middle of the floor, or one hides the rest
    const stood: Rec[] = [];
    return ((data?.devices ?? []) as Rec[]).map((d) => {
      let x = d.x, z = d.z;
      for (let n = 1; n < 40 && stood.some((o) => o.floor === d.floor && Math.hypot(o.x - x, o.z - z) < SPREAD); n++) { x = d.x - Math.sign(d.x || 1) * (n % 4) * SPREAD; z = d.z - Math.sign(d.z || 1) * Math.floor(n / 4) * SPREAD; }
      const at: Rec = { ...d, x, z };
      stood.push(at);
      return at;
    });
  }, [data]);
  const on = layers ?? new Set(systems.filter((s) => s.in_scope).map((s) => s.key as string));
  const color = Object.fromEntries(systems.map((s) => [s.key, s.color])) as Record<string, string>;
  const metrics = (data?.metrics ?? {}) as Rec, real = (fresh ?? data?.readings ?? {}) as Rec;
  const values = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, Object.fromEntries((d.metrics as string[]).map((m) => [m, read(d, m, t, metrics, real)]))])), [devices, t, metrics, real]);
  const off = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, down(d, t, start, real)])) as Record<string, number | null>, [devices, t, start, real]);
  const isOff = (d: Rec) => off[d.id] != null;
  const alertOf = (d: Rec) => (isOff(d) ? [] : (d.metrics as string[]).filter((m) => { const a = metrics[m]?.alert; return a != null && values[d.id]?.[m]?.value >= a; }));  // an offline device says nothing, out of range or not
  const shown = devices.filter((d) => on.has(d.system));
  const alerts = shown.filter((d) => alertOf(d).length), downs = shown.filter(isOff);
  const here = floor ? shown.filter((d) => d.floor === floor) : shown;
  const seen = here.filter((d) => xray || floor || d.id === sel || alertOf(d).length);  // a whole building shows dots, an opened floor shows what each device is. Inside a solid building only what needs attention shows
  const alertText = (d: Rec) => alertOf(d).map((m) => `${LABEL[m]} ${Math.round(values[d.id][m].value).toLocaleString("en-US")}${metrics[m]?.unit ? ` ${metrics[m].unit}` : ""}`).join(", ");
  const brief = (d: Rec) => {  // an opened floor has room for all a device says; on the whole building its first reading has to do
    if (isOff(d)) return "Offline";
    const said = (d.metrics as string[]).map((m) => SHORT[m]?.(values[d.id][m].value)).filter(Boolean);
    return floor ? said.join(" · ") : said[0] ?? "";
  };
  const seeThrough = xray && !floor;  // an opened floor is always solid: its walls, columns and stairs are what place a device
  const liveCount = Object.keys(real).length;
  const chosen = devices.find((d) => d.id === sel);
  const alertKey = alerts.map((d) => d.id).join(","), downKey = downs.map((d) => d.id).join(",");
  const pinned = alerts.filter((d) => d.id !== sel && (!floor || d.floor === floor)).slice(0, MOST_PINS), pinKey = pinned.map((d) => d.id).join(",");
  const ready = !!model.data && !!data && devices.length > 0 && !!(model.data.elements as unknown[])?.length;
  const room = () => (panel && window.innerWidth >= FOLD ? 80 : 0);  // how far the picture moves left, to centre the building in what the panel leaves free

  useEffect(() => {  // the finished building, drawn once both the model and its sensors are in: until then there is nothing to draw it into
    if (!ready || !holder.current) return;
    let v: Scene;
    try {
      v = buildScene(model.data as Model, holder.current, (ids) => { const id = ids?.find((x) => x.startsWith("marker:")); setSel(id ? id.slice(7) : null); }, setWalk);
    } catch (e) {
      setFailed(`This browser could not draw the 3D view: ${(e as Error).message}`);
      return;
    }
    v.update((model.data as Model).days, false);
    view.current = v;
    shell.current = v.twin();
    shell.current.xray(seeThrough);  // before its first frame, or the solid building flashes on the way in
    shell.current.inset(room());
    setFloor(null);
    setSel(null);
    setBuilt((n) => n + 1);
    return () => { v.dispose(); view.current = null; shell.current = null; };
  }, [ready, model.data]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { shell.current?.xray(seeThrough); }, [seeThrough, built]);
  useEffect(() => { shell.current?.inset(room()); }, [panel, built]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { shell.current?.shade(floor ? [] : alerts.map((d) => (data?.floors as Rec[]).find((f) => f.name === d.floor)?.elevation as number)); }, [alertKey, floor, built]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    view.current?.markers(seen.map((d): Marker => ({ id: d.id, x: d.x, y: d.y, z: d.z, color: isOff(d) ? OFF : color[d.system] ?? "#8f99a8", path: floor ? PATH[d.system] : undefined, alert: alertOf(d).length > 0 })));
  }, [seen.length, floor, xray, sel, alertKey, downKey, built]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // each device's reading beside it, as many as have room: an opened floor or the pointer brings up the rest. An alert's pin and the open card say it already
    const rank = (d: Rec) => (alertOf(d).length ? -1 : FIRST.indexOf(d.system));
    shell.current?.tags(seen.filter((d) => d.id !== sel && !pinned.includes(d)).sort((a, b) => rank(a) - rank(b)).map((d) => ({ id: d.id, x: d.x, y: d.y, z: d.z, text: brief(d), color: isOff(d) ? OFF : color[d.system] ?? "#8f99a8", alert: alertOf(d).length > 0, live: !isOff(d) && (d.metrics as string[]).some((m) => values[d.id][m].live), quiet: isOff(d) || brief(d) === "OK" })),
      floor ? 13 : 7, [...pinned.map((d) => ({ x: d.x, y: d.y, z: d.z, w: `${alertText(d)} ${d.floor}`.length * 6.5 + 40, h: 48 })), ...(chosen ? [{ x: chosen.x, y: chosen.y, z: chosen.z, w: 250, h: 150 }] : [])]);
  }, [values, seen.length, pinKey, sel, floor, built]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chosen || !shell.current) return;
    const p = shell.current.pin({ x: chosen.x, y: chosen.y, z: chosen.z });
    setCard(p.el);
    return () => { p.remove(); setCard(null); };
  }, [chosen?.id, built]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!shell.current) return;
    const made = pinned.map((d) => ({ id: d.id, p: shell.current!.pin({ x: d.x, y: d.y, z: d.z }) }));
    setTags(Object.fromEntries(made.map(({ id, p }) => [id, p.el])));
    return () => { for (const { p } of made) p.remove(); setTags({}); };
  }, [pinKey, built]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!model.data || !data) return <div className="flex-1"><Problem err={model.err || twin.err} />{!model.err && !twin.err && <Loading />}</div>;
  if (!devices.length) return <div className="flex-1 bg-[#111820] p-6"><NotYet>{data.note ?? "No building to place sensors in yet."}</NotYet></div>;
  if (failed) return <div className="flex-1 bg-[#111820] p-6"><NotYet>{failed}</NotYet></div>;

  const floorOf = (name: string) => (data.floors as Rec[]).find((f) => f.name === name);
  const openAt = (name: string | null, at?: Rec) => { const f = name ? floorOf(name) : null; setFloor(name); shell.current?.open(f ? { y: f.elevation, roof: f.name === "Roof" } : null, at && { x: at.x, y: at.y, z: at.z }); };
  const pick = (d: Rec) => { setSel(d.id); setShowAlerts(false); setQuery(""); openAt(d.floor, d); };
  const home = () => { if (walk) view.current?.setFirstPerson(false); setSel(null); openAt(null); };
  const stroll = () => { const next = !walk; if (next) { openAt(null); setXray(false); setSel(null); } view.current?.setFirstPerson(next); };
  const toggle = (key: string) => { const next = new Set(on); if (next.has(key)) next.delete(key); else next.add(key); setLayers(next); };
  const take = (key: string) => {
    const mine = shown.filter((d) => d.system === key);
    const of = (m: string) => mine.filter((d) => values[d.id][m] && !isOff(d)).map((d) => values[d.id][m].value as number), sum = (m: string) => of(m).reduce((a, b) => a + b, 0), avg = (m: string) => (of(m).length ? sum(m) / of(m).length : 0), most = (m: string) => Math.max(0, ...of(m));
    return { mine, sum, avg, most };
  };
  const rows = (key: string): Row[] => {
    const { mine, sum, avg, most } = take(key);
    if (key === "fire") { const n = sum("alarm"); return [{ value: `${n}`, label: "Alarms", bad: n > 0 }, { value: `${mine.length}`, label: "Devices" }]; }
    if (key === "hvac") return [{ value: avg("temperature").toFixed(1), unit: "°C", label: "Temperature" }, { value: avg("humidity").toFixed(0), unit: "%", label: "Humidity" }, { value: Math.round(most("co2")).toLocaleString("en-US"), unit: "ppm", label: "CO₂, highest", bad: most("co2") >= metrics.co2.alert }];
    if (key === "cctv") return [{ value: `${Math.round(sum("people"))}`, label: "People in view" }];
    if (key === "water") return [{ value: avg("level").toFixed(0), unit: "%", label: "Tanks" }, { value: avg("ph").toFixed(1), label: "pH" }];
    if (key === "lift") return [{ value: `${Math.round(sum("trips"))}`, label: "Trips today" }];
    if (key === "lighting") return [{ value: avg("occupancy").toFixed(0), unit: "%", label: "Occupied" }];
    if (key === "access") return [{ value: `${Math.round(sum("entries"))}`, label: "Entries today" }];
    if (key === "structure") return [{ value: most("vibration").toFixed(2), unit: "mm/s", label: "Vibration, highest" }];
    return [{ value: `${mine.length}`, label: "Devices" }];
  };
  const power = on.has("energy") ? take("energy") : null;
  const floors = (data.floors as Rec[]).filter((f) => shown.some((d) => d.floor === f.name)).reverse();
  const found = query.trim() ? shown.filter((d) => `${d.id} ${d.name} ${d.floor}`.toLowerCase().includes(query.toLowerCase())) : null;
  const line = (d: Rec) => (
    <button key={d.id} onClick={() => pick(d)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-white/[.07]">
      <Glyph path={PATH[d.system]} color={isOff(d) ? OFF : color[d.system]} /><span className="min-w-0 flex-1"><span className="block truncate text-[#e5e8eb]">{d.name}</span>{alertOf(d).length > 0 && <span className="block truncate text-[11px] text-[#ffb4b4]">{alertText(d)}</span>}{isOff(d) && <span className="block truncate text-[11px] text-[#8f99a8]">Offline, last heard {ago(t - off[d.id]!)} ago</span>}</span><span className="text-[10.5px] text-[#8f99a8]">{d.floor}</span>
    </button>
  );

  return (
    <div data-tour="twin" className="relative min-w-0 flex-1 overflow-hidden bg-[#e4eaef] text-[12px]">
      <div ref={holder} className="absolute inset-0 isolate" />

      {pinned.map((d) => tags[d.id] && createPortal(
        <Foot color="#e5484d"><button onClick={() => pick(d)} className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#e5484d] px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_4px_14px_rgb(160_30_35/.45)] hover:brightness-110"><Glyph path={PATH[d.system]} size={12} />{alertText(d)}<span className="font-normal text-white/80">{d.floor}</span></button></Foot>, tags[d.id], d.id))}

      {chosen && card && createPortal(
        <Foot color={color[chosen.system]}>
          <div className={`${glass} w-[250px] p-3 text-[12px]`}>
            <div className="flex items-start gap-2"><span className="mt-0.5"><Glyph path={PATH[chosen.system]} color={color[chosen.system]} size={16} /></span><div className="min-w-0 flex-1"><p className="font-semibold text-white">{chosen.name}</p><p className="text-[10.5px] text-[#8f99a8]">{chosen.id} · {chosen.floor}</p></div><button onClick={() => setSel(null)} aria-label="Close" className="rounded p-0.5 text-[#8f99a8] hover:bg-white/10"><Icon name="x" className="h-3.5 w-3.5" /></button></div>
            <div className="mt-2 space-y-1">
              {(chosen.metrics as string[]).map((m) => { const r = values[chosen.id][m], unit = metrics[m]?.unit ?? "", bad = alertOf(chosen).includes(m); return (
                <p key={m} className="flex items-baseline justify-between gap-2"><span className="text-[#abb3bf]">{LABEL[m] ?? m}</span><span className={`tabular-nums ${bad ? "font-semibold text-[#ffb4b4]" : isOff(chosen) ? "text-[#8f99a8]" : "text-white"}`}>{isOff(chosen) ? "–" : YES_NO.has(m) ? (r.value ? "yes" : "no") : `${r.value.toLocaleString("en-US", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`}</span></p>
              ); })}
            </div>
            {isOff(chosen) && <p className="mt-2 rounded bg-white/[.06] px-2 py-1 text-[11px] text-[#e5e8eb]">Offline, last heard {ago(t - off[chosen.id]!)} ago</p>}
            <p className="mt-2 text-[10px] text-[#8f99a8]">{(chosen.metrics as string[]).some((m) => values[chosen.id][m].live) ? (isOff(chosen) ? "A live device: it has stopped sending." : `Live, last sent ${values[chosen.id][(chosen.metrics as string[])[0]].at}`) : "Simulated: this device has sent nothing yet."}</p>
          </div>
        </Foot>, card)}

      <div className="absolute left-4 top-4 z-10 w-[250px] max-w-[calc(100%-32px)] space-y-2">
        <div className={`${glass} flex items-center gap-1 p-1`}>
          <span className="pl-2 text-[#8f99a8]"><Icon name="search" className="h-3.5 w-3.5" /></span>
          <input value={query} onChange={(e) => { setQuery(e.target.value); setShowAlerts(false); }} placeholder="Find a device…" aria-label="Find a device" className="h-9 min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-white placeholder:text-[#8f99a8] focus:outline-none" />
          <button onClick={() => { setShowAlerts(!showAlerts); setQuery(""); }} aria-pressed={showAlerts} aria-label={`Alerts: ${alerts.length}`} title="Alerts" className={`relative ${tool(showAlerts)}`}><Icon name="bell" className="h-4 w-4" />{alerts.length > 0 && <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-[#e5484d] px-1 text-center text-[10px] font-semibold leading-4 text-white">{alerts.length}</span>}</button>
        </div>
        {found && <div className={`${glass} max-h-[50vh] overflow-y-auto py-1`}>{found.length ? found.slice(0, 40).map(line) : <p className="px-3 py-1.5 text-[#8f99a8]">Nothing by that name.</p>}</div>}
        {showAlerts && <div className={`${glass} max-h-[50vh] overflow-y-auto py-1`}>{alerts.length ? alerts.map(line) : <p className="px-3 py-1.5 text-[#8f99a8]">Nothing out of range.</p>}{downs.length > 0 && <><p className="px-3 pb-0.5 pt-2 text-[10.5px] font-medium uppercase tracking-[.06em] text-[#8f99a8]">Offline</p>{downs.map(line)}</>}</div>}
      </div>

      <nav aria-label="Floors" className={`${glass} absolute left-4 top-1/2 flex max-h-[46%] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto p-1`}>
        <button onClick={() => openAt(null)} aria-pressed={!floor} className={`${tool(!floor)} h-8 justify-center`}>All</button>
        {floors.map((f) => { const bad = shown.some((d) => d.floor === f.name && alertOf(d).length); return (
          <button key={f.name} onClick={() => { setSel(null); openAt(f.name as string); }} aria-pressed={floor === f.name} className={`${tool(floor === f.name)} relative h-8 justify-center whitespace-nowrap`}>{f.name}{bad && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#e5484d]" />}</button>
        ); })}
      </nav>

      <div className="absolute right-4 top-4 flex max-w-[calc(100%-32px)] flex-col items-end gap-2 max-sm:top-[68px]" style={{ maxHeight: "calc(100% - 32px)" }}>
        <div className={`${glass} flex items-center gap-1 p-1`}>
          <span className={`px-2 text-[11px] font-semibold ${liveCount ? "text-[#3dd68c]" : "text-[#f5b82e]"}`}>{liveCount ? `Live from ${liveCount} of ${devices.length} devices` : "Simulated readings"}</span>
          <button onClick={() => setPanel(panel === "dashboard" ? null : "dashboard")} aria-pressed={panel === "dashboard"} className={tool(panel === "dashboard")}><Icon name="gauge" className="h-4 w-4" />Dashboard</button>
          <button onClick={() => setPanel(panel === "connect" ? null : "connect")} aria-pressed={panel === "connect"} aria-label="Connect the building" title="Connect the building" className={tool(panel === "connect")}><Icon name="plug" className="h-4 w-4" /></button>
        </div>
        {panel === "dashboard" && (
          <div className={`${glass} min-h-0 w-[280px] max-w-full space-y-1.5 overflow-y-auto p-1.5`}>
            <p className="flex items-baseline justify-between gap-2 rounded-lg bg-white/[.05] px-3 py-2"><span className="text-[15px] tabular-nums text-white">{shown.length - downs.length} of {shown.length}</span><span className="text-[11px] text-[#abb3bf]">Devices online</span></p>
            {power &&<div className="rounded-lg bg-white/[.05] p-3"><p className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: color.energy }}><Glyph path={PATH.energy} />Power drawn</p><p className="mt-0.5 text-[30px] font-light leading-tight text-white tabular-nums">{power.sum("power").toFixed(0)} <span className="text-[15px] font-normal text-[#d3d8de]">kW</span></p>{power.mine.some((d) => d.kind === "solar") && <p className="text-[11px] text-[#abb3bf]">{power.sum("generation").toFixed(0)} kW from solar</p>}</div>}
            {systems.filter((s) => on.has(s.key) && s.key !== "energy").map((s) => (
              <div key={s.key} className="rounded-lg bg-white/[.05] px-3 py-2">
                <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[.06em] text-[#8f99a8]"><Glyph path={PATH[s.key]} color={s.color} size={12} />{s.name}{!s.in_scope && <span className="ml-auto normal-case tracking-normal">add-on</span>}</p>
                {rows(s.key).map((r) => <p key={r.label} className="flex items-baseline justify-between gap-2 py-px"><span className={`text-[15px] tabular-nums ${r.bad ? "font-medium text-[#ff8f8f]" : "text-white"}`}>{r.value}{r.unit && <span className={`ml-1 text-[11px] ${r.bad ? "" : "text-[#abb3bf]"}`}>{r.unit}</span>}</span><span className="text-[11px] text-[#abb3bf]">{r.label}</span></p>)}
              </div>
            ))}
          </div>
        )}
        {panel === "connect" && <Connect device={chosen ?? devices[0]} devices={devices} metrics={metrics} />}
      </div>

      <p className="pointer-events-none absolute bottom-5 left-4 max-w-[300px] text-[11px] leading-snug text-[#44525f] max-[1180px]:hidden"><b className="text-[#26323d]">Digital twin</b> of the finished building, {data.area} m² a floor, with the sensors a smart building puts in it</p>

      <div className="absolute bottom-4 left-1/2 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center gap-2">
        {walk && <p className={`${glass} whitespace-nowrap px-3 py-1.5 text-[11px]`}><b className="text-white">W A S D</b> walk · drag to look · <b className="text-white">E Q</b> up and down</p>}
        {showLayers && (
          <div className={`${glass} w-[290px] max-w-full p-1.5`}>
            <p className="px-2 pb-1 pt-0.5 font-semibold text-white">Layers</p>
            {systems.map((s) => (
              <button key={s.key} role="switch" aria-checked={on.has(s.key)} onClick={() => toggle(s.key)} title={typeof s.why === "string" ? `Add-on: ${s.why}` : `In the scope: ${(s.why as string[]).join("; ")}`} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[.07]">
                <Glyph path={PATH[s.key]} color={s.color} /><span className="min-w-0 flex-1 truncate text-[#e5e8eb]">{s.name}{!s.in_scope && <span className="ml-1.5 text-[10.5px] text-[#8f99a8]">add-on</span>}</span><span className="text-[10.5px] tabular-nums text-[#8f99a8]">{s.devices}</span>
                <span className={`relative h-[15px] w-[26px] shrink-0 rounded-full transition ${on.has(s.key) ? "bg-[#f5b82e]" : "bg-white/15"}`}><span className={`absolute top-[2px] h-[11px] w-[11px] rounded-full bg-white transition-all ${on.has(s.key) ? "left-[13px]" : "left-[2px]"}`} /></span>
              </button>
            ))}
            <p className="px-2 pb-1 pt-1.5 text-[10px] leading-snug text-[#8f99a8]">How many devices a floor gets follows a rule of thumb per floor area, for the MEP designer to check.</p>
          </div>
        )}
        <div className={`${glass} flex items-center gap-1 p-1`}>
          <button onClick={home} title="Whole building" aria-label="Whole building" className={tool()}><Icon name="home" className="h-4 w-4" /></button>
          <button onClick={stroll} aria-pressed={walk} className={tool(walk)}><Icon name="person" className="h-4 w-4" />Walk</button>
          <button onClick={() => { if (floor) { setXray(true); openAt(null); } else setXray(!xray); }} aria-pressed={seeThrough} className={tool(seeThrough)}><Icon name="cube" className="h-4 w-4" />X-Ray</button>
          <button onClick={() => setShowLayers(!showLayers)} aria-pressed={showLayers} className={tool(showLayers)}><Icon name="layers" className="h-4 w-4" />Layers</button>
        </div>
      </div>
    </div>
  );
}

/** How the building's systems send their readings: over MQTT, through the bridge on this computer (swarm/mqtt_bridge.py), or posted
    directly. Every topic and value shown is the open project's own, for the device picked in the 3D. */
function Connect({ device, devices, metrics }: { device: Rec; devices: Rec[]; metrics: Rec }) {
  const project = String(device.topic).split("/")[1];
  const names = device.metrics as string[];
  const first = `${device.topic}/${names[0]}`;
  const normal = (metrics[names[0]]?.normal as number[] | undefined)?.[0] ?? 0;
  const off = -new Date().getTimezoneOffset();  // a time without its zone is read as this computer's own: a gateway that keeps UTC would look hours late
  const zone = `${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  const said =(m: string) => `${m}${metrics[m]?.unit ? ` in ${metrics[m].unit}` : ""}${metrics[m]?.alert != null ? `, alert from ${metrics[m].alert}` : ""}`;
  const saveTopics = () => {  // every device's topics, for whoever maps the building's points to them
    const rows = [["topic", "device", "name", "floor", "system", "metric", "unit", "alert from"],
      ...devices.flatMap((d) => (d.metrics as string[]).map((m) => [`${d.topic}/${m}`, d.id, d.name, d.floor, d.system, m, metrics[m]?.unit ?? "", metrics[m]?.alert ?? ""]))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\r\n")], { type: "text/csv" }));  // the mark tells Excel it is UTF-8, or °C comes out garbled
    a.download = `mqtt-topics-${project}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <div className={`${glass} min-h-0 w-[400px] max-w-full overflow-y-auto text-[12px] leading-relaxed`}>
      <div className="flex items-start gap-3 border-b border-white/10 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f5b82e]/15 text-[#f5b82e]"><Icon name="plug" className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-white">Connect the building</p>
          <p className="text-[#abb3bf]">Readings from the building&apos;s own MQTT broker, such as Mosquitto, EMQX or HiveMQ, replace the simulated ones. A device shows live from its first reading.</p>
        </div>
      </div>
      <ol className="space-y-5 p-4">
        <Step n={1} title="Publish each reading to its device's topic">
          <Code text={first} label="the topic" />
          <p className="flex flex-wrap items-center gap-1 text-[10.5px] text-[#8f99a8]">{TOPIC.map((x, i) => <span key={x} className="flex items-center gap-1">{i > 0 && <span className="text-white/25">/</span>}<span className="rounded bg-white/[.06] px-1.5 py-px">{x}</span></span>)}</p>
          <Code text={`{"value": ${normal}, "at": "2026-11-05T10:00:00${zone}"}`} label="the message" />
          <p className="text-[#abb3bf]">The message is the value alone, or JSON with when it was read and its time zone (Z for UTC). Without a time, its arrival counts. Publish with retain, so the last value shows as soon as the bridge starts.</p>
          <div className="rounded-lg bg-white/[.04] px-3 py-2">
            <p><b className="font-medium text-white">{String(device.name)}</b> <span className="text-[#8f99a8]">{String(device.id)}</span></p>
            <p className="text-[#abb3bf]">Sends {names.map(said).join("; ")}. Pick another device in the 3D for its topic.</p>
          </div>
          <button onClick={saveTopics} className={`${tool()} w-full justify-center`}><Icon name="download" className="h-4 w-4" />Topics of all {devices.length} devices (CSV)</button>
        </Step>
        <Step n={2} title="Run the bridge on this computer">
          <Code text={".venv\\Scripts\\python -m swarm.mqtt_bridge mqtts://user:password@broker:8883"} label="the command" />
          <p className="text-[#abb3bf]">It listens on <code className="font-mono text-[11px] text-[#9cc7f5]">northteak/{project}/#</code>. Without TLS, use mqtt://broker:1883. The password can go in MQTT_PASSWORD instead, and once the app has accounts, add --email of a Site account.</p>
        </Step>
        <Step n={3} title="Check it">
          <Code text={`mosquitto_pub -h broker -t "${first}" -m ${normal}`} label="the test" />
          <p className="text-[#abb3bf]">Within about 20 seconds the device shows live, and the badge above counts it. The bridge&apos;s window lists what it passes on, and what it cannot.</p>
        </Step>
      </ol>
      <details className="group border-t border-white/10 px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[#abb3bf] hover:text-white [&::-webkit-details-marker]:hidden"><Icon name="right" className="h-3.5 w-3.5 transition group-open:rotate-90" />No MQTT? Post the readings over HTTP</summary>
        <div className="mt-2 space-y-2">
          <p className="text-[#abb3bf]">A system on this computer can post the same readings itself:</p>
          <Code text={`POST /api/project/twin/readings?project=${project}\n[{ "device": "${device.id}", "metric": "${names[0]}", "value": ${normal} }]`} label="the request" />
        </div>
      </details>
    </div>
  );
}

const TOPIC = ["northteak", "project", "floor", "system", "device", "metric"];

/** A step of the Connect panel, numbered, with a line down to the next. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative space-y-2 pl-8 after:absolute after:-bottom-4 after:left-[9.5px] after:top-6 after:w-px after:bg-white/10 last:after:hidden">
      <span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#f5b82e] text-[11px] font-bold text-[#171106]">{n}</span>
      <p className="font-semibold text-white">{title}</p>
      {children}
    </li>
  );
}

/** A line to type or send, with a button that copies it. A topic or a path breaks only at its slashes. */
function Code({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  return (
    <div className="relative rounded-lg border border-white/[.06] bg-black/40">
      <pre className="whitespace-pre-wrap py-2 pl-2.5 pr-9 font-mono text-[11px] leading-[1.5] text-[#9cc7f5] [overflow-wrap:anywhere]">{text.split("/").map((part, i) => <span key={i}>{i > 0 && <>/<wbr /></>}{part}</span>)}</pre>
      <button onClick={copy} aria-label={`Copy ${label}`} title={copied ? "Copied" : "Copy"} className={`absolute right-1.5 top-1.5 rounded-md p-1 hover:bg-white/10 ${copied ? "text-[#3dd68c]" : "text-[#8f99a8] hover:text-white"}`}><Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" /></button>
    </div>
  );
}
