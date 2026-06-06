import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { tokens } from "@/lib/tokens";
import { SignInButton } from "@/components/auth/SignInButton";
import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { roleHomeHref } from "@/lib/auth/role";

export const dynamic = "force-dynamic";

const PALETTE = {
  bg: "#05070a",
  bg2: "#0A0E13",
  bg3: "#0F141B",
  bg4: "#161C25",
  line: "#1C232C",
  line2: "#2A3340",
  text: "#E6EAF0",
  dim: "#9AA4B2",
  faint: "#5E6877",
  emerald: tokens.emerald,
  emeraldDim: "#059669",
  cyan: tokens.cyan,
  amber: tokens.amber,
  red: tokens.red,
  violet: "#A78BFA",
};

const MONO_STACK = '"JetBrains Mono", monospace';

export default async function Landing() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (session.address) {
    redirect(
      session.preferredRole ? roleHomeHref(session.preferredRole) : "/onboarding/role",
    );
  }

  return (
    <div style={{ background: PALETTE.bg, color: PALETTE.text, minHeight: "100vh" }}>
      <TopNav />
      <Hero />
      <Products />
      <HowItWorks />
      <Architecture />
      <Numbers />
      <FAQ />
      <CTA />
      <Footer />
    </div>
  );
}

/* ---------------------------------- NAV ---------------------------------- */

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-hypenode.png"
        alt="HypeNode"
        width={42}
        height={42}
        style={{ display: "block" }}
      />
      <span style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: 16 }}>HypeNode</span>
      <span
        style={{
          fontFamily: MONO_STACK,
          fontSize: 9.5,
          color: PALETTE.emerald,
          padding: "2px 6px",
          background: "rgba(16,185,129,0.12)",
          borderRadius: 4,
          marginLeft: 4,
        }}
      >
        v0.4
      </span>
    </div>
  );
}

function TopNav() {
  return (
    <nav
      className="hype-nav"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: `1px solid ${PALETTE.line}`,
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "0 32px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Logo />
        <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
          <a className="hype-nav-link" href="#products">Products</a>
          <a className="hype-nav-link" href="#how">How it works</a>
          <a className="hype-nav-link" href="#stack">Stack</a>
          <a className="hype-nav-link" href="#docs">Docs</a>
          <a className="hype-nav-link" href="#pricing">Pricing</a>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <a className="hype-btn" href="/api/demo/enter" style={{ fontSize: 12.5 }}>
            Try demo →
          </a>
          <SignInButton />
        </div>
      </div>
    </nav>
  );
}

/* ---------------------------------- HERO --------------------------------- */

function Pill({
  amber = false,
  children,
}: {
  amber?: boolean;
  children: React.ReactNode;
}) {
  const dotColor = amber ? PALETTE.amber : PALETTE.emerald;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 11px 5px 8px",
        background: PALETTE.bg3,
        border: `1px solid ${PALETTE.line2}`,
        borderRadius: 999,
        fontSize: 11.5,
        color: PALETTE.dim,
      }}
    >
      <span
        className="hype-pulse"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: `0 0 8px ${dotColor}`,
        }}
      />
      {children}
    </span>
  );
}

function Hero() {
  return (
    <section
      className="hype-hero-glow hype-hero-grid"
      style={{
        position: "relative",
        padding: "96px 0 80px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1240,
          margin: "0 auto",
          padding: "0 32px",
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
          <Pill>
            <span style={{ fontFamily: MONO_STACK }}>AGENT ACTIVE</span> · 11 sectors monitored
          </Pill>
          <Pill amber>
            <span style={{ fontFamily: MONO_STACK }}>DEPIN HYPE +340%</span> · drafting
          </Pill>
        </div>
        <h1
          style={{
            fontSize: 68,
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            fontWeight: 700,
            maxWidth: 920,
          }}
        >
          <span className="hype-title-grad">
            Autonomous on-chain index
            <br />
          </span>
          <span className="hype-accent-grad">research → execution.</span>
        </h1>
        <p
          style={{
            marginTop: 22,
            fontSize: 18,
            lineHeight: 1.55,
            color: PALETTE.dim,
            maxWidth: 640,
          }}
        >
          A LangGraph agent monitors SoSoValue Terminal sentiment + ETF fund flows, drafts index
          baskets, runs backtests, and ships to SSI Protocol via SoDEX — with a USSI emergency-exit
          hedge wired to your risk gates.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 36, alignItems: "center", flexWrap: "wrap" }}>
          <SignInButton className="hype-btn primary lg" label="Start free trial →" />
          <a className="hype-btn lg" href="/api/demo/enter">Try demo (no wallet) →</a>
          <a className="hype-btn lg" href="#how">See how it works</a>
          <span
            style={{
              fontFamily: MONO_STACK,
              fontSize: 11,
              color: PALETTE.faint,
              marginLeft: 8,
            }}
          >
            no card · 14 days
          </span>
        </div>

        <div
          style={{
            marginTop: 56,
            display: "flex",
            alignItems: "center",
            gap: 32,
            color: PALETTE.faint,
            fontSize: 12,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: MONO_STACK,
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            Built on
          </span>
          {["SoSoValue Terminal", "SSI Protocol", "SoDEX", "ValueChain L1", "LangGraph + MCP"].map(
            (t, i, arr) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 32 }}>
                <span style={{ fontFamily: MONO_STACK }}>{t}</span>
                {i < arr.length - 1 && <span style={{ color: PALETTE.line2 }}>·</span>}
              </span>
            )
          )}
        </div>

        <LivePreviewPanel />
      </div>
    </section>
  );
}

/* ----------------------------- LIVE PREVIEW ------------------------------ */

function LivePreviewPanel() {
  return (
    <div
      style={{
        position: "relative",
        marginTop: 72,
        background: `linear-gradient(180deg, ${PALETTE.bg2} 0%, ${PALETTE.bg3} 100%)`,
        border: `1px solid ${PALETTE.line}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow:
          "0 0 0 1px rgba(16,185,129,0.05), 0 30px 80px -10px rgba(0,0,0,0.6), 0 0 80px -20px rgba(16,185,129,0.15)",
      }}
    >
      <div
        style={{
          height: 38,
          borderBottom: `1px solid ${PALETTE.line}`,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 14,
          background: PALETTE.bg2,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{ width: 10, height: 10, borderRadius: "50%", background: PALETTE.line2 }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: 22,
            background: PALETTE.bg3,
            border: `1px solid ${PALETTE.line}`,
            borderRadius: 5,
            padding: "0 10px",
            display: "flex",
            alignItems: "center",
            fontFamily: MONO_STACK,
            fontSize: 10.5,
            color: PALETTE.faint,
          }}
        >
          <span style={{ color: PALETTE.emerald, marginRight: 8 }}>🔒</span>
          <span>app.hypenode.ai/dashboard</span>
        </div>
        <span style={{ fontFamily: MONO_STACK, fontSize: 10, color: PALETTE.faint }}>
          live preview
        </span>
      </div>
      <div
        style={{
          padding: 22,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1.1fr",
          gap: 18,
        }}
      >
        <PanelCard title="Portfolio NAV · HDP8">
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
            $1.182{" "}
            <span style={{ fontSize: 12, color: PALETTE.emerald, marginLeft: 8, fontWeight: 500 }}>
              +18.2%
            </span>
          </div>
          <MiniChart />
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <Gauge label="SHARPE" value="2.14" pct={72} color={PALETTE.emerald} />
            <Gauge label="DRAWDOWN" value="−4.8%" pct={24} color={PALETTE.amber} />
          </div>
        </PanelCard>

        <PanelCard title="Sector hype · live">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Gauge label="DEPIN ▲" value="92" pct={92} color={PALETTE.red} labelColor={PALETTE.red} valueColor={PALETTE.red} glow />
            <Gauge label="RWA" value="78" pct={78} color={PALETTE.amber} />
            <Gauge label="AI AGENTS" value="71" pct={71} color={PALETTE.amber} />
            <Gauge label="RESTAKING" value="64" pct={64} color={PALETTE.emerald} />
            <Gauge label="SOL DEFI" value="52" pct={52} color={PALETTE.emerald} />
            <Gauge label="L2" value="44" pct={44} color={PALETTE.faint} />
          </div>
        </PanelCard>

        <PanelCard title="Agent activity · streaming">
          <Feed />
        </PanelCard>
      </div>
    </div>
  );
}

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(15,20,27,0.6)",
        border: `1px solid ${PALETTE.line}`,
        borderRadius: 10,
        padding: 16,
      }}
    >
      <h4
        style={{
          fontSize: 11,
          color: PALETTE.faint,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          fontFamily: MONO_STACK,
          fontWeight: 500,
          marginBottom: 10,
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function Gauge({
  label,
  value,
  pct,
  color,
  labelColor,
  valueColor,
  glow = false,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
  labelColor?: string;
  valueColor?: string;
  glow?: boolean;
}) {
  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          fontFamily: MONO_STACK,
          fontSize: 9.5,
          color: labelColor ?? PALETTE.faint,
          marginBottom: 4,
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: valueColor ?? PALETTE.text }}>
        {value}
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: PALETTE.bg4,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <i
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            borderRadius: 2,
            width: `${pct}%`,
            background: color,
            boxShadow: glow ? `0 0 8px ${color}` : undefined,
          }}
        />
      </div>
    </div>
  );
}

function MiniChart() {
  return (
    <div style={{ height: 90, position: "relative", marginTop: 14 }}>
      <svg width="100%" height="100%" viewBox="0 0 280 90" preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="navg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={PALETTE.emerald} stopOpacity={0.4} />
            <stop offset="100%" stopColor={PALETTE.emerald} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path
          d="M 0 70 L 20 65 L 40 68 L 60 58 L 80 62 L 100 50 L 120 54 L 140 42 L 160 46 L 180 36 L 200 40 L 220 28 L 240 32 L 260 22 L 280 18 L 280 90 L 0 90 Z"
          fill="url(#navg)"
        />
        <path
          d="M 0 70 L 20 65 L 40 68 L 60 58 L 80 62 L 100 50 L 120 54 L 140 42 L 160 46 L 180 36 L 200 40 L 220 28 L 240 32 L 260 22 L 280 18"
          fill="none"
          stroke={PALETTE.emerald}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

type FeedItem = {
  t: string;
  body: React.ReactNode;
  src: string;
  score: string;
  scoreAmber?: boolean;
};

function Feed() {
  const items: FeedItem[] = [
    {
      t: "2s",
      body: (
        <>
          Detected DePIN cluster spike (+340%, 11 assets). Drafting{" "}
          <span style={{ color: PALETTE.cyan }}>HYPE-DEPIN-8</span>.
        </>
      ),
      src: "node: monitor → draft",
      score: "+92",
    },
    {
      t: "14s",
      body: <>Filecoin enterprise demand jumps 38% QoQ. Sentiment confirmed.</>,
      src: "source: Messari",
      score: "+92",
    },
    {
      t: "38s",
      body: <>Backtest complete — Sharpe 2.14, MaxDD −4.8% over 90d.</>,
      src: "node: simulate",
      score: "+84",
    },
    {
      t: "1m",
      body: <>Awaiting your approval before publish to SSI.</>,
      src: "node: review",
      score: "hold",
      scoreAmber: true,
    },
    {
      t: "3m",
      body: <>USSI hedge armed (drawdown gate −5%).</>,
      src: "node: risk",
      score: "ok",
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {items.map((it, i, arr) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            paddingBottom: 9,
            borderBottom: i === arr.length - 1 ? "none" : "1px solid rgba(28,35,44,0.6)",
          }}
        >
          <div
            style={{
              fontFamily: MONO_STACK,
              fontSize: 9.5,
              color: PALETTE.faint,
              minWidth: 28,
              paddingTop: 1,
            }}
          >
            {it.t}
          </div>
          <div style={{ flex: 1, fontSize: 11.5, lineHeight: 1.4, color: PALETTE.text }}>
            {it.body}
            <span
              style={{
                fontFamily: MONO_STACK,
                fontSize: 9.5,
                color: PALETTE.faint,
                display: "block",
                marginTop: 2,
              }}
            >
              {it.src}
            </span>
          </div>
          <div
            style={{
              fontFamily: MONO_STACK,
              fontSize: 11,
              color: it.scoreAmber ? PALETTE.amber : PALETTE.emerald,
              fontWeight: 600,
            }}
          >
            {it.score}
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------- SECTION HELPERS ---------------------------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: MONO_STACK,
        fontSize: 11,
        color: PALETTE.emerald,
        textTransform: "uppercase",
        letterSpacing: "0.18em",
        marginBottom: 18,
      }}
    >
      <span style={{ width: 18, height: 1, background: PALETTE.emerald, display: "inline-block" }} />
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 44,
        lineHeight: 1.1,
        letterSpacing: "-0.03em",
        fontWeight: 700,
        maxWidth: 720,
      }}
    >
      {children}
    </h2>
  );
}

function SectionSub({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ marginTop: 16, fontSize: 17, color: PALETTE.dim, maxWidth: 580, lineHeight: 1.55 }}>
      {children}
    </p>
  );
}

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 32px" }}>{children}</div>
  );
}

/* ------------------------------- PRODUCTS -------------------------------- */

function Products() {
  return (
    <section id="products" style={{ position: "relative", padding: "110px 0" }}>
      <Container>
        <Eyebrow>Two products · one agent stack</Eyebrow>
        <SectionTitle>Run your own indices, or publish them to others.</SectionTitle>
        <SectionSub>
          HypeNode ships as two purpose-built surfaces sharing one autonomous research engine. Pick
          the one that matches how you operate.
        </SectionSub>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginTop: 56,
          }}
        >
          <ProductCard
            kind="indexer"
            badge="INDEXER"
            pages="10 PAGES"
            title="HypeNode Autonomous Indexer"
            desc="Manage your own indices end-to-end. Dashboard, agent console with LangGraph state graph, MCP chat, backtesting lab, risk control with emergency exit, full transaction history."
            features={[
              "LangGraph state-machine console with live reasoning",
              "MCP chat — control the agent in natural language",
              "Backtesting lab vs BTC, ETH, sector benchmarks",
              "USSI emergency-exit hedge wired to drawdown gates",
            ]}
            primaryHref="/dashboard"
            primaryLabel="Open Indexer →"
          />
          <ProductCard
            kind="publisher"
            badge="PUBLISHER"
            pages="6 PAGES"
            title="HypeIndex Publisher"
            desc="Creator product. Hype Radar surfaces sector momentum, agent drafts proposals you approve, your published indices accrue management + performance fees streamed in USDC."
            features={[
              "Hype Radar — live sector spike detection",
              "Agent drafts proposals · you approve before publish",
              "Subscribers stream fees to your wallet in USDC",
              "Creator rank, earnings dashboard, tax reports",
            ]}
            primaryHref="/publisher/radar"
            primaryLabel="Open Publisher →"
          />
        </div>
      </Container>
    </section>
  );
}

function ProductCard({
  kind,
  badge,
  pages,
  title,
  desc,
  features,
  primaryHref,
  primaryLabel,
}: {
  kind: "indexer" | "publisher";
  badge: string;
  pages: string;
  title: string;
  desc: string;
  features: string[];
  primaryHref: string;
  primaryLabel: string;
}) {
  const accent = kind === "indexer" ? PALETTE.emerald : PALETTE.amber;
  return (
    <div
      className="hype-product-card"
      style={{
        position: "relative",
        background: `linear-gradient(180deg, ${PALETTE.bg2}, ${PALETTE.bg3})`,
        border: `1px solid ${PALETTE.line}`,
        borderTop: `2px solid ${accent}`,
        borderRadius: 14,
        padding: 32,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: MONO_STACK,
            fontSize: 10,
            color: PALETTE.dim,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accent,
              boxShadow: `0 0 8px ${accent}`,
            }}
          />
          {badge}
        </span>
        <span style={{ fontFamily: MONO_STACK, fontSize: 10, color: PALETTE.faint }}>{pages}</span>
      </div>
      <h3 style={{ fontSize: 26, letterSpacing: "-0.02em", fontWeight: 700, marginBottom: 10 }}>
        {title}
      </h3>
      <p style={{ fontSize: 14, color: PALETTE.dim, lineHeight: 1.55, marginBottom: 22 }}>{desc}</p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginBottom: 24,
          padding: 14,
          background: "rgba(0,0,0,0.25)",
          border: `1px solid ${PALETTE.line}`,
          borderRadius: 8,
        }}
      >
        {features.map((f) => (
          <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: PALETTE.text }}>
            <span style={{ color: accent, fontFamily: MONO_STACK, fontSize: 11 }}>→</span>
            {f}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <form action="/api/auth/role" method="POST" style={{ margin: 0 }}>
          <input type="hidden" name="role" value={kind} />
          <input type="hidden" name="redirect" value={primaryHref} />
          <button
            type="submit"
            className={`hype-btn ${kind === "publisher" ? "amber" : "primary"}`}
          >
            {primaryLabel}
          </button>
        </form>
        <a className="hype-btn" href={`/api/demo/enter?role=${kind}`}>Try demo →</a>
        <a className="hype-btn" href="#how">Take the tour</a>
      </div>
    </div>
  );
}

/* ----------------------------- HOW IT WORKS ----------------------------- */

function HowItWorks() {
  const stages = [
    {
      step: "01",
      label: "RESEARCH",
      title: "Sentiment + flow ingest",
      desc: "Pulls SoSoValue Terminal headlines, sector classification, and ETF fund flows. Detects fresh hype clusters above your thresholds.",
      stack: "SoSoValue Terminal",
    },
    {
      step: "02",
      label: "DRAFT",
      title: "Agent composes basket",
      desc: "LangGraph node weighs constituents by sentiment × log(mcap), filters for liquidity and CEX presence, generates reasoning trace.",
      stack: "LangGraph · MCP · 7 tools",
    },
    {
      step: "03",
      label: "EXECUTE",
      title: "Publish & rebalance",
      desc: "After your sign, basket ships to SSI Protocol via SoDEX router. Daily rebalance keyed to sentiment delta.",
      stack: "SSI Protocol · SoDEX · ValueChain L1",
    },
    {
      step: "04",
      label: "PROTECT",
      title: "Risk gates & hedge",
      desc: "Volatility (σ) and drawdown gates trigger USSI auto-hedge. Panic button unwinds the basket in one transaction.",
      stack: "USSI hedge · σ + drawdown gates",
    },
  ];

  return (
    <section
      id="how"
      style={{
        position: "relative",
        padding: "110px 0",
        background: "linear-gradient(180deg, transparent 0%, rgba(10,14,19,0.6) 100%)",
      }}
    >
      <Container>
        <Eyebrow>How it works</Eyebrow>
        <SectionTitle>From signal to settled trade — autonomously, auditably.</SectionTitle>
        <SectionSub>
          Four agent nodes operating on a continuous loop. Every decision is logged, every
          transition is on-chain, every trade is reversible at the risk gate.
        </SectionSub>

        <div
          style={{
            marginTop: 56,
            padding: 36,
            background: PALETTE.bg2,
            border: `1px solid ${PALETTE.line}`,
            borderRadius: 14,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 0,
              position: "relative",
            }}
          >
            {stages.map((s) => (
              <div key={s.step} className="hype-stage" style={{ padding: "0 24px", position: "relative" }}>
                <div
                  style={{
                    fontFamily: MONO_STACK,
                    fontSize: 10,
                    color: PALETTE.faint,
                    letterSpacing: "0.14em",
                    marginBottom: 12,
                  }}
                >
                  <span style={{ color: PALETTE.emerald, marginRight: 8 }}>{s.step}</span>
                  {s.label}
                </div>
                <h4
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    marginBottom: 8,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {s.title}
                </h4>
                <p style={{ fontSize: 12.5, color: PALETTE.dim, lineHeight: 1.5, marginBottom: 12 }}>
                  {s.desc}
                </p>
                <span
                  style={{
                    fontFamily: MONO_STACK,
                    fontSize: 10,
                    color: PALETTE.cyan,
                    padding: "4px 8px",
                    background: "rgba(34,211,238,0.06)",
                    border: "1px solid rgba(34,211,238,0.2)",
                    borderRadius: 4,
                    display: "inline-block",
                  }}
                >
                  {s.stack}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ----------------------------- ARCHITECTURE ----------------------------- */

function Architecture() {
  const cards: Array<{
    label: string;
    title: string;
    accent: string;
    bg: string;
    items: Array<[string, string]>;
  }> = [
    {
      label: "FE",
      title: "Frontend",
      accent: PALETTE.emerald,
      bg: "rgba(16,185,129,0.12)",
      items: [
        ["Framework", "Next.js 15 (RSC)"],
        ["UI", "React 18 · Tailwind"],
        ["Charts", "Lightweight Charts"],
        ["Wallet", "Privy · viem"],
      ],
    },
    {
      label: "BE",
      title: "Backend & Agent",
      accent: PALETTE.cyan,
      bg: "rgba(34,211,238,0.12)",
      items: [
        ["Runtime", "Node.js · Python"],
        ["Agent", "LangGraph · Claude 4.5"],
        ["Tools", "MCP server · 7 tools"],
        ["Queue", "Redis · BullMQ"],
      ],
    },
    {
      label: "ON",
      title: "On-chain",
      accent: PALETTE.violet,
      bg: "rgba(167,139,250,0.12)",
      items: [
        ["Index", "SSI Protocol"],
        ["Routing", "SoDEX"],
        ["L1", "ValueChain"],
        ["Hedge", "USSI vault"],
      ],
    },
    {
      label: "DT",
      title: "Data & Signals",
      accent: PALETTE.amber,
      bg: "rgba(245,158,11,0.12)",
      items: [
        ["News", "SoSoValue Terminal"],
        ["Flow", "ETF fund-flow API"],
        ["Market", "CoinGecko · Pyth"],
        ["Storage", "Postgres · Timescale"],
      ],
    },
  ];

  return (
    <section id="stack" style={{ position: "relative", padding: "110px 0" }}>
      <Container>
        <Eyebrow>Architecture</Eyebrow>
        <SectionTitle>A serious stack for a serious workflow.</SectionTitle>
        <SectionSub>
          Production-grade tooling end-to-end. Open primitives where it matters; battle-tested
          infra everywhere else.
        </SectionSub>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginTop: 56,
          }}
        >
          {cards.map((c) => (
            <div
              key={c.label}
              style={{
                background: PALETTE.bg2,
                border: `1px solid ${PALETTE.line}`,
                borderRadius: 12,
                padding: 24,
              }}
            >
              <h4
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    display: "grid",
                    placeItems: "center",
                    fontFamily: MONO_STACK,
                    fontSize: 10,
                    fontWeight: 700,
                    background: c.bg,
                    color: c.accent,
                  }}
                >
                  {c.label}
                </span>
                {c.title}
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {c.items.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      padding: "10px 12px",
                      background: "rgba(0,0,0,0.25)",
                      border: `1px solid ${PALETTE.line}`,
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: MONO_STACK,
                        fontSize: 9.5,
                        color: PALETTE.faint,
                        letterSpacing: "0.08em",
                        marginBottom: 4,
                        textTransform: "uppercase",
                      }}
                    >
                      {k}
                    </div>
                    <div style={{ fontSize: 12.5, color: PALETTE.text, fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------- NUMBERS ------------------------------- */

function Numbers() {
  const cells: Array<[string, string]> = [
    ["11", "Sectors monitored continuously"],
    ["7", "MCP tools the agent can call"],
    ["2.14", "Avg Sharpe across published indices"],
    ["< 4h", "From signal to live index, on average"],
  ];
  return (
    <section style={{ padding: 0 }}>
      <Container>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 0,
            margin: "80px 0",
          }}
        >
          {cells.map(([v, k], i) => (
            <div
              key={k}
              style={{
                padding: "28px 32px",
                paddingLeft: i === 0 ? 0 : 32,
                borderLeft: i === 0 ? "none" : `1px solid ${PALETTE.line}`,
              }}
            >
              <div
                className="hype-num-grad"
                style={{
                  fontSize: 40,
                  fontWeight: 700,
                  letterSpacing: "-0.025em",
                  lineHeight: 1,
                }}
              >
                {v}
              </div>
              <div style={{ fontSize: 13, color: PALETTE.dim, marginTop: 10 }}>{k}</div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ---------------------------------- FAQ --------------------------------- */

function FAQ() {
  const items: Array<[string, string]> = [
    [
      "Does the agent trade without me?",
      "No. The agent researches, drafts, and backtests autonomously — but every publish or rebalance requires your signature, unless you explicitly enable auto-publish for a specific index. Risk gates can unwind positions automatically; that behavior is configurable per index.",
    ],
    [
      "How does the USSI hedge work?",
      "When σ or drawdown gates trip, the agent rotates a configurable percentage of basket assets into USSI — a stable hedge instrument on ValueChain. The route is one transaction, costs ~$0.04, and reverses automatically when gates clear.",
    ],
    [
      "Where do creator fees come from?",
      "Subscribers to your published indices pay a management fee (default 1%/yr) and performance fee (default 10%, high-water mark) in USDC. Fees stream daily to your wallet on ValueChain. You set the schedule per index.",
    ],
    [
      "Why SoSoValue Terminal as the data source?",
      "It's the cleanest ETF + sector-classified news feed in crypto, with sentiment scoring already aligned to taxonomy we use downstream. The agent's hype detection rules map directly onto Terminal's sector clusters.",
    ],
    [
      "What's the API rate-limit story?",
      "Free tier covers indexer + 1 published index. Pro tier raises Terminal API limits 10× and unlocks unlimited published indices. Enterprise tier is metered and includes private agent deployment.",
    ],
  ];

  return (
    <section id="faq" style={{ position: "relative", padding: "110px 0" }}>
      <Container>
        <Eyebrow>FAQ</Eyebrow>
        <SectionTitle>Questions, briefly.</SectionTitle>

        <div style={{ marginTop: 56 }}>
          {items.map(([q, a], i, arr) => (
            <div
              key={q}
              style={{
                borderTop: `1px solid ${PALETTE.line}`,
                borderBottom: i === arr.length - 1 ? `1px solid ${PALETTE.line}` : undefined,
                padding: "24px 0",
                display: "grid",
                gridTemplateColumns: "280px 1fr",
                gap: 40,
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{q}</div>
              <div style={{ fontSize: 14.5, color: PALETTE.dim, lineHeight: 1.6 }}>{a}</div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ---------------------------------- CTA --------------------------------- */

function CTA() {
  return (
    <section style={{ padding: "40px 0 0" }}>
      <Container>
        <div
          style={{
            margin: "0 0 80px",
            padding: "56px 48px",
            background:
              "radial-gradient(600px 300px at 80% 0%, rgba(16,185,129,0.18), transparent 60%), linear-gradient(180deg, #0A0E13, #0F141B)",
            border: `1px solid ${PALETTE.line}`,
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 40,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 32,
                letterSpacing: "-0.025em",
                fontWeight: 700,
                maxWidth: 540,
                lineHeight: 1.15,
              }}
            >
              Spin up your first agent-managed index in under 10 minutes.
            </h3>
            <p style={{ fontSize: 14.5, color: PALETTE.dim, marginTop: 12, maxWidth: 480 }}>
              14-day trial · no credit card · cancel anytime. Bring your own wallet, point at your
              sectors, let the agent do the rest.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
            <SignInButton className="hype-btn primary lg" label="Start free trial →" />
            <a className="hype-btn lg" href="/api/demo/enter">Try demo (no wallet) →</a>
            <a className="hype-btn lg" href="#docs">Read the docs</a>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------- FOOTER -------------------------------- */

function Footer() {
  return (
    <footer style={{ padding: "56px 0 40px", borderTop: `1px solid ${PALETTE.line}` }}>
      <Container>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            gap: 56,
            marginBottom: 48,
          }}
        >
          <div>
            <Logo />
            <p
              style={{
                fontSize: 13,
                color: PALETTE.dim,
                lineHeight: 1.6,
                marginTop: 16,
                maxWidth: 320,
              }}
            >
              Autonomous on-chain index research → execution. Built on SoSoValue Terminal, SSI
              Protocol, SoDEX, and ValueChain L1.
            </p>
          </div>
          <FooterColumn
            title="Product"
            items={[
              ["Indexer", "/dashboard"],
              ["Publisher", "/publisher/radar"],
              ["Pricing", "#pricing"],
              ["Changelog", "#changelog"],
            ]}
          />
          <FooterColumn
            title="Developers"
            items={[
              ["Documentation", "#docs"],
              ["MCP server", "#mcp"],
              ["API reference", "#api"],
              ["Status", "#status"],
            ]}
          />
          <FooterColumn
            title="Company"
            items={[
              ["About", "#about"],
              ["Research blog", "#blog"],
              ["Contact", "#contact"],
              ["Legal", "#legal"],
            ]}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 24,
            borderTop: `1px solid ${PALETTE.line}`,
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <span style={{ fontFamily: MONO_STACK, fontSize: 10.5, color: PALETTE.faint }}>
            © 2026 HypeNode Labs · all rights reserved
          </span>
          <span style={{ fontFamily: MONO_STACK, fontSize: 10.5, color: PALETTE.faint }}>
            Frontend <span style={{ color: PALETTE.emerald }}>Next.js</span> · Backend{" "}
            <span style={{ color: PALETTE.emerald }}>Node.js + Python LangGraph</span> ·{" "}
            <span style={{ color: PALETTE.emerald }}>MCP server</span>
          </span>
        </div>
      </Container>
    </footer>
  );
}

function FooterColumn({
  title,
  items,
}: {
  title: string;
  items: Array<[string, string]>;
}) {
  return (
    <div>
      <h5
        style={{
          fontSize: 11,
          fontFamily: MONO_STACK,
          color: PALETTE.faint,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          fontWeight: 500,
          marginBottom: 16,
        }}
      >
        {title}
      </h5>
      <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, padding: 0, margin: 0 }}>
        {items.map(([label, href]) => {
          const isInternal = href.startsWith("/");
          return (
            <li key={label}>
              {isInternal ? (
                <Link href={href} className="hype-nav-link" style={{ fontSize: 13 }}>
                  {label}
                </Link>
              ) : (
                <a href={href} className="hype-nav-link" style={{ fontSize: 13 }}>
                  {label}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
