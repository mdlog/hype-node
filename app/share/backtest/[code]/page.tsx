// Public share page for a saved backtest run.
//
// No auth gate — anyone with the short code can view this. We fetch
// directly via the service-role `db` client (no fetch round-trip) and
// strip `user_address` before render.

import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, Label, LineChart, Metric, Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { db } from "@/lib/supabase/server";
import type { BtRunRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { code: string } };

function pct(n: number | null | undefined, digits = 1): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function num(n: number | null | undefined, digits = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function normalize(series: number[]): number[] {
  if (series.length === 0 || series[0] === 0) return series;
  return series.map((v) => (v / series[0]) * 100);
}

type ShareData = {
  short_code: string;
  expires_at: string | null;
  view_count: number;
  run: Omit<BtRunRow, "user_address">;
};

async function loadShare(code: string): Promise<ShareData | "not_found" | "expired"> {
  const { data: link } = await db
    .from("bt_share_links")
    .select("short_code, run_id, expires_at, view_count")
    .eq("short_code", code)
    .maybeSingle();

  if (!link) return "not_found";
  const linkRow = link as {
    short_code: string;
    run_id: string;
    expires_at: string | null;
    view_count: number;
  };

  if (linkRow.expires_at) {
    const exp = Date.parse(linkRow.expires_at);
    if (!Number.isNaN(exp) && exp < Date.now()) return "expired";
  }

  const { data: run } = await db
    .from("bt_runs")
    .select("*")
    .eq("id", linkRow.run_id)
    .maybeSingle();

  if (!run) return "not_found";

  // Fire-and-forget view-count bump. Cast through `never` to work around the
  // `db` proxy losing generic Insert/Update payload types on dynamic `.from()`.
  await db
    .from("bt_share_links")
    .update({ view_count: linkRow.view_count + 1 })
    .eq("short_code", code);

  const { user_address: _omit, ...publicRun } = run as BtRunRow;
  void _omit;
  return {
    short_code: linkRow.short_code,
    expires_at: linkRow.expires_at,
    view_count: linkRow.view_count + 1,
    run: publicRun,
  };
}

export default async function SharePage({ params }: Ctx) {
  const out = await loadShare(params.code);
  if (out === "not_found") notFound();

  const expired = out === "expired";
  const data = expired ? null : out;

  if (expired || !data) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: tokens.bg, color: tokens.text }}
      >
        <Card pad={32}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Share link expired
          </div>
          <Mono size={12}>
            This backtest share is no longer available.
          </Mono>
          <div style={{ marginTop: 16 }}>
            <Link
              href="/"
              style={{ color: tokens.emerald, fontSize: 13, textDecoration: "none" }}
            >
              Try HypeNode →
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const run = data.run;
  const equityRaw =
    Array.isArray(run.equity_preview) ? (run.equity_preview as number[]) : [];
  const equity = equityRaw.filter((n) => typeof n === "number" && Number.isFinite(n));
  const equityNorm = normalize(equity);

  return (
    <div
      className="min-h-screen px-6 py-8"
      style={{ background: tokens.bg, color: tokens.text }}
    >
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div>
            <Mono size={11}>shared backtest · {data.short_code}</Mono>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                marginTop: 2,
              }}
            >
              {run.label?.trim() || "Untitled backtest"}
            </div>
            <Mono size={11}>
              {run.strategy_ticker} · {run.days}d window · saved{" "}
              {new Date(run.created_at).toLocaleDateString()} · {data.view_count} views
            </Mono>
          </div>
          <Link
            href="/"
            style={{
              color: tokens.bg,
              background: tokens.emerald,
              padding: "7px 14px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Try HypeNode →
          </Link>
        </div>

        {run.notes ? (
          <Card pad={14}>
            <Label>NOTES</Label>
            <div style={{ fontSize: 13, marginTop: 4, color: tokens.text }}>
              {run.notes}
            </div>
          </Card>
        ) : null}

        <div className="grid grid-cols-5 gap-2.5">
          <Card pad={12}>
            <Label>RETURN ({run.days}D)</Label>
            <Metric
              v={pct(run.return_total)}
              color={(run.return_total ?? 0) >= 0 ? tokens.emerald : tokens.red}
              size={22}
              style={{ marginTop: 3 }}
            />
          </Card>
          <Card pad={12}>
            <Label>SHARPE</Label>
            <Metric
              v={num(run.sharpe)}
              color={(run.sharpe ?? 0) > 1 ? tokens.emerald : tokens.text}
              size={22}
              style={{ marginTop: 3 }}
            />
          </Card>
          <Card pad={12}>
            <Label>MAX DD</Label>
            <Metric
              v={pct(run.max_drawdown)}
              color={tokens.red}
              size={22}
              style={{ marginTop: 3 }}
            />
          </Card>
          <Card pad={12}>
            <Label>WIN RATE</Label>
            <Metric
              v={
                typeof run.win_rate === "number"
                  ? `${(run.win_rate * 100).toFixed(0)}%`
                  : "—"
              }
              color={(run.win_rate ?? 0) > 0.5 ? tokens.emerald : tokens.amber}
              size={22}
              style={{ marginTop: 3 }}
            />
          </Card>
          <Card pad={12}>
            <Label>N ASSETS</Label>
            <Metric
              v={typeof run.n_assets === "number" ? `${run.n_assets}` : "—"}
              color={tokens.text}
              size={22}
              style={{ marginTop: 3 }}
            />
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Card pad={12}>
            <Label>VS BTC</Label>
            <Metric
              v={pct(run.vs_btc)}
              color={(run.vs_btc ?? 0) >= 0 ? tokens.emerald : tokens.red}
              size={20}
              style={{ marginTop: 3 }}
            />
          </Card>
          <Card pad={12}>
            <Label>VS ETH</Label>
            <Metric
              v={pct(run.vs_eth)}
              color={(run.vs_eth ?? 0) >= 0 ? tokens.emerald : tokens.red}
              size={20}
              style={{ marginTop: 3 }}
            />
          </Card>
        </div>

        <Card pad={14}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Equity curve · base 100
          </div>
          {equityNorm.length > 1 ? (
            <LineChart
              w={860}
              h={240}
              series={[
                {
                  data: equityNorm,
                  color: tokens.emerald,
                  thick: true,
                  fill: true,
                },
              ]}
            />
          ) : (
            <Mono size={11}>no equity series available</Mono>
          )}
        </Card>

        <div style={{ textAlign: "center", paddingTop: 12 }}>
          <Mono size={10}>
            Powered by HypeNode · backtest replay over real SoSoValue klines
          </Mono>
        </div>
      </div>
    </div>
  );
}
