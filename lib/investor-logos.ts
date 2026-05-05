// Curated mapping from VC / investor name → public web domain. Used to
// derive logo URLs via Google's favicon service:
//   https://www.google.com/s2/favicons?domain=<domain>&sz=128
//
// This is the cheapest path to "real logos" for VC firms — they aren't on
// CoinGecko (the directory we use for token logos) and most don't expose
// their own logo CDN. The favicon service is reliable, no-auth, and
// returns a transparent PNG that fits a 24-32px circular avatar nicely.
//
// Match is case-insensitive. Keys here cover every investor name surfaced
// by the SoSoValue fundraising endpoints; add more as gaps appear.

const INVESTOR_DOMAINS: Record<string, string> = {
  // Crypto-native VCs
  paradigm: "paradigm.xyz",
  "andreessen horowitz": "a16z.com",
  a16z: "a16z.com",
  "a16z crypto": "a16z.com",
  "pantera capital": "panteracapital.com",
  pantera: "panteracapital.com",
  "multicoin capital": "multicoin.capital",
  multicoin: "multicoin.capital",
  "polychain capital": "polychain.capital",
  polychain: "polychain.capital",
  "coinbase ventures": "coinbase.com",
  "binance labs": "binance.com",
  dragonfly: "dragonfly.xyz",
  "dragonfly capital": "dragonfly.xyz",
  "galaxy digital": "galaxy.com",
  galaxy: "galaxy.com",
  "jump crypto": "jumpcrypto.com",
  jump: "jumpcrypto.com",
  "variant fund": "variant.fund",
  variant: "variant.fund",
  "electric capital": "electriccapital.com",
  "framework ventures": "framework.ventures",
  framework: "framework.ventures",
  "delphi ventures": "delphidigital.io",
  "delphi digital": "delphidigital.io",
  delphi: "delphidigital.io",
  "spartan group": "thespartangroup.com",
  spartan: "thespartangroup.com",
  "amber group": "ambergroup.io",
  amber: "ambergroup.io",
  "robot ventures": "robotventures.com",
  hashed: "hashed.com",
  "hashed fund": "hashed.com",
  defiance: "defiance.capital",
  "defiance capital": "defiance.capital",
  alameda: "alameda-research.com",
  "alameda research": "alameda-research.com",
  "kraken ventures": "krakenventures.com",
  "okx ventures": "okx.com",
  "huobi ventures": "huobi.com",
  "ledgerprime": "ledgerprime.com",
  "1confirmation": "1confirmation.com",
  cms: "cmsholdings.io",
  "cms holdings": "cmsholdings.io",
  "fenbushi capital": "fenbushi.vc",
  fenbushi: "fenbushi.vc",
  "node capital": "nodecapital.com",
  "blocktower capital": "blocktower.com",
  blocktower: "blocktower.com",

  // Generalist VCs that invest in crypto
  "sequoia capital": "sequoiacap.com",
  sequoia: "sequoiacap.com",
  "founders fund": "foundersfund.com",
  "lightspeed venture partners": "lsvp.com",
  lightspeed: "lsvp.com",
  "tiger global": "tigerglobal.com",
  "fidelity": "fidelity.com",
  "fidelity ventures": "fidelity.com",
  "softbank": "softbank.com",
  "softbank vision fund": "softbank.com",
  "general catalyst": "generalcatalyst.com",
  "ribbit capital": "ribbitcap.com",
  ribbit: "ribbitcap.com",
  "thrive capital": "thrivecap.com",
  "insight partners": "insightpartners.com",
  insight: "insightpartners.com",
};

const GOOGLE_FAVICON = "https://www.google.com/s2/favicons?sz=128&domain=";

export function investorLogoUrl(name: string): string | null {
  const key = name.trim().toLowerCase();
  const domain = INVESTOR_DOMAINS[key];
  if (!domain) return null;
  return `${GOOGLE_FAVICON}${encodeURIComponent(domain)}`;
}
