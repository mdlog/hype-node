// Design tokens — mirror hifi-kit.jsx so SVG/inline-color usage stays canonical.

export const tokens = {
  bg: "#07090C",
  bgElev: "#0C1014",
  bgElev2: "#11161C",
  bgHover: "#161C24",
  border: "#1C232C",
  borderStrong: "#2A3340",
  borderFaint: "#141A21",
  text: "#E6EAF0",
  textDim: "#8A94A3",
  textFaint: "#515B6A",
  textGhost: "#2E3640",
  emerald: "#10B981",
  emeraldDim: "#0A6C4D",
  amber: "#F59E0B",
  amberDim: "#92590A",
  red: "#EF4444",
  cyan: "#22D3EE",
} as const;

export type AccentColor = "emerald" | "amber" | "red" | "cyan" | "textDim" | "textFaint";

export const accentHex: Record<AccentColor, string> = {
  emerald: tokens.emerald,
  amber: tokens.amber,
  red: tokens.red,
  cyan: tokens.cyan,
  textDim: tokens.textDim,
  textFaint: tokens.textFaint,
};
