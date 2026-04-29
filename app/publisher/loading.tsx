import { tokens } from "@/lib/tokens";
import { Mono } from "@/components/ui/Mono";

export default function PublisherLoading() {
  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="flex justify-between items-end">
        <div>
          <Skeleton width={240} height={26} />
          <div style={{ height: 6 }} />
          <Skeleton width={300} height={12} />
        </div>
        <div className="flex gap-2">
          <Skeleton width={90} height={28} />
          <Skeleton width={110} height={28} />
        </div>
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "1.3fr 1fr" }}
      >
        <BlockSkeleton height={420} />
        <BlockSkeleton height={420} />
      </div>

      <div className="flex items-center gap-2" style={{ color: tokens.textFaint }}>
        <Spinner />
        <Mono size={10} color={tokens.textFaint}>
          loading SoSoValue data…
        </Mono>
      </div>
    </div>
  );
}

function BlockSkeleton({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        background: tokens.bgElev,
        border: `1px solid ${tokens.border}`,
        borderRadius: 10,
      }}
    />
  );
}

function Skeleton({ width, height }: { width: number; height: number }) {
  return (
    <div
      className="hype-skeleton"
      style={{ width, height, background: tokens.bgElev2, borderRadius: 4 }}
    />
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: `2px solid ${tokens.border}`,
        borderTopColor: tokens.emerald,
        animation: "hype-spin 0.8s linear infinite",
      }}
    />
  );
}
