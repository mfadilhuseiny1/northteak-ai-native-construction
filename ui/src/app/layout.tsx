import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "SiteSwarm", description: "AI construction management: WBS, scheduling, cost, Kanban, documents, procurement, QA/QC and a control tower, with agents on each module.", icons: { icon: "data:," } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen flex-col overflow-hidden">{children}</body>
    </html>
  );
}
