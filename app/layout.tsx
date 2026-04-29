import type { Metadata } from "next";
import { headers } from "next/headers";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "HypeNode Autonomous Indexer",
  description:
    "Research-to-Execution autonomous indexer powered by SoSoValue Terminal · LangGraph · MCP · SSI Protocol · SoDEX",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Touch headers() so the layout opts into dynamic rendering — wagmi's SSR
  // hydration depends on per-request cookies, not a build-time snapshot.
  headers();
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
