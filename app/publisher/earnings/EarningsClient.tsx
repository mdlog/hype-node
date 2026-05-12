"use client";

// Earnings dashboard. Pulls /api/publisher/earnings/summary for KPIs and
// breakdowns, /api/publisher/earnings for the recent payout list. Cumulative
// earnings line chart is computed client-side from the per-month aggregate.

import { useCallback, useEffect, useMemo, useState } from "react";

import { Btn, Card, Label, LineChart, Metric, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { PbEarningRow } from "@/lib/supabase/types";

type SummaryByProposal = {
  proposal_id: string;
  title: string | null;
  ssi_ticker: string | null;
  total_usd: number;
  count: number;
  last_accrued_at: string | null;
  latest_aum_usd: number | null;
  latest_subscribers: number | null;
};

type SummaryByMonth = { month: string; total_usd: number; count: number };

type SummaryByEvent = {
  event_type: PbEarningRow["event_type"];
  total_usd: number;
  count: number;
};

type Summary = {
  total_usd: number;
  last_30d_usd: number;
  accrual_count: number;
  proposal_count: number;
  by_proposal: SummaryByProposal[];
  by_month: SummaryByMonth[];
  by_event_type: SummaryByEvent[];
};

const EVENT_LABEL: Record<PbEarningRow["event_type"], string> = {
  mgmt_fee: "Management",
  perf_fee: "Performance",
  subscription_fee: "Subscription",
  manual: "Manual",
};

const EVENT_COLOR: Record<PbEarningRow["event_type"], string> = {
  mgmt_fee: tokens.emerald,
  perf_fee: tokens.amber,
  subscription_fee: tokens.cyan,
  manual: tokens.textDim,
};

function fmtUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function EarningsClient({ walletCard }: { walletCard: React.ReactNode }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<PbEarningRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sRes, rRes] = await Promise.all([
        fetch("/api/publisher/earnings/summary", { cache: "no-store" }),
        fetch("/api/publisher/earnings?limit=20", { cache: "no-store" }),
      ]);
      if (sRes.status === 401 || rRes.status === 401) {
        setSignedOut(true);
        setSummary({
          total_usd: 0,
          last_30d_usd: 0,
          accrual_count: 0,
          proposal_count: 0,
          by_proposal: [],
          by_month: [],
          by_event_type: [],
        });
        setRecent([]);
        return;
      }
      if (!sRes.ok) {
        const j = (await sRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `summary failed (${sRes.status})`);
      }
      if (!rRes.ok) {
        const j = (await rRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `recent failed (${rRes.status})`);
      }
      setSummary((await sRes.json()) as Summary);
      setRecent((await rRes.json()) as PbEarningRow[]);
      setSignedOut(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cumulativeSeries = useMemo(() => {
    if (!summary) return [] as number[];
    let acc = 0;
    return summary.by_month.map((m) => {
      acc += m.total_usd;
      return acc;
    });
  }, [summary]);

  return (
    <>
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Creator Earnings
          </div>
          <Mono size={11}>
            management + performance + subscription fees · ledger from Supabase
            pb_earnings · on-chain indexer fills automatically once SSI fee
            stream is wired (Wave 2)
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small onClick={() => void load()}>
            Refresh
          </Btn>
          <Btn small primary disabled>
            Withdraw
          </Btn>
        </div>
      </div>

      {error && (
        <Card pad={12}>
          <Tag small color={tokens.red} dot>
            error
          </Tag>
          <Mono size={11} color={tokens.textDim} className="mt-2 block">
            {error}
          </Mono>
        </Card>
      )}

      {signedOut && (
        <Card pad={12}>
          <Mono size={11} color={tokens.textDim}>
            Sign in with your wallet to view earnings.
          </Mono>
        </Card>
      )}

      <div className="grid grid-cols-4 gap-3">
        {walletCard}
        <KpiCard
          k="EARNINGS BALANCE"
          v={summary ? fmtUsd(summary.total_usd) : "—"}
          d={
            summary && summary.total_usd > 0
              ? `${summary.accrual_count} accruals · ${summary.proposal_count} proposals`
              : "no fee events recorded yet"
          }
          color={summary && summary.total_usd > 0 ? tokens.emerald : tokens.textFaint}
        />
        <KpiCard
          k="30D EARNINGS"
          v={summary ? fmtUsd(summary.last_30d_usd) : "—"}
          d="rolling 30-day window"
          color={summary && summary.last_30d_usd > 0 ? tokens.cyan : tokens.textFaint}
        />
        <KpiCard
          k="ALL-TIME ACCRUALS"
          v={summary ? String(summary.accrual_count) : "—"}
          d={`across ${summary?.proposal_count ?? 0} proposals`}
          color={tokens.amber}
        />
      </div>

      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Card pad={16}>
          <div className="flex justify-between mb-3">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Cumulative earnings</div>
              <Mono size={10}>
                summed monthly · USD · derived from pb_earnings.amount_usd
              </Mono>
            </div>
          </div>
          {cumulativeSeries.length >= 2 ? (
            <LineChart
              w={620}
              h={240}
              series={[
                { data: cumulativeSeries, color: tokens.emerald, thick: true, fill: true },
              ]}
            />
          ) : (
            <EmptyChart label="Not enough data yet — earnings populate as fees accrue." />
          )}
          {summary && summary.by_event_type.length > 0 && (
            <div className="flex gap-3 mt-3 flex-wrap">
              {summary.by_event_type.map((e) => (
                <div key={e.event_type} className="flex items-center gap-2">
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: EVENT_COLOR[e.event_type],
                    }}
                  />
                  <Mono size={11} color={tokens.text}>
                    {EVENT_LABEL[e.event_type]} {fmtUsd(e.total_usd)}
                  </Mono>
                  <Mono size={9} color={tokens.textFaint}>
                    · {e.count} events
                  </Mono>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card pad={0} className="overflow-hidden flex flex-col">
          <div
            style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${tokens.border}`,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Recent payouts
          </div>
          <div className="flex-1 overflow-y-auto">
            {recent === null ? (
              <Empty label="loading…" />
            ) : recent.length === 0 ? (
              <Empty label="No earnings yet. Earnings accrue daily once your published indices have subscribers." />
            ) : (
              recent.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                  }}
                >
                  <div className="flex justify-between items-center">
                    <Tag small color={EVENT_COLOR[r.event_type]} dot>
                      {EVENT_LABEL[r.event_type]}
                    </Tag>
                    <Mono size={12} color={tokens.text}>
                      {fmtUsd(r.amount_usd)}
                    </Mono>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <Mono size={9.5} color={tokens.textFaint}>
                      proposal {r.proposal_id.slice(0, 8)}…
                    </Mono>
                    <Mono size={9.5} color={tokens.textFaint}>
                      {fmt(r.accrued_at)}
                    </Mono>
                  </div>
                  {r.tx_hash && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${r.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: tokens.cyan,
                        fontSize: 10,
                        wordBreak: "break-all",
                      }}
                    >
                      tx {r.tx_hash.slice(0, 14)}…
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {summary && summary.by_proposal.length > 0 && (
        <Card pad={0}>
          <div
            style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${tokens.border}`,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Per proposal
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
            {["PROPOSAL", "TICKER", "EARNED", "EVENTS", "AUM", "LAST"].map((k) => (
              <Label key={k}>{k}</Label>
            ))}
          </div>
          {summary.by_proposal.map((p) => (
            <div
              key={p.proposal_id}
              className="grid items-center"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr",
                padding: "10px 16px",
                gap: 10,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <Mono size={12} color={tokens.text}>
                {p.title ?? p.proposal_id.slice(0, 8)}
              </Mono>
              <Mono size={11} color={tokens.amber}>
                {p.ssi_ticker ?? "—"}
              </Mono>
              <Mono size={12} color={tokens.emerald}>
                {fmtUsd(p.total_usd)}
              </Mono>
              <Mono size={11} color={tokens.textDim}>
                {p.count}
              </Mono>
              <Mono size={11} color={tokens.textDim}>
                {p.latest_aum_usd !== null ? fmtUsd(p.latest_aum_usd, 0) : "—"}
              </Mono>
              <Mono size={11} color={tokens.textFaint}>
                {fmt(p.last_accrued_at)}
              </Mono>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function KpiCard({
  k,
  v,
  d,
  color,
}: {
  k: string;
  v: string;
  d: string;
  color: string;
}) {
  return (
    <Card pad={14}>
      <Label color={color === tokens.textFaint ? tokens.textFaint : undefined}>
        {k}
      </Label>
      <Metric v={v} size={24} color={color} style={{ marginTop: 6 }} />
      <Mono size={11} className="mt-1 block" color={tokens.textFaint}>
        {d}
      </Mono>
    </Card>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center text-center"
      style={{
        height: 240,
        background: tokens.bgElev2,
        border: `1px dashed ${tokens.border}`,
        borderRadius: 8,
        color: tokens.textFaint,
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <Mono size={11}>{label}</Mono>
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      className="flex-1 flex items-center justify-center text-center"
      style={{ padding: 24, color: tokens.textFaint }}
    >
      <Mono size={11} style={{ maxWidth: 240, lineHeight: 1.5 }}>
        {label}
      </Mono>
    </div>
  );
}
