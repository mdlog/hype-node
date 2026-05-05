import { LogoSplash } from "@/components/ui/LogoSplash";

/**
 * Route-level loading.tsx for the indexer route group. Shown by Next.js
 * during the streaming server boundary while page server components fetch
 * upstream data. Logo + ring animation only — no caption, by design (the
 * upstream identity isn't relevant to the user, and stale captions during
 * navigation are noisier than they're worth).
 */
export default function IndexerLoading() {
  return <LogoSplash fullScreen />;
}
