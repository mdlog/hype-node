/**
 * Canonical SoSoValue endpoint metadata.
 *
 * SOSOVALUE_ENDPOINT_COUNT must equal the total documented in ENDPOINTS.md
 * at the repo root. Update BOTH files whenever an endpoint is added or removed.
 * Current count verified 2026-06-05 by enumerating every distinct URL pattern
 * wired across lib/api/sosovalue.ts and its submodules (analyses, crypto-stocks,
 * etf-snapshot, fundraising, macro, news-search, news-trending, tokens, treasuries).
 */
export const SOSOVALUE_ENDPOINT_COUNT = 32;
