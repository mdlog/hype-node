import Link from "next/link";
import { Card, Mono, Tag, Btn, HypeGauge } from "@/components/ui";
import { tokens } from "@/lib/tokens";

type Proposal = {
  id: string;
  sector: string;
  name: string;
  conf: number;
  trigger: string;
  assets: [string, number][];
  proj: string;
  time: string;
  highlight: boolean;
};

const proposals: Proposal[] = [
  {
    id: "depin-8",
    sector: "DePIN",
    name: "HYPE-DEPIN-8",
    conf: 94,
    trigger: "News Δ +340% · sentiment +92 · 11 assets clustered",
    assets: [
      ["FIL", 22],
      ["RNDR", 18],
      ["HNT", 15],
      ["AR", 12],
      ["AKT", 11],
      ["IOTX", 9],
      ["DIMO", 8],
      ["ATH", 5],
    ],
    proj: "Est. subs: 70–120 · proj. 30d earnings $280–$480",
    time: "drafted 6m ago · expires in 5h 54m",
    highlight: true,
  },
  {
    id: "rwa-tbill-5",
    sector: "RWA",
    name: "HYPE-RWA-TBILL-5",
    conf: 76,
    trigger: "Tokenized T-bill news +180% · Ondo + BlackRock headlines",
    assets: [
      ["ONDO", 30],
      ["MKR", 22],
      ["USDY", 18],
      ["RLB", 16],
      ["TPROT", 14],
    ],
    proj: "Est. subs: 40–80 · proj. 30d earnings $120–$260",
    time: "drafted 1h ago · expires in 5h",
    highlight: false,
  },
  {
    id: "ai-agent-6",
    sector: "AI Agents",
    name: "HYPE-AI-AGENT-6",
    conf: 68,
    trigger: "Agent framework launches · Virtuals + AI16Z momentum",
    assets: [
      ["VIRTUAL", 24],
      ["AI16Z", 20],
      ["AIXBT", 18],
      ["GAME", 14],
      ["FAI", 13],
      ["ARC", 11],
    ],
    proj: "Est. subs: 30–60 · proj. 30d earnings $80–$180",
    time: "drafted 3h ago · expires in 3h",
    highlight: false,
  },
];

const palette = [tokens.emerald, tokens.cyan, tokens.amber, "#a78bfa", "#34d399", "#60a5fa", "#fbbf24", "#f472b6"];

export default function ProposalsPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Pending Proposals
          </div>
          <Mono size={11}>
            3 drafts from agent awaiting your approval · each expires in 6h if untouched
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Rejected (4)</Btn>
          <Btn small>Published (12)</Btn>
        </div>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto">
        {proposals.map((p, i) => (
          <Card
            key={i}
            pad={0}
            style={{
              borderColor: p.highlight ? tokens.amber + "50" : tokens.border,
              boxShadow: p.highlight
                ? `0 0 0 1px ${tokens.amber}15, 0 4px 20px ${tokens.amber}10`
                : undefined,
            }}
          >
            <div
              className="grid items-center"
              style={{ padding: 16, gridTemplateColumns: "auto 1fr auto", gap: 20 }}
            >
              <div className="flex flex-col items-center">
                <HypeGauge score={p.conf} sector="AGENT CONFIDENCE" size={84} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Tag small color={tokens.amber} filled>
                    {p.sector}
                  </Tag>
                  {p.highlight && (
                    <Tag small color={tokens.red} dot>
                      hot
                    </Tag>
                  )}
                  <Mono size={10}>{p.time}</Mono>
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    marginBottom: 6,
                  }}
                >
                  {p.name}
                </div>
                <div style={{ fontSize: 12, color: tokens.textDim, marginBottom: 10, lineHeight: 1.4 }}>
                  <span style={{ color: tokens.cyan }}>Trigger:</span> {p.trigger}
                </div>
                <div
                  className="flex"
                  style={{
                    height: 28,
                    borderRadius: 5,
                    overflow: "hidden",
                    background: tokens.bgElev2,
                    marginBottom: 6,
                  }}
                >
                  {p.assets.map(([a, w], j) => (
                    <div
                      key={j}
                      className="flex items-center justify-center font-mono"
                      style={{
                        width: `${w}%`,
                        background: palette[j],
                        color: tokens.bg,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {w >= 10 ? a : ""}
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 flex-wrap">
                  {p.assets.map(([a, w], j) => (
                    <Mono key={j} size={10} color={tokens.textDim}>
                      {a} {w}%
                    </Mono>
                  ))}
                </div>
                <Mono size={11} color={tokens.emerald} className="mt-2 block">
                  💰 {p.proj}
                </Mono>
              </div>
              <div className="flex flex-col gap-1.5" style={{ minWidth: 160 }}>
                <Link href={`/publisher/proposals/${p.id}`} className="contents">
                  <Btn primary style={{ justifyContent: "center" }}>
                    Review &amp; Publish →
                  </Btn>
                </Link>
                <Btn small style={{ justifyContent: "center" }}>
                  Edit weights
                </Btn>
                <Btn small style={{ justifyContent: "center", color: tokens.textDim }}>
                  Reject
                </Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
