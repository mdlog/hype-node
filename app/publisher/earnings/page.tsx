// Creator earnings dashboard — Supabase pb_earnings ledger plus on-chain
// wallet balance. Earnings ledger is currently fed via manual POSTs to
// /api/publisher/earnings; the on-chain indexer that auto-fills it for live
// SSI Protocol fee streams is a Wave 2 deliverable.

import { WalletBalanceCard } from "@/components/auth/WalletBalance";

import { EarningsClient } from "./EarningsClient";

export const dynamic = "force-dynamic";

export default function EarningsPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 h-[calc(100vh-52px)]">
      <EarningsClient walletCard={<WalletBalanceCard />} />
    </div>
  );
}
