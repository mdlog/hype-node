import { cn } from "@/lib/cn";
import type { CSSProperties, ReactNode } from "react";

export function Metric({
  v,
  size = 26,
  color,
  className,
  style,
}: {
  v: ReactNode;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("tabular leading-tight font-medium text-text", className)}
      style={{
        fontSize: size,
        letterSpacing: "-0.02em",
        color,
        ...style,
      }}
    >
      {v}
    </div>
  );
}
