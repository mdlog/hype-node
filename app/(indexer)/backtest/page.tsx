import {
  listSsiTickers,
  getSsiKlines,
  getCurrencyKlines,
  CURRENCY_ID,
} from "@/lib/api/sosovalue";
import { closesFromKlines, computeMetrics } from "@/lib/metrics";

import { BacktestClient } from "./BacktestClient";

export const revalidate = 60;

const STRATEGY = "ssiDePIN";
const SSI_BENCHMARKS = ["ssiMAG7", "ssiLayer1"] as const;
const INITIAL_DAYS = 90 as const;

function normalize(closes: number[]): number[] {
  if (closes.length === 0 || closes[0] === 0) return closes;
  return closes.map((c) => (c / closes[0]) * 100);
}

export default async function BacktestPage() {
  const tickers = await listSsiTickers();
  const [strategyKlines, ssiMag7Klines, ssiL1Klines, btcKlines] = await Promise.all([
    getSsiKlines(STRATEGY, { limit: INITIAL_DAYS }),
    getSsiKlines(SSI_BENCHMARKS[0], { limit: INITIAL_DAYS }),
    getSsiKlines(SSI_BENCHMARKS[1], { limit: INITIAL_DAYS }),
    getCurrencyKlines(CURRENCY_ID.btc, { limit: INITIAL_DAYS }),
  ]);

  const strategyCloses = closesFromKlines(strategyKlines);
  const initialMetrics = computeMetrics(strategyCloses);
  const initialEquity = normalize(strategyCloses);

  const initialBenchmarks = [
    { label: "ssiMAG7", name: "SSI MAG7", series: normalize(closesFromKlines(ssiMag7Klines)) },
    { label: "ssiLayer1", name: "SSI Layer 1", series: normalize(closesFromKlines(ssiL1Klines)) },
    { label: "BTC", name: "Bitcoin (currency)", series: normalize(btcKlines.map((k) => k.close)) },
  ];

  // Pre-compute drawdown distribution + day×hour heatmap server-side. Re-run
  // happens client-side only when the strategy curve changes (new backtest
  // result); benchmarks/heatmap stay anchored to the initial 90d server pull.
  const initialDdSeries: number[] = [];
  let peak = strategyCloses[0] ?? 0;
  for (const c of strategyCloses) {
    if (c > peak) peak = c;
    initialDdSeries.push(peak > 0 ? (c - peak) / peak : 0);
  }

  const initialHeatmap: number[] = new Array(7 * 24).fill(0);
  for (let i = 1; i < strategyCloses.length; i++) {
    const r = Math.abs(
      Math.log((strategyCloses[i] || 1) / (strategyCloses[i - 1] || 1)),
    );
    const ts = strategyKlines[i]?.timestamp ?? Date.now();
    const dow = new Date(ts).getUTCDay();
    const hour = new Date(ts).getUTCHours();
    initialHeatmap[dow * 24 + hour] += r;
  }

  return (
    <BacktestClient
      tickers={tickers}
      initialStrategy={STRATEGY}
      initialDays={INITIAL_DAYS}
      initialMetrics={initialMetrics}
      initialEquity={initialEquity}
      initialBenchmarks={initialBenchmarks}
      initialDdSeries={initialDdSeries}
      initialHeatmap={initialHeatmap}
    />
  );
}
