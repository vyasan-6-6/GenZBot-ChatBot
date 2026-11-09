import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GenBot Foundation — Next.js + Express + MongoDB",
  description:
    "Project foundation with Next.js frontend, Express TypeScript API, and MongoDB connection.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

