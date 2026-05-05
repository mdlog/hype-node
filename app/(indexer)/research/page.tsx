import { ResearchClient } from "@/components/research/ResearchClient";
import { getNews, getSectorScores } from "@/lib/api/sosovalue";

export const revalidate = 60;

export default async function ResearchPage() {
  // Pull a deeper pool than we render so the client-side filter state has
  // room to breathe — sector / timeframe / strength / sentiment cuts can
  // narrow this set down to ~8-12 cards without an empty UI.
  const [news, sectors] = await Promise.all([
    getNews({ limit: 50 }),
    getSectorScores(),
  ]);
  return <ResearchClient news={news} sectors={sectors} />;
}
