import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#0b0e13", soft: "#11151c", card: "#151a23" },
        border: { DEFAULT: "#1f2632" },
        accent: { DEFAULT: "#22d3ee", strong: "#06b6d4" },
        success: "#22c55e",
        danger: "#ef4444",
        warning: "#f59e0b",
        muted: "#64748b",
      },
      fontFamily: { sans: ["ui-sans-serif", "system-ui", "Inter", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
