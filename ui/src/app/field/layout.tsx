import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "NorthTeak: site", manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "NorthTeak" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#111820" };

export default function FieldLayout({ children }: { children: ReactNode }) {
  return children;
}
