import Link from "next/link";
import { Card, Label, Mono, Tag, Btn, ProjectLogo } from "@/components/ui";
import { tokens, accentHex } from "@/lib/tokens";
import {
  listAllCurrencies,
  getTokenEconomics,
  getSupplyHistory,
  getTradingPairs,
  getCurrencyFundraising,
  type TokenAllocation,
  type SupplyRow,
  type TradingPair,
  type FundraisingRound,
} from "@/lib/api/sosovalue/tokens";

export const revalidate = 300;

type Tab = "economics" | "supply" | "pairs" | "fundraising";

const TABS: Array<{ k: Tab; l: string }> = [
  { k: "economics", l: "Economics" },
  { k: "supply", l: "Supply" },
  { k: "pairs", l: "Pairs" },
  { k: "fundraising", l: "Fundraising" },
];

const ALLOCATION_COLORS = [
  accentHex.emerald,
  accentHex.cyan,
  accentHex.amber,
  accentHex.red,
  accentHex.textDim,
];

// ---------- format helpers ----------

function fmtNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ---------- page ----------

export default async function TokenDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.k === sp.tab) ? (sp.tab as Tab) : "economics";

  // Resolve the symbol/name from /currencies for the header. Run in parallel
  // with the tab-specific fetch to keep the cold render under one rate-limit
  // window.
  const universePromise = listAllCurrencies();
  const tabDataPromise =
    tab === "economics"
      ? getTokenEconomics(id)
      : tab === "supply"
        ? getSupplyHistory(id, { pageSize: 100 })
        : tab === "pairs"
          ? getTradingPairs(id, { pageSize: 20, orderBy: "turnover_24h" })
          : getCurrencyFundraising(id);

  const [universe, tabData] = await Promise.all([universePromise, tabDataPromise]);
  const meta = universe.find((c) => c.currency_id === id);
  const symbol = (meta?.symbol ?? id).toUpperCase();
  const name = meta?.name ?? "Unknown token";

  return (
    <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-48px)]">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-3">
          <ProjectLogo name={name !== "Unknown token" ? name : symbol} size={48} />
          <div>
            <div className="flex items-center gap-2.5">
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: tokens.text,
                }}
              >
                {symbol}
              </div>
              <div style={{ fontSize: 16, color: tokens.textDim, letterSpacing: "-0.01em" }}>
                {name}
              </div>
              <Tag small color={tokens.emerald} filled>
                L1
              </Tag>
              <Tag small color={tokens.cyan}>
                Top 10
              </Tag>
            </div>
            <Mono size={10}>currency_id {id}</Mono>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Link href="/tokens">
            <Btn small>← All tokens</Btn>
          </Link>
          <Btn small>+ Watchlist</Btn>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-0.5"
        style={{ borderBottom: `1px solid ${tokens.border}` }}
      >
        {TABS.map((t) => {
          const on = t.k === tab;
          return (
            <Link
              key={t.k}
              href={`/tokens/${id}?tab=${t.k}`}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                color: on ? tokens.text : tokens.textDim,
                borderBottom: `2px solid ${on ? tokens.emerald : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {t.l}
            </Link>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto">
        {tab === "economics" && (
          <EconomicsTab data={tabData as Awaited<ReturnType<typeof getTokenEconomics>>} />
        )}
        {tab === "supply" && (
          <SupplyTab data={tabData as Awaited<ReturnType<typeof getSupplyHistory>>} />
        )}
        {tab === "pairs" && (
          <PairsTab data={tabData as Awaited<ReturnType<typeof getTradingPairs>>} />
        )}
        {tab === "fundraising" && (
          <FundraisingTab
            data={tabData as Awaited<ReturnType<typeof getCurrencyFundraising>>}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Economics tab ----------

function EconomicsTab({
  data,
}: {
  data: Awaited<ReturnType<typeof getTokenEconomics>>;
}) {
  const total = data.token_unlock.unlocked + data.token_unlock.total_locked;
  const unlockedPct = total > 0 ? (data.token_unlock.unlocked / total) * 100 : 0;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
      {/* Allocation pie + legend */}
      <Card>
        <Label className="mb-2">TOKEN ALLOCATION</Label>
        {data.token_allocation.length === 0 ? (
          <Mono size={11} color={tokens.textFaint}>
            No allocation data published for this currency.
          </Mono>
        ) : (
          <div className="flex items-center gap-4">
            <AllocationPie allocation={data.token_allocation} />
            <div className="flex flex-col gap-1.5 flex-1">
              {data.token_allocation.map((a, i) => (
                <div key={a.holder} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length],
                      }}
                    />
                    <span style={{ fontSize: 12, color: tokens.text }}>{a.holder}</span>
                  </div>
                  <Mono size={11} color={tokens.text}>
                    {fmtPct(a.percentage)}
                  </Mono>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Allocation bar (alternative view) */}
      <Card>
        <Label className="mb-2">ALLOCATION BREAKDOWN</Label>
        {data.token_allocation.length === 0 ? (
          <Mono size={11} color={tokens.textFaint}>
            No breakdown available.
          </Mono>
        ) : (
          <>
            <div
              className="flex"
              style={{
                height: 28,
                borderRadius: 4,
                overflow: "hidden",
                border: `1px solid ${tokens.border}`,
              }}
            >
              {data.token_allocation.map((a, i) => (
                <div
                  key={a.holder}
                  style={{
                    width: `${a.percentage}%`,
                    background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length],
                  }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-1.5 mt-3">
              {data.token_allocation.map((a, i) => (
                <div key={a.holder} className="flex items-center gap-2">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length],
                    }}
                  />
                  <Mono size={11} color={tokens.text}>
                    {a.holder} · {fmtPct(a.percentage)}
                  </Mono>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Unlock big number */}
      <Card>
        <Label className="mb-2">UNLOCK STATUS</Label>
        <div className="flex items-baseline gap-3">
          <div>
            <Mono size={10}>UNLOCKED</Mono>
            <div
              style={{
                fontSize: 26,
                fontWeight: 600,
                color: tokens.emerald,
                letterSpacing: "-0.02em",
              }}
            >
              {fmtNumber(data.token_unlock.unlocked)}
            </div>
          </div>
          <div style={{ fontSize: 18, color: tokens.textFaint }}>/</div>
          <div>
            <Mono size={10}>LOCKED</Mono>
            <div
              style={{
                fontSize: 26,
                fontWeight: 600,
                color: tokens.amber,
                letterSpacing: "-0.02em",
              }}
            >
              {fmtNumber(data.token_unlock.total_locked)}
            </div>
          </div>
        </div>
        <div
          className="mt-3"
          style={{
            height: 8,
            background: tokens.bgElev2,
            borderRadius: 4,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              right: `${100 - unlockedPct}%`,
              background: tokens.emerald,
            }}
          />
        </div>
        <Mono size={10} className="mt-1.5 block">
          {fmtPct(unlockedPct)} circulating · {fmtPct(100 - unlockedPct)} still locked
        </Mono>
      </Card>

      {/* Vesting timeline */}
      <Card>
        <Label className="mb-2">UPCOMING VESTING (NEXT 6)</Label>
        {data.unlock_timeline.length === 0 ? (
          <Mono size={11} color={tokens.textFaint}>
            No upcoming vesting events disclosed.
          </Mono>
        ) : (
          <div className="flex flex-col">
            {data.unlock_timeline.slice(0, 6).map((row, i) => {
              const total = row.vestings.reduce((s, v) => s + v.amount, 0);
              return (
                <div
                  key={i}
                  className="flex justify-between items-center"
                  style={{
                    padding: "8px 0",
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: tokens.text }}>
                      {row.vestings.map((v) => v.label).join(" + ")}
                    </div>
                    <Mono size={10}>{fmtDate(row.timestamp)}</Mono>
                  </div>
                  <Mono size={12} color={tokens.amber}>
                    {fmtNumber(total)}
                  </Mono>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function AllocationPie({ allocation }: { allocation: TokenAllocation[] }) {
  const total = allocation.reduce((s, a) => s + a.percentage, 0);
  const r = 56;
  const cx = 64;
  const cy = 64;
  let acc = 0;
  return (
    <svg width={128} height={128} viewBox="0 0 128 128">
      <circle cx={cx} cy={cy} r={r} fill={tokens.bgElev2} />
      {allocation.map((a, i) => {
        const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
        acc += a.percentage;
        const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const largeArc = end - start > Math.PI ? 1 : 0;
        const path = [
          `M ${cx} ${cy}`,
          `L ${x1} ${y1}`,
          `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
          "Z",
        ].join(" ");
        return (
          <path
            key={a.holder}
            d={path}
            fill={ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]}
            stroke={tokens.bg}
            strokeWidth={1}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.55} fill={tokens.bgElev} />
    </svg>
  );
}

// ---------- Supply tab ----------

function SupplyTab({ data }: { data: SupplyRow[] }) {
  const series = data.slice(-90);
  const w = 1000;
  const h = 240;

  if (series.length === 0) {
    return (
      <Card>
        <Label className="mb-2">CIRCULATING SUPPLY · 90D</Label>
        <Mono size={11} color={tokens.textFaint}>
          No supply history available for this currency.
        </Mono>
      </Card>
    );
  }

  // Math.min/max on an empty array returns ±Infinity which corrupts the
  // SVG path (NaN coordinates → blank chart). The early return above covers
  // the empty case; below assumes at least one row.
  const values = series.map((r) => r.circulating_supply);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = series.length > 1 ? w / (series.length - 1) : w;
  const points = series
    .map((r, i) => {
      const x = i * stepX;
      const y = h - ((r.circulating_supply - min) / span) * (h - 20) - 10;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPath = `M 0,${h} L ${points
    .split(" ")
    .join(" L ")} L ${w},${h} Z`;

  const latest = series[series.length - 1];
  const earliest = series[0];

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex justify-between items-end mb-2">
          <div>
            <Label className="mb-1">CIRCULATING SUPPLY · 90D</Label>
            <Mono size={10}>
              {earliest?.date ?? "—"} → {latest?.date ?? "—"}
            </Mono>
          </div>
          <div className="flex gap-4">
            <div>
              <Mono size={10}>LATEST</Mono>
              <div
                style={{ fontSize: 18, fontWeight: 600, color: tokens.text }}
              >
                {latest ? fmtNumber(latest.circulating_supply) : "—"}
              </div>
            </div>
            <div>
              <Mono size={10}>MAX</Mono>
              <div
                style={{ fontSize: 18, fontWeight: 600, color: tokens.textDim }}
              >
                {latest ? fmtNumber(latest.max_supply) : "—"}
              </div>
            </div>
          </div>
        </div>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="supplyGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={tokens.emerald} stopOpacity="0.45" />
              <stop offset="100%" stopColor={tokens.emerald} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={0}
              x2={w}
              y1={h * g}
              y2={h * g}
              stroke={tokens.borderFaint}
              strokeWidth={1}
            />
          ))}
          <path d={areaPath} fill="url(#supplyGrad)" />
          <polyline
            points={points}
            fill="none"
            stroke={tokens.emerald}
            strokeWidth={1.6}
          />
        </svg>
      </Card>

      <Card pad={0}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: "120px 1fr 1fr 1fr",
            padding: "10px 16px",
            gap: 12,
            borderBottom: `1px solid ${tokens.border}`,
            background: tokens.bgElev2,
          }}
        >
          <Label>DATE</Label>
          <Label>CIRCULATING</Label>
          <Label>TOTAL</Label>
          <Label>MAX</Label>
        </div>
        <div style={{ maxHeight: 240, overflowY: "auto" }}>
          {series
            .slice(-12)
            .reverse()
            .map((r) => (
              <div
                key={r.date}
                className="grid"
                style={{
                  gridTemplateColumns: "120px 1fr 1fr 1fr",
                  padding: "8px 16px",
                  gap: 12,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <Mono size={11}>{r.date}</Mono>
                <Mono size={11} color={tokens.text}>
                  {fmtNumber(r.circulating_supply)}
                </Mono>
                <Mono size={11}>{fmtNumber(r.total_supply)}</Mono>
                <Mono size={11}>{fmtNumber(r.max_supply)}</Mono>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- Pairs tab ----------

function PairsTab({
  data,
}: {
  data: Awaited<ReturnType<typeof getTradingPairs>>;
}) {
  const sorted = [...data.list]
    .sort((a, b) => b.turnover_24h - a.turnover_24h)
    .slice(0, 20);
  const maxLiq = Math.max(
    ...sorted.flatMap((p) => [p.cost_to_move_up_usd, p.cost_to_move_down_usd]),
    1,
  );

  return (
    <Card pad={0}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "160px 110px 110px 130px 1fr",
          padding: "10px 16px",
          gap: 12,
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <Label>PAIR</Label>
        <Label>MARKET</Label>
        <Label>PRICE</Label>
        <Label>TURNOVER 24H</Label>
        <Label>COST TO MOVE (DOWN | UP)</Label>
      </div>
      {sorted.map((p, i) => (
        <PairRow key={`${p.market}-${p.base}-${p.target}-${i}`} pair={p} maxLiq={maxLiq} />
      ))}
      <div
        className="flex justify-between items-center"
        style={{
          padding: "10px 16px",
          borderTop: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <Mono size={10}>
          showing {sorted.length} of {data.total} · sorted by turnover_24h
        </Mono>
      </div>
    </Card>
  );
}

function PairRow({ pair, maxLiq }: { pair: TradingPair; maxLiq: number }) {
  const downPct = (pair.cost_to_move_down_usd / maxLiq) * 100;
  const upPct = (pair.cost_to_move_up_usd / maxLiq) * 100;
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "160px 110px 110px 130px 1fr",
        padding: "10px 16px",
        gap: 12,
        borderBottom: `1px solid ${tokens.borderFaint}`,
      }}
    >
      <div className="font-mono" style={{ fontSize: 12, color: tokens.text }}>
        {pair.base.toUpperCase()}/{pair.target.toUpperCase()}
      </div>
      <Mono size={11} color={tokens.text}>
        {pair.market}
      </Mono>
      <Mono size={11} color={tokens.text}>
        {pair.price != null && Number.isFinite(pair.price)
          ? `$${pair.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : "—"}
      </Mono>
      <Mono size={11}>{fmtUsd(pair.turnover_24h)}</Mono>
      <div className="flex items-center gap-2">
        {/* down (red) bar — anchored right of center */}
        <div
          className="flex justify-end"
          style={{
            flex: 1,
            height: 14,
            background: tokens.bgElev2,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${downPct}%`, background: tokens.red }} />
        </div>
        <Mono size={10} color={tokens.red} style={{ minWidth: 60, textAlign: "right" }}>
          ↓ {fmtUsd(pair.cost_to_move_down_usd)}
        </Mono>
        <Mono size={10} color={tokens.emerald} style={{ minWidth: 60 }}>
          ↑ {fmtUsd(pair.cost_to_move_up_usd)}
        </Mono>
        <div
          style={{
            flex: 1,
            height: 14,
            background: tokens.bgElev2,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${upPct}%`, background: tokens.emerald }} />
        </div>
      </div>
    </div>
  );
}

// ---------- Fundraising tab ----------

function FundraisingTab({
  data,
}: {
  data: Awaited<ReturnType<typeof getCurrencyFundraising>>;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "2fr 1fr" }}>
      {/* Rounds */}
      <div className="flex flex-col gap-3">
        <Card>
          <div className="flex justify-between items-center mb-2">
            <Label>FUNDRAISING ROUNDS</Label>
            {data.twitter_username && (
              <Mono size={10}>@{data.twitter_username}</Mono>
            )}
          </div>
          {data.fundraising_rounds.length === 0 ? (
            <Mono size={11} color={tokens.textFaint}>
              No fundraising rounds disclosed for this currency.
            </Mono>
          ) : (
            <div className="flex flex-col gap-2.5">
              {data.fundraising_rounds.map((r, i) => (
                <RoundCard key={i} round={r} />
              ))}
            </div>
          )}
        </Card>

        {data.portfolio.length > 0 && (
          <Card>
            <Label className="mb-2">PORTFOLIO COMPANIES</Label>
            <div className="grid grid-cols-2 gap-2">
              {data.portfolio.map((p, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center"
                  style={{
                    padding: "8px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 6,
                  }}
                >
                  <span style={{ fontSize: 12, color: tokens.text }}>{p.name}</span>
                  <Tag small color={tokens.cyan}>
                    {p.sector}
                  </Tag>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Stats + Investors + Team sidebar */}
      <div className="flex flex-col gap-3">
        <Card>
          <Label className="mb-2">INVESTMENT STATS</Label>
          <div className="grid grid-cols-3 gap-2">
            <StatBox
              label="ROUNDS"
              value={String(data.investment_stats.total_rounds)}
              color={tokens.text}
            />
            <StatBox
              label="LEAD"
              value={String(data.investment_stats.lead_investments)}
              color={tokens.emerald}
            />
            <StatBox
              label="PORTFOLIO"
              value={String(data.investment_stats.portfolio_count)}
              color={tokens.cyan}
            />
          </div>
        </Card>

        <Card>
          <Label className="mb-2">INVESTORS</Label>
          {data.investors.length === 0 ? (
            <Mono size={11} color={tokens.textFaint}>
              No investor data published.
            </Mono>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.investors.map((inv, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center"
                  style={{
                    padding: "6px 0",
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                  }}
                >
                  <div style={{ fontSize: 12, color: tokens.text }}>{inv.name}</div>
                  <div className="flex gap-1">
                    {inv.is_lead_investor && (
                      <Tag small color={tokens.amber} filled>
                        Lead
                      </Tag>
                    )}
                    <Tag small>{inv.type}</Tag>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {data.team.length > 0 && (
          <Card>
            <Label className="mb-2">TEAM</Label>
            <div className="flex flex-col gap-1.5">
              {data.team.map((m, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center"
                  style={{ padding: "4px 0" }}
                >
                  <div style={{ fontSize: 12, color: tokens.text }}>{m.name}</div>
                  <Mono size={10}>{m.role}</Mono>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function RoundCard({ round }: { round: FundraisingRound }) {
  return (
    <div
      style={{
        padding: 14,
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 8,
      }}
    >
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <Tag small color={tokens.cyan} filled>
            {round.round}
          </Tag>
          <Mono size={10}>{round.date}</Mono>
        </div>
        <div className="flex gap-3">
          <div style={{ textAlign: "right" }}>
            <Mono size={10}>RAISED</Mono>
            <div
              style={{ fontSize: 14, fontWeight: 600, color: tokens.emerald }}
            >
              {fmtUsd(round.raised)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <Mono size={10}>VALUATION</Mono>
            <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>
              {fmtUsd(round.valuation)}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {round.investors.map((inv, i) => (
          <Tag
            key={i}
            small
            color={inv.is_lead_investor ? tokens.amber : tokens.textDim}
            filled={inv.is_lead_investor}
          >
            {inv.is_lead_investor ? `★ ${inv.name}` : inv.name}
          </Tag>
        ))}
      </div>
    </div>
  );
}

function StatBox({
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
        padding: "10px 8px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <Mono size={9}>{label}</Mono>
    </div>
  );
}
