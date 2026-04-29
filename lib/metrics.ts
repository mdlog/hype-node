// Metrics derived from SSI klines (or any close-price series).
// Everything here is pure math — keep zero dependencies so server components
// can import freely without bloating the client bundle.

import type { SsiKline } from "@/lib/api/sosovalue";

export type Metrics = {
  return_total: number;       // (last - first) / first
  return_annual: number;       // annualized log return
  volatility: number;          // annualized stdev of log returns
  sharpe: number;              // (return_annual) / volatility, rf=0
  sortino: number;             // sharpe variant using downside-only stdev
  max_drawdown: number;        // negative number, e.g. -0.081
  win_rate: number;            // fraction of positive return days
  trades: number;              // count of return periods (= klines.length - 1)
  top_asset_weight: number;    // helper, set externally
};

const DAYS_PER_YEAR = 365;

export function computeMetrics(closes: number[]): Metrics {
  if (closes.length < 2) {
    return zeroMetrics();
  }
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      rets.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  const n = rets.length;
  if (n === 0) return zeroMetrics();

  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const sigma = Math.sqrt(variance);
  const sigmaAnnual = sigma * Math.sqrt(DAYS_PER_YEAR);
  const returnAnnual = mean * DAYS_PER_YEAR;
  const sharpe = sigmaAnnual > 1e-9 ? returnAnnual / sigmaAnnual : 0;

  const downside = rets.filter((r) => r < 0);
  const downSigma =
    downside.length > 1
      ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / (downside.length - 1)) *
        Math.sqrt(DAYS_PER_YEAR)
      : 0;
  const sortino = downSigma > 1e-9 ? returnAnnual / downSigma : 0;

  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }

  const winRate = rets.filter((r) => r > 0).length / n;

  return {
    return_total: (closes[closes.length - 1] - closes[0]) / closes[0],
    return_annual: returnAnnual,
    volatility: sigmaAnnual,
    sharpe,
    sortino,
    max_drawdown: maxDd,
    win_rate: winRate,
    trades: n,
    top_asset_weight: 0,
  };
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ar = logReturns(a.slice(-n));
  const br = logReturns(b.slice(-n));
  if (ar.length === 0 || br.length === 0) return 0;
  const ma = ar.reduce((x, y) => x + y, 0) / ar.length;
  const mb = br.reduce((x, y) => x + y, 0) / br.length;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < ar.length; i++) {
    const x = ar[i] - ma;
    const y = br[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

export function closesFromKlines(klines: SsiKline[]): number[] {
  return klines.map((k) => k.close);
}

function zeroMetrics(): Metrics {
  return {
    return_total: 0,
    return_annual: 0,
    volatility: 0,
    sharpe: 0,
    sortino: 0,
    max_drawdown: 0,
    win_rate: 0,
    trades: 0,
    top_asset_weight: 0,
  };
}
