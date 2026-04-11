export const theme = {
  bg: "#0A0A0F",
  card: "#13131A",
  border: "rgba(255,255,255,0.06)",
  primary: "#10B981",
  emeraldDark: "#059669",
  cyan: "#0EA5E9",
  gold: "#F59E0B",
  text: "#F5F5F7",
  muted: "#9CA3AF",
  dim: "#6B7280",
  danger: "#EF4444",
  success: "#10B981",
} as const;

export type ThemeKey = keyof typeof theme;
