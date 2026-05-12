// Proposal detail — Supabase-backed read-through. Public for live/published,
// gated to creator otherwise. Status transitions wire to PATCH /api/proposals/[id].

import { ProposalDetailClient } from "./ProposalDetailClient";

export const dynamic = "force-dynamic";

export default function ProposalDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-52px)]">
      <ProposalDetailClient id={params.id} />
    </div>
  );
}
