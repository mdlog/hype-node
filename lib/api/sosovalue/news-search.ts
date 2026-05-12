// SoSoValue OpenAPI v1 — `GET /news/search`.
//
// Full-text news search with keyword highlighting. Wraps the generic
// `request<T>` helper from `lib/api/sosovalue.ts` for backoff / caching.
//
// Response envelope (data field): { page, page_size, total, list[] }, with
// each list item carrying a `highlight` block whose `title` / `content` are
// HTML strings annotated with `<em>` tags around matched keyword spans.
//
// When the API key is absent or upstream is in backoff, the fallback returns
// an EMPTY page (no synthetic items). The search UI renders a "no results /
// upstream unavailable" state instead of seeding placeholder content that
// could be mistaken for live data.
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
 * @throws never — returns an empty page on missing key / backoff.
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

  return request<NewsSearchResponse>(`/news/search?${sp}`, () => ({
    page,
    page_size: pageSize,
    total: 0,
    list: [],
  }));
}

