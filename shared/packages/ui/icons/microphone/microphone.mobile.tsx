import Svg, { Path, Rect } from "react-native-svg";

export type MicrophoneIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type MicrophoneIconSize = "sm" | "md" | "lg";
export type MicrophoneIconProps = { variant?: MicrophoneIconVariant; size?: MicrophoneIconSize; strokeWidth?: number };
const sizes: Record<MicrophoneIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MicrophoneIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };

export function MicrophoneIcon({ variant = "default", size = "md", strokeWidth = 1.6 }: MicrophoneIconProps) {
  const color = colors[variant];
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none"><Rect x="8" y="3" width="8" height="12" rx="4" stroke={color} strokeWidth={strokeWidth} /><Path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" /></Svg>;
}
