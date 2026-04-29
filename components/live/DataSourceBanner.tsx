import { tokens } from "@/lib/tokens";
import { Mono } from "@/components/ui";

type SourceState = "live" | "stale" | "mock";

export function DataSourceBanner({
  sources,
}: {
  sources: { label: string; state: SourceState; detail?: string }[];
}) {
  return (
    <div
      className="flex items-center gap-3 flex-wrap"
      style={{
        padding: "8px 14px",
        background: tokens.bgElev,
        border: `1px solid ${tokens.border}`,
        borderRadius: 8,
      }}
    >
      <Mono size={9} color={tokens.textFaint}>
        DATA SOURCES
      </Mono>
      {sources.map((s) => {
        const c =
          s.state === "live" ? tokens.emerald : s.state === "stale" ? tokens.amber : tokens.textFaint;
        return (
          <div key={s.label} className="flex items-center gap-1.5">
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: c,
                boxShadow: s.state === "live" ? `0 0 6px ${c}` : undefined,
              }}
            />
            <Mono size={10} color={tokens.text}>
              {s.label}
            </Mono>
            <Mono size={10} color={c}>
              {s.state === "live" ? "live" : s.state === "stale" ? "cached" : "mock"}
            </Mono>
            {s.detail && (
              <Mono size={9} color={tokens.textFaint}>
                · {s.detail}
              </Mono>
            )}
          </div>
        );
      })}
    </div>
  );
}
