import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GenZBot — AI Chatbot (Next.js + Express + Ollama + MongoDB)",
  description:
    "Full-stack AI chatbot powered by Next.js, Express, Ollama LLM API, and MongoDB.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
