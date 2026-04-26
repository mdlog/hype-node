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

export type ChatTurn = { role: "user" | "agent"; content: string; ts?: string };

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
