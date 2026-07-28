import Svg, { Path } from "react-native-svg";

export type SendIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SendIconSize = "sm" | "md" | "lg";
export type SendIconProps = { variant?: SendIconVariant; size?: SendIconSize; strokeWidth?: number };
const sizes: Record<SendIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SendIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };

export function SendIcon({ variant = "default", size = "md", strokeWidth = 1.6 }: SendIconProps) {
  const color = colors[variant];
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none"><Path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
