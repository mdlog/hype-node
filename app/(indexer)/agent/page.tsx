import { Btn, Label, Mono } from "@/components/ui";
import { ReasoningStream } from "@/components/live/ReasoningStream";
import { tokens } from "@/lib/tokens";

type Node = {
  id: string;
  x: number;
  y: number;
  label: string;
  sub: string;
  active?: boolean;
  current?: boolean;
  warn?: boolean;
  danger?: boolean;
};

const nodes: Node[] = [
  { id: "a", x: 40, y: 40, label: "Signal Listener", sub: "polls 2s", active: true },
  { id: "b", x: 230, y: 40, label: "Sentiment Analysis", sub: "AI score", active: true },
  { id: "c", x: 420, y: 40, label: "Flow Aggregator", sub: "Terminal API", active: true },
  { id: "d", x: 330, y: 180, label: "Strategy Builder", sub: "running…", current: true },
  { id: "e", x: 520, y: 180, label: "Backtest Runner", sub: "90d window" },
  { id: "f", x: 140, y: 320, label: "Risk Gate", sub: "5 thresholds", warn: true },
  { id: "g", x: 330, y: 320, label: "SSI Wrap", sub: "wrap / unwrap", active: true },
  { id: "h", x: 520, y: 320, label: "SoDEX Execute", sub: "L1 TX" },
  { id: "i", x: 40, y: 450, label: "Emergency Exit", sub: "→ USSI hedge", danger: true },
  { id: "j", x: 420, y: 450, label: "Monitor Loop", sub: "re-enter" },
];

const edges: Array<[string, string, boolean?]> = [
  ["a", "b"],
  ["b", "c"],
  ["a", "d"],
  ["b", "d"],
  ["c", "d"],
  ["d", "e"],
  ["e", "d", true],
  ["d", "f"],
  ["d", "g"],
  ["g", "h"],
  ["h", "j"],
  ["j", "d", true],
  ["f", "i"],
  ["f", "g"],
];

const stats = [
  { k: "UPTIME", v: "34h 12m", c: tokens.emerald },
  { k: "DECISIONS (24h)", v: "14", c: tokens.text },
  { k: "TOOL CALLS", v: "2,481", c: tokens.cyan },
  { k: "GAS SPENT", v: "0.42 VAL", c: tokens.amber },
  { k: "MODEL", v: "claude-sonnet-4.5", c: tokens.text },
];

const nById = Object.fromEntries(nodes.map((n) => [n.id, n]));

export default function AgentPage() {
  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "1fr 360px" }}>
      <div
        className="relative overflow-hidden"
        style={{ padding: 20, borderRight: `1px solid ${tokens.border}` }}
      >
        <div className="flex justify-between items-end mb-4">
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>Agent Console</div>
            <Mono size={11}>
              LangGraph state machine · currently in{" "}
              <span style={{ color: tokens.cyan }}>strategy_builder</span>
            </Mono>
          </div>
          <div className="flex gap-1.5">
            <Btn small>⏸ Pause</Btn>
            <Btn small>▢ Step</Btn>
            <Btn small>↻ Reset state</Btn>
          </div>
        </div>

        <div className="flex gap-2.5 mb-3.5">
          {stats.map((s, i) => (
            <div
              key={i}
              className="flex-1"
              style={{
                padding: "8px 12px",
                background: tokens.bgElev,
                border: `1px solid ${tokens.border}`,
                borderRadius: 6,
              }}
            >
              <Label>{s.k}</Label>
              <div
                className="font-mono"
                style={{ fontSize: 14, fontWeight: 600, color: s.c, marginTop: 3 }}
              >
                {s.v}
              </div>
            </div>
          ))}
        </div>

        <div
          className="relative"
          style={{
            width: 700,
            height: 530,
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            backgroundImage: `radial-gradient(${tokens.borderFaint} 1px, transparent 1px)`,
            backgroundSize: "20px 20px",
          }}
        >
          <svg width={700} height={530} className="absolute inset-0 pointer-events-none">
            <defs>
              <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 Z" fill={tokens.textDim} />
              </marker>
              <marker id="arrLive" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 Z" fill={tokens.cyan} />
              </marker>
            </defs>
            {edges.map(([f, t, dashed], i) => {
              const a = nById[f];
              const b = nById[t];
              const x1 = a.x + 70;
              const y1 = a.y + 24;
              const x2 = b.x + 10;
              const y2 = b.y + 24;
              const live = (a.active || a.current) && (b.active || b.current);
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={live ? tokens.cyan : tokens.textFaint}
                  strokeWidth={live ? 1.5 : 1}
                  strokeDasharray={dashed ? "4 3" : undefined}
                  opacity={live ? 0.7 : 0.4}
                  markerEnd={live ? "url(#arrLive)" : "url(#arr)"}
                />
              );
            })}
          </svg>
          {nodes.map((n) => {
            const bg = n.current
              ? tokens.cyan + "15"
              : n.active
                ? tokens.emerald + "12"
                : n.danger
                  ? tokens.red + "12"
                  : n.warn
                    ? tokens.amber + "10"
                    : tokens.bgElev2;
            const bd = n.current
              ? tokens.cyan
              : n.active
                ? tokens.emerald
                : n.danger
                  ? tokens.red
                  : n.warn
                    ? tokens.amber
                    : tokens.border;
            const dot = n.current
              ? tokens.cyan
              : n.active
                ? tokens.emerald
                : n.danger
                  ? tokens.red
                  : n.warn
                    ? tokens.amber
                    : tokens.textFaint;
            return (
              <div
                key={n.id}
                style={{
                  position: "absolute",
                  left: n.x,
                  top: n.y,
                  width: 150,
                  padding: "8px 12px",
                  background: bg,
                  border: `1px solid ${bd}`,
                  borderRadius: 6,
                  boxShadow: n.current
                    ? `0 0 0 3px ${tokens.cyan}20, 0 0 16px ${tokens.cyan}40`
                    : undefined,
                }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: dot,
                      boxShadow: n.current || n.active ? `0 0 6px ${dot}` : undefined,
                    }}
                  />
                  <Mono size={8.5} color={dot}>
                    {n.id.toUpperCase()}
                  </Mono>
                  {n.current && (
                    <Mono size={8.5} color={tokens.cyan}>
                      ● RUNNING
                    </Mono>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>{n.label}</div>
                <Mono size={9.5}>{n.sub}</Mono>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col overflow-hidden">
        <div
          className="flex justify-between items-center"
          style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Reasoning Log</div>
            <Mono size={10}>state transitions · tool calls · decisions</Mono>
          </div>
          <Btn small>Export</Btn>
        </div>
        <ReasoningStream />
      </div>
    </div>
  );
}
