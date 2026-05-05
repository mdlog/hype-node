"use client";

import { useEffect, useState } from "react";
import { tokens } from "@/lib/tokens";

// Stacked-avatar style logo for SSI indices: render the top N constituent
// token logos overlapping. Conveys "this is a basket of these coins" in a
// single 28-32px slot, replacing the plain text-symbol that was there before
// (no real logo asset exists for SoSoValue's index products themselves).
//
// Caller passes lowercase token symbols (the SoSoValue id form, e.g.
// ["btc", "eth", "sol"]). The component batches them into one
// /api/asset-logos call and renders each as a circular badge — image when
// CoinGecko knows the coin, deterministic colored letter when it doesn't.

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

export function SsiCompositeLogo({
  symbols,
  size = 28,
  max = 3,
}: {
  symbols: string[];
  size?: number;
  max?: number;
}) {
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  // Stable cache key so React only re-runs the effect when symbols actually
  // change, even if the parent passes a fresh array reference each render.
  const cacheKey = symbols.slice(0, max).join(",").toLowerCase();

  useEffect(() => {
    const ids = cacheKey.split(",").filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    fetch(`/api/asset-logos?ids=${encodeURIComponent(ids.join(","))}`, {
      cache: "force-cache",
    })
      .then((r) => r.json() as Promise<Record<string, string | null>>)
      .then((data) => {
        if (!cancelled) setLogos(data);
      })
      .catch(() => {
        // Silent — letter-avatar fallback covers it.
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  const visible = symbols.slice(0, max);
  // Each circle slightly smaller than the slot so multiple fit while
  // staying tall enough to read. Overlap is 40% of the circle width.
  const each = Math.round(size * 0.85);
  const overlap = Math.round(each * 0.4);
  const stride = each - overlap;
  const totalWidth = visible.length === 0 ? size : each + stride * (visible.length - 1);

  if (visible.length === 0) {
    return <div style={{ width: size, height: size }} />;
  }

  return (
    <div
      className="flex items-center"
      style={{
        width: totalWidth,
        height: each,
        flexShrink: 0,
      }}
    >
      {visible.map((rawSym, i) => {
        const sym = rawSym.toLowerCase();
        const url = logos[sym];
        const color = PALETTE[hash(sym) % PALETTE.length];
        const initial = (sym[0] ?? "?").toUpperCase();
        return (
          <div
            key={`${sym}-${i}`}
            title={sym.toUpperCase()}
            style={{
              width: each,
              height: each,
              borderRadius: "50%",
              background: url
                ? "#0008"
                : `linear-gradient(135deg, ${color}, ${color}99)`,
              border: `1.5px solid ${tokens.bg}`,
              marginLeft: i === 0 ? 0 : -overlap,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
              // Higher z-index for earlier (heavier-weight) constituents so
              // the dominant token sits on top of the stack.
              zIndex: 10 - i,
              position: "relative",
              fontSize: Math.round(each * 0.42),
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "-0.02em",
              fontFamily: "system-ui, -apple-system, sans-serif",
              userSelect: "none",
            }}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={sym}
                width={each}
                height={each}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  padding: Math.round(each * 0.1),
                }}
              />
            ) : (
              initial
            )}
          </div>
        );
      })}
    </div>
  );
}
