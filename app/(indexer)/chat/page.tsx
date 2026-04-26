import { Mono, Tag, Btn } from "@/components/ui";
import { ChatComposer } from "@/components/live/ChatComposer";
import { tokens } from "@/lib/tokens";

const conversations = [
  { t: "DePIN opportunities", s: "now", on: true, m: "4 tool calls · 2 actions" },
  { t: "Backtest HDP8 vs BTC", s: "2h", on: false, m: "90d window" },
  { t: "Rebalance AIM3?", s: "yest", on: false, m: "declined" },
  { t: "Explain sentiment model", s: "3d", on: false, m: "educational" },
  { t: "Emergency exit scenarios", s: "1w", on: false, m: "4 scenarios ran" },
];

const tools = [
  "terminal.get_sentiment",
  "terminal.get_fund_flow",
  "terminal.get_news",
  "backtest.run",
  "ssi.wrap / unwrap",
  "sodex.execute_trade",
  "risk.check_thresholds",
];

export default function ChatPage() {
  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "240px 1fr 280px" }}>
      <div
        className="flex flex-col gap-1.5 overflow-y-auto"
        style={{ padding: 14, borderRight: `1px solid ${tokens.border}` }}
      >
        <div className="flex justify-between items-center mb-2">
          <div style={{ fontSize: 13, fontWeight: 600 }}>Conversations</div>
          <Btn small>+ New</Btn>
        </div>
        {conversations.map((c, i) => (
          <div
            key={i}
            style={{
              padding: "9px 10px",
              background: c.on ? tokens.bgElev2 : "transparent",
              border: `1px solid ${c.on ? tokens.border : "transparent"}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            <div className="flex justify-between">
              <div style={{ fontSize: 12, fontWeight: c.on ? 600 : 500, color: c.on ? tokens.text : tokens.textDim }}>
                {c.t}
              </div>
              <Mono size={9}>{c.s}</Mono>
            </div>
            <Mono size={10} className="mt-0.5 block">
              {c.m}
            </Mono>
          </div>
        ))}
        <div className="flex-1" />
        <div
          style={{
            padding: "10px 12px",
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
          }}
        >
          <Mono size={10} color={tokens.cyan}>MCP · Model Context Protocol</Mono>
          <Mono size={10} className="mt-0.5 block">7 tools · 3 connectors</Mono>
        </div>
      </div>

      <div className="flex flex-col overflow-hidden">
        <div
          className="flex justify-between items-end"
          style={{ padding: "14px 20px", borderBottom: `1px solid ${tokens.border}` }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>DePIN opportunities</div>
            <Mono size={10}>4 tool calls · 2 actions executed · 3m elapsed</Mono>
          </div>
          <Btn small>Export transcript</Btn>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3.5" style={{ padding: 20 }}>
          <div style={{ alignSelf: "flex-end", maxWidth: "70%" }}>
            <div
              style={{
                padding: "10px 14px",
                background: tokens.cyan + "12",
                border: `1px solid ${tokens.cyan}30`,
                borderRadius: 10,
                color: tokens.text,
                fontSize: 13.5,
                lineHeight: 1.5,
              }}
            >
              Show me DePIN opportunities and build a top-8 index if sentiment is above 60.
            </div>
            <Mono size={9} style={{ textAlign: "right", marginTop: 4 }}>you · 09:41</Mono>
          </div>

          <div style={{ maxWidth: "80%" }}>
            <div
              style={{
                padding: "12px 14px",
                background: tokens.bgElev,
                border: `1px solid ${tokens.border}`,
                borderRadius: 10,
              }}
            >
              <div className="flex gap-1.5 items-center mb-2">
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.emeraldDim})`,
                  }}
                >
                  <svg width={10} height={10} viewBox="0 0 12 12">
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
                <div style={{ fontSize: 12, fontWeight: 600 }}>Agent</div>
                <Mono size={9}>4 tool calls · 4.2s</Mono>
              </div>
              <div style={{ fontSize: 13.5, color: tokens.text, lineHeight: 1.55, marginBottom: 10 }}>
                Scanning DePIN sector… found 11 assets with sentiment &gt; 60. Top 8 by combined sentiment × flow:
              </div>
              <div
                className="font-mono"
                style={{
                  padding: 10,
                  background: tokens.bgElev2,
                  border: `1px solid ${tokens.borderFaint}`,
                  borderRadius: 6,
                  fontSize: 10.5,
                  color: tokens.textDim,
                  lineHeight: 1.8,
                }}
              >
                <div>
                  ↳ <span style={{ color: tokens.cyan }}>terminal.get_sector</span>(sector="DePIN")
                </div>
                <div>
                  ↳ <span style={{ color: tokens.cyan }}>terminal.get_sentiment</span>(assets=[FIL,RNDR,HNT,AR,AKT,IOTX,DIMO,ATH,+3])
                </div>
                <div>
                  ↳ <span style={{ color: tokens.cyan }}>terminal.get_fund_flow</span>(assets=[...], window="24h")
                </div>
                <div>
                  ↳ <span style={{ color: tokens.cyan }}>backtest.run</span>(N=8, days=90, weighting="sentiment")
                </div>
              </div>
              <div style={{ fontSize: 13.5, color: tokens.text, lineHeight: 1.55, marginTop: 10 }}>
                Proposed basket:{" "}
                <Mono size={12} color={tokens.emerald}>
                  FIL, RNDR, HNT, AR, AKT, IOTX, DIMO, ATH
                </Mono>
                . Sentiment-weighted. Backtest Sharpe{" "}
                <Mono size={12} color={tokens.emerald}>
                  1.82
                </Mono>{" "}
                over 90d. Shall I deploy?
              </div>
              <div className="flex gap-1.5 mt-3">
                <Btn small primary>Deploy to SSI</Btn>
                <Btn small>Open in Builder</Btn>
                <Btn small>Adjust weights</Btn>
              </div>
            </div>
            <Mono size={9} className="mt-1 block">agent · 09:41</Mono>
          </div>

          <div style={{ alignSelf: "flex-end", maxWidth: "70%" }}>
            <div
              style={{
                padding: "10px 14px",
                background: tokens.cyan + "12",
                border: `1px solid ${tokens.cyan}30`,
                borderRadius: 10,
                color: tokens.text,
                fontSize: 13.5,
                lineHeight: 1.5,
              }}
            >
              Cap any single asset at 20% and arm emergency exit to USSI if σ &gt; 0.3.
            </div>
            <Mono size={9} style={{ textAlign: "right", marginTop: 4 }}>you · 09:42</Mono>
          </div>

          <div style={{ maxWidth: "80%" }}>
            <div
              style={{
                padding: "12px 14px",
                background: tokens.bgElev,
                border: `1px solid ${tokens.border}`,
                borderRadius: 10,
              }}
            >
              <div className="flex gap-1.5 items-center mb-2">
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.emeraldDim})`,
                  }}
                />
                <div style={{ fontSize: 12, fontWeight: 600 }}>Agent</div>
                <Tag small color={tokens.emerald} dot>applied</Tag>
              </div>
              <div style={{ fontSize: 13.5, color: tokens.text, lineHeight: 1.55 }}>
                Caps applied. FIL{" "}
                <Mono size={12} color={tokens.amber}>
                  22 → 20%
                </Mono>
                , redistributed to AR, AKT. Emergency exit armed:{" "}
                <Mono size={12} color={tokens.red}>
                  σ &gt; 0.3 → USSI
                </Mono>
                . Deploying in 3…
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: 14, borderTop: `1px solid ${tokens.border}` }}>
          <ChatComposer />
        </div>
      </div>

      <div
        className="flex flex-col gap-2.5 overflow-y-auto"
        style={{ padding: 14, borderLeft: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>MCP tools available</div>
        {tools.map((t, i) => (
          <div
            key={i}
            className="flex justify-between items-center"
            style={{
              padding: "7px 10px",
              background: tokens.bgElev,
              border: `1px solid ${tokens.border}`,
              borderRadius: 5,
            }}
          >
            <Mono size={10.5} color={tokens.text}>{t}</Mono>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: tokens.emerald,
                boxShadow: `0 0 6px ${tokens.emerald}`,
              }}
            />
          </div>
        ))}
        <div style={{ height: 1, background: tokens.border, margin: "6px 0" }} />
        <div style={{ fontSize: 12, fontWeight: 600 }}>Session context</div>
        {[
          ["Portfolio", "HDP8 · RWA7 · AIM3"],
          ["Risk profile", "Moderate"],
          ["Auto-execute", "On (with confirm)"],
          ["Gas budget", "0.5 VAL / day"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <Mono size={10}>{k}</Mono>
            <Mono size={10} color={tokens.text}>{v}</Mono>
          </div>
        ))}
      </div>
    </div>
  );
}
