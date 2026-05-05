import { Mono, Tag, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { listAllCurrencies } from "@/lib/api/sosovalue/tokens";
import { TokenExplorerTable } from "./TokenExplorerTable";

export const revalidate = 300;

export default async function TokensExplorerPage() {
  const all = await listAllCurrencies();

  // Distinguish "live data via /currencies" from synthetic fallback so the
  // status pill in the header is meaningful. Synthetic ids are namespaced
  // with `synth-` (see syntheticCurrencies in lib/api/sosovalue/tokens.ts).
  const live = all.some((c) => !c.currency_id.startsWith("synth-"));

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
      <TokenExplorerTable rows={all} />
    </div>
  );
}
