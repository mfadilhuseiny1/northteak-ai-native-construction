/* What a phone has done and not yet sent. Saved before anything else, so a lost signal or a closed browser loses nothing. Text goes in localStorage; a photo is too big for it, so it goes in IndexedDB. A job the server refuses, such as a move a hold point forbids, leaves the queue and is shown: sending it again would only be refused again. */

import type { Rec } from "@/components/site/kit";

const KEY = "northteak.field.queue";
const STORE = "photos";
type Job = { id: string; path: string; label: string; body?: Rec; photo?: { caption: string } };
export type Refused = { label: string; why: string };

function jobs(): Job[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Job[]; } catch { return []; }
}
function save(list: Job[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
export const waiting = () => jobs().length;
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function photos(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const open = indexedDB.open("northteak-field", 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => done(open.result);
    open.onerror = () => fail(open.error);
  });
}
async function inStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await photos();
  return new Promise((done, fail) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => { done(req.result); db.close(); };
    req.onerror = () => { fail(req.error); db.close(); };
  });
}

export function queueJson(path: string, body: Rec, label: string) {
  save([...jobs(), { id: newId(), path, label, body }]);
}

export async function queuePhoto(file: File, caption: string) {
  const id = newId();
  await inStore("readwrite", (s) => s.put(file, id));
  save([...jobs(), { id, path: "/api/project/photos", label: caption || "Photo", photo: { caption } }]);
}

async function send(job: Job): Promise<Response> {
  if (!job.photo) return fetch(job.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body) });
  const file = await inStore<File>("readonly", (s) => s.get(job.id));
  const body = new FormData();
  body.append("file", file);
  body.append("caption", job.photo.caption);
  return fetch(job.path, { method: "POST", body });
}

let running = false;

/** Sends what is waiting, in the order it was done. It stops at the first sign the network is gone, and tries again later. */
export async function flush(): Promise<{ sent: number; refused: Refused[] }> {
  const out = { sent: 0, refused: [] as Refused[] };
  if (running) return out;
  running = true;
  try {
    for (const job of jobs()) {
      let r: Response;
      try { r = await send(job); } catch { break; }
      if (r.status === 401 || r.status >= 500) break;  // signed out or the server is down: the job is still good
      if (!r.ok) out.refused.push({ label: job.label, why: (await r.json().catch(() => ({}))).detail ?? `refused (${r.status})` });
      else out.sent++;
      save(jobs().filter((j) => j.id !== job.id));
      if (job.photo) await inStore("readwrite", (s) => s.delete(job.id)).catch(() => {});
    }
  } finally { running = false; }
  return out;
}
