import { cn } from "@/lib/cn";
import type { CSSProperties, ReactNode } from "react";

export function Label({
  children,
  className,
  style,
  size = 10,
  color,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  size?: number;
  color?: string;
}) {
  return (
    <div
      className={cn(
        "font-mono uppercase font-medium text-text-faint",
        className,
      )}
      style={{
        fontSize: size,
        letterSpacing: "0.12em",
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
