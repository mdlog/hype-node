import Link from "next/link";
import { Card, Label, Metric, Mono, Tag, Btn, Spark, LineChart } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  getSectorScores,
  listSsiTickers,
  getSsiSnapshot,
  getSsiKlines,
  getSsiConstituents,
  getNews,
  type SsiSnapshot,
} from "@/lib/api/sosovalue";
import { DataSourceBanner } from "@/components/live/DataSourceBanner";

export const revalidate = 60;

// Default focused ticker. Can be overridden via ?featured=ssiAI etc — the
// chip strip below the KPI row swaps the URL on click.
const DEFAULT_FEATURED = "ssiDePIN";

const SSI_DISPLAY: Record<string, { name: string; symbol: string; tag: string }> = {
  ssiDePIN: { name: "DePIN Index", symbol: "DEPIN", tag: "DePIN" },
  ssiRWA: { name: "RWA Index", symbol: "RWA", tag: "RWA" },
  ssiAI: { name: "AI Index", symbol: "AI", tag: "AI" },
  ssiMeme: { name: "Meme Index", symbol: "MEME", tag: "Meme" },
  ssiGameFi: { name: "GameFi Index", symbol: "GFI", tag: "Gaming" },
  ssiLayer1: { name: "Layer 1 Majors", symbol: "L1", tag: "L1" },
  ssiLayer2: { name: "Layer 2 Index", symbol: "L2", tag: "L2" },
  ssiMAG7: { name: "Crypto MAG7", symbol: "MAG7", tag: "Macro" },
  ssiPayFi: { name: "PayFi Index", symbol: "PAYFI", tag: "PayFi" },
  ssiDeFi: { name: "DeFi Index", symbol: "DEFI", tag: "DeFi" },
  ssiSocialFi: { name: "SocialFi Index", symbol: "SOC", tag: "SocialFi" },
  ssiCeFi: { name: "CeFi Index", symbol: "CEFI", tag: "CeFi" },
  ssiNFT: { name: "NFT Index", symbol: "NFT", tag: "NFT" },
};

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function sectorColor(score: number): string {
  if (score >= 75) return tokens.emerald;
  if (score >= 60) return tokens.amber;
  if (score >= 40) return tokens.textDim;
  return tokens.red;
}

function fmtRelative(iso: string): string {
  const dt = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(dt / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// Period filter for the NAV chart. We always fetch the full 90-day window
// from /klines (3-month cap is the upstream max anyway), then slice it
// client-side per-period — that way switching periods costs zero requests.
const PERIOD_DAYS: Record<string, number> = { "1D": 1, "1W": 7, "1M": 30, "3M": 90 };
const PERIOD_LABELS = ["1D", "1W", "1M", "3M"] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { featured?: string; period?: string };
}) {
  const periodKey = (searchParams?.period ?? "3M").toUpperCase();
  const periodDays = PERIOD_DAYS[periodKey] ?? 90;
  // First fetch what's free / shared — sector spotlight + SSI registry +
  // news. Then fan out across ALL 13 SSI tickers for snapshots so we can
  // show every sector's 24h % side-by-side. The rate-limited transport
  // serializes / dedups, and on the High Frequency tier 13 sequential
  // calls cost ~9s cold and ~0s once cached.
  const [sectors, ssiTickers, news] = await Promise.all([
    getSectorScores(),
    listSsiTickers(),
    getNews({ limit: 8 }),
  ]);

  const allSnaps: { ticker: string; snap: SsiSnapshot }[] = await Promise.all(
    ssiTickers.map(async (t) => ({ ticker: t, snap: await getSsiSnapshot(t) })),
  );

  // Pick which SSI ticker the chart + headline KPIs focus on. Priority:
  //   1. ?featured= URL param if it's a known ticker
  //   2. Top performer by 24h change
  //   3. DEFAULT_FEATURED fallback
  const requested = searchParams?.featured;
  const known = new Set(ssiTickers);
  const sortedByChange = [...allSnaps].sort(
    (a, b) => (b.snap.change_pct_24h ?? 0) - (a.snap.change_pct_24h ?? 0),
  );
  const topSsi = sortedByChange[0]?.ticker;
  const FEATURED =
    requested && known.has(requested)
      ? requested
      : topSsi ?? DEFAULT_FEATURED;

  // Per-featured calls. Constituents and klines aren't pre-fetched in the
  // big snapshot fan-out because we only need them for the focused index.
  const [featuredKlines, featuredCons] = await Promise.all([
    getSsiKlines(FEATURED, { limit: 90 }),
    getSsiConstituents(FEATURED),
  ]);
  const featuredSnap =
    allSnaps.find((s) => s.ticker === FEATURED)?.snap ??
    (await getSsiSnapshot(FEATURED));

  const sectorsLive = sectors.length > 8;
  const ssiLive = ssiTickers.length >= 13;
  const featuredLive = featuredSnap.price !== 1.182 || featuredKlines.length !== 90;
  const newsLive = news.length > 0;

  const sectorsRanked = [...sectors].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topSector = sectorsRanked[0];

  // Aggregate stats across ALL 13 SSI — not just DePIN. Real numbers.
  const validChanges = allSnaps
    .map((s) => s.snap.change_pct_24h)
    .filter((n) => Number.isFinite(n));
  const avg24h =
    validChanges.length > 0
      ? validChanges.reduce((a, b) => a + b, 0) / validChanges.length
      : 0;
  const positiveCount = validChanges.filter((n) => n > 0).length;

  // Slice klines to the selected window. -periodDays takes the last N rows;
  // -1 (1D) gives a degenerate 1-point series we still render but mostly
  // useful as a visual confirmation of "you picked 1D".
  const slicedKlines = featuredKlines.slice(-periodDays);
  const navData = slicedKlines.map((k) => k.close);
  const benchSnap = slicedKlines.map((k) => (k.high + k.low) / 2);

  const featured = SSI_DISPLAY[FEATURED] ?? { name: FEATURED, symbol: FEATURED, tag: "—" };
  const top = sortedByChange[0];
  const worst = sortedByChange[sortedByChange.length - 1];
  const topDisplay = top ? SSI_DISPLAY[top.ticker] : null;
  const worstDisplay = worst ? SSI_DISPLAY[worst.ticker] : null;

  const kpis = [
    {
      k: `${featured.symbol} · NAV`,
      v: fmtPrice(featuredSnap.price),
      d: pct(featuredSnap.change_pct_24h),
      c: featuredSnap.change_pct_24h >= 0 ? tokens.emerald : tokens.red,
      data: navData.slice(-30),
    },
    {
      k: "TOP SSI (24H)",
      v: topDisplay?.symbol ?? top?.ticker ?? "—",
      d: pct(top?.snap.change_pct_24h ?? 0),
      c: (top?.snap.change_pct_24h ?? 0) >= 0 ? tokens.emerald : tokens.red,
      data: null as number[] | null,
    },
    {
      k: "WORST SSI (24H)",
      v: worstDisplay?.symbol ?? worst?.ticker ?? "—",
      d: pct(worst?.snap.change_pct_24h ?? 0),
      c: (worst?.snap.change_pct_24h ?? 0) >= 0 ? tokens.emerald : tokens.red,
      data: null as number[] | null,
    },
    {
      k: "AVG · POSITIVE",
      v: `${pct(avg24h)} · ${positiveCount}/${allSnaps.length}`,
      d: `top sector ${topSector?.sector ?? "—"} Δ${topSector?.delta ?? 0}`,
      c: avg24h >= 0 ? tokens.emerald : tokens.red,
      data: null as number[] | null,
    },
  ];

  const indices = ssiTickers.slice(0, 8).map((t) => {
    const display = SSI_DISPLAY[t] ?? { name: t, symbol: t.slice(3, 7).toUpperCase(), tag: "—" };
    return { ticker: t, ...display };
  });

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Command Center
          </div>
          <Mono size={11}>
            {ssiTickers.length} SoSoValue indices · {sectors.length} sectors · featured{" "}
            <span style={{ color: tokens.emerald }}>{featured.name}</span>
          </Mono>
        </div>
        <div className="flex gap-2">
          <Btn small>Pause agent</Btn>
          <Btn small primary icon={<span style={{ fontSize: 14 }}>+</span>}>
            New index
          </Btn>
        </div>
      </div>

      <DataSourceBanner
        sources={[
          {
            label: "Sector spotlight",
            state: sectorsLive ? "live" : "mock",
            detail: sectorsLive
              ? `${sectors.length} sectors · GET /currencies/sector-spotlight`
              : "synthetic — quota exhausted",
          },
          {
            label: "SSI registry",
            state: ssiLive ? "live" : "mock",
            detail: ssiLive ? `${ssiTickers.length} indices · GET /indices` : "fallback",
          },
          {
            label: `${featured.symbol} snapshot`,
            state: featuredLive ? "live" : "mock",
            detail: featuredLive
              ? `GET /indices/${FEATURED}/market-snapshot + /klines`
              : "synthetic shape",
          },
          {
            label: "News feed",
            state: newsLive ? "live" : "mock",
            detail: newsLive ? `${news.length} articles · GET /news` : "synthetic",
          },
        ]}
      />

      <div className="grid grid-cols-4 gap-3">
        {kpis.map((c, i) => (
          <Card key={i} pad={14}>
            <div className="flex justify-between items-start">
              <div>
                <Label>{c.k}</Label>
                <Metric v={c.v} size={28} style={{ marginTop: 8 }} />
                <Mono size={11} color={c.c} style={{ marginTop: 4, display: "block" }}>
                  {c.d}
                </Mono>
              </div>
              {c.data && c.data.length > 0 && <Spark data={c.data} w={70} h={36} color={c.c} />}
            </div>
          </Card>
        ))}
      </div>

      {/* SSI selector — every index, real 24h % from /market-snapshot.
          Click to refocus the chart + featured KPI. */}
      <Card pad={12}>
        <div className="flex justify-between items-center mb-2">
          <Mono size={9} color={tokens.textFaint}>
            SECTORS · click to feature on chart
          </Mono>
          <Mono size={10} color={tokens.textFaint}>
            13 SSI · sorted by 24h
          </Mono>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sortedByChange.map(({ ticker, snap }) => {
            const d = SSI_DISPLAY[ticker] ?? { symbol: ticker.slice(3, 7).toUpperCase() };
            const change = snap.change_pct_24h ?? 0;
            const isFeatured = ticker === FEATURED;
            const c =
              change >= 0.02
                ? tokens.emerald
                : change >= -0.02
                  ? tokens.textDim
                  : tokens.red;
            return (
              <Link
                key={ticker}
                href={`/dashboard?featured=${ticker}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 9px",
                  borderRadius: 6,
                  background: isFeatured ? `${c}18` : tokens.bgElev2,
                  border: `1px solid ${isFeatured ? c : tokens.border}`,
                  textDecoration: "none",
                }}
              >
                <Mono size={10} color={isFeatured ? tokens.text : tokens.textDim}>
                  {d.symbol}
                </Mono>
                <Mono size={10} color={c}>
                  {change >= 0 ? "+" : ""}
                  {(change * 100).toFixed(2)}%
                </Mono>
              </Link>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Card pad={16}>
          <div className="flex justify-between mb-3">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {featured.name} · NAV ({periodKey})
              </div>
              <Mono size={10}>
                SoSoValue · GET /indices/{FEATURED}/klines{featuredLive ? "" : " · synthetic"}
              </Mono>
            </div>
            <div className="flex gap-1">
              {PERIOD_LABELS.map((t) => {
                const on = t === periodKey;
                // Preserve the current ?featured= when switching period.
                const params = new URLSearchParams();
                params.set("period", t);
                if (FEATURED && FEATURED !== DEFAULT_FEATURED) params.set("featured", FEATURED);
                return (
                  <Link
                    key={t}
                    href={`/dashboard?${params}`}
                    scroll={false}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      background: on ? tokens.bgElev2 : "transparent",
                      border: `1px solid ${on ? tokens.borderStrong : "transparent"}`,
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 10,
                      color: on ? tokens.text : tokens.textDim,
                      textDecoration: "none",
                    }}
                  >
                    {t}
                  </Link>
                );
              })}
            </div>
          </div>
          {navData.length > 0 ? (
            <LineChart
              w={780}
              h={240}
              series={[
                { data: navData, color: tokens.emerald, thick: true, fill: true },
                { data: benchSnap, color: tokens.textDim, dashed: true },
              ]}
            />
          ) : (
            // SoSoValue's /indices/{ticker}/klines returns an empty array on
            // the live API (verified 2026-05-01) — likely a server-side data
            // gap, not a client bug. Show an honest placeholder instead of an
            // empty axis-only chart so the page reads as "no data" not "broken".
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
                <Mono size={11}>No klines from SoSoValue for {FEATURED}</Mono>
                <Mono size={9} color={tokens.textFaint}>
                  upstream returned 0 candles · current snapshot price{" "}
                  {fmtPrice(featuredSnap.price)} · {featuredCons.length} constituents
                </Mono>
              </div>
            </div>
          )}
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <div style={{ width: 12, height: 2, background: tokens.emerald }} />
              <Mono size={10} color={tokens.text}>
                {featured.symbol} close
              </Mono>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 12, height: 2, background: tokens.textDim }} />
              <Mono size={10}>{featured.symbol} mid (high+low)/2</Mono>
            </div>
            <div className="flex-1" />
            <Mono size={10} color={tokens.textFaint}>
              {featuredCons.length} constituents
            </Mono>
          </div>
        </Card>

        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>News stream</div>
            <Tag small color={newsLive ? tokens.emerald : tokens.textFaint} dot>
              {newsLive ? "live · /news" : "no data"}
            </Tag>
          </div>
          {news.length === 0 ? (
            // Honest empty state. The synthetic news fallback in
            // lib/api/sosovalue.ts is now an empty list, so this branch
            // fires whenever SoSoValue is unavailable / rate-limited /
            // returns no articles — instead of fake titles like the old
            // "Filecoin storage demand jumps 38% QoQ" placeholder.
            <div
              className="flex items-center justify-center text-center"
              style={{
                height: 240,
                padding: 16,
                color: tokens.textFaint,
              }}
            >
              <div className="flex flex-col items-center gap-2" style={{ maxWidth: 240 }}>
                <Mono size={11}>No news from /news right now</Mono>
                <Mono size={9} color={tokens.textFaint}>
                  upstream returned 0 articles · headlines populate from the
                  live SoSoValue feed when available
                </Mono>
              </div>
            </div>
          ) : (
            <div style={{ padding: "6px 0", overflowY: "auto", maxHeight: 290 }}>
              {news.map((n, i) => (
                <div
                  key={i}
                  className="flex gap-2.5 items-start"
                  style={{ padding: "8px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
                >
                  <Mono size={10} color={tokens.textFaint} style={{ minWidth: 30, paddingTop: 2 }}>
                    {fmtRelative(n.ts)}
                  </Mono>
                  <Tag
                    small
                    color={
                      n.importance === "high"
                        ? tokens.red
                        : n.importance === "med"
                          ? tokens.amber
                          : tokens.textDim
                    }
                    style={{ minWidth: 40, justifyContent: "center" }}
                  >
                    {n.sector || "—"}
                  </Tag>
                  <div className="flex-1">
                    <div
                      style={{ fontSize: 12, color: tokens.text, fontWeight: 500, lineHeight: 1.4 }}
                    >
                      {n.title}
                    </div>
                    <Mono size={10}>
                      {n.source} · score {n.sentiment >= 0 ? "+" : ""}
                      {n.sentiment}
                    </Mono>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>SSI indices</div>
            <Mono size={10}>SoSoValue · GET /indices</Mono>
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "2fr 1fr 1fr 0.6fr",
              padding: "8px 16px",
              gap: 8,
              borderBottom: `1px solid ${tokens.borderFaint}`,
            }}
          >
            {["NAME", "TICKER", "TAG", ""].map((k) => (
              <Label key={k}>{k}</Label>
            ))}
          </div>
          {indices.map((r) => (
            <div
              key={r.ticker}
              className="grid items-center"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 0.6fr",
                padding: "11px 16px",
                gap: 8,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex items-center justify-center font-mono"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: r.ticker === FEATURED ? tokens.emerald + "20" : tokens.bgElev2,
                    border: `1px solid ${r.ticker === FEATURED ? tokens.emerald : tokens.border}`,
                    fontSize: 9.5,
                    color: r.ticker === FEATURED ? tokens.emerald : tokens.textDim,
                    fontWeight: 600,
                  }}
                >
                  {r.symbol.slice(0, 4)}
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>{r.name}</div>
                  <Mono size={9.5}>{r.ticker}</Mono>
                </div>
              </div>
              <Mono size={11} color={tokens.text}>
                {r.symbol}
              </Mono>
              <Tag small color={tokens.cyan}>
                {r.tag}
              </Tag>
              <Mono size={11} color={r.ticker === FEATURED ? tokens.emerald : tokens.textFaint}>
                {r.ticker === FEATURED ? "● featured" : "→"}
              </Mono>
            </div>
          ))}
        </Card>

        <Card pad={16}>
          <div className="flex justify-between mb-3">
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sector sentiment</div>
            <Mono size={10} color={sectorsLive ? tokens.emerald : tokens.amber}>
              {sectorsLive ? "live" : "fallback"}
            </Mono>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {sectors.slice(0, 8).map((s, i) => {
              const c = sectorColor(s.score);
              return (
                <div
                  key={i}
                  style={{
                    padding: "10px 10px",
                    background: `${c}10`,
                    border: `1px solid ${c}30`,
                    borderRadius: 6,
                  }}
                >
                  <Mono size={9.5} color={tokens.textDim}>
                    {s.sector}
                  </Mono>
                  <div
                    className="tabular"
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      color: c,
                      letterSpacing: "-0.02em",
                      marginTop: 2,
                    }}
                  >
                    {s.delta >= 0 ? "+" : ""}
                    {s.delta}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
