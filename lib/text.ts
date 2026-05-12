// Text utilities used at the data-fetch boundary to keep external content
// hydration-safe.
//
// Background: SoSoValue's news / social content can include emoji that
// span a UTF-16 surrogate pair (e.g. 🎯 = U+1F3AF = `🎯`).
// When we slice such text by code-unit count for title generation, we
// can split mid-pair and leave a lone surrogate. That orphan triggers a
// React hydration mismatch — the SSR HTML pipeline drops it (or emits
// nothing for the invalid code unit), while the client receives the raw
// surrogate via __NEXT_DATA__ JSON, which renders as U+FFFD in the DOM.
// The two sides disagree, hydration fails.
//
// `cleanText` strips lone surrogates so server and client render the
// same string. `safeSlice` slices by code-unit count but never splits a
// surrogate pair, so the more common "title from content[:N]" path
// works on full code points instead.

const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g;
const LONE_LOW_SURROGATE = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(LONE_HIGH_SURROGATE, "").replace(LONE_LOW_SURROGATE, "");
}

/**
 * Slice a string by UTF-16 code-unit count without splitting surrogate
 * pairs. If the cut would land between a high+low surrogate, we drop
 * the orphan high surrogate so the result stays well-formed.
 */
export function safeSlice(s: string, maxLen: number): string {
  if (!s || s.length <= maxLen) return s ?? "";
  const cut = s.slice(0, maxLen);
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return cut.slice(0, -1);
  }
  return cut;
}
