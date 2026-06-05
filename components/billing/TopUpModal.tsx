"use client";

import { useEffect, useState } from "react";

import { tokens } from "@/lib/tokens";

const PAL = {
  bg: "#07090C",
  bg2: "#0B0F14",
  bg3: "#11161E",
  line: "#1A2029",
  line2: "#242C38",
  text: tokens.text,
  dim: "#9AA4B2",
  faint: "#5E6877",
  emerald: tokens.emerald,
};

const PRESETS = [1, 5, 20, 50] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  /**
   * Fired after a successful top-up. The caller is expected to refresh its
   * own billing snapshot from /api/billing/usage — the modal does not pass
   * the new state back, since the parent normally already has its own
   * fetcher and we want a single source of truth.
   */
  onSuccess: () => void;
};

export function TopUpModal({ open, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state when the modal opens — otherwise a previous
  // error message would persist into the next session.
  useEffect(() => {
    if (open) {
      setAmount(5);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  // Close on Escape so keyboard users aren't trapped.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_usd: amount }),
      });
      const json = (await res.json()) as
        | { ok: true }
        | { error: string };
      if (!res.ok || !("ok" in json)) {
        throw new Error("error" in json ? json.error : "top-up failed");
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="topup-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: PAL.bg2,
          border: `1px solid ${PAL.line2}`,
          borderRadius: 14,
          padding: 24,
          color: PAL.text,
        }}
      >
        <div className="flex items-center" style={{ gap: 10, marginBottom: 6 }}>
          <h2
            id="topup-title"
            style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}
          >
            Top up your balance
          </h2>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: PAL.bg,
              background: "#f59e0b",
              padding: "2px 7px",
              borderRadius: 4,
              fontFamily: '"JetBrains Mono", monospace',
              flexShrink: 0,
            }}
          >
            DEMO MODE
          </span>
        </div>
        <p style={{ fontSize: 13, color: PAL.dim, lineHeight: 1.5, marginBottom: 16 }}>
          Add credit to keep using the agent after your free daily quota is
          exhausted. Balance is persistent — anything left over rolls into the
          next day.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
          {PRESETS.map((p) => {
            const on = amount === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                disabled={busy}
                style={{
                  padding: "10px 0",
                  borderRadius: 8,
                  border: `1px solid ${on ? PAL.emerald : PAL.line2}`,
                  background: on ? "rgba(16,185,129,0.10)" : PAL.bg3,
                  color: on ? PAL.emerald : PAL.text,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  transition: "all .15s",
                }}
              >
                ${p}
              </button>
            );
          })}
        </div>

        <label style={{ display: "block", marginBottom: 16 }}>
          <span
            style={{
              fontSize: 11,
              color: PAL.faint,
              fontFamily: '"JetBrains Mono", monospace',
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 6,
            }}
          >
            Custom amount (USD)
          </span>
          <input
            type="number"
            min={0.01}
            max={1000}
            step={0.5}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
            disabled={busy}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: PAL.bg3,
              border: `1px solid ${PAL.line2}`,
              borderRadius: 8,
              color: PAL.text,
              fontFamily: "inherit",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "rgba(239,68,68,0.10)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 6,
              fontSize: 12,
              color: tokens.red,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            padding: 10,
            background: PAL.bg3,
            border: `1px solid ${PAL.line}`,
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
            color: PAL.faint,
            lineHeight: 1.55,
          }}
        >
          Demo deployment · payment is mocked. Production would gate this
          endpoint on a verified USDC transfer to the treasury wallet on
          ValueChain L1 before crediting.
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: `1px solid ${PAL.line2}`,
              background: "transparent",
              color: PAL.dim,
              fontSize: 13,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || amount <= 0}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${PAL.emerald}`,
              background: PAL.emerald,
              color: PAL.bg,
              fontSize: 13,
              fontWeight: 600,
              cursor: busy || amount <= 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: busy || amount <= 0 ? 0.6 : 1,
            }}
          >
            {busy ? "Simulating…" : `Simulate top-up ($${amount.toFixed(2)})`}
          </button>
        </div>
      </div>
    </div>
  );
}
