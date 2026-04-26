import { cn } from "@/lib/cn";
import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  className,
  pad = 16,
  style,
}: {
  children: ReactNode;
  className?: string;
  pad?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[10px] bg-bg-elev border border-border transition-colors",
        className,
      )}
      style={{ padding: pad, ...style }}
    >
      {children}
    </div>
  );
}
