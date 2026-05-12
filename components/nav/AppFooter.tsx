// Single-line slim footer rendered at the bottom of every page via the
// root layout. Brand + copyright on the left, secondary links on the
// right. Stays under the page content (not sticky) so it never overlaps
// the existing sticky top bars.

import Link from "next/link";
import { tokens } from "@/lib/tokens";

const YEAR = new Date().getFullYear();

const LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  { label: "Docs", href: "/docs" },
  { label: "Status", href: "/status" },
  { label: "Privacy", href: "/privacy" },
];

export function AppFooter() {
  return (
    <footer
      className="relative z-10"
      style={{
        borderTop: `1px solid ${tokens.border}`,
        background: tokens.bg,
        padding: "10px 20px",
      }}
    >
      <div
        className="mx-auto flex items-center justify-between"
        style={{
          maxWidth: 1440,
          gap: 12,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10.5,
          color: tokens.textFaint,
          letterSpacing: "0.02em",
        }}
      >
        <span>
          <span style={{ color: tokens.textDim, fontWeight: 600 }}>HypeNode</span>
          {" · "}© {YEAR}
        </span>
        <nav className="flex items-center" style={{ gap: 14 }}>
          {LINKS.map((l, i) => (
            <span key={l.label} className="flex items-center" style={{ gap: 14 }}>
              {l.external ? (
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: tokens.textFaint, textDecoration: "none" }}
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  href={l.href}
                  style={{ color: tokens.textFaint, textDecoration: "none" }}
                >
                  {l.label}
                </Link>
              )}
              {i < LINKS.length - 1 ? (
                <span style={{ color: tokens.textGhost }}>·</span>
              ) : null}
            </span>
          ))}
        </nav>
      </div>
    </footer>
  );
}
