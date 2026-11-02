import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "SiteSwarm", description: "An agent swarm that works a construction site disruption through to a recovery plan.", icons: { icon: "data:," } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen flex-col overflow-hidden">{children}</body>
    </html>
  );
}
