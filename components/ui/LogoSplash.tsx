import { tokens } from "@/lib/tokens";

/**
 * Centered logo splash loader. Renders the HypeNode logo at the center of
 * its container with a pulsing emerald glow surrounded by two concentric
 * rings of segmented bars. A bright "head" travels around each ring at a
 * different cadence, creating the classic "scanner / processing" loading
 * effect.
 *
 * Implementation:
 *   - Each ring is N absolutely-positioned `<span>` bars.
 *   - Each bar is centered on the container origin, then transformed via
 *     `rotate(angle) translateY(-radius)` so it sits at its radial slot
 *     oriented outward.
 *   - The shared keyframe `hype-splash-bar-glow` cycles each bar dim →
 *     bright → dim. Per-bar `animationDelay` is set to
 *     `-(i/N) * cycleDuration` so the bright phase staggers around the
 *     ring, producing a single rotating "head".
 *   - Outer and inner rings use slightly different cycles (1.6s vs 2.2s)
 *     so they don't lock into a static pattern — the misalignment makes
 *     the loader feel alive.
 *
 * Used for:
 *   - Route-level loading.tsx (Next.js streaming boundary)
 *   - Inline full-section loading states in client components
 *
 * `fullScreen=true` fills the viewport (minus the 48px topbar). Otherwise
 * fills its parent container with sensible min-height.
 *
 * `label` is opt-in — defaults to none. `aria-label` always carries
 * "Loading" for screen readers regardless.
 */

const OUTER_COUNT = 36;
const INNER_COUNT = 24;
const OUTER_CYCLE = 1.6; // seconds for one full lap of the lit head
const INNER_CYCLE = 2.2;

export function LogoSplash({
  label,
  fullScreen = false,
  size = 88,
}: {
  label?: string;
  fullScreen?: boolean;
  size?: number;
}) {
  // Radii are derived from `size` so callers can scale the whole splash by
  // tweaking one number. Container is sized to comfortably contain the
  // outer ring + bar height with a few px breathing room.
  const outerRadius = size * 0.92;
  const innerRadius = size * 0.7;
  const containerSize = Math.round(size * 2.3);

  return (
    <div
      role="status"
      aria-label={label ?? "Loading"}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        minHeight: fullScreen ? "calc(100vh - 48px)" : 360,
        padding: 32,
        position: "relative",
      }}
    >
      <style>{`
        @keyframes hype-splash-pulse {
          0%   { transform: scale(1);    opacity: 1; }
          50%  { transform: scale(1.05); opacity: 0.94; }
          100% { transform: scale(1);    opacity: 1; }
        }
        /* Bar glow cycle — 4% bright window means ~1.4 bars are at peak at
           any moment for OUTER_COUNT=36, giving a tight rotating "head"
           rather than a smeared comet tail. */
        @keyframes hype-splash-bar-glow {
          0%   {
            background: ${tokens.emerald}26;
            box-shadow: none;
            opacity: 0.55;
          }
          4%   {
            background: #d1fae5;
            box-shadow: 0 0 6px ${tokens.emerald},
                        0 0 14px ${tokens.emerald}90;
            opacity: 1;
          }
          18%  {
            background: ${tokens.emerald}26;
            box-shadow: none;
            opacity: 0.55;
          }
          100% {
            background: ${tokens.emerald}26;
            box-shadow: none;
            opacity: 0.55;
          }
        }
        @keyframes hype-splash-dots {
          0%, 20%   { color: rgba(229,229,229,0.4); }
          50%       { color: rgba(229,229,229,1);   }
          80%, 100% { color: rgba(229,229,229,0.4); }
        }
        .hype-splash-logo { animation: hype-splash-pulse 2.4s ease-in-out infinite; }
        .hype-splash-dot1 { animation: hype-splash-dots 1.4s ease-in-out infinite; animation-delay: 0s;   }
        .hype-splash-dot2 { animation: hype-splash-dots 1.4s ease-in-out infinite; animation-delay: 0.2s; }
        .hype-splash-dot3 { animation: hype-splash-dots 1.4s ease-in-out infinite; animation-delay: 0.4s; }
      `}</style>

      <div
        style={{
          position: "relative",
          width: containerSize,
          height: containerSize,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Outer ring of taller bars */}
        {Array.from({ length: OUTER_COUNT }).map((_, i) => {
          const angle = (i / OUTER_COUNT) * 360;
          // Negative delay puts each successive bar further along the
          // glow cycle, so the bright phase appears to travel CW.
          const delay = -(i / OUTER_COUNT) * OUTER_CYCLE;
          return (
            <span
              key={`o${i}`}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: 3,
                height: 12,
                marginLeft: -1.5,
                marginTop: -6,
                borderRadius: 1.5,
                background: `${tokens.emerald}26`,
                transform: `rotate(${angle}deg) translateY(-${outerRadius}px)`,
                animation: `hype-splash-bar-glow ${OUTER_CYCLE}s linear infinite`,
                animationDelay: `${delay}s`,
                pointerEvents: "none",
              }}
            />
          );
        })}

        {/* Inner ring of shorter dashes — slightly slower cycle so the
            two rings drift relative to each other. */}
        {Array.from({ length: INNER_COUNT }).map((_, i) => {
          const angle = (i / INNER_COUNT) * 360;
          const delay = -(i / INNER_COUNT) * INNER_CYCLE;
          return (
            <span
              key={`i${i}`}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: 2,
                height: 5,
                marginLeft: -1,
                marginTop: -2.5,
                borderRadius: 1,
                background: `${tokens.emerald}26`,
                transform: `rotate(${angle}deg) translateY(-${innerRadius}px)`,
                animation: `hype-splash-bar-glow ${INNER_CYCLE}s linear infinite`,
                animationDelay: `${delay}s`,
                pointerEvents: "none",
              }}
            />
          );
        })}

        <div
          className="hype-splash-logo"
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `radial-gradient(circle at center, ${tokens.bgElev} 0%, ${tokens.bg} 75%)`,
            border: `1px solid ${tokens.emerald}40`,
            boxShadow: `0 0 24px ${tokens.emerald}30, inset 0 0 12px ${tokens.emerald}15`,
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-hypenode.png"
            alt="HypeNode"
            width={Math.round(size * 0.7)}
            height={Math.round(size * 0.7)}
            style={{ display: "block", filter: "drop-shadow(0 0 8px rgba(16,185,129,0.4))" }}
          />
        </div>
      </div>

      {label && (
        <div
          className="font-mono"
          style={{
            fontSize: 12,
            color: tokens.textDim,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            display: "inline-flex",
            alignItems: "baseline",
            gap: 2,
            textAlign: "center",
          }}
        >
          <span>{label}</span>
          <span className="hype-splash-dot1" style={{ display: "inline-block", marginLeft: 1 }}>.</span>
          <span className="hype-splash-dot2" style={{ display: "inline-block" }}>.</span>
          <span className="hype-splash-dot3" style={{ display: "inline-block" }}>.</span>
        </div>
      )}
    </div>
  );
}
