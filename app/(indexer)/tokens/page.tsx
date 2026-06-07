import { Mono, Tag, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { listAllCurrencies } from "@/lib/api/sosovalue/tokens";
import { getCurrencySnapshot, type CurrencySnapshot } from "@/lib/api/sosovalue";
import { TokenExplorerTable } from "./TokenExplorerTable";

export const revalidate = 300;

// Mirrors TokenExplorerTable's PAGE_SIZE. We server-render the first page's
// snapshots inside the ISR pass so the default view needs ZERO per-tab client
// fan-out. With the central market-snapshot cache TTL aligned to this page's
// `revalidate` (5 min), this is ~1 shared fan-out / 5 min across ALL users —
// not 20 snapshot calls per browser tab. (This page was the app's only per-tab
// SoSoValue quota multiplier.) Pages 2+ and sort-driven views still fetch
// client-side on demand and reuse the same shared cache.
const FIRST_PAGE_SIZE = 20;

export default async function TokensExplorerPage() {
  const all = await listAllCurrencies();

  // Distinguish "live data via /currencies" from synthetic fallback so the
  // status pill in the header is meaningful. Synthetic ids are namespaced
  // with `synth-` (see syntheticCurrencies in lib/api/sosovalue/tokens.ts).
  const live = all.some((c) => !c.currency_id.startsWith("synth-"));

  // Pre-fetch the default first-page snapshots server-side (shared ISR cache).
  const firstIds = all.slice(0, FIRST_PAGE_SIZE).map((c) => c.currency_id);
  const settled = await Promise.allSettled(firstIds.map((id) => getCurrencySnapshot(id)));
  const initialSnapshots: Record<string, CurrencySnapshot> = {};
  settled.forEach((res, i) => {
    // Mirror the table's "all-zero snapshot = synthetic/missing" rule (real
    // tokens always have marketcap_rank ≥ 1) so we only seed genuine rows; the
    // few that miss re-fetch client-side once.
    if (res.status === "fulfilled" && res.value && res.value.marketcap_rank > 0) {
      initialSnapshots[firstIds[i]] = res.value;
    }
  });

  return (
    <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-48px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Token Explorer
          </div>
          <Mono size={11}>
            full SoSoValue currency universe · GET /currencies · click any row → token detail
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={live ? tokens.emerald : tokens.textFaint} dot>
            {live ? "live" : "fallback"}
          </Tag>
          <Btn small>Export CSV</Btn>
        </div>
      </div>
      <TokenExplorerTable rows={all} initialSnapshots={initialSnapshots} />
    </div>
  );
}
