import { Card, Label, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { listFundingRoundEvents } from "@/lib/api/sosovalue/fundraising";
import { FundraisingList } from "./FundraisingList";

// Listing aggregates /currencies + per-currency /fundraising probes — the
// cold path is ~10–15s and cached 15min by the request layer, so we revalidate
// every 30min to keep most renders instant.
export const revalidate = 1800;

function fmtUsdShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default async function FundraisingPage() {
  const events = await listFundingRoundEvents();

  const projectsCount = new Set(events.map((e) => e.project_id)).size;
  const totalRaised = events.reduce((s, e) => s + e.raised_amount, 0);

  // 30-day rolling window for the "last 30d" stat.
  const cutoff = Date.now() - 30 * 86_400_000;
  const recentRounds = events.filter((e) => e.date_ts > cutoff);
  const recentRaised = recentRounds.reduce((s, e) => s + e.raised_amount, 0);

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Fundraising Tracker
          </div>
          <Mono size={11}>
            crypto venture activity · GET /currencies/{`{id}`}/fundraising · flattened to round events
          </Mono>
        </div>
        <Tag small color={tokens.emerald} dot>
          live · {events.length} rounds across {projectsCount} projects
        </Tag>
      </div>

      <Card pad={14}>
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <Label>Projects</Label>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginTop: 2 }}>
              {projectsCount}
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: tokens.border }} />
          <div>
            <Label>Rounds tracked</Label>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginTop: 2 }}>
              {events.length}
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: tokens.border }} />
          <div>
            <Label>Total raised</Label>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: tokens.emerald,
                marginTop: 2,
              }}
            >
              {fmtUsdShort(totalRaised)}
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: tokens.border }} />
          <div>
            <Label>Last 30d</Label>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginTop: 2 }}>
              {recentRounds.length} rounds · {fmtUsdShort(recentRaised)}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <Mono size={10} color={tokens.textFaint}>
            click a row for round detail · investors · portfolio
          </Mono>
        </div>
      </Card>

      {events.length === 0 ? (
        <Card>
          <Mono size={11} color={tokens.textFaint}>
            No fundraising rounds available right now.
          </Mono>
        </Card>
      ) : (
        <FundraisingList events={events} />
      )}
    </div>
  );
}
