/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: "var(--color-base, #0B1220)",
          panel: "var(--color-base-panel, #131C2E)",
          raised: "var(--color-base-raised, #1A2438)",
          border: "var(--color-base-border, #24304A)",
        },
        ink: {
          DEFAULT: "var(--color-ink, #E8ECF4)",
          muted: "var(--color-ink-muted, #8B98B3)",
          faint: "var(--color-ink-faint, #5A6685)",
        },
        signal: {
          DEFAULT: "#2FD9C4",
          dim: "#1B8F81",
          glow: "#7FF3E4",
        },
        risk: {
          low: "#3FBF7F",
          moderate: "#E8C547",
          high: "#F0924B",
          veryhigh: "#E85D4C",
          critical: "#C4306B",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        panel: "var(--shadow-panel, 0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.5))",
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(0.6)", opacity: "0.8" },
          "80%": { transform: "scale(2.2)", opacity: "0" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "pulse-ring": "pulseRing 1.8s cubic-bezier(0.2,0.6,0.4,1) infinite",
        blink: "blink 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
