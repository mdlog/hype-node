"use client";

import { Card, Label, Mono, Tag, Btn, Toggle, LogoSplash } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import type { BasketProposal, BacktestResult } from "@/lib/api/agent";
import type { CurrencyListItem } from "@/lib/api/sosovalue/tokens";
import { SSI_REGISTRY_ABI } from "@/lib/contracts/ssiRegistryAbi";
import { useSessionGuard } from "@/lib/auth/useSessionGuard";
import { useFirstRun } from "@/lib/hooks/useFirstRun";
import { WalletMismatchBanner } from "@/components/auth/WalletMismatchBanner";
import { AddAssetModal } from "./AddAssetModal";

type LoadState = "loading" | "ready" | "error";
type WeightingKey = "score" | "marketcap" | "equal" | "ssi_reference";
type ExtraAsset = { currency_id: string; symbol: string };
// Tuple matching SSIRegistry.registerIndex(...) parameter order, used both
// for compile-time arg validation and runtime contract dispatch.
type DeployArgs = readonly [
  symbol: string,
  name: string,
  base: string,
  tokens: readonly string[],
  weightsBps: readonly number[],
  mgmtFeeBps: number,
  perfFeeBps: number,
  rebalanceCron: string,
];

const SECTORS = [
  "DePIN",
  "RWA",
  "AI",
  "Memes",
  "GameFi",
  "Layer1",
  "Layer2",
  "MAG7",
  "PayFi",
  "DeFi",
  "SocialFi",
  "CeFi",
  "NFT",
] as const;

// UI label → backend key for the weighting selector. Indices match the
// radio order rendered below; index 3 ("Custom formula") falls back to
// ssi_reference since the backend doesn't expose a custom formula yet.
const RULES: { label: string; key: WeightingKey }[] = [
  { label: "Sentiment-weighted (AI score)", key: "score" },
  { label: "Market cap × liquidity", key: "marketcap" },
  { label: "Equal weight", key: "equal" },
  { label: "SSI reference weights", key: "ssi_reference" },
];

const STEP_LABELS = ["Signal", "Constituents", "Weights & rules", "Simulate", "Deploy"];

const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_SSI_REGISTRY_ADDRESS as
  | `0x${string}`
  | undefined;
const TARGET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_SSI_CHAIN_ID ?? sepolia.id,
);

// Legacy localStorage key — kept for one-time migration of pre-Phase-2
// drafts into Supabase the first time a signed-in user lands on this page.
// After migration we delete the key so subsequent visits skip the import
// step entirely.
const LEGACY_DRAFT_KEY = "hypenode.builder.drafts.v1";

// Local UI shape, populated either from Supabase rows (BdDraftRow) or
// from a legacy localStorage entry during migration. We intentionally keep
// `id` a string (uuid for Supabase, timestamp string for legacy) and
// `savedAt` as ms since epoch derived from `updated_at`.
type Draft = {
  id: string;
  savedAt: number;
  sector: string;
  nAssets: number;
  weightingKey: WeightingKey;
  meta: { name: string; symbol: string; base: string; chain: string };
  triggers: Record<string, boolean>;
  extraAssets: ExtraAsset[];
};

type LegacyDraft = Draft;

// Wire shape of a row coming from /api/builder/drafts. We don't import
// BdDraftRow into a "use client" file (that would pull in server-only
// types via the chain), so this is a hand-mirrored subset.
type DraftWire = {
  id: string;
  updated_at: string;
  sector: string | null;
  n_assets: number | null;
  weighting_rule: string | null;
  meta: unknown;
  rebalance_triggers: unknown;
  extra_assets: unknown;
  status: string;
};

const DEFAULT_META = {
  name: "HYPE-DEPIN-8",
  symbol: "HDP8",
  base: "USDC",
  chain: "ValueChain L1",
} as const;

const DEFAULT_TRIGGERS: Record<string, boolean> = {
  cron: true,
  sentiment: true,
  flow: false,
  vol: true,
  news: false,
};

function isWeightingKey(v: unknown): v is WeightingKey {
  return v === "score" || v === "marketcap" || v === "equal" || v === "ssi_reference";
}

function wireToDraft(w: DraftWire): Draft {
  // The server stores meta as jsonb. We hydrate defensively because the
  // shape isn't enforced in Postgres beyond "is JSON".
  const m = (w.meta && typeof w.meta === "object" ? w.meta : {}) as Partial<
    typeof DEFAULT_META
  >;
  const t = (w.rebalance_triggers && typeof w.rebalance_triggers === "object"
    ? w.rebalance_triggers
    : {}) as Record<string, unknown>;
  const triggers: Record<string, boolean> = {};
  for (const k of Object.keys(DEFAULT_TRIGGERS)) {
    triggers[k] = typeof t[k] === "boolean" ? (t[k] as boolean) : DEFAULT_TRIGGERS[k];
  }
  const extras = Array.isArray(w.extra_assets)
    ? (w.extra_assets as unknown[]).filter(
        (e): e is ExtraAsset =>
          !!e && typeof e === "object" &&
          typeof (e as ExtraAsset).currency_id === "string" &&
          typeof (e as ExtraAsset).symbol === "string",
      )
    : [];
  return {
    id: w.id,
    savedAt: new Date(w.updated_at).getTime(),
    sector: w.sector ?? "DePIN",
    nAssets: w.n_assets ?? 8,
    weightingKey: isWeightingKey(w.weighting_rule) ? w.weighting_rule : "score",
    meta: {
      name: typeof m.name === "string" ? m.name : DEFAULT_META.name,
      symbol: typeof m.symbol === "string" ? m.symbol : DEFAULT_META.symbol,
      base: typeof m.base === "string" ? m.base : DEFAULT_META.base,
      chain: typeof m.chain === "string" ? m.chain : DEFAULT_META.chain,
    },
    triggers,
    extraAssets: extras,
  };
}

// Body sent on POST/PUT — matches the route handler's BdDraftInsert shape.
function draftToBody(d: Omit<Draft, "id" | "savedAt">): Record<string, unknown> {
  return {
    name: d.meta.name,
    sector: d.sector,
    n_assets: d.nAssets,
    weighting_rule: d.weightingKey,
    meta: d.meta,
    rebalance_triggers: d.triggers,
    extra_assets: d.extraAssets,
  };
}

function fmtMcap(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(0);
}

function fmtPct(frac: number): string {
  if (!Number.isFinite(frac)) return "—";
  const pct = frac * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function changeColor(frac: number): string {
  if (!Number.isFinite(frac) || Math.abs(frac) < 0.001) return tokens.textDim;
  return frac >= 0 ? tokens.emerald : tokens.red;
}

function explorerTxUrl(chainId: number, hash: string): string | null {
  if (chainId === sepolia.id) return `https://sepolia.etherscan.io/tx/${hash}`;
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`;
  if (chainId === 286623) return `https://explorer.valuechain.io/tx/${hash}`;
  if (chainId === 138565) return `https://testnet-explorer.valuechain.io/tx/${hash}`;
  return null;
}


export default function BuilderPage() {
  // ---- Signal config (drives proposal fetch) ----
  const [sector, setSector] = useState("DePIN");
  const [nAssets, setNAssets] = useState(8);
  const [rule, setRule] = useState(0); // index into RULES
  const weightingKey = RULES[rule].key;

  // Hydrate sector from `?sector=` on mount — research page links here with
  // the source news's tag. Most news tags are entity names (TON, Bitcoin)
  // that won't match a macro sector; in that case we silently keep the
  // default. Param is consumed once and stripped from the URL so a refresh
  // doesn't keep overriding user edits.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("sector");
    if (incoming) {
      const match = (SECTORS as readonly string[]).find(
        (s) => s.toLowerCase() === incoming.toLowerCase(),
      );
      if (match) setSector(match);
      params.delete("sector");
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState({}, "", next);
    }
  }, []);

  // ---- Proposal + load state ----
  const [proposal, setProposal] = useState<BasketProposal | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  // ---- User edits to constituents ----
  const [extraAssets, setExtraAssets] = useState<ExtraAsset[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [addAssetOpen, setAddAssetOpen] = useState(false);

  // ---- Index metadata + triggers (user form) ----
  const [meta, setMeta] = useState({
    name: "HYPE-DEPIN-8",
    symbol: "HDP8",
    base: "USDC",
    chain: "ValueChain L1",
  });
  const [triggers, setTriggers] = useState<Record<string, boolean>>({
    cron: true,
    sentiment: true,
    flow: false,
    vol: true,
    news: false,
  });

  // ---- Simulate state ----
  const [simulating, setSimulating] = useState(false);
  const [simulateResult, setSimulateResult] = useState<BacktestResult | null>(null);
  const [simulateError, setSimulateError] = useState<string | null>(null);

  // ---- Logos ----
  const [logos, setLogos] = useState<Record<string, string | null>>({});

  // ---- Drafts panel ----
  // Drafts are now persisted server-side in `bd_drafts` (Phase 2). The
  // client mirrors them in state for the dropdown UI; mutations always go
  // through the API and re-list to stay consistent.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  // Tracks the draft currently being edited so "Save draft" can PUT instead
  // of POST. Cleared after Load/Save so the next "Save draft" click starts
  // a fresh row.
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  // Auth gate — surfaced in the UI when the API returns 401 so the user
  // knows they need to sign in for cloud save.
  const [draftsAuthRequired, setDraftsAuthRequired] = useState(false);
  // Set when a legacy localStorage payload is detected and the user hasn't
  // yet decided whether to import or discard. Holds the parsed array so we
  // don't re-parse during render.
  const [legacyDrafts, setLegacyDrafts] = useState<LegacyDraft[] | null>(null);
  const [migrating, setMigrating] = useState(false);

  // ---- Auth + Wagmi for deploy ----
  // Session guard reconciles SIWE session cookie ↔ wagmi-active wallet.
  // We block Deploy on `status !== "ok"` so a user who switched MetaMask
  // accounts mid-session can't sign on-chain TXs with an unauthenticated
  // wallet (which would land in the registry as the wrong creator).
  const guard = useSessionGuard();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const {
    writeContractAsync,
    data: txHash,
    isPending: signing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { data: receipt, isLoading: confirming, error: receiptError } =
    useWaitForTransactionReceipt({ hash: txHash });

  // ---- Proposal fetch ----
  const loadProposal = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    setSimulateResult(null); // invalidate stale simulate
    try {
      const params = new URLSearchParams({
        sector,
        n_assets: String(nAssets),
        weighting: weightingKey,
      });
      const res = await fetch(`/api/agent/propose-basket?${params}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as BasketProposal | null;
      if (!res.ok || !body || body.ok === false) {
        setError(body?.error ?? `HTTP ${res.status}`);
        setProposal(null);
        setLoadState("error");
        return;
      }
      setProposal(body);
      setLoadState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
      setProposal(null);
      setLoadState("error");
    }
  }, [sector, nAssets, weightingKey]);

  useEffect(() => {
    void loadProposal();
  }, [loadProposal]);

  // Logos for both fetched constituents and user-added extras
  useEffect(() => {
    const allSyms: string[] = [];
    for (const c of proposal?.constituents ?? []) {
      if (c.symbol) allSyms.push(c.symbol);
    }
    for (const e of extraAssets) {
      if (e.symbol) allSyms.push(e.symbol);
    }
    if (allSyms.length === 0) return;
    let cancelled = false;
    fetch(`/api/asset-logos?ids=${encodeURIComponent(allSyms.join(","))}`, {
      cache: "force-cache",
    })
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => {
        if (!cancelled) setLogos((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [proposal, extraAssets]);

  // ---- Drafts (Supabase via /api/builder/drafts) ----
  //
  // Drafts moved out of localStorage in Phase 2 — they now live in the
  // `bd_drafts` table keyed on the user's wallet address. The first effect
  // below pulls the current list. If the user is unauthenticated we get a
  // 401, surface that in the UI, and skip persistence (the form still
  // works, but Save is disabled with an "Sign in" hint).
  //
  // Legacy migration: if localStorage still has the old `hypenode.builder
  // .drafts.v1` blob we parse it once and offer a banner to import the
  // entries into the user's account. Auto-importing silently was avoided
  // — the user might prefer to discard them.

  const refreshDrafts = useCallback(async () => {
    setDraftsLoading(true);
    setDraftsAuthRequired(false);
    try {
      const res = await fetch("/api/builder/drafts?status=draft", {
        cache: "no-store",
      });
      if (res.status === 401) {
        setDraftsAuthRequired(true);
        setDrafts([]);
        return;
      }
      if (!res.ok) {
        setDrafts([]);
        return;
      }
      const rows = (await res.json()) as DraftWire[];
      setDrafts(rows.map(wireToDraft));
    } catch {
      /* network blip — leave existing list alone */
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDrafts();
  }, [refreshDrafts]);

  // Detect legacy localStorage drafts on mount. We do this separately from
  // the API call so it surfaces even if the user is signed out (we hold
  // the banner until they sign in and import, or click Discard).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEGACY_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LegacyDraft[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setLegacyDrafts(parsed);
      } else {
        // Empty or junk — clear it so we don't keep checking.
        localStorage.removeItem(LEGACY_DRAFT_KEY);
      }
    } catch {
      // Corrupted blob — drop it; nothing useful to migrate.
      try {
        localStorage.removeItem(LEGACY_DRAFT_KEY);
      } catch {
        /* private mode */
      }
    }
  }, []);

  const saveCurrentDraft = useCallback(async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    const body = draftToBody({
      sector,
      nAssets,
      weightingKey,
      meta,
      triggers,
      extraAssets,
    });
    try {
      // PUT when we already loaded a server-side draft and the user wants
      // to persist further edits to the same row; POST otherwise creates
      // a fresh entry.
      if (currentDraftId) {
        const res = await fetch(`/api/builder/drafts/${currentDraftId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          setDraftsAuthRequired(true);
          return;
        }
        if (!res.ok) return;
      } else {
        const res = await fetch("/api/builder/drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          setDraftsAuthRequired(true);
          return;
        }
        if (!res.ok) return;
        const out = (await res.json()) as { id?: string };
        if (out.id) setCurrentDraftId(out.id);
      }
      setDraftsOpen(true);
      await refreshDrafts();
    } finally {
      setSavingDraft(false);
    }
  }, [
    sector,
    nAssets,
    weightingKey,
    meta,
    triggers,
    extraAssets,
    currentDraftId,
    savingDraft,
    refreshDrafts,
  ]);

  const loadDraft = useCallback(async (d: Draft) => {
    // Source of truth is the server — re-fetch by id to pick up any edits
    // made in another tab or via PATCH.
    let next = d;
    try {
      const res = await fetch(`/api/builder/drafts/${d.id}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const wire = (await res.json()) as DraftWire;
        next = wireToDraft(wire);
      }
    } catch {
      /* fall back to the cached row */
    }
    setSector(next.sector);
    setNAssets(next.nAssets);
    const ruleIdx = RULES.findIndex((r) => r.key === next.weightingKey);
    setRule(ruleIdx >= 0 ? ruleIdx : 0);
    setMeta(next.meta);
    setTriggers(next.triggers);
    setExtraAssets(next.extraAssets);
    setRemovedIds(new Set());
    setSimulateResult(null);
    setCurrentDraftId(next.id);
    setDraftsOpen(false);
  }, []);

  const deleteDraft = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/builder/drafts/${id}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 404) return;
      } catch {
        return;
      }
      if (currentDraftId === id) setCurrentDraftId(null);
      await refreshDrafts();
    },
    [currentDraftId, refreshDrafts],
  );

  const importLegacyDrafts = useCallback(async () => {
    if (!legacyDrafts || legacyDrafts.length === 0) return;
    setMigrating(true);
    try {
      // Sequential to avoid overwhelming the API on a quota-tight account.
      // The list is capped at 20 in legacy code so this is at most 20 RTTs.
      for (const ld of legacyDrafts) {
        const body = draftToBody({
          sector: ld.sector,
          nAssets: ld.nAssets,
          weightingKey: ld.weightingKey,
          meta: ld.meta,
          triggers: ld.triggers,
          extraAssets: ld.extraAssets,
        });
        const res = await fetch("/api/builder/drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          setDraftsAuthRequired(true);
          // Keep legacyDrafts in state so the user can retry after signing in.
          return;
        }
      }
      // Successful import — wipe the legacy blob and refresh the list.
      try {
        localStorage.removeItem(LEGACY_DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setLegacyDrafts(null);
      await refreshDrafts();
    } finally {
      setMigrating(false);
    }
  }, [legacyDrafts, refreshDrafts]);

  const discardLegacyDrafts = useCallback(() => {
    try {
      localStorage.removeItem(LEGACY_DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setLegacyDrafts(null);
  }, []);

  // ---- Effective basket (proposal ∪ extras − removed) ----
  type Row = {
    currency_id: string;
    symbol: string;
    weight: number;
    change_24h?: number;
    marketcap?: number;
    isExtra: boolean;
  };
  const effectiveBasket: Row[] = useMemo(() => {
    const base = (proposal?.constituents ?? [])
      .filter((c) => !removedIds.has(c.currency_id))
      .map((c) => ({
        currency_id: c.currency_id,
        symbol: c.symbol,
        weight: c.weight,
        change_24h: c.change_pct_24h,
        marketcap: c.marketcap,
        isExtra: false,
      }));
    // Extras get equal-weight slice carved out of the existing basket.
    if (extraAssets.length === 0) return base;
    const extraShare = 0.1; // 10% of total reserved for extras, even-split
    const extraEach = extraShare / extraAssets.length;
    const baseScale = 1 - extraShare;
    return [
      ...base.map((b) => ({ ...b, weight: b.weight * baseScale })),
      ...extraAssets.map((e) => ({
        currency_id: e.currency_id,
        symbol: e.symbol,
        weight: extraEach,
        isExtra: true,
      })),
    ];
  }, [proposal, removedIds, extraAssets]);

  const totalWeightPct = effectiveBasket.reduce((s, c) => s + c.weight * 100, 0);
  const summary = proposal?.summary;

  // ---- Step indicator (derived) ----
  const stepDone = (i: number): boolean => {
    if (i === 0 || i === 1) return !!proposal;
    if (i === 2) return !!simulateResult;
    if (i === 3) return !!simulateResult?.ok;
    if (i === 4) return receipt?.status === "success";
    return false;
  };
  const stepActive = (i: number): boolean => {
    if (stepDone(i)) return false;
    if (i === 0) return true;
    return stepDone(i - 1);
  };

  // ---- Simulate ----
  const simulate = useCallback(async () => {
    if (effectiveBasket.length === 0) return;
    setSimulating(true);
    setSimulateError(null);
    try {
      const res = await fetch("/api/agent/run-backtest", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          constituents: effectiveBasket.map((c) => ({
            currency_id: c.currency_id,
            symbol: c.symbol,
            weight: c.weight,
          })),
          days: 90,
        }),
      });
      const body = (await res.json().catch(() => null)) as BacktestResult | null;
      if (!res.ok || !body) {
        setSimulateError(`HTTP ${res.status}`);
        setSimulateResult(null);
        return;
      }
      setSimulateResult(body);
    } catch (e) {
      setSimulateError(e instanceof Error ? e.message : "network error");
    } finally {
      setSimulating(false);
    }
  }, [effectiveBasket]);

  // ---- Deploy ----
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID;
  const deployArgs: DeployArgs | { error: string } | null = useMemo(() => {
    if (effectiveBasket.length === 0) return null;
    if (Math.abs(totalWeightPct - 100) >= 0.5) return { error: "weights drift" };
    const tokensList = effectiveBasket.map((c) => c.symbol.toUpperCase());
    const weightsBps = effectiveBasket.map((c) => Math.round(c.weight * 10_000));
    let sum = weightsBps.reduce((a, b) => a + b, 0);
    if (sum !== 10_000 && weightsBps.length > 0) {
      let maxIdx = 0;
      for (let i = 1; i < weightsBps.length; i++) {
        if (weightsBps[i] > weightsBps[maxIdx]) maxIdx = i;
      }
      weightsBps[maxIdx] += 10_000 - sum;
    }
    return [
      meta.symbol,
      meta.name,
      meta.base,
      tokensList,
      weightsBps,
      0,
      0,
      "",
    ] as DeployArgs;
  }, [effectiveBasket, meta, totalWeightPct]);

  const deployArgsValid = Array.isArray(deployArgs);

  const [deployLocalError, setDeployLocalError] = useState<string | null>(null);
  const { completeStep } = useFirstRun();

  const deploy = useCallback(async () => {
    setDeployLocalError(null);
    resetWrite();
    // Defense-in-depth: even with the disabled button, refuse to call
    // writeContractAsync from a wallet whose address doesn't match the
    // session cookie. Otherwise the on-chain `creator` field would land
    // as a wallet the user isn't authenticated as.
    if (guard.status !== "ok") {
      setDeployLocalError(
        guard.status === "mismatch"
          ? "Wallet mismatch — re-sign with this wallet first"
          : `Session not ready (${guard.status})`,
      );
      return;
    }
    if (!REGISTRY_ADDRESS) {
      setDeployLocalError("NEXT_PUBLIC_SSI_REGISTRY_ADDRESS not set");
      return;
    }
    if (!deployArgs || !Array.isArray(deployArgs)) {
      setDeployLocalError(
        deployArgs && "error" in deployArgs ? deployArgs.error : "no basket to deploy",
      );
      return;
    }
    try {
      if (wrongChain) {
        await switchChainAsync({ chainId: TARGET_CHAIN_ID });
      }
      await writeContractAsync({
        address: REGISTRY_ADDRESS,
        abi: SSI_REGISTRY_ABI,
        functionName: "registerIndex",
        args: deployArgs as DeployArgs,
        chainId: TARGET_CHAIN_ID,
      });
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      setDeployLocalError(e.shortMessage ?? e.message ?? String(err));
    }
  }, [
    deployArgs,
    wrongChain,
    switchChainAsync,
    writeContractAsync,
    resetWrite,
    guard.status,
  ]);

  const deploying = signing || switching || confirming;
  const deployed = receipt?.status === "success";

  useEffect(() => {
    if (deployed) completeStep("createIndex");
  }, [deployed, completeStep]);
  const deployFailed = receipt?.status === "reverted" || !!writeError || !!receiptError;
  const explorer = txHash ? explorerTxUrl(TARGET_CHAIN_ID, txHash) : null;


  // ============== RENDER ==============

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <AddAssetModal
        open={addAssetOpen}
        excludeIds={
          new Set([
            ...effectiveBasket.map((c) => c.currency_id),
          ])
        }
        onClose={() => setAddAssetOpen(false)}
        onPick={(c) => {
          setExtraAssets((prev) => [
            ...prev,
            { currency_id: c.currency_id, symbol: c.symbol },
          ]);
          setSimulateResult(null);
        }}
      />

      {/* Wallet identity mismatch warning (renders only when needed) */}
      <WalletMismatchBanner guard={guard} />

      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Index Builder
          </div>
          <Mono size={11}>
            research → execution · draft, simulate, deploy to SSI Protocol
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small onClick={saveCurrentDraft} disabled={savingDraft}>
            {savingDraft ? "Saving…" : currentDraftId ? "Save draft" : "Save as new"}
          </Btn>
          <Btn small onClick={() => setDraftsOpen((v) => !v)}>
            {draftsLoading
              ? "Load template (…)"
              : `Load template (${drafts.length})`}
          </Btn>
        </div>
      </div>

      {/* Legacy localStorage migration banner — visible while we still have
          unimported drafts in browser storage. Auth-gated import: if the
          user isn't signed in, the API will 401 and we toggle the auth-
          required hint instead of silently dropping the data. */}
      {legacyDrafts && legacyDrafts.length > 0 && (
        <Card pad={12}>
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
                Detected {legacyDrafts.length} local draft
                {legacyDrafts.length === 1 ? "" : "s"} from your browser
              </div>
              <Mono size={11} color={tokens.textDim}>
                {draftsAuthRequired
                  ? "sign in to import them into your account"
                  : "import them into your account so they sync across devices"}
              </Mono>
            </div>
            <div className="flex gap-1.5">
              <Btn
                small
                primary
                onClick={importLegacyDrafts}
                disabled={migrating || draftsAuthRequired}
              >
                {migrating ? "Importing…" : "Import to account"}
              </Btn>
              <Btn small onClick={discardLegacyDrafts} disabled={migrating}>
                Discard
              </Btn>
            </div>
          </div>
        </Card>
      )}

      {/* Drafts panel */}
      {draftsOpen && (
        <Card pad={12}>
          <div className="flex justify-between items-center mb-2">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Saved drafts</div>
            <Btn small onClick={() => setDraftsOpen(false)}>✕ Close</Btn>
          </div>
          {draftsAuthRequired ? (
            <Mono size={11} color={tokens.amber}>
              Sign in to save and load drafts from your account.
            </Mono>
          ) : drafts.length === 0 ? (
            <Mono size={11} color={tokens.textFaint}>
              {draftsLoading
                ? "Loading drafts…"
                : 'No drafts yet. Click "Save draft" above to capture the current configuration to your account.'}
            </Mono>
          ) : (
            <div className="flex flex-col gap-1.5">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between"
                  style={{
                    padding: "8px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                  }}
                >
                  <div className="flex flex-col" style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>
                      {d.meta.name} · {d.meta.symbol}
                    </div>
                    <Mono size={10}>
                      sector {d.sector} · n={d.nAssets} · {d.weightingKey} ·{" "}
                      {new Date(d.savedAt).toISOString().slice(0, 16).replace("T", " ")}
                    </Mono>
                  </div>
                  <div className="flex gap-1">
                    <Btn small onClick={() => loadDraft(d)}>Load</Btn>
                    <Btn small onClick={() => deleteDraft(d.id)}>Delete</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Step indicator (driven by state) */}
      <div
        className="flex items-center"
        style={{
          padding: "12px 16px",
          background: tokens.bgElev,
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
        }}
      >
        {STEP_LABELS.map((s, i) => {
          const done = stepDone(i);
          const active = stepActive(i);
          return (
            <Fragment key={i}>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center justify-center font-mono"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: done
                      ? tokens.emerald
                      : active
                        ? tokens.cyan + "20"
                        : tokens.bgElev2,
                    border: `1px solid ${done ? tokens.emerald : active ? tokens.cyan : tokens.border}`,
                    fontSize: 10,
                    color: done ? tokens.bg : active ? tokens.cyan : tokens.textDim,
                    fontWeight: 600,
                  }}
                >
                  {done ? "✓" : i + 1}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: active ? 600 : 500,
                    color: done || active ? tokens.text : tokens.textDim,
                  }}
                >
                  {s}
                </div>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: done ? tokens.emerald : tokens.border,
                    margin: "0 14px",
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Signal config strip */}
      <Card pad={14}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Mono size={9} color={tokens.textFaint}>
              SECTOR
            </Mono>
            <select
              value={sector}
              onChange={(e) => {
                setSector(e.target.value);
                setExtraAssets([]);
                setRemovedIds(new Set());
              }}
              className="font-mono"
              style={{
                background: tokens.bgElev2,
                color: tokens.text,
                border: `1px solid ${tokens.border}`,
                borderRadius: 5,
                padding: "6px 10px",
                fontSize: 12,
                outline: "none",
              }}
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Mono size={9} color={tokens.textFaint}>
              N ASSETS
            </Mono>
            <input
              type="number"
              min={3}
              max={20}
              value={nAssets}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setNAssets(Math.max(3, Math.min(20, Math.floor(v))));
              }}
              className="font-mono"
              style={{
                width: 60,
                background: tokens.bgElev2,
                color: tokens.text,
                border: `1px solid ${tokens.border}`,
                borderRadius: 5,
                padding: "6px 10px",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>
          <div className="flex-1" />
          <Btn small onClick={loadProposal}>
            ↻ Refresh proposal
          </Btn>
        </div>
      </Card>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
        {/* Constituents card */}
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Constituents
              {loadState === "ready" && (
                <span style={{ color: tokens.textDim, fontWeight: 400 }}>
                  {" · "}
                  {effectiveBasket.length} of {proposal?.n_pool ?? "—"} pool
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <Btn small onClick={() => setAddAssetOpen(true)}>+ Add asset</Btn>
              <Btn
                small
                icon={<span style={{ color: tokens.cyan }}>✦</span>}
                onClick={loadProposal}
              >
                Auto-suggest
              </Btn>
            </div>
          </div>

          {loadState === "loading" && (
            <LogoSplash label="loading basket proposal from agent" size={64} />
          )}

          {loadState === "error" && (
            <div
              style={{
                padding: "24px 16px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: tokens.amber }}>
                Builder data unavailable
              </div>
              <Mono
                size={11}
                color={tokens.textDim}
                style={{ textAlign: "center", maxWidth: 460 }}
              >
                SSI constituents could not be fetched from the agent service. — {error ?? "unknown error"}
              </Mono>
              <Btn small onClick={loadProposal}>
                Retry
              </Btn>
            </div>
          )}

          {loadState === "ready" && (
            <>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "2fr 1fr 1.4fr 0.9fr 30px",
                  padding: "8px 16px",
                  gap: 10,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                {["ASSET", "24H %", "WEIGHT", "MCAP", ""].map((k, i) => (
                  <Label key={i}>{k}</Label>
                ))}
              </div>
              {effectiveBasket.length === 0 && (
                <div style={{ padding: "20px 16px", textAlign: "center" }}>
                  <Mono size={11} color={tokens.textDim}>
                    Empty basket. Click "+ Add asset" or "Auto-suggest".
                  </Mono>
                </div>
              )}
              {effectiveBasket.map((c) => {
                const weightPct = c.weight * 100;
                const tk =
                  c.symbol.length <= 5
                    ? c.symbol.toUpperCase()
                    : c.symbol.slice(0, 5).toUpperCase();
                return (
                  <div
                    key={c.currency_id}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: "2fr 1fr 1.4fr 0.9fr 30px",
                      padding: "10px 16px",
                      gap: 10,
                      borderBottom: `1px solid ${tokens.borderFaint}`,
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <AssetLogo
                        slug={c.symbol}
                        logoUrl={logos[c.symbol.toLowerCase()]}
                        fallbackTicker={tk}
                      />
                      <div>
                        <div className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>
                          {c.symbol.toUpperCase()}
                          {c.isExtra && (
                            <span style={{ marginLeft: 6 }}>
                              <Tag small color={tokens.cyan}>added</Tag>
                            </span>
                          )}
                        </div>
                        <Mono size={9}>{c.currency_id}</Mono>
                      </div>
                    </div>
                    <Mono size={11} color={changeColor(c.change_24h ?? 0)}>
                      {c.change_24h !== undefined ? fmtPct(c.change_24h) : "—"}
                    </Mono>
                    <div>
                      <div
                        style={{
                          height: 6,
                          background: tokens.bgElev2,
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, weightPct * 4)}%`,
                            height: "100%",
                            background: tokens.emerald,
                          }}
                        />
                      </div>
                      <Mono size={10} color={tokens.text} style={{ marginTop: 2, display: "block" }}>
                        {weightPct.toFixed(2)}%
                      </Mono>
                    </div>
                    <Mono size={11} color={tokens.textDim}>
                      {c.marketcap !== undefined ? `$${fmtMcap(c.marketcap)}` : "—"}
                    </Mono>
                    <button
                      type="button"
                      onClick={() => {
                        if (c.isExtra) {
                          setExtraAssets((prev) =>
                            prev.filter((e) => e.currency_id !== c.currency_id),
                          );
                        } else {
                          setRemovedIds((prev) => new Set(prev).add(c.currency_id));
                        }
                        setSimulateResult(null);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: tokens.textFaint,
                        fontSize: 14,
                      }}
                      title="Remove from basket"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              {/* Total weight bar footer */}
              <div
                className="flex justify-between items-center"
                style={{
                  padding: "8px 16px",
                  background: tokens.bgElev2,
                  borderTop: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <Mono size={10}>TOTAL WEIGHT</Mono>
                <div className="flex items-center gap-2">
                  <Mono
                    size={11}
                    color={Math.abs(totalWeightPct - 100) < 0.5 ? tokens.emerald : tokens.amber}
                  >
                    {totalWeightPct.toFixed(2)}%{" "}
                    {Math.abs(totalWeightPct - 100) < 0.5 ? "✓" : "Δ"}
                  </Mono>
                  <Tag
                    small
                    color={Math.abs(totalWeightPct - 100) < 0.5 ? tokens.emerald : tokens.amber}
                    dot
                  >
                    {Math.abs(totalWeightPct - 100) < 0.5 ? "balanced" : "drift"}
                  </Tag>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Right column */}
        <div className="flex flex-col gap-3">
          {loadState === "ready" && summary && (
            <Card pad={14}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Basket summary</div>
              <div className="grid grid-cols-3 gap-2">
                <SummaryTile
                  label="n_picked / n_pool"
                  value={`${proposal?.n_picked ?? effectiveBasket.length} / ${proposal?.n_pool ?? "—"}`}
                />
                <SummaryTile
                  label="avg 24h Δ"
                  value={fmtPct(summary.avg_change_24h_pct)}
                  color={changeColor(summary.avg_change_24h_pct)}
                />
                <SummaryTile
                  label="total mcap"
                  value={`$${fmtMcap(summary.total_marketcap_usd)}`}
                />
              </div>
              <Mono size={9} className="block mt-3 mb-1.5">
                Weighting · {weightingKey}
              </Mono>
              {summary.weights_pct.length > 0 && (
                <CompositionBar weights={summary.weights_pct} symbols={summary.symbols} />
              )}
            </Card>
          )}

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Index metadata</div>
            <Mono size={9} className="block mb-2">
              passed to SSIRegistry.registerIndex on Sign &amp; Deploy
            </Mono>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["Name", "name"],
                  ["Symbol", "symbol"],
                  ["Base", "base"],
                  ["Chain", "chain"],
                ] as const
              ).map(([label, key]) => (
                <label
                  key={key}
                  style={{
                    padding: "6px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                    display: "block",
                  }}
                >
                  <Mono size={9}>{label}</Mono>
                  <input
                    value={meta[key]}
                    onChange={(e) =>
                      setMeta((p) => ({ ...p, [key]: e.target.value }))
                    }
                    className="font-mono"
                    style={{
                      fontSize: 12.5,
                      color: tokens.text,
                      marginTop: 1,
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      outline: "none",
                    }}
                  />
                </label>
              ))}
            </div>
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Weighting rule</div>
            <Mono size={9} className="block mb-2">
              changes refetch the basket from the agent
            </Mono>
            {RULES.map((r, i) => (
              <div
                key={r.key}
                onClick={() => setRule(i)}
                style={{
                  padding: "8px 10px",
                  background: i === rule ? tokens.emerald + "12" : "transparent",
                  border: `1px solid ${i === rule ? tokens.emerald + "40" : tokens.border}`,
                  borderRadius: 5,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `1.5px solid ${i === rule ? tokens.emerald : tokens.borderStrong}`,
                    background: i === rule ? tokens.emerald + "30" : "transparent",
                  }}
                >
                  {i === rule && (
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: tokens.emerald,
                      }}
                    />
                  )}
                </div>
                <div style={{ fontSize: 12, color: i === rule ? tokens.text : tokens.textDim }}>
                  {r.label}
                </div>
              </div>
            ))}
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Rebalance triggers
            </div>
            <Mono size={9} className="block mb-2">
              user-config · saved with draft (not yet wired to backend)
            </Mono>
            {(
              [
                ["Every 6h (cron)", "cron"],
                ["Sentiment Δ > 15", "sentiment"],
                ["Flow reversal", "flow"],
                ["Volatility > 0.35", "vol"],
                ["News keyword match", "news"],
              ] as const
            ).map(([r, k]) => (
              <div
                key={k}
                className="flex justify-between items-center"
                style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <div style={{ fontSize: 12, color: triggers[k] ? tokens.text : tokens.textDim }}>
                  {r}
                </div>
                <Toggle
                  on={triggers[k]}
                  onChange={(next) => setTriggers((p) => ({ ...p, [k]: next }))}
                />
              </div>
            ))}
          </Card>
        </div>
      </div>

      {/* Simulate result section */}
      {simulateResult && (
        <SimulateResultCard
          result={simulateResult}
          onClose={() => setSimulateResult(null)}
        />
      )}
      {simulateError && (
        <Card pad={12}>
          <div className="flex items-center gap-2">
            <Tag small color={tokens.amber} dot>simulate failed</Tag>
            <Mono size={11} color={tokens.textDim}>{simulateError}</Mono>
          </div>
        </Card>
      )}

      {/* Action footer */}
      <Card pad={14}>
        <div className="flex items-center gap-2 flex-wrap">
          <Btn small>← Back</Btn>
          <div className="flex-1" />
          <Btn small onClick={saveCurrentDraft} disabled={savingDraft}>
            {savingDraft ? "Saving…" : currentDraftId ? "Save draft" : "Save as new"}
          </Btn>
          <Btn
            small
            primary
            onClick={simulate}
            disabled={simulating || effectiveBasket.length === 0}
          >
            {simulating ? "Simulating…" : simulateResult?.ok ? "Re-simulate" : "Simulate →"}
          </Btn>
          <Btn
            small
            onClick={deploy}
            disabled={
              !isConnected ||
              guard.status !== "ok" ||
              !simulateResult?.ok ||
              deploying ||
              deployed ||
              !deployArgsValid
            }
          >
            {!isConnected
              ? "Connect wallet"
              : guard.status === "mismatch"
                ? "Resolve wallet mismatch ↑"
                : guard.status === "loading" || guard.status === "signing"
                  ? "Verifying session…"
                  : guard.status === "no-session"
                    ? "Session missing — sign in"
                    : deployed
                      ? "✓ Deployed"
                      : deploying
                        ? "Signing…"
                        : wrongChain
                          ? "Switch chain & deploy"
                          : "Sign & Deploy →"}
          </Btn>
        </div>
        {(deployLocalError || writeError || receiptError) && (
          <Mono size={10} color={tokens.amber} style={{ marginTop: 8, display: "block" }}>
            ⚠ {deployLocalError ?? writeError?.message ?? receiptError?.message}
          </Mono>
        )}
        {txHash && (
          <Mono size={10} color={tokens.textFaint} style={{ marginTop: 8, display: "block" }}>
            tx{" "}
            {explorer ? (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer"
                style={{ color: tokens.cyan }}
              >
                {txHash.slice(0, 10)}…
              </a>
            ) : (
              <span>{txHash.slice(0, 10)}…</span>
            )}
            {" · "}
            {confirming ? "confirming…" : deployed ? "confirmed ✓" : deployFailed ? "failed" : "pending"}
          </Mono>
        )}
      </Card>
    </div>
  );
}


// ---------- Sub-components ----------

function SummaryTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 5,
      }}
    >
      <Mono size={9}>{label}</Mono>
      <div className="font-mono" style={{ fontSize: 13, color: color ?? tokens.text, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function CompositionBar({
  weights,
  symbols,
}: {
  weights: number[];
  symbols: string[];
}) {
  const palette = [
    tokens.emerald,
    tokens.cyan,
    tokens.amber,
    tokens.emeraldDim,
    "#6366F1",
    "#A855F7",
    tokens.red,
    tokens.amberDim,
  ];
  return (
    <>
      <div
        className="flex w-full overflow-hidden"
        style={{ height: 10, borderRadius: 4, border: `1px solid ${tokens.border}` }}
      >
        {weights.map((w, i) => (
          <div
            key={i}
            title={`${symbols[i] ?? ""} ${w.toFixed(2)}%`}
            style={{
              width: `${w}%`,
              background: palette[i % palette.length],
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {symbols.map((s, i) => (
          <Mono key={s} size={9.5} color={tokens.textDim}>
            {s} {weights[i]?.toFixed(1)}%
          </Mono>
        ))}
      </div>
    </>
  );
}

function SimulateResultCard({
  result,
  onClose,
}: {
  result: BacktestResult;
  onClose: () => void;
}) {
  if (!result.ok) {
    return (
      <Card pad={14}>
        <div className="flex justify-between items-start">
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.amber }}>
              Backtest failed
            </div>
            <Mono size={11} color={tokens.textDim}>
              {result.error ?? "unknown error"}
            </Mono>
          </div>
          <Btn small onClick={onClose}>✕</Btn>
        </div>
      </Card>
    );
  }
  const ret = result.return ?? 0;
  const sharpe = result.sharpe ?? 0;
  const dd = result.max_drawdown ?? 0;
  const winRate = result.win_rate ?? 0;
  const vsBtc = result.vs_btc;
  const vsEth = result.vs_eth;
  return (
    <Card pad={14}>
      <div className="flex justify-between items-center mb-2">
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          Backtest result · {result.days ?? 90}d window · {result.n_assets ?? "—"} assets
        </div>
        <div className="flex gap-1.5">
          <Tag small color={tokens.emerald} dot>backtest live</Tag>
          <Btn small onClick={onClose}>✕</Btn>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <SummaryTile
          label="RETURN"
          value={fmtPct(ret)}
          color={ret >= 0 ? tokens.emerald : tokens.red}
        />
        <SummaryTile
          label="SHARPE"
          value={sharpe.toFixed(2)}
          color={sharpe > 1 ? tokens.emerald : tokens.text}
        />
        <SummaryTile
          label="MAX DD"
          value={fmtPct(dd)}
          color={tokens.red}
        />
        <SummaryTile
          label="WIN RATE"
          value={`${(winRate * 100).toFixed(0)}%`}
          color={winRate > 0.5 ? tokens.emerald : tokens.amber}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <SummaryTile
          label="VS BTC"
          value={vsBtc !== undefined ? fmtPct(vsBtc) : "—"}
          color={vsBtc !== undefined ? changeColor(vsBtc) : undefined}
        />
        <SummaryTile
          label="VS ETH"
          value={vsEth !== undefined ? fmtPct(vsEth) : "—"}
          color={vsEth !== undefined ? changeColor(vsEth) : undefined}
        />
      </div>
      {result.equity_preview && result.equity_preview.length > 1 && (
        <EquitySpark closes={result.equity_preview} />
      )}
      {result.excluded_assets && result.excluded_assets.length > 0 && (
        <Mono size={10} color={tokens.textFaint} style={{ marginTop: 8, display: "block" }}>
          excluded (no klines): {result.excluded_assets.join(", ")}
        </Mono>
      )}
    </Card>
  );
}

function EquitySpark({ closes }: { closes: number[] }) {
  const w = 600;
  const h = 80;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const stepX = closes.length > 1 ? w / (closes.length - 1) : w;
  const points = closes
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / span) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div style={{ marginTop: 10 }}>
      <Mono size={9} color={tokens.textFaint}>
        EQUITY PREVIEW · {closes.length}D · normalized
      </Mono>
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ display: "block", height: 60, marginTop: 4 }}
      >
        <polyline
          points={points}
          fill="none"
          stroke={tokens.emerald}
          strokeWidth={1.4}
        />
      </svg>
    </div>
  );
}


/**
 * Per-asset logo with graceful degradation. Three states:
 *  - URL present → render the CoinGecko-hosted PNG
 *  - URL is null (lookup returned nothing) → text-ticker fallback
 *  - URL undefined (lookup pending) → neutral placeholder while loading
 */
function AssetLogo({
  slug,
  logoUrl,
  fallbackTicker,
}: {
  slug: string;
  logoUrl: string | null | undefined;
  fallbackTicker: string;
}) {
  const [errored, setErrored] = useState(false);
  const showImage = !!logoUrl && !errored;
  return (
    <div
      className="flex items-center justify-center font-mono"
      style={{
        width: 26,
        height: 26,
        borderRadius: 5,
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        overflow: "hidden",
        flexShrink: 0,
      }}
      title={slug}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={slug}
          width={22}
          height={22}
          style={{ display: "block", objectFit: "contain" }}
          onError={() => setErrored(true)}
        />
      ) : (
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: logoUrl === undefined ? tokens.textFaint : tokens.emerald,
          }}
        >
          {fallbackTicker}
        </span>
      )}
    </div>
  );
}
