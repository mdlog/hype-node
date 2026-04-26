import { tokens } from "@/lib/tokens";
import { Mono } from "./Mono";

export function HypeGauge({
  score = 0,
  sector = "",
  size = 90,
}: {
  score?: number;
  sector?: string;
  size?: number;
}) {
  const color =
    score > 80
      ? tokens.red
      : score > 60
        ? tokens.amber
        : score > 40
          ? tokens.emerald
          : tokens.textDim;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const pct = score / 100;
  return (
    <div style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tokens.bgElev2}
          strokeWidth={3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div
          className="leading-none font-bold tabular"
          style={{
            fontSize: size * 0.28,
            color,
            letterSpacing: "-0.03em",
          }}
        >
          {score}
        </div>
        {sector && (
          <Mono size={8.5} className="mt-0.5">
            {sector}
          </Mono>
        )}
      </div>
    </div>
  );
}
