"use client";
import { API_URL } from "@/lib/api";
import type { AipEvent, Rec, Run } from "@/components/aip/aipRun";

/* SiteSwarm: the firm orchestration, the signal ledger and the semantic layer, the risk register and the pre-agent review. */

async function req<T = Rec>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const d = body.detail;
    throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d).slice(0, 400) : `${r.status} ${r.statusText}`);
  }
  return r.json();
}
const post = <T = Rec>(path: string, body: unknown) =>
  req<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type FirmAgent = {
  key: string; name: string; peran: string; lini: string; jenjang: "partner" | "manajer" | "analis" | "validator" | "peran"; induk: string | null; model: string;
  peran_kode: string; target?: Rec | null; instans_dari?: string;
};
export type Sizing = { lini: string; agen: number; alasan: string };
export type Team = { tim: FirmAgent[]; mesin: { key: string; name: string; peran: string }[]; jumlah_agen: number; keluarga_model: Record<string, number>; brief: string;
  ukuran: Sizing[]; lini: Record<string, number> };
// a project's IT settings: the data the firm reads, each seat's model
export type SourceRow = { tipe: string; wajib: boolean; dipakai: string; ada: boolean; objek: number; dataset?: string | null; diperbarui?: string | null };
export type Sources = { sumber: string; tipe: SourceRow[]; siap: boolean; kurang: string[]; pendukung_kurang: string[] };
export type Seat = { kursi: string; label: string; dipakai: string; default: string };
export type ModelOpt = { id: string; label: string; vendor: string; keluarga: string; siap: boolean; alasan?: string | null; harga: { input: number; output: number } };
export type FirmConfig = { sumber: Sources; kursi: Seat[]; model: ModelOpt[]; paralel: { min: number; default: number; maks: number };
  batas_usd: { min: number; maks: number }; brief: string; versi?: Record<string, OrchestrationVersion> };
/** The AI orchestration a review runs: 1.0, 1.1 with the review first, or 1.3 with an external review first. */
export type OrchestrationVersion = { nama: string; ringkas: string; tambahan: string | null };
/** The orchestrations with a review before the agents. */
export const REVIEWED: string[] = [];
/** Each orchestration's badge before a review's name: its title and its colours. */
export const VERSI_BADGE: Record<string, [string, string]> = {
  muse: ["Muse", "bg-[#f5b82e]/20 text-[#c9c0ff]"],
  mock: ["Offline mock", "bg-white/10 text-[#abb3bf]"],
};
/** The pre-agent review before it runs: the set, what is kept, the last calibration. */
export type ReviewSummary = {
  items: number; sumber: Record<string, number>; model: { saring: string; periksa: string }; versi_prompt: string; groups: number;
  tersimpan: { saring: number; periksa: number; kesimpulan_saring: Record<string, number>; both_flagged: number };
  kalibrasi: ReviewCalibration | null; kalibrasi_berlaku: boolean; batas_usd: number;
  estimasi: { items: number; sisa_saring: number; sisa_periksa_perkiraan: number; flagged_share_used: number; usd_saring: number; usd_periksa: number;
    usd_total: number };
  aturan: { sampel_kalibrasi: number; kappa_min: number; porsi_sah_min: number; audit_acak: number };
};
export type ReviewCalibration = { run_id: string; t: string; n: number; lolos: boolean; alasan: string[]; proyeksi_usd: number; terpakai_usd: number; batas_usd: number;
  model: { saring: string; periksa: string }; hasil: Rec };
export type Project = { id: string; nama: string; brief: string; fokus: string; batas_usd: number | null; paralel: number; model: Record<string, string>;
  dibuat_pada?: string; dibuat_oleh?: string; virtual?: boolean };
export type Exhibit = { id: string; nomor: number; bab: string; judul: string; ukuran: string; jenis: string; baris: Rec[]; fakta: string[]; sumber: string;
  satuan?: string; tanda?: { items: number; label: string }[]; model?: Rec;
  /** each measure as the orchestrator reads it (the designed exhibit): a plain name, its value, a sentence with the numbers */
  pimpinan?: { metrik: string; nilai: string; arti: string }[] };
export type FullReport = { basis?: string | null; beku_pada?: string | null; narasi_oleh?: string | null; run: string; status: string; mulai?: string; selesai?: string | null; biaya_usd?: number; agen: number; judul: string;
  bab: { id: string; judul: string; bagian: { id: string; judul: string; teks: string }[]; exhibit: string[] }[]; exhibit: Exhibit[];
  narasi?: Record<string, { makna?: string; implikasi?: string }> | null; narasi_model?: string | null; narasi_pada?: string | null; narasi_dibuang: number;
  narasi_status: "belum" | "menulis" | "ada" | "gagal"; narasi_galat?: string | null };
export type ProjectForm = { nama: string; brief: string; fokus: string; batas_usd: number | null; paralel: number; model: Record<string, string> };

export type Impact = Record<"schedule" | "cost" | "constraints", { nilai: "terpenuhi" | "sebagian" | "tidak"; poin: number; bukti: string }>;
export type BoxFacility = {
  item_id: string; nama: string; provinsi?: string; kabkota?: string; tipe?: string; jenis?: string; kelompok: string;
  estimasi_kerugian_rp: number; sudah_dikoreksi_rp: number; nilai_terpapar_rp: number; rincian_kerugian?: Record<string, number>;
  contributing_records?: { record_id: string; komponen: string; nilai_rp: number; dibayar_rp: number; peer_p50_rp: number; work_code?: string; duration_days?: number; tag: string[] }[];
  tagged_records: number; item_records: number; tagged_share: number; affected_people: number; bulan_aktif: number; work_code_count: number; jaringan: string[];
  modus: Record<string, number>; tag: number; kuat: number; sedang: number; lemah: number; keparahan: number; keparahan_label: string; impact: Impact;
  impact_signal: boolean; jalur_awal: "risky" | "rejected" | "recommended"; status: string; rekomendasi: { agen: string; jalur: string; impact: Rec; alasan: string; t: string; run_id: string }[];
  keputusan?: Rec | null; riwayat: Rec[]; klasifikasi: string; marking: string[]; indikasi?: Rec[];
};
export type Box = {
  ringkasan: Rec | null; jalur: Record<string, string>; kelompok_arti: Record<string, string>; total: number; per_status: Record<string, number>;
  kelompok: Record<string, { total: number; items: BoxFacility[] }>;
  // a review's register (?review=): whole, or only its summary with the items its option analysts checked
  review?: { run: string; lengkap: boolean; asal: string; pada: string | null };
  audited_by_review?: (Pick<BoxFacility, "item_id" | "nama" | "provinsi" | "kabkota" | "tipe" | "kelompok" | "estimasi_kerugian_rp" | "status" | "klasifikasi" | "impact"> &
    { rekomendasi: BoxFacility["rekomendasi"] })[];
};

// the simulation of a project, kept after its first load in this page (the server keeps it on disk too)
const simCache = new Map<string, Promise<{ run: Run; events: AipEvent[]; sumber: string; catatan: string }>>();

export const firm = {
  team: () => req<Team>("/api/aip/konsultan/tim"),
  // from the start form: its name and focus; in a project, the project's brief and IT settings (fokus null: the project's)
  startEngagement: (f: { nama: string; fokus: string | null; proyek: string | null; versi?: string }) =>
    post<{ run: string; jumlah_agen: number }>("/api/aip/konsultan", { nama: f.nama, fokus: f.fokus, proyek: f.proyek, versi: f.versi ?? "muse" }),
  // a review as an animation only: phase 1 projected from the calibration, later phases from the project's latest finished review as it ran; no model is called
  simulation: (proyek?: string | null) => {
    const k = proyek ?? "";
    let p = simCache.get(k);
    if (!p) {
      p = req<{ run: Run; events: AipEvent[]; sumber: string; catatan: string }>(`/api/aip/konsultan/simulasi${proyek ? `?proyek=${encodeURIComponent(proyek)}` : ""}`);
      simCache.set(k, p);
      p.catch(() => simCache.delete(k));
    }
    return p;
  },
  config: () => req<FirmConfig>("/api/aip/konsultan/konfigurasi"),
  sources: () => req<Sources>("/api/aip/konsultan/sumber"),
  projects: () => req<Project[]>("/api/aip/konsultan/proyek"),
  createProject: (f: ProjectForm) => post<Project>("/api/aip/konsultan/proyek", f),
  updateProject: (id: string, f: ProjectForm) =>
    req<Project>(`/api/aip/konsultan/proyek/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }),
  // a project off the list with its reviews (their trails kept)
  deleteProject: (id: string) => req<{ dihapus: string; reviews: string[] }>(`/api/aip/konsultan/proyek/${id}`, { method: "DELETE" }),
  // a wrong or accidental review off the list (its trail kept for an administrator)
  deleteEngagement: (id: string) => req<{ dihapus: string }>(`/api/aip/konsultan/${id}`, { method: "DELETE" }),
  engagements: () => req<Rec[]>("/api/aip/konsultan/runs"),
  // the last finished review on the platform: the analysis the chat answers from ({ada: false} before the first)
  latest: () => req<{ ada: boolean; run?: string; pada?: string; biaya_usd?: number }>("/api/aip/konsultan/terakhir"),
  // the live risk register, or a review's; ringkas: list rows only
  box: (q: { kelompok?: string; review?: string; limit?: number; ringkas?: boolean } = {}) =>
    req<Box>(`/api/aip/register?${new URLSearchParams(Object.entries({ limit: q.kelompok ? 2000 : 60, ...q }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`),
};

export const rp = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e9 ? `Rp ${(n / 1e9).toFixed(2)} bn` : n >= 1e6 ? `Rp ${(n / 1e6).toFixed(1)} m` : `Rp ${Math.round(n).toLocaleString("en-US")}`;
export const STRENGTH: Record<string, string> = { lemah: "#8f99a8", sedang: "#fab219", kuat: "#e5484d" };
export const GROUP_COLOR: Record<string, string> = { A: "#e5484d", B: "#ec835a", C: "#fab219", D: "#3987e5", Z: "#738091" };
