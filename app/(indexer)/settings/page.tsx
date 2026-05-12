import { getTerminalStatus, type TerminalStatus } from "@/lib/api/agent";

import { SettingsClient } from "./SettingsClient";
import { TransportDiagnostics, TransportUnreachable } from "./TransportDiagnostics";

// Status changes often (cache entries age, backoff windows tick down) so we
// keep the ISR window short. The page itself is a tab shell — Profile and
// Notifications fetch their own data client-side via /api/settings.
export const revalidate = 30;

export default async function SettingsPage() {
  const status: TerminalStatus | null = await getTerminalStatus();

  // Pre-render the Transport tab as a Server Component slot so the heavy
  // data fetch + projection stays off the client bundle. SettingsClient
  // simply mounts whichever slot the active tab points at.
  const transportSlot = status ? (
    <TransportDiagnostics status={status} />
  ) : (
    <TransportUnreachable />
  );

  return <SettingsClient transportSlot={transportSlot} />;
}
