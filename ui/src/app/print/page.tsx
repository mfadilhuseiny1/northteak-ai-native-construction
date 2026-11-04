"use client";
import { useEffect, useState } from "react";
import { FundingPages } from "@/components/site/FundingPages";
import { api, type Rec } from "@/components/site/kit";

/** The funding report alone, as A4 pages, for printing or saving as PDF. It opens the print dialog once its figures are in. */
export default function PrintPage() {
  const [data, setData] = useState<Rec | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/api/reports/portfolio").then(setData).catch((e) => setErr((e as Error).message)); }, []);
  useEffect(() => {
    if (!data) return;
    document.title = `Funding report ${data.quarter}`;
    const t = window.setTimeout(() => window.print(), 800);  // the charts lay out first
    return () => window.clearTimeout(t);
  }, [data]);
  return (
    <div className="h-full overflow-y-auto bg-[#e9ecef] py-6 print:h-auto print:overflow-visible print:bg-white print:py-0" style={{ colorScheme: "light" }}>
      {err && <p className="mx-auto max-w-[794px] rounded bg-white p-4 text-[13px] text-[#b42318]">The report could not be read: {err}</p>}
      {!data && !err && <p className="text-center text-[13px] text-[#4b5563]">Reading the projects…</p>}
      {data && <FundingPages data={data} />}
    </div>
  );
}
