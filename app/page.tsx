import Link from "next/link";
import { tokens } from "@/lib/tokens";
import { Card, Btn, Tag, Mono } from "@/components/ui";

export default function Landing() {
  return (
    <div className="min-h-screen relative overflow-hidden ambient-glow">
      <div className="max-w-[1100px] mx-auto px-8 py-16 relative">
        <div className="flex items-center gap-3 mb-10">
          <div
            className="flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.emeraldDim})`,
              boxShadow: `0 0 20px ${tokens.emerald}50`,
            }}
          >
            <svg width={18} height={18} viewBox="0 0 12 12">
              <path
                d="M 2 9 L 4 5 L 7 8 L 10 3"
                fill="none"
                stroke={tokens.bg}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="text-2xl font-semibold tracking-tight">HypeNode</div>
          <Tag color={tokens.emerald} small>
            v0.1
          </Tag>
        </div>

        <h1
          className="font-semibold mb-4"
          style={{ fontSize: 44, letterSpacing: "-0.03em", lineHeight: 1.1 }}
        >
          Autonomous on-chain index
          <br />
          <span style={{ color: tokens.emerald }}>research → execution.</span>
        </h1>
        <p
          className="max-w-[680px] mb-12"
          style={{ fontSize: 15, color: tokens.textDim, lineHeight: 1.6 }}
        >
          A LangGraph agent monitors SoSoValue Terminal sentiment + ETF fund flows,
          drafts index baskets, runs backtests, and ships to SSI Protocol via SoDEX —
          with a USSI emergency-exit hedge wired to your risk gates.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-10">
          <Card pad={20} className="hover:bg-bg-hover transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: tokens.emerald,
                  boxShadow: `0 0 8px ${tokens.emerald}`,
                }}
              />
              <Mono size={10} color={tokens.emerald}>
                INDEXER · 10 PAGES
              </Mono>
            </div>
            <div
              className="font-semibold mb-2"
              style={{ fontSize: 22, letterSpacing: "-0.02em" }}
            >
              HypeNode Autonomous Indexer
            </div>
            <p
              className="mb-5"
              style={{ fontSize: 13, color: tokens.textDim, lineHeight: 1.55 }}
            >
              Manage your own indices end-to-end. Dashboard, agent console with LangGraph
              state graph, MCP chat, backtesting lab, risk control with emergency exit,
              full transaction history.
            </p>
            <Link href="/dashboard">
              <Btn primary>Open Indexer →</Btn>
            </Link>
          </Card>

          <Card pad={20} className="hover:bg-bg-hover transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: tokens.amber,
                  boxShadow: `0 0 8px ${tokens.amber}`,
                }}
              />
              <Mono size={10} color={tokens.amber}>
                PUBLISHER · 6 PAGES
              </Mono>
            </div>
            <div
              className="font-semibold mb-2"
              style={{ fontSize: 22, letterSpacing: "-0.02em" }}
            >
              HypeIndex Publisher
            </div>
            <p
              className="mb-5"
              style={{ fontSize: 13, color: tokens.textDim, lineHeight: 1.55 }}
            >
              Creator product. Hype Radar surfaces sector momentum, agent drafts
              proposals you approve, your published indices accrue management +
              performance fees streamed in USDC.
            </p>
            <Link href="/publisher/radar">
              <Btn>Open Publisher →</Btn>
            </Link>
          </Card>
        </div>

        <Card pad={18}>
          <div className="grid grid-cols-4 gap-6">
            {[
              ["Research", "SoSoValue Terminal · sentiment × flow"],
              ["Agent", "LangGraph · MCP · 7 tools"],
              ["Execution", "SSI Protocol · SoDEX · ValueChain L1"],
              ["Risk", "Auto-hedge → USSI on σ + drawdown gates"],
            ].map(([k, v]) => (
              <div key={k}>
                <Mono size={9} color={tokens.textFaint}>
                  {k.toUpperCase()}
                </Mono>
                <div
                  className="mt-1"
                  style={{
                    fontSize: 12.5,
                    color: tokens.text,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div
          className="mt-10 text-center"
          style={{ color: tokens.textFaint, fontSize: 11 }}
        >
          <Mono size={10}>
            Frontend Next.js · Backend Node.js + Python LangGraph · MCP server
          </Mono>
        </div>
      </div>
    </div>
  );
}
