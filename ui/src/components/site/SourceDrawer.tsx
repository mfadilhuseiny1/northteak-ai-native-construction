"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { API_URL } from "@/lib/api";
import { api, type Rec } from "./kit";

/* The source of anything the agents extracted, opened beside it: the consultant's own file at the page cited, with the words quoted above it. Any screen can open it, so nobody leaves what they are checking to read where it came from. */

export type Source = { doc: string; page?: number; quote?: string; title?: string };

const IN_PLACE = /\.(pdf|png|jpe?g|txt|md|csv)$/i;

export function openSource(s: Source) {
  window.dispatchEvent(new CustomEvent<Source>("open-source", { detail: s }));
}

export function SourceLink({ doc, page, quote, title, children }: Source & { children?: ReactNode }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); openSource({ doc, page, quote, title }); }} title={quote ? `“${quote}”` : "Open the source"} className="inline-flex items-center gap-1 rounded bg-white/[.08] px-1.5 py-px text-[11.5px] text-[#9cc7f5] hover:bg-white/15">
      <Icon name="doc" className="h-3 w-3 shrink-0" />{children ?? `${title || doc}${page ? `, p.${page}` : ""}`}
    </button>
  );
}

export function SourceDrawer() {
  const [src, setSrc] = useState<Source | null>(null);
  const [doc, setDoc] = useState<Rec | null>(null);
  useEffect(() => {
    const open = (e: Event) => setSrc((e as CustomEvent<Source>).detail);
    window.addEventListener("open-source", open);
    return () => window.removeEventListener("open-source", open);
  }, []);
  useEffect(() => {
    if (!src) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setSrc(null); };
    window.addEventListener("keydown", close);
    setDoc(null);
    let live = true;
    api("/api/project/package").then((p) => { if (live) setDoc((p.documents as Rec[]).find((d) => d.id === src.doc) ?? { id: src.doc, missing: true }); }).catch(() => { if (live) setDoc({ id: src.doc, missing: true }); });
    return () => { live = false; window.removeEventListener("keydown", close); };
  }, [src]);
  if (!src) return null;
  const url = `${API_URL}/api/project/documents/${src.doc}/file`;
  const shown = doc?.file && IN_PLACE.test(String(doc.file));
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[min(760px,92vw)] flex-col border-l border-white/15 bg-[#1c2127] text-[13px] shadow-2xl" role="dialog" aria-label="Source document">
      <div className="flex shrink-0 items-start gap-2 border-b border-white/10 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{doc?.title ?? src.title ?? src.doc}</p>
          <p className="text-[11.5px] text-[#8f99a8]">{src.doc}{src.page ? `, page ${src.page}` : ""}</p>
        </div>
        {doc?.file && <a href={url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 rounded border border-white/15 px-2 py-1 text-[12px] text-[#d3d8de] hover:bg-white/5"><Icon name="external" className="h-3 w-3" />New tab</a>}
        <button onClick={() => setSrc(null)} aria-label="Close" className="shrink-0 rounded p-1 text-[#8f99a8] hover:bg-white/10 hover:text-white"><Icon name="x" className="h-4 w-4" /></button>
      </div>
      {src.quote && <p className="shrink-0 border-b border-white/10 bg-[#fab219]/[.07] px-4 py-2 leading-snug text-[#fbd38d]">“{src.quote}”</p>}
      {shown
        ? <iframe key={`${src.doc}-${src.page ?? 0}`} title={String(doc?.title ?? src.doc)} src={`${url}${src.page ? `#page=${src.page}` : ""}`} className="min-h-0 w-full flex-1 bg-white" />
        : doc && <div className="p-6 text-center text-[#abb3bf]">{doc.missing ? "This document is not among the uploaded files, so it cannot be shown here." : <>This kind of file cannot be shown here. <a href={url} className="text-[#9cc7f5] underline">Download it</a> to read it.</>}</div>}
    </div>
  );
}
