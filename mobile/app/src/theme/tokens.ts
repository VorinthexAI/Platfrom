import {
  colors as sharedColors,
  radii as sharedRadii,
  spacing as sharedSpacing,
} from "@vorinthex/shared/ui/tokens";

/**
 * Mobile theme, extending the shared Vorinthex tokens with the metallic
 * obsidian palette from design/design.md. Monochrome only — no accent colors.
 */
export const palette = {
  ...sharedColors,
  voidBlack: "#000000",
  obsidian900: "#080B0F",
  obsidian850: "#0D1117",
  obsidian800: "#141922",
  gunmetal: "#1B232C",
  platinum: "#C9CED2",
  silver50: "#F5F7F8",
  silver100: "#DDE2E5",
  silver300: "#AEB6BC",
  silver500: "#7B858C",
  silver700: "#3C434A",
  chromeWhite: "#FFFFFF",
  hairline: "rgba(221, 226, 229, 0.14)",
  hairlineBright: "rgba(255, 255, 255, 0.30)",
  insetHighlight: "rgba(255, 255, 255, 0.07)",
  panel: "#0A0E13",
  panelRaised: "#10151C",
} as const;

export const radii = {
  ...sharedRadii,
  xl: 28,
} as const;

export const spacing = sharedSpacing;

export const fonts = {
  light: "Geist_300Light",
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
} as const;

/** Wide-tracked uppercase labels are the core typographic voice of Core. */
export const tracking = {
  micro: 2.5,
  label: 4,
  title: 7,
  hero: 9,
} as const;
