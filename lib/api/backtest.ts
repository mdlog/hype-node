import { fakeSeries } from "@/lib/fake-data";

export type BacktestRequest = {
  strategyId: string;
  days: number;
  rebalanceHours: number;
  nAssets: number;
  minSentiment?: number;
  slippageBps?: number;
};

export type BacktestResult = {
  strategyId: string;
  return: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  equity: number[];
  benchmarks: { label: string; equity: number[] }[];
};

export async function runBacktest(req: BacktestRequest): Promise<BacktestResult> {
  // Plug in agent-service `/backtest` once Python harness is wired.
  return {
    strategyId: req.strategyId,
    return: 0.341,
    sharpe: 1.82,
    sortino: 2.41,
    maxDrawdown: -0.081,
    winRate: 0.61,
    trades: 142,
    equity: fakeSeries(60, 100, 0.025, 1).map((v, i) => v + i * 0.6),
    benchmarks: [
      { label: "BTC", equity: fakeSeries(60, 100, 0.03, 9).map((v, i) => v + i * 0.3) },
      { label: "ETH", equity: fakeSeries(60, 100, 0.035, 7).map((v, i) => v + i * 0.2) },
      { label: "Sector", equity: fakeSeries(60, 100, 0.02, 11).map((v, i) => v + i * 0.15) },
    ],
  };
}
