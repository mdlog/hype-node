"use client";

import { cn } from "@/lib/cn";
import { tokens } from "@/lib/tokens";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  small?: boolean;
  icon?: ReactNode;
};

export function Btn({
  children,
  primary = false,
  small = false,
  icon,
  className,
  style,
  ...rest
}: Props) {
  const merged: CSSProperties = {
    fontSize: small ? 11.5 : 13,
    padding: small ? "5px 10px" : "7px 14px",
    background: primary ? tokens.emerald : tokens.bgElev2,
    color: primary ? tokens.bg : tokens.text,
    border: `1px solid ${primary ? tokens.emerald : tokens.border}`,
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: primary ? 600 : 500,
    letterSpacing: "-0.01em",
    lineHeight: 1.2,
    transition: "all .15s",
    ...style,
  };
  return (
    <button
      {...rest}
      className={cn("font-sans inline-flex items-center gap-1.5", className)}
      style={merged}
    >
      {icon}
      {children}
    </button>
  );
}
