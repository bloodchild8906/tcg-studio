/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Studio-dark palette (spec sec 45.2 — "feels like a creative studio").
        ink: {
          950: "#0b0d10",
          900: "#11141a",
          800: "#161a22",
          700: "#1d2230",
          600: "#262c3d",
          500: "#3a4258",
          400: "#5a6480",
        },
        accent: {
          500: "#d4a24c", // brass / arcforge gold
          400: "#e0b769",
          300: "#ebd198",
        },
        danger: {
          500: "#e25c5c",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.04), 0 1px 0 rgba(255,255,255,0.02) inset",
      },
    },
  },
  plugins: [],
};
