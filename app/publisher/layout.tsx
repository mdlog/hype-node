import { PublisherTopBar } from "@/components/nav/PublisherTopBar";
import { tokens } from "@/lib/tokens";

export default function PublisherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: tokens.bg, color: tokens.text }}
    >
      <PublisherTopBar />
      <div
        style={{
          position: "absolute",
          top: -200,
          left: -200,
          width: 500,
          height: 500,
          background: `radial-gradient(circle, ${tokens.emerald}08 0%, transparent 70%)`,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <main className="relative">{children}</main>
    </div>
  );
}
