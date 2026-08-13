import Svg, { Path } from "react-native-svg";
export type PlayIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type PlayIconSize = "sm" | "md" | "lg";
export type PlayIconProps = { variant?: PlayIconVariant; size?: PlayIconSize; strokeWidth?: number };
const sizes: Record<PlayIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<PlayIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function PlayIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: PlayIconProps) {
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none"><Path d="M8 5.5v13l10-6.5L8 5.5Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="round" /></Svg>;
}
