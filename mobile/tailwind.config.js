/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0F",
        card: "#13131A",
        border: "rgba(255,255,255,0.06)",
        primary: "#059669",
        gold: "#F59E0B",
        violet: "#10B981",
        text: "#F5F5F7",
        muted: "#9CA3AF",
      },
      fontFamily: {
        serif: ["CormorantGaramond"],
        sans: ["Inter"],
      },
    },
  },
  plugins: [],
};
