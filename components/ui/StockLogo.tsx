"use client";

import { useState } from "react";

import { stockLogoUrl } from "@/lib/stock-logos";

// Deterministic palette for the letter-avatar fallback when a stock ticker
// has no curated domain mapping (or the favicon fetch errors).
const PALETTE = [
  "#10B981", // emerald
  "#22D3EE", // cyan
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // teal
  "#84CC16", // lime
  "#F97316", // orange
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function tickerInitials(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  // Keep at most 2 chars so the avatar reads cleanly at 18-24px.
  return t.slice(0, 2) || "?";
}

/**
 * Square logo for a public-company crypto stock. Uses Google's favicon
 * service via `lib/stock-logos.ts` for tickers we have curated, and
 * falls back to a deterministic letter avatar (ticker first 1-2 chars
 * over a palette color seeded by ticker hash) when:
 *   - Ticker isn't in the curated map (no domain known)
 *   - The favicon fetch returned 404 / non-image
 *
 * Sized for table rows by default (20px). Pass `size` to scale for
 * other contexts (sector cards, detail headers).
 */
export function StockLogo({
  ticker,
  name,
  size = 20,
}: {
  ticker: string;
  name?: string;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const url = stockLogoUrl(ticker);
  const showImage = url && !errored;

  if (showImage) {
    return (
      <div
        title={name ?? ticker}
        style={{
          width: size,
          height: size,
          borderRadius: 4,
          background: "#fff",
          border: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
          padding: size * 0.1,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name ?? ticker}
          width={size}
          height={size}
          onError={() => setErrored(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>
    );
  }

  const color = PALETTE[hash(ticker) % PALETTE.length];
  return (
    <div
      aria-label={name ?? ticker}
      title={name ?? ticker}
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        flexShrink: 0,
        userSelect: "none",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {tickerInitials(ticker)}
    </div>
  );
}
