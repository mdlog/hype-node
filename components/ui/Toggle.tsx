"use client";

import { tokens } from "@/lib/tokens";

export function Toggle({
  on = false,
  onChange,
}: {
  on?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange?.(!on)}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange?.(!on);
        }
      }}
      style={{
        width: 30,
        height: 17,
        borderRadius: 9,
        background: on ? tokens.emerald : tokens.bgElev2,
        border: `1px solid ${on ? tokens.emerald : tokens.border}`,
        position: "relative",
        cursor: "pointer",
        transition: "all .2s",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 1,
          left: on ? 14 : 1,
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: on ? tokens.bg : tokens.text,
          transition: "all .2s",
        }}
      />
    </div>
  );
}
