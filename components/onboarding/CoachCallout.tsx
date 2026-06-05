"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { accentHex, type AccentColor, tokens } from "@/lib/tokens";

export function CoachCallout({
  icon,
  title,
  body,
  cta,
  accent = "emerald",
}: {
  icon?: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
  accent?: AccentColor;
}) {
  const color = accentHex[accent];
  return (
    <Card
      pad={14}
      style={{
        marginBottom: 16,
        borderColor: `${color}55`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {icon && <span style={{ fontSize: 18 }} aria-hidden>{icon}</span>}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{title}</div>
        <div style={{ fontSize: 12, color: tokens.textDim, lineHeight: 1.5, marginTop: 2 }}>{body}</div>
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="hype-btn primary"
          style={{ fontSize: 12, padding: "5px 11px", whiteSpace: "nowrap" }}
        >
          {cta.label}
        </Link>
      )}
    </Card>
  );
}
