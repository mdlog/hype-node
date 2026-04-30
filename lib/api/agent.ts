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
};

export type ReasoningEntry = {
  ts: string;
  kind: "TOOL" | "OBS" | "THINK" | "ACT" | "WAIT";
  text: string;
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

export async function getAgentState(): Promise<AgentState> {
  try {
    const res = await fetch(`${AGENT_URL}/state`, {
      cache: "no-store",
    });
    return await safeJson<AgentState>(res, defaultState());
  } catch {
    return defaultState();
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
  error?: string;
};

export async function runBacktest(
  constituents: Array<{ currency_id: string; symbol?: string; weight: number }>,
  days: number = 90,
): Promise<BacktestResult | null> {
  try {
    const res = await fetch(`${AGENT_URL}/run-backtest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ constituents, days }),
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

export async function chat(turns: ChatTurn[]): Promise<ChatTurn> {
  try {
    const res = await fetch(`${AGENT_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turns }),
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
