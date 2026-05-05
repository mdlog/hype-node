// SoSoValue OpenAPI v1 — `GET /news/search`.
//
// Full-text news search with keyword highlighting. Wraps the generic
// `request<T>` helper exported from `lib/api/sosovalue.ts` so backoff /
// caching / synthetic-fallback behavior stays consistent with the rest of
// the SoSoValue surface.
//
// Response envelope (data field): { page, page_size, total, list[] }, with
// each list item carrying a `highlight` block whose `title` / `content` are
// HTML strings annotated with `<em>` tags around matched keyword spans.
//
// When the API key is absent or upstream is in backoff, `request` invokes
// the fallback() — we return a deterministic 3-item synthetic page so the
// UI stays interactive offline.
import { request } from "@/lib/api/sosovalue";

export type NewsSearchSort = "relevance" | "publish_time";

export type NewsSearchHighlight = {
  title?: string | null;
  content?: string | null;
};

export type NewsSearchMatchedCurrency = {
  id: string;
  name?: string | null;
  full_name?: string | null;
};

export type NewsSearchMediaInfo = {
  name?: string | null;
  avatar?: string | null;
  url?: string | null;
};

export type NewsSearchItem = {
  id: string;
  source_link: string | null;
  // Numeric milliseconds since epoch — may arrive as a string.
  release_time: string | number;
  title: string | null;
  content: string | null;
  author: string | null;
  nick_name: string | null;
  category: number | null;
  feature_image: string | null;
  matched_currencies: NewsSearchMatchedCurrency[] | null;
  tags: string[] | null;
  media_info: NewsSearchMediaInfo | null;
  type: string | null;
  highlight: NewsSearchHighlight | null;
};

export type NewsSearchResponse = {
  page: number;
  page_size: number;
  total: string | number;
  list: NewsSearchItem[];
};

export type SearchNewsOpts = {
  keyword: string;
  page?: number;
  pageSize?: number;
  category?: number;
  sort?: NewsSearchSort;
};

const SORT_VALUES = new Set<NewsSearchSort>(["relevance", "publish_time"]);

/**
 * Search SoSoValue news with keyword highlighting.
 *
 * @throws never — synthetic fallback is returned on missing key / backoff.
 */
export async function searchNews(opts: SearchNewsOpts): Promise<NewsSearchResponse> {
  const keyword = opts.keyword?.trim() ?? "";
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  const sort: NewsSearchSort = SORT_VALUES.has(opts.sort as NewsSearchSort)
    ? (opts.sort as NewsSearchSort)
    : "relevance";

  const sp = new URLSearchParams();
  sp.set("keyword", keyword);
  sp.set("page", String(page));
  sp.set("page_size", String(pageSize));
  sp.set("sort", sort);
  if (typeof opts.category === "number" && Number.isFinite(opts.category)) {
    sp.set("category", String(opts.category));
  }

  return request<NewsSearchResponse>(`/news/search?${sp}`, () =>
    syntheticSearch(keyword, page, pageSize),
  );
}

// Deterministic 3-item synthetic page: same keyword always renders the same
// titles. Each title contains the keyword wrapped in `<em>` so the
// highlight pipeline in the UI is exercised offline too.
function syntheticSearch(keyword: string, page: number, pageSize: number): NewsSearchResponse {
  const safe = keyword || "crypto";
  const now = Date.now();
  const list: NewsSearchItem[] = [
    {
      id: `synth-${safe}-1`,
      source_link: "https://sosovalue.com/news",
      release_time: now - 12 * 60_000,
      title: `Synthetic result: ${safe} sector update`,
      content: `Offline placeholder describing recent ${safe} sector activity.`,
      author: "sosovalue",
      nick_name: "SoSoValue Research",
      category: 1,
      feature_image: null,
      matched_currencies: null,
      tags: [safe.toLowerCase(), "synthetic"],
      media_info: { name: "SoSoValue", avatar: null, url: null },
      type: "article",
      highlight: {
        title: `Synthetic result: <em>${safe}</em> sector update`,
        content: `Offline placeholder describing recent <em>${safe}</em> sector activity.`,
      },
    },
    {
      id: `synth-${safe}-2`,
      source_link: "https://sosovalue.com/news",
      release_time: now - 47 * 60_000,
      title: `Synthetic result: ${safe} on-chain flows recap`,
      content: `Synthetic mock highlighting cumulative ${safe} on-chain flows.`,
      author: "sosovalue",
      nick_name: "SoSoValue Research",
      category: 2,
      feature_image: null,
      matched_currencies: null,
      tags: [safe.toLowerCase(), "flows"],
      media_info: { name: "SoSoValue", avatar: null, url: null },
      type: "article",
      highlight: {
        title: `Synthetic result: <em>${safe}</em> on-chain flows recap`,
        content: `Synthetic mock highlighting cumulative <em>${safe}</em> on-chain flows.`,
      },
    },
    {
      id: `synth-${safe}-3`,
      source_link: "https://sosovalue.com/news",
      release_time: now - 3 * 60 * 60_000,
      title: `Synthetic result: ${safe} weekly digest`,
      content: `Weekly digest skeleton for the ${safe} narrative.`,
      author: "sosovalue",
      nick_name: "SoSoValue Research",
      category: 1,
      feature_image: null,
      matched_currencies: null,
      tags: [safe.toLowerCase(), "weekly"],
      media_info: { name: "SoSoValue", avatar: null, url: null },
      type: "article",
      highlight: {
        title: `Synthetic result: <em>${safe}</em> weekly digest`,
        content: `Weekly digest skeleton for the <em>${safe}</em> narrative.`,
      },
    },
  ];
  return { page, page_size: pageSize, total: list.length, list };
}
