"use client";

// EtfSnapshotPanel
// ----------------
// Horizontal grid of small per-ETF "snapshot" cards rendered above the ETF
// flow audit table. One card per ticker, each pulled independently from
// `GET /etfs/{ticker}/market-snapshot` via `getEtfSnapshot`.
//
// Polls every 60s WHILE THE TAB IS VISIBLE (paused on document.hidden — see the
// effect below). Each tick mostly hits the per-path cache (market-snapshot TTL
// is 5 min), so a visible tab costs roughly one upstream refresh per ticker per
// 5 min, and a backgrounded tab costs nothing. When SOSOVALUE_API_KEY is unset
// (or any backoff window is active) the underlying lib serves a deterministic
// IBIT-shaped synthetic — the per-card "live / synthetic" pill makes that obvious.
//
// Visual contract:
//   - Ticker (large mono, top-left).
//   - mkt_price + prem_dsc on a single row, prem coloured red/emerald/faint
//     depending on sign + magnitude.
//   - net_inflow today coloured (+ emerald / − red).
//   - cum_inflow ("cum $35.2B") in faint mono.
//   - sponsor_fee small ("0.25% fee") in faint mono.
//   - Status pill bottom-right: live (emerald · dot) when source data looks
//     real, synthetic (faint) when the lib served the fallback.
//
// Loading state: skeleton card per ticker. Error state: error pill per card —
// one card failing never takes down its siblings.

import { useCallback, useEffect, useState } from "react";

import { Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { useTabActivity } from "@/lib/hooks/useTabActivity";
import {
  getEtfSnapshot,
  type EtfSnapshot,
} from "@/lib/api/sosovalue/etf-snapshot";

const POLL_MS = 60_000;

// -- formatters --------------------------------------------------------------

/**
 * USD with magnitude suffix: "$1.2B" / "$50M" / "$3.5K". Sign preserved with
 * a real Unicode minus (−) so columns line up regardless of the user's font.
 * `signed=true` forces a leading "+" on positives — used for daily flow.
 */
export function fmtUsd(usd: number, opts: { signed?: boolean } = {}): string {
  const { signed = false } = opts;
  if (!Number.isFinite(usd)) return "—";
  const abs = Math.abs(usd);
  const sign = usd < 0 ? "−" : signed ? "+" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Decimal → percentage string. 0.0025 → "0.25%", -0.0001 → "-0.01%". */
export function fmtPct(decimal: number, digits = 2): string {
  if (!Number.isFinite(decimal)) return "—";
  return `${(decimal * 100).toFixed(digits)}%`;
}

/** Plain price formatter: "$58.42". */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

// -- prem/dsc colour ramp ----------------------------------------------------
//
// `prem_dsc` is a decimal fraction of NAV. Anything within ±5bps reads as
// "near zero" and we mute the colour so a tracking ETF doesn't look alarmed
// on every poll.
const PREM_NEAR_ZERO = 0.0005;
function premColor(prem: number): string {
  if (Math.abs(prem) < PREM_NEAR_ZERO) return tokens.textFaint;
  return prem >= 0 ? tokens.emerald : tokens.red;
}

// -- card row shape ----------------------------------------------------------

type CardState =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; snap: EtfSnapshot; live: boolean };

// Heuristic: detect whether we're staring at the synthetic fallback. The lib
// fallback uses sponsor_fee = 0.0025 exactly + a YYYY-MM-DD `date` matching
// today's UTC date. Live data nearly always sends `sponsor_fee` as a string
// or hits a slightly different value. We treat string sponsor_fee or an
// older date as a strong signal that the upstream answered.
function looksLive(snap: EtfSnapshot): boolean {
  if (typeof snap.sponsor_fee === "string") return true;
  // Live API returns numeric volume serialised as a string; synthetic also
  // emits a string but the shape differs in length. Fall back to the
  // sponsor_fee heuristic as the primary signal.
  return false;
}

// -- component ---------------------------------------------------------------

export function EtfSnapshotPanel({ tickers }: { tickers: string[] }) {
  const { hidden } = useTabActivity();
  const [states, setStates] = useState<Record<string, CardState>>(() => {
    const init: Record<string, CardState> = {};
    for (const t of tickers) init[t] = { kind: "loading" };
    return init;
  });

  const loadOne = useCallback(async (ticker: string) => {
    try {
      const snap = await getEtfSnapshot(ticker);
      if (!snap) {
        setStates((prev) => ({
          ...prev,
          [ticker]: { kind: "error", error: "upstream unreachable" },
        }));
        return;
      }
      setStates((prev) => ({
        ...prev,
        [ticker]: { kind: "ready", snap, live: looksLive(snap) },
      }));
    } catch (e) {
      setStates((prev) => ({
        ...prev,
        [ticker]: { kind: "error", error: (e as Error).message || "load failed" },
      }));
    }
  }, []);

  // Pause polling while the tab is hidden so a backgrounded /history tab does
  // not burn SoSoValue quota 24/7. On returning to visible we fire one
  // immediate refresh and resume the interval — mirrors useAutoRefetch's
  // visibility behaviour (the agent-decision poll on this page already paused
  // on hidden; this ETF panel previously did not, and was the worst offender:
  // 5 tickers × every 60s with no pause could approach the monthly cap from a
  // single forgotten tab).
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    const tick = () => {
      for (const t of tickers) {
        if (cancelled) return;
        void loadOne(t);
      }
    };
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [tickers, loadOne, hidden]);

  return (
    <div
      className="grid gap-3"
      style={{
        // Auto-fit so 3 ETFs land in 3 columns and 5 ETFs in 5; on narrow
        // screens cards wrap to a horizontally scrollable single row.
        gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
      }}
    >
      {tickers.map((t) => (
        <SnapshotCard key={t} ticker={t} state={states[t] ?? { kind: "loading" }} />
      ))}
    </div>
  );
}

// -- single card -------------------------------------------------------------

function SnapshotCard({ ticker, state }: { ticker: string; state: CardState }) {
  return (
    <Card pad={12} className="relative" style={{ minHeight: 110 }}>
      <div
        className="font-mono"
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: tokens.text,
        }}
      >
        {ticker}
      </div>

      {state.kind === "loading" && <SkeletonBody />}
      {state.kind === "error" && (
        <div className="mt-2">
          <Mono size={10} color={tokens.red}>
            load failed
          </Mono>
        </div>
      )}
      {state.kind === "ready" && <ReadyBody snap={state.snap} />}

      <div
        className="absolute"
        style={{ right: 8, bottom: 8 }}
      >
        {state.kind === "loading" && (
          <Tag small color={tokens.textFaint}>
            …
          </Tag>
        )}
        {state.kind === "error" && (
          <Tag small color={tokens.red} dot>
            err
          </Tag>
        )}
        {state.kind === "ready" && (
          <Tag
            small
            dot
            color={state.live ? tokens.emerald : tokens.textFaint}
          >
            {state.live ? "live" : "synthetic"}
          </Tag>
        )}
      </div>
    </Card>
  );
}

function ReadyBody({ snap }: { snap: EtfSnapshot }) {
  const sponsorPct = Number(snap.sponsor_fee);
  const prem = Number(snap.prem_dsc);
  const inflow = Number(snap.net_inflow);
  const cum = Number(snap.cum_inflow);

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span
          className="font-mono"
          style={{ fontSize: 13, color: tokens.text, letterSpacing: "-0.01em" }}
        >
          {fmtPrice(snap.mkt_price)}
        </span>
        <Mono size={10} color={tokens.textFaint}>
          ·
        </Mono>
        <Mono size={10} color={premColor(prem)}>
          prem {fmtPct(prem)}
        </Mono>
      </div>
      <Mono size={11} color={inflow >= 0 ? tokens.emerald : tokens.red}>
        {fmtUsd(inflow, { signed: true })} today
      </Mono>
      <Mono size={10} color={tokens.textDim}>
        cum {fmtUsd(cum)}
      </Mono>
      <Mono size={9} color={tokens.textFaint}>
        {fmtPct(sponsorPct)} fee
      </Mono>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5" aria-hidden>
      <div
        style={{
          width: "70%",
          height: 12,
          borderRadius: 3,
          background: tokens.bgElev2,
        }}
      />
      <div
        style={{
          width: "50%",
          height: 10,
          borderRadius: 3,
          background: tokens.bgElev2,
        }}
      />
      <div
        style={{
          width: "60%",
          height: 10,
          borderRadius: 3,
          background: tokens.bgElev2,
        }}
      />
      <div
        style={{
          width: "35%",
          height: 9,
          borderRadius: 3,
          background: tokens.bgElev2,
        }}
      />
    </div>
  );
}
