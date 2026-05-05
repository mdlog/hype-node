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

// ---------- synthetic fallbacks ----------

const HOUR = 3_600_000;

function syntheticHotList(): HotNewsItem[] {
  const now = Date.now();
  return [
    {
      id: "hot-syn-1",
      source_link: "https://sosovalue.com/news/synthetic-1",
      create_time: now - 1 * HOUR,
      title: "DePIN sector heats up — synthetic feed",
      content:
        "<p>DePIN protocols posted aggregate revenue growth of 18% week-over-week in the synthetic dataset.</p>",
    },
    {
      id: "hot-syn-2",
      source_link: "https://sosovalue.com/news/synthetic-2",
      create_time: now - 3 * HOUR,
      title: "Spot BTC ETF inflows extend streak — synthetic feed",
      content:
        "<p>Aggregate net inflow across the eleven US spot Bitcoin ETFs reached $312M in the synthetic snapshot.</p>",
    },
    {
      id: "hot-syn-3",
      source_link: "https://sosovalue.com/news/synthetic-3",
      create_time: now - 6 * HOUR,
      title: "RWA tokenization TVL crosses milestone — synthetic feed",
      content:
        "<p>Real-world-asset tokenization TVL now sits above the $14B mark in the synthetic feed.</p>",
    },
    {
      id: "hot-syn-4",
      source_link: "https://sosovalue.com/news/synthetic-4",
      create_time: now - 12 * HOUR,
      title: "L2 sequencer decentralization roadmap — synthetic feed",
      content:
        "<p>Major L2 publishes a phased sequencer decentralization plan in the synthetic feed.</p>",
    },
    {
      id: "hot-syn-5",
      source_link: "https://sosovalue.com/news/synthetic-5",
      create_time: now - 24 * HOUR,
      title: "AI-token narrative cools after 7d run — synthetic feed",
      content:
        "<p>AI-tagged tokens give back roughly 4% on the day after a strong week in the synthetic feed.</p>",
    },
  ];
}

function syntheticHot(): HotNewsResponse {
  const list = syntheticHotList();
  return { page: 1, page_size: list.length, total: list.length, list };
}

function syntheticFeaturedList(): FeaturedNewsItem[] {
  const now = Date.now();
  const make = (
    n: number,
    title: string,
    category: FeaturedCategory,
    author: string,
    nick: string,
    deltaH: number,
  ): FeaturedNewsItem => ({
    id: `feat-syn-${n}`,
    source_link: `https://sosovalue.com/news/featured-synthetic-${n}`,
    release_time: now - deltaH * HOUR,
    title,
    content: `<p>${title} — full synthetic body.</p>`,
    author,
    author_avatar_url: "",
    nick_name: nick,
    is_blue_verified: n % 2 === 0,
    category,
    feature_image: "",
    matched_currencies: [],
    tags: [],
    media_info: [],
  });
  return [
    make(1, "Coinbase prime brokerage update — synthetic feed", 1, "coinbase", "Coinbase", 2),
    make(2, "Galaxy Research: Q2 macro thesis — synthetic feed", 2, "galaxydigital", "Galaxy", 5),
    make(3, "BlackRock institutional flows note — synthetic feed", 3, "blackrock", "BlackRock", 9),
    make(4, "KOL: Why DePIN matters in 2026 — synthetic feed", 4, "kol_demo", "KOL Demo", 14),
    make(5, "Exchange listing announcement — synthetic feed", 7, "binance", "Binance", 22),
  ];
}

function syntheticFeatured(): FeaturedNewsResponse {
  const list = syntheticFeaturedList();
  return { page: 1, page_size: list.length, total: list.length, list };
}

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
  return request<HotNewsResponse>(`/news/hot?${sp}`, syntheticHot);
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
  return request<FeaturedNewsResponse>(`/news/featured?${sp}`, syntheticFeatured);
}
