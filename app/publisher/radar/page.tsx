import { Card, Mono, Tag, Btn, HypeGauge } from "@/components/ui";
import { tokens } from "@/lib/tokens";

const gauges = [
  { s: "DePIN", v: 92, d: "+38", news: "127" },
  { s: "RWA", v: 78, d: "+21", news: "84" },
  { s: "AI", v: 71, d: "+14", news: "142" },
  { s: "Memes", v: 64, d: "+9", news: "218" },
  { s: "DeFi", v: 52, d: "+2", news: "61" },
  { s: "L2", v: 44, d: "−3", news: "47" },
  { s: "Gaming", v: 31, d: "−8", news: "29" },
  { s: "NFT", v: 18, d: "−14", news: "22" },
];

const news = [
  { t: "2m", h: "Filecoin storage demand jumps 38% QoQ, enterprise contracts expand", s: "Messari", sent: 92, imp: "high" },
  { t: "8m", h: "Helium network passes 1M devices, mobile subscriber growth accelerates", s: "The Block", sent: 84, imp: "high" },
  { t: "14m", h: "Render Network Q3: 42% throughput increase, new AI studio partnerships", s: "Decrypt", sent: 78, imp: "med" },
  { t: "22m", h: "Akash beats AWS on GPU spot pricing, ML workloads migrating", s: "CoinDesk", sent: 76, imp: "med" },
  { t: "31m", h: "Arweave permaweb hits 200TB, archival grant program launches", s: "Bankless", sent: 64, imp: "med" },
  { t: "48m", h: "IoTeX unveils DePIN developer stack 2.0", s: "Messari", sent: 58, imp: "low" },
  { t: "1h", h: "Dimo vehicle network crosses 200k connected cars", s: "CT", sent: 52, imp: "low" },
];

const events = [
  { t: "now", s: "DePIN", status: "Drafting proposal", c: tokens.amber, sub: "11 assets · score 92" },
  { t: "2d ago", s: "RWA", status: "Published — HYPE-RWA-7", c: tokens.emerald, sub: "earned $312 · 64 subs" },
  { t: "5d ago", s: "AI Agents", status: "Published — AI-AGENT-5", c: tokens.emerald, sub: "earned $184 · 41 subs" },
  { t: "8d ago", s: "Memes", status: "Rejected by you", c: tokens.textFaint, sub: "confidence too low" },
  { t: "12d ago", s: "L2 Restaking", status: "Published — RESTK-L2", c: tokens.emerald, sub: "earned $512 · 89 subs" },
  { t: "18d ago", s: "Solana DeFi", status: "Published — SOL-DEFI-6", c: tokens.emerald, sub: "earned $248 · 52 subs" },
];

export default function RadarPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Hype Radar</div>
          <Mono size={11}>
            SoSoValue Terminal · news sentiment × sector classification · live
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>⚙ Tune sensitivity</Btn>
          <Btn small>📥 Pause detection</Btn>
        </div>
      </div>

      <div
        className="flex items-center gap-3"
        style={{
          padding: "12px 16px",
          background: `linear-gradient(90deg, ${tokens.amber}15, transparent)`,
          border: `1px solid ${tokens.amber}50`,
          borderRadius: 8,
        }}
      >
        <div
          className="animate-[pulse-glow_1.2s_ease-in-out_infinite]"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: tokens.amber,
            boxShadow: `0 0 12px ${tokens.amber}`,
          }}
        />
        <div className="flex-1">
          <div style={{ fontSize: 13, fontWeight: 600, color: tokens.amber }}>
            Fresh hype detected — DePIN sector
          </div>
          <Mono size={11} color={tokens.textDim}>
            news volume +340% vs 7d baseline · sentiment +92 · 11 assets flagged · agent drafting proposal
          </Mono>
        </div>
        <Btn small primary>Review draft →</Btn>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
        <div className="flex flex-col gap-3">
          <Card pad={16}>
            <div className="flex justify-between mb-3.5">
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Sector hype scores</div>
                <Mono size={10}>news Δ × sentiment × velocity · last 1h</Mono>
              </div>
              <Mono size={10}>updated 2s ago</Mono>
            </div>
            <div className="grid grid-cols-4 gap-3.5">
              {gauges.map((g, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-1.5"
                  style={{
                    padding: 12,
                    background:
                      g.v > 80
                        ? tokens.red + "08"
                        : g.v > 60
                          ? tokens.amber + "06"
                          : tokens.bgElev2,
                    border: `1px solid ${g.v > 80 ? tokens.red + "40" : g.v > 60 ? tokens.amber + "40" : tokens.border}`,
                    borderRadius: 8,
                  }}
                >
                  <HypeGauge score={g.v} sector={g.s} size={84} />
                  <div className="flex gap-2 justify-center">
                    <Mono size={9.5} color={g.d.startsWith("+") ? tokens.emerald : tokens.red}>
                      Δ {g.d}
                    </Mono>
                    <Mono size={9.5}>{g.news} news</Mono>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
            <div
              className="flex justify-between items-center"
              style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>Trending news · DePIN</div>
              <div className="flex gap-1">
                {["All", "DePIN", "RWA", "AI"].map((t, i) => (
                  <Tag key={t} small filled={i === 1} color={i === 1 ? tokens.text : tokens.textDim}>
                    {t}
                  </Tag>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {news.map((n, i) => (
                <div
                  key={i}
                  className="flex gap-2.5 items-center"
                  style={{ padding: "11px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
                >
                  <Mono size={10} color={tokens.textFaint} style={{ minWidth: 32 }}>
                    {n.t}
                  </Mono>
                  <div
                    style={{
                      width: 3,
                      alignSelf: "stretch",
                      background: n.imp === "high" ? tokens.red : n.imp === "med" ? tokens.amber : tokens.borderStrong,
                      borderRadius: 2,
                    }}
                  />
                  <div className="flex-1">
                    <div
                      style={{
                        fontSize: 12.5,
                        color: tokens.text,
                        lineHeight: 1.4,
                        fontWeight: 500,
                      }}
                    >
                      {n.h}
                    </div>
                    <Mono size={10} className="mt-0.5 block">
                      {n.s}
                    </Mono>
                  </div>
                  <Mono size={11} color={n.sent > 70 ? tokens.emerald : tokens.amber}>
                    +{n.sent}
                  </Mono>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <Card pad={16}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Hype detection rules</div>
            <Mono size={10} className="block mb-2.5">trigger: agent drafts proposal</Mono>
            {[
              ["News volume Δ > +200% in 4h", tokens.emerald],
              ["Avg sentiment > 70", tokens.emerald],
              ["At least 3 assets in cluster", tokens.emerald],
              ["Funding / inflow signal aligned", tokens.emerald],
              ["Exclude if sentiment reversed < 24h", tokens.amber],
            ].map(([r, c], i) => (
              <div
                key={i}
                className="flex items-center gap-2"
                style={{ padding: "5px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: (c as string) + "20",
                    border: `1px solid ${c as string}40`,
                  }}
                >
                  <svg width={8} height={8} viewBox="0 0 8 8">
                    <path
                      d="M 1 4 L 3 6 L 7 2"
                      fill="none"
                      stroke={c as string}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div style={{ fontSize: 11.5, color: tokens.text, flex: 1 }}>{r}</div>
              </div>
            ))}
          </Card>

          <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
            <div
              style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}`, fontSize: 13, fontWeight: 600 }}
            >
              Recent hype events
            </div>
            <div className="flex-1 overflow-y-auto">
              {events.map((e, i) => (
                <div
                  key={i}
                  style={{ padding: "10px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
                >
                  <div className="flex justify-between mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: e.c }} />
                      <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>{e.s}</div>
                    </div>
                    <Mono size={10}>{e.t}</Mono>
                  </div>
                  <div style={{ fontSize: 11, color: e.c }}>{e.status}</div>
                  <Mono size={10} className="mt-0.5 block">{e.sub}</Mono>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
