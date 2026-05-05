"use client";

import { useEffect, useState } from "react";
import { projectSlug } from "@/lib/project-slugs";

// Deterministic palette for the initial-avatar fallback. Picked when no
// CoinGecko logo is available for the project (or while the lookup is in
// flight).
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Project logo with the same lookup path the Builder page uses for asset
 * logos: hits `/api/asset-logos` (CoinGecko-backed, batched + cached at the
 * route handler) and renders the returned PNG. Falls back to a deterministic
 * initial avatar when the project has no CoinGecko mapping or the image fails
 * to load.
 *
 * Pass `logoUrl` directly (string|null) when the parent has already batched
 * the lookup — the component then skips its own fetch.
 *
 *   undefined  → lookup in flight (neutral avatar shown)
 *   null       → confirmed no logo (avatar shown)
 *   string     → render image, with onError → avatar
 */
export function ProjectLogo({
  name,
  size = 32,
  logoUrl,
}: {
  name: string;
  size?: number;
  logoUrl?: string | null;
}) {
  const [errored, setErrored] = useState(false);
  const [fetched, setFetched] = useState<string | null | undefined>(undefined);
  const useExternal = logoUrl !== undefined;
  const effectiveUrl = useExternal ? logoUrl : fetched;

  useEffect(() => {
    if (useExternal) return;
    setErrored(false);
    const slug = projectSlug(name);
    if (!slug) {
      setFetched(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/asset-logos?ids=${encodeURIComponent(slug)}`, {
      cache: "force-cache",
    })
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => {
        if (!cancelled) setFetched(data[slug] ?? null);
      })
      .catch(() => {
        if (!cancelled) setFetched(null);
      });
    return () => {
      cancelled = true;
    };
  }, [name, useExternal]);

  const showImage = !!effectiveUrl && !errored;

  if (showImage) {
    return (
      <div
        title={name}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          background: "#0008",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
          padding: size * 0.08,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={effectiveUrl as string}
          alt={name}
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

  const color = PALETTE[hash(name) % PALETTE.length];
  return (
    <div
      aria-label={name}
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        flexShrink: 0,
        userSelect: "none",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {initials(name)}
    </div>
  );
}
