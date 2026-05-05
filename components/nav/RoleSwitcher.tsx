"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { tokens } from "@/lib/tokens";

type Role = "indexer" | "publisher";

type Props = {
  // The surface this switcher is rendered on. Determines which role is
  // offered as the "switch to" option.
  current: Role;
};

const TARGETS: Record<Role, { role: Role; label: string; href: string; color: string }> = {
  indexer: {
    role: "publisher",
    label: "→ Publisher",
    href: "/publisher/radar",
    color: tokens.cyan,
  },
  publisher: {
    role: "indexer",
    label: "→ Indexer",
    href: "/dashboard",
    color: tokens.emerald,
  },
};

export function RoleSwitcher({ current }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const target = TARGETS[current];

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      // Persist the new preference so the next post-SIWE redirect lands
      // here. Failure is non-fatal — we still navigate; the next visit
      // just won't remember.
      await fetch("/api/auth/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: target.role }),
      }).catch(() => {});
      router.push(target.href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        fontSize: 11,
        color: target.color,
        border: `1px solid ${target.color}40`,
        padding: "3px 8px",
        borderRadius: 4,
        background: "transparent",
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.6 : 1,
        fontFamily: "inherit",
      }}
    >
      {target.label}
    </button>
  );
}
