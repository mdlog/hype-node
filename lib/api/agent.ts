// Frontend → Python LangGraph agent service.
// The agent service is a separate FastAPI process (see agent-service/).

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://localhost:8001";

export type AgentNode = {
  id: string;
  label: string;
  status: "idle" | "active" | "current" | "warn" | "danger";
  sub?: string;
};

export type AgentState = {
  uptimeSec: number;
  decisions24h: number;
  toolCalls: number;
  gasSpentVal: number;
  model: string;
  currentNode: string | null;
  nodes: AgentNode[];
  // Run controls — flipped via /api/agent/{pause,reset,halt}. The agent
  // page reads these to retitle the Pause button (Pause ↔ Resume) and
  // surface a "halted" badge.
  paused: boolean;
  halted: boolean;
};

export type ReasoningEntry = {
  ts: string;
  kind: "TOOL" | "OBS" | "THINK" | "ACT" | "WAIT";
  text: string;
  // Optional clickable link — present on entries that point to external
  // resources (SoDEX order pages, Etherscan tx pages, etc.).
  url?: string | null;
};

export type ToolCallTrace = {
  name: string;
  input: Record<string, unknown>;
  output_summary?: string | null;
  output_raw?: unknown;
  duration_ms: number;
  ok: boolean;
  error?: string | null;
};

export type ChatUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  elapsed_ms: number;
};

export type ChatTurn = {
  role: "user" | "agent";
  content: string;
  ts?: string;
  tool_calls?: ToolCallTrace[] | null;
  usage?: ChatUsage | null;
};

async function safeJson<T>(res: Response, fallback: T): Promise<T> {
  if (!res.ok) {
    console.warn(`[agent] ${res.url} ${res.status}`);
    return fallback;
  }
  return (await res.json()) as T;
}

type AgentStateWire = {
  uptime_sec?: number;
  decisions_24h?: number;
  tool_calls?: number;
  gas_spent_val?: number;
  model?: string;
  current_node?: string | null;
  nodes?: AgentNode[];
  paused?: boolean;
  halted?: boolean;
};

function normalizeAgentState(wire: AgentStateWire): AgentState {
  const d = defaultState();
  return {
    uptimeSec: wire.uptime_sec ?? d.uptimeSec,
    decisions24h: wire.decisions_24h ?? d.decisions24h,
    toolCalls: wire.tool_calls ?? d.toolCalls,
    gasSpentVal: wire.gas_spent_val ?? d.gasSpentVal,
    model: wire.model ?? d.model,
    currentNode: wire.current_node ?? null,
    nodes: wire.nodes ?? d.nodes,
    paused: wire.paused ?? false,
    halted: wire.halted ?? false,
  };
}

export async function getAgentState(): Promise<AgentState> {
  try {
    const res = await fetch(`${AGENT_URL}/state`, {
      cache: "no-store",
    });
    const wire = await safeJson<AgentStateWire>(res, {});
    return normalizeAgentState(wire);
  } catch {
    return defaultState();
  }
}

export type ToolStatus = "ok" | "degraded" | "missing_config" | "unknown";

export type ToolHealth = {
  tools: Record<string, { status: ToolStatus; reason: string | null }>;
  summary: { ok: number; degraded: number; missing_config: number; total: number };
};

export async function getToolsHealth(): Promise<ToolHealth | null> {
  try {
    const res = await fetch(`${AGENT_URL}/tools/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ToolHealth;
  } catch {
    return null;
  }
}

export async function getReasoningLog(): Promise<ReasoningEntry[]> {
  try {
    const res = await fetch(`${AGENT_URL}/reasoning`, { cache: "no-store" });
    return await safeJson<ReasoningEntry[]>(res, []);
  } catch {
    return [];
  }
}

/* ---------- Run controls (Pause / Step / Reset / Halt) ---------- */
//
// Wire from the agent page header. Each helper POSTs to the matching
// FastAPI endpoint on the LangGraph service. On network failure we surface
// `ok: false` rather than throwing so the UI can show a one-shot toast/error
// without unmounting the page.

export type ControlResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

async function postControl(action: "pause" | "step" | "reset" | "halt"): Promise<ControlResult> {
  try {
    const res = await fetch(`${AGENT_URL}/${action}`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const pauseAgent = () => postControl("pause");
export const stepAgent = () => postControl("step");
export const resetAgent = () => postControl("reset");
export const haltAgent = () => postControl("halt");

/* ---------- Terminal status (SoSoValue transport diagnostics) ---------- */

export type TerminalCacheEntry = {
  path: string;
  fresh: boolean;
  age_sec: number;
  expires_in_sec: number;
};

export type TerminalStatus = {
  base: string;
  has_api_key: boolean;
  min_gap_sec: number;
  cache_ttl_sec: number;
  quota_backoff_sec: number;
  transient_backoff_sec: number;
  last_request_at: string | null;
  backoff: {
    quota_exhausted_for_sec: number;
    transient_error_for_sec: number;
  };
  last_success: { path: string; at: string } | null;
  last_error: {
    path: string;
    status_code: number;
    code: number | null;
    message: string;
    at: string;
    backoff_until: string | null;
  } | null;
  cache: TerminalCacheEntry[];
  inflight: string[];
};

export async function getTerminalStatus(): Promise<TerminalStatus | null> {
  try {
    const res = await fetch(`${AGENT_URL}/terminal/status`, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[agent] /terminal/status ${res.status}`);
      return null;
    }
    return (await res.json()) as TerminalStatus;
  } catch {
    return null;
  }
}

/* ---------- Basket proposer (real SSI constituents + composite score) ---------- */

export type BasketConstituent = {
  currency_id: string;
  symbol: string;
  weight: number;
  marketcap: number;
  change_pct_24h: number;
  marketcap_rank: number | null;
};

export type BasketProposal = {
  ok: boolean;
  ticker?: string;
  weighting?: string;
  n_pool?: number;
  n_picked?: number;
  constituents?: BasketConstituent[];
  skipped?: { symbol: string; reason: string }[];
  summary?: {
    symbols: string[];
    weights_pct: number[];
    total_marketcap_usd: number;
    avg_change_24h_pct: number;
  };
  error?: string;
};

export async function proposeBasket(
  sector: string,
  nAssets: number = 8,
  weighting: "score" | "marketcap" | "equal" | "ssi_reference" = "score",
): Promise<BasketProposal | null> {
  try {
    const params = new URLSearchParams({
      sector,
      n_assets: String(nAssets),
      weighting,
    });
    const res = await fetch(`${AGENT_URL}/propose-basket?${params}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[agent] /propose-basket ${res.status}`);
      return null;
    }
    return (await res.json()) as BasketProposal;
  } catch {
    return null;
  }
}

/* ---------- Real backtest (klines replay) ---------- */

export type BacktestCostParams = {
  /** Round-trip fee in basis points charged each rebalance event. */
  fee_bps?: number;
  /** Slippage in basis points charged each rebalance event. */
  slippage_bps?: number;
  /** Per-asset weight cap, decimal in (0,1). 0 disables the cap. */
  position_cap?: number;
  /** Annual risk-free rate as a decimal (e.g. 0.042 for 4.20%). */
  risk_free_rate?: number;
  /** Base currency NAV start — surfaces nav_final on the result. */
  init_capital?: number;
  /** Rebalance cadence in days (used to amortize cost). Default 7. */
  rebalance_days?: number;
};

export type BacktestResult = {
  ok: boolean;
  days?: number;
  n_assets?: number;
  n_returns?: number;
  weights?: Record<string, number>;
  excluded_assets?: string[];
  return?: number;
  sharpe?: number;
  max_drawdown?: number;
  win_rate?: number;
  equity_preview?: number[];
  btc_return?: number;
  vs_btc?: number;
  eth_return?: number;
  vs_eth?: number;
  // Echoed cost knobs + derived NAV — present whenever the caller passed
  // the corresponding cost params.
  fee_bps?: number;
  slippage_bps?: number;
  position_cap?: number | null;
  risk_free_rate?: number;
  init_capital?: number;
  rebalance_days?: number;
  n_rebalances?: number;
  nav_final?: number;
  error?: string;
};

export async function runBacktest(
  constituents: Array<{ currency_id: string; symbol?: string; weight: number }>,
  days: number = 90,
  costs: BacktestCostParams = {},
): Promise<BacktestResult | null> {
  try {
    const res = await fetch(`${AGENT_URL}/run-backtest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ constituents, days, ...costs }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[agent] /run-backtest ${res.status}`);
      return null;
    }
    return (await res.json()) as BacktestResult;
  } catch {
    return null;
  }
}

/* ---------- Risk gate config (persistent, live) ---------- */
//
// Read every cycle by the agent's risk_node. UI edits flow back via POST.
// The shape mirrors agent-service/src/store.py — keep them in sync.

export type RiskConfig = {
  volatility_max: number;
  drawdown_max: number;
  sentiment_delta_min: number;
  single_asset_weight_max: number;
  net_outflow_24h_max_usd: number;
  rule_volatility_enabled: boolean;
  rule_drawdown_enabled: boolean;
  rule_sentiment_enabled: boolean;
  rule_weight_enabled: boolean;
  rule_outflow_enabled: boolean;
  manual_override: boolean;
  updated_at: string;
};

const RISK_CONFIG_DEFAULTS: RiskConfig = {
  volatility_max: 0.35,
  drawdown_max: 0.15,
  sentiment_delta_min: -20,
  single_asset_weight_max: 0.25,
  net_outflow_24h_max_usd: 5_000_000,
  rule_volatility_enabled: true,
  rule_drawdown_enabled: true,
  rule_sentiment_enabled: true,
  rule_weight_enabled: true,
  rule_outflow_enabled: true,
  manual_override: false,
  updated_at: "",
};

export async function getRiskConfig(): Promise<RiskConfig> {
  try {
    const res = await fetch(`${AGENT_URL}/risk/config`, { cache: "no-store" });
    if (!res.ok) return RISK_CONFIG_DEFAULTS;
    return (await res.json()) as RiskConfig;
  } catch {
    // Agent service unreachable → fall back to defaults so server-rendered
    // pages don't crash. UI will show stale-but-sensible defaults.
    return RISK_CONFIG_DEFAULTS;
  }
}

export async function updateRiskConfig(
  patch: Partial<RiskConfig>,
): Promise<RiskConfig | null> {
  try {
    const res = await fetch(`${AGENT_URL}/risk/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as RiskConfig;
  } catch {
    return null;
  }
}

/* ---------- Decision history (persistent audit trail) ---------- */

export type DecisionRow = {
  id: number;
  ts: string;
  sector: string | null;
  idle: boolean;
  basket_size: number | null;
  basket_top_symbol: string | null;
  basket_top_weight: number | null;
  basket: Record<string, number> | null;
  strategy_source: string | null;
  strategy_confidence: string | null;
  strategy_reasoning: string | null;
  sentiment_score: number | null;
  sentiment_delta: number | null;
  flow_inflow_usd: number | null;
  backtest_sharpe: number | null;
  backtest_drawdown: number | null;
  backtest_win_rate: number | null;
  risk_verdict: string | null;
  risk_breaches: Array<Record<string, unknown>> | null;
  ssi_tx_hash: string | null;
  ssi_status: string | null;
  sodex_placed: number | null;
  sodex_skipped: number | null;
  sodex_errors: number | null;
  emergency: boolean;
};

export type HistoryStats = {
  total: number;
  emergency_count: number;
  idle_count: number;
  active_count: number;
  last_decision_at: string | null;
  sectors: string[];
  window_days: number;
};

export async function getDecisionHistory(opts?: {
  limit?: number;
  sector?: string;
  since?: string;
}): Promise<DecisionRow[]> {
  try {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.sector) params.set("sector", opts.sector);
    if (opts?.since) params.set("since", opts.since);
    const qs = params.toString();
    const url = `${AGENT_URL}/history${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { rows?: DecisionRow[] };
    return body.rows ?? [];
  } catch {
    return [];
  }
}

export async function getHistoryStats(): Promise<HistoryStats | null> {
  try {
    const res = await fetch(`${AGENT_URL}/history/stats`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as HistoryStats;
  } catch {
    return null;
  }
}

export async function chat(
  turns: ChatTurn[],
  walletAddress?: string | null,
): Promise<ChatTurn> {
  try {
    const res = await fetch(`${AGENT_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        turns,
        wallet_address: walletAddress ?? null,
      }),
    });
    return await safeJson<ChatTurn>(res, {
      role: "agent",
      content: "Agent service unreachable. Start the Python service with `npm run agent`.",
    });
  } catch {
    return {
      role: "agent",
      content: "Agent service unreachable.",
    };
  }
}

function defaultState(): AgentState {
  return {
    uptimeSec: 0,
    decisions24h: 0,
    toolCalls: 0,
    gasSpentVal: 0,
    model: "claude-sonnet-4-5",
    currentNode: null,
    paused: false,
    halted: false,
    nodes: [
      { id: "signal", label: "Signal Listener", status: "idle", sub: "polls 2s" },
      { id: "sentiment", label: "Sentiment Analysis", status: "idle", sub: "AI score" },
      { id: "flow", label: "Flow Aggregator", status: "idle", sub: "Terminal API" },
      { id: "strategy", label: "Strategy Builder", status: "idle", sub: "weighted basket" },
      { id: "backtest", label: "Backtest Runner", status: "idle", sub: "90d window" },
      { id: "risk", label: "Risk Gate", status: "idle", sub: "5 thresholds" },
      { id: "wrap", label: "SSI Wrap", status: "idle", sub: "wrap / unwrap" },
      { id: "exec", label: "SoDEX Execute", status: "idle", sub: "L1 TX" },
      { id: "exit", label: "Emergency Exit", status: "idle", sub: "→ USSI hedge" },
      { id: "loop", label: "Monitor Loop", status: "idle", sub: "re-enter" },
    ],
  };
}
