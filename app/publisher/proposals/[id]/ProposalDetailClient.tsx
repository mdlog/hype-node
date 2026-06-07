"use client";

// Detail view + lifecycle controls for a single proposal. Action buttons are
// driven by the current `status` — only legal next-states show up.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Btn, Card, Label, Metric, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { PbProposalRow } from "@/lib/supabase/types";
import type { IndexSpec } from "@/lib/api/ssi";
import { PublishActions } from "./PublishActions";

// Standard creator fee structure baked into the on-chain registration when a
// proposal is published. Matches the vault constants (1%/yr mgmt, 10% perf).
const DEFAULT_MGMT_FEE_BPS = 100;
const DEFAULT_PERF_FEE_BPS = 1000;

// Build the registerIndex spec from a proposal, or explain why it can't publish.
function buildSpec(proposal: PbProposalRow): IndexSpec | { error: string } {
  const rows = parseConstituents(proposal.constituents).filter(
    (r) => r.weight !== null && r.weight > 0,
  );
  if (rows.length === 0) {
    return { error: "Add weighted constituents before publishing on-chain." };
  }
  if (!proposal.ssi_ticker.trim()) {
    return { error: "A ticker/symbol is required to publish on-chain." };
  }
  const weights: Record<string, number> = {};
  for (const r of rows) weights[r.symbol] = r.weight as number;
  return {
    symbol: proposal.ssi_ticker.trim(),
    name: proposal.title?.trim() || proposal.ssi_ticker.trim(),
    base: "USDC",
    weights,
    managementFeeBps: DEFAULT_MGMT_FEE_BPS,
    performanceFeeBps: DEFAULT_PERF_FEE_BPS,
    rebalanceCron: "",
  };
}

const STATUS_COLOR: Record<PbProposalRow["status"], string> = {
  draft: tokens.textDim,
  review: tokens.cyan,
  signed: tokens.amber,
  published: tokens.emerald,
  live: tokens.emerald,
  paused: tokens.amber,
  rejected: tokens.red,
};

// Mirrors STATUS_GRAPH on the server. UI side keeps it inline so we can
// render only legal action buttons without an extra round-trip.
const NEXT_STATES: Record<PbProposalRow["status"], { label: string; to: PbProposalRow["status"] }[]> =
  {
    draft: [
      { label: "Submit for review", to: "review" },
      { label: "Reject", to: "rejected" },
    ],
    review: [
      { label: "Sign (off-chain)", to: "signed" },
      { label: "Back to draft", to: "draft" },
      { label: "Reject", to: "rejected" },
    ],
    signed: [
      { label: "Mark published", to: "published" },
      { label: "Reject", to: "rejected" },
    ],
    published: [
      { label: "Mark live", to: "live" },
      { label: "Pause", to: "paused" },
    ],
    live: [{ label: "Pause", to: "paused" }],
    paused: [{ label: "Resume (live)", to: "live" }],
    rejected: [{ label: "Restore as draft", to: "draft" }],
  };

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

function explorerUrl(tx: string): string {
  return `https://sepolia.etherscan.io/tx/${tx}`;
}

type ConstituentRow = { symbol: string; weight: number | null; raw: unknown };

function parseConstituents(c: unknown): ConstituentRow[] {
  if (Array.isArray(c)) {
    return c.map((x) => {
      if (typeof x === "object" && x !== null) {
        const r = x as Record<string, unknown>;
        const symbol =
          typeof r.symbol === "string"
            ? r.symbol
            : typeof r.ticker === "string"
              ? r.ticker
              : "—";
        const weight =
          typeof r.weight === "number"
            ? r.weight
            : typeof r.weight_pct === "number"
              ? r.weight_pct / 100
              : null;
        return { symbol, weight, raw: x };
      }
      return { symbol: String(x), weight: null, raw: x };
    });
  }
  if (typeof c === "object" && c !== null) {
    return Object.entries(c as Record<string, unknown>).map(([symbol, v]) => ({
      symbol,
      weight: typeof v === "number" ? v : null,
      raw: v,
    }));
  }
  return [];
}

export function ProposalDetailClient({ id }: { id: string }) {
  const [proposal, setProposal] = useState<PbProposalRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/proposals/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        setLoadError("Proposal not found, or you don't have access.");
        setProposal(null);
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `request failed (${res.status})`);
      }
      setProposal((await res.json()) as PbProposalRow);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(to: PbProposalRow["status"]) {
    setWorking(to);
    setActionError(null);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `transition failed (${res.status})`);
      }
      const updated = (await res.json()) as PbProposalRow;
      setProposal(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  // On-chain publish: persist the tx + deterministic index id and flip the
  // status to published in one PATCH. Called by PublishActions after the
  // registerIndex tx confirms — this replaces the old status-only flip so a
  // "published" proposal is always actually on-chain.
  async function persistOnChainPublish(
    txHash: `0x${string}`,
    indexId: `0x${string}`,
  ) {
    setActionError(null);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "published",
          on_chain_tx: txHash,
          on_chain_index_id: indexId,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `publish persist failed (${res.status})`);
      }
      setProposal((await res.json()) as PbProposalRow);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteProposal() {
    if (!confirm("Delete this proposal? Earnings ledger rows will cascade-delete.")) {
      return;
    }
    setWorking("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/proposals/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `delete failed (${res.status})`);
      }
      window.location.href = "/publisher/proposals";
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setWorking(null);
    }
  }

  if (loadError) {
    return (
      <>
        <Crumbs id={id} />
        <Card pad={20}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {loadError}
          </div>
          <Mono size={11} color={tokens.textDim}>
            If you're the creator, sign in with the matching wallet.
          </Mono>
        </Card>
      </>
    );
  }

  if (!proposal) {
    return (
      <>
        <Crumbs id={id} />
        <Card pad={20}>
          <Mono size={11} color={tokens.textDim}>
            loading…
          </Mono>
        </Card>
      </>
    );
  }

  const rows = parseConstituents(proposal.constituents);
  const totalWeight = rows.reduce((s, r) => s + (r.weight ?? 0), 0);
  const transitions = NEXT_STATES[proposal.status] ?? [];

  return (
    <>
      <Crumbs id={id} title={proposal.title} />

      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1fr 360px" }}>
        <div className="flex flex-col gap-3 overflow-y-auto">
          <Card pad={18}>
            <div className="flex items-center gap-3 flex-wrap">
              <Tag small color={STATUS_COLOR[proposal.status]} dot>
                {proposal.status}
              </Tag>
              <Tag small color={tokens.amber} filled>
                {proposal.ssi_ticker}
              </Tag>
              <Tag small color={tokens.textFaint}>
                source: {proposal.source}
              </Tag>
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                marginTop: 8,
              }}
            >
              {proposal.title ?? `Untitled · ${proposal.id.slice(0, 8)}`}
            </div>
            <Mono size={11} color={tokens.textFaint} className="mt-1 block">
              created {fmt(proposal.created_at)} · updated {fmt(proposal.updated_at)}
            </Mono>
          </Card>

          {proposal.thesis && (
            <Card pad={16}>
              <Label>THESIS</Label>
              <div
                style={{
                  fontSize: 13,
                  color: tokens.text,
                  lineHeight: 1.55,
                  marginTop: 6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {proposal.thesis}
              </div>
            </Card>
          )}

          <Card pad={0}>
            <div
              className="flex justify-between items-center"
              style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${tokens.border}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>Constituents</div>
              <Mono size={10} color={tokens.textFaint}>
                {rows.length} rows · sum {(totalWeight * 100).toFixed(2)}%
              </Mono>
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: "1fr 1fr",
                padding: "8px 16px",
                gap: 10,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <Label>SYMBOL</Label>
              <Label>WEIGHT</Label>
            </div>
            {rows.length === 0 && (
              <div style={{ padding: 16 }}>
                <Mono size={11} color={tokens.textDim}>
                  No constituents recorded.
                </Mono>
              </div>
            )}
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "1fr 1fr",
                  padding: "8px 16px",
                  gap: 10,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <Mono size={12} color={tokens.text}>
                  {r.symbol}
                </Mono>
                <Mono size={11} color={tokens.textDim}>
                  {r.weight !== null ? `${(r.weight * 100).toFixed(2)}%` : "—"}
                </Mono>
              </div>
            ))}
          </Card>

          {(proposal.backtest_return !== null ||
            proposal.backtest_sharpe !== null ||
            proposal.backtest_max_dd !== null) && (
            <Card pad={16}>
              <Label>BACKTEST SNAPSHOT</Label>
              <div className="grid grid-cols-3 gap-2.5 mt-2">
                <KpiCard
                  k="RETURN"
                  v={
                    proposal.backtest_return !== null
                      ? `${(proposal.backtest_return * 100).toFixed(2)}%`
                      : "—"
                  }
                  c={
                    (proposal.backtest_return ?? 0) >= 0
                      ? tokens.emerald
                      : tokens.red
                  }
                />
                <KpiCard
                  k="SHARPE"
                  v={
                    proposal.backtest_sharpe !== null
                      ? proposal.backtest_sharpe.toFixed(2)
                      : "—"
                  }
                  c={tokens.cyan}
                />
                <KpiCard
                  k="MAX DD"
                  v={
                    proposal.backtest_max_dd !== null
                      ? `${(proposal.backtest_max_dd * 100).toFixed(2)}%`
                      : "—"
                  }
                  c={tokens.amber}
                />
              </div>
            </Card>
          )}

          {proposal.meta && (
            <Card pad={16}>
              <Label>META</Label>
              <pre
                style={{
                  fontSize: 11,
                  color: tokens.textDim,
                  background: tokens.bgElev2,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: 5,
                  padding: 10,
                  marginTop: 6,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(proposal.meta, null, 2)}
              </pre>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-2.5 overflow-y-auto">
          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Status timeline
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(
                ["draft", "review", "signed", "published", "live"] as PbProposalRow["status"][]
              ).map((s, idx, arr) => {
                const reached =
                  arr.indexOf(proposal.status) >= idx ||
                  (proposal.status === "paused" && idx <= arr.indexOf("live")) ||
                  (proposal.status === "rejected" && idx === 0);
                return (
                  <div key={s} className="flex items-center gap-2">
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: reached ? STATUS_COLOR[s] : tokens.border,
                      }}
                    />
                    <Mono size={10} color={reached ? tokens.text : tokens.textFaint}>
                      {s}
                    </Mono>
                    {idx < arr.length - 1 && (
                      <div
                        style={{
                          width: 14,
                          height: 1,
                          background: reached ? tokens.borderStrong : tokens.borderFaint,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Actions
            </div>
            {transitions.length === 0 && (
              <Mono size={11} color={tokens.textDim}>
                No further status transitions available.
              </Mono>
            )}
            <div className="flex flex-col gap-1.5">
              {/* signed → published goes ON-CHAIN (registerIndex) here, not a
                  status-only flip. The other transitions stay plain PATCHes. */}
              {proposal.status === "signed" && (
                (() => {
                  const spec = buildSpec(proposal);
                  return "error" in spec ? (
                    <Mono size={10} color={tokens.amber} className="block">
                      {spec.error}
                    </Mono>
                  ) : (
                    <PublishActions spec={spec} onPublished={persistOnChainPublish} />
                  );
                })()
              )}
              {transitions
                .filter((t) => !(proposal.status === "signed" && t.to === "published"))
                .map((t) => (
                  <Btn
                    key={t.to}
                    primary={t.to !== "rejected"}
                    small
                    disabled={working !== null}
                    onClick={() => transition(t.to)}
                    style={{ justifyContent: "center" }}
                  >
                    {working === t.to ? "…" : t.label}
                  </Btn>
                ))}
              <Btn
                small
                disabled={working !== null}
                onClick={deleteProposal}
                style={{ justifyContent: "center", color: tokens.textDim }}
              >
                {working === "delete" ? "…" : "Delete proposal"}
              </Btn>
            </div>
            {actionError && (
              <Mono size={10} color={tokens.red} className="block mt-2">
                {actionError}
              </Mono>
            )}
          </Card>

          {(proposal.on_chain_tx || proposal.on_chain_index_id) && (
            <Card pad={14}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                On-chain
              </div>
              {proposal.on_chain_index_id && (
                <Mono size={10} color={tokens.textDim} className="block mb-1">
                  index id {proposal.on_chain_index_id.slice(0, 14)}…
                </Mono>
              )}
              {proposal.on_chain_tx && (
                <a
                  href={explorerUrl(proposal.on_chain_tx)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: tokens.cyan, fontSize: 11, wordBreak: "break-all" }}
                >
                  view tx ↗ {proposal.on_chain_tx.slice(0, 18)}…
                </a>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function KpiCard({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
      }}
    >
      <Label>{k}</Label>
      <Metric v={v} color={c} size={19} style={{ marginTop: 4 }} />
    </div>
  );
}

function Crumbs({ id, title }: { id: string; title?: string | null }) {
  return (
    <div
      className="flex items-center gap-2 font-mono"
      style={{ fontSize: 11, color: tokens.textDim }}
    >
      <Link href="/publisher/proposals" style={{ cursor: "pointer" }}>
        Proposals
      </Link>
      <span>/</span>
      <span style={{ color: tokens.text }}>{title ?? id.slice(0, 8)}</span>
    </div>
  );
}
