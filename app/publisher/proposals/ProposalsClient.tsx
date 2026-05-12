"use client";

// Client-side proposals dashboard. Reads /api/proposals?scope=mine and
// surfaces creator workflow: create new draft, review existing drafts,
// see status, link out to the SSI explorer for live indices.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

import { Btn, Card, Mono, Tag } from "@/components/ui";
import { formatSyncLabel, useAutoRefetch } from "@/lib/hooks/useAutoRefetch";
import { tokens } from "@/lib/tokens";
import type { PbProposalRow } from "@/lib/supabase/types";

const STATUS_COLOR: Record<PbProposalRow["status"], string> = {
  draft: tokens.textDim,
  review: tokens.cyan,
  signed: tokens.amber,
  published: tokens.emerald,
  live: tokens.emerald,
  paused: tokens.amber,
  rejected: tokens.red,
};

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Drafts", value: "draft" },
  { label: "Review", value: "review" },
  { label: "Signed", value: "signed" },
  { label: "Live", value: "published,live" },
  { label: "Rejected", value: "rejected" },
];

function fmtRelative(iso: string): string {
  const dt = Date.now() - Date.parse(iso);
  const s = Math.max(0, Math.round(dt / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function summarizeConstituents(c: unknown): string {
  if (!c) return "—";
  if (Array.isArray(c)) {
    const syms = c
      .map((x: unknown) => {
        if (typeof x === "object" && x !== null) {
          const r = x as Record<string, unknown>;
          if (typeof r.symbol === "string") return r.symbol.toUpperCase();
          if (typeof r.ticker === "string") return r.ticker.toUpperCase();
        }
        return null;
      })
      .filter((s): s is string => !!s);
    if (syms.length === 0) return `${c.length} assets`;
    return `${c.length} · ${syms.slice(0, 5).join(" ")}${syms.length > 5 ? " …" : ""}`;
  }
  if (typeof c === "object") {
    return `${Object.keys(c as object).length} assets`;
  }
  return "—";
}

export function ProposalsClient() {
  const [filter, setFilter] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);

  // Background poll the user's proposals so a publish from the agent service
  // (or another browser tab) flows in without a manual reload. Note the URL
  // intentionally does NOT include the filter — we filter on the client so
  // toggling status chips never resets the polling interval or refetches
  // the same data with a different query string.
  const proposalsHook = useAutoRefetch<PbProposalRow[]>(
    "/api/proposals?scope=mine",
    { intervalMs: 30_000 },
  );

  // Manual reload exposed to children (delete row, create form). Routes
  // through the hook's refetch so we share the abort/dedup machinery
  // instead of racing the interval with a parallel fetch.
  const load = useCallback(async () => {
    await proposalsHook.refetch();
  }, [proposalsHook]);

  // Surface auth failure as a banner instead of a hook error: a logged-out
  // user on this page is a meaningful state, not a transient network glitch.
  // The error message from the hook surfaces as-is otherwise.
  const proposals = proposalsHook.data;
  const loadError =
    proposalsHook.error === null
      ? null
      : /401|unauth/i.test(proposalsHook.error)
        ? "Sign in with your wallet to view your proposals."
        : proposalsHook.error;

  // Client-side status filter. The chip values may be a comma list
  // ("published,live") to group conceptually-similar statuses.
  const filteredProposals = useMemo(() => {
    if (!proposals) return null;
    if (!filter) return proposals;
    const allowed = new Set(filter.split(","));
    return proposals.filter((p) => allowed.has(p.status));
  }, [proposals, filter]);

  const groupCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const p of proposals ?? []) {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
    }
    return acc;
  }, [proposals]);

  const total = filteredProposals?.length ?? 0;

  return (
    <>
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            My Proposals
          </div>
          <Mono size={11}>
            {proposals === null
              ? "loading…"
              : `${total} saved · live counts: draft ${groupCounts.draft ?? 0} · review ${
                  groupCounts.review ?? 0
                } · live ${(groupCounts.published ?? 0) + (groupCounts.live ?? 0)}`}
            {" · "}
            <span style={{ color: tokens.textFaint }}>
              {formatSyncLabel(proposalsHook.lastFetchedAt, proposalsHook.loading)}
            </span>
          </Mono>
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <Btn
              key={f.value}
              small
              primary={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Btn>
          ))}
          <Btn small primary onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "× Cancel" : "+ New proposal"}
          </Btn>
        </div>
      </div>

      {loadError && (
        <Card pad={14}>
          <Tag small color={tokens.red} dot>
            error
          </Tag>
          <Mono size={11} color={tokens.textDim} className="mt-2 block">
            {loadError}
          </Mono>
        </Card>
      )}

      {showCreate && (
        <CreateProposalForm
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}

      <div className="flex flex-col gap-2.5">
        {filteredProposals !== null && filteredProposals.length === 0 && !loadError && (
          <Card pad={20}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              {filter ? "No proposals match this filter" : "No proposals yet"}
            </div>
            <Mono size={11} color={tokens.textDim}>
              Agent will draft proposals based on Hype Radar signals, or you can
              create one manually with the button above.
            </Mono>
            <div className="mt-3 flex gap-1.5">
              <Link href="/publisher/radar" className="contents">
                <Btn small>Open Hype Radar</Btn>
              </Link>
              <Btn small primary onClick={() => setShowCreate(true)}>
                + New proposal
              </Btn>
            </div>
          </Card>
        )}

        {(filteredProposals ?? []).map((p) => (
          <ProposalRow key={p.id} p={p} onChanged={() => void load()} />
        ))}
      </div>
    </>
  );
}

function ProposalRow({ p, onChanged }: { p: PbProposalRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function deleteRow() {
    if (!confirm(`Delete proposal "${p.title ?? p.id.slice(0, 8)}"? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/proposals/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `delete failed (${res.status})`);
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card pad={0}>
      <div
        className="grid items-center"
        style={{
          padding: 14,
          gap: 16,
          gridTemplateColumns: "1fr auto auto",
        }}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Tag small color={STATUS_COLOR[p.status]} dot>
              {p.status}
            </Tag>
            <Tag small color={tokens.amber} filled>
              {p.ssi_ticker}
            </Tag>
            <Tag small color={tokens.textFaint}>
              {p.source}
            </Tag>
            <Mono size={10} color={tokens.textFaint}>
              · {fmtRelative(p.updated_at)}
            </Mono>
          </div>
          <Link
            href={`/publisher/proposals/${p.id}`}
            style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}
          >
            {p.title ?? `Untitled · ${p.id.slice(0, 8)}`}
          </Link>
          {p.thesis && (
            <div
              style={{
                fontSize: 12,
                color: tokens.textDim,
                lineHeight: 1.4,
                maxWidth: 720,
              }}
            >
              {p.thesis.length > 200 ? `${p.thesis.slice(0, 200)}…` : p.thesis}
            </div>
          )}
          <Mono size={10} color={tokens.textFaint}>
            constituents: {summarizeConstituents(p.constituents)}
            {p.backtest_return !== null
              ? ` · bt return ${(p.backtest_return * 100).toFixed(2)}%`
              : ""}
            {p.backtest_sharpe !== null
              ? ` · sharpe ${p.backtest_sharpe.toFixed(2)}`
              : ""}
          </Mono>
          {err && (
            <Mono size={10} color={tokens.red}>
              {err}
            </Mono>
          )}
        </div>
        <div className="flex flex-col gap-1.5" style={{ minWidth: 140 }}>
          <Link href={`/publisher/proposals/${p.id}`} className="contents">
            <Btn primary small style={{ justifyContent: "center" }}>
              Open →
            </Btn>
          </Link>
          {(p.status === "published" || p.status === "live") && p.on_chain_tx && (
            <a
              href={`https://sepolia.etherscan.io/tx/${p.on_chain_tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="contents"
            >
              <Btn small style={{ justifyContent: "center" }}>
                View tx ↗
              </Btn>
            </a>
          )}
          <Btn
            small
            disabled={busy}
            onClick={deleteRow}
            style={{ justifyContent: "center", color: tokens.textDim }}
          >
            {busy ? "…" : "Delete"}
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function CreateProposalForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [ticker, setTicker] = useState("ssiDePIN");
  const [thesis, setThesis] = useState("");
  const [constituentsRaw, setConstituentsRaw] = useState(
    `[\n  { "symbol": "FIL", "weight": 0.5 },\n  { "symbol": "RNDR", "weight": 0.5 }\n]`,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    let constituents: unknown;
    try {
      constituents = JSON.parse(constituentsRaw);
    } catch (e) {
      setErr(`constituents JSON parse: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!ticker.trim()) {
      setErr("ssi_ticker required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ssi_ticker: ticker.trim(),
          title: title.trim() || null,
          thesis: thesis.trim() || null,
          constituents,
          source: "manual",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `create failed (${res.status})`);
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: tokens.bgElev2,
    border: `1px solid ${tokens.border}`,
    color: tokens.text,
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "JetBrains Mono, monospace",
    borderRadius: 5,
    width: "100%",
  };

  return (
    <Card pad={16}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
        New proposal
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <Mono size={10} color={tokens.textFaint} className="block mb-1">
            TITLE
          </Mono>
          <input
            style={inputStyle}
            value={title}
            placeholder="HYPE-DEPIN-8"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <Mono size={10} color={tokens.textFaint} className="block mb-1">
            SSI TICKER
          </Mono>
          <input
            style={inputStyle}
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Mono size={10} color={tokens.textFaint} className="block mb-1">
            THESIS
          </Mono>
          <textarea
            style={{ ...inputStyle, minHeight: 60 }}
            value={thesis}
            placeholder="Why should subscribers care about this index?"
            onChange={(e) => setThesis(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Mono size={10} color={tokens.textFaint} className="block mb-1">
            CONSTITUENTS (JSON)
          </Mono>
          <textarea
            style={{ ...inputStyle, minHeight: 110 }}
            value={constituentsRaw}
            spellCheck={false}
            onChange={(e) => setConstituentsRaw(e.target.value)}
          />
        </div>
      </div>
      {err && (
        <Mono size={11} color={tokens.red} className="block mt-2">
          {err}
        </Mono>
      )}
      <div className="flex gap-1.5 mt-2.5">
        <Btn primary small disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Save draft"}
        </Btn>
      </div>
    </Card>
  );
}
