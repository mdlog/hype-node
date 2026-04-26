import { cn } from "@/lib/cn";
import { tokens } from "@/lib/tokens";
import type { CSSProperties, ReactNode } from "react";

export function Tag({
  children,
  color = tokens.textDim,
  filled = false,
  small = false,
  dot = false,
  className,
  style,
}: {
  children: ReactNode;
  color?: string;
  filled?: boolean;
  small?: boolean;
  dot?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "font-mono uppercase inline-flex items-center font-medium leading-none",
        small ? "text-[9.5px]" : "text-[10.5px]",
        className,
      )}
      style={{
        padding: small ? "2px 7px" : "3px 9px",
        color: filled ? tokens.bg : color,
        background: filled ? color : `${color}14`,
        border: filled ? "none" : `1px solid ${color}30`,
        borderRadius: 4,
        letterSpacing: "0.08em",
        gap: 5,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      )}
      {children}
    </span>
  );
}
