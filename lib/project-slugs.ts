// Maps fundraising project names to CoinGecko coin slugs so they can be
// looked up via `/api/asset-logos`. Two layers:
//
//   1. Curated map (`PROJECT_TO_COINGECKO`) — explicit overrides for names
//      that don't auto-slug correctly (e.g., "Eigen Labs" → "eigenlayer").
//      Setting a value to `null` is also useful as a "skip lookup" hint for
//      projects we know have no CoinGecko listing yet.
//   2. Auto-slug fallback (`autoSlug`) — lowercased, ASCII-hyphenated form
//      of the name. Catches the long tail of L1/L2 listings that the live
//      API surfaces (Bitcoin, Ethereum, Litecoin, Helium, Hifi Finance…).
//
// The asset-logos route handler has its own `SLUG_REMAP` for the few names
// where SoSoValue's slug diverges from CoinGecko's canonical id (Stacks →
// blockstack, etc.) — keep cross-listing-wide remaps there, project-specific
// ones here.
const PROJECT_TO_COINGECKO: Record<string, string | null> = {
  "eigen labs": "eigenlayer",
  eigenlayer: "eigenlayer",
  berachain: "berachain-bera",
  "celestia labs": "celestia",
  celestia: "celestia",
  "pyth network": "pyth-network",
  pyth: "pyth-network",
  worldcoin: "worldcoin-wld",
  "ethena labs": "ethena",
  ethena: "ethena",
  hyperliquid: "hyperliquid",
  "monad labs": "monad",
  monad: "monad",
  "movement labs": "movement",
  movement: "movement",
  "story protocol": "story-2",
  babylon: "babylon",
  "renzo protocol": "renzo-restaked-eth",
  renzo: "renzo-restaked-eth",
  avail: "avail",
  initia: "initia",
  nillion: "nillion",
  "polymer labs": null,
  anoma: null,
  "espresso systems": null,
  "penumbra labs": "penumbra",
  "crossover markets": null,

  // Live-API common projects whose CoinGecko slug differs from the
  // straightforward name slug. Listed here so the logo lookup hits on the
  // first try instead of relying on the route handler's SLUG_REMAP.
  ripple: "ripple", // XRP — id is "ripple"
  stacks: "blockstack",
  enjin: "enjincoin",
  combo: "furucombo",
  wirex: "wirex-token",
  "the sandbox": "the-sandbox",
  "hifi finance": "hifi-finance",
};

function autoSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

export function projectSlug(name: string): string | null {
  const key = name.trim().toLowerCase();
  // Curated entry takes precedence — including explicit `null` ("no logo,
  // skip the lookup") so we don't waste a request on projects we know lack
  // a CoinGecko listing.
  if (key in PROJECT_TO_COINGECKO) {
    return PROJECT_TO_COINGECKO[key];
  }
  return autoSlug(name);
}
