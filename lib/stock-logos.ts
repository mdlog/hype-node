// Curated mapping from public-company stock ticker → corporate web domain.
//
// SoSoValue's `/crypto-stocks` endpoint doesn't ship a logo URL — it only
// gives ticker + company name. Public companies aren't listed on CoinGecko
// (which we use for token logos), so we proxy the company favicon ourselves.
//
// We DON'T point `<img src>` at third-party logo services (Google favicons,
// Clearbit, DuckDuckGo) directly — common ad-blockers and privacy
// extensions block `google.com/s2/favicons` and similar by default, which
// silently turns every logo into a letter-avatar fallback.
//
// Instead `stockLogoUrl()` returns a path on our own domain
// (`/api/stock-logos?ticker=…`) which the route handler resolves server-side
// against multiple upstream sources (Clearbit → DuckDuckGo → Google), with
// long HTTP cache headers so the round-trip happens at most once per domain
// per week.
//
// Match is case-insensitive on the ticker. Add new entries when a
// previously unseen ticker shows up in the live API response — the
// StockLogo component falls back to a deterministic letter avatar in the
// meantime.

export const STOCK_DOMAINS: Record<string, string> = {
  // BTC Treasury / corporate holders
  MSTR: "microstrategy.com",
  TSLA: "tesla.com",
  SQ: "block.xyz",
  XYZ: "block.xyz",
  GME: "gamestop.com",
  MTPLF: "metaplanet.jp",
  // Metaplanet's primary listing on the Tokyo Stock Exchange (the SoSoValue
  // /btc-treasuries response uses this code, MTPLF is the OTC ADR ticker).
  "3350": "metaplanet.jp",

  // Mining
  RIOT: "riotplatforms.com",
  MARA: "mara.com",
  CLSK: "cleanspark.com",
  HUT: "hut8.io",
  BITF: "bitfarms.com",
  HIVE: "hivedigitaltech.com",
  IREN: "iris-energy.co",
  CIFR: "ciphermining.com",
  BTBT: "bit-digital.com",
  WULF: "terawulf.com",
  BTDR: "bitdeer.com",
  CAN: "canaan.io",
  CORZ: "corescientific.com",
  GREE: "greenidge.com",
  DGHI: "digihost.ca",
  ARBK: "argoblockchain.com",
  EBON: "ebang.com.cn",

  // Exchange / brokerage / fintech
  COIN: "coinbase.com",
  HOOD: "robinhood.com",
  PYPL: "paypal.com",
  IBKR: "interactivebrokers.com",

  // Bitcoin spot ETFs (frequently surface alongside crypto-stocks)
  IBIT: "ishares.com",
  FBTC: "fidelity.com",
  ARKB: "ark-funds.com",
  BITB: "bitwiseinvestments.com",
  BRRR: "valkyrieinvest.com",
  GBTC: "grayscale.com",
  ETHE: "grayscale.com",
  BTCO: "invesco.com",
  EZBC: "franklintempleton.com",
  HODL: "vaneck.com",
  BTC: "ishares.com",

  // Other crypto-adjacent
  NVDA: "nvidia.com",
  AMD: "amd.com",
  BLK: "blackrock.com",
  SI: "silvergate.com",
  BTCS: "btcs.com",
  SOS: "sosltd.com",
  NCTY: "the9.com",
  BTCM: "btcm.group",
  BIGG: "bigg.com",
};

export function stockDomain(ticker: string): string | null {
  if (!ticker) return null;
  return STOCK_DOMAINS[ticker.trim().toUpperCase()] ?? null;
}

export function stockLogoUrl(ticker: string): string | null {
  if (!ticker) return null;
  const upper = ticker.trim().toUpperCase();
  if (!STOCK_DOMAINS[upper]) return null;
  // Returning a path on our own domain instead of a 3rd-party URL: ad
  // blockers and privacy extensions don't block requests to our own host.
  return `/api/stock-logos?ticker=${encodeURIComponent(upper)}`;
}
