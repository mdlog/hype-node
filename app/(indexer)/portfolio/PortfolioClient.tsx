"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Label, Mono, Tag, Btn, Metric, LineChart, LogoSplash } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { useSessionGuard } from "@/lib/auth/useSessionGuard";
import { formatSyncLabel, useAutoRefetch } from "@/lib/hooks/useAutoRefetch";
import { WalletMismatchBanner } from "@/components/auth/WalletMismatchBanner";
import { CoachCallout } from "@/components/onboarding";
import { useFirstRun } from "@/lib/hooks/useFirstRun";
import type {
  UserPortfolio,
  PublishedIndex,
  SpotBalance,
} from "@/lib/api/portfolio";
import type { SnapshotPosition } from "@/lib/api/portfolio-snapshot";
import type { PfSnapshotRow } from "@/lib/supabase/types";

// Reference benchmark = the previous "all ssiDePIN" view, kept for the
// chart / sharpe / sector composition sections that we can't compute from
// user-only data yet (cost basis tracking → v2). Server-fetched and passed
// in so the section renders instantly.
export type ReferenceData = {
  ticker: string;
  constituents: { symbol: string; weight: number }[];
  snapshot: {
    price: number;
    change_pct_24h: number;
    roi_7d: number;
    roi_1m: number;
    roi_3m: number;
    roi_1y: number;
    ytd: number;
  };
  closes: number[];
  metrics: {
    return_total: number;
    sharpe: number;
    volatility: number;
    max_drawdown: number;
    win_rate: number;
  };
};

const PALETTE = [
  tokens.emerald,
  tokens.cyan,
  tokens.amber,
  "#a78bfa",
  "#34d399",
  "#60a5fa",
  "#fbbf24",
  "#f472b6",
];

const PERIOD_LABELS = ["1D", "1W", "1M", "3M", "ALL"] as const;
const PERIOD_DAYS: Record<string, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  ALL: 90,
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: UserPortfolio }
  | { kind: "error"; message: string };

type ViewMode = "current" | "history";

type HistoryPeriod = "7d" | "30d" | "90d" | "all";

type HistoryFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; rows: PfSnapshotRow[] }
  | { kind: "error"; message: string };

type SnapshotState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string };

const HISTORY_PERIOD_DAYS: Record<HistoryPeriod, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};


// ---------- helpers ----------

function shortAddr(addr: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function pct(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function fmtDate(unixSec: number): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function fmtAmount(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/** Normalize a series to base 100 against its first defined value. */
function normalizeBase100(series: (number | null)[]): number[] {
  let base: number | null = null;
  for (const v of series) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      base = v;
      break;
    }
  }
  if (base === null) return [];
  return series.map((v) =>
    typeof v === "number" && Number.isFinite(v) && base !== null
      ? (v / base) * 100
      : 100,
  );
}

function isSnapshotPosition(value: unknown): value is SnapshotPosition {
  if (!value || typeof value !== "object") return false;
  const k = (value as { kind?: unknown }).kind;
  return k === "spot" || k === "index";
}

function parsePositions(raw: unknown): SnapshotPosition[] {
  // The DB column is JSONB so it round-trips as `unknown`. Validate the
  // tag at the boundary instead of casting blindly so a malformed legacy
  // row doesn't crash the renderer.
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSnapshotPosition);
}


// ---------- Main component ----------

export function PortfolioClient({ reference }: { reference: ReferenceData }) {
  // Use the session guard's `effectiveAddress` (the SIWE-authenticated
  // identity) instead of wagmi's `useAccount()` so portfolio data tracks
  // the auth cookie, not whatever wallet MetaMask has currently selected.
  // The banner below makes the difference visible when they diverge.
  const guard = useSessionGuard();
  const address = guard.effectiveAddress;
  const isConnected = guard.isConnected;
  const wagmiStatus =
    guard.status === "loading" ? "connecting" : "connected";
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [period, setPeriod] = useState<(typeof PERIOD_LABELS)[number]>("1M");
  const [view, setView] = useState<ViewMode>("current");
  const [snapshotState, setSnapshotState] = useState<SnapshotState>({
    kind: "idle",
  });
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("30d");

  // Background poll snapshots so a "Take snapshot" from another device shows
  // up here without a hard refresh. Snapshots are infrequent (user-triggered
  // mostly), so a 60s interval is plenty — saves battery on mobile vs the
  // 15s default. Hook is gated on auth: when disconnected we pass `null` so
  // no requests fire at all.
  const snapshotsHook = useAutoRefetch<PfSnapshotRow[]>(
    isConnected && address ? "/api/portfolio/snapshots?limit=90" : null,
    { intervalMs: 60_000 },
  );

  // Adapt the hook's (data | loading | error) tuple to the existing
  // discriminated `HistoryFetchState` so the downstream HistorySection /
  // HistoryDashboard rendering doesn't need to change.
  const history: HistoryFetchState = !isConnected || !address
    ? { kind: "idle" }
    : snapshotsHook.error
      ? { kind: "error", message: snapshotsHook.error }
      : snapshotsHook.data
        ? { kind: "ok", rows: snapshotsHook.data }
        : { kind: "loading" };

  const refresh = useCallback(async () => {
    if (!address) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/portfolio?address=${encodeURIComponent(address)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as
        | (UserPortfolio & { ok: true })
        | { ok: false; error: string };
      if (!res.ok || !("ok" in body) || !body.ok) {
        setState({
          kind: "error",
          message:
            "error" in body && typeof body.error === "string"
              ? body.error
              : `HTTP ${res.status}`,
        });
        return;
      }
      setState({ kind: "ok", data: body });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }, [address]);

  // Manual reload trigger surfaced to children. Delegates to the hook so a
  // user click and the background interval share the same dedup / abort
  // path — no risk of two overlapping requests landing out of order.
  const loadHistory = useCallback(async () => {
    await snapshotsHook.refetch();
  }, [snapshotsHook]);

  const takeSnapshot = useCallback(async () => {
    if (!isConnected || !address) return;
    setSnapshotState({ kind: "saving" });
    try {
      const res = await fetch(`/api/portfolio/snapshots`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        taken_at?: string;
        error?: string;
      };
      if (!res.ok || !body.id || !body.taken_at) {
        setSnapshotState({
          kind: "error",
          message: body.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setSnapshotState({ kind: "saved", at: body.taken_at });
      // The auto-refetch hook polls every 60s in the background, but we
      // refetch eagerly so the new snapshot appears in the History tab
      // immediately — no need to gate on `view === "history"` because the
      // hook polls regardless of which tab is showing.
      void snapshotsHook.refetch();
    } catch (err) {
      setSnapshotState({ kind: "error", message: (err as Error).message });
    }
  }, [isConnected, address, snapshotsHook]);

  useEffect(() => {
    if (isConnected && address) {
      void refresh();
    } else {
      setState({ kind: "idle" });
    }
  }, [isConnected, address, refresh]);

  // History no longer needs a lazy-load effect — the hook polls
  // automatically once we're connected, so swapping to the History tab
  // either renders cached rows (instant) or shows the hook's loading
  // state until the in-flight initial fetch resolves.

  const walletConnecting = wagmiStatus === "connecting";
  const { isDone, hydrated: firstRunHydrated } = useFirstRun();
  const createdIndex = isDone("createIndex");

  return (
    <>
      {/* Mismatch banner — only renders when wagmi addr ≠ session addr */}
      <WalletMismatchBanner guard={guard} />

      {firstRunHydrated && !createdIndex && (
        <CoachCallout
          icon="📊"
          title="This is a reference benchmark (ssiDePIN)"
          body="The charts below track a sample DePIN index, not your own holdings. Create your first index to track real, personal performance."
          cta={{ label: "Open builder", href: "/builder" }}
        />
      )}

      {/* View switcher + snapshot button — only meaningful when signed in */}
      {isConnected && address && !walletConnecting && (
        <ViewToolbar
          view={view}
          onViewChange={setView}
          snapshotState={snapshotState}
          onTakeSnapshot={takeSnapshot}
        />
      )}

      {/* SECTION 1: Your Portfolio (current or history) */}
      {walletConnecting ? (
        <LogoSplash label="connecting wallet" size={56} />
      ) : !isConnected || !address ? (
        <DisconnectedBanner />
      ) : view === "history" ? (
        <HistorySection
          history={history}
          period={historyPeriod}
          onPeriodChange={setHistoryPeriod}
          onReload={loadHistory}
          syncLabel={formatSyncLabel(snapshotsHook.lastFetchedAt, snapshotsHook.loading)}
        />
      ) : state.kind === "loading" || state.kind === "idle" ? (
        <LogoSplash label="loading your portfolio" size={56} />
      ) : state.kind === "error" ? (
        <ErrorBanner message={state.message} onRetry={refresh} />
      ) : (
        <RealPortfolioSection data={state.data} onRefresh={refresh} />
      )}

      {/* Divider that frames the reference section */}
      <ReferenceDivider connected={Boolean(isConnected && address)} />

      {/* SECTION 2: Reference benchmark (always visible, clearly labeled) */}
      <ReferenceBenchmark
        reference={reference}
        period={period}
        onPeriodChange={setPeriod}
      />
    </>
  );
}

// ---------- View toolbar (mode switcher + snapshot button) ----------

function ViewToolbar({
  view,
  onViewChange,
  snapshotState,
  onTakeSnapshot,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  snapshotState: SnapshotState;
  onTakeSnapshot: () => void;
}) {
  const saving = snapshotState.kind === "saving";
  const savedMsg =
    snapshotState.kind === "saved"
      ? `Snapshot saved at ${fmtClock(snapshotState.at)}`
      : snapshotState.kind === "error"
        ? `Snapshot failed: ${snapshotState.message}`
        : null;
  const savedColor =
    snapshotState.kind === "error" ? tokens.amber : tokens.emerald;

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex gap-1">
        {(["current", "history"] as const).map((v) => {
          const on = v === view;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                background: on ? tokens.bgElev2 : "transparent",
                border: `1px solid ${on ? tokens.borderStrong : tokens.border}`,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                color: on ? tokens.text : tokens.textDim,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {v === "current" ? "Current" : "History"}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {savedMsg && (
          <Mono size={11} color={savedColor}>
            {savedMsg}
          </Mono>
        )}
        <Btn small onClick={onTakeSnapshot} disabled={saving}>
          {saving ? "… saving" : "📸 Take snapshot"}
        </Btn>
      </div>
    </div>
  );
}


// ---------- Real portfolio sections ----------

function DisconnectedBanner() {
  return (
    <Card pad={20}>
      <div
        className="flex items-center gap-4 flex-wrap"
        style={{ minHeight: 80 }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: `1px dashed ${tokens.border}`,
            display: "grid",
            placeItems: "center",
            fontSize: 24,
            color: tokens.textFaint,
            flexShrink: 0,
          }}
        >
          ◇
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: tokens.text,
              letterSpacing: "-0.01em",
              marginBottom: 4,
            }}
          >
            Connect your wallet to see your portfolio
          </div>
          <Mono size={11} color={tokens.textDim}>
            We read your published indices from the SSI Registry and your spot
            balances from SoDEX. The reference benchmark below stays visible
            either way.
          </Mono>
        </div>
      </div>
    </Card>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card pad={20}>
      <div className="flex items-center gap-3 justify-between flex-wrap">
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: tokens.amber }}>
            Could not load portfolio
          </div>
          <Mono size={11} color={tokens.textFaint}>
            {message}
          </Mono>
        </div>
        <Btn small onClick={onRetry}>↻ Retry</Btn>
      </div>
    </Card>
  );
}

function RealPortfolioSection({
  data,
  onRefresh,
}: {
  data: UserPortfolio;
  onRefresh: () => void;
}) {
  const { address, registry, sodex } = data;
  const totalIndices = registry.indices.length;
  const totalBalances = sodex.balances.length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: tokens.text,
              }}
            >
              Your Portfolio
            </div>
            <Tag small color={tokens.emerald} dot>
              live
            </Tag>
          </div>
          <Mono size={11}>
            wallet <span style={{ color: tokens.text }}>{shortAddr(address)}</span>
            {" · "}SSI chain {registry.chainId}
            {" · "}SoDEX {sodex.env}
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small onClick={onRefresh}>↻ Refresh</Btn>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Card pad={14}>
          <Label>PUBLISHED INDICES</Label>
          <Metric
            v={String(totalIndices)}
            size={26}
            color={tokens.emerald}
            style={{ marginTop: 4 }}
          />
          <Mono size={10}>of {registry.totalIndices} total on registry</Mono>
        </Card>
        <Card pad={14}>
          <Label>SPOT ASSETS</Label>
          <Metric
            v={String(totalBalances)}
            size={26}
            color={tokens.cyan}
            style={{ marginTop: 4 }}
          />
          <Mono size={10}>{sodex.env} · live SoDEX</Mono>
        </Card>
        <Card pad={14}>
          <Label>WALLET</Label>
          <Metric
            v={shortAddr(address)}
            size={20}
            color={tokens.amber}
            style={{ marginTop: 4 }}
          />
          <Mono size={10}>
            {registry.address ? `registry ${shortAddr(registry.address)}` : "registry not configured"}
          </Mono>
        </Card>
      </div>

      {/* Errors */}
      {(registry.error || sodex.error) && (
        <Card pad={12}>
          <div className="flex flex-col gap-1">
            {registry.error && (
              <Mono size={11} color={tokens.amber}>⚠ SSI Registry: {registry.error}</Mono>
            )}
            {sodex.error && (
              <Mono size={11} color={tokens.amber}>⚠ SoDEX: {sodex.error}</Mono>
            )}
          </div>
        </Card>
      )}

      {/* Spot balances + Indices */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
        <SpotBalancesCard balances={sodex.balances} env={sodex.env} addr={address} hasError={Boolean(sodex.error)} />
        <PublishedIndicesCard indices={registry.indices} hasError={Boolean(registry.error)} />
      </div>
    </div>
  );
}

function SpotBalancesCard({
  balances,
  env,
  addr,
  hasError,
}: {
  balances: SpotBalance[];
  env: string;
  addr: string;
  hasError: boolean;
}) {
  return (
    <Card pad={0}>
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <div>
          <Label>Spot Balances</Label>
          <Mono size={10}>SoDEX {env} · {shortAddr(addr)}</Mono>
        </div>
        <Tag small color={hasError ? tokens.amber : tokens.emerald} dot>
          {hasError ? "error" : "live"}
        </Tag>
      </div>
      {balances.length === 0 ? (
        <div style={{ padding: "20px 16px" }}>
          <Mono size={11} color={tokens.textFaint}>
            {hasError
              ? "Could not reach SoDEX gateway."
              : `No spot balances on ${env}. Deposit USDC to start trading.`}
          </Mono>
        </div>
      ) : (
        <BalanceTable balances={balances} />
      )}
    </Card>
  );
}

function BalanceTable({ balances }: { balances: SpotBalance[] }) {
  return (
    <div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          padding: "8px 16px",
          gap: 12,
          borderBottom: `1px solid ${tokens.borderFaint}`,
          background: tokens.bgElev,
        }}
      >
        <Label>ASSET</Label>
        <Label>FREE</Label>
        <Label>LOCKED</Label>
        <Label>TOTAL</Label>
      </div>
      {balances.map((b) => (
        <div
          key={b.asset}
          className="grid items-center"
          style={{
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            padding: "10px 16px",
            gap: 12,
            borderBottom: `1px solid ${tokens.borderFaint}`,
          }}
        >
          <div className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>
            {b.asset}
          </div>
          <Mono size={11} color={tokens.text}>{fmtAmount(b.free)}</Mono>
          <Mono size={11} color={Number(b.locked) > 0 ? tokens.amber : tokens.textFaint}>
            {fmtAmount(b.locked)}
          </Mono>
          <Mono size={11} color={tokens.text}>{fmtAmount(b.total)}</Mono>
        </div>
      ))}
    </div>
  );
}

function PublishedIndicesCard({
  indices,
  hasError,
}: {
  indices: PublishedIndex[];
  hasError: boolean;
}) {
  return (
    <Card pad={0}>
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <div>
          <Label>Published Indices</Label>
          <Mono size={10}>SSI Registry · indices you created</Mono>
        </div>
        <Tag small color={hasError ? tokens.amber : tokens.emerald} dot>
          {hasError ? "error" : `${indices.length} owned`}
        </Tag>
      </div>
      {indices.length === 0 ? (
        <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Mono size={11} color={tokens.textFaint}>
            {hasError
              ? "Could not read SSI Registry."
              : "No indices yet. Open Builder to publish your first one."}
          </Mono>
          {!hasError && (
            <div>
              <Link href="/builder">
                <Btn small>→ Open Builder</Btn>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          {indices.map((ix) => (
            <div
              key={ix.id}
              style={{
                padding: "10px 16px",
                borderBottom: `1px solid ${tokens.borderFaint}`,
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>
                  {ix.symbol}
                </div>
                <Mono size={10}>{ix.name} · {ix.tokens.length} constituents</Mono>
              </div>
              <Mono size={10} color={tokens.cyan}>
                mgmt {fmtBps(ix.mgmtFeeBps)} · perf {fmtBps(ix.perfFeeBps)}
              </Mono>
              <Mono size={10} color={tokens.textFaint}>{fmtDate(ix.createdAt)}</Mono>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}


// ---------- Reference benchmark (the original visual) ----------

function ReferenceDivider({ connected }: { connected: boolean }) {
  return (
    <div
      className="flex items-center gap-3"
      style={{ marginTop: 4 }}
    >
      <div style={{ flex: 1, height: 1, background: tokens.border }} />
      <Mono size={9.5} color={tokens.textFaint}>
        {connected
          ? "REFERENCE BENCHMARK · ssiDePIN · synthetic until cost-basis tracking lands"
          : "REFERENCE BENCHMARK · ssiDePIN · live SoSoValue data"}
      </Mono>
      <div style={{ flex: 1, height: 1, background: tokens.border }} />
    </div>
  );
}

function ReferenceBenchmark({
  reference,
  period,
  onPeriodChange,
}: {
  reference: ReferenceData;
  period: (typeof PERIOD_LABELS)[number];
  onPeriodChange: (p: (typeof PERIOD_LABELS)[number]) => void;
}) {
  const periodDays = PERIOD_DAYS[period] ?? 30;
  const slicedCloses = reference.closes.slice(-periodDays);
  // Synthetic moving-average benchmark line — same series smoothed,
  // mirrors the original page so the visual diff between "real" and
  // "benchmark" remains realistic.
  const benchmark = slicedCloses.map((_, i, arr) => {
    const w = 7;
    const lo = Math.max(0, i - w);
    const slice = arr.slice(lo, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  const composition: [string, number, string][] = reference.constituents
    .slice(0, 8)
    .map((c, i): [string, number, string] => [
      c.symbol.toUpperCase(),
      Math.round(c.weight * 100),
      PALETTE[i % PALETTE.length],
    ]);

  const { snapshot, metrics } = reference;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="flex items-center justify-center font-mono"
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.emeraldDim})`,
            fontSize: 12,
            fontWeight: 700,
            color: tokens.bg,
            boxShadow: `0 0 16px ${tokens.emerald}40`,
          }}
        >
          DEP
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
              SoSoValue DePIN Index
            </div>
            <Mono size={11} color={tokens.textDim}>
              {reference.ticker} · {reference.constituents.length} assets
            </Mono>
            <Tag small color={tokens.amber} dot>
              reference
            </Tag>
          </div>
          <Mono size={10}>
            performance reference · GET /indices/{reference.ticker}/snapshot + /klines
          </Mono>
        </div>
      </div>

      {/* Chart + KPI grid */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="flex flex-col gap-3">
          <Card pad={16} className="flex-1">
            <div className="flex justify-between items-end">
              <div>
                <Label>NAV per token (SSI snapshot)</Label>
                <Metric v={fmtPrice(snapshot.price)} size={32} style={{ marginTop: 6 }} />
                <div className="flex gap-2.5 items-center mt-1 flex-wrap">
                  <Mono
                    size={12}
                    color={snapshot.roi_1y >= 0 ? tokens.emerald : tokens.red}
                  >
                    {pct(snapshot.roi_1y)} since 1y
                  </Mono>
                  <Mono
                    size={12}
                    color={snapshot.change_pct_24h >= 0 ? tokens.emerald : tokens.red}
                  >
                    {pct(snapshot.change_pct_24h)} (24h)
                  </Mono>
                  <Mono size={12} color={snapshot.ytd >= 0 ? tokens.emerald : tokens.red}>
                    {pct(snapshot.ytd)} ytd
                  </Mono>
                </div>
              </div>
              <div className="flex gap-1">
                {PERIOD_LABELS.map((t) => {
                  const on = t === period;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onPeriodChange(t)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 4,
                        background: on ? tokens.bgElev2 : "transparent",
                        border: `1px solid ${on ? tokens.borderStrong : "transparent"}`,
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 10,
                        color: on ? tokens.text : tokens.textDim,
                        cursor: "pointer",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <LineChart
              w={780}
              h={240}
              series={[
                { data: slicedCloses, color: tokens.emerald, thick: true, fill: true },
                { data: benchmark, color: tokens.textDim, dashed: true },
              ]}
            />
          </Card>
          <div className="grid grid-cols-4 gap-2.5">
            <Card pad={12}>
              <Label>RETURN (90D)</Label>
              <Metric
                v={pct(metrics.return_total, 1)}
                size={20}
                color={metrics.return_total >= 0 ? tokens.emerald : tokens.red}
                style={{ marginTop: 4 }}
              />
            </Card>
            <Card pad={12}>
              <Label>SHARPE</Label>
              <Metric
                v={metrics.sharpe.toFixed(2)}
                size={20}
                color={metrics.sharpe > 1 ? tokens.emerald : tokens.text}
                style={{ marginTop: 4 }}
              />
            </Card>
            <Card pad={12}>
              <Label>VOLATILITY</Label>
              <Metric
                v={pct(metrics.volatility, 1)}
                size={20}
                color={metrics.volatility > 0.5 ? tokens.amber : tokens.text}
                style={{ marginTop: 4 }}
              />
            </Card>
            <Card pad={12}>
              <Label>MAX DD</Label>
              <Metric
                v={pct(metrics.max_drawdown, 1)}
                size={20}
                color={tokens.red}
                style={{ marginTop: 4 }}
              />
            </Card>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {/* Composition */}
          <Card pad={16}>
            <div className="flex justify-between mb-2.5">
              <div style={{ fontSize: 13, fontWeight: 600 }}>Composition</div>
              <Mono size={10}>SSI · {reference.constituents.length} live constituents</Mono>
            </div>
            <div className="flex gap-3.5">
              <CompositionDonut composition={composition} />
              <div className="flex-1 grid grid-cols-2 gap-1">
                {composition.map(([a, w, c], i) => (
                  <div key={i} className="flex items-center gap-1.5" style={{ padding: "2px 0" }}>
                    <div style={{ width: 8, height: 8, background: c, borderRadius: 2 }} />
                    <div style={{ fontSize: 11, color: tokens.text, flex: 1 }}>{a}</div>
                    <Mono size={10}>{w}%</Mono>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* ROI grid */}
          <Card pad={16}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              Performance over period
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label>7-day ROI</Label>
                <Metric
                  v={pct(snapshot.roi_7d)}
                  size={18}
                  color={snapshot.roi_7d >= 0 ? tokens.emerald : tokens.red}
                  style={{ marginTop: 3 }}
                />
              </div>
              <div>
                <Label>1-month ROI</Label>
                <Metric
                  v={pct(snapshot.roi_1m)}
                  size={18}
                  color={snapshot.roi_1m >= 0 ? tokens.emerald : tokens.red}
                  style={{ marginTop: 3 }}
                />
              </div>
              <div>
                <Label>3-month ROI</Label>
                <Metric
                  v={pct(snapshot.roi_3m)}
                  size={18}
                  color={snapshot.roi_3m >= 0 ? tokens.emerald : tokens.red}
                  style={{ marginTop: 3 }}
                />
              </div>
              <div>
                <Label>Win rate (90d)</Label>
                <Metric
                  v={`${(metrics.win_rate * 100).toFixed(0)}%`}
                  size={18}
                  color={metrics.win_rate > 0.5 ? tokens.emerald : tokens.amber}
                  style={{ marginTop: 3 }}
                />
              </div>
            </div>
          </Card>

          {/* Note */}
          <Card pad={14}>
            <div className="flex items-center gap-2 mb-1.5">
              <Mono size={9} color={tokens.textFaint}>NOTE</Mono>
            </div>
            <div style={{ fontSize: 11.5, color: tokens.textDim, lineHeight: 1.5 }}>
              The chart, sharpe, volatility, and ROI grid above use the SSI
              DePIN reference index as a benchmark. Per-wallet cost-basis &amp;
              NAV history will replace these once on-chain transfer indexing
              is enabled.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CompositionDonut({
  composition,
}: {
  composition: [string, number, string][];
}) {
  let acc = 0;
  return (
    <svg width={104} height={104} viewBox="0 0 110 110">
      {composition.map(([, v, c], i) => {
        const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
        const end = ((acc + v) / 100) * Math.PI * 2 - Math.PI / 2;
        acc += v;
        const large = v > 50 ? 1 : 0;
        const r1 = 48;
        const r2 = 32;
        const x1 = 55 + Math.cos(start) * r1;
        const y1 = 55 + Math.sin(start) * r1;
        const x2 = 55 + Math.cos(end) * r1;
        const y2 = 55 + Math.sin(end) * r1;
        const x3 = 55 + Math.cos(end) * r2;
        const y3 = 55 + Math.sin(end) * r2;
        const x4 = 55 + Math.cos(start) * r2;
        const y4 = 55 + Math.sin(start) * r2;
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} A ${r1} ${r1} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r2} ${r2} 0 ${large} 0 ${x4} ${y4} Z`}
            fill={c}
          />
        );
      })}
      <text x="55" y="52" fill={tokens.text} fontSize="12" fontWeight="600" textAnchor="middle">
        {composition.length}
      </text>
      <text x="55" y="66" fill={tokens.textDim} fontSize="8" textAnchor="middle">
        ASSETS
      </text>
    </svg>
  );
}


// ---------- History view ----------

function HistorySection({
  history,
  period,
  onPeriodChange,
  onReload,
  syncLabel,
}: {
  history: HistoryFetchState;
  period: HistoryPeriod;
  onPeriodChange: (p: HistoryPeriod) => void;
  onReload: () => void;
  syncLabel: string;
}) {
  if (history.kind === "idle" || history.kind === "loading") {
    return <LogoSplash label="loading snapshot history" size={56} />;
  }
  if (history.kind === "error") {
    return <ErrorBanner message={history.message} onRetry={onReload} />;
  }
  if (history.rows.length === 0) {
    return <EmptyHistoryBanner />;
  }
  return (
    <HistoryDashboard
      rows={history.rows}
      period={period}
      onPeriodChange={onPeriodChange}
      onReload={onReload}
      syncLabel={syncLabel}
    />
  );
}

function EmptyHistoryBanner() {
  return (
    <Card pad={20}>
      <div className="flex items-center gap-4 flex-wrap" style={{ minHeight: 80 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: `1px dashed ${tokens.border}`,
            display: "grid",
            placeItems: "center",
            fontSize: 24,
            color: tokens.textFaint,
            flexShrink: 0,
          }}
        >
          📸
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: tokens.text,
              letterSpacing: "-0.01em",
              marginBottom: 4,
            }}
          >
            No snapshots yet
          </div>
          <Mono size={11} color={tokens.textDim}>
            Click &quot;📸 Take snapshot&quot; above to record a point-in-time
            view of your indices, balances, and benchmark prices. Snapshots
            unlock the AUM history chart and benchmark comparisons.
          </Mono>
        </div>
      </div>
    </Card>
  );
}

function HistoryDashboard({
  rows,
  period,
  onPeriodChange,
  onReload,
  syncLabel,
}: {
  rows: PfSnapshotRow[];
  period: HistoryPeriod;
  onPeriodChange: (p: HistoryPeriod) => void;
  onReload: () => void;
  syncLabel: string;
}) {
  // API returns rows ordered taken_at desc; chart wants ascending so the
  // x-axis reads left→right as oldest→newest.
  const chrono = [...rows].sort(
    (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
  );
  const days = HISTORY_PERIOD_DAYS[period];
  const cutoff =
    days !== null ? Date.now() - days * 24 * 60 * 60 * 1000 : Number.NEGATIVE_INFINITY;
  const filtered = chrono.filter((r) => new Date(r.taken_at).getTime() >= cutoff);

  // Build aligned series. We need values aligned by index across AUM /
  // BTC / ETH / MAG7 so the LineChart's x-axis stays consistent. Skip
  // rows where AUM is null (no priced positions) — they break the line.
  const aumRows = filtered.filter(
    (r) => typeof r.total_aum_usd === "number" && Number.isFinite(r.total_aum_usd),
  );
  const aumSeries = aumRows.map((r) => r.total_aum_usd as number);
  const btcSeries = aumRows.map((r) => r.benchmark_btc_price);
  const ethSeries = aumRows.map((r) => r.benchmark_eth_price);
  const mag7Series = aumRows.map((r) => r.benchmark_ssimag7_nav);

  const aumNorm = normalizeBase100(aumSeries);
  const btcNorm = normalizeBase100(btcSeries);
  const ethNorm = normalizeBase100(ethSeries);
  const mag7Norm = normalizeBase100(mag7Series);

  // Most-recent snapshot for headline metric. Use the original (desc)
  // ordering so latest = rows[0].
  const latest = rows[0] ?? null;
  const previous = rows[1] ?? null;
  const change =
    latest && previous && latest.total_aum_usd && previous.total_aum_usd
      ? (latest.total_aum_usd - previous.total_aum_usd) / previous.total_aum_usd
      : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: tokens.text,
              }}
            >
              Portfolio History
            </div>
            <Tag small color={tokens.cyan} dot>
              {rows.length} snapshots
            </Tag>
          </div>
          <Mono size={11}>
            {latest
              ? `latest ${fmtDateTime(latest.taken_at)} · AUM ${fmtUsd(latest.total_aum_usd)}`
              : "no data"}
            {" · "}
            <span style={{ color: tokens.textFaint }}>{syncLabel}</span>
          </Mono>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker period={period} onChange={onPeriodChange} />
          <Btn small onClick={onReload}>↻ Reload</Btn>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Card pad={14}>
          <Label>LATEST AUM</Label>
          <Metric
            v={fmtUsd(latest?.total_aum_usd ?? null)}
            size={26}
            color={tokens.emerald}
            style={{ marginTop: 4 }}
          />
          <Mono size={10}>{latest ? fmtDateTime(latest.taken_at) : "—"}</Mono>
        </Card>
        <Card pad={14}>
          <Label>VS PREVIOUS</Label>
          <Metric
            v={change !== null ? pct(change) : "—"}
            size={26}
            color={
              change === null
                ? tokens.text
                : change >= 0
                  ? tokens.emerald
                  : tokens.red
            }
            style={{ marginTop: 4 }}
          />
          <Mono size={10}>
            {previous ? `prev ${fmtDateTime(previous.taken_at)}` : "no previous snapshot"}
          </Mono>
        </Card>
        <Card pad={14}>
          <Label>SNAPSHOTS IN WINDOW</Label>
          <Metric
            v={String(filtered.length)}
            size={26}
            color={tokens.amber}
            style={{ marginTop: 4 }}
          />
          <Mono size={10}>period {period.toUpperCase()}</Mono>
        </Card>
      </div>

      {/* Chart card */}
      <Card pad={16}>
        <div className="flex justify-between items-end mb-2 flex-wrap gap-2">
          <div>
            <Label>AUM vs benchmarks (normalized base=100)</Label>
            <Mono size={10}>
              your wallet (emerald) · BTC (cyan) · ETH (amber) · ssiMAG7 (violet)
            </Mono>
          </div>
        </div>
        {aumNorm.length < 2 ? (
          <div style={{ padding: "20px 0" }}>
            <Mono size={11} color={tokens.textFaint}>
              Need at least 2 priced snapshots in this window to render a chart.
              Take more snapshots or widen the period selector.
            </Mono>
          </div>
        ) : (
          <LineChart
            w={780}
            h={260}
            series={[
              { data: aumNorm, color: tokens.emerald, thick: true, fill: true },
              ...(btcNorm.length === aumNorm.length
                ? [{ data: btcNorm, color: tokens.cyan, dashed: true }]
                : []),
              ...(ethNorm.length === aumNorm.length
                ? [{ data: ethNorm, color: tokens.amber, dashed: true }]
                : []),
              ...(mag7Norm.length === aumNorm.length
                ? [{ data: mag7Norm, color: "#a78bfa", dashed: true }]
                : []),
            ]}
          />
        )}
      </Card>

      {/* Snapshot table */}
      <SnapshotsTable rows={[...filtered].reverse()} />
    </div>
  );
}

function PeriodPicker({
  period,
  onChange,
}: {
  period: HistoryPeriod;
  onChange: (p: HistoryPeriod) => void;
}) {
  const options: HistoryPeriod[] = ["7d", "30d", "90d", "all"];
  return (
    <div className="flex gap-1">
      {options.map((p) => {
        const on = p === period;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              background: on ? tokens.bgElev2 : "transparent",
              border: `1px solid ${on ? tokens.borderStrong : "transparent"}`,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10,
              color: on ? tokens.text : tokens.textDim,
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

function SnapshotsTable({ rows }: { rows: PfSnapshotRow[] }) {
  // Rows arrive newest-first for the table (more useful for humans
  // scanning recent activity). The "change vs previous" cell compares to
  // the chronologically prior snapshot — i.e. the next row down in the
  // newest-first list.
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card pad={0}>
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <div>
          <Label>Snapshot Log</Label>
          <Mono size={10}>{rows.length} rows · click to expand positions</Mono>
        </div>
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 0.6fr",
          padding: "8px 16px",
          gap: 12,
          borderBottom: `1px solid ${tokens.borderFaint}`,
          background: tokens.bgElev,
        }}
      >
        <Label>TAKEN AT</Label>
        <Label>AUM (USD)</Label>
        <Label>CHANGE</Label>
        <Label>TRIGGER</Label>
        <Label>POSITIONS</Label>
      </div>
      {rows.map((r, i) => {
        const prev = rows[i + 1] ?? null;
        const ch =
          r.total_aum_usd && prev?.total_aum_usd
            ? (r.total_aum_usd - prev.total_aum_usd) / prev.total_aum_usd
            : null;
        const positions = parsePositions(r.positions);
        const open = openId === r.id;
        return (
          <div key={r.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(open ? null : r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenId(open ? null : r.id);
                }
              }}
              className="grid items-center"
              style={{
                gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 0.6fr",
                padding: "10px 16px",
                gap: 12,
                borderBottom: `1px solid ${tokens.borderFaint}`,
                cursor: "pointer",
                background: open ? tokens.bgElev : "transparent",
              }}
            >
              <Mono size={11} color={tokens.text}>
                {fmtDateTime(r.taken_at)}
              </Mono>
              <Mono size={11} color={tokens.text}>
                {fmtUsd(r.total_aum_usd)}
              </Mono>
              <Mono
                size={11}
                color={
                  ch === null ? tokens.textFaint : ch >= 0 ? tokens.emerald : tokens.red
                }
              >
                {ch !== null ? pct(ch) : "—"}
              </Mono>
              <Mono size={10} color={tokens.textDim}>
                {r.trigger}
              </Mono>
              <Mono size={10} color={tokens.cyan}>
                {positions.length}
              </Mono>
            </div>
            {open && <SnapshotPositionsDetail positions={positions} />}
          </div>
        );
      })}
    </Card>
  );
}

function SnapshotPositionsDetail({ positions }: { positions: SnapshotPosition[] }) {
  if (positions.length === 0) {
    return (
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}>
        <Mono size={11} color={tokens.textFaint}>
          No positions captured in this snapshot.
        </Mono>
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${tokens.borderFaint}`,
        background: tokens.bg,
      }}
    >
      <div className="flex flex-col gap-1">
        {positions.map((p, i) => (
          <div
            key={i}
            className="grid items-center"
            style={{
              gridTemplateColumns: "60px 1fr 1.6fr 1fr",
              gap: 8,
              padding: "4px 0",
            }}
          >
            <Tag small color={p.kind === "spot" ? tokens.cyan : tokens.emerald}>
              {p.kind}
            </Tag>
            <Mono size={11} color={tokens.text}>
              {p.kind === "spot" ? p.asset : p.symbol}
            </Mono>
            <Mono size={10} color={tokens.textDim}>
              {p.kind === "spot"
                ? `total ${fmtAmount(p.total)} · free ${fmtAmount(p.free)}`
                : `${p.tokens.length} tokens · base ${p.base}`}
            </Mono>
            <Mono size={10} color={tokens.textFaint}>
              {p.usd_value !== null ? fmtUsd(p.usd_value) : "unpriced"}
            </Mono>
          </div>
        ))}
      </div>
    </div>
  );
}
