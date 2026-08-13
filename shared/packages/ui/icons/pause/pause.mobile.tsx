import Svg, { Path } from "react-native-svg";
export type PauseIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type PauseIconSize = "sm" | "md" | "lg";
export type PauseIconProps = { variant?: PauseIconVariant; size?: PauseIconSize; strokeWidth?: number };
const sizes: Record<PauseIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<PauseIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function PauseIcon({ variant = "default", size = "md", strokeWidth = 1.8 }: PauseIconProps) {
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none"><Path d="M9 6v12M15 6v12" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" /></Svg>;
}
