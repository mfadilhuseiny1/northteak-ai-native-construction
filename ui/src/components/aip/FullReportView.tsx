"use client";
import type { ReactNode } from "react";
import type { AipEvent } from "@/components/aip/aipRun";

export function FullReportView({ fallback }: { run: string; verdict?: AipEvent; fallback: ReactNode }) {
  return <>{fallback}</>;
}
