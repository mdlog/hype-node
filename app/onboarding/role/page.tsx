import { redirect } from "next/navigation";

import { getPreferredRole, roleHomeHref } from "@/lib/auth/role";
import { tokens } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export default async function OnboardingRolePage() {
  // If the user already picked a role (e.g. came from a landing tombol or
  // already onboarded once), skip this screen.
  const role = await getPreferredRole();
  if (role) redirect(roleHomeHref(role));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: tokens.bg,
        color: tokens.text,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1080 }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 11,
              letterSpacing: "0.18em",
              color: tokens.textDim,
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            One last step
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: 12,
            }}
          >
            How will you use HypeNode?
          </h1>
          <p
            style={{
              fontSize: 15,
              color: tokens.textDim,
              lineHeight: 1.55,
              maxWidth: 620,
              margin: "0 auto",
            }}
          >
            Pick the surface that fits how you operate. You can switch at any
            time from the header — this just decides where you land.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          <RoleCard
            role="indexer"
            badge="INDEXER"
            accent={tokens.emerald}
            title="HypeNode Autonomous Indexer"
            desc="Manage your own indices end-to-end. Dashboard, agent console with LangGraph state graph, MCP chat, backtesting lab, risk control, full transaction history."
            features={[
              "LangGraph state-machine console with live reasoning",
              "MCP chat — control the agent in natural language",
              "Backtesting lab vs BTC, ETH, sector benchmarks",
              "USSI emergency-exit hedge wired to drawdown gates",
            ]}
            cta="Continue as Indexer →"
            redirect="/dashboard"
          />
          <RoleCard
            role="publisher"
            badge="PUBLISHER"
            accent={tokens.amber}
            title="HypeIndex Publisher"
            desc="Creator product. Hype Radar surfaces sector momentum, agent drafts proposals you approve, your published indices accrue management + performance fees streamed in USDC."
            features={[
              "Hype Radar — live sector spike detection",
              "Agent drafts proposals · you approve before publish",
              "Subscribers stream fees to your wallet in USDC",
              "Creator rank, earnings dashboard, tax reports",
            ]}
            cta="Continue as Publisher →"
            redirect="/publisher/radar"
          />
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: 32,
            fontSize: 12,
            color: tokens.textFaint,
          }}
        >
          Not sure? Start as an Indexer — you can swap anytime from the header.
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  role,
  badge,
  accent,
  title,
  desc,
  features,
  cta,
  redirect,
}: {
  role: "indexer" | "publisher";
  badge: string;
  accent: string;
  title: string;
  desc: string;
  features: string[];
  cta: string;
  redirect: string;
}) {
  return (
    <form
      action="/api/auth/role"
      method="POST"
      style={{
        position: "relative",
        background: `linear-gradient(180deg, ${tokens.bgElev}, ${tokens.bgElev2})`,
        border: `1px solid ${tokens.border}`,
        borderTop: `2px solid ${accent}`,
        borderRadius: 14,
        padding: 32,
        margin: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="redirect" value={redirect} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 10,
          color: tokens.textDim,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          marginBottom: 20,
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
      </div>

      <h3
        style={{
          fontSize: 22,
          letterSpacing: "-0.02em",
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 13,
          color: tokens.textDim,
          lineHeight: 1.55,
          marginBottom: 20,
        }}
      >
        {desc}
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginBottom: 24,
          padding: 14,
          background: "rgba(0,0,0,0.25)",
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
        }}
      >
        {features.map((f) => (
          <div
            key={f}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: tokens.text,
            }}
          >
            <span
              style={{
                color: accent,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 11,
              }}
            >
              →
            </span>
            {f}
          </div>
        ))}
      </div>

      <button
        type="submit"
        className={`hype-btn ${role === "publisher" ? "amber" : "primary"}`}
        style={{ marginTop: "auto" }}
      >
        {cta}
      </button>
    </form>
  );
}
