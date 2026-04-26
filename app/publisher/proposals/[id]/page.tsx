import Link from "next/link";
import { Card, Label, Metric, Mono, Tag, Btn, Meter, HypeGauge } from "@/components/ui";
import { tokens } from "@/lib/tokens";

const constituents: [string, string, number, string, number, string][] = [
  ["FIL", "Filecoin", 92, "5.0B", 22, "Enterprise storage news"],
  ["RNDR", "Render", 78, "3.2B", 18, "Throughput Q3 beat"],
  ["HNT", "Helium", 84, "1.1B", 15, "1M device milestone"],
  ["AR", "Arweave", 64, "0.8B", 12, "Archival grant"],
  ["AKT", "Akash", 76, "0.6B", 11, "GPU pricing vs AWS"],
  ["IOTX", "IoTeX", 58, "0.4B", 9, "Dev stack 2.0"],
  ["DIMO", "Dimo", 52, "0.2B", 8, "200k cars milestone"],
  ["ATH", "Aethir", 44, "0.3B", 5, "Neutral · diversifier"],
];

export default function ProposalReviewPage({ params }: { params: { id: string } }) {
  return (
    <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-52px)]">
      <div className="flex items-center gap-2 font-mono" style={{ fontSize: 11, color: tokens.textDim }}>
        <Link href="/publisher/proposals" style={{ cursor: "pointer" }}>
          Proposals
        </Link>
        <span>/</span>
        <span style={{ color: tokens.text }}>HYPE-DEPIN-8</span>
        <span style={{ marginLeft: 8, color: tokens.textFaint }}>· {params.id}</span>
        <div className="flex-1" />
        <Tag small color={tokens.amber} dot>
          awaiting your approval · expires 5h 54m
        </Tag>
      </div>

      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1fr 360px" }}>
        <div className="flex flex-col gap-3 overflow-y-auto">
          <Card pad={18}>
            <div className="flex items-center gap-3.5">
              <div
                className="flex items-center justify-center font-mono"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${tokens.amber}, ${tokens.red})`,
                  fontSize: 14,
                  fontWeight: 700,
                  color: tokens.bg,
                  boxShadow: `0 0 22px ${tokens.amber}50`,
                }}
              >
                H8
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-2.5">
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
                    HYPE-DEPIN-8
                  </div>
                  <Tag small color={tokens.amber} filled>
                    DePIN
                  </Tag>
                </div>
                <Mono size={11} className="mt-1 block">
                  agent-drafted · sentiment-weighted · 8 constituents · publish to SSI Protocol
                </Mono>
              </div>
              <HypeGauge score={94} sector="CONFIDENCE" size={84} />
            </div>
          </Card>

          <Card pad={16}>
            <div className="flex justify-between mb-2.5">
              <div style={{ fontSize: 13, fontWeight: 600 }}>Why agent proposed this</div>
              <Mono size={10}>model: claude-sonnet-4.5 · 2.1s reasoning</Mono>
            </div>
            <div className="grid grid-cols-4 gap-2.5 mb-3">
              {[
                { k: "NEWS Δ (4h)", v: "+340%", c: tokens.emerald },
                { k: "AVG SENTIMENT", v: "+92", c: tokens.emerald },
                { k: "ASSETS IN CLUSTER", v: "11", c: tokens.cyan },
                { k: "FRESHNESS", v: "6m ago", c: tokens.amber },
              ].map((k, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 12px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 6,
                  }}
                >
                  <Label>{k.k}</Label>
                  <Metric v={k.v} color={k.c} size={19} style={{ marginTop: 4 }} />
                </div>
              ))}
            </div>
            <div
              style={{
                padding: 12,
                background: tokens.cyan + "08",
                border: `1px solid ${tokens.cyan}30`,
                borderRadius: 6,
                fontSize: 13,
                color: tokens.text,
                lineHeight: 1.6,
              }}
            >
              <span style={{ color: tokens.cyan, fontWeight: 600 }}>Summary:</span> DePIN sector
              news velocity spiked 340% vs 7-day baseline, driven by enterprise storage contract
              announcements (Filecoin +38% QoQ demand) and Helium device milestone (&gt;1M).
              Sentiment score cleared +90 for &gt;45min — well above your 70 threshold. Selected 8
              of 11 candidates after filtering for liquidity &gt;$5M daily and CEX presence.
              Weights computed via{" "}
              <span style={{ color: tokens.emerald }}>sentiment × log(mcap)</span>.
            </div>
          </Card>

          <Card pad={0}>
            <div
              className="flex justify-between items-center"
              style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>Constituents · you can adjust</div>
              <Btn small>+ Add asset</Btn>
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: "2fr 1fr 0.8fr 1.5fr 1fr",
                padding: "8px 16px",
                gap: 10,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              {["ASSET", "SENTIMENT", "MCAP", "WEIGHT", "REASONING"].map((k) => (
                <Label key={k}>{k}</Label>
              ))}
            </div>
            {constituents.map(([sym, n, s, cap, w, r], i) => (
              <div
                key={i}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "2fr 1fr 0.8fr 1.5fr 1fr",
                  padding: "10px 16px",
                  gap: 10,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex items-center justify-center font-mono"
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 5,
                      background: tokens.bgElev2,
                      border: `1px solid ${tokens.border}`,
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: tokens.emerald,
                    }}
                  >
                    {(sym as string).slice(0, 3)}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{n}</div>
                    <Mono size={9.5}>{sym}</Mono>
                  </div>
                </div>
                <Mono
                  size={11}
                  color={(s as number) > 70 ? tokens.emerald : (s as number) > 50 ? tokens.amber : tokens.textDim}
                >
                  +{s}
                </Mono>
                <Mono size={10}>${cap}</Mono>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Meter v={(w as number) / 25} color={tokens.amber} h={4} />
                  </div>
                  <div
                    className="flex items-center"
                    style={{
                      gap: 2,
                      background: tokens.bgElev2,
                      border: `1px solid ${tokens.border}`,
                      borderRadius: 4,
                      padding: "2px 6px",
                      minWidth: 58,
                    }}
                  >
                    <Mono size={10.5} color={tokens.text}>
                      {w}
                    </Mono>
                    <Mono size={9}>%</Mono>
                  </div>
                </div>
                <Mono size={10}>{r}</Mono>
              </div>
            ))}
            <div
              className="flex justify-between"
              style={{ padding: "10px 16px", background: tokens.bgElev2 }}
            >
              <Mono size={11}>Total weight</Mono>
              <Mono size={11} color={tokens.emerald}>100.00% ✓</Mono>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-2.5 overflow-y-auto">
          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Publishing settings</div>
            {[
              ["Index symbol", "HDP8"],
              ["Management fee", "1.00%"],
              ["Performance fee", "10.00%"],
              ["Rebalance", "daily (sentiment)"],
              ["Min subscription", "$100"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between"
                style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10}>{k}</Mono>
                <Mono size={11} color={tokens.text}>{v}</Mono>
              </div>
            ))}
          </Card>

          <Card pad={14} style={{ background: tokens.emerald + "06", borderColor: tokens.emerald + "30" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: tokens.emerald }}>
              Your projected earnings
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>EST. SUBS (30d)</Label>
                <Metric v="70–120" size={18} style={{ marginTop: 3 }} />
              </div>
              <div>
                <Label>EST. EARNINGS</Label>
                <Metric v="$280–$480" size={18} color={tokens.emerald} style={{ marginTop: 3 }} />
              </div>
            </div>
            <Mono size={10} className="mt-2.5 block">
              based on your last 12 published indices · confidence: moderate
            </Mono>
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Pre-publish checks</div>
            {[
              "Weights sum to 100%",
              "All assets ≥ $5M daily vol",
              "No duplicate sector index (30d)",
              "Fee schedule within platform bounds",
              "Disclaimer attached",
            ].map((l, i) => (
              <div key={i} className="flex items-center gap-1.5" style={{ padding: "4px 0" }}>
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: tokens.emerald + "20",
                  }}
                >
                  <svg width={8} height={8} viewBox="0 0 8 8">
                    <path
                      d="M 1 4 L 3 6 L 7 2"
                      fill="none"
                      stroke={tokens.emerald}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div style={{ fontSize: 11.5, color: tokens.text }}>{l}</div>
              </div>
            ))}
          </Card>

          <div className="flex flex-col gap-1.5">
            <Btn primary style={{ justifyContent: "center", padding: "10px 16px", fontSize: 13 }}>
              ✓ Sign &amp; Publish to SSI
            </Btn>
            <Btn small style={{ justifyContent: "center" }}>
              Save as draft
            </Btn>
            <Btn small style={{ justifyContent: "center", color: tokens.textDim }}>
              Reject proposal
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
