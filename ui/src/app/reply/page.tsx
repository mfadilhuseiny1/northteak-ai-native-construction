"use client";
import { useEffect, useState } from "react";
import { api, type Rec } from "@/components/site/kit";

/* Where someone outside the firm answers one item, with no account: a consultant, or the owner's representative. It shows that item and nothing else in the project. In Indonesian, because they are, and on a phone as often as not. */

const WHAT: Record<string, string> = { rfi: "Permintaan informasi (RFI)", variation: "Perubahan pekerjaan", submittal: "Pengajuan persetujuan" };
const CHOICE: Record<string, string> = { approved: "Disetujui", noted: "Disetujui dengan catatan", rejected: "Ditolak" };
const REASON: Record<string, string> = { "Owner's change": "Perubahan dari pemilik", "Design change": "Perubahan desain", "Site condition": "Kondisi lapangan", "Error or omission": "Kesalahan atau kelalaian", Other: "Lainnya" };
const WHAT_KIND: Record<string, string> = { "Material approval": "Persetujuan material", "Shop drawing": "Shop drawing", "Method statement": "Metode kerja", "Sample or mock-up": "Contoh atau mock-up" };
const rupiah = (n: number) => `Rp ${Number(n).toLocaleString("id-ID")}`;

export default function ReplyPage() {
  const [token, setToken] = useState("");
  const [item, setItem] = useState<Rec | null>(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", text: "", decision: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (!t) { setErr("Tautan ini tidak lengkap."); return; }
    api(`/api/public/reply/${encodeURIComponent(t)}`).then(setItem).catch((e) => setErr((e as Error).message));
  }, []);
  const send = async () => {
    setBusy(true);
    setErr("");
    try { setItem(await api(`/api/public/reply/${encodeURIComponent(token)}`, f)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const box = "w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2.5 text-[15px] text-white placeholder:text-[#6b7480] focus:border-[#f5b82e]/70 focus:outline-none";
  const decisions = (item?.decisions ?? []) as string[];
  const needsText = item?.kind === "rfi" || f.decision === "noted" || f.decision === "rejected";
  const ready = f.name.trim() && (!decisions.length || f.decision) && (!needsText || f.text.trim());
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#111820]">
      <main className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-6 text-[15px] leading-relaxed">
        <span role="img" aria-label="NorthTeak" className="logo-full h-6 w-[123px] text-white" />
        {!item && !err && <p className="text-[#abb3bf]">Memuat…</p>}
        {!item && err && <div className="rounded-xl border border-white/10 bg-[#1c2733] p-4 text-[#ffb4b4]">{err}</div>}
        {item && (
          <>
            <div>
              <p className="text-[13px] text-[#abb3bf]">{item.project}{item.contractor ? ` · ${item.contractor}` : ""}</p>
              <h1 className="mt-1 text-[21px] font-bold leading-snug text-white">{item.title}</h1>
              <p className="text-[13px] text-[#8f99a8]">{WHAT[item.kind]} {item.id}{item.rev ? `, revisi ${item.rev}` : ""}</p>
            </div>
            <section className="space-y-2 rounded-xl border border-white/10 bg-[#1c2733] p-4">
              {item.body && <p className="whitespace-pre-line text-[#e5e8eb]">{REASON[item.body] ?? item.body}</p>}
              {item.why && item.why !== item.body && <p className="text-[14px] text-[#abb3bf]">{REASON[item.why] ?? WHAT_KIND[item.why] ?? item.why}</p>}
              {item.kind === "variation" && <p className="text-[#e5e8eb]">Nilai <b className="text-white">{rupiah(item.value)}</b>{item.days ? `, tambahan waktu ${item.days} hari` : ""}{item.ref ? `. Acuan: ${item.ref}` : ""}</p>}
              {item.ref && item.kind === "submittal" && <p className="text-[14px] text-[#abb3bf]">Acuan: {item.ref}</p>}
              {item.due && <p className="text-[14px] text-[#fbd38d]">Dibutuhkan sebelum {item.due}</p>}
              {item.file && <a href={`/api/public/reply/${encodeURIComponent(token)}/file`} className="inline-block rounded-lg border border-white/20 px-3 py-2 text-[14px] text-white hover:bg-white/10">Unduh {item.file}</a>}
            </section>
            {item.open && !item.replied ? (
              <section className="space-y-3">
                {decisions.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Keputusan">
                    {decisions.map((d) => <button key={d} onClick={() => setF({ ...f, decision: d })} aria-pressed={f.decision === d} className={`rounded-lg border px-3 py-3 text-[14px] font-medium ${f.decision === d ? "border-[#f5b82e] bg-[#f5b82e]/15 text-white" : "border-white/15 text-[#d3d8de]"}`}>{CHOICE[d]}</button>)}
                  </div>
                )}
                <label className="block"><span className="mb-1 block text-[13px] text-[#abb3bf]">{item.kind === "rfi" ? "Jawaban Anda" : needsText ? "Apa yang perlu diubah" : "Catatan, jika ada"}</span><textarea rows={item.kind === "rfi" ? 6 : 3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} className={box} /></label>
                <label className="block"><span className="mb-1 block text-[13px] text-[#abb3bf]">Nama dan jabatan Anda</span><input value={f.name} autoComplete="name" onChange={(e) => setF({ ...f, name: e.target.value })} className={box} /></label>
                {err && <p role="alert" className="text-[14px] text-[#ffb4b4]">{err}</p>}
                <button disabled={busy || !ready} onClick={() => void send()} className="w-full rounded-lg bg-[#f5b82e] px-4 py-3 text-[15px] font-semibold text-[#171106] disabled:opacity-40">Kirim</button>
                <p className="text-[12.5px] text-[#8f99a8]">Tautan ini hanya untuk satu jawaban. Jawaban Anda tercatat dengan nama dan waktunya.</p>
              </section>
            ) : (
              <section className="rounded-xl border border-[#29a383]/40 bg-[#29a383]/10 p-4">
                <p className="font-semibold text-white">{item.replied || !item.open ? "Sudah dijawab. Terima kasih." : "Tidak lagi menunggu jawaban."}</p>
                {item.status && CHOICE[item.status] && <p className="text-[#d3d8de]">{CHOICE[item.status]}</p>}
                {item.answer && <p className="mt-1 whitespace-pre-line text-[#d3d8de]">{item.answer}</p>}
                {item.answered_by && <p className="mt-1 text-[13px] text-[#abb3bf]">{item.answered_by}</p>}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
