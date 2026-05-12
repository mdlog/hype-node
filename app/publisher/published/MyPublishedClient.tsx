"use client";

// "My published indices" — scoped to the signed-in creator. Combines
// /api/proposals?scope=mine&status=published,live with the latest earnings
// snapshot to show AUM + subscriber counts (when known).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Card, Label, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { PbProposalRow } from "@/lib/supabase/types";

type SummaryProposal = {
  proposal_id: string;
  title: string | null;
  ssi_ticker: string | null;
  total_usd: number;
  count: number;
  last_accrued_at: string | null;
  latest_aum_usd: number | null;
  latest_subscribers: number | null;
};

type Summary = { by_proposal: SummaryProposal[] };

function fmtUsd(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function MyPublishedClient() {
  const [proposals, setProposals] = useState<PbProposalRow[] | null>(null);
  const [summary, setSummary] = useState<Map<string, SummaryProposal>>(new Map());
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/proposals?scope=mine&status=published,live", { cache: "no-store" }),
        fetch("/api/publisher/earnings/summary", { cache: "no-store" }),
      ]);
      if (pRes.status === 401) {
        // Not signed in — keep the section out of the way; the SSI directory
        // below still renders for everyone.
        setHidden(true);
        return;
      }
      if (pRes.ok) {
        setProposals((await pRes.json()) as PbProposalRow[]);
      }
      if (sRes.ok) {
        const s = (await sRes.json()) as Summary;
        const m = new Map<string, SummaryProposal>();
        for (const r of s.by_proposal ?? []) m.set(r.proposal_id, r);
        setSummary(m);
      }
    } catch {
      // Silent — published page still has the SSI directory below.
      setHidden(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden) return null;
  if (proposals !== null && proposals.length === 0) {
    return (
      <Card pad={14}>
        <Label>MY PUBLISHED INDICES</Label>
        <Mono size={11} color={tokens.textDim} className="mt-1 block">
          You haven't published any indices yet.{" "}
          <Link href="/publisher/proposals" style={{ color: tokens.cyan }}>
            Open proposals
          </Link>{" "}
          to draft and publish.
        </Mono>
      </Card>
    );
  }

  return (
    <Card pad={0}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${tokens.border}`,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        My published indices ({proposals?.length ?? 0})
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr",
          padding: "8px 16px",
          gap: 10,
          borderBottom: `1px solid ${tokens.borderFaint}`,
        }}
      >
        {["TITLE", "TICKER", "STATUS", "AUM", "SUBS", "EARNED"].map((k) => (
          <Label key={k}>{k}</Label>
        ))}
      </div>
      {(proposals ?? []).map((p) => {
        const s = summary.get(p.id);
        return (
          <Link
            key={p.id}
            href={`/publisher/proposals/${p.id}`}
            className="contents"
          >
            <div
              className="grid items-center"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr",
                padding: "10px 16px",
                gap: 10,
                borderBottom: `1px solid ${tokens.borderFaint}`,
                cursor: "pointer",
              }}
            >
              <Mono size={12} color={tokens.text}>
                {p.title ?? p.id.slice(0, 8)}
              </Mono>
              <Mono size={11} color={tokens.amber}>
                {p.ssi_ticker}
              </Mono>
              <Tag
                small
                color={p.status === "live" ? tokens.emerald : tokens.cyan}
                dot
              >
                {p.status}
              </Tag>
              <Mono size={11} color={tokens.text}>
                {fmtUsd(s?.latest_aum_usd ?? null)}
              </Mono>
              <Mono size={11} color={tokens.textDim}>
                {s?.latest_subscribers ?? "—"}
              </Mono>
              <Mono size={11} color={tokens.emerald}>
                {fmtUsd(s?.total_usd ?? 0, 2)}
              </Mono>
            </div>
          </Link>
        );
      })}
    </Card>
  );
}
