import type { ReactNode } from "react";

import { tokens } from "@/lib/tokens";

// Mono uppercase label + horizontal divider + optional meta on the right.
// Used as a structural separator between dashboard sections per the
// 2026-05 redesign — replaces the per-card sub-headers.
export function SectionLabel({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: tokens.textFaint,
        marginBottom: 10,
      }}
    >
      <span>{children}</span>
      <span style={{ flex: 1, height: 1, background: tokens.border }} />
      {meta ? <span style={{ color: tokens.textDim }}>{meta}</span> : null}
    </div>
  );
}
