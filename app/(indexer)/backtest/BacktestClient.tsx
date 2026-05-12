"use client";

// Interactive layer over the server-rendered backtest dashboard.
//
// Layout follows the "Backtest Lab" hifi mockup: a 280px left rail with
// strategy / parameters / costs / benchmarks cards, and a main column
// with a 6-card KPI strip, an equity card (with Equity ↔ Underwater
// tabs), a 3-up analytics row (drawdown / volatility heatmap /
// constituent weights), and a footer-actions row for save / share.
//
// Behaviour preserved from the previous implementation:
//   - Click a strategy radio to pick a different SSI ticker
//   - Pick a period (30 / 60 / 90 days) and rebalance cadence
//   - Edit cost / risk knobs (fee, slippage, position cap, rf, init capital)
//   - Click "Run backtest" → fetch constituents + POST /api/agent/run-backtest
//   - Save / Share / Load / Compare against earlier saved runs
//
// While running we show a "running" indicator. On success we replace
// metrics + curves with the agent service's result. On failure the
// previous good view stays, with an inline error pill.
//
// The agent service returns `equity_preview` as a normalized series
// already (base ≈ 1.0). We rebase to 100 here for visual parity with the
// server-rendered curve so toggling between "initial" and "result"
// doesn't shift the y-axis.

import { useCallback, useMemo, useState } from "react";

import { Btn, Card, Mono, Toggle } from "@/components/ui";
import { formatSyncLabel, useAutoRefetch } from "@/lib/hooks/useAutoRefetch";
import { tokens } from "@/lib/tokens";
import type {
  BacktestCostParams,
  BacktestResult,
} from "@/lib/api/agent";
import type { IndexConstituent } from "@/lib/api/sosovalue";
import type { BtRunRow, Json } from "@/lib/supabase/types";

import { RunHistoryModal } from "./RunHistoryModal";

const SSI_LABELS: Record<string, string> = {
  ssiDePIN: "DePIN sentiment-weighted",
  ssiRWA: "RWA momentum",
  ssiAI: "AI agents narrative",
  ssiMeme: "Meme rotation",
  ssiGameFi: "GameFi rebound",
  ssiLayer1: "L1 majors",
  ssiLayer2: "L2 rollups",
  ssiMAG7: "Crypto MAG7",
  ssiPayFi: "PayFi yield",
  ssiDeFi: "DeFi blue-chip",
  ssiSocialFi: "SocialFi narrative",
  ssiCeFi: "CeFi exposure",
  ssiNFT: "NFT recovery",
};

const PERIOD_OPTIONS = [30, 60, 90] as const;
const REBALANCE_OPTIONS = [1, 7, 14] as const;
type Period = (typeof PERIOD_OPTIONS)[number];
type Rebalance = (typeof REBALANCE_OPTIONS)[number];

type Metrics = {
  return_total: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  win_rate: number;
};

type Benchmark = { label: string; name: string; series: number[] };

type Status = "idle" | "running" | "ok" | "error";

type EquityTab = "equity" | "underwater";

export type BacktestClientProps = {
  tickers: string[];
  initialStrategy: string;
  initialDays: Period;
  initialMetrics: Metrics;
  /** Strategy equity curve, normalized to base 100. */
  initialEquity: number[];
  initialBenchmarks: Benchmark[];
  initialDdSeries: number[];
  initialHeatmap: number[];
};

const benchmarkColors = [tokens.amber, tokens.violet, tokens.cyan];
// Overlay colors for Compare runs — distinct from the benchmark palette
// so the chart legend stays readable when 2-3 saved runs are layered on.
const overlayColors = [tokens.rose, "#60a5fa", "#facc15"];

function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function normalize(series: number[]): number[] {
  if (series.length === 0 || series[0] === 0) return series;
  return series.map((v) => (v / series[0]) * 100);
}

// Map a metric value to a coarse A+/A/B/C grade. The thresholds are
// crypto-baseline; tune if backtests start clustering at one bucket.
type Grade = "A+" | "A" | "B" | "C";
function gradeFor(
  metric: "return" | "sharpe" | "drawdown" | "winrate" | "vsbtc",
  value: number,
): Grade {
  if (!Number.isFinite(value)) return "C";
  switch (metric) {
    case "return":
      if (value > 0.30) return "A+";
      if (value > 0.10) return "A";
      if (value > 0) return "B";
      return "C";
    case "sharpe":
      if (value > 1.8) return "A+";
      if (value > 1.0) return "A";
      if (value > 0.4) return "B";
      return "C";
    case "drawdown":
      // value is negative — closer to 0 is better.
      if (value > -0.10) return "A";
      if (value > -0.20) return "B";
      return "C";
    case "winrate":
      if (value > 0.6) return "A+";
      if (value > 0.5) return "A";
      if (value > 0.4) return "B";
      return "C";
    case "vsbtc":
      if (value > 0.20) return "A+";
      if (value > 0.05) return "A";
      if (value > 0) return "B";
      return "C";
  }
}

function gradeColor(g: Grade): { bg: string; fg: string; border: string } {
  if (g === "A+" || g === "A") {
    return {
      bg: "rgba(16,185,129,0.12)",
      fg: tokens.emerald,
      border: "rgba(16,185,129,0.3)",
    };
  }
  if (g === "B") {
    return {
      bg: "rgba(245,158,11,0.12)",
      fg: tokens.amber,
      border: "rgba(245,158,11,0.3)",
    };
  }
  return { bg: tokens.bgElev2, fg: tokens.textDim, border: tokens.border };
}

// Daily simple returns from an equity series.
function returnsFromSeries(series: number[]): number[] {
  if (series.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev > 0) out.push(series[i] / prev - 1);
  }
  return out;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v =
    xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// β = cov(a,b) / var(b). Returns 0 when b's variance is zero or arrays
// are too short. Truncates to the shorter array.
function beta(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    varB += (b[i] - mb) * (b[i] - mb);
  }
  return varB === 0 ? 0 : cov / varB;
}

// Worst peak-to-trough drawdown — returns the index pair so the equity
// SVG can shade that x-range.
function worstDdRange(equity: number[]): {
  startIdx: number;
  endIdx: number;
  depth: number;
} {
  if (equity.length === 0) return { startIdx: 0, endIdx: 0, depth: 0 };
  let peak = equity[0];
  let peakIdx = 0;
  let depth = 0;
  let startIdx = 0;
  let endIdx = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      peakIdx = i;
    }
    const dd = peak > 0 ? (equity[i] - peak) / peak : 0;
    if (dd < depth) {
      depth = dd;
      startIdx = peakIdx;
      endIdx = i;
    }
  }
  return { startIdx, endIdx, depth };
}

// Days the curve spent below its prior peak — used as a "Recovery"
// proxy on the drawdown card.
function daysUnderwater(dd: number[]): number {
  return dd.filter((d) => d < -1e-6).length;
}

export function BacktestClient(props: BacktestClientProps) {
  const [strategy, setStrategy] = useState(props.initialStrategy);
  const [days, setDays] = useState<Period>(props.initialDays);
  const [rebalance, setRebalance] = useState<Rebalance>(7);
  const [equityTab, setEquityTab] = useState<EquityTab>("equity");

  // Cost / risk knobs — bound to the form inputs in the left rail. Sent
  // to the agent service on Run. UI surfaces them in user-friendly
  // units (% / $); we convert to decimals before posting.
  const [feeBps, setFeeBps] = useState(15);
  const [slipBps, setSlipBps] = useState(8);
  const [posCapPct, setPosCapPct] = useState(25);
  const [rfPct, setRfPct] = useState(4.2);
  const [initCapital, setInitCapital] = useState(10_000);

  // Per-benchmark visibility — purely client-side. Defaults match the
  // initial server payload.
  const [benchOn, setBenchOn] = useState<boolean[]>(
    props.initialBenchmarks.map(() => true),
  );

  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultDays, setResultDays] = useState<Period | null>(null);
  const [resultStrategy, setResultStrategy] = useState<string | null>(null);
  // Constituents that produced the current `result` — needed when persisting
  // a run so the saved row can be replayed later.
  const [resultConstituents, setResultConstituents] = useState<
    Array<{ currency_id: string; symbol: string; weight: number }> | null
  >(null);
  // Persistence state.
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<
    "idle" | "creating" | "ready" | "error"
  >("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareErr, setShareErr] = useState<string | null>(null);
  // Modal control: 'compare' (multi) or 'load' (single) or null.
  const [historyModal, setHistoryModal] = useState<"compare" | "load" | null>(
    null,
  );
  // Overlay equity curves picked via Compare runs (each normalized to 100).
  const [compareOverlays, setCompareOverlays] = useState<
    Array<{ id: string; label: string; series: number[] }>
  >([]);

  // Background poll of saved runs so a save from another device shows up
  // here within ~15s without a manual refresh.
  const runsHook = useAutoRefetch<BtRunRow[]>(
    "/api/backtest/runs?limit=20",
    { intervalMs: 15_000 },
  );

  const run = useCallback(async () => {
    setStatus("running");
    setError(null);
    setSavedRunId(null);
    setSaveStatus("idle");
    setSaveErr(null);
    setShareStatus("idle");
    setShareUrl(null);
    setShareErr(null);
    try {
      const consResp = await fetch(
        `/api/ssi/constituents/${encodeURIComponent(strategy)}`,
        { cache: "no-store" },
      );
      if (!consResp.ok) {
        setError(`constituents fetch failed (HTTP ${consResp.status})`);
        setStatus("error");
        return;
      }
      const cons = (await consResp.json()) as IndexConstituent[];
      if (!Array.isArray(cons) || cons.length === 0) {
        setError("no constituents returned for this strategy");
        setStatus("error");
        return;
      }

      const costs: BacktestCostParams = {
        fee_bps: feeBps,
        slippage_bps: slipBps,
        position_cap: posCapPct > 0 ? posCapPct / 100 : 0,
        risk_free_rate: rfPct / 100,
        init_capital: initCapital,
        rebalance_days: rebalance,
      };

      const runResp = await fetch("/api/agent/run-backtest", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          constituents: cons.map((c) => ({
            currency_id: c.currency_id,
            symbol: c.symbol,
            weight: c.weight,
          })),
          days,
          ...costs,
        }),
      });
      const body = (await runResp.json().catch(() => null)) as
        | (BacktestResult & { error?: string })
        | null;
      if (!runResp.ok || !body) {
        setError(body?.error ?? `HTTP ${runResp.status}`);
        setStatus("error");
        return;
      }
      if (body.ok === false) {
        setError(body.error ?? "agent service returned ok:false");
        setStatus("error");
        return;
      }
      setResult(body);
      setResultDays(days);
      setResultStrategy(strategy);
      setResultConstituents(
        cons.map((c) => ({
          currency_id: c.currency_id,
          symbol: c.symbol,
          weight: c.weight,
        })),
      );
      setStatus("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
      setStatus("error");
    }
  }, [strategy, days, rebalance, feeBps, slipBps, posCapPct, rfPct, initCapital]);

  // ---- Save / Share / Load / Compare handlers ----

  const handleSave = useCallback(async () => {
    if (!result || !resultConstituents || resultDays === null || !resultStrategy) {
      return;
    }
    const label = window.prompt(
      "Label for this saved backtest (optional):",
      `${resultStrategy} ${resultDays}d`,
    );
    if (label === null) return;
    setSaveStatus("saving");
    setSaveErr(null);
    try {
      const res = await fetch("/api/backtest/runs", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy_ticker: resultStrategy,
          days: resultDays,
          constituents: resultConstituents,
          result,
          label: label.trim() ? label.trim() : null,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { id?: string; error?: string }
        | null;
      if (!res.ok || !body?.id) {
        setSaveErr(body?.error ?? `HTTP ${res.status}`);
        setSaveStatus("error");
        return;
      }
      setSavedRunId(body.id);
      setSaveStatus("saved");
      void runsHook.refetch();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "network error");
      setSaveStatus("error");
    }
  }, [result, resultConstituents, resultDays, resultStrategy, runsHook]);

  const handleShare = useCallback(async () => {
    if (!savedRunId) return;
    setShareStatus("creating");
    setShareErr(null);
    setShareUrl(null);
    try {
      const res = await fetch("/api/backtest/share", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run_id: savedRunId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { short_code?: string; error?: string }
        | null;
      if (!res.ok || !body?.short_code) {
        setShareErr(body?.error ?? `HTTP ${res.status}`);
        setShareStatus("error");
        return;
      }
      const url = `${window.location.origin}/share/backtest/${body.short_code}`;
      setShareUrl(url);
      setShareStatus("ready");
      try {
        await navigator.clipboard?.writeText(url);
      } catch {
        // Ignore — the URL is still shown in the UI.
      }
    } catch (e) {
      setShareErr(e instanceof Error ? e.message : "network error");
      setShareStatus("error");
    }
  }, [savedRunId]);

  const normalizeForOverlay = useCallback((series: number[]): number[] => {
    if (series.length === 0 || series[0] === 0) return series;
    return series.map((v) => (v / series[0]) * 100);
  }, []);

  const handleLoadConfirm = useCallback(
    (rows: BtRunRow[]) => {
      const r = rows[0];
      if (!r) return;
      setHistoryModal(null);
      const restoredDays =
        r.days === 30 || r.days === 60 || r.days === 90 ? (r.days as Period) : 90;
      setStrategy(r.strategy_ticker);
      setDays(restoredDays);
      const raw = r.raw_result as unknown as BacktestResult | null;
      const equity = Array.isArray(r.equity_preview)
        ? (r.equity_preview as unknown as number[])
        : raw?.equity_preview ?? [];
      const synthesized: BacktestResult = raw && typeof raw === "object"
        ? raw
        : {
            ok: true,
            days: r.days,
            n_assets: r.n_assets ?? undefined,
            n_returns: r.n_returns ?? undefined,
            return: r.return_total ?? undefined,
            sharpe: r.sharpe ?? undefined,
            max_drawdown: r.max_drawdown ?? undefined,
            win_rate: r.win_rate ?? undefined,
            vs_btc: r.vs_btc ?? undefined,
            vs_eth: r.vs_eth ?? undefined,
            equity_preview: equity,
          };
      setResult(synthesized);
      setResultDays(restoredDays);
      setResultStrategy(r.strategy_ticker);
      if (Array.isArray(r.constituents)) {
        const cons = r.constituents as Json[];
        const parsed: Array<{ currency_id: string; symbol: string; weight: number }> = [];
        for (const c of cons) {
          if (c && typeof c === "object" && !Array.isArray(c)) {
            const o = c as { currency_id?: unknown; symbol?: unknown; weight?: unknown };
            if (
              typeof o.currency_id === "string" &&
              typeof o.symbol === "string" &&
              typeof o.weight === "number"
            ) {
              parsed.push({
                currency_id: o.currency_id,
                symbol: o.symbol,
                weight: o.weight,
              });
            }
          }
        }
        setResultConstituents(parsed.length > 0 ? parsed : null);
      } else {
        setResultConstituents(null);
      }
      setSavedRunId(r.id);
      setSaveStatus("saved");
      setSaveErr(null);
      setShareStatus("idle");
      setShareUrl(null);
      setShareErr(null);
      setError(null);
      setStatus("ok");
      setCompareOverlays([]);
    },
    [],
  );

  const handleCompareConfirm = useCallback(
    (rows: BtRunRow[]) => {
      setHistoryModal(null);
      const overlays = rows
        .map((r) => {
          const series = Array.isArray(r.equity_preview)
            ? (r.equity_preview as unknown as number[])
            : [];
          const clean = series.filter(
            (n) => typeof n === "number" && Number.isFinite(n),
          );
          return {
            id: r.id,
            label: r.label?.trim() || `${r.strategy_ticker} ${r.days}d`,
            series: normalizeForOverlay(clean),
          };
        })
        .filter((o) => o.series.length > 1);
      setCompareOverlays(overlays);
    },
    [normalizeForOverlay],
  );

  // Derived display values — prefer agent backtest result when available, else
  // fall back to the server-rendered initial state.
  const usingResult = status === "ok" && result !== null;

  const displayMetrics: Metrics = useMemo(() => {
    if (!usingResult || !result) return props.initialMetrics;
    return {
      return_total: result.return ?? 0,
      sharpe: result.sharpe ?? 0,
      sortino: NaN,
      max_drawdown: result.max_drawdown ?? 0,
      win_rate: result.win_rate ?? 0,
    };
  }, [usingResult, result, props.initialMetrics]);

  const displayEquity = useMemo(() => {
    if (!usingResult || !result?.equity_preview) return props.initialEquity;
    return normalize(result.equity_preview);
  }, [usingResult, result, props.initialEquity]);

  const ddSeries = useMemo(() => {
    if (!usingResult || displayEquity === props.initialEquity) {
      return props.initialDdSeries;
    }
    const series: number[] = [];
    let peak = displayEquity[0] ?? 0;
    for (const c of displayEquity) {
      if (c > peak) peak = c;
      series.push(peak > 0 ? (c - peak) / peak : 0);
    }
    return series;
  }, [usingResult, displayEquity, props.initialDdSeries, props.initialEquity]);

  // Drawdown distribution — bucket negatives into 24 bins so the bars
  // line up with the heatmap's hour grid visually.
  const ddBuckets = 24;
  const minDd = ddSeries.length > 0 ? Math.min(...ddSeries) : 0;
  const bucketHeights = useMemo(() => {
    const arr = new Array(ddBuckets).fill(0);
    if (minDd === 0) {
      arr[ddBuckets - 1] = ddSeries.length;
      return arr;
    }
    for (const dd of ddSeries) {
      const idx = Math.min(
        ddBuckets - 1,
        Math.max(0, Math.round((dd / minDd) * (ddBuckets - 1))),
      );
      // idx 0 = at the trough, idx ddBuckets-1 = no drawdown.
      arr[ddBuckets - 1 - idx] += 1;
    }
    return arr;
  }, [ddSeries, minDd]);
  const maxBucketH = Math.max(...bucketHeights, 1);

  const ddSummary = useMemo(() => {
    if (ddSeries.length === 0) {
      return { max: 0, avg: 0, recovery: 0 };
    }
    const negs = ddSeries.filter((d) => d < -1e-9);
    const avg = negs.length > 0 ? negs.reduce((a, b) => a + b, 0) / negs.length : 0;
    return {
      max: Math.min(...ddSeries),
      avg,
      recovery: daysUnderwater(ddSeries),
    };
  }, [ddSeries]);

  const heatmap = props.initialHeatmap;
  const heatMax = Math.max(...heatmap, 0.0001);
  const heatPeak = useMemo(() => {
    let mx = 0;
    let idx = 0;
    for (let i = 0; i < heatmap.length; i++) {
      if (heatmap[i] > mx) {
        mx = heatmap[i];
        idx = i;
      }
    }
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return { day: dayNames[Math.floor(idx / 24)], hour: idx % 24, value: mx };
  }, [heatmap]);

  // Constituent weights for the right-most analytics card. Prefer the
  // post-cap weights echoed by the agent service so the panel reflects
  // the position cap that's actually in effect.
  const weightsView = useMemo(() => {
    if (result?.weights) {
      const entries = Object.entries(result.weights);
      entries.sort((a, b) => b[1] - a[1]);
      return entries.map(([symbol, weight]) => ({ symbol, weight }));
    }
    if (resultConstituents && resultConstituents.length > 0) {
      const sorted = [...resultConstituents].sort(
        (a, b) => b.weight - a.weight,
      );
      return sorted.map((c) => ({ symbol: c.symbol, weight: c.weight }));
    }
    return [];
  }, [result, resultConstituents]);

  // Equity-card meta strip — NAV, Δ today, Vol 30d, Beta vs BTC.
  const navFinal = useMemo(() => {
    if (result?.nav_final && Number.isFinite(result.nav_final)) {
      return result.nav_final;
    }
    if (displayEquity.length > 0) {
      // Treat displayEquity as base 100 → scale by initCapital / 100.
      return (initCapital / 100) * displayEquity[displayEquity.length - 1];
    }
    return initCapital;
  }, [result, displayEquity, initCapital]);

  const deltaToday = useMemo(() => {
    if (displayEquity.length < 2) return 0;
    const last = displayEquity[displayEquity.length - 1];
    const prev = displayEquity[displayEquity.length - 2];
    return prev > 0 ? last / prev - 1 : 0;
  }, [displayEquity]);

  const vol30d = useMemo(() => {
    const r = returnsFromSeries(displayEquity).slice(-30);
    return stdev(r) * Math.sqrt(365);
  }, [displayEquity]);

  const betaVsBtc = useMemo(() => {
    const btc = props.initialBenchmarks[2]?.series ?? [];
    return beta(returnsFromSeries(displayEquity), returnsFromSeries(btc));
  }, [displayEquity, props.initialBenchmarks]);

  // Strategy is "stale" relative to displayed result when the user has
  // changed the radio or period since the last successful run.
  const stale =
    usingResult && (resultStrategy !== strategy || resultDays !== days);

  const strategyOptions = props.tickers.slice(0, 6).map((t) => ({
    ticker: t,
    label: SSI_LABELS[t] ?? t,
    on: t === strategy,
  }));

  const sourceLabel = usingResult
    ? `agent · ${resultStrategy} · ${resultDays}d`
    : `initial · ${props.initialStrategy} · ${props.initialDays}d`;

  const ddRange = useMemo(
    () => worstDdRange(displayEquity),
    [displayEquity],
  );

  return (
    <div style={{ padding: "20px 24px 80px" }}>
      <PageHeader
        strategyLabel={SSI_LABELS[strategy] ?? strategy}
        ticker={strategy}
        days={days}
        rebalance={rebalance}
        sourceLabel={sourceLabel}
        stale={stale}
        sync={formatSyncLabel(runsHook.lastFetchedAt, runsHook.loading)}
        status={status}
        error={error}
        onLoad={() => setHistoryModal("load")}
        onCompare={() => setHistoryModal("compare")}
        onRun={run}
      />

      <div
        className="grid"
        style={{
          gridTemplateColumns: "280px 1fr",
          gap: 16,
          alignItems: "start",
          marginTop: 16,
        }}
      >
        {/* LEFT RAIL */}
        <aside
          className="flex flex-col"
          style={{ gap: 12, position: "sticky", top: 64 }}
        >
          <RailCard title="Strategy" meta={`${props.tickers.length} SSI tickers`}>
            {strategyOptions.map((opt) => (
              <StrategyRow
                key={opt.ticker}
                label={opt.label}
                ticker={opt.ticker}
                on={opt.on}
                onClick={() => setStrategy(opt.ticker)}
              />
            ))}
          </RailCard>

          <RailCard title="Parameters">
            <ParamSegRow
              label="Period"
              options={PERIOD_OPTIONS.map((p) => `${p}d`)}
              activeIdx={PERIOD_OPTIONS.indexOf(days)}
              onSelect={(i) => setDays(PERIOD_OPTIONS[i])}
            />
            <ParamSegRow
              label="Rebalance"
              options={REBALANCE_OPTIONS.map((r) => `${r}d`)}
              activeIdx={REBALANCE_OPTIONS.indexOf(rebalance)}
              onSelect={(i) => setRebalance(REBALANCE_OPTIONS[i])}
            />
            <ParamRow label="Interval" value="1d · klines" />
            <ParamRow
              label="Constituents"
              value={
                usingResult && result?.n_assets
                  ? `${result.n_assets} live`
                  : "live · /constituents"
              }
            />
            <ParamRow label="Source" value="SoSoValue + agent" last />
          </RailCard>

          <RailCard title="Costs & risk">
            <CostInputRow
              label="Fee (bps)"
              value={feeBps}
              onChange={setFeeBps}
              suffix=""
              step={1}
              last={false}
            />
            <CostInputRow
              label="Slippage (bps)"
              value={slipBps}
              onChange={setSlipBps}
              suffix=""
              step={1}
            />
            <CostInputRow
              label="Position cap"
              value={posCapPct}
              onChange={setPosCapPct}
              suffix="%"
              step={1}
            />
            <CostInputRow
              label="Risk-free"
              value={rfPct}
              onChange={setRfPct}
              suffix="%"
              step={0.1}
            />
            <CostInputRow
              label="Init capital"
              value={initCapital}
              onChange={setInitCapital}
              suffix="$"
              prefix
              step={500}
              last
            />
          </RailCard>

          <RailCard title="Benchmarks (SSI)" meta={`${benchOn.filter(Boolean).length} active`}>
            {props.initialBenchmarks.map((b, i) => (
              <BenchRow
                key={b.label}
                color={benchmarkColors[i]}
                name={b.label}
                on={benchOn[i]}
                onChange={(next) =>
                  setBenchOn((prev) =>
                    prev.map((p, idx) => (idx === i ? next : p)),
                  )
                }
                last={i === props.initialBenchmarks.length - 1}
              />
            ))}
          </RailCard>
        </aside>

        {/* MAIN */}
        <main className="flex flex-col" style={{ gap: 14, minWidth: 0 }}>
          {/* KPI strip */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
            <KpiCard
              accent
              label={`Return · ${usingResult ? resultDays : props.initialDays}d`}
              value={pct(displayMetrics.return_total)}
              valueColor={
                displayMetrics.return_total >= 0 ? tokens.emerald : tokens.red
              }
              grade={gradeFor("return", displayMetrics.return_total)}
              sub={
                result?.vs_btc !== undefined
                  ? `vs BTC ${pct(result.vs_btc)}`
                  : undefined
              }
              subColor={
                result?.vs_btc !== undefined && result.vs_btc >= 0
                  ? tokens.emerald
                  : tokens.red
              }
            />
            <KpiCard
              label="Sharpe"
              value={Number.isFinite(displayMetrics.sharpe) ? displayMetrics.sharpe.toFixed(2) : "—"}
              grade={gradeFor("sharpe", displayMetrics.sharpe)}
              sub={
                rfPct > 0 ? `rf ${rfPct.toFixed(2)}%` : undefined
              }
            />
            <KpiCard
              label="Max DD"
              value={pct(displayMetrics.max_drawdown)}
              valueColor={tokens.red}
              grade={gradeFor("drawdown", displayMetrics.max_drawdown)}
              sub={
                ddSummary.recovery > 0
                  ? `${ddSummary.recovery}d underwater`
                  : undefined
              }
            />
            <KpiCard
              label="Win rate"
              value={`${(displayMetrics.win_rate * 100).toFixed(0)}%`}
              valueColor={
                displayMetrics.win_rate > 0.5 ? tokens.emerald : tokens.amber
              }
              grade={gradeFor("winrate", displayMetrics.win_rate)}
              sub={
                result?.n_returns
                  ? `${Math.round(result.n_returns * displayMetrics.win_rate)} / ${result.n_returns} days`
                  : undefined
              }
            />
            <KpiCard
              label="vs BTC"
              value={pct(result?.vs_btc ?? 0)}
              valueColor={
                (result?.vs_btc ?? 0) >= 0 ? tokens.emerald : tokens.red
              }
              grade={gradeFor("vsbtc", result?.vs_btc ?? 0)}
              sub={
                result?.btc_return !== undefined
                  ? `BTC ${pct(result.btc_return)}`
                  : undefined
              }
            />
            <KpiCard
              label="NAV"
              value={fmtUsd(navFinal)}
              valueColor={tokens.text}
              sub={
                result?.n_rebalances
                  ? `${result.n_rebalances} rebalances`
                  : undefined
              }
            />
          </div>

          {/* Equity card */}
          <Card pad={0}>
            <div style={{ padding: "14px 16px 0" }}>
              <div className="flex items-end justify-between" style={{ gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em" }}>
                    Equity curve · base 100
                  </div>
                  <Mono size={10.5} color={tokens.textFaint} style={{ marginTop: 2 }}>
                    {usingResult ? resultDays : props.initialDays}d · daily SSI klines · synthetic NAV
                  </Mono>
                </div>
                <div className="flex items-center" style={{ gap: 14, flexWrap: "wrap" }}>
                  <LegendItem
                    color={tokens.emerald}
                    label={usingResult ? (resultStrategy ?? strategy) : props.initialStrategy}
                    bold={pct(displayMetrics.return_total)}
                    boldColor={
                      displayMetrics.return_total >= 0 ? tokens.emerald : tokens.red
                    }
                  />
                  {props.initialBenchmarks.map((b, i) =>
                    benchOn[i] ? (
                      <LegendItem
                        key={b.label}
                        color={benchmarkColors[i]}
                        label={b.label}
                        bold={pct(b.series[b.series.length - 1] / 100 - 1)}
                      />
                    ) : null,
                  )}
                </div>
              </div>

              {/* Meta strip */}
              <div className="flex" style={{ gap: 24, marginTop: 12 }}>
                <MetaItem label="NAV" value={fmtUsd(navFinal)} valueColor={tokens.emerald} />
                <MetaItem
                  label="Δ today"
                  value={pct(deltaToday, 2)}
                  valueColor={deltaToday >= 0 ? tokens.emerald : tokens.red}
                />
                <MetaItem
                  label="Vol 30d"
                  value={`${(vol30d * 100).toFixed(1)}%`}
                  valueColor={tokens.text}
                />
                <MetaItem
                  label="Beta vs BTC"
                  value={betaVsBtc.toFixed(2)}
                  valueColor={tokens.text}
                />
              </div>
            </div>

            {/* Tabs row */}
            <div
              className="flex"
              style={{
                gap: 4,
                borderBottom: `1px solid ${tokens.border}`,
                padding: "0 16px",
                marginTop: 12,
              }}
            >
              <ChartTab
                label="Equity"
                on={equityTab === "equity"}
                onClick={() => setEquityTab("equity")}
              />
              <ChartTab
                label="Underwater"
                on={equityTab === "underwater"}
                onClick={() => setEquityTab("underwater")}
              />
              <div style={{ flex: 1 }} />
              <div className="flex items-center" style={{ gap: 6, padding: "6px 0" }}>
                <Seg
                  options={PERIOD_OPTIONS.map((p) => `${p}D`)}
                  activeIdx={PERIOD_OPTIONS.indexOf(days)}
                  onSelect={(i) => setDays(PERIOD_OPTIONS[i])}
                />
                <Btn small onClick={() => downloadEquityCsv(displayEquity)}>
                  ⤓ CSV
                </Btn>
              </div>
            </div>

            {/* Chart body */}
            {equityTab === "equity" ? (
              <EquitySvg
                strategy={displayEquity}
                strategyColor={tokens.emerald}
                benchmarks={props.initialBenchmarks
                  .map((b, i) => ({ data: b.series, color: benchmarkColors[i] }))
                  .filter((_, i) => benchOn[i])}
                overlays={compareOverlays.map((o, i) => ({
                  data: o.series,
                  color: overlayColors[i % overlayColors.length],
                  label: o.label,
                }))}
                ddRange={ddRange}
                rebalances={result?.n_rebalances ?? null}
              />
            ) : (
              <UnderwaterSvg dd={ddSeries} />
            )}
          </Card>

          {/* Analytics 3-up */}
          <div
            className="grid"
            style={{ gridTemplateColumns: "1.4fr 1fr 1fr", gap: 14 }}
          >
            <AnalyticCard
              title={`Drawdown distribution · ${usingResult ? resultDays : props.initialDays}d`}
              sub={`${ddSeries.length} buckets`}
            >
              <svg
                width="100%"
                height={150}
                viewBox={`0 0 ${ddBuckets * 24} 150`}
                preserveAspectRatio="none"
              >
                {[40, 80, 120].map((y) => (
                  <line
                    key={y}
                    x1={0}
                    x2={ddBuckets * 24}
                    y1={y}
                    y2={y}
                    stroke={tokens.border}
                    strokeWidth={0.5}
                  />
                ))}
                {bucketHeights.map((h: number, i: number) => {
                  const norm = (h / maxBucketH) * 130;
                  // Left = worst loss, right = at peak. Color reflects severity.
                  const fill =
                    i < 4
                      ? tokens.red
                      : i < 9
                        ? tokens.amber
                        : tokens.emerald;
                  return (
                    <rect
                      key={i}
                      x={i * 24 + 3}
                      y={140 - Math.max(2, norm)}
                      width={18}
                      height={Math.max(2, norm)}
                      rx={2}
                      fill={fill}
                    />
                  );
                })}
                <text
                  x={12}
                  y={148}
                  fill={tokens.textFaint}
                  fontSize={9}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {pct(minDd)}
                </text>
                <text
                  x={ddBuckets * 24 - 6}
                  y={148}
                  fill={tokens.textFaint}
                  fontSize={9}
                  fontFamily="JetBrains Mono, monospace"
                  textAnchor="end"
                >
                  0%
                </text>
              </svg>
              <div
                className="grid"
                style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}
              >
                <DdStat label="Max DD" value={pct(ddSummary.max)} color={tokens.red} />
                <DdStat label="Avg DD" value={pct(ddSummary.avg)} color={tokens.amber} />
                <DdStat
                  label="Underwater"
                  value={`${ddSummary.recovery}d`}
                  color={tokens.emerald}
                />
              </div>
            </AnalyticCard>

            <AnalyticCard title="Volatility · day × hour (UTC)" sub="σ × 1000">
              <HeatmapGrid heatmap={heatmap} heatMax={heatMax} />
              <div
                className="flex items-center"
                style={{
                  marginTop: 8,
                  gap: 6,
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 10,
                  color: tokens.textFaint,
                }}
              >
                <span>low</span>
                <div style={{ display: "flex", gap: 1 }}>
                  {[0.05, 0.18, 0.34, 0.55, 0.78].map((a) => (
                    <span
                      key={a}
                      style={{
                        width: 10,
                        height: 10,
                        background: `rgba(16,185,129,${a})`,
                        borderRadius: 1,
                      }}
                    />
                  ))}
                </div>
                <span>high</span>
                <span style={{ marginLeft: "auto" }}>
                  peak:{" "}
                  <b style={{ color: tokens.rose }}>
                    {heatPeak.day} {String(heatPeak.hour).padStart(2, "0")}:00
                  </b>
                </span>
              </div>
            </AnalyticCard>

            <AnalyticCard
              title="Constituents & weights"
              sub={
                weightsView.length > 0
                  ? `live · ${weightsView.length}`
                  : "run to populate"
              }
            >
              {weightsView.length === 0 ? (
                <div
                  style={{
                    padding: "26px 0",
                    textAlign: "center",
                    color: tokens.textFaint,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 11,
                  }}
                >
                  No weights yet — run the backtest to populate.
                </div>
              ) : (
                weightsView.map((w, i) => (
                  <WeightRow
                    key={w.symbol}
                    symbol={w.symbol}
                    weight={w.weight}
                    maxWeight={weightsView[0].weight}
                    last={i === weightsView.length - 1}
                  />
                ))
              )}
            </AnalyticCard>
          </div>

          {/* Footer actions */}
          <div
            className="flex justify-end items-center"
            style={{
              gap: 8,
              padding: "12px 0 0",
              flexWrap: "wrap",
            }}
          >
            {saveStatus === "saved" && savedRunId ? (
              <Mono size={10} color={tokens.emerald}>
                ✓ saved
              </Mono>
            ) : null}
            {saveStatus === "saving" ? (
              <Mono size={10} color={tokens.amber}>
                saving…
              </Mono>
            ) : null}
            {saveStatus === "error" && saveErr ? (
              <Mono size={10} color={tokens.red}>
                ⚠ {saveErr}
              </Mono>
            ) : null}
            {shareStatus === "creating" ? (
              <Mono size={10} color={tokens.amber}>
                creating link…
              </Mono>
            ) : null}
            {shareStatus === "ready" && shareUrl ? (
              <Mono size={10} color={tokens.emerald}>
                ✓ link copied · {shareUrl}
              </Mono>
            ) : null}
            {shareStatus === "error" && shareErr ? (
              <Mono size={10} color={tokens.red}>
                ⚠ {shareErr}
              </Mono>
            ) : null}
            <Btn
              small
              onClick={handleSave}
              disabled={
                !result || status !== "ok" || saveStatus === "saving" || saveStatus === "saved"
              }
              style={
                !result || status !== "ok" || saveStatus === "saving" || saveStatus === "saved"
                  ? { opacity: 0.4, cursor: "not-allowed" }
                  : undefined
              }
            >
              ⌂ Save as preset
            </Btn>
            <Btn
              small
              onClick={handleShare}
              disabled={!savedRunId || shareStatus === "creating"}
              style={
                !savedRunId || shareStatus === "creating"
                  ? { opacity: 0.4, cursor: "not-allowed" }
                  : undefined
              }
            >
              ⇪ Share
            </Btn>
            <Btn small disabled style={{ opacity: 0.4, cursor: "not-allowed" }}>
              ⤓ Export PDF
            </Btn>
            <Btn small primary disabled style={{ opacity: 0.4, cursor: "not-allowed" }}>
              ▶ Publish to SSI →
            </Btn>
          </div>
        </main>
      </div>

      {historyModal !== null ? (
        <RunHistoryModal
          mode={historyModal === "load" ? "single" : "multi"}
          maxSelections={3}
          onCancel={() => setHistoryModal(null)}
          onConfirm={
            historyModal === "load" ? handleLoadConfirm : handleCompareConfirm
          }
          initialRuns={runsHook.data}
        />
      ) : null}
    </div>
  );
}

// ----------------------------- Helper UI -----------------------------

function PageHeader({
  strategyLabel,
  ticker,
  days,
  rebalance,
  sourceLabel,
  stale,
  sync,
  status,
  error,
  onLoad,
  onCompare,
  onRun,
}: {
  strategyLabel: string;
  ticker: string;
  days: Period;
  rebalance: Rebalance;
  sourceLabel: string;
  stale: boolean;
  sync: string;
  status: Status;
  error: string | null;
  onLoad: () => void;
  onCompare: () => void;
  onRun: () => void;
}) {
  return (
    <header
      className="flex items-end justify-between"
      style={{ gap: 12, flexWrap: "wrap" }}
    >
      <div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: tokens.text,
          }}
        >
          Backtesting Lab
        </h1>
        <div
          className="flex items-center"
          style={{ gap: 16, flexWrap: "wrap", marginTop: 4 }}
        >
          <MetaPill label="Strategy" value={strategyLabel} />
          <MetaPill label="Ticker" value={ticker} />
          <MetaPill label="Period" value={`${days}d`} />
          <MetaPill label="Rebalance" value={`${rebalance}d`} />
          <MetaPill label="Bars" value="SSI klines · 1d" />
          <MetaPill
            label="Source"
            value={sourceLabel}
            color={stale ? tokens.amber : undefined}
          />
          <Mono size={10} color={tokens.textFaint}>
            {sync}
          </Mono>
        </div>
      </div>
      <div className="flex items-center" style={{ gap: 8 }}>
        {status === "error" && error ? (
          <Mono size={10} color={tokens.red}>
            ⚠ {error}
          </Mono>
        ) : null}
        {status === "running" ? (
          <Mono size={10} color={tokens.amber}>
            ⏳ running…
          </Mono>
        ) : stale ? (
          <Mono size={10} color={tokens.amber}>
            selection changed — click Run
          </Mono>
        ) : null}
        <Btn small onClick={onLoad}>
          ⤓ Load strategy
        </Btn>
        <Btn small onClick={onCompare}>
          ⇄ Compare runs
        </Btn>
        <Btn small primary onClick={onRun} disabled={status === "running"}>
          {status === "running" ? "⏳ Running…" : "▶ Run backtest"}
        </Btn>
      </div>
    </header>
  );
}

function MetaPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center" style={{ gap: 5 }}>
      <span
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: tokens.textFaint,
        }}
      >
        {label}
      </span>
      <b
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11.5,
          fontWeight: 600,
          color: color ?? tokens.text,
        }}
      >
        {value}
      </b>
    </div>
  );
}

function RailCard({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <Card pad={0}>
      <div
        className="flex items-center justify-between"
        style={{
          padding: "11px 14px",
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.005em" }}>
          {title}
        </div>
        {meta ? (
          <Mono size={10} color={tokens.textFaint}>
            {meta}
          </Mono>
        ) : null}
      </div>
      <div style={{ padding: "8px 12px" }}>{children}</div>
    </Card>
  );
}

function StrategyRow({
  label,
  ticker,
  on,
  onClick,
}: {
  label: string;
  ticker: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "9px 10px",
        marginBottom: 5,
        borderRadius: 7,
        border: `1px solid ${on ? "rgba(16,185,129,0.4)" : tokens.border}`,
        background: on
          ? "linear-gradient(180deg, rgba(16,185,129,0.08), transparent)"
          : tokens.bgElev2,
        cursor: "pointer",
        textAlign: "left",
        transition: "all .12s",
      }}
    >
      <div
        style={{
          width: 13,
          height: 13,
          borderRadius: "50%",
          border: `1.5px solid ${on ? tokens.emerald : tokens.borderStrong}`,
          flex: "none",
          display: "grid",
          placeItems: "center",
        }}
      >
        {on ? (
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: tokens.emerald,
              boxShadow: `0 0 6px ${tokens.emerald}`,
            }}
          />
        ) : null}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: tokens.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        <Mono size={10} color={tokens.textFaint} style={{ marginTop: 1 }}>
          {ticker}
        </Mono>
      </div>
    </button>
  );
}

function ParamRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: "8px 0",
        borderBottom: last ? "none" : `1px solid ${tokens.border}`,
      }}
    >
      <span style={{ fontSize: 12, color: tokens.textDim }}>{label}</span>
      <Mono size={11} color={tokens.text}>
        {value}
      </Mono>
    </div>
  );
}

function ParamSegRow({
  label,
  options,
  activeIdx,
  onSelect,
}: {
  label: string;
  options: string[];
  activeIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: "7px 0", borderBottom: `1px solid ${tokens.border}` }}
    >
      <span style={{ fontSize: 12, color: tokens.textDim }}>{label}</span>
      <Seg options={options} activeIdx={activeIdx} onSelect={onSelect} />
    </div>
  );
}

function Seg({
  options,
  activeIdx,
  onSelect,
}: {
  options: string[];
  activeIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((opt, i) => {
        const on = i === activeIdx;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(i)}
            style={{
              background: on ? tokens.bg : "transparent",
              color: on ? tokens.text : tokens.textDim,
              border: 0,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10.5,
              padding: "3px 8px",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: on ? 600 : 400,
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function CostInputRow({
  label,
  value,
  onChange,
  suffix,
  prefix,
  step = 1,
  last,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  suffix?: string;
  prefix?: boolean;
  step?: number;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: "8px 0",
        borderBottom: last ? "none" : `1px solid ${tokens.border}`,
        gap: 10,
      }}
    >
      <span style={{ fontSize: 12, color: tokens.textDim }}>{label}</span>
      <div
        className="flex items-center"
        style={{
          background: tokens.bgElev2,
          border: `1px solid ${tokens.border}`,
          borderRadius: 5,
          padding: "3px 8px",
          gap: 4,
        }}
      >
        {prefix && suffix ? (
          <Mono size={10.5} color={tokens.textFaint}>
            {suffix}
          </Mono>
        ) : null}
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          style={{
            width: 64,
            background: "transparent",
            border: 0,
            color: tokens.text,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            textAlign: "right",
            outline: 0,
          }}
        />
        {!prefix && suffix ? (
          <Mono size={10.5} color={tokens.textFaint}>
            {suffix}
          </Mono>
        ) : null}
      </div>
    </div>
  );
}

function BenchRow({
  color,
  name,
  on,
  onChange,
  last,
}: {
  color: string;
  name: string;
  on: boolean;
  onChange: (next: boolean) => void;
  last?: boolean;
}) {
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "14px 1fr auto",
        gap: 10,
        padding: "8px 0",
        borderBottom: last ? "none" : `1px solid ${tokens.border}`,
      }}
    >
      <span
        style={{
          width: 14,
          height: 3,
          borderRadius: 2,
          background: color,
          display: "inline-block",
        }}
      />
      <Mono size={11.5} color={tokens.text}>
        {name}
      </Mono>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  valueColor,
  grade,
  sub,
  subColor,
  accent,
}: {
  label: string;
  value: string;
  valueColor?: string;
  grade?: Grade;
  sub?: string;
  subColor?: string;
  accent?: boolean;
}) {
  const gc = grade ? gradeColor(grade) : null;
  return (
    <div
      style={{
        position: "relative",
        background: accent
          ? "linear-gradient(180deg, rgba(16,185,129,0.05), transparent)"
          : tokens.bgElev,
        border: `1px solid ${accent ? "rgba(16,185,129,0.3)" : tokens.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        overflow: "hidden",
      }}
    >
      {grade && gc ? (
        <span
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 9.5,
            letterSpacing: "0.12em",
            padding: "2px 6px",
            borderRadius: 3,
            background: gc.bg,
            color: gc.fg,
            border: `1px solid ${gc.border}`,
          }}
        >
          {grade}
        </span>
      ) : null}
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9.5,
          letterSpacing: "0.16em",
          color: tokens.textFaint,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          marginTop: 6,
          color: valueColor ?? tokens.text,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 10,
            color: subColor ?? tokens.textDim,
            marginTop: 3,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function LegendItem({
  color,
  label,
  bold,
  boldColor,
}: {
  color: string;
  label: string;
  bold?: string;
  boldColor?: string;
}) {
  return (
    <div className="flex items-center" style={{ gap: 6 }}>
      <span
        style={{ width: 14, height: 3, borderRadius: 2, background: color }}
      />
      <Mono size={11} color={tokens.textDim}>
        {label}
      </Mono>
      {bold ? (
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            fontWeight: 600,
            color: boldColor ?? tokens.text,
          }}
        >
          {bold}
        </span>
      ) : null}
    </div>
  );
}

function MetaItem({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9.5,
          letterSpacing: "0.16em",
          color: tokens.textFaint,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 18,
          fontWeight: 700,
          color: valueColor ?? tokens.text,
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ChartTab({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 12px",
        background: "transparent",
        border: 0,
        color: on ? tokens.text : tokens.textDim,
        borderBottom: `2px solid ${on ? tokens.emerald : "transparent"}`,
        marginBottom: -1,
        fontSize: 12,
        fontFamily: "inherit",
        cursor: "pointer",
        fontWeight: on ? 600 : 500,
      }}
    >
      {label}
    </button>
  );
}

function EquitySvg({
  strategy,
  strategyColor,
  benchmarks,
  overlays,
  ddRange,
  rebalances,
}: {
  strategy: number[];
  strategyColor: string;
  benchmarks: Array<{ data: number[]; color: string }>;
  overlays: Array<{ data: number[]; color: string; label: string }>;
  ddRange: { startIdx: number; endIdx: number; depth: number };
  rebalances: number | null;
}) {
  const W = 1200;
  const H = 320;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 28;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const all = [
    ...strategy,
    ...benchmarks.flatMap((b) => b.data),
    ...overlays.flatMap((o) => o.data),
  ];
  if (all.length === 0 || strategy.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 340, display: "block", padding: "6px 16px 16px" }} />
    );
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const rng = max - min || 1;

  const xAt = (i: number, len: number) =>
    padL + (len > 1 ? (i / (len - 1)) * iw : iw / 2);
  const yAt = (v: number) => padT + ih - ((v - min) / rng) * ih;

  const path = (data: number[]) =>
    data
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i, data.length).toFixed(1)} ${yAt(v).toFixed(1)}`)
      .join(" ");

  // Drawdown shading: from peak idx → trough idx of strategy curve.
  const ddX1 =
    ddRange.depth < 0 ? xAt(ddRange.startIdx, strategy.length) : null;
  const ddX2 =
    ddRange.depth < 0 ? xAt(ddRange.endIdx, strategy.length) : null;

  // Evenly distributed rebalance markers along the strategy curve.
  const markers: number[] = [];
  if (rebalances && rebalances > 0 && strategy.length > 1) {
    for (let m = 1; m <= Math.min(rebalances, 10); m++) {
      const idx = Math.round(((strategy.length - 1) * m) / (rebalances + 1));
      markers.push(idx);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 340, display: "block", padding: "6px 16px 16px" }}
    >
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strategyColor} stopOpacity={0.32} />
          <stop offset="100%" stopColor={strategyColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {[0.25, 0.5, 0.75, 1].map((f, i) => {
        const y = padT + ih * f;
        const v = max - rng * f;
        return (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y}
              y2={y}
              stroke={tokens.border}
              strokeWidth={0.5}
            />
            <text
              x={padL - 6}
              y={y + 3}
              fill={tokens.textFaint}
              fontSize={10}
              fontFamily="JetBrains Mono, monospace"
              textAnchor="end"
            >
              {v.toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Drawdown shaded zone */}
      {ddX1 !== null && ddX2 !== null && ddX2 > ddX1 ? (
        <>
          <rect
            x={ddX1}
            y={padT}
            width={ddX2 - ddX1}
            height={ih}
            fill="rgba(244,63,94,0.05)"
          />
          <text
            x={ddX1 + 6}
            y={padT + 14}
            fill={tokens.rose}
            fontSize={10}
            fontFamily="JetBrains Mono, monospace"
          >
            DD {pct(ddRange.depth)}
          </text>
        </>
      ) : null}

      {/* Benchmarks */}
      {benchmarks.map((b, i) => (
        <path
          key={i}
          d={path(b.data)}
          fill="none"
          stroke={b.color}
          strokeWidth={1.4}
          opacity={0.55}
        />
      ))}
      {/* Overlays */}
      {overlays.map((o, i) => (
        <path
          key={i}
          d={path(o.data)}
          fill="none"
          stroke={o.color}
          strokeWidth={1.4}
          strokeDasharray="4 3"
          opacity={0.85}
        />
      ))}
      {/* Strategy fill */}
      <path
        d={`${path(strategy)} L ${xAt(strategy.length - 1, strategy.length)} ${padT + ih} L ${padL} ${padT + ih} Z`}
        fill="url(#eqfill)"
      />
      {/* Strategy line */}
      <path
        d={path(strategy)}
        fill="none"
        stroke={strategyColor}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* Rebalance markers */}
      {markers.map((idx) => (
        <circle
          key={idx}
          cx={xAt(idx, strategy.length)}
          cy={yAt(strategy[idx])}
          r={3.5}
          fill={tokens.bgElev}
          stroke={strategyColor}
          strokeWidth={1.5}
        />
      ))}
      {/* Cursor at last point */}
      <line
        x1={xAt(strategy.length - 1, strategy.length)}
        x2={xAt(strategy.length - 1, strategy.length)}
        y1={padT}
        y2={padT + ih}
        stroke={tokens.borderStrong}
        strokeDasharray="2 3"
        strokeWidth={0.5}
      />
      <circle
        cx={xAt(strategy.length - 1, strategy.length)}
        cy={yAt(strategy[strategy.length - 1])}
        r={5}
        fill={strategyColor}
        stroke={tokens.bgElev}
        strokeWidth={2}
      />

      {/* X-axis ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const x = padL + iw * f;
        const idx = Math.round((strategy.length - 1) * f);
        const lbl =
          f === 1 ? "now" : `−${strategy.length - 1 - idx}d`;
        return (
          <text
            key={i}
            x={x}
            y={H - 8}
            fill={tokens.textFaint}
            fontSize={10}
            fontFamily="JetBrains Mono, monospace"
            textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
          >
            {lbl}
          </text>
        );
      })}
    </svg>
  );
}

function UnderwaterSvg({ dd }: { dd: number[] }) {
  const W = 1200;
  const H = 260;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  if (dd.length === 0) {
    return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 280, display: "block", padding: "6px 16px 16px" }} />;
  }
  const min = Math.min(...dd, -0.001);
  const xAt = (i: number) => padL + (dd.length > 1 ? (i / (dd.length - 1)) * iw : iw / 2);
  const yAt = (v: number) => padT + (v / min) * ih;
  const path =
    `M ${padL} ${padT} ` +
    dd.map((v, i) => `L ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ") +
    ` L ${xAt(dd.length - 1).toFixed(1)} ${padT} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 280, display: "block", padding: "6px 16px 16px" }}
    >
      {[0.25, 0.5, 0.75, 1].map((f, i) => {
        const y = padT + ih * f;
        const v = min * f;
        return (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y}
              y2={y}
              stroke={tokens.border}
              strokeWidth={0.5}
            />
            <text
              x={padL - 6}
              y={y + 3}
              fill={tokens.textFaint}
              fontSize={10}
              fontFamily="JetBrains Mono, monospace"
              textAnchor="end"
            >
              {pct(v, 0)}
            </text>
          </g>
        );
      })}
      <path d={path} fill="rgba(244,63,94,0.18)" />
      <path
        d={
          `M ${padL} ${padT} ` +
          dd.map((v, i) => `L ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ")
        }
        fill="none"
        stroke={tokens.rose}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function AnalyticCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <Card pad={0}>
      <div
        className="flex items-center justify-between"
        style={{
          padding: "11px 14px",
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        {sub ? (
          <Mono size={10} color={tokens.textFaint}>
            {sub}
          </Mono>
        ) : null}
      </div>
      <div style={{ padding: "10px 14px 14px" }}>{children}</div>
    </Card>
  );
}

function DdStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9,
          letterSpacing: "0.14em",
          color: tokens.textFaint,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 13,
          fontWeight: 600,
          color,
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function HeatmapGrid({
  heatmap,
  heatMax,
}: {
  heatmap: number[];
  heatMax: number;
}) {
  // Render rows = days (Sun..Sat) × 24 hours. Use grid for alignment.
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div>
      {/* Hour header */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "28px repeat(24, 1fr)",
          gap: 2,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 8.5,
          color: tokens.textFaint,
        }}
      >
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span
            key={h}
            style={{
              textAlign: "center",
              padding: "1px 0",
              opacity: h % 2 === 0 ? 1 : 0,
            }}
          >
            {h}
          </span>
        ))}
      </div>
      {days.map((d, r) => (
        <div
          key={d}
          className="grid"
          style={{
            gridTemplateColumns: "28px repeat(24, 1fr)",
            gap: 2,
            marginTop: 2,
          }}
        >
          <span
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 9,
              color: tokens.textFaint,
              textAlign: "right",
              padding: "0 4px",
              alignSelf: "center",
            }}
          >
            {d}
          </span>
          {Array.from({ length: 24 }, (_, h) => {
            const v = heatmap[r * 24 + h] ?? 0;
            const a = 0.05 + (v / heatMax) * 0.85;
            return (
              <span
                key={h}
                title={`${d} ${String(h).padStart(2, "0")}:00`}
                style={{
                  aspectRatio: "1 / 1",
                  background: `rgba(16,185,129,${a.toFixed(3)})`,
                  borderRadius: 2,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeightRow({
  symbol,
  weight,
  maxWeight,
  last,
}: {
  symbol: string;
  weight: number;
  maxWeight: number;
  last?: boolean;
}) {
  const pctOfMax = maxWeight > 0 ? (weight / maxWeight) * 100 : 0;
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "26px 1fr 70px",
        gap: 10,
        padding: "8px 0",
        borderBottom: last ? "none" : `1px solid ${tokens.border}`,
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: tokens.bgElev2,
          border: `1px solid ${tokens.border}`,
          display: "grid",
          placeItems: "center",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 8.5,
          color: tokens.textDim,
          fontWeight: 600,
          textTransform: "uppercase",
        }}
      >
        {symbol.slice(0, 3)}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>
          {symbol.toUpperCase()}
        </div>
        <div
          style={{
            height: 4,
            background: tokens.bgElev2,
            borderRadius: 2,
            overflow: "hidden",
            border: `1px solid ${tokens.border}`,
            marginTop: 4,
          }}
        >
          <div
            style={{
              width: `${pctOfMax}%`,
              height: "100%",
              background: tokens.emerald,
            }}
          />
        </div>
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11.5,
          fontWeight: 600,
          textAlign: "right",
          color: tokens.text,
        }}
      >
        {(weight * 100).toFixed(1)}%
      </div>
    </div>
  );
}

function downloadEquityCsv(equity: number[]) {
  if (equity.length === 0) return;
  const header = "i,equity\n";
  const rows = equity.map((v, i) => `${i},${v.toFixed(4)}`).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backtest-equity-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
