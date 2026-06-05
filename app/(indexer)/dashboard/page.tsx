import Link from "next/link";

import { Card, Mono, Tag, Btn, Spark, LineChart, SectionLabel } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  getSectorScores,
  listSsiTickers,
  getSsiSnapshot,
  getSsiKlines,
  getSsiConstituents,
  getNews,
  type SsiSnapshot,
  type IndexConstituent,
} from "@/lib/api/sosovalue";
import { MacroCalendar } from "@/components/dashboard/MacroCalendar";
import { SmartMoneyWidget } from "@/components/dashboard/SmartMoneyWidget";
import { StablecoinFlowWidget } from "@/components/dashboard/StablecoinFlowWidget";
import { SsiCompositeLogo } from "@/components/dashboard/SsiCompositeLogo";
import { FirstRunChecklistCard } from "@/components/onboarding";

export const revalidate = 60;

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

// Per-tag tint for the SSI table tag column. Falls back to cyan for tags
// not in this map (matches the redesign palette).
const TAG_COLOR: Record<string, string> = {
  RWA: tokens.rose,
  Meme: tokens.amber,
  Macro: tokens.violet,
  AI: tokens.violet,
  DeFi: tokens.cyan,
  DePIN: tokens.emerald,
  L1: tokens.emerald,
  L2: tokens.cyan,
  NFT: tokens.amber,
  PayFi: tokens.cyan,
  CeFi: tokens.cyan,
  Gaming: tokens.amber,
  SocialFi: tokens.emerald,
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

const PERIOD_DAYS: Record<string, number> = { "1D": 1, "1W": 7, "1M": 30, "3M": 90 };
const PERIOD_LABELS = ["1D", "1W", "1M", "3M"] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { featured?: string; period?: string };
}) {
  const periodKey = (searchParams?.period ?? "3M").toUpperCase();
  const periodDays = PERIOD_DAYS[periodKey] ?? 90;
  const [sectors, ssiTickers, news] = await Promise.all([
    getSectorScores(),
    listSsiTickers(),
    getNews({ limit: 8 }),
  ]);

  const allSnaps: { ticker: string; snap: SsiSnapshot }[] = await Promise.all(
    ssiTickers.map(async (t) => ({ ticker: t, snap: await getSsiSnapshot(t) })),
  );

  const requested = searchParams?.featured;
  const known = new Set(ssiTickers);
  const sortedByChange = [...allSnaps].sort(
    (a, b) => (b.snap.change_pct_24h ?? 0) - (a.snap.change_pct_24h ?? 0),
  );
  const topSsi = sortedByChange[0]?.ticker;
  const FEATURED =
    requested && known.has(requested) ? requested : topSsi ?? DEFAULT_FEATURED;

  const [featuredKlines, featuredCons] = await Promise.all([
    getSsiKlines(FEATURED, { limit: 90 }),
    getSsiConstituents(FEATURED),
  ]);
  const featuredSnap =
    allSnaps.find((s) => s.ticker === FEATURED)?.snap ??
    (await getSsiSnapshot(FEATURED));

  const featuredLive = featuredSnap.price !== 1.182 || featuredKlines.length !== 90;
  const newsLive = news.length > 0;

  const validChanges = allSnaps
    .map((s) => s.snap.change_pct_24h)
    .filter((n) => Number.isFinite(n));
  const avg24h =
    validChanges.length > 0
      ? validChanges.reduce((a, b) => a + b, 0) / validChanges.length
      : 0;
  const positiveCount = validChanges.filter((n) => n > 0).length;

  const slicedKlines = featuredKlines.slice(-periodDays);
  const navData = slicedKlines.map((k) => k.close);
  const benchSnap = slicedKlines.map((k) => (k.high + k.low) / 2);
  // First-vs-last delta over the selected period — matches the headline
  // "▲ +20.64% · 3M" pattern in the redesign instead of always showing 24h.
  const periodDelta =
    navData.length >= 2 && navData[0] !== 0
      ? navData[navData.length - 1] / navData[0] - 1
      : featuredSnap.change_pct_24h;

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
      arrow: featuredSnap.change_pct_24h >= 0 ? "▲" : "▼",
      c: featuredSnap.change_pct_24h >= 0 ? tokens.emerald : tokens.rose,
      data: navData.slice(-30),
      accent: true,
    },
    {
      k: "Top SSI (24h)",
      v: topDisplay?.symbol ?? top?.ticker ?? "—",
      d: pct(top?.snap.change_pct_24h ?? 0),
      arrow: (top?.snap.change_pct_24h ?? 0) >= 0 ? "▲" : "▼",
      c: (top?.snap.change_pct_24h ?? 0) >= 0 ? tokens.emerald : tokens.rose,
      data: null as number[] | null,
      accent: false,
    },
    {
      k: "Worst SSI (24h)",
      v: worstDisplay?.symbol ?? worst?.ticker ?? "—",
      d: pct(worst?.snap.change_pct_24h ?? 0),
      arrow: (worst?.snap.change_pct_24h ?? 0) >= 0 ? "▲" : "▼",
      c: (worst?.snap.change_pct_24h ?? 0) >= 0 ? tokens.emerald : tokens.rose,
      data: null as number[] | null,
      accent: false,
    },
    {
      k: "Avg · positive",
      v: pct(avg24h),
      d: `${positiveCount} of ${allSnaps.length} indices ▲`,
      arrow: "",
      c: avg24h >= 0 ? tokens.emerald : tokens.rose,
      data: null as number[] | null,
      accent: false,
    },
  ];

  const visibleTickers = ssiTickers.slice(0, 8);
  const constituentsByTicker = await Promise.all(
    visibleTickers.map(async (t) => {
      try {
        const list = await getSsiConstituents(t);
        return { ticker: t, list };
      } catch {
        return { ticker: t, list: [] as IndexConstituent[] };
      }
    }),
  );
  const symbolsByTicker: Record<string, string[]> = {};
  for (const { ticker, list } of constituentsByTicker) {
    symbolsByTicker[ticker] = [...list]
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .slice(0, 3)
      .map((c) => c.symbol);
  }
  const indices = visibleTickers.map((t) => {
    const display = SSI_DISPLAY[t] ?? { name: t, symbol: t.slice(3, 7).toUpperCase(), tag: "—" };
    const change = allSnaps.find((s) => s.ticker === t)?.snap.change_pct_24h ?? 0;
    return { ticker: t, ...display, symbols: symbolsByTicker[t] ?? [], change };
  });

  // UTC clock at last revalidation — surfaces page freshness in the
  // section label without needing a client effect.
  const clock = `${new Date().toISOString().slice(11, 16)} UTC`;

  return (
    <div style={{ padding: "24px 28px 60px" }}>
      {/* ---------- header ---------- */}
      <header
        className="flex items-end justify-between"
        style={{ marginBottom: 22 }}
      >
        <div>
          <h1
            style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: tokens.text }}
          >
            Command Center
          </h1>
          <Mono size={12} color={tokens.textDim} style={{ marginTop: 4, display: "block" }}>
            {ssiTickers.length} SoSoValue indices · {sectors.length} sectors · featured:{" "}
            <span style={{ color: tokens.emerald }}>{featured.name}</span>
          </Mono>
        </div>
        <div className="flex gap-2">
          <Btn small>⏸ Pause agent</Btn>
          <Btn small primary icon={<span style={{ fontSize: 14 }}>+</span>}>
            New index
          </Btn>
        </div>
      </header>

      <FirstRunChecklistCard />

      {/* ---------- snapshot KPI row ---------- */}
      <SectionLabel meta={`SoSoValue · ${clock}`}>Snapshot</SectionLabel>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}
      >
        {kpis.map((c, i) => (
          <Card
            key={i}
            pad={14}
            style={
              c.accent
                ? {
                    borderColor: `${tokens.emerald}48`,
                    background: `linear-gradient(180deg, ${tokens.emerald}0a, ${tokens.bgElev})`,
                  }
                : undefined
            }
          >
            <div className="flex justify-between items-start" style={{ position: "relative" }}>
              <div style={{ minWidth: 0 }}>
                <Mono
                  size={9.5}
                  color={tokens.textFaint}
                  style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}
                >
                  {c.k}
                </Mono>
                <div
                  className="font-mono tabular"
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    marginTop: 6,
                    color: tokens.text,
                  }}
                >
                  {c.v}
                </div>
                <Mono size={11} color={c.c} style={{ marginTop: 4, display: "block" }}>
                  {c.arrow ? `${c.arrow} ` : ""}
                  {c.d}
                </Mono>
              </div>
              {c.data && c.data.length > 0 ? (
                <div style={{ position: "absolute", right: 0, top: 0 }}>
                  <Spark data={c.data} w={80} h={30} color={c.c} />
                </div>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {/* ---------- sector rail ---------- */}
      <SectionLabel meta="click a chip to feature">Sectors</SectionLabel>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(sortedByChange.length, 1)}, minmax(0, 1fr))`,
          gap: 6,
          marginBottom: 22,
        }}
      >
        {sortedByChange.map(({ ticker, snap }) => {
          const d = SSI_DISPLAY[ticker] ?? { symbol: ticker.slice(3, 7).toUpperCase() };
          const change = snap.change_pct_24h ?? 0;
          const isFeatured = ticker === FEATURED;
          const c = change > 0 ? tokens.emerald : change < 0 ? tokens.rose : tokens.textDim;
          return (
            <Link
              key={ticker}
              href={`/dashboard?featured=${ticker}${periodKey !== "3M" ? `&period=${periodKey}` : ""}`}
              style={{
                background: isFeatured ? `${tokens.emerald}14` : tokens.bgElev2,
                border: `1px solid ${isFeatured ? tokens.emerald : tokens.border}`,
                borderRadius: 6,
                padding: "8px 10px",
                textDecoration: "none",
                display: "block",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: tokens.text,
                  letterSpacing: "-0.005em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {d.symbol}
              </div>
              <Mono size={10.5} color={c} style={{ marginTop: 2, display: "block" }}>
                {change >= 0 ? "+" : ""}
                {(change * 100).toFixed(2)}%
              </Mono>
            </Link>
          );
        })}
      </div>

      {/* ---------- chart + news ---------- */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "2fr 1fr", marginBottom: 22 }}
      >
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
                {featured.name} · NAV
              </div>
              <Mono size={10.5} color={tokens.textFaint} style={{ marginTop: 2, display: "block" }}>
                SoSoValue · GET /indices/{FEATURED}/closes{featuredLive ? "" : " · synthetic"}
              </Mono>
            </div>
            <div
              className="flex"
              style={{
                gap: 2,
                padding: 3,
                background: tokens.bgElev2,
                border: `1px solid ${tokens.border}`,
                borderRadius: 6,
              }}
            >
              {PERIOD_LABELS.map((t) => {
                const on = t === periodKey;
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
                      background: on ? tokens.bg : "transparent",
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 10.5,
                      color: on ? tokens.text : tokens.textDim,
                      textDecoration: "none",
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {t}
                  </Link>
                );
              })}
            </div>
          </div>

          <div
            className="flex justify-between items-end"
            style={{ padding: "14px 16px 6px" }}
          >
            <div>
              <div
                className="font-mono tabular"
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: tokens.text,
                }}
              >
                {fmtPrice(featuredSnap.price)}
              </div>
              <Mono
                size={12}
                color={periodDelta >= 0 ? tokens.emerald : tokens.rose}
                style={{ marginTop: 2, display: "block" }}
              >
                {periodDelta >= 0 ? "▲" : "▼"} {pct(periodDelta)} · {periodKey}
              </Mono>
            </div>
            <Mono size={10} color={tokens.textFaint}>
              {featuredCons.length} constituents
            </Mono>
          </div>

          <div style={{ padding: "0 16px 16px" }}>
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
                    upstream returned 0 candles · current snapshot price {fmtPrice(featuredSnap.price)}
                  </Mono>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ---- News stream ---- */}
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>News stream</div>
            <Tag small color={newsLive ? tokens.emerald : tokens.textFaint} dot>
              {newsLive ? "live" : "no data"}
            </Tag>
          </div>
          {news.length === 0 ? (
            <div
              className="flex items-center justify-center text-center"
              style={{ height: 280, padding: 16, color: tokens.textFaint }}
            >
              <div className="flex flex-col items-center gap-2" style={{ maxWidth: 240 }}>
                <Mono size={11}>No news right now</Mono>
                <Mono size={9} color={tokens.textFaint}>
                  upstream returned 0 articles · feed populates from SoSoValue when available
                </Mono>
              </div>
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {news.map((n, i) => {
                const tint =
                  n.importance === "high"
                    ? { bg: `${tokens.amber}20`, fg: tokens.amber }
                    : n.importance === "med"
                      ? { bg: `${tokens.cyan}20`, fg: tokens.cyan }
                      : { bg: `${tokens.violet}20`, fg: tokens.violet };
                return (
                  <div
                    key={i}
                    className="grid items-start"
                    style={{
                      gridTemplateColumns: "36px 86px 1fr",
                      gap: 10,
                      padding: "12px 16px",
                      borderBottom:
                        i === news.length - 1 ? "none" : `1px solid ${tokens.border}`,
                    }}
                  >
                    <Mono size={10.5} color={tokens.textFaint} style={{ paddingTop: 2 }}>
                      {fmtRelative(n.ts)}
                    </Mono>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        padding: "3px 6px",
                        borderRadius: 3,
                        textAlign: "center",
                        height: "fit-content",
                        background: tint.bg,
                        color: tint.fg,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(n.sector || "—").slice(0, 9)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: tokens.text }}>
                        {n.title}
                      </div>
                      <Mono
                        size={10.5}
                        color={tokens.textFaint}
                        style={{ marginTop: 3, display: "block" }}
                      >
                        {n.source} · score {n.sentiment >= 0 ? "+" : ""}
                        {n.sentiment}
                      </Mono>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ---------- SSI table + Sector sentiment ---------- */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "2fr 1fr", marginBottom: 22 }}
      >
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>SSI indices</div>
            <Mono size={10.5} color={tokens.textFaint}>
              SoSoValue · GET /indices · {ssiTickers.length} entries
            </Mono>
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "2fr 0.7fr 1fr 0.8fr 0.6fr",
              padding: "10px 14px",
              gap: 8,
              borderBottom: `1px solid ${tokens.border}`,
            }}
          >
            {["Name", "Ticker", "Tag", "24h", ""].map((k, idx) => (
              <Mono
                key={k + idx}
                size={9.5}
                color={tokens.textFaint}
                style={{
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  textAlign: idx === 3 ? "right" : "left",
                }}
              >
                {k}
              </Mono>
            ))}
          </div>
          {indices.map((r, idx) => {
            const tagColor = TAG_COLOR[r.tag] ?? tokens.cyan;
            const isFeatured = r.ticker === FEATURED;
            const change = r.change;
            return (
              <Link
                key={r.ticker}
                href={`/dashboard?featured=${r.ticker}${periodKey !== "3M" ? `&period=${periodKey}` : ""}`}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "2fr 0.7fr 1fr 0.8fr 0.6fr",
                  padding: "12px 14px",
                  gap: 8,
                  borderBottom:
                    idx === indices.length - 1 ? "none" : `1px solid ${tokens.border}`,
                  textDecoration: "none",
                  background: isFeatured ? `${tokens.emerald}06` : "transparent",
                }}
              >
                <div className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
                  {r.symbols.length > 0 ? (
                    <SsiCompositeLogo symbols={r.symbols} size={28} />
                  ) : (
                    <div
                      className="flex items-center justify-center font-mono"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: tokens.bgElev2,
                        border: `1px solid ${tokens.border}`,
                        fontSize: 9.5,
                        color: tokens.textDim,
                        fontWeight: 600,
                      }}
                    >
                      {r.symbol.slice(0, 4)}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: tokens.text,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name}
                    </div>
                    <Mono size={10} color={tokens.textDim}>
                      {r.ticker}
                    </Mono>
                  </div>
                </div>
                <Mono size={11} color={tokens.text}>
                  {r.symbol}
                </Mono>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 9.5,
                    letterSpacing: "0.1em",
                    padding: "3px 7px",
                    borderRadius: 3,
                    textTransform: "uppercase",
                    background: `${tagColor}1a`,
                    color: tagColor,
                    border: `1px solid ${tagColor}40`,
                    width: "fit-content",
                  }}
                >
                  {r.tag}
                </span>
                <Mono
                  size={11.5}
                  color={change > 0 ? tokens.emerald : change < 0 ? tokens.rose : tokens.textDim}
                  style={{ textAlign: "right" }}
                >
                  {change >= 0 ? "+" : ""}
                  {(change * 100).toFixed(2)}%
                </Mono>
                <Mono
                  size={10}
                  color={isFeatured ? tokens.emerald : tokens.textFaint}
                  style={{ textAlign: "right" }}
                >
                  {isFeatured ? "● featured" : "→"}
                </Mono>
              </Link>
            );
          })}
        </Card>

        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
              Sector sentiment
            </div>
            <Tag small color={tokens.emerald} dot>
              live
            </Tag>
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
              padding: "14px 16px",
            }}
          >
            {sectors.slice(0, 8).map((s, i) => {
              const c =
                s.delta > 0 ? tokens.emerald : s.delta < 0 ? tokens.rose : tokens.textDim;
              const pctBar = Math.min(100, Math.max(5, Math.abs(s.delta) * 10));
              return (
                <div
                  key={i}
                  style={{
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  <Mono
                    size={9}
                    color={tokens.textFaint}
                    style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}
                  >
                    {s.sector}
                  </Mono>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      marginTop: 4,
                      color: c,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {s.delta >= 0 ? "+" : ""}
                    {s.delta}
                  </div>
                  <div
                    style={{
                      height: 3,
                      background: tokens.border,
                      borderRadius: 2,
                      marginTop: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ height: "100%", width: `${pctBar}%`, background: c }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ---------- macro calendar ---------- */}
      <div style={{ marginBottom: 22 }}>
        <MacroCalendar />
      </div>

      {/* ---------- Smart Money + Stablecoin ---------- */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <SmartMoneyWidget />
        <StablecoinFlowWidget />
      </div>
    </div>
  );
}
