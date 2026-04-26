import { tokens } from "@/lib/tokens";
import { Mono } from "./Mono";

export function Meter({
  v = 0.5,
  color = tokens.emerald,
  h = 4,
  label,
  trail = true,
}: {
  v: number;
  color?: string;
  h?: number;
  label?: string | null;
  trail?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, v));
  return (
    <div className="w-full">
      <div
        className="relative overflow-hidden"
        style={{
          height: h,
          background: trail ? tokens.bgElev2 : "transparent",
          border: `1px solid ${tokens.borderFaint}`,
          borderRadius: h / 2,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            right: "auto",
            width: `${clamped * 100}%`,
            background: color,
            boxShadow: `0 0 8px ${color}80`,
          }}
        />
      </div>
      {label && (
        <Mono size={10} className="block mt-1">
          {label}
        </Mono>
      )}
    </div>
  );
}
