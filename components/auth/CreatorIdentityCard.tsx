"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";

type Me = { address: string | null; chainId: number | null };

type CreatorPrefs = {
  displayName: string;
  bioTag: string;
  autoPublish: boolean;
};

const PREFS_KEY = "hype.creator.prefs.v1";

const CHAIN_LABEL: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  42161: "Arbitrum",
  8453: "Base",
  137: "Polygon",
  56: "BNB Smart Chain",
  43114: "Avalanche",
  286623: "ValueChain",
  138565: "ValueChain Testnet",
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Pick a deterministic gradient from the address so each wallet gets a
// consistent identicon-style avatar without pulling an image library.
function avatarGradient(addr: string): string {
  const a = parseInt(addr.slice(2, 8), 16);
  const b = parseInt(addr.slice(8, 14), 16);
  const hue1 = a % 360;
  const hue2 = b % 360;
  return `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 65% 45%))`;
}

function loadPrefs(): CreatorPrefs {
  if (typeof window === "undefined") {
    return { displayName: "", bioTag: "", autoPublish: false };
  }
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CreatorPrefs>;
      return {
        displayName: parsed.displayName ?? "",
        bioTag: parsed.bioTag ?? "",
        autoPublish: !!parsed.autoPublish,
      };
    }
  } catch {
    /* noop */
  }
  return { displayName: "", bioTag: "", autoPublish: false };
}

export function CreatorIdentityCard() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<CreatorPrefs>(() => loadPrefs());
  const [editing, setEditing] = useState<"displayName" | "bioTag" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { address: null, chainId: null }))
      .then((data: Me) => {
        if (!cancelled) {
          setMe(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updatePref<K extends keyof CreatorPrefs>(key: K, value: CreatorPrefs[K]) {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }

  const connected = !!me?.address;
  const addr = me?.address ?? "";
  const chainName = me?.chainId ? CHAIN_LABEL[me.chainId] ?? `chain ${me.chainId}` : null;
  const initial = connected ? addr.slice(2, 3).toUpperCase() : "—";
  const handle = connected ? shortAddr(addr) : "Not connected";

  return (
    <Card pad={16}>
      <div className="flex items-center justify-between mb-2.5">
        <div style={{ fontSize: 13, fontWeight: 600 }}>Creator identity</div>
        {loading ? (
          <Mono size={9} color={tokens.textFaint}>
            checking session…
          </Mono>
        ) : connected ? (
          <Tag small color={tokens.emerald} dot>
            wallet linked
          </Tag>
        ) : (
          <Tag small color={tokens.amber} dot>
            sign in
          </Tag>
        )}
      </div>

      <div className="flex items-center gap-3 mb-2.5">
        <div
          className="flex items-center justify-center font-mono"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: connected ? avatarGradient(addr) : tokens.bgElev2,
            border: connected ? "none" : `1px solid ${tokens.border}`,
            fontSize: 16,
            fontWeight: 700,
            color: tokens.bg,
          }}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: connected ? tokens.text : tokens.textDim,
              fontFamily: connected ? "JetBrains Mono, monospace" : undefined,
            }}
          >
            {handle}
          </div>
          <Mono size={10}>
            {connected ? (
              <>publisher · {chainName ?? "unknown chain"}</>
            ) : (
              <>connect a wallet to publish</>
            )}
          </Mono>
        </div>
        {!connected && !loading && (
          <Link
            href="/"
            style={{
              fontSize: 11,
              color: tokens.emerald,
              border: `1px solid ${tokens.emerald}40`,
              padding: "4px 10px",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
          >
            Sign in →
          </Link>
        )}
      </div>

      {/* User prefs persisted to localStorage. These are editorial profile
          fields (no SoSoValue source) so they stay client-side state. */}
      <PrefRow
        label="Display name"
        value={prefs.displayName}
        placeholder="e.g. Kartika"
        editing={editing === "displayName"}
        onEdit={() => setEditing("displayName")}
        onCommit={(v) => {
          updatePref("displayName", v);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
      <PrefRow
        label="Bio tag"
        value={prefs.bioTag}
        placeholder="e.g. DePIN + RWA thesis"
        editing={editing === "bioTag"}
        onEdit={() => setEditing("bioTag")}
        onCommit={(v) => {
          updatePref("bioTag", v);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
      <div
        className="flex justify-between items-center"
        style={{ padding: "6px 0" }}
      >
        <Mono size={10}>Auto-publish</Mono>
        <button
          onClick={() => updatePref("autoPublish", !prefs.autoPublish)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <Mono size={11} color={prefs.autoPublish ? tokens.amber : tokens.text}>
            {prefs.autoPublish ? "On (no approval)" : "Off · approval required"}
          </Mono>
        </button>
      </div>
    </Card>
  );
}

function PrefRow({
  label,
  value,
  placeholder,
  editing,
  onEdit,
  onCommit,
  onCancel,
}: {
  label: string;
  value: string;
  placeholder: string;
  editing: boolean;
  onEdit: () => void;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);

  return (
    <div
      className="flex justify-between items-center"
      style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
    >
      <Mono size={10}>{label}</Mono>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommit(draft.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(draft.trim());
            else if (e.key === "Escape") onCancel();
          }}
          placeholder={placeholder}
          style={{
            background: tokens.bgElev2,
            border: `1px solid ${tokens.borderStrong}`,
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 11,
            color: tokens.text,
            fontFamily: "JetBrains Mono, monospace",
            width: 180,
            outline: "none",
          }}
        />
      ) : (
        <button
          onClick={onEdit}
          style={{
            background: "transparent",
            border: "none",
            cursor: "text",
            padding: 0,
          }}
        >
          <Mono
            size={11}
            color={value ? tokens.text : tokens.textFaint}
            style={{ fontStyle: value ? "normal" : "italic" }}
          >
            {value || placeholder}
          </Mono>
        </button>
      )}
    </div>
  );
}
