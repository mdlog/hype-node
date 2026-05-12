// Plain-language privacy notice. Reachable from the global footer.
//
// Content here is intentionally aligned with what the codebase actually
// does — wallet auth via SIWE/iron-session, Supabase persistence for
// saved backtest runs and shared links, browser-side cookie for the
// session, and outbound calls to SoSoValue Terminal + the LangGraph
// agent service. Do not list a data flow that isn't implemented; legal
// teams generally prefer "what we currently do" over aspirational copy.

import Link from "next/link";

import { Card, Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";

export const metadata = {
  title: "Privacy · HypeNode",
  description: "How HypeNode handles wallet identity, session cookies, and saved data.",
};

const LAST_UPDATED = "May 2026";

const SECTIONS: Array<{ id: string; title: string; body: React.ReactNode }> = [
  {
    id: "summary",
    title: "Summary",
    body: (
      <>
        HypeNode is a wallet-authenticated dashboard. We do not collect
        names, emails, or KYC data. Your wallet address is the only
        identifier we associate with the dashboard activity you create
        (saved backtests, shared links, role preference). You can disconnect
        and walk away at any time — there is no account to delete.
      </>
    ),
  },
  {
    id: "what-we-store",
    title: "What we store",
    body: (
      <ul style={{ paddingLeft: 18, lineHeight: 1.75 }}>
        <li>
          <b style={{ color: tokens.text }}>Wallet address</b> — the public
          address that signed the SIWE message. Used to scope your saved
          backtest runs and your role preference (indexer / publisher).
        </li>
        <li>
          <b style={{ color: tokens.text }}>Session cookie</b> — an iron-session
          cookie that proves you signed the SIWE challenge. HTTP-only,
          same-site, expires on logout or after the session TTL.
        </li>
        <li>
          <b style={{ color: tokens.text }}>Saved backtests</b> — the strategy
          ticker, period, constituent weights, and result metrics you
          explicitly clicked &quot;Save as preset&quot; on. Stored in
          Supabase, scoped to your wallet address.
        </li>
        <li>
          <b style={{ color: tokens.text }}>Share links</b> — when you click
          Share on a saved run we issue a public short code that anyone
          with the link can read. Revoke by deleting the saved run.
        </li>
        <li>
          <b style={{ color: tokens.text }}>Logs</b> — short-lived request
          logs for rate limiting and debugging. Rotated on a few-day window.
        </li>
      </ul>
    ),
  },
  {
    id: "what-we-dont",
    title: "What we don't do",
    body: (
      <ul style={{ paddingLeft: 18, lineHeight: 1.75 }}>
        <li>No third-party analytics or behavioural tracking.</li>
        <li>No selling, renting, or sharing of wallet addresses.</li>
        <li>No KYC, government-ID, or biometric collection.</li>
        <li>No reading of your wallet balance or signing keys — we only see what you sign.</li>
      </ul>
    ),
  },
  {
    id: "third-parties",
    title: "Third parties",
    body: (
      <ul style={{ paddingLeft: 18, lineHeight: 1.75 }}>
        <li>
          <b style={{ color: tokens.text }}>SoSoValue Terminal</b> — public
          market data (prices, klines, sentiment). Requests are made
          server-side and do not include your wallet address.
        </li>
        <li>
          <b style={{ color: tokens.text }}>LangGraph agent service</b> —
          runs strategy / chat / backtest tools. Receives the basket you
          choose to run and returns metrics; it does not see your session.
        </li>
        <li>
          <b style={{ color: tokens.text }}>Supabase</b> — managed Postgres
          for persistence. We use row-level scoping so other wallets
          can&apos;t read your saved runs.
        </li>
        <li>
          <b style={{ color: tokens.text }}>RPC providers</b> — used by
          your wallet to talk to the chain. Their privacy policy applies
          to that traffic, not ours.
        </li>
      </ul>
    ),
  },
  {
    id: "your-controls",
    title: "Your controls",
    body: (
      <ul style={{ paddingLeft: 18, lineHeight: 1.75 }}>
        <li>
          Disconnect your wallet from the top bar to drop the session
          cookie immediately.
        </li>
        <li>
          Delete a saved backtest run from the run history modal — that
          also invalidates any active share link.
        </li>
        <li>
          Reset your role preference from <Link href="/settings" style={{ color: tokens.emerald }}>/settings</Link>.
        </li>
      </ul>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <>
        Questions or takedown requests: open an issue on the project
        repository. We aim to respond within a few business days.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div
      className="mx-auto"
      style={{ maxWidth: 880, padding: "32px 24px 80px" }}
    >
      <Mono size={10} color={tokens.textFaint} style={{ letterSpacing: "0.18em" }}>
        PRIVACY NOTICE
      </Mono>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          marginTop: 8,
        }}
      >
        Privacy
      </h1>
      <Mono size={11} color={tokens.textFaint} style={{ marginTop: 6 }}>
        Last updated · {LAST_UPDATED}
      </Mono>

      <div
        className="flex items-center"
        style={{
          gap: 10,
          flexWrap: "wrap",
          marginTop: 24,
          padding: "12px 14px",
          background: tokens.bgElev,
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
        }}
      >
        <Mono size={10} color={tokens.textFaint} style={{ letterSpacing: "0.14em" }}>
          ON THIS PAGE
        </Mono>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            style={{
              fontSize: 12,
              color: tokens.textDim,
              textDecoration: "none",
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${tokens.border}`,
              background: tokens.bgElev2,
            }}
          >
            {s.title}
          </a>
        ))}
      </div>

      <div className="flex flex-col" style={{ gap: 18, marginTop: 28 }}>
        {SECTIONS.map((s) => (
          <Card key={s.id} pad={20}>
            <h2
              id={s.id}
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: tokens.text,
                letterSpacing: "-0.01em",
                marginBottom: 10,
                scrollMarginTop: 70,
              }}
            >
              {s.title}
            </h2>
            <div
              style={{
                fontSize: 13,
                color: tokens.textDim,
                lineHeight: 1.7,
              }}
            >
              {s.body}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
