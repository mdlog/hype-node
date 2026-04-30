import { Card, Label, Metric, Mono, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { WalletBalanceCard } from "@/components/auth/WalletBalance";

// Earnings come from the SSI Protocol smart contract (management + performance
// fees streamed in USDC). We don't have an on-chain indexer wired in yet, so
// this page surfaces honest empty state + the real wallet balance via wagmi.
// When the indexer ships, replace the empty cards / payout list with a
// `useEarnings(address)` hook reading the SSI registry events.

export default function EarningsPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 h-[calc(100vh-52px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Creator Earnings
          </div>
          <Mono size={11}>
            management fees + performance fees · paid in USDC · streamed by SSI Protocol
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small disabled>
            Withdraw
          </Btn>
          <Btn small primary disabled>
            View tax report
          </Btn>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <WalletBalanceCard />
        <EmptyKpi
          k="EARNINGS BALANCE"
          v="—"
          d="no SSI fee stream yet · publish an index"
        />
        <EmptyKpi
          k="30D EARNINGS"
          v="—"
          d="depends on subscriber inflows"
        />
        <EmptyKpi
          k="ALL-TIME"
          v="—"
          d="indexer not yet wired"
        />
      </div>

      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Card pad={16}>
          <div className="flex justify-between mb-3">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Earnings over time</div>
              <Mono size={10}>
                management fee (solid) · performance fee (dashed) · daily
              </Mono>
            </div>
            <div className="flex gap-1">
              {["30D", "90D", "1Y", "ALL"].map((t, i) => (
                <div
                  key={t}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    background: i === 0 ? tokens.bgElev2 : "transparent",
                    border: `1px solid ${i === 0 ? tokens.borderStrong : "transparent"}`,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    color: i === 0 ? tokens.textDim : tokens.textFaint,
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
          <EmptyChart label="No earnings recorded yet" />
        </Card>

        <Card pad={0} className="overflow-hidden flex flex-col">
          <div
            style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${tokens.border}`,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Recent payouts
          </div>
          <div
            className="flex-1 flex items-center justify-center text-center"
            style={{ padding: 24, color: tokens.textFaint }}
          >
            <div className="flex flex-col items-center gap-2" style={{ maxWidth: 240 }}>
              <div
                className="flex items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  background: tokens.bgElev2,
                  border: `1px solid ${tokens.border}`,
                  fontSize: 16,
                  color: tokens.textDim,
                }}
              >
                💸
              </div>
              <div style={{ fontSize: 13, color: tokens.text, fontWeight: 500 }}>
                No payouts yet
              </div>
              <Mono size={10} style={{ lineHeight: 1.5 }}>
                Publish an SSI index and earn streaming fees in USDC. Recent payouts
                will appear here with the on-chain tx link.
              </Mono>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function EmptyKpi({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <Card pad={14}>
      <Label color={tokens.textFaint}>{k}</Label>
      <Metric v={v} size={24} color={tokens.textFaint} style={{ marginTop: 6 }} />
      <Mono size={11} className="mt-1 block" color={tokens.textFaint}>
        {d}
      </Mono>
    </Card>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
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
        <Mono size={11}>{label}</Mono>
        <Mono size={9} color={tokens.textFaint}>
          chart will populate after first SSI fee stream
        </Mono>
      </div>
    </div>
  );
}
