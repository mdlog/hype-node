"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { tokens } from "@/lib/tokens";
import { Mono } from "@/components/ui/Mono";
import { WalletBadge } from "@/components/auth/WalletBadge";
import { RoleSwitcher } from "@/components/nav/RoleSwitcher";

type NavLeaf = { k: string; l: string };
type NavGroup = { l: string; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

const isGroup = (i: NavItem): i is NavGroup => "children" in i;

const items: NavItem[] = [
  { k: "dashboard", l: "Dashboard" },
  {
    l: "Markets",
    children: [
      { k: "tokens", l: "Tokens" },
      { k: "stocks", l: "Stocks" },
      { k: "fundraising", l: "Funding" },
    ],
  },
  {
    l: "Research",
    children: [
      { k: "research", l: "Research" },
      { k: "analyses", l: "Analysis" },
    ],
  },
  {
    l: "Strategy",
    children: [
      { k: "builder", l: "Builder" },
      { k: "agent", l: "Agent" },
      { k: "backtest", l: "Backtest" },
    ],
  },
  {
    l: "Portfolio",
    children: [
      { k: "portfolio", l: "Portfolio" },
      { k: "risk", l: "Risk" },
      { k: "history", l: "History" },
    ],
  },
  { k: "chat", l: "Chat" },
  { k: "settings", l: "Settings" },
];

export function IndexerTopBar() {
  const pathname = usePathname();
  const active = pathname?.split("/")[1] ?? "dashboard";
  return (
    <div
      className="sticky top-0 z-10"
      style={{
        height: 48,
        borderBottom: `1px solid ${tokens.border}`,
        background: tokens.bg,
      }}
    >
      <div
        className="mx-auto flex items-center h-full"
        style={{
          maxWidth: 1440,
          padding: "0 16px",
          gap: 16,
        }}
      >
      <div className="flex-1 flex items-center min-w-0">
        <Link href="/dashboard" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-hypenode.png"
            alt="HypeNode"
            width={36}
            height={36}
            style={{ display: "block" }}
          />
          <span
            className="font-sans"
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: tokens.text,
            }}
          >
            HypeNode
          </span>
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 10,
              color: tokens.textFaint,
              letterSpacing: "0.12em",
            }}
          >
            / indexer
          </span>
        </Link>
      </div>
      <div className="flex gap-0.5 justify-center">
        {items.map((i) =>
          isGroup(i) ? (
            <NavDropdown key={i.l} group={i} active={active} />
          ) : (
            <NavLink key={i.k} item={i} active={active} />
          ),
        )}
      </div>
      <div className="flex-1 flex items-center justify-end gap-2.5">
        <div
          className="flex items-center"
          style={{
            gap: 6,
            padding: "4px 10px",
            border: `1px solid ${tokens.border}`,
            borderRadius: 5,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: tokens.emerald,
              boxShadow: `0 0 8px ${tokens.emerald}`,
            }}
          />
          <Mono size={10} color={tokens.textDim}>
            AGENT · LIVE
          </Mono>
        </div>
        <Mono size={10}>⌘K</Mono>
        <WalletBadge />
        <RoleSwitcher current="indexer" />
      </div>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavLeaf; active: string }) {
  const on = active === item.k;
  return (
    <Link
      href={`/${item.k}`}
      style={{
        padding: "6px 10px",
        borderRadius: 5,
        background: on ? tokens.bgElev : "transparent",
        color: on ? tokens.text : tokens.textDim,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "-0.01em",
      }}
    >
      {item.l}
    </Link>
  );
}

function NavDropdown({ group, active }: { group: NavGroup; active: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const containsActive = group.children.some((c) => c.k === active);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 10px",
          borderRadius: 5,
          background: containsActive || open ? tokens.bgElev : "transparent",
          color: containsActive ? tokens.text : tokens.textDim,
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {group.l}
        <span
          style={{
            fontSize: 9,
            color: tokens.textFaint,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms ease",
            display: "inline-block",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 160,
            background: tokens.bg,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            zIndex: 20,
          }}
        >
          {group.children.map((c) => {
            const on = active === c.k;
            return (
              <Link
                key={c.k}
                href={`/${c.k}`}
                onClick={() => setOpen(false)}
                role="menuitem"
                style={{
                  padding: "7px 10px",
                  borderRadius: 4,
                  background: on ? tokens.bgElev : "transparent",
                  color: on ? tokens.text : tokens.textDim,
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {c.l}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
