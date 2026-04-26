import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: "#07090C",
        "bg-elev": "#0C1014",
        "bg-elev-2": "#11161C",
        "bg-hover": "#161C24",
        // Borders
        border: "#1C232C",
        "border-strong": "#2A3340",
        "border-faint": "#141A21",
        // Text
        text: "#E6EAF0",
        "text-dim": "#8A94A3",
        "text-faint": "#515B6A",
        "text-ghost": "#2E3640",
        // Accents
        emerald: {
          DEFAULT: "#10B981",
          dim: "#0A6C4D",
        },
        amber: {
          DEFAULT: "#F59E0B",
          dim: "#92590A",
        },
        red: { DEFAULT: "#EF4444" },
        cyan: { DEFAULT: "#22D3EE" },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Inter Display",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "IBM Plex Mono",
          "ui-monospace",
          "Menlo",
          "monospace",
        ],
      },
      letterSpacing: {
        tightish: "-0.01em",
        tighter2: "-0.02em",
      },
      boxShadow: {
        "glow-emerald": "0 0 12px rgba(16,185,129,0.5)",
        "glow-amber": "0 0 12px rgba(245,158,11,0.5)",
        "glow-cyan": "0 0 12px rgba(34,211,238,0.5)",
        "glow-red": "0 0 12px rgba(239,68,68,0.5)",
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "pulse-soft": "pulseSoft 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
