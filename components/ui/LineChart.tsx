import { tokens } from "@/lib/tokens";

type Series = {
  data: number[];
  color: string;
  thick?: boolean;
  fill?: boolean;
  dashed?: boolean;
};

export function LineChart({
  w = 600,
  h = 220,
  series,
  grid = true,
  axis = true,
}: {
  w?: number;
  h?: number;
  series: Series[];
  grid?: boolean;
  axis?: boolean;
}) {
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const all = series.flatMap((s) => s.data);
  if (all.length === 0) return <svg width={w} height={h} />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const rng = max - min || 1;

  const toPath = (data: number[]) =>
    data
      .map((v, i) => {
        const x = padL + (i / (data.length - 1)) * iw;
        const y = padT + ih - ((v - min) / rng) * ih;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");

  const gridLines = grid ? [0.25, 0.5, 0.75].map((f) => padT + f * ih) : [];
  const xLabels = axis ? ["90d", "60d", "30d", "now"] : [];

  return (
    <svg width={w} height={h} className="block">
      {gridLines.map((y, i) => (
        <line
          key={i}
          x1={padL}
          x2={w - padR}
          y1={y}
          y2={y}
          stroke={tokens.borderFaint}
          strokeDasharray="2 3"
        />
      ))}
      <line
        x1={padL}
        x2={w - padR}
        y1={padT + ih}
        y2={padT + ih}
        stroke={tokens.border}
      />
      {series.map((s, i) => (
        <g key={i}>
          {s.fill && (
            <path
              d={`${toPath(s.data)} L ${padL + iw} ${padT + ih} L ${padL} ${padT + ih} Z`}
              fill={s.color}
              opacity={0.08}
            />
          )}
          <path
            d={toPath(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.thick ? 1.8 : 1.3}
            strokeDasharray={s.dashed ? "4 3" : undefined}
          />
        </g>
      ))}
      {xLabels.map((l, i) => (
        <text
          key={i}
          x={padL + (i / (xLabels.length - 1)) * iw}
          y={h - 6}
          fill={tokens.textFaint}
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
          textAnchor="middle"
        >
          {l}
        </text>
      ))}
      {[0, 0.5, 1].map((f, i) => {
        const v = min + f * rng;
        return (
          <text
            key={i}
            x={padL - 6}
            y={padT + ih - f * ih + 3}
            fill={tokens.textFaint}
            fontSize={9}
            fontFamily="JetBrains Mono, monospace"
            textAnchor="end"
          >
            {v.toFixed(2)}
          </text>
        );
      })}
    </svg>
  );
}
