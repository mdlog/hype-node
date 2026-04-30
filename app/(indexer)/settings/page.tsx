import { Card, Label, Metric, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { getTerminalStatus, type TerminalStatus } from "@/lib/api/agent";

// Status changes often (cache entries age, backoff windows tick down) so we
// keep the ISR window short. The page is read-only diagnostics — no toggles,
// no user prefs — so a stale render at most 30s old is fine.
export const revalidate = 30;

function fmtRelative(iso: string): string {
  const dt = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(dt / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtSec(s: number): string {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m - h * 60;
  return remM ? `${h}h ${remM}m` : `${h}h`;
}

// Tier label is derived from the real min_gap_sec the transport reports.
//   ~0.7s gap → SoSoValue paid "High Frequency" (100 req/min)
//   ~65s gap  → SoSoValue Demo (1 req/min)
// Anything else is treated as a custom-configured pacing.
function tierLabel(minGap: number): { label: string; color: string } {
  if (minGap <= 1) return { label: "Paid (100/min)", color: tokens.emerald };
  if (minGap >= 60) return { label: "Demo (1/min)", color: tokens.amber };
  return { label: `Custom (1 / ${minGap.toFixed(1)}s gap)`, color: tokens.cyan };
}

function Sidebar() {
  return (
    <div style={{ padding: 16, borderRight: `1px solid ${tokens.border}` }}>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          marginBottom: 14,
          letterSpacing: "-0.02em",
        }}
      >
        Settings
      </div>
      {[
        ["Profile", false],
        ["Transport", true],
        ["Keys & Connections", false],
        ["MCP Tools", false],
        ["Risk Defaults", false],
        ["Notifications", false],
        ["Billing", false],
      ].map(([l, on], i) => (
        <div
          key={i}
          style={{
            padding: "8px 12px",
            background: on ? tokens.bgElev : "transparent",
            border: `1px solid ${on ? tokens.border : "transparent"}`,
            borderLeft: on ? `2px solid ${tokens.emerald}` : "2px solid transparent",
            borderRadius: 5,
            marginBottom: 2,
            fontSize: 12.5,
            color: on ? tokens.text : tokens.textDim,
            fontWeight: on ? 600 : 500,
            cursor: "pointer",
          }}
        >
          {l as string}
          {!on && (
            <Mono size={9} className="ml-1.5">
              TBD
            </Mono>
          )}
        </div>
      ))}
    </div>
  );
}

function UnreachableState() {
  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "220px 1fr" }}>
      <Sidebar />
      <div className="overflow-y-auto flex flex-col gap-3.5" style={{ padding: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Transport Diagnostics
          </div>
          <Mono size={11}>read-only · live state of the SoSoValue transport layer</Mono>
        </div>
        <Card
          pad={20}
          style={{
            background: tokens.amber + "08",
            borderColor: tokens.amber + "40",
          }}
        >
          <div className="flex items-start gap-3">
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: tokens.amber,
                marginTop: 6,
              }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.amber }}>
                Agent service unreachable
              </div>
              <div
                style={{ fontSize: 12, color: tokens.textDim, marginTop: 6, lineHeight: 1.5 }}
              >
                The Python agent service is not responding at its configured URL. Start it with{" "}
                <code style={{ color: tokens.cyan }}>npm run agent</code> from the repo root, then
                reload this page.
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  const status: TerminalStatus | null = await getTerminalStatus();

  if (!status) return <UnreachableState />;

  const tier = tierLabel(status.min_gap_sec);
  const quotaBackoff = status.backoff.quota_exhausted_for_sec;
  const transientBackoff = status.backoff.transient_error_for_sec;
  const inBackoff = quotaBackoff > 0 || transientBackoff > 0;
  const backoffKind = quotaBackoff > 0 ? "monthly quota" : "5xx outage";
  const backoffSec = quotaBackoff > 0 ? quotaBackoff : transientBackoff;
  const backoffColor = quotaBackoff > 0 ? tokens.red : tokens.amber;

  // Top-N cache entries by recency (smallest age first).
  const cacheRows = [...status.cache].sort((a, b) => a.age_sec - b.age_sec).slice(0, 10);

  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "220px 1fr" }}>
      <Sidebar />

      <div className="overflow-y-auto flex flex-col gap-3.5" style={{ padding: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Transport Diagnostics
          </div>
          <Mono size={11}>
            read-only · live state of the SoSoValue transport layer · refreshed every 30s
          </Mono>
        </div>

        {/* Header card: connection identity + key state + last success */}
        <Card pad={16}>
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1.5">
              <Label>UPSTREAM BASE</Label>
              <Mono size={12} color={tokens.text}>
                {status.base}
              </Mono>
              <div className="flex gap-1.5 mt-1">
                <Tag
                  small
                  color={status.has_api_key ? tokens.emerald : tokens.red}
                  dot
                >
                  {status.has_api_key ? "API key configured" : "API key missing"}
                </Tag>
                <Tag small color={tier.color} dot>
                  {tier.label}
                </Tag>
              </div>
            </div>
            <div className="flex gap-6">
              <div>
                <Label>LAST SUCCESS</Label>
                <Metric
                  v={status.last_success ? fmtRelative(status.last_success.at) : "—"}
                  size={18}
                  style={{ marginTop: 4 }}
                />
                {status.last_success && (
                  <Mono size={10} className="block mt-0.5">
                    {status.last_success.path}
                  </Mono>
                )}
              </div>
              <div>
                <Label>LAST REQUEST</Label>
                <Metric
                  v={status.last_request_at ? fmtRelative(status.last_request_at) : "—"}
                  size={18}
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Backoff banner — only when transport is currently throttled */}
        {inBackoff && (
          <div
            className="flex items-center gap-3"
            style={{
              padding: "12px 16px",
              background: `linear-gradient(90deg, ${backoffColor}15, transparent)`,
              border: `1px solid ${backoffColor}50`,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: backoffColor,
                boxShadow: `0 0 12px ${backoffColor}`,
              }}
            />
            <div className="flex-1">
              <div style={{ fontSize: 13, fontWeight: 600, color: backoffColor }}>
                Transport in backoff — {backoffKind}
              </div>
              <Mono size={11} color={tokens.textDim}>
                {fmtSec(backoffSec)} remaining · upstream calls suppressed; cached responses still
                served stale-on-failure
              </Mono>
            </div>
          </div>
        )}

        {/* Rate-limit panel — derived tier label + real config knobs */}
        <Card pad={16}>
          <div className="flex justify-between mb-2.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Rate-limit configuration</div>
            <Mono size={10}>derived from /terminal/status</Mono>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>TIER</Label>
              <Metric v={tier.label} size={15} color={tier.color} style={{ marginTop: 4 }} />
              <Mono size={10} className="block mt-1">
                from min_gap_sec
              </Mono>
            </div>
            <div>
              <Label>MIN GAP</Label>
              <Metric
                v={`${status.min_gap_sec.toFixed(2)}s`}
                size={18}
                style={{ marginTop: 4 }}
              />
              <Mono size={10} className="block mt-1">
                between upstream calls
              </Mono>
            </div>
            <div>
              <Label>CACHE TTL</Label>
              <Metric
                v={fmtSec(status.cache_ttl_sec)}
                size={18}
                style={{ marginTop: 4 }}
              />
              <Mono size={10} className="block mt-1">
                per-path freshness
              </Mono>
            </div>
            <div>
              <Label>QUOTA BACKOFF</Label>
              <Metric
                v={fmtSec(status.quota_backoff_sec)}
                size={18}
                style={{ marginTop: 4 }}
              />
              <Mono size={10} className="block mt-1">
                on monthly-quota error
              </Mono>
            </div>
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${tokens.borderFaint}` }}>
            <Mono size={10.5} color={tokens.textFaint}>
              Note: SoSoValue does not expose an account-level monthly-quota usage endpoint, so
              monthly burn cannot be shown here. The values above reflect what the transport layer
              is configured to do, not the upstream account state. Transient (5xx) backoff window
              is {fmtSec(status.transient_backoff_sec)}.
            </Mono>
          </div>
        </Card>

        {/* Cache panel — real entries currently held by the transport */}
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Cache entries{" "}
              <Mono size={10} className="ml-1.5">
                {cacheRows.length} of {status.cache.length} shown · sorted by recency
              </Mono>
            </div>
          </div>
          {cacheRows.length === 0 ? (
            <div style={{ padding: 18, fontSize: 12, color: tokens.textDim }}>
              Cache is empty. Entries appear after the transport completes upstream fetches.
            </div>
          ) : (
            <div>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "1fr 90px 90px 110px",
                  padding: "8px 16px",
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                  background: tokens.bgElev,
                }}
              >
                <Label>PATH</Label>
                <Label>FRESH</Label>
                <Label>AGE</Label>
                <Label>EXPIRES IN</Label>
              </div>
              {cacheRows.map((c) => (
                <div
                  key={c.path}
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: "1fr 90px 90px 110px",
                    padding: "8px 16px",
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                  }}
                >
                  <Mono size={11} color={tokens.text}>
                    {c.path}
                  </Mono>
                  <Tag small color={c.fresh ? tokens.emerald : tokens.amber} dot>
                    {c.fresh ? "fresh" : "stale"}
                  </Tag>
                  <Mono size={11}>{fmtSec(c.age_sec)}</Mono>
                  <Mono size={11} color={c.expires_in_sec <= 0 ? tokens.amber : tokens.textDim}>
                    {c.expires_in_sec <= 0 ? "expired" : fmtSec(c.expires_in_sec)}
                  </Mono>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Last error panel */}
        <Card pad={16}>
          <div className="flex justify-between mb-2.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Last error</div>
            <Mono size={10}>most recent upstream failure</Mono>
          </div>
          {status.last_error ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1.5">
                <Tag small color={tokens.red} dot>
                  HTTP {status.last_error.status_code}
                </Tag>
                {status.last_error.code !== null && (
                  <Tag small color={tokens.amber}>
                    code {status.last_error.code}
                  </Tag>
                )}
                <Tag small color={tokens.textDim}>
                  {fmtRelative(status.last_error.at)}
                </Tag>
              </div>
              <Mono size={11} color={tokens.text}>
                {status.last_error.path}
              </Mono>
              <div
                style={{
                  fontSize: 12,
                  color: tokens.textDim,
                  lineHeight: 1.5,
                  padding: 10,
                  background: tokens.bgElev,
                  border: `1px solid ${tokens.borderFaint}`,
                  borderRadius: 5,
                }}
              >
                {status.last_error.message}
              </div>
              {status.last_error.backoff_until && (
                <Mono size={10}>
                  backoff_until {status.last_error.backoff_until}
                </Mono>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: tokens.textDim }}>
              No recent errors recorded.
            </div>
          )}
        </Card>

        {/* In-flight panel */}
        <Card pad={16}>
          <div className="flex justify-between mb-2.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>In-flight requests</div>
            <Mono size={10}>{status.inflight.length} active</Mono>
          </div>
          {status.inflight.length === 0 ? (
            <div style={{ fontSize: 12, color: tokens.textDim }}>
              No upstream requests currently in flight.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {status.inflight.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-2"
                  style={{
                    padding: "6px 10px",
                    background: tokens.bgElev,
                    border: `1px solid ${tokens.borderFaint}`,
                    borderRadius: 5,
                  }}
                >
                  <div
                    className="animate-[pulse-glow_1.2s_ease-in-out_infinite]"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: tokens.cyan,
                      boxShadow: `0 0 8px ${tokens.cyan}`,
                    }}
                  />
                  <Mono size={11} color={tokens.text}>
                    {p}
                  </Mono>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
