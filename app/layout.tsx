import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HypeNode Autonomous Indexer",
  description:
    "Research-to-Execution autonomous indexer powered by SoSoValue Terminal · LangGraph · MCP · SSI Protocol · SoDEX",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
