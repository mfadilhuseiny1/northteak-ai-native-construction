import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* The drawing behind the 3D timeline: a building site on the drawings' grid, as the master schedule builds it day by day.
   What goes up when, on which floor and how big comes from the plan. How it goes up does not: formwork before rebar before
   concrete, bricks before plaster, the crane and the machines are how such a building is usually built, drawn the same on
   every project. update() returns, for each work package, a plain sentence of what is being done on that day. */

export type El = { id: string; code: string; name: string; account: string; kind: string; level: number | null; start: number; end: number; start_date: string; finish_date: string; critical: boolean };
export type Floor = { index: number; name: string; elevation: number; height: number; planned: boolean };
export type Model = { plan?: { title?: string } | null; pile?: string; start: string; days: number; width: number; depth: number; bay: number; basement_depth: number; storeys: Floor[]; top: number; roof: string; roof_covered?: boolean; crane: string; lift?: boolean; elements: El[]; read: Record<string, any>[]; assumed: string[]; absent?: string[] };
export type Scene = { update: (day: number, ghost: boolean) => Record<string, string>; focus: (ids: string[]) => void; overview: () => void; dispose: () => void; setFirstPerson: (on: boolean) => void };

export const LOOK = { formwork: "#c9a46b", rebar: "#9a5531", fresh: "#878d93", concrete: "#d4d6d8", brick: "#b0603a", plaster: "#efe8da" };
export const PIN = "#f59e0b";

export const clamp = (x: number) => Math.min(1, Math.max(0, x));
export const progressOf = (e: El, day: number) => clamp((day + 1 - e.start) / Math.max(1, e.end - e.start));
const busy = (list: El[], day: number) => list.some((e) => day >= e.start && day < e.end);
/** The progress of several packages building one thing, each counted by its length. */
const together = (list: El[], day: number) => {
  const total = list.reduce((n, e) => n + (e.end - e.start), 0);
  return total ? list.reduce((n, e) => n + progressOf(e, day) * (e.end - e.start), 0) / total : 0;
};
/** Work that runs over every floor goes up floor by floor: the i-th of n floors at overall progress p. */
const spread = (p: number, i: number, n: number) => clamp(p * n - i);
/** The work packages in the order they start, as the side panel lists and numbers them. */
export const inOrder = (els: El[]) => [...els].sort((a, b) => a.start - b.start || a.end - b.end || a.code.localeCompare(b.code, undefined, { numeric: true }));

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const v2 = (x: number, y: number) => new THREE.Vector2(x, y);
const DOWN = V(0, -1, 0);  // a clipping plane with this normal keeps what is below it
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/** A box whose base sits at y = 0 and whose texture repeats every `size` metres, whatever its shape. */
function raw(w: number, h: number, d: number, size = 1) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv as THREE.BufferAttribute, faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, (uv.getX(i) * faces[f][0]) / size, (uv.getY(i) * faces[f][1]) / size);
  return g.translate(0, h / 2, 0);
}
const dummy = new THREE.Object3D();
/** A steel bar from a to b. */
function bar(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  dummy.scale.setScalar(1);
  dummy.position.copy(a).add(b).multiplyScalar(0.5);
  dummy.lookAt(b);
  dummy.updateMatrix();
  return new THREE.BoxGeometry(t, t, a.distanceTo(b)).applyMatrix4(dummy.matrix);
}
const fuse = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
/** A lattice of steel bars along +x: four chords and the zig-zag bracing between them, a by h in section, its base at y = 0. */
function lattice(length: number, a: number, h: number, t: number) {
  const n = Math.max(1, Math.round(length / Math.max(a, h))), s = length / n;
  const c: [number, number][] = [[0, -a / 2], [0, a / 2], [h, a / 2], [h, -a / 2]];
  const list = c.map(([y, z]) => bar(V(0, y, z), V(length, y, z), t * 1.5));
  for (let i = 0; i <= n; i++) for (let k = 0; k < 4; k++) {
    const [y1, z1] = c[k], [y2, z2] = c[(k + 1) % 4];
    list.push(bar(V(i * s, y1, z1), V(i * s, y2, z2), t));
    if (i < n) list.push(i % 2 ? bar(V(i * s, y1, z1), V((i + 1) * s, y2, z2), t) : bar(V(i * s, y2, z2), V((i + 1) * s, y1, z1), t));
  }
  return fuse(list);
}

// ------------------------------------------------------------------------------------------------ the materials' surfaces, painted once

function painted(w: number, draw: (g: CanvasRenderingContext2D, n: number) => void, h = w) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!, w);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function surfaces() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return {
    grain: painted(256, (g, n) => {  // a neutral speckle that a material's colour tints into concrete, soil or grass
      g.fillStyle = "#e4e4e4";
      g.fillRect(0, 0, n, n);
      for (let i = 0; i < 40; i++) { const c = 190 + rnd() * 60; g.fillStyle = `rgba(${c},${c},${c},.14)`; g.beginPath(); g.arc(rnd() * n, rnd() * n, 8 + rnd() * 26, 0, 7); g.fill(); }
      for (let i = 0; i < 2600; i++) { const c = 170 + rnd() * 85; g.fillStyle = `rgba(${c},${c},${c},${0.25 + rnd() * 0.35})`; g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
    }),
    brick: painted(256, (g, n) => {  // a metre of wall: bricks 25 cm long in courses of 6 cm
      g.fillStyle = "#cfc6b8";
      g.fillRect(0, 0, n, n);
      const rows = 16, bw = n / 4, bh = n / rows;
      for (let r = 0; r < rows; r++) for (let c = -1; c < 5; c++) {
        const k = 0.85 + rnd() * 0.25;
        g.fillStyle = `rgb(${(176 * k) | 0},${(92 * k) | 0},${(58 * k) | 0})`;
        g.fillRect(c * bw + (r % 2 ? bw / 2 : 0) + 1.5, r * bh + 1.5, bw - 3, bh - 3);
      }
    }),
    plywood: painted(256, (g, n) => {
      g.fillStyle = LOOK.formwork;
      g.fillRect(0, 0, n, n);
      for (let i = 0; i < 70; i++) { const y = rnd() * n; g.strokeStyle = `rgba(120,80,40,${0.08 + rnd() * 0.12})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(n * 0.3, y + rnd() * 8 - 4, n * 0.6, y + rnd() * 8 - 4, n, y); g.stroke(); }
      g.strokeStyle = "rgba(70,45,20,.6)";
      g.lineWidth = 2;
      g.strokeRect(1, 1, n - 2, n - 2);
    }),
    mesh: painted(256, (g, n) => {  // slab rebar at 20 cm centres
      g.strokeStyle = "#7c3f1f";
      g.lineWidth = 5;
      for (let i = 0; i < 5; i++) { const p = ((i + 0.5) * n) / 5; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, n); g.moveTo(0, p); g.lineTo(n, p); g.stroke(); }
    }),
    cage: painted(128, (g, n) => {  // a column's bars and its stirrups
      g.strokeStyle = "#7c3f1f";
      g.lineWidth = 7;
      for (const x of [5, n / 2, n - 5]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, n); g.stroke(); }
      g.lineWidth = 4;
      for (const y of [n * 0.25, n * 0.75]) { g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke(); }
    }),
    zinc: painted(128, (g, n) => {  // corrugated sheet
      for (let i = 0; i < 12; i++) {
        const x = (i * n) / 12, w = n / 12, s = g.createLinearGradient(x, 0, x + w, 0);
        s.addColorStop(0, "#9a9a9a"); s.addColorStop(0.5, "#ededed"); s.addColorStop(1, "#9a9a9a");
        g.fillStyle = s;
        g.fillRect(x, 0, w, n);
      }
    }),
    tiles: painted(256, (g, n) => {  // a metre of roof tiles
      const rows = 3, per = 4, th = n / rows, tw = n / per;
      for (let r = 0; r < rows; r++) for (let c = -1; c <= per; c++) {
        const x = c * tw + (r % 2 ? tw / 2 : 0), y = r * th, k = 0.85 + rnd() * 0.25, s = g.createLinearGradient(x, 0, x + tw, 0);
        s.addColorStop(0, `rgb(${(120 * k) | 0},${(52 * k) | 0},${(30 * k) | 0})`); s.addColorStop(0.5, `rgb(${(196 * k) | 0},${(92 * k) | 0},${(56 * k) | 0})`); s.addColorStop(1, `rgb(${(120 * k) | 0},${(52 * k) | 0},${(30 * k) | 0})`);
        g.fillStyle = s;
        g.fillRect(x, y, tw, th);
        g.fillStyle = "rgba(40,18,10,.45)";
        g.fillRect(x, y + th - 5, tw, 5);
      }
    }),
    paving: painted(256, (g, n) => {
      g.fillStyle = "#8f8f8f";
      g.fillRect(0, 0, n, n);
      for (let r = 0; r < 4; r++) for (let c = -1; c < 5; c++) {
        const k = 190 + rnd() * 50;
        g.fillStyle = `rgb(${k | 0},${k | 0},${k | 0})`;
        g.fillRect((c * n) / 4 + (r % 2 ? n / 8 : 0) + 2, (r * n) / 4 + 2, n / 4 - 4, n / 4 - 4);
      }
    }),
  };
}
function signBoard(title: string) {
  return painted(512, (g, n) => {
    g.fillStyle = "#f4f5f6";
    g.fillRect(0, 0, n, 266);
    g.fillStyle = "#1d4f86";
    g.fillRect(0, 0, n, 58);
    g.fillStyle = "#fff";
    g.font = "bold 26px sans-serif";
    g.textAlign = "center";
    g.fillText("PAPAN NAMA PROYEK", n / 2, 39);
    g.fillStyle = "#14202c";
    let size = 40;
    do { g.font = `bold ${size}px sans-serif`; size -= 2; } while (g.measureText(title).width > n - 36 && size > 14);
    g.fillText(title, n / 2, 122);
    g.fillStyle = "#aab2ba";
    for (const [y, w] of [[160, 400], [186, 340], [212, 380], [238, 260]]) g.fillRect((n - w) / 2, y, w, 8);
  }, 266);
}

// ------------------------------------------------------------------------------------------------ the scene

type Load = "rebar" | "forms" | "bucket" | "bricks" | "truss";
type Note = { ids: string[]; text: string; tag: string; at: THREE.Vector3; pin: boolean };
type Panel = { at: THREE.Matrix4; w: number; h: number; hole: { x: number; y: number; w: number; h: number } | null; open?: boolean };

export function buildScene(model: Model, holder: HTMLDivElement, onPick: (ids: string[] | null) => void, onFirstPerson?: (on: boolean) => void): Scene {
  const W = model.width, D = model.depth, bay = model.bay, top = model.top, pit = model.basement_depth || 0;
  const nx = Math.max(1, Math.round(W / bay)), nz = Math.max(1, Math.round(D / bay)), bayW = W / nx;
  const xs = Array.from({ length: nx + 1 }, (_, i) => -W / 2 + (i * W) / nx);
  const zs = Array.from({ length: nz + 1 }, (_, i) => -D / 2 + (i * D) / nz);
  const floors = [...model.storeys].sort((a, b) => a.index - b.index), above = floors.filter((f) => f.index >= 0);
  const els = model.elements;
  const of = (kind: string) => els.filter((e) => e.kind === kind);
  const idsOf = (list: El[]) => list.map((e) => e.id);
  const span = Math.max(W, D, top + pit), pitched = model.roof === "pitched", rise = pitched ? Math.min(4.5, D * 0.22) : 0;
  const lowestIndex = floors.length ? floors[0].index : 0, lowest = floors.length ? floors[0].elevation : 0, footing = pit ? lowest - 1.3 : 0, deep = -footing;  // the bottom of the dig: deep enough for the pile caps to stand under the lowest slab
  const gridX = (i: number) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[i] ?? String(i + 1), bayName = (k: number) => `grids ${gridX(k)}–${gridX(k + 1)}`;
  const floorAt = (y: number) => [...floors].reverse().find((f) => f.elevation <= y + 0.01)?.name ?? "the lowest floor";

  const owned: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => { owned.push(x); return x; };

  const scene = new THREE.Scene();
  scene.background = keep(painted(4, (g, n) => { const s = g.createLinearGradient(0, 0, 0, 256); s.addColorStop(0, "#7fa3c7"); s.addColorStop(0.65, "#c5d4e0"); s.addColorStop(1, "#dfe5e8"); g.fillStyle = s; g.fillRect(0, 0, n, 256); }, 256));
  scene.fog = new THREE.Fog("#d5dde2", span * 3.5, span * 10);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  renderer.domElement.style.display = "block";
  holder.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
  holder.appendChild(labels.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = keep(pmrem.fromScene(room, 0.04)).texture;
  scene.environmentIntensity = 0.4;
  pmrem.dispose();
  room.dispose();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, span * 20);
  const away = span * 3.35, turn = 0.72, tilt = 0.64;  // high enough to see the floor of the pit over its near side
  camera.position.set(away * Math.sin(turn) * Math.cos(tilt), top * 0.3 + away * Math.sin(tilt), away * Math.cos(turn) * Math.cos(tilt));
  const wholeSite = { target: V(0, top * 0.3, 0), position: camera.position.clone() };
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(wholeSite.target);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 6;
  controls.maxDistance = span * 8;
  // first person: on foot at eye height, WASD and Space on the keyboard, drag to look. The orbit view is kept and restored on the way out
  const fp = { on: false, yaw: 0, pitch: 0, keys: new Set<string>(), savedPos: camera.position.clone(), savedTarget: wholeSite.target.clone(), drag: null as [number, number] | null, last: 0, vy: 0, air: false, jumpBase: 1.62, locked: false, hadLock: false, bob: 0 };
  const fpKeyDown = (ev: KeyboardEvent) => {
    if (!fp.on || !["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyE", "KeyQ"].includes(ev.code)) return;
    if ((ev.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (ev.code === "Space") ev.preventDefault();
    fp.keys.add(ev.code);
  };
  const fpKeyUp = (ev: KeyboardEvent) => { fp.keys.delete(ev.code); };
  // the mouse stays free in first person: drag on the model to look, click a part (or any button) to use it
  window.addEventListener("keydown", fpKeyDown);
  window.addEventListener("keyup", fpKeyUp);
  controls.update();

  scene.add(new THREE.HemisphereLight("#e6eef6", "#6e5d48", 0.95));
  const sun = new THREE.DirectionalLight("#fff2de", 2.5);
  sun.position.set(span * 0.5, span * 1.7, span * 1.15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const siteW = W + 30, siteD = D + 30, hw = W / 2 + 1.5, hd = D / 2 + 1.5, reach = Math.max(siteW, siteD) * 0.72;
  const edgeX = hw + deep * 0.8, edgeZ = hd + deep * 0.8;  // the pit at ground level, its sides cut back from the working space at its floor
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: span * 8 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  const tex = surfaces();
  for (const t of Object.values(tex)) keep(t);
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.02, ...extra }));
  const block = (w: number, h: number, d: number, size = 1) => keep(raw(w, h, d, size));
  const pickable: THREE.Mesh[] = [];
  const parts: ((day: number) => void)[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, ids: string[], x = 0, y = 0, z = 0, shadow = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.userData.ids = ids;
    if (ids.length) pickable.push(m);
    scene.add(m);
    return m;
  };
  const piece = (group: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const group = (x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.visible = false; scene.add(g); return g; };
  const grow = (m: THREE.Object3D, s: number, axis: "x" | "y" | "z" = "y") => { m.visible = s > 0; m.scale[axis] = Math.max(0.0001, s); };
  const clip = (m: THREE.Material, normal: THREE.Vector3) => { const plane = new THREE.Plane(normal, 0); m.clippingPlanes = [plane]; m.clipShadows = true; return plane; };
  /** The same thing at many places: columns, piles, roof trusses. Each is shown or hidden on its own. */
  const many = (geometry: THREE.BufferGeometry, material: THREE.Material, ids: string[], points: { x: number; z: number }[], y: number) => {
    const m = keep(new THREE.InstancedMesh(geometry, material, points.length));
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.userData.ids = ids;
    if (ids.length) pickable.push(m);
    scene.add(m);
    const show = (i: number, on: boolean, at = y) => {
      dummy.position.set(points[i].x, at, points[i].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(on ? 1 : 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    };
    points.forEach((_, i) => show(i, false));
    return { show, done: () => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } };
  };
  const lines = (points: number[], material: THREE.LineBasicMaterial, x = 0) => {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const l = new THREE.LineSegments(g, material);
    l.position.x = x;
    scene.add(l);
    return l;
  };
  const ghosts: THREE.Object3D[] = [];
  const ghostMat = keep(new THREE.LineBasicMaterial({ color: "#53606e", transparent: true, opacity: 0.45 }));
  /** The finished building's outline, faint, so the end is in view from the first day. */
  const outline = (geometry: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const line = new THREE.LineSegments(keep(new THREE.EdgesGeometry(geometry)), ghostMat);
    line.position.set(x, y, z);
    scene.add(line);
    ghosts.push(line);
  };

  // what the parts tell each other, and the screen, on the day being drawn
  let today = 0, frameTop = 0;
  let notes: Note[] = [];
  let people: [number, number, number][] = [];
  let job: { x: number; y: number; z: number; load: Load } | null = null;
  let pourAt: { x: number; y: number; z: number } | null = null;
  const say = (work: El[], text: string, tag: string, x: number, y: number, z: number, pin = true) => { notes.push({ ids: idsOf(work), text, tag, at: V(x, y, z), pin }); };
  const crew = (n: number, x: number, y: number, z: number, w: number, d: number) => {
    for (let i = 0; i < n; i++) { const k = people.length + Math.floor(today / 2) * 31; people.push([x + (hash(k, 1) - 0.5) * w, y, z + (hash(k, 2) - 0.5) * d]); }
  };
  const hoist = (x: number, y: number, z: number, load: Load) => { if (!job) job = { x, y, z, load }; };
  const when = (test: (day: number) => boolean) => { for (let d = 0; d < model.days + 400; d++) if (test(d)) return d; return Infinity; };

  const grain = tex.grain;
  const concrete = () => mat(LOOK.concrete, { map: grain });
  const plyMat = mat("#ffffff", { map: tex.plywood }), meshMat = mat("#ffffff", { map: tex.mesh, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 });
  const cageMat = mat("#ffffff", { map: tex.cage, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 });
  const brickLook = mat("#ffffff", { map: tex.brick }), rustMat = mat(LOOK.rebar, { map: grain, metalness: 0.4 }), steelMat = mat("#b6bdc4", { metalness: 0.65, roughness: 0.42 });
  const yellow = mat("#e4a31b", { roughness: 0.5, metalness: 0.15 }), dark = mat("#26292d", { roughness: 0.75 }), white = mat("#e2e5e8", { roughness: 0.5 }), cabGlass = mat("#22303b", { metalness: 0.7, roughness: 0.15 });
  const stairRail = mat("#2a2e33", { metalness: 0.6, roughness: 0.4 });
  const glassMat = mat("#a9cce0", { transparent: true, opacity: 0.4, roughness: 0.04, metalness: 0.25 });

  // ---------------------------------------------------------------------------------------------- the ground: grass, then soil once work starts, then planted as the external works finish
  const rect = (w: number, d: number) => [v2(-w / 2, -d / 2), v2(w / 2, -d / 2), v2(w / 2, d / 2), v2(-w / 2, d / 2)];
  const hole = (w: number, d: number) => new THREE.Path(rect(w, d).reverse());
  const flat = (shape: THREE.Shape, material: THREE.Material, y: number) => {
    const g = keep(new THREE.ShapeGeometry(shape)), uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 5, uv.getY(i) / 5);
    const m = new THREE.Mesh(g, material);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const land = new THREE.Shape(rect(siteW * 8, siteD * 8));
  land.holes.push(hole(siteW, siteD));
  flat(land, mat("#7d9a5c", { map: grain }), -0.02);
  const siteShape = new THREE.Shape(rect(siteW, siteD));
  if (pit) siteShape.holes.push(hole(edgeX * 2, edgeZ * 2));
  const siteMat = mat("#7d9a5c", { map: grain });
  flat(siteShape, siteMat, 0);
  // the street the site opens on to
  add(block(siteW * 8, 0.03, 9, 3), mat("#55585b", { map: grain }), [], 0, -0.01, siteD / 2 + 7, false);
  add(block(siteW * 8, 0.14, 2, 1), mat("#b9b8b2", { map: tex.paving }), [], 0, 0, siteD / 2 + 1.6, false);
  add(keep(fuse(Array.from({ length: 40 }, (_, i) => raw(2.2, 0.01, 0.16).translate(-siteW * 1.5 + i * (siteW * 3 / 40), 0.03, 0)))), mat("#d9d9d4"), [], 0, 0, siteD / 2 + 7, false);
  const working = els.filter((e) => e.kind !== "other"), firstWork = working.length ? Math.min(...working.map((e) => e.start)) : 0;
  const external = of("external");
  const grass = new THREE.Color("#7d9a5c"), soil = new THREE.Color("#7f6549"), planted = new THREE.Color("#6f9a50");
  parts.push((day) => { siteMat.color.copy(day < firstWork ? grass : soil); if (external.length) siteMat.color.lerp(planted, clamp((together(external, day) - 0.55) / 0.45)); });

  // ---------------------------------------------------------------------------------------------- site set-up: the fence, then the offices, the project board and the material yard
  const setup = of("site");
  const officeX = -siteW / 2 + 7, officeZ = siteD / 2 - 5, gate = [4, 12];
  if (setup.length) {
    const ids = idsOf(setup), from = Math.min(...setup.map((e) => e.start)), until = Math.max(...setup.map((e) => e.end)), H = 2.4;
    const zinc = mat("#3f78ae", { map: tex.zinc, roughness: 0.5, metalness: 0.25 });
    const fence = [add(block(siteW, H, 0.08), zinc, ids, 0, 0, -siteD / 2), add(block(0.08, H, siteD), zinc, ids, -siteW / 2, 0, 0), add(block(0.08, H, siteD), zinc, ids, siteW / 2, 0, 0),
      add(block(siteW / 2 + gate[0], H, 0.08), zinc, ids, (-siteW / 2 + gate[0]) / 2, 0, siteD / 2), add(block(siteW / 2 - gate[1], H, 0.08), zinc, ids, (siteW / 2 + gate[1]) / 2, 0, siteD / 2)];
    const office = group(officeX, 0, officeZ), door = mat("#2c5f94");
    for (const y of [0, 2.65]) {
      piece(office, block(6, 2.6, 2.4), white, 0, y, 0);
      piece(office, block(1.3, 1, 0.04), cabGlass, -1.6, y + 1.1, 1.21);
      piece(office, block(1.3, 1, 0.04), cabGlass, 0.3, y + 1.1, 1.21);
      piece(office, block(0.9, 2.05, 0.04), door, 2.1, y, 1.21);
    }
    piece(office, keep(fuse(Array.from({ length: 10 }, (_, i) => raw(0.9, 0.06, 0.3).translate(3.5, 0.27 * i, 1.4 - i * 0.26)))), dark);
    piece(office, block(1.1, 0.08, 1.3), dark, 3.5, 2.65, -1.2);
    const board = group(-1, 0, siteD / 2 - 1.2);
    for (const x of [-2.3, 2.3]) piece(board, block(0.14, 3.6, 0.14), dark, x, 0, -0.05);
    piece(board, block(5.1, 2.65, 0.06), dark, 0, 2.05, -0.05);
    const signTexture = keep(signBoard(model.plan?.title || "Proyek"));
    signTexture.wrapS = signTexture.wrapT = THREE.ClampToEdgeWrapping;
    const face = piece(board, keep(new THREE.PlaneGeometry(5, 2.6)), mat("#ffffff", { map: signTexture, roughness: 0.6 }), 0, 3.37, -0.01);
    face.castShadow = false;
    const yard = group(-4, 0, -siteD / 2 + 5);
    piece(yard, block(7, 0.4, 1.6), rustMat, 0, 0.12, 0);
    for (const x of [-2.8, 0, 2.8]) piece(yard, block(0.2, 0.12, 1.8), dark, x, 0, 0);
    piece(yard, block(2.4, 0.9, 1.2), plyMat, 5.6, 0, 0);
    piece(yard, block(2.4, 0.5, 1.2), plyMat, 5.6, 0.9, 0.05);
    for (const x of [-5.6, -7.1, -8.6]) piece(yard, block(1.2, 1.05, 1.2), brickLook, x, 0, 0);
    parts.push((day) => {
      const on = day >= from && day < until, mob = clamp((day + 1 - from) / Math.min(14, Math.max(2, (until - from) * 0.1)));
      fence.forEach((m, i) => { m.visible = on && clamp(mob / 0.6) * fence.length > i; });
      office.visible = on && mob >= 0.6;
      board.visible = on && mob >= 0.8;
      yard.visible = on && mob >= 1;
      if (!on) return;
      if (mob < 1) {
        say(setup, setup.length > 1 ? "" : "Mobilising: fencing the site, then the site offices, the project board and the material yard", setup.length > 1 ? "Site set-up" : "Fencing and site offices", officeX, 6.5, officeZ);
        crew(4, officeX + 6, 0, officeZ - 2, 12, 5);
      } else if (setup.length === 1) say(setup, "Site running: fence, offices, the material yard and site safety (SMKK) are in place", "", officeX, 6.5, officeZ, false);
    });
  }

  // ---------------------------------------------------------------------------------------------- the machines
  const wheel = keep(new THREE.CylinderGeometry(0.5, 0.5, 0.42, 14).rotateX(Math.PI / 2));
  const arm = (length: number, t: number) => keep(new THREE.BoxGeometry(length, t, t).translate(length / 2, 0, 0));
  const truck = () => {
    const g = group();
    piece(g, block(7, 0.4, 2.2), dark, 0, 0.75, 0);
    piece(g, block(1.9, 1.95, 2.35), white, 2.5, 1.1, 0);
    piece(g, block(0.05, 0.85, 2.1), cabGlass, 3.46, 2, 0);
    for (const x of [2.5, -1.3, -2.6]) for (const z of [1.05, -1.05]) piece(g, wheel, dark, x, 0.5, z);
    return g;
  };
  const excavator = () => {
    const g = group();
    for (const z of [1, -1]) piece(g, block(3.7, 0.85, 0.72), dark, 0, 0, z);
    piece(g, block(3, 1, 2.5), yellow, -0.3, 0.85, 0);
    piece(g, block(1.15, 1.35, 1), yellow, 0.55, 1.85, 0.65);
    piece(g, block(0.04, 0.85, 0.85), cabGlass, 1.14, 2.2, 0.65);
    const boom = new THREE.Group();
    boom.position.set(1, 1.7, -0.25);
    boom.rotation.z = 0.62;
    g.add(boom);
    piece(boom, arm(3.6, 0.42), yellow);
    const stick = new THREE.Group();
    stick.position.x = 3.6;
    stick.rotation.z = -1.85;
    boom.add(stick);
    piece(stick, arm(2.4, 0.32), yellow);
    const bucket = piece(stick, block(0.75, 0.7, 1), dark, 2.5, -0.4, 0);
    bucket.rotation.z = 0.4;
    return { g, boom, stick };
  };
  const digger = excavator(), dumper = truck();
  piece(dumper, block(4.1, 1.25, 2.35), yellow, -1.15, 1.15, 0);
  piece(dumper, block(3.9, 0.45, 2.1), mat("#6f533a", { map: grain }), -1.15, 2.35, 0);

  // ---------------------------------------------------------------------------------------------- earthworks: the basement pit, dug zone by zone from the top down, the soil trucked away. Without a basement, the ground is stripped
  const digs = of("earthworks").sort((a, b) => a.start - b.start), dig = digs[0], fills = digs.slice(1), fdn = of("foundation");
  const pilingFrom = fdn.length ? Math.min(...fdn.map((e) => e.start)) : Infinity;
  const digEnd = dig && pilingFrom > dig.start && pilingFrom < dig.end ? pilingFrom : dig?.end ?? 0;  // the digging and its inspection finish before the piling starts. What else the package holds runs on
  const zone = 2 * edgeX / nx, dugOut: number[] = xs.slice(1).map(() => (pit && dig ? 0 : 1));  // how far each zone is dug
  const zoneOf = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x + edgeX) / zone)));
  const soilAt = (x: number) => (pit ? footing + deep * (1 - dugOut[zoneOf(x)]) : 0);  // the ground's level there, as the dig stands
  const soilMat = mat("#86694c", { map: grain });
  if (pit) {
    const ids = dig ? [dig.id] : [], faceMat = mat("#6d543c", { map: grain, side: THREE.DoubleSide });
    const bottom = add(block(hw * 2, 0.06, hd * 2), mat("#6b655c", { map: grain }), [], 0, footing - 0.06, 0, false);
    // the pit's sides are cut back at a slope, as an open cut is, which also keeps its floor in view from above
    const toe = (a: number, b: number) => [a * hw, footing, b * hd], crest = (a: number, b: number) => [a * edgeX, 0, b * edgeZ];
    const slope = keep(new THREE.BufferGeometry()), corners: [number, number][] = [[-1, 1], [1, 1], [1, -1], [-1, -1], [-1, 1]];
    slope.setAttribute("position", new THREE.Float32BufferAttribute(corners.slice(0, 4).flatMap(([a, b], i) => { const [c, d] = corners[i + 1]; return [...toe(a, b), ...toe(c, d), ...crest(c, d), ...toe(a, b), ...crest(c, d), ...crest(a, b)]; }), 3));
    slope.setAttribute("uv", new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [0, 0, 8, 0, 8, 2, 0, 0, 8, 2, 0, 2]).flat(), 2));
    slope.computeVertexNormals();
    const faces = [add(slope, faceMat, [], 0, 0, 0, false)];
    const zones = dugOut.map((_, k) => add(block(zone, deep, edgeZ * 2), siteMat, ids, -edgeX + (k + 0.5) * zone, footing, 0));
    parts.push((day) => {
      const p = dig ? clamp((day + 1 - dig.start) / Math.max(1, digEnd - dig.start)) : 1, on = !!dig && busy([dig], day);
      bottom.visible = p > 0;
      for (const f of faces) f.visible = p > 0;
      let k = -1;
      zones.forEach((z, i) => {
        const t = spread(p, i, nx);
        dugOut[i] = t;
        grow(z, 1 - t);
        z.material = t > 0 ? soilMat : siteMat;
        if (t > 0 && t < 1 && k < 0) k = i;
      });
      digger.g.visible = dumper.visible = on && k >= 0;
      if (on && k >= 0 && dig) {
        const x = Math.max(-hw + 2.5, Math.min(hw - 2.5, -edgeX + (k + 0.5) * zone)), y = footing + deep * (1 - dugOut[k]);
        digger.g.position.set(x, y, hd - 3.6);
        digger.boom.rotation.z = 0.5 + 0.25 * Math.sin(day * 2.1);
        digger.stick.rotation.z = -1.9 + 0.35 * Math.sin(day * 1.3);
        dumper.position.set(x, 0, edgeZ + 2.2);
        say([dig], `Digging the basement pit, zone ${k + 1} of ${nx} (${bayName(k)}), now ${(deep * dugOut[k]).toFixed(1)} m down. The soil is trucked away`, "Digging the pit", x, y + 3.6, hd - 3.6);
        crew(2, x, y, 0, zone * 0.7, hd);
      } else if (on && dig) {
        say([dig], "The pit is dug and inspected. Filling, compacting and testing its floor", "Compacting the pit floor", 0, footing + 1, 0);
        crew(3, 0, footing, 0, W * 0.7, D * 0.7);
      }
    });
  } else if (dig) {
    const cut = add(block(W + 3, 0.05, D + 3), soilMat, [dig.id], 0, 0, 0, false);
    parts.push((day) => {
      grow(cut, progressOf(dig, day), "x");
      const on = busy([dig], day);
      digger.g.visible = dumper.visible = on;
      if (on) {
        const x = (W + 3) * (progressOf(dig, day) - 0.5);
        digger.g.position.set(x, 0, 0);
        dumper.position.set(x, 0, hd + 3.3);
        say([dig], digs.length > 1 ? "" : "Stripping and levelling the ground under the building", digs.length > 1 ? brief(dig.name) : "Levelling the ground", x, 4, 0);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------- where the stairs and the lift stand: two stairs, one at each end by the long sides, and the lift beside the first.
  // Each runs in a dog-leg: a flight from the floor to a half landing by the outside wall, and a flight back up to the next floor. Assumed: the drawings read do not show where they are
  const STAIR_W = 2.8, RUN = 3.2, LANDING = 1.4, ARRIVE = 1.2, zF = D / 2 - 0.35, lastFloor = floors.length ? floors[floors.length - 1].index : 0;
  const stairs = floors.length > 1 ? [{ x: W / 2 - 0.3 - STAIR_W, z: zF, turn: 0 }, { x: -W / 2 + 0.3 + STAIR_W, z: -zF, turn: Math.PI }] : [];
  const stairVoids = [[W / 2 - 0.3 - STAIR_W, zF - LANDING - RUN, W / 2 - 0.3, zF], [-W / 2 + 0.3, -zF, -W / 2 + 0.3 + STAIR_W, -zF + LANDING + RUN]].slice(0, stairs.length);
  const stairWells = stairs.length ? [[W / 2 - 0.3 - STAIR_W, zF - LANDING - RUN - ARRIVE, W / 2 - 0.3, zF], [-W / 2 + 0.3, -zF, -W / 2 + 0.3 + STAIR_W, -zF + LANDING + RUN + ARRIVE]] : [];
  const liftOn = !!model.lift || of("lift").length > 0, liftX = W / 2 - 0.3 - STAIR_W - 0.3 - 2.4, liftVoid = [liftX, zF - 2.4, liftX + 2.4, zF];
  const voidsAt = (index: number, suspended: boolean) => (suspended ? [...(index <= lastFloor ? stairVoids : []), ...(liftOn ? [liftVoid] : [])] : []);
  // the top of the stair steps at a point: each flight fills its half of the stairwell, stepped as it is drawn (not a smooth slope through the steps)
  const fpStairHeights = (x: number, z: number) => {
    const heights: number[] = [];
    floors.forEach((f, i) => {
      if (i === floors.length - 1 || !f.height) return;
      const H = f.height, n = Math.max(3, Math.ceil(H / 2 / 0.175)), r = (H / 2) / n;
      for (const st of stairs) {
        const lx = st.turn ? st.x - x : x - st.x, lz = st.turn ? st.z - z : z - st.z;
        if (lx < 0 || lx > STAIR_W || lz < -LANDING - RUN || lz > 0) continue;
        if (lz >= -LANDING) heights.push(f.elevation + H / 2);
        else { const s = (lz + LANDING + RUN) / RUN; heights.push(lx >= STAIR_W / 2 ? f.elevation + Math.min(n, Math.floor(s * n) + 1) * r : f.elevation + H / 2 + Math.min(n, Math.floor((1 - s) * n) + 1) * r); }
      }
    });
    return heights;
  };
  // the floor somebody in first person stands on: the highest slab, stair flight, landing or ground at or just above their feet
  const fpFloor = (x: number, z: number, feet: number) => {
    const cand = [pit && Math.abs(x) < edgeX && Math.abs(z) < edgeZ ? footing : 0];
    const inside = Math.abs(x) <= W / 2 + 0.15 && Math.abs(z) <= D / 2 + 0.15, inRect = (r: number[]) => x >= r[0] && z >= r[1] && x <= r[2] && z <= r[3];
    if (inside) {
      floors.forEach((f, rank) => { if (!voidsAt(f.index, rank > 0).some(inRect)) cand.push(f.elevation); });
      if (!voidsAt(roofIndex, true).some(inRect)) cand.push(top);
      cand.push(...fpStairHeights(x, z));
    }
    const under = cand.filter((c) => c <= feet + 0.55);
    return under.length ? Math.max(...under) : Math.min(...cand);
  };
  /** A flat plate with holes cut in it, its top at y = 0. */
  const plate = (w: number, d: number, t: number, holes: number[][]) => {
    const shape = new THREE.Shape([v2(-w / 2, -d / 2), v2(w / 2, -d / 2), v2(w / 2, d / 2), v2(-w / 2, d / 2)]);
    for (const [x0, z0, x1, z1] of holes) shape.holes.push(new THREE.Path([v2(x0, z0), v2(x0, z1), v2(x1, z1), v2(x1, z0)]));
    return new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false }).rotateX(Math.PI / 2);
  };

  // ---------------------------------------------------------------------------------------------- structure, floor by floor. On each bay of a slab: props and formwork, rebar, then concrete poured from the back to the front.
  // Then the columns up to the next floor: rebar cages, formwork, concrete. A basement also gets its retaining walls. A floor the WBS does not name was there before the plan
  const structure = of("structure"), loose = structure.filter((e) => e.level === null);
  const roofIndex = (floors.length ? floors[floors.length - 1].index : 0) + 1;
  const levels = [...floors.map((f) => ({ index: f.index, name: f.name, elevation: f.elevation, height: f.height, planned: f.planned })), { index: roofIndex, name: "Roof slab", elevation: top, height: 0, planned: true }];
  const ready = new Map<number, number>(), progressAt = new Map<number, (day: number) => number>(), upAtOf = new Map<number, (day: number) => number>(), idsAt = new Map<number, string[]>();  // how far each floor's structure is, for the work that has to wait for it
  const after = (index: number, s: number) => ((ready.get(index) ?? 1) >= 0.999 ? s : 0);
  const fresh = new THREE.Color(LOOK.fresh), cured = new THREE.Color(LOOK.concrete);
  const columns = xs.flatMap((x) => zs.map((z) => ({ x, z })));
  const propMat = keep(new THREE.LineBasicMaterial({ color: "#c4532d" })), blindMat = mat("#77736c", { map: grain });
  const deckGeo = block(bayW - 0.04, 0.05, D + 0.4), meshGeo = block(bayW - 0.1, 0.02, D + 0.2), blindGeo = block(bayW, pit ? lowest - 0.3 - footing : 0.06, D + 0.4);
  const slabs = new Map<string, THREE.BufferGeometry>();
  const holesIn = (k: number, rects: number[][]) => {  // the holes that fall in bay k, in its own frame
    const cx = -W / 2 + (k + 0.5) * bayW, lo = -bayW / 2 + 0.05, hi = bayW / 2 - 0.05;
    return rects.map(([x0, z0, x1, z1]) => [Math.max(lo, x0 - cx), z0, Math.min(hi, x1 - cx), z1]).filter(([a, , b]) => b - a > 0.2);
  };
  const slabOf = (k: number, suspended: boolean, holes: number[][]) => {
    const key = `${suspended}${k === 0}${JSON.stringify(holes)}`;
    if (!slabs.has(key)) {
      const list = [holes.length ? plate(bayW, D + 0.4, 0.3, holes) : raw(bayW, 0.3, D + 0.4).translate(0, -0.3, 0)];
      if (suspended) {  // the beams on the grid lines, under the slab
        for (const z of zs) list.push(raw(bayW, 0.6, 0.35).translate(0, -0.9, z));
        list.push(raw(0.35, 0.6, D).translate(bayW / 2, -0.9, 0));
        if (k === 0) list.push(raw(0.35, 0.6, D).translate(-bayW / 2, -0.9, 0));
      }
      slabs.set(key, keep(fuse(list)));
    }
    return slabs.get(key)!;
  };
  const propsOf = (low: number, high: number) => {
    const points: number[] = [], a = Math.max(2, Math.round(bayW / 1.2)), b = Math.max(2, Math.round((D + 0.4) / 1.2));
    const px = (i: number) => -bayW / 2 + ((i + 0.5) * bayW) / a, pz = (j: number) => -(D + 0.4) / 2 + ((j + 0.5) * (D + 0.4)) / b;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) points.push(px(i), low, pz(j), px(i), high, pz(j));
    for (const y of [low + (high - low) * 0.35, low + (high - low) * 0.75]) {
      for (let i = 0; i < a; i++) points.push(px(i), y, pz(0), px(i), y, pz(b - 1));
      for (let j = 0; j < b; j++) points.push(px(0), y, pz(j), px(a - 1), y, pz(j));
    }
    return points;
  };
  const COLUMN = /kolom|column/i, STAIR = /tangga|stair/i, SLAB = /\bplat\b|pelat|slab/i, startOf = (list: El[]) => Math.min(...list.map((e) => e.start));
  const stairsAlone = (e: El) => STAIR.test(e.name) && !SLAB.test(e.name);  // "Balok Plat Tangga Ground" is the slab as well
  // a plan may name a floor's columns apart from its slab. Finished before the slab of the same floor starts, they rise to that slab, as "Level 4 columns" then "Level 4 slab". Otherwise they rise from it,
  // and always where the lowest floor names columns: nothing stands under it
  const fromTheirFloor = structure.some((e) => e.level === levels[0].index && COLUMN.test(e.name));
  const planned = levels.map((f) => {
    const own = structure.filter((e) => e.level === f.index && !stairsAlone(e)), cols = own.filter((e) => COLUMN.test(e.name)), rest = own.filter((e) => !COLUMN.test(e.name));
    return { own, cols, rest, under: !fromTheirFloor && cols.length > 0 && rest.length > 0 && Math.max(...cols.map((e) => e.end)) <= startOf(rest) };
  });
  const trussed = pitched && of("roof").length > 0 && !planned[planned.length - 1].own.length;  // a roof frame on the columns, with no roof slab named under it
  const brief = (text: string) => (text.length > 30 ? `${text.slice(0, 29)}…` : text);
  levels.forEach((f, rank) => {
    const { own, cols, rest, under } = planned[rank];
    const colWork = planned[rank + 1]?.under ? planned[rank + 1].cols : under ? [] : cols;  // the columns that stand on this floor's slab
    const parted = cols.length > 0 || colWork.length > 0, steps = own.length > 1 || parted;  // a plan that splits a floor into steps says in their names what is being done
    const drivers = own.length ? own : f.index === roofIndex && !trussed && !planned[rank - 1]?.under ? planned[rank - 1]?.own ?? [] : [];
    const work = steps ? [...rest, ...colWork] : drivers.length ? drivers : loose, ids = idsOf(steps && rest.length ? rest : work), colIds = idsOf(steps && colWork.length ? colWork : work), below = levels[rank - 1], suspended = !!below, y = f.elevation;
    const existing = !drivers.length && !loose.length && !f.planned;
    const whole = (day: number) => (existing ? 1 : drivers.length ? (f.index === roofIndex && !structure.some((e) => e.level === roofIndex) ? clamp((together(drivers, day) - 0.85) / 0.15) : together(drivers, day)) : spread(together(loose, day), rank, levels.length));
    const slabAt = (day: number) => (!parted ? clamp(whole(day) / 0.55) : rest.length ? together(rest, day) : together(colWork, day) > 0 ? 1 : 0);
    const upAt = (day: number) => (!parted ? clamp((whole(day) - 0.55) / 0.45) : colWork.length ? together(colWork, day) : 0);
    const prog = (day: number) => (!parted ? whole(day) : Math.min(slabAt(day), colWork.length ? upAt(day) : 1));
    progressAt.set(f.index, prog);
    upAtOf.set(f.index, upAt);
    idsAt.set(f.index, colIds);
    // a bay's step comes from the names where the plan names its steps: formwork, rebar and the pour may each be a package. Otherwise each bay goes through all three in its turn
    const STEPS = [/form|bekisting/i, /rebar|pembesian|tulangan/i, /pour|pengecoran|\bcor\b/i];  // a package naming them all is not one step of them
    const [forms, bars, pours] = STEPS.map((words) => rest.filter((e) => words.test(e.name) && STEPS.filter((w) => w.test(e.name)).length === 1));
    const bayAt = (day: number, k: number) => {
      const slab = slabAt(day);
      if (!forms.length && !bars.length && !pours.length) return clamp(slab * nx - k);
      if (slab >= 1) return 1;
      const poured = together(pours, day), fixed = together(bars, day);
      return poured > 0 ? 0.6 + 0.4 * spread(poured, k, nx) : fixed > 0 ? 0.3 + 0.3 * spread(fixed, k, nx) : 0.3 * spread(together(forms, day), k, nx);
    };
    const voids = voidsAt(f.index, suspended);
    const bays = Array.from({ length: nx }, (_, k) => {
      const x = -W / 2 + (k + 0.5) * bayW, m = concrete(), pour = clip(m, V(0, 0, -1)), holes = holesIn(k, voids);
      return {
        k, x, m, pour,
        concrete: add(slabOf(k, suspended, holes), m, ids, x, y, 0),
        deck: suspended ? (holes.length ? add(keep(plate(bayW - 0.04, D + 0.4, 0.05, holes)), plyMat, ids, x, y - 0.3, 0) : add(deckGeo, plyMat, ids, x, y - 0.35, 0)) : add(blindGeo, blindMat, ids, x, pit ? footing : y - 0.36, 0),
        props: suspended ? lines(propsOf(below.elevation, y - 0.35), propMat, x) : null,
        rebar: holes.length ? add(keep(plate(bayW - 0.1, D + 0.2, 0.02, holes)), meshMat, ids, x, y - 0.08, 0, false) : add(meshGeo, meshMat, ids, x, y - 0.1, 0, false),
        done: when((d) => bayAt(d, k) >= 1),
      };
    });
    const h = f.height ? f.height - 0.3 : 0, colMat = concrete();
    const posts = h ? { cage: many(block(0.5, h, 0.5, 0.5), cageMat, colIds, columns, y), form: many(block(0.8, h, 0.8), plyMat, colIds, columns, y), cast: many(block(0.6, h, 0.6), colMat, colIds, columns, y) } : null;
    const sides: [number, number, number, number][] = f.index < 0 ? [[W, 0.3, 0, D / 2], [W, 0.3, 0, -D / 2], [0.3, D, W / 2, 0], [0.3, D, -W / 2, 0]] : [];
    const retaining = sides.map(([w, d, x, z]) => ({ cage: add(block(w, h, d), meshMat, colIds, x, y, z, false), form: add(block(w + 0.15, h, d + 0.15), plyMat, colIds, x, y, z), cast: add(block(w, h, d), colMat, colIds, x, y, z) }));
    const parapet = f.index === roofIndex && !pitched ? [add(block(W, 1, 0.2), colMat, ids, 0, y, D / 2 + 0.1), add(block(W, 1, 0.2), colMat, ids, 0, y, -D / 2 - 0.1), add(block(0.2, 1, D + 0.4), colMat, ids, W / 2 + 0.1, y, 0), add(block(0.2, 1, D + 0.4), colMat, ids, -W / 2 - 0.1, y, 0)] : [];
    if (f.height) outline(keep(new THREE.BoxGeometry(W, f.height, D)), 0, y + f.height / 2, 0);
    const castAt = when((d) => upAt(d) >= 1), unnamed = !own.length && f.index === roofIndex && (planned[rank - 1]?.own.length ?? 0) > 1;
    const next = levels[rank + 1]?.name ?? "";
    parts.push((day) => {
      const p = prog(day), slab = slabAt(day), up = upAt(day), on = busy(work, day);
      ready.set(f.index, f.index === roofIndex && !drivers.length && !loose.length ? ready.get(lastFloor) ?? 1 : p);  // with no slab of its own, the roof waits on the floor below
      let active: (typeof bays)[number] | null = null, tActive = 0;
      for (const b of bays) {
        const t = !rank && pit && dugOut[zoneOf(b.x)] < 1 ? 0 : bayAt(day, b.k);
        b.concrete.visible = t >= 0.6;
        b.pour.constant = -D / 2 - 0.5 + (D + 1) * clamp((t - 0.6) / 0.4);
        b.deck.visible = t > 0 && (!suspended || day < b.done + 14);  // the props stay two weeks after the pour, while the concrete gains strength
        if (b.props) b.props.visible = b.deck.visible;
        b.rebar.visible = t >= 0.3 && t < 1;
        b.m.color.copy(fresh).lerp(cured, clamp((day - b.done) / 21));
        if (t > 0 && t < 1 && !active) { active = b; tActive = t; }
      }
      if (posts) {
        columns.forEach((_, j) => {
          const u = clamp(up * 1.6 - (0.6 * j) / Math.max(1, columns.length - 1));
          posts.cage.show(j, u > 0 && u < 0.7);
          posts.form.show(j, u >= 0.35 && u < 0.7);
          posts.cast.show(j, u >= 0.7);
        });
        posts.cage.done(); posts.form.done(); posts.cast.done();
      }
      colMat.color.copy(fresh).lerp(cured, clamp((day - castAt) / 21));
      for (const r of retaining) { r.cage.visible = up > 0 && up < 0.75; r.form.visible = up >= 0.4 && up < 0.75; r.cast.visible = up >= 0.75; }
      for (const c of parapet) c.visible = slab >= 1;
      if (f.index >= 0 && p > 0) frameTop = Math.max(frameTop, y + h * up);
      if (!on) return;
      const pourZ = -D / 2 + D * clamp((tActive - 0.6) / 0.4), rising = !active && h > 0 && up > 0 && up < 1;
      if (active) {
        if (tActive < 0.3) hoist(active.x, y, 0, "forms");
        else if (tActive < 0.6) hoist(active.x, y, 0, "rebar");
        else if (!pourAt) pourAt = { x: active.x, y, z: pourZ };
        crew(tActive < 0.3 ? 6 : tActive < 0.6 ? 8 : 6, active.x, y, tActive < 0.6 ? 0 : pourZ, bayW * 0.8, tActive < 0.6 ? D * 0.8 : 3);
      } else if (rising) {
        const c = columns[Math.min(columns.length - 1, Math.floor(up * columns.length))];
        hoist(c.x, y + h * (up < 0.75 ? 0.5 : 1), c.z, up < 0.4 ? "rebar" : up < 0.75 ? "forms" : "bucket");
        crew(5, 0, y, 0, W * 0.85, D * 0.85);
      }
      if (unnamed) return;
      if (steps) {  // the names say it: only where
        for (const e of work) if (busy([e], day)) {
          const isCol = colWork.includes(e);
          say([e], "", brief(e.name), isCol || !active ? 0 : active.x, isCol ? y + h * 0.6 : y + 0.5, isCol ? D / 2 : active && tActive >= 0.6 ? pourZ : 0);
        }
        return;
      }
      if (active) {
        const where = `bay ${active.k + 1} of ${nx} (${bayName(active.k)})`, x = active.x;
        if (tActive < 0.3) say(work, `${f.name}: ${suspended ? "props and formwork under the slab" : pit ? "compacted fill and blinding under the slab" : "blinding and edge forms for the slab"}, ${where}`, suspended ? "Props and formwork" : pit ? "Fill and blinding" : "Blinding and edge forms", x, y + 0.5, 0);
        else if (tActive < 0.6) say(work, `${f.name}: fixing the slab and beam rebar, ${where}`, "Fixing the rebar", x, y + 0.5, 0);
        else say(work, `${f.name}: pouring the slab concrete, ${where}. The pump reaches in from the street side`, "Pouring concrete", x, y + 0.5, pourZ);
      } else if (slab < 1) {
        say(work, `${f.name}: the slab waits for the dig to reach the next zone`, "Waiting for the dig", 0, y + 1, 0);
      } else if (rising) {
        const what = f.index < 0 ? "retaining walls and columns" : "columns";
        if (up < 0.4) say(work, `${f.name}: rebar cages for the ${what}, up to ${next}`, "Column rebar", 0, y + h, D / 2);
        else if (up < 0.75) say(work, `${f.name}: formwork round the ${what}, up to ${next}`, "Column formwork", 0, y + h, D / 2);
        else say(work, `${f.name}: concrete in the ${what}, then the forms come off`, "Casting columns", 0, y + h, D / 2);
      } else say(work, `${f.name}: the structure of this floor is finished`, "", 0, y + 0.5, 0, false);
    });
  });

  if (trussed && floors.length) {
    const ring = add(keep(fuse([...zs.map((z) => raw(W + 0.35, 0.6, 0.35).translate(0, top - 0.6, z)), ...xs.map((x) => raw(0.35, 0.6, D).translate(x, top - 0.6, 0))])), concrete(), idsAt.get(lastFloor) ?? []);
    parts.push(() => { ring.visible = (ready.get(lastFloor) ?? 1) >= 1; });
  }

  // ---------------------------------------------------------------------------------------------- the stairs and the lift. Each floor's flights are cast with its columns, or by the plan's own stair packages.
  // The lift shaft rises with the frame, a door opening on every floor, and stands proud of a flat roof
  const stairMat = mat("#b3b7bb", { map: grain }), railMat = stairRail, stairGeo = new Map<number, THREE.BufferGeometry>(), railGeo = new Map<number, THREE.BufferGeometry>();
  const flight = (n: number, rise: number, going: number, width: number) => {
    const points = [v2(0, -0.18)];
    for (let i = 0; i < n; i++) points.push(v2(i * going, (i + 1) * rise), v2((i + 1) * going, (i + 1) * rise));
    points.push(v2(n * going, n * rise - 0.18));
    return new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: width, bevelEnabled: false });
  };
  const storeyStair = (H: number) => {  // in its own frame: across x from 0 to STAIR_W, the half landing at z = 0 by the outside wall, the flights back from it
    if (!stairGeo.has(H)) {
      const n = Math.max(3, Math.ceil(H / 2 / 0.175)), r = H / 2 / n, g = RUN / n, w = (STAIR_W - 0.3) / 2;
      stairGeo.set(H, keep(fuse([flight(n, r, g, w).rotateY(-Math.PI / 2).translate(STAIR_W, 0, -LANDING - RUN), flight(n, r, g, w).rotateY(Math.PI / 2).translate(0, H / 2, -LANDING),
        raw(STAIR_W, 0.2, LANDING).translate(STAIR_W / 2, H / 2 - 0.2, -LANDING / 2)])));
      // the steel balustrade along the inner edge of both flights and round the half landing, which is what makes a stair read as one from outside
      const a = STAIR_W - w, b = w, lo = -LANDING - RUN, hi = -LANDING, list = [bar(V(a, 0.9, lo), V(a, H / 2 + 0.9, hi), 0.05), bar(V(b, H / 2 + 0.9, hi), V(b, H + 0.9, lo), 0.05), bar(V(b, H / 2 + 0.9, hi), V(a, H / 2 + 0.9, hi), 0.05)];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4, z = lo + (hi - lo) * t;
        list.push(bar(V(a, (H / 2) * t, z), V(a, (H / 2) * t + 0.9, z), 0.03), bar(V(b, H - (H / 2) * t, z), V(b, H - (H / 2) * t + 0.9, z), 0.03));
      }
      railGeo.set(H, keep(fuse(list)));
    }
    return stairGeo.get(H)!;
  };
  floors.forEach((f, i) => {
    const work = structure.filter((e) => e.level === f.index && STAIR.test(e.name)), only = work.filter(stairsAlone);
    if (i === floors.length - 1 || !f.height) {  // the top floor's stairs go no higher, but a package may still name their last landing
      if (only.length && stairs.length) parts.push((day) => { for (const e of only) if (busy([e], day)) say([e], "", brief(e.name), stairs[0].x + STAIR_W / 2, f.elevation + 1, stairs[0].z - LANDING - RUN / 2); });
      return;
    }
    const ids = work.length ? idsOf(work) : idsAt.get(f.index) ?? [], geo = storeyStair(f.height), next = floors[i + 1].name;
    const flights = stairs.map((st) => {
      const form = add(geo, plyMat, ids, st.x, f.elevation, st.z), cast = add(geo, stairMat, ids, st.x, f.elevation, st.z), rail = add(railGeo.get(f.height)!, railMat, ids, st.x, f.elevation, st.z);
      form.rotation.y = cast.rotation.y = rail.rotation.y = st.turn;
      return { form, cast, rail };
    });
    parts.push((day) => {
      const s = work.length ? together(work, day) : upAtOf.get(f.index)?.(day) ?? 0, a = stairs[0];
      for (const fl of flights) { fl.form.visible = s > 0 && s < 0.6; fl.cast.visible = s >= 0.6; fl.rail.visible = s >= 1; }
      if (busy(work, day) && a) {
        const x = a.x + STAIR_W / 2, z = a.z - LANDING - RUN / 2, y = f.elevation + f.height / 2;
        if (busy(only, day)) say(only, `${f.name}: ${s < 0.6 ? "formwork and rebar for the stairs" : "casting the stairs"} up to ${next}, at both ends of the building`, "Stairs", x, y + 1, z);
        hoist(x, y, z, s < 0.6 ? "forms" : "bucket");
        crew(3, x, f.elevation, z, STAIR_W, RUN);
      }
    });
  });
  const lifts = of("lift");
  if (liftOn && floors.length) {
    const shaftOf = (h: number) => keep(fuse([raw(2.4, h, 0.2).translate(1.2, 0, -0.1), raw(0.2, h, 2.4).translate(0.1, 0, -1.2), raw(0.2, h, 2.4).translate(2.3, 0, -1.2),
      raw(0.7, h, 0.2).translate(0.35, 0, -2.3), raw(0.7, h, 0.2).translate(2.05, 0, -2.3), raw(1, Math.max(0.1, h - 2.2), 0.2).translate(1.2, Math.min(2.2, h - 0.1), -2.3)]));
    const liftMat = concrete(), ids = idsOf(lifts);
    const segments = floors.map((f, i) => {
      const last = i === floors.length - 1, h = last ? top - f.elevation + (pitched ? 0.5 : 1.8) : floors[i + 1].elevation - f.elevation, geo = shaftOf(h), own = ids.length ? ids : idsAt.get(f.index) ?? [];
      return { f, h, form: add(geo, plyMat, own, liftX, f.elevation, zF), cast: add(geo, liftMat, own, liftX, f.elevation, zF), cap: last && !pitched ? add(block(2.6, 0.2, 2.6), liftMat, own, liftX + 1.2, top + 1.8, zF - 1.2) : null };
    });
    parts.push((day) => {
      let high = lowest;
      for (const g of segments) {
        const up = upAtOf.get(g.f.index)?.(day) ?? 0;
        g.form.visible = up >= 0.35 && up < 0.7;
        g.cast.visible = up >= 0.7;
        if (g.cap) g.cap.visible = up >= 1;
        if (up >= 0.35) high = g.f.elevation + g.h;
      }
      for (const e of lifts) if (busy([e], day)) say([e], "", brief(e.name), liftX + 1.2, high + 0.5, zF - 1.2);
    });
  }

  // the concrete pump and the mixer feeding it, parked on the street side of the slab being poured
  const pump = truck(), mixer = truck(), boom = group(), pumpMat = mat("#d65a23", { roughness: 0.5, metalness: 0.15 });
  piece(pump, block(3.8, 0.9, 2.1), pumpMat, -1.2, 1.15, 0);
  const drum = piece(mixer, keep(new THREE.CylinderGeometry(1.05, 1.2, 3.8, 18).rotateZ(Math.PI / 2 - 0.16)), white, -1.3, 2.3, 0);
  drum.castShadow = true;
  const unit = keep(new THREE.BoxGeometry(0.34, 0.34, 1));
  const boomA = piece(boom, unit, pumpMat), boomB = piece(boom, unit, pumpMat), hose = piece(boom, keep(new THREE.CylinderGeometry(0.09, 0.09, 1, 8).translate(0, -0.5, 0)), dark);
  const span3 = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => { m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); m.scale.z = a.distanceTo(b); };
  parts.push(() => {
    pump.visible = mixer.visible = boom.visible = !!pourAt;
    if (!pourAt) return;
    const x = Math.max(-W / 2 + 4, Math.min(W / 2 - 4, pourAt.x)), z = edgeZ + 3.5;
    pump.position.set(x, 0, z);
    mixer.position.set(x + 8.6, 0, z + 0.5);
    const a = V(x - 1, 2.2, z), tip = V(pourAt.x, pourAt.y + 3, pourAt.z), mid = a.clone().lerp(tip, 0.5);
    mid.y += a.distanceTo(tip) * 0.28;
    span3(boomA, a, mid);
    span3(boomB, mid, tip);
    hose.position.copy(tip);
    hose.scale.y = 2.8;
  });

  // ---------------------------------------------------------------------------------------------- foundations: a pile bored at every column, then the pile caps and the tie beams between them, as the dig reaches each zone
  const piling = xs.flatMap((x, i) => (i % 2 ? [...zs].reverse() : zs).map((z) => ({ x, z, name: `${gridX(i)}${zs.indexOf(z) + 1}` })));
  if (fdn.length) {
    const ids = idsOf(fdn), headMat = concrete(), capMat = concrete(), N = piling.length;
    const heads = many(keep(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14).translate(0, 0.45, 0)), headMat, ids, piling, footing);  // their heads stand proud of the floor, to be cut down into the caps
    const casings = many(keep(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 14).translate(0, 0.25, 0)), steelMat, ids, piling, 0);
    const verb = model.pile === "driven" ? "Driving" : model.pile === "bored" ? "Boring" : "";
    const capWork = fdn.filter((e) => /pile ?cap|poer/i.test(e.name)), pileWork = fdn.filter((e) => !capWork.includes(e) && /pile|tiang|pancang/i.test(e.name));
    const parted = capWork.length > 0 || pileWork.length > 0, others = parted ? fdn.filter((e) => !capWork.includes(e) && !pileWork.includes(e)) : [];
    const caps = many(block(1.7, 1, 1.7), capMat, ids, piling, pit ? footing : -0.6);  // on the floor of the pit, their tops under the lowest slab
    const ties = add(keep(fuse([...zs.flatMap((z) => xs.slice(1).map((x) => raw(bayW - 1.7, 0.6, 0.3).translate(x - bayW / 2, pit ? footing : -0.2, z))), ...xs.flatMap((x) => zs.slice(1).map((z) => raw(0.3, 0.6, D / nz - 1.7).translate(x, pit ? footing : -0.2, z - D / nz / 2)))])), capMat, ids);
    const rig = group(), rigMat = mat("#c8421f", { roughness: 0.5, metalness: 0.15 });
    for (const z of [1.1, -1.1]) piece(rig, block(4.2, 0.9, 0.8), dark, 0, 0, z);
    piece(rig, block(3.6, 1.3, 2.4), rigMat, -0.6, 0.9, 0);
    piece(rig, block(1.1, 1.5, 1), rigMat, 0.2, 2.2, 0.7);
    piece(rig, block(0.04, 0.9, 0.85), cabGlass, 0.76, 2.6, 0.7);
    piece(rig, keep(lattice(16, 0.75, 0.75, 0.06).rotateZ(Math.PI / 2).translate(0.38, 0, 0)), rigMat, 1.5, 0.9, 0);
    piece(rig, keep(new THREE.CylinderGeometry(0.11, 0.11, 13, 8).translate(0, 6.5, 0)), steelMat, 2.3, 1.2, 0);
    parts.push((day) => {
      const p = together(fdn, day);
      const bored = (!parted ? clamp(p / 0.75) : pileWork.length ? together(pileWork, day) : together(capWork, day) > 0 ? 1 : 0) * N;
      const cast = (!parted ? clamp((p - 0.75) / 0.25) : capWork.length ? together(capWork, day) : together(pileWork, day) >= 1 ? 1 : 0) * N * 1.4;
      const covered = (ready.get(levels[0]?.index) ?? 0) >= 0.55;  // the lowest slab goes over them
      piling.forEach((pt, i) => {
        const opened = pit ? dugOut[zoneOf(pt.x)] : 1, done = bored >= i + 1, capped = cast > i && opened >= 1;
        caps.show(i, capped && !covered);
        heads.show(i, done && !capped && opened >= 1);
        casings.show(i, bored > i && (!done || opened < 1) && !covered, soilAt(pt.x));  // the casing while it goes in, and the mark of a pile the dig has not reached
      });
      heads.done(); casings.done(); caps.done();
      ties.visible = cast >= N && dugOut.every((d) => d >= 1) && !covered;
      const boring = busy(parted ? pileWork : fdn, day) && bored < N, casting = busy(parted ? capWork : fdn, day) && !boring;
      for (const e of others) if (busy([e], day)) say([e], "", brief(e.name), W / 4, Math.max(footing, 0) + 1.2, 0);
      rig.visible = boring;
      if (boring) {
        const i = Math.min(N - 1, Math.floor(bored)), pt = piling[i], y = soilAt(pt.x);
        rig.position.set(pt.x - 2.3, y, pt.z);
        say(parted ? pileWork : fdn, `${verb ? `${verb} the pile` : "Piling"} at column ${pt.name}, ${i + 1} of ${N}`, verb ? `${verb} piles` : "Piling", pt.x, y + 2.5, pt.z);
        if (verb !== "Driving") hoist(pt.x, y, pt.z, "rebar");
        crew(3, pt.x + 1.5, y, pt.z, 5, 5);
      }
      if (casting) {
        const open = dugOut.every((d) => d >= 1), i = Math.min(N - 1, Math.floor(cast)), pt = piling[i];
        say(parted ? capWork : fdn, `Casting the pile caps${parted ? "" : " and the tie beams"} at the foot of the columns${open ? "" : ", as the dig reaches them"}`, parted ? "Pile caps" : "Pile caps and tie beams", 0, footing + 1.2, 0);
        hoist(pt.x, footing, pt.z, "bucket");
        crew(5, 0, footing, 0, W * 0.8, D * 0.8);
      }
    });
  }

  // backfill: the cut between the basement walls and the sides of the pit, filled and compacted once the basement stands. Where no package names it, it follows the basement's finish
  if (pit) {
    const gapX = edgeX - W / 2 - 0.3, gapZ = edgeZ - D / 2 - 0.3, ids = idsOf(fills), base = levels[0].index, finish = when((d) => (progressAt.get(base)?.(d) ?? 1) >= 1);
    const around = [add(block(edgeX * 2, deep, gapZ), soilMat, ids, 0, footing, edgeZ - gapZ / 2), add(block(edgeX * 2, deep, gapZ), soilMat, ids, 0, footing, -edgeZ + gapZ / 2),
      add(block(gapX, deep, D + 0.6), soilMat, ids, edgeX - gapX / 2, footing, 0), add(block(gapX, deep, D + 0.6), soilMat, ids, -edgeX + gapX / 2, footing, 0)];
    parts.push((day) => {
      const p = after(base, fills.length ? together(fills, day) : clamp((day - finish) / 14));
      for (const m of around) { grow(m, p); m.material = p >= 1 ? siteMat : soilMat; }
      for (const e of fills) if (busy([e], day)) {
        say([e], fills.length > 1 ? "" : p > 0 ? "Backfilling round the basement walls and compacting the soil" : "The backfill starts once the basement walls stand", fills.length > 1 ? brief(e.name) : "Backfilling", W / 2 + 1, 1, D / 2 + 1);
        if (p > 0) crew(2, W / 2 + 1, footing + deep * p, 0, gapX, D);
      }
    });
  } else if (fills.length) {
    parts.push((day) => { for (const e of fills) if (busy([e], day)) { say([e], "", brief(e.name), W / 2 + 2, 1, D / 2 + 2); crew(2, W / 2 + 2, 0, 0, 2, D); } });
  }

  // ---------------------------------------------------------------------------------------------- the lift shaft, rising with the floors
  // ---------------------------------------------------------------------------------------------- walls, windows and the fit-out, each over every floor, from the bottom up
  const across = (work: El[], list: Floor[]) => {
    const unnamed = work.filter((e) => e.level === null);
    return (day: number) => {
      const p = together(unnamed, day);
      const raws = list.map((f, i) => { const own = work.filter((e) => e.level === f.index); return Math.max(own.length ? together(own, day) : 0, unnamed.length ? spread(p, i, list.length) : 0); });
      const s = raws.map((x, i) => after(list[i].index, x)), now = raws.findIndex((x) => x > 0 && x < 1);
      return { s, now: now < 0 ? null : list[now], waiting: now >= 0 && s[now] === 0 };
    };
  };
  const doors = nx % 2 ? [Math.floor(nx / 2)] : [nx / 2 - 1, nx / 2];
  const panelsOf = (f: Floor) => {
    const h = f.height - 0.9, out: Panel[] = [], zb = D / nz;  // from the floor to the beams above
    const put = (x: number, z: number, w: number, turn: number, door: boolean) => {
      const wide = Math.min(w * 0.62, 4.2), tall = Math.min(1.8, h - 1.3), dw = Math.min(w * 0.5, 3.2), dh = Math.min(2.6, h - 0.3);
      out.push({ at: new THREE.Matrix4().makeRotationY(turn).setPosition(x, f.elevation, z), w, h, hole: door ? { x: -dw / 2, y: 0, w: dw, h: dh } : tall > 0.5 ? { x: -wide / 2, y: 0.9, w: wide, h: tall } : null });
    };
    for (let k = 0; k < nx; k++) for (const s of [1, -1]) put(-W / 2 + (k + 0.5) * bayW, (s * D) / 2, bayW - 0.6, 0, f.index === 0 && doors.includes(k));
    for (let j = 0; j < nz; j++) for (const s of [1, -1]) put((s * W) / 2, -D / 2 + (j + 0.5) * zb, zb - 0.6, Math.PI / 2, false);
    for (const p of out) {  // a wall beside a stair is left open nearly floor to beam, with a guard rail, as a tropical stairwell often is: so the flights show from outside
      if (p.hole?.y === 0) continue;
      const px = p.at.elements[12], pz = p.at.elements[14], across = Math.abs(p.at.elements[0]) < 0.5;
      for (const [x0, z0, x1, z1] of stairWells) {
        const by = across ? Math.min(Math.abs(px - x0), Math.abs(px - x1)) < 0.6 : Math.min(Math.abs(pz - z0), Math.abs(pz - z1)) < 0.6;
        const [a, b] = across ? [Math.max(z0, pz - p.w / 2), Math.min(z1, pz + p.w / 2)] : [Math.max(x0, px - p.w / 2), Math.min(x1, px + p.w / 2)];
        if (!by || b - a < 1) continue;
        const lo = Math.max(-p.w / 2 + 0.15, across ? -(b - pz) : a - px), hi = Math.min(p.w / 2 - 0.15, across ? -(a - pz) : b - px);
        p.hole = { x: lo, y: 0.45, w: hi - lo, h: p.h - 0.7 };
        p.open = true;
      }
    }
    return out;
  };
  const wallOf = ({ at, w, h, hole: o }: Panel, t: number, inset: number) => {
    const s = o && o.y === 0
      ? new THREE.Shape([v2(-w / 2, 0), v2(o.x + inset, 0), v2(o.x + inset, o.h - inset), v2(o.x + o.w - inset, o.h - inset), v2(o.x + o.w - inset, 0), v2(w / 2, 0), v2(w / 2, h), v2(-w / 2, h)])
      : new THREE.Shape([v2(-w / 2, 0), v2(w / 2, 0), v2(w / 2, h), v2(-w / 2, h)]);
    if (o && o.y > 0) s.holes.push(new THREE.Path([v2(o.x + inset, o.y + inset), v2(o.x + inset, o.y + o.h - inset), v2(o.x + o.w - inset, o.y + o.h - inset), v2(o.x + o.w - inset, o.y + inset)]));
    return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2).applyMatrix4(at);
  };
  const arch = of("architecture"), phased = (a: number, b: number) => arch.map((e) => ({ ...e, start: e.start + (e.end - e.start) * a, end: e.start + (e.end - e.start) * b }));
  const walls = [...of("walls"), ...phased(0, 0.55)], wallsDone = new Map<number, number>();
  if (walls.length && above.length) {
    const ids = idsOf(walls), progress = across(walls, above), plastered = arch.length > 0 || walls.some((e) => /plester|plaster|acian/i.test(e.name));
    const built = above.map((f) => {
      const panels = panelsOf(f), brickMat = mat("#ffffff", { map: tex.brick }), plasterMat = mat(LOOK.plaster, { map: grain });
      const guards = panels.filter((p) => p.open).map((p) => raw(p.hole!.w, 0.06, 0.06).translate(p.hole!.x + p.hole!.w / 2, 1.05, 0).applyMatrix4(p.at));
      return { f, h: f.height - 0.9, brickPlane: clip(brickMat, DOWN), plasterPlane: clip(plasterMat, DOWN), guard: guards.length ? add(keep(fuse(guards)), stairRail, ids) : null,
        brick: add(keep(fuse(panels.map((p) => wallOf(p, 0.15, 0)))), brickMat, ids), plaster: add(keep(fuse(panels.map((p) => wallOf(p, 0.19, 0.02)))), plasterMat, ids) };
    });
    parts.push((day) => {
      const a = progress(day);
      built.forEach((b, i) => {
        const s = a.s[i], y = b.f.elevation;
        wallsDone.set(b.f.index, s);
        b.brick.visible = s > 0;
        b.brickPlane.constant = y + b.h * clamp(plastered ? s / 0.6 : s);
        b.plaster.visible = plastered && s > 0.6;
        if (b.guard) b.guard.visible = s >= 1;
        b.plasterPlane.constant = y + b.h * clamp((s - 0.6) / 0.4);
      });
      if (!busy(walls, day) || !a.now) return;
      const f = a.now, s = a.s[above.indexOf(f)], y = f.elevation + 1.6;
      if (a.waiting) say(walls, `Brick walls start on ${f.name} once its frame is finished`, "Walls wait for the frame", 0, y, D / 2);
      else if (s < 0.6 || !plastered) { say(walls, `${f.name}: laying the brick walls between the columns`, "Laying bricks", 0, y, D / 2); hoist(0, f.elevation, D / 2 - 2, "bricks"); }
      else say(walls, `${f.name}: plastering the brick walls`, "Plastering", 0, y, D / 2);
      crew(4, 0, f.elevation, D / 2 - 1, W * 0.8, 1.2);
    });
  }

  const openings = [...of("openings"), ...phased(0.4, 0.8)];
  if (openings.length && above.length) {
    const ids = idsOf(openings), progress = across(openings, above), frameMat = mat("#3a3f45", { metalness: 0.6, roughness: 0.4 });
    const built = above.map((f) => {
      const panels = panelsOf(f).filter((p) => p.hole && !p.open);
      const frames = panels.flatMap((p) => {
        const o = p.hole!, e = 0.07, s = new THREE.Shape([v2(o.x, o.y), v2(o.x + o.w, o.y), v2(o.x + o.w, o.y + o.h), v2(o.x, o.y + o.h)]);
        s.holes.push(new THREE.Path([v2(o.x + e, o.y + e), v2(o.x + e, o.y + o.h - e), v2(o.x + o.w - e, o.y + o.h - e), v2(o.x + o.w - e, o.y + e)]));
        const list: THREE.BufferGeometry[] = [new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05)];
        if (o.w > 1.6) list.push(raw(0.06, o.h, 0.1).translate(o.x + o.w / 2, o.y, 0));
        return list.map((g) => g.applyMatrix4(p.at));
      });
      const panes = panels.map((p) => { const o = p.hole!; return new THREE.BoxGeometry(o.w - 0.1, o.h - 0.1, 0.03).translate(o.x + o.w / 2, o.y + o.h / 2, 0).applyMatrix4(p.at); });
      return { f, frame: add(keep(fuse(frames)), frameMat, ids), pane: add(keep(fuse(panes)), glassMat, ids, 0, 0, 0, false) };
    });
    parts.push((day) => {
      const a = progress(day);
      built.forEach((b, i) => { const walled = walls.length ? (wallsDone.get(b.f.index) ?? 0) >= 0.6 : true, s = walled ? a.s[i] : 0; b.frame.visible = s > 0; b.pane.visible = s >= 0.5; });
      if (!busy(openings, day) || !a.now) return;
      const f = a.now, i = above.indexOf(f), walled = walls.length ? (wallsDone.get(f.index) ?? 0) >= 0.6 : true, y = f.elevation + 2;
      if (a.waiting || !walled) say(openings, `Doors and windows start on ${f.name} once its walls are up`, "Windows wait for the walls", -W / 4, y, D / 2);
      else say(openings, `${f.name}: ${a.s[i] < 0.5 ? "fixing the door and window frames" : "glazing the windows and hanging the doors"}`, a.s[i] < 0.5 ? "Window frames" : "Glazing", -W / 4, y, D / 2);
    });
  }

  const floorOf = (e: El, day: number, list: Floor[]) => (e.level !== null ? list.find((f) => f.index === e.level) ?? list[0] : list[Math.min(list.length - 1, Math.floor(progressOf(e, day) * list.length))]);
  const interior = [...of("interior"), ...phased(0.5, 1)];
  if (interior.length && floors.length) {
    const ids = idsOf(interior), progress = across(interior, floors);
    const built = floors.map((f) => {
      const glow = keep(new THREE.MeshBasicMaterial({ color: "#ffdba3", transparent: true, opacity: 0, depthWrite: false }));
      const holes = voidsAt(f.index, f.index > lowestIndex).map(([x0, z0, x1, z1]) => [Math.max(x0, -W / 2 + 0.55), Math.max(z0, -D / 2 + 0.55), Math.min(x1, W / 2 - 0.55), Math.min(z1, D / 2 - 0.55)]);  // the stairs and the lift go through the finished floor
      const ends = stairs.length ? STAIR_W + 0.6 : 0;  // the light inside stays clear of the stairwells at the ends
      return { f, glow, finish: add(keep(plate(W - 1, D - 1, 0.02, holes)), mat("#e8dfcc", { map: tex.paving }), ids, 0, f.elevation + 0.03, 0, false), light: add(block(W - 1.2 - 2 * ends, f.height - 1.3, D - 1.2), glow, [], 0, f.elevation + 0.2, 0, false) };
    });
    parts.push((day) => {
      const a = progress(day);
      built.forEach((b, i) => {
        const s = a.s[i], closed = b.f.index < 0 ? 1 : walls.length ? clamp((wallsDone.get(b.f.index) ?? 0) / 0.6) : 1;
        grow(b.finish, s, "x");
        b.glow.opacity = 0.42 * s * closed;  // a finished floor shows lit from inside, through its windows
        b.light.visible = s * closed > 0;
      });
      for (const e of interior) if (busy([e], day)) {
        const f = floorOf(e, day, floors);
        say([e], `Inside work, now on ${f.name}`, "", 0, f.elevation + 1.4, D / 2, f.index >= 0);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------- the facade: cladding round the slab edges, floor by floor, then fins up the long sides
  const facade = of("facade");
  if (facade.length && above.length) {
    const ids = idsOf(facade), cladMat = mat("#e9e4d9", { map: grain, roughness: 0.55 }), finMat = mat("#f1eee7", { map: grain, roughness: 0.6 }), count = Math.max(4, Math.round(W / 1.75)), H = Math.max(1, top - 0.1);
    const bands = above.map((f) => {
      const y = f.elevation + f.height - 0.92, h = 1;
      return add(keep(fuse([raw(W + 0.8, h, 0.06).translate(0, y, D / 2 + 0.32), raw(W + 0.8, h, 0.06).translate(0, y, -D / 2 - 0.32), raw(0.06, h, D + 0.8).translate(W / 2 + 0.32, y, 0), raw(0.06, h, D + 0.8).translate(-W / 2 - 0.32, y, 0)])), cladMat, ids);
    });
    const finGeo = block(0.22, H, 0.6), fins = [D / 2 + 0.7, -D / 2 - 0.7].flatMap((z) => Array.from({ length: count }, (_, k) => add(finGeo, finMat, ids, -W / 2 + (k + 0.5) * (W / count), 0, z)));
    parts.push((day) => {
      const p = together(facade, day), banded = clamp(p / 0.45) * bands.length, fitted = clamp((p - 0.45) / 0.55) * fins.length;
      bands.forEach((b, i) => { b.visible = banded > i; });
      fins.forEach((m, i) => grow(m, clamp(fitted - i)));
      if (!busy(facade, day)) return;
      if (p < 0.45) { const f = above[Math.min(above.length - 1, Math.floor(banded))]; say(facade, `Facade: cladding the slab edge of ${f.name}`, "Facade cladding", W / 4, f.elevation + f.height - 0.4, D / 2 + 0.4); crew(3, W / 4, f.elevation + f.height - 1.8, D / 2 + 1.6, W * 0.5, 0.8); }
      else { const i = Math.min(fins.length - 1, Math.floor(fitted)), fin = fins[i]; say(facade, `Facade: fixing the fins, ${i + 1} of ${fins.length}`, "Facade fins", fin.position.x, H * 0.7, fin.position.z); }
    });
  }

  // ---------------------------------------------------------------------------------------------- the roof: steel trusses and then tiles from the eaves up, where the documents speak of them. A membrane where they do not
  const roof = of("roof");
  let roofTiled = () => true;
  if (roof.length) {
    const ids = idsOf(roof);
    if (pitched) {
      const S = D / 2 + 0.9, L = Math.hypot(S, rise), angle = Math.atan2(rise, S), wide = W + 1.8, tileMat = mat("#ffffff", { map: tex.tiles, roughness: 0.75 }), plane = clip(tileMat, DOWN);
      const trussGeo = keep(fuse([bar(V(0, 0, -S), V(0, 0, S), 0.09), bar(V(0, 0, -S), V(0, rise, 0), 0.09), bar(V(0, 0, S), V(0, rise, 0), 0.09), bar(V(0, 0, 0), V(0, rise, 0), 0.06),
        bar(V(0, 0, S / 2), V(0, rise / 2, S / 2), 0.06), bar(V(0, 0, -S / 2), V(0, rise / 2, -S / 2), 0.06), bar(V(0, 0, 0), V(0, rise / 2, S / 2), 0.06), bar(V(0, 0, 0), V(0, rise / 2, -S / 2), 0.06)]));
      const count = Math.max(3, Math.round(wide / 1.2) + 1), spots = Array.from({ length: count }, (_, i) => ({ x: -wide / 2 + (i * wide) / (count - 1), z: 0 }));
      const trusses = many(trussGeo, steelMat, ids, spots, top + 0.02);
      const slope = keep(new THREE.BoxGeometry(wide, 0.06, L));
      const uv = slope.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * wide, uv.getY(i) * L);
      const front = add(slope, tileMat, ids, 0, top + rise / 2 + 0.05, S / 2), back = add(slope, tileMat, ids, 0, top + rise / 2 + 0.05, -S / 2);
      front.rotation.x = angle;
      back.rotation.x = -angle;
      const ridge = add(block(wide, 0.14, 0.34), mat("#8d4326", { map: grain }), ids, 0, top + rise + 0.03, 0);
      const gableShape = new THREE.Shape([v2(-S, 0), v2(S, 0), v2(0, rise)]), gableMat = mat(LOOK.plaster, { map: grain });
      const gable = keep(new THREE.ExtrudeGeometry(gableShape, { depth: 0.16, bevelEnabled: false }).rotateY(Math.PI / 2));
      const gables = [add(gable, gableMat, ids, W / 2 + 0.2, top, 0), add(gable, gableMat, ids, -W / 2 - 0.36, top, 0)];
      outline(keep(new THREE.ExtrudeGeometry(gableShape, { depth: wide, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-wide / 2, 0, 0)), 0, top, 0);
      roofTiled = () => plane.constant >= top + rise;
      const covered = model.roof_covered !== false, frameShare = covered ? 0.45 : 1;  // where the plan names only the frame, the frame is all that is drawn
      parts.push((day) => {
        const p = after(roofIndex, together(roof, day)), up = clamp(p / frameShare) * count, q = covered ? clamp((p - 0.45) / 0.55) : 0;
        spots.forEach((_, i) => trusses.show(i, up > i));
        trusses.done();
        plane.constant = top + rise * q;
        front.visible = back.visible = q > 0;
        ridge.visible = q >= 1;
        for (const g of gables) g.visible = covered && p >= 0.45;
        if (!busy(roof, day)) return;
        if (p === 0) say(roof, "The roof starts once the frame below it is finished", "Roof waits for the frame", 0, top + 2, 0);
        else if (p < frameShare) { const i = Math.min(count - 1, Math.floor(up)); say(roof, `Putting up the roof frame, truss ${i + 1} of ${count}`, "Roof frame", spots[i].x, top + rise, 0); hoist(spots[i].x, top, 0, "truss"); crew(4, spots[i].x, top, 0, 3, D * 0.8); }
        else if (covered) { say(roof, "Covering the roof, from the eaves up to the ridge", "Roof covering", 0, top + rise * (q + 0.2), S * (1 - q)); crew(4, 0, top + rise * q, S * (1 - q), W * 0.8, 1); }
      });
    } else {
      const skin = add(block(W + 0.4, 0.08, D + 0.4), mat("#4b5059", { map: grain }), ids, 0, top, 0);
      roofTiled = () => skin.scale.x >= 1;
      parts.push((day) => {
        const p = after(roofIndex, together(roof, day));
        grow(skin, p, "x");
        if (busy(roof, day)) { say(roof, p > 0 ? "Waterproofing the roof slab" : "Waterproofing starts once the roof slab is finished", "Waterproofing", 0, top + 2, 0); crew(4, 0, top, 0, W * 0.7, D * 0.7); }
      });
    }
  }

  // ---------------------------------------------------------------------------------------------- services: a riser for each, then a run under every floor. Solar panels and lightning rods where the plan names them
  const solar = els.find((e) => /solar/i.test(e.name)), rod = els.find((e) => /petir|lightning/i.test(e.name));
  for (const [kind, color, side, verb] of [["electrical", "#e8b923", -1, "Conduits, cable trays and wiring"], ["mechanical", "#3f8fd2", 1, "Pipes and ducts"]] as const) {
    const work = [...of(kind), ...of("services")];
    if (!work.length || !floors.length) continue;
    const m = mat(color, { roughness: 0.5, metalness: 0.2 }), ids = idsOf(work), progress = across(work, floors), H = top + 0.5 - lowest;
    const riser = add(keep(new THREE.CylinderGeometry(0.18, 0.18, H, 10).translate(0, H / 2, 0)), m, ids, xs[nx] - bayW / 2 + side * 0.7, lowest, zs[0] + bay / 2);
    const L = W - 2 - (stairs.length ? 2 * (STAIR_W + 0.6) : 0);  // the runs stop short of the stairwells at the ends
    const run = kind === "electrical" ? block(L, 0.1, 0.4) : keep(fuse([new THREE.CylinderGeometry(0.11, 0.11, L, 8).rotateZ(Math.PI / 2).translate(0, 0.1, 0.2), new THREE.CylinderGeometry(0.11, 0.11, L, 8).rotateZ(Math.PI / 2).translate(0, 0.1, -0.2)]));
    const runs = floors.map((f) => add(run, m, ids, 0, f.elevation + f.height - 1.15, side * D * 0.25, false));
    parts.push((day) => {
      const a = progress(day);
      grow(riser, together(work, day));
      runs.forEach((r, i) => grow(r, a.s[i], "x"));
      for (const e of work) if (busy([e], day) && !(e.kind === "services" && kind === "mechanical")) {  // one pin for a package that is both
        const f = floorOf(e, day, floors), late = e === solar && progressOf(e, day) > 0.85;
        const started = (ready.get(f.index) ?? 1) >= 0.999;
        say([e], late ? "Fixing the solar panels on the roof" : `${e.kind === "services" ? "Pipes, ducts, conduits and wiring" : verb}, ${started ? "now on" : "starting once the frame is finished on"} ${f.name}`, late ? "Solar panels" : "", side * W * 0.3, f.elevation + 1.4, D / 2, f.index >= 0 && started);
      }
    });
  }
  if (solar && above.length) {
    const panelMat = mat("#16263d", { metalness: 0.6, roughness: 0.2 }), S = D / 2 + 0.9, angle = pitched ? Math.atan2(rise, S) : 0, rows = 2, perRow = Math.max(2, Math.floor((W * 0.55) / 1.1));
    const spots = Array.from({ length: rows * perRow }, (_, i) => { const r = Math.floor(i / perRow), along = (r + 0.8) * 1.9; return { x: -((perRow - 1) * 1.1) / 2 + (i % perRow) * 1.1 + W * 0.15, z: pitched ? S / 2 - along * Math.cos(angle) + 1.2 : along - D / 4, y: pitched ? top + rise / 2 + 0.09 + (along - 1.2) * Math.sin(angle) : top + 0.14 }; });
    const panels = spots.map((p) => { const m = add(block(1, 0.04, 1.7), panelMat, [solar.id], p.x, p.y, p.z, false); m.rotation.x = angle; return m; });
    parts.push((day) => { const p = progressOf(solar, day), on = p > 0.85 && roofTiled(); panels.forEach((m, i) => { m.visible = on && clamp((p - 0.85) / 0.15) * panels.length > i; }); });
  }
  if (rod) {
    const H = top + rise, rods = (pitched ? [-W / 2 + 1, 0, W / 2 - 1] : [-W / 2 + 1, W / 2 - 1]).map((x) => add(block(0.06, 2.6, 0.06), steelMat, [rod.id], x, H, 0));
    parts.push((day) => { const on = progressOf(rod, day) > 0.9; for (const m of rods) m.visible = on; });
  }

  // ---------------------------------------------------------------------------------------------- the smaller things: the water tank, sewage treatment, canopies and the catwalk
  const tankX = -edgeX - 4, tankZ = D * 0.35, stpX = edgeX + 4, stpZ = 3;  // each to the side of the building, where the first view can see it
  const tank = of("tank");
  if (tank.length) {
    const ids = idsOf(tank), x = tankX, z = tankZ, m = concrete();
    const cut = add(block(6.6, 0.03, 4.6), mat("#4b3a2a", { map: grain }), ids, x, 0, z, false);
    const form = add(keep(fuse([raw(6, 0.5, 0.2).translate(0, 0, 1.9), raw(6, 0.5, 0.2).translate(0, 0, -1.9), raw(0.2, 0.5, 3.6).translate(2.9, 0, 0), raw(0.2, 0.5, 3.6).translate(-2.9, 0, 0)])), plyMat, ids, x, 0, z);
    const lid = add(block(6, 0.32, 4), m, ids, x, 0, z);
    const hatch = add(block(0.9, 0.07, 0.9), dark, ids, x + 1.6, 0.32, z + 0.8);
    parts.push((day) => {
      const p = together(tank, day);
      cut.visible = p > 0;
      form.visible = p >= 0.3 && p < 0.85;
      lid.visible = hatch.visible = p >= 0.85;
      if (busy(tank, day)) {
        say(tank, p < 0.3 ? "Digging the ground water tank" : p < 0.85 ? "Casting the walls of the ground water tank, below ground" : "Casting the lid of the ground water tank", "Water tank", x, 1.2, z);
        crew(3, x, 0, z + 3, 6, 1.5);
      }
    });
  }
  const stp = of("stp");
  if (stp.length) {
    const ids = idsOf(stp), x = stpX, z = stpZ, m = concrete();
    const house = add(block(4.5, 2.6, 3), m, ids, x, 0, z), lid = add(block(5, 0.16, 3.5), m, ids, x, 2.6, z), door = add(block(0.04, 2, 1), dark, ids, x - 2.27, 0, z);
    parts.push((day) => {
      const p = together(stp, day);
      grow(house, clamp(p / 0.85));
      lid.visible = door.visible = p >= 0.85;
      if (busy(stp, day)) { say(stp, "Casting the sewage treatment plant and the house over it", "Sewage plant", x, 3.2, z); crew(3, x, 0, z + 3, 5, 1.5); }
    });
  }
  const ground0 = above.length ? above[0].elevation + above[0].height : 4;
  const canopy = of("canopy");
  if (canopy.length) {
    const ids = idsOf(canopy), m = concrete(), wide = W * 0.35, shape = keep(fuse([raw(wide, 0.25, 3.2).translate(0, ground0 - 0.3, 0), raw(0.3, ground0 - 0.3, 0.3).translate(wide / 2 - 0.3, 0, 1.3), raw(0.3, ground0 - 0.3, 0.3).translate(-wide / 2 + 0.3, 0, 1.3)]));
    const front = add(shape, m, ids, 0, 0, D / 2 + 1.7), back = add(shape, m, ids, 0, 0, -D / 2 - 1.7);
    back.rotation.y = Math.PI;
    parts.push((day) => {
      const p = together(canopy, day);
      grow(front, p, "x");
      grow(back, p, "x");
      if (busy(canopy, day)) { say(canopy, "Casting the entrance canopies, front and back", "Canopies", 0, ground0 + 0.4, D / 2 + 2); crew(3, 0, 0, D / 2 + 2, wide, 2.4); }
    });
  }
  const entrance = of("entrance");
  if (entrance.length) {  // the steps and the ramp up to the front doors
    const wide = Math.min(W * 0.4, bayW * 1.6), lie = 1.6, rise2 = 0.32, run2 = 3.6, zAt = D / 2 + 0.35 + lie / 2;
    const ramp = new THREE.ExtrudeGeometry(new THREE.Shape([v2(0, 0), v2(run2, 0), v2(0, rise2)]), { depth: 1.4, bevelEnabled: false }).translate(wide / 2, 0, -0.7);
    const steps = add(keep(fuse([raw(wide, rise2, lie), raw(wide, rise2 / 2, 0.6).translate(0, 0, lie / 2 + 0.3), ramp])), concrete(), idsOf(entrance), 0, 0, zAt);
    parts.push((day) => {
      grow(steps, together(entrance, day));
      if (busy(entrance, day)) { say(entrance, "Casting the entrance steps and ramp at the front of the building", "Entrance steps and ramp", 0, 1.2, zAt); crew(3, 0, 0, zAt + 1.2, wide, 1); }
    });
  }
  const joint = of("joint");
  if (joint.length) {  // the expansion joint, a dark line up the building's long sides
    const seam = keep(fuse([raw(0.07, top, 0.03).translate(0, 0, D / 2 + 0.36), raw(0.07, top, 0.03).translate(0, 0, -D / 2 - 0.36)]));
    const line = add(seam, mat("#2f3338"), idsOf(joint), 0, 0, 0, false);
    parts.push((day) => {
      grow(line, together(joint, day));
      for (const e of joint) if (busy([e], day)) say([e], "", brief(e.name), 0, 1.5, D / 2 + 0.4);
    });
  }
  const catwalk = of("catwalk");
  if (catwalk.length) {
    const ids = idsOf(catwalk), walk = add(keep(fuse([raw(W * 0.7, 0.12, 1.1), raw(W * 0.7, 0.05, 0.05).translate(0, 1, 0.53), raw(W * 0.7, 0.05, 0.05).translate(0, 1, -0.53)])), steelMat, ids, 0, top + 0.4, 0);
    parts.push((day) => {
      grow(walk, together(catwalk, day), "x");
      if (busy(catwalk, day)) { say(catwalk, "Building the catwalk over the roof slab", "Catwalk", 0, top + 1.8, 0); crew(2, 0, top, 0, W * 0.6, 2); }
    });
  }

  // ---------------------------------------------------------------------------------------------- external works: a drain round the building, paving, then trees and shrubs round the site
  if (external.length) {
    const ids = idsOf(external), drainMat = mat("#3b4148"), paveMat = mat("#d9d5ca", { map: tex.paving }), trunkMat = mat("#6b4f35");
    const greens = ["#4f8a43", "#5f9a4e", "#437a3c"].map((c) => mat(c, { flatShading: true }));
    const ring = (o: number, t: number, h: number) => [[W + o * 2 + t, h, t, 0, D / 2 + o + t / 2], [W + o * 2 + t, h, t, 0, -D / 2 - o - t / 2], [t, h, D + o * 2, W / 2 + o + t / 2, 0], [t, h, D + o * 2, -W / 2 - o - t / 2, 0]];
    const paved = ring(0.3, 2.8, 0.05).map(([w, h, d, x, z]) => add(block(w, h, d), paveMat, ids, x, 0, z, false));
    const drains = ring(3.1, 0.6, 0.08).map(([w, h, d, x, z]) => add(block(w, h, d), drainMat, ids, x, 0, z, false));
    const blocked = (x: number, z: number) => [[officeX, officeZ, 7], [tankX, tankZ, 6], [stpX, stpZ, 5], [(gate[0] + gate[1]) / 2, siteD / 2, 7], [-1, siteD / 2 - 1.2, 5]].some(([a, b, r]) => Math.hypot(x - a, z - b) < r);
    const crown = keep(new THREE.IcosahedronGeometry(1.7, 1)), crownB = keep(new THREE.IcosahedronGeometry(1.1, 1)), stem = keep(new THREE.CylinderGeometry(0.14, 0.22, 2, 8).translate(0, 1, 0));
    const spots = Array.from({ length: 22 }, (_, k) => { const t = (k / 22) * Math.PI * 2; return [Math.cos(t) * (siteW / 2 - 3), Math.sin(t) * (siteD / 2 - 3)] as const; }).filter(([x, z]) => !blocked(x, z));
    const trees = spots.map(([x, z], i) => {
      const g = group(x, 0, z), s = 0.85 + hash(i, 5) * 0.5;
      piece(g, stem, trunkMat);
      piece(g, crown, greens[i % 3], 0, 3, 0);
      piece(g, crownB, greens[(i + 1) % 3], 0.7, 2.3, 0.4);
      g.scale.setScalar(s);
      return g;
    });
    parts.push((day) => {
      const p = together(external, day);
      paved.forEach((m) => grow(m, clamp((p - 0.3) / 0.3), "x"));
      drains.forEach((m) => grow(m, clamp(p / 0.3), "x"));
      trees.forEach((g, i) => { g.visible = clamp((p - 0.55) / 0.45) * trees.length > i; });
      if (busy(external, day)) {
        say(external, p < 0.3 ? "Digging and laying the drain round the building" : p < 0.6 ? "Laying the paving round the building" : "Planting the trees and the grass", p < 0.3 ? "Perimeter drain" : p < 0.6 ? "Paving" : "Planting", W / 2 + 3.4, 1.6, D / 2 + 3.4);
        crew(4, W / 2 + 3.4, 0, 0, 2, D);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------- the scaffold round the outside: up with the frame, down from the top as the facade finishes
  const closing = facade.length ? facade : walls;
  if (above.length && closing.length) {
    const H = top + 1.2, points: number[] = [], gapIn = 1.2, gapOut = 2.1, lift2 = 2;
    const ringOf = (o: number) => { const a = W / 2 + o, b = D / 2 + o; return [[-a, -b, a, -b], [a, -b, a, b], [a, b, -a, b], [-a, b, -a, -b]]; };
    const inner = ringOf(gapIn), outer = ringOf(gapOut);
    for (let s = 0; s < 4; s++) {
      const [ax, az, bx, bz] = inner[s], [cx, cz, dx, dz] = outer[s], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 1.8));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x1 = ax + (bx - ax) * t, z1 = az + (bz - az) * t, x2 = cx + (dx - cx) * t, z2 = cz + (dz - cz) * t;
        points.push(x1, 0, z1, x1, H, z1, x2, 0, z2, x2, H, z2);
        for (let y = lift2; y < H; y += lift2) points.push(x1, y, z1, x2, y, z2);
        if (i < n && i % 5 === 0) { const u = (i + 1) / n; for (let y = 0; y + lift2 < H; y += lift2) points.push(x2, y, z2, cx + (dx - cx) * u, y + lift2, cz + (dz - cz) * u); }
      }
      for (let y = lift2; y < H; y += lift2) points.push(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz);
    }
    const plane = new THREE.Plane(DOWN.clone(), 0), scaffold = lines(points, keep(new THREE.LineBasicMaterial({ color: "#6d7a87", transparent: true, opacity: 0.55, clippingPlanes: [plane] })));
    parts.push((day) => {
      const c = (frameTop > 0 ? Math.min(H, frameTop + 1.2) : 0) * (1 - clamp((together(closing, day) - 0.8) / 0.2));
      scaffold.visible = c > 0.5;
      plane.constant = c;
    });
  }

  // ---------------------------------------------------------------------------------------------- the tower crane, where the contract lists one. It is erected before the frame, climbs a section at a time as the building rises, swings to the work of the day and lowers the load there, and parks with its hook up when no lift is needed
  const frame = [...fdn, ...structure, ...lifts, ...roof];
  const crane = { angle: 2.2, r: 8, hook: 12, goalAngle: 2.2, goalR: 8, goalHook: 12, on: false, fresh: true };
  let craneStep: () => boolean = () => false;
  const slingOn = (hook: THREE.Object3D): Record<Load, THREE.Object3D> => ({
    rebar: piece(hook, block(5, 0.28, 0.5), rustMat, 0, -1.7, 0),
    forms: piece(hook, block(2.4, 0.5, 1.2), plyMat, 0, -1.9, 0),
    bucket: piece(hook, keep(new THREE.CylinderGeometry(0.7, 0.3, 1.3, 12).translate(0, 0.65, 0)), mat("#6f7479", { metalness: 0.4, roughness: 0.5 }), 0, -2.2, 0),
    bricks: piece(hook, block(1.2, 1, 1.2), brickLook, 0, -2, 0),
    truss: piece(hook, keep(fuse([bar(V(-5, 0, 0), V(5, 0, 0), 0.09), bar(V(-5, 0, 0), V(0, 1.8, 0), 0.09), bar(V(5, 0, 0), V(0, 1.8, 0), 0.09), bar(V(0, 0, 0), V(0, 1.8, 0), 0.06)])), steelMat, 0, -3, 0),
  });
  if (model.crane === "mobile" && frame.length) {  // a mobile crane comes for the lift: on the side of the building nearest the work, its boom up past the frame and a fly jib out over it
    const carrier = truck(), reachOut = group(), hook = new THREE.Group();
    piece(carrier, block(3.4, 0.9, 2.2), yellow, -1.2, 1.15, 0);
    for (const x of [2, -2.8]) for (const z of [1.5, -1.5]) piece(carrier, block(0.5, 0.75, 0.5), dark, x, 0, z);
    carrier.rotation.y = Math.PI / 2;
    const jib = piece(reachOut, unit, yellow), fly = piece(reachOut, unit, yellow), rope = piece(reachOut, keep(new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, 0.5, 0)), dark);
    jib.scale.set(1.5, 1.5, 1);
    fly.scale.set(0.8, 0.8, 1);
    reachOut.add(hook);
    piece(hook, block(0.5, 0.8, 0.34), yellow, 0, -0.8, 0);
    const loads = slingOn(hook);
    parts.push(() => {
      carrier.visible = reachOut.visible = !!job;
      for (const [k, m] of Object.entries(loads)) m.visible = !!job && job.load === k;
      if (!job) return;
      const side = job.x < 0 ? -1 : 1, x = side * (edgeX + 5), z = Math.max(-D / 2, Math.min(side > 0 ? (stp.length ? -2 : D / 2) : tank.length ? 2 : D / 2, job.z)), hookY = job.y + 3.4;
      carrier.position.set(x, 0, z);
      const top2 = Math.max(frameTop, job.y) + 6, apex = V(side * (W / 2 + 1.5), top2, z), tip = V(job.x, top2 + 1, job.z);
      span3(jib, V(x, 2.2, z), apex);
      jib.scale.set(1.5, 1.5, jib.scale.z);
      span3(fly, apex, tip);
      fly.scale.set(0.8, 0.8, fly.scale.z);
      hook.position.set(job.x, hookY, job.z);
      rope.position.set(job.x, hookY, job.z);
      rope.scale.y = tip.y - hookY;
    });
  }
  if (model.crane === "tower" && frame.length) {
    const from = Math.max(0, Math.min(...frame.map((e) => e.start)) - 4), until = Math.max(...frame.map((e) => e.end)) + 6;
    const cx = edgeX + 3.5, cz = -edgeZ - 1.5, footH = 0.6, section = 3, finalH = Math.ceil((top + rise + 9) / section) * section;
    const R = Math.max(...[[-W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [W / 2, -D / 2]].map(([x, z]) => Math.hypot(x - cx, z - cz))) + 3;
    const paint = mat("#efb90c", { roughness: 0.5, metalness: 0.2 }), mastMat = mat("#efb90c", { roughness: 0.5, metalness: 0.2 }), mastPlane = clip(mastMat, DOWN);
    const footing2 = add(block(4.5, footH, 4.5), concrete(), [], cx, 0, cz);
    const mast = add(keep(lattice(finalH, 1.6, 1.6, 0.09).rotateZ(Math.PI / 2).translate(0.8, 0, 0)), mastMat, [], cx, footH, cz);
    const head = group(cx, footH, cz);
    piece(head, block(2.2, 1, 2.2), paint);
    piece(head, keep(lattice(6, 1.3, 1.3, 0.07).rotateZ(Math.PI / 2).translate(0.65, 0, 0)), paint, 0, 1, 0);  // the cat-head, which the ties hang from
    piece(head, keep(lattice(R - 1, 1.2, 1.4, 0.07)), paint, 1, 1, 0);  // the jib
    const back = Math.max(7, R * 0.3);
    piece(head, keep(lattice(back, 1.4, 0.8, 0.06)), paint, -back - 1, 1, 0);  // the counter-jib
    piece(head, block(back, 0.1, 1.4), dark, -back / 2 - 1, 1.02, 0);
    for (const x of [-back - 0.4, -back + 0.5, -back + 1.4]) piece(head, block(0.8, 2.8, 1.5), concrete(), x, -1.2, 0);  // the counterweights
    piece(head, block(1.5, 2.1, 1.6), white, 1.2, -1.35, 1.5);  // the operator's cab
    piece(head, block(0.04, 1.1, 1.3), cabGlass, 1.96, -0.45, 1.5);
    piece(head, keep(fuse([bar(V(0, 7, 0), V((R - 1) * 0.72 + 1, 2.4, 0), 0.05), bar(V(0, 7, 0), V((R - 1) * 0.35 + 1, 2.4, 0), 0.05), bar(V(0, 7, 0), V(-back, 1.8, 0), 0.05)])), steelMat);
    const trolley = piece(head, block(1.1, 0.3, 1.1), dark, 8, 0.7, 0), hook = new THREE.Group(), cable = piece(head, keep(new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, 0.5, 0)), dark);
    head.add(hook);
    piece(hook, block(0.5, 0.8, 0.34), yellow, 0, -0.8, 0);
    const slung = slingOn(hook);
    const pose = () => {
      const y = crane.hook - head.position.y;
      head.rotation.y = crane.angle;
      trolley.position.x = crane.r;
      hook.position.set(crane.r, y, 0);
      cable.position.set(crane.r, y, 0);
      cable.scale.y = Math.max(0.05, 0.7 - y);
    };
    craneStep = () => {
      if (!crane.on) return false;
      const d = Math.atan2(Math.sin(crane.goalAngle - crane.angle), Math.cos(crane.goalAngle - crane.angle));
      crane.angle += Math.sign(d) * Math.min(Math.abs(d), 0.015 + Math.abs(d) * 0.06);
      crane.r += (crane.goalR - crane.r) * 0.09;
      crane.hook += (crane.goalHook - crane.hook) * 0.09;
      pose();
      return Math.abs(d) > 0.002 || Math.abs(crane.goalR - crane.r) > 0.02 || Math.abs(crane.goalHook - crane.hook) > 0.02;
    };
    parts.push((day) => {
      const on = day >= from && day < until, rising = clamp((day + 1 - from) / 4), falling = clamp((until - day) / 4), upright = Math.min(rising, falling);
      const wanted = Math.min(finalH, Math.max(Math.ceil((top * 0.4 + 9) / section) * section, Math.ceil((frameTop + 9) / section) * section));
      footing2.visible = on;
      mast.visible = on;
      mastPlane.constant = footH + wanted * upright + 0.001;
      head.visible = on && upright >= 1;
      head.position.y = footH + wanted;
      crane.on = head.visible;
      for (const [k, m] of Object.entries(slung)) m.visible = !!job && job.load === k;
      if (job) {
        const dx = job.x - cx, dz = job.z - cz;
        crane.goalAngle = Math.atan2(-dz, dx);
        crane.goalR = Math.max(5, Math.min(R - 1.2, Math.hypot(dx, dz)));
        crane.goalHook = Math.min(head.position.y - 1, job.y + 3.4);
      } else {  // nothing to lift: over the material yard, hook up
        crane.goalAngle = Math.atan2(siteD / 2 - 5 + cz, -4 - cx);
        crane.goalR = Math.min(R - 2, 10);
        crane.goalHook = head.position.y - 1.5;
      }
      if (crane.fresh && crane.on) {  // the first time it is seen it is already in place
        crane.angle = crane.goalAngle; crane.r = crane.goalR; crane.hook = crane.goalHook;
        crane.fresh = false;
      }
      if (crane.on) pose();
    });
  }

  // ---------------------------------------------------------------------------------------------- the people on site
  const CREW = 64, bodies = keep(new THREE.InstancedMesh(keep(new THREE.CapsuleGeometry(0.21, 0.95, 3, 8).translate(0, 0.685, 0)), mat("#ee7a1f", { roughness: 0.7 }), CREW)), hats = keep(new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.32, 0)), mat("#f5d33c", { roughness: 0.4 }), CREW));
  for (const m of [bodies, hats]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }
  const placeCrew = () => {
    for (let i = 0; i < CREW; i++) {
      const at = people[i];
      dummy.position.set(at?.[0] ?? 0, at?.[1] ?? 0, at?.[2] ?? 0);
      dummy.rotation.set(0, hash(i, 9) * 6.28, 0);
      dummy.scale.setScalar(at ? 1 : 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      hats.setMatrixAt(i, dummy.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    hats.instanceMatrix.needsUpdate = true;
  };

  // ---------------------------------------------------------------------------------------------- the numbered pins: where each package listed on the right is being worked on today
  const pins = Array.from({ length: 14 }, () => {
    const el = document.createElement("div");
    el.style.cssText = "width:0;height:0;pointer-events:none";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;left:0;bottom:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center";
    const pill = document.createElement("div");
    pill.style.cssText = `display:flex;align-items:center;gap:3px;white-space:nowrap;border-radius:999px;background:rgba(17,20,24,.88);border:1px solid ${PIN};padding:2px;font:500 11px/1.2 system-ui,sans-serif;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35)`;
    const stem = document.createElement("div");
    stem.style.cssText = `width:2px;height:16px;background:${PIN}`;
    const dot = document.createElement("div");
    dot.style.cssText = `width:7px;height:7px;margin-top:-2px;border-radius:50%;background:${PIN};border:1.5px solid #111`;
    wrap.append(pill, stem, dot);
    el.append(wrap);
    const object = new CSS2DObject(el);
    object.visible = false;
    scene.add(object);
    return { object, pill, shown: "" };
  });
  const placePins = (day: number) => {
    const number = new Map(inOrder(els).filter((e) => day >= e.start && day < e.end).map((e, i) => [e.id, i + 1]));
    const groups: { at: THREE.Vector3; nums: number[]; tag: string }[] = [];
    for (const n of notes) {
      const nums = n.ids.map((id) => number.get(id)).filter((x): x is number => !!x);
      if (!n.pin || !nums.length) continue;
      const same = groups.find((g) => g.at.distanceTo(n.at) < 2.5);
      if (same) same.nums.push(...nums);
      else groups.push({ at: n.at, nums, tag: n.tag });
    }
    pins.forEach((pin, i) => {
      const g = groups[i];
      pin.object.visible = !!g;
      if (!g) return;
      pin.object.position.copy(g.at);
      const nums = [...new Set(g.nums)].sort((a, b) => a - b), tag = g.tag, key = `${nums}|${tag}`;
      if (pin.shown === key) return;
      pin.shown = key;
      pin.pill.replaceChildren();
      for (const n of nums) {
        const b = document.createElement("b");
        b.textContent = String(n);
        b.style.cssText = `display:inline-grid;place-items:center;min-width:17px;height:17px;border-radius:999px;background:${PIN};color:#111;font-size:10.5px;font-weight:700;padding:0 3px`;
        pin.pill.append(b);
      }
      if (tag) { const t = document.createElement("span"); t.textContent = tag; t.style.cssText = "padding:0 6px 0 3px"; pin.pill.append(t); }
    });
  };

  // ---------------------------------------------------------------------------------------------- clicking a part tells which work package builds it; dragging turns the view
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let pressed: [number, number] | null = null;
  const down = (ev: PointerEvent) => { pressed = [ev.clientX, ev.clientY]; if (fp.on) fp.drag = [ev.clientX, ev.clientY]; };
  const look = (ev: PointerEvent) => {
    if (!fp.on || !fp.drag) return;
    fp.yaw -= (ev.clientX - fp.drag[0]) * 0.0035;
    fp.pitch = Math.max(-1.35, Math.min(1.35, fp.pitch - (ev.clientY - fp.drag[1]) * 0.0035));
    fp.drag = [ev.clientX, ev.clientY];
  };
  const up = (ev: PointerEvent) => {
    fp.drag = null;
    if (!pressed || Math.hypot(ev.clientX - pressed[0], ev.clientY - pressed[1]) > 5) return;
    const box = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - box.left) / box.width) * 2 - 1, -((ev.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickable.filter((m) => m.visible), false).find((h) => !((h.object as THREE.Mesh).material as THREE.Material).clippingPlanes?.some((p) => p.distanceToPoint(h.point) < -0.01));  // what is clipped away is not there yet
    onPick(hit ? (hit.object.userData.ids as string[]) : null);
  };
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointermove", look);
  renderer.domElement.addEventListener("pointerup", up);

  // the drawing happens only when something moves: the view, the crane swinging to its next job, or the camera going to a part
  const render = () => { renderer.render(scene, camera); labels.render(scene, camera); };
  let goal: { target: THREE.Vector3; position: THREE.Vector3 } | null = null, frameId = 0;
  const tick = (now = 0) => {
    const dt = fp.last ? Math.min(0.05, (now - fp.last) / 1000) : 0.016;
    fp.last = now;
    frameId = 0;
    let moving = craneStep();
    if (fp.on) {
      moving = true;
      goal = null;
      const speed = 7, fwd = (fp.keys.has("KeyW") ? 1 : 0) - (fp.keys.has("KeyS") ? 1 : 0), side = (fp.keys.has("KeyD") ? 1 : 0) - (fp.keys.has("KeyA") ? 1 : 0), len = Math.hypot(fwd, side) || 1;
      const feetNow = camera.position.y - 1.62;
      const hitsPlane = (nx: number, nz: number) => fpStairHeights(nx, nz).some((h) => h > feetNow + 0.55 && h < feetNow + 1.8);
      let nx = camera.position.x + ((-Math.sin(fp.yaw) * fwd + Math.cos(fp.yaw) * side) / len) * 5.5 * dt;
      let nz = camera.position.z + ((-Math.cos(fp.yaw) * fwd - Math.sin(fp.yaw) * side) / len) * 5.5 * dt;
      if (hitsPlane(nx, nz)) { if (!hitsPlane(nx, camera.position.z)) nz = camera.position.z; else if (!hitsPlane(camera.position.x, nz)) nx = camera.position.x; else { nx = camera.position.x; nz = camera.position.z; } }
      camera.position.x = nx;
      camera.position.z = nz;
      const stand = fpFloor(camera.position.x, camera.position.z, camera.position.y - 1.62) + 1.62;
      if (fp.keys.has("KeyE")) { fp.air = false; fp.vy = 0; camera.position.y += speed * dt; }
      else if (fp.keys.has("KeyQ")) { fp.air = false; fp.vy = 0; camera.position.y = Math.max(stand, camera.position.y - speed * dt); }
      else {
        if (fp.keys.has("Space") && !fp.air && camera.position.y <= stand + 0.02) { fp.air = true; fp.vy = 7; }
        if (fp.air || camera.position.y > stand + 1.2) { fp.vy -= 22 * dt; camera.position.y += fp.vy * dt; if (camera.position.y <= stand) { camera.position.y = stand; fp.vy = 0; fp.air = false; } }
        else { if (fwd || side) fp.bob += dt * 9; else fp.bob = 0; camera.position.y = stand + (fwd || side ? Math.abs(Math.sin(fp.bob)) * 0.05 : 0); }
      }
      camera.position.x = Math.max(-siteW, Math.min(siteW, camera.position.x));
      camera.position.z = Math.max(-siteD, Math.min(siteD, camera.position.z));
      camera.position.y = Math.max((pit ? footing : 0) + 1.2, Math.min(top + 18, camera.position.y));
      camera.rotation.set(fp.pitch, fp.yaw, 0);
    }
    if (goal) {
      controls.target.lerp(goal.target, 0.12);
      camera.position.lerp(goal.position, 0.12);
      controls.update();
      if (camera.position.distanceTo(goal.position) < 0.05) goal = null;
      else moving = true;
    }
    render();
    if (moving) frameId = requestAnimationFrame(tick);
  };
  const kick = () => { if (!frameId) frameId = requestAnimationFrame(tick); };
  const stopGoing = () => { goal = null; };
  controls.addEventListener("start", stopGoing);
  controls.addEventListener("change", render);
  const resize = () => {
    const w = holder.clientWidth, h = holder.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };
  const watch = new ResizeObserver(resize);
  watch.observe(holder);
  resize();
  const setFp = (on: boolean) => {
    if (on === fp.on) return;
    if (on) {
      fp.savedPos.copy(camera.position);
      fp.savedTarget.copy(controls.target);
      goal = null;
      fp.keys.clear();
      controls.enabled = false;
      camera.rotation.order = "YXZ";
      fp.vy = 0; fp.air = false; fp.jumpBase = 1.62; fp.bob = 0; fp.hadLock = false;
      camera.position.set(0, 1.62, hd + 9);
      const dir = V(0, Math.min(4, Math.max(2, top * 0.25)), 0).sub(camera.position).normalize();
      fp.yaw = Math.atan2(-dir.x, -dir.z);
      fp.pitch = Math.asin(dir.y);
      fp.on = true;
      camera.rotation.set(fp.pitch, fp.yaw, 0);
      renderer.domElement.style.cursor = "grab";
    } else {
      fp.on = false;
      fp.keys.clear();
      fp.drag = null;
      camera.position.copy(fp.savedPos);
      controls.target.copy(fp.savedTarget);
      controls.enabled = true;
      controls.update();
    }
    onFirstPerson?.(on);
    kick();
  };
  // (no pointer lock: the cursor stays usable while in first person)

  return {
    update: (day, ghost) => {
      today = day;
      notes = [];
      people = [];
      job = null;
      pourAt = null;
      frameTop = 0;
      for (const p of parts) p(day);
      for (const g of ghosts) g.visible = ghost;
      placeCrew();
      placePins(day);
      kick();
      const told: Record<string, string> = {};
      for (const n of notes) if (n.text) for (const id of n.ids) told[id] ??= n.text;
      return told;
    },
    focus: (ids) => {
      const note = notes.find((n) => n.ids.some((id) => ids.includes(id)));
      if (!note) return;
      const off = camera.position.clone().sub(controls.target), far = Math.min(off.length(), span * 1.5);
      if (note.at.y < 0) off.y = Math.max(off.y, Math.hypot(off.x, off.z) * 1.1);  // work below ground is seen from above, over the side of the pit
      goal = { target: note.at.clone(), position: note.at.clone().add(off.setLength(far)) };
      kick();
    },
    overview: () => {
      goal = { target: wholeSite.target.clone(), position: wholeSite.position.clone() };
      kick();
    },
    setFirstPerson: setFp,
    dispose: () => {
      watch.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
      controls.removeEventListener("start", stopGoing);
      controls.dispose();
      window.removeEventListener("keydown", fpKeyDown);
      window.removeEventListener("keyup", fpKeyUp);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", look);
      renderer.domElement.removeEventListener("pointerup", up);
      for (const x of owned) x.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
