import { IndexerTopBar } from "@/components/nav/IndexerTopBar";
import { DemoProvider } from "@/components/demo/DemoProvider";
import { DemoModeBanner } from "@/components/demo/DemoModeBanner";
import { getOptionalUser } from "@/lib/supabase/auth";
import { tokens } from "@/lib/tokens";

export default async function IndexerLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalUser();
  const isDemo = !!user?.demo;

  return (
    <DemoProvider isDemo={isDemo}>
      <div
        className="min-h-screen relative overflow-hidden"
        style={{ background: tokens.bg, color: tokens.text }}
      >
        <IndexerTopBar />
        {isDemo && <DemoModeBanner isDemo={isDemo} />}
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
        <main
          className="relative mx-auto"
          style={{ maxWidth: 1440 }}
        >
          {children}
        </main>
      </div>
    </DemoProvider>
  );
}
