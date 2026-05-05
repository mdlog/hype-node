"use client";

// MacroCalendar — horizontal 7-day strip of upcoming macro events with an
// expandable per-event 6-month history panel (actual vs forecast bars).
//
// Color coding follows the design spec:
//   FOMC                → red
//   CPI / PPI           → amber
//   NFP / Unemployment  → violet (#A78BFA)
//   GDP                 → emerald
//   default             → cyan
//
// The "RISK" badge above the strip flips to amber ELEVATED when any event
// lands inside the next 24h, otherwise emerald CLEAR.

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, Label, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  getEventHistory,
  listMacroEvents,
  type MacroEventDay,
  type MacroEventHistoryRow,
} from "@/lib/api/sosovalue/macro";

const POLL_MS = 5 * 60 * 1000; // 5 minutes — matches macro release cadence
const HISTORY_MONTHS = 6;
const VIOLET = "#A78BFA";

function eventColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("fomc") || n.includes("fed funds") || n.includes("rate decision")) {
    return tokens.red;
  }
  if (n.includes("cpi") || n.includes("ppi") || n.includes("inflation")) {
    return tokens.amber;
  }
  if (n.includes("nfp") || n.includes("nonfarm") || n.includes("payroll") || n.includes("unemployment")) {
    return VIOLET;
  }
  if (n.includes("gdp")) {
    return tokens.emerald;
  }
  return tokens.cyan;
}

function fmtDateLabel(iso: string): { weekday: string; day: string; month: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
    day: String(d.getUTCDate()).padStart(2, "0"),
    month: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
  };
}

function isWithin24h(iso: string): boolean {
  const eventTs = new Date(`${iso}T00:00:00Z`).getTime();
  const now = Date.now();
  // Day-granular events; treat anything from now → now+24h as elevated.
  return eventTs >= now - 60 * 60 * 1000 && eventTs <= now + 24 * 60 * 60 * 1000;
}

function surprisePct(actual: number, forecast: number): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(forecast) || forecast === 0) return null;
  return ((actual - forecast) / forecast) * 100;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

// ---------- inline history panel ----------

function HistoryPanel({ event, color }: { event: string; color: string }) {
  const [rows, setRows] = useState<MacroEventHistoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setErr(null);
    getEventHistory(event, { limit: HISTORY_MONTHS })
      .then((data) => {
        if (cancelled) return;
        // Show oldest → newest, capped to HISTORY_MONTHS.
        const tail = data.slice(-HISTORY_MONTHS);
        setRows(tail);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "history unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [event]);

  if (err) {
    return (
      <div style={{ padding: "12px 14px" }}>
        <Mono size={11} color={tokens.textFaint}>
          History unavailable: {err}
        </Mono>
      </div>
    );
  }
  if (!rows) {
    return (
      <div style={{ padding: "12px 14px" }}>
        <Mono size={11} color={tokens.textFaint}>
          Loading {HISTORY_MONTHS}-month history…
        </Mono>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: "12px 14px" }}>
        <Mono size={11} color={tokens.textFaint}>
          No history rows for {event}.
        </Mono>
      </div>
    );
  }

  // Normalise bar widths against the largest absolute actual/forecast across
  // the panel so each row's bars stay comparable.
  const maxAbs = rows.reduce((m, r) => {
    return Math.max(m, Math.abs(r.actual), Math.abs(r.forecast));
  }, 0) || 1;

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="flex justify-between" style={{ marginBottom: 2 }}>
        <Label size={9}>{event} · last {rows.length}m</Label>
        <Label size={9} color={tokens.textFaint}>actual / forecast / surprise</Label>
      </div>
      {rows.map((r) => {
        const surprise = surprisePct(r.actual, r.forecast);
        const surpriseColor =
          surprise == null
            ? tokens.textFaint
            : surprise >= 0
              ? tokens.emerald
              : tokens.red;
        const actualPct = (Math.abs(r.actual) / maxAbs) * 100;
        const forecastPct = (Math.abs(r.forecast) / maxAbs) * 100;
        return (
          <div
            key={r.date}
            className="flex items-center gap-2"
            style={{ minHeight: 22 }}
          >
            <Mono size={10} color={tokens.textFaint} style={{ width: 56, flexShrink: 0 }}>
              {r.date.slice(0, 7)}
            </Mono>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <div
                style={{
                  height: 5,
                  width: `${Math.max(2, actualPct)}%`,
                  background: color,
                  borderRadius: 2,
                }}
                title={`actual ${fmtNum(r.actual)}`}
              />
              <div
                style={{
                  height: 5,
                  width: `${Math.max(2, forecastPct)}%`,
                  background: `${color}55`,
                  borderRadius: 2,
                }}
                title={`forecast ${fmtNum(r.forecast)}`}
              />
            </div>
            <Mono size={10} color={tokens.text} style={{ width: 52, textAlign: "right" }}>
              {fmtNum(r.actual)}
            </Mono>
            <Mono size={10} color={tokens.textDim} style={{ width: 52, textAlign: "right" }}>
              {fmtNum(r.forecast)}
            </Mono>
            <Mono size={10} color={surpriseColor} style={{ width: 56, textAlign: "right" }}>
              {surprise == null ? "—" : `${surprise >= 0 ? "+" : ""}${surprise.toFixed(1)}%`}
            </Mono>
          </div>
        );
      })}
    </div>
  );
}

// ---------- day card ----------

type DayCardProps = {
  day: MacroEventDay;
  expandedKey: string | null;
  onToggle: (key: string | null) => void;
};

function DayCard({ day, expandedKey, onToggle }: DayCardProps) {
  const label = fmtDateLabel(day.date);
  const within24 = isWithin24h(day.date);
  return (
    <div
      style={{
        flex: "0 0 auto",
        minWidth: 168,
        background: tokens.bgElev2,
        border: `1px solid ${within24 ? tokens.amber + "55" : tokens.border}`,
        borderRadius: 8,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="flex justify-between items-start">
        <div className="flex flex-col" style={{ gap: 2 }}>
          <Label size={9} color={within24 ? tokens.amber : tokens.textFaint}>
            {label.weekday}
          </Label>
          <Mono size={18} color={tokens.text}>
            {label.day} {label.month}
          </Mono>
        </div>
        {within24 && (
          <Tag small dot color={tokens.amber}>
            24H
          </Tag>
        )}
      </div>
      <div className="flex flex-col" style={{ gap: 4 }}>
        {day.events.length === 0 ? (
          <Mono size={10} color={tokens.textFaint}>—</Mono>
        ) : (
          day.events.map((ev) => {
            const color = eventColor(ev);
            const key = `${day.date}::${ev}`;
            const isOpen = expandedKey === key;
            return (
              <button
                key={ev}
                type="button"
                onClick={() => onToggle(isOpen ? null : key)}
                className="font-sans"
                style={{
                  background: isOpen ? `${color}22` : "transparent",
                  border: `1px solid ${color}${isOpen ? "66" : "33"}`,
                  borderRadius: 4,
                  padding: "4px 7px",
                  cursor: "pointer",
                  textAlign: "left",
                  color: tokens.text,
                  fontSize: 11.5,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  letterSpacing: "-0.005em",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: color,
                    boxShadow: `0 0 6px ${color}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ev}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------- main component ----------

export function MacroCalendar() {
  const [days, setDays] = useState<MacroEventDay[] | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchEvents = useCallback(() => {
    listMacroEvents()
      .then((data) => {
        // Ensure ascending date order and trim to next 7 days.
        const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
        setDays(sorted);
        setErr(null);
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : "calendar unavailable");
      });
  }, []);

  useEffect(() => {
    fetchEvents();
    const id = window.setInterval(fetchEvents, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchEvents]);

  const elevated = useMemo(() => {
    if (!days) return false;
    return days.some((d) => d.events.length > 0 && isWithin24h(d.date));
  }, [days]);

  const expandedEvent = useMemo(() => {
    if (!expandedKey) return null;
    const [, ev] = expandedKey.split("::");
    return ev ?? null;
  }, [expandedKey]);

  return (
    <Card pad={0} className="overflow-hidden flex flex-col">
      <div
        className="flex justify-between items-center"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div className="flex items-center" style={{ gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Macro calendar</div>
          <Mono size={10} color={tokens.textFaint}>· next 7 days</Mono>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <Label size={9}>RISK</Label>
          {elevated ? (
            <Tag small dot color={tokens.amber}>
              ELEVATED · macro within 24h
            </Tag>
          ) : (
            <Tag small dot color={tokens.emerald}>
              CLEAR
            </Tag>
          )}
        </div>
      </div>

      <div style={{ padding: 12, display: "flex", gap: 8, overflowX: "auto" }}>
        {err && !days ? (
          <Mono size={11} color={tokens.textFaint}>Calendar unavailable: {err}</Mono>
        ) : !days ? (
          <Mono size={11} color={tokens.textFaint}>Loading calendar…</Mono>
        ) : days.length === 0 ? (
          <Mono size={11} color={tokens.textFaint}>No upcoming macro events.</Mono>
        ) : (
          days.map((d) => (
            <DayCard
              key={d.date}
              day={d}
              expandedKey={expandedKey}
              onToggle={setExpandedKey}
            />
          ))
        )}
      </div>

      {expandedEvent && (
        <div style={{ borderTop: `1px solid ${tokens.border}`, background: tokens.bgElev }}>
          <HistoryPanel event={expandedEvent} color={eventColor(expandedEvent)} />
        </div>
      )}
    </Card>
  );
}
