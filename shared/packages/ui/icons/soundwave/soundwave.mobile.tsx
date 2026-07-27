import Svg, { Path } from "react-native-svg";

export type SoundwaveIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SoundwaveIconSize = "sm" | "md" | "lg";
export type SoundwaveIconProps = { variant?: SoundwaveIconVariant; size?: SoundwaveIconSize; strokeWidth?: number };
const sizes: Record<SoundwaveIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SoundwaveIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };

export function SoundwaveIcon({ variant = "default", size = "md", strokeWidth = 1.8 }: SoundwaveIconProps) {
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none"><Path d="M6 9v6M9 6v12M12 4v16M15 6v12M18 9v6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" /></Svg>;
}
