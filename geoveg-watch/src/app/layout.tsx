import type { Metadata } from "next";
import "./globals.css";
import ReduxProvider from "@/store/ReduxProvider";

export const metadata: Metadata = {
  title: "GeoVeg Watch — Satellite Land Change Viewer",
  description:
    "Draw or search any area and see its vegetation, water, and forest-cover trends across the years Sentinel-2 satellite data is available, automatically.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <ReduxProvider>{children}</ReduxProvider>
      </body>
    </html>
  );
}
