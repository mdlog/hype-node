import {
  getSsiConstituents,
  getSsiSnapshot,
  getSsiKlines,
} from "@/lib/api/sosovalue";
import { closesFromKlines, computeMetrics } from "@/lib/metrics";
import { PortfolioClient, type ReferenceData } from "./PortfolioClient";

// Hybrid portfolio: real wallet data on top (SSI Registry + SoDEX
// balances), SSI DePIN reference benchmark on bottom for sections we don't
// have user-historical data for yet (NAV chart, sharpe/vol/drawdown over
// time, win rate). Clearly labeled "synthetic / reference" so the user
// knows what's their data vs the demo benchmark.
//
// Rationale: the previous "real-only" version showed empty states for any
// missing piece — visually thin and confusing. The previous "all-ssiDePIN"
// version misrepresented reference data as the user's portfolio. This
// hybrid keeps the rich visual + adds an honest label.

export const dynamic = "force-dynamic";
export const revalidate = 60;

const REFERENCE_TICKER = "ssiDePIN";

export default async function PortfolioPage() {
  // Fetch the reference benchmark server-side so the client component can
  // render it instantly. Cached 60s by Next.js + module-level by the
  // SoSoValue request helper, so cost is bounded.
  const [constituents, snapshot, klines] = await Promise.all([
    getSsiConstituents(REFERENCE_TICKER),
    getSsiSnapshot(REFERENCE_TICKER),
    getSsiKlines(REFERENCE_TICKER, { limit: 90 }),
  ]);
  const closes = closesFromKlines(klines);
  const metrics = computeMetrics(closes);

  const reference: ReferenceData = {
    ticker: REFERENCE_TICKER,
    constituents: constituents.map((c) => ({
      symbol: c.symbol,
      weight: c.weight,
    })),
    snapshot: {
      price: snapshot.price ?? 0,
      change_pct_24h: snapshot.change_pct_24h ?? 0,
      roi_7d: snapshot.roi_7d ?? 0,
      roi_1m: snapshot.roi_1m ?? 0,
      roi_3m: snapshot.roi_3m ?? 0,
      roi_1y: snapshot.roi_1y ?? 0,
      ytd: snapshot.ytd ?? 0,
    },
    closes,
    metrics: {
      return_total: metrics.return_total,
      sharpe: metrics.sharpe,
      volatility: metrics.volatility,
      max_drawdown: metrics.max_drawdown,
      win_rate: metrics.win_rate,
    },
  };

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <PortfolioClient reference={reference} />
    </div>
  );
}
