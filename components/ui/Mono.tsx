import { cn } from "@/lib/cn";
import type { CSSProperties, ReactNode } from "react";

export function Mono({
  children,
  size = 11,
  color,
  className,
  style,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn("font-mono tabular text-text-dim", className)}
      style={{
        fontSize: size,
        letterSpacing: "-0.01em",
        color,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
