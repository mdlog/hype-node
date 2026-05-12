// My proposals — Supabase-backed listing of the signed-in creator's drafts,
// reviews, signed/published indices.
//
// Live agent-drafted radar candidates live at /publisher/radar — that page
// remains the discovery surface. This page is the persistence layer: a
// proposal is created (manually or promoted from radar) into pb_proposals,
// then progresses through the status graph.

import Link from "next/link";

import { ProposalsClient } from "./ProposalsClient";

export const dynamic = "force-dynamic";

export default function ProposalsPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <ProposalsClient />
      <p className="sr-only">
        <Link href="/publisher/radar">See live radar candidates</Link>
      </p>
    </div>
  );
}
