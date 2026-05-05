import { Card, Label, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { listFundingProjects } from "@/lib/api/sosovalue/fundraising";
import { FundraisingList } from "./FundraisingList";

export const revalidate = 60;

// Stats strip is intentionally synthetic — round/raised counts require a
// per-project fetch which we defer to the detail route. We surface a
// transparent "synthetic until per-project fetch" pill so the number isn't
// mistaken for live aggregate.
function fmtUsdShort(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default async function FundraisingPage() {
  const projects = await listFundingProjects();

  // Synthetic aggregate hint: assume ~3 rounds and ~$30M raised per project.
  // Tagged below so this isn't mistaken for live data.
  const estimatedRounds = projects.length * 3;
  const estimatedRaised = projects.length * 30_000_000;

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Fundraising Tracker
          </div>
          <Mono size={11}>
            crypto venture activity · GET /fundraising/projects
          </Mono>
        </div>
        <Tag small color={tokens.amber} dot>
          synthetic until per-project fetch
        </Tag>
      </div>

      <Card pad={14}>
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <Label>Tracked</Label>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginTop: 2 }}>
              {projects.length} projects
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: tokens.border }} />
          <div>
            <Label>Rounds (est)</Label>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginTop: 2 }}>
              {estimatedRounds}
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: tokens.border }} />
          <div>
            <Label>Raised (est)</Label>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginTop: 2 }}>
              {fmtUsdShort(estimatedRaised)}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <Mono size={10} color={tokens.textFaint}>
            list endpoint returns id + name only — open a card for rounds & investors
          </Mono>
        </div>
      </Card>

      {projects.length === 0 ? (
        <Card>
          <Mono size={11} color={tokens.textFaint}>
            No fundraising projects available right now.
          </Mono>
        </Card>
      ) : (
        <FundraisingList projects={projects} />
      )}
    </div>
  );
}
