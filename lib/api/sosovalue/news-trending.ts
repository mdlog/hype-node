// Trending news endpoints (HOT + FEATURED) layered over the SoSoValue OpenAPI v1
// client. These are separate from the generic `/news` feed surfaced via
// `getNewsRaw`: `/news/hot` returns last-7-day hot articles ranked by SoSoValue,
// and `/news/featured` returns curator-tagged content with author + media
// metadata.
//
// Both methods reuse the canonical `request<T>` helper from the parent module
// — that gives us the existing rate-limit, auth-error, and per-path negative-
// cache behaviour for free. When SOSOVALUE_API_KEY is unset (or any backoff
// window is active), each function falls back to a deterministic synthetic
// array of 5 items so the UI renders identically offline. Synthetic titles are
// intentionally recognisable ("synthetic feed" suffix) to make it obvious in
// dev/QA when the live key isn't being used.
//
// Endpoints (base = https://openapi.sosovalue.com/openapi/v1):
//   GET /news/hot       — page, page_size (≤100), language, start_time, end_time
//   GET /news/featured  — page (req), page_size 20-100 (req), language, category[]
//
// Featured `category` values (see API docs):
//   1=news · 2=research · 3=institution · 4=KOL · 7=announcement · 13=crypto-stock

import { request } from "@/lib/api/sosovalue";

// ---------- types ----------

export type HotNewsItem = {
  id: string;
  source_link: string;
  /** Milliseconds since epoch. API returns numeric, but allow string for safety. */
  create_time: number | string;
  title: string;
  /** HTML — caller should strip tags before display. */
  content: string;
};

export type HotNewsResponse = {
  page: number;
  page_size: number;
  total: number;
  list: HotNewsItem[];
};

export type FeaturedCategory = 1 | 2 | 3 | 4 | 7 | 13;

export type FeaturedNewsItem = {
  id: string;
  source_link: string;
  /** Milliseconds since epoch. */
  release_time: number | string;
  title: string;
  /** HTML — caller should strip tags before display. */
  content: string;
  author: string;
  author_avatar_url: string;
  nick_name: string;
  is_blue_verified: boolean;
  category: FeaturedCategory;
  feature_image: string;
  matched_currencies: { id: string; full_name: string; name: string }[];
  tags: string[];
  media_info: { type?: string; url?: string }[];
};

export type FeaturedNewsResponse = {
  page: number;
  page_size: number;
  total: number;
  list: FeaturedNewsItem[];
};

// ---------- options ----------

export type GetHotNewsOpts = {
  page?: number;
  pageSize?: number;
  language?: string;
  /** Milliseconds. Must be within last 7 days per API contract. */
  startTime?: number;
  /** Milliseconds. Must be within last 7 days per API contract. */
  endTime?: number;
};

export type GetFeaturedNewsOpts = {
  /** REQUIRED by API. Defaults to 1 if omitted. */
  page?: number;
  /** REQUIRED by API. Must be 20-100. Defaults to 20. */
  pageSize?: number;
  language?: string;
  /** One or more category ids (see FeaturedCategory). */
  category?: FeaturedCategory[];
};

// ---------- public API ----------

export async function getHotNews(opts: GetHotNewsOpts = {}): Promise<HotNewsResponse> {
  const sp = new URLSearchParams();
  sp.set("page", String(opts.page ?? 1));
  // API hard-caps page_size at 100; default to 20 to match featured feed.
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  sp.set("page_size", String(pageSize));
  sp.set("language", opts.language ?? "en");
  if (opts.startTime) sp.set("start_time", String(opts.startTime));
  if (opts.endTime) sp.set("end_time", String(opts.endTime));
  return request<HotNewsResponse>(`/news/hot?${sp}`, () => ({ page: 1, page_size: 0, total: 0, list: [] }));
}

export async function getFeaturedNews(
  opts: GetFeaturedNewsOpts = {},
): Promise<FeaturedNewsResponse> {
  const sp = new URLSearchParams();
  // page + page_size are REQUIRED — always emit them, never omit.
  sp.set("page", String(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(20, opts.pageSize ?? 20));
  sp.set("page_size", String(pageSize));
  sp.set("language", opts.language ?? "en");
  if (opts.category && opts.category.length > 0) {
    // Most SoSoValue array params are repeated query keys (`category=1&category=2`).
    for (const c of opts.category) sp.append("category", String(c));
  }
  return request<FeaturedNewsResponse>(`/news/featured?${sp}`, () => ({ page: 1, page_size: 0, total: 0, list: [] }));
}
