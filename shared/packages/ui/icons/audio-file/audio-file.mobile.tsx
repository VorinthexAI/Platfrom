import Svg, { Path } from "react-native-svg";

export type AudioFileIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type AudioFileIconSize = "sm" | "md" | "lg";
export type AudioFileIconProps = { variant?: AudioFileIconVariant; size?: AudioFileIconSize; strokeWidth?: number };

const sizes: Record<AudioFileIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<AudioFileIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };

export function AudioFileIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: AudioFileIconProps) {
  const color = colors[variant];
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none">
    <Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-5-5Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M14 2v4a2 2 0 0 0 2 2h4M8 13v3m3-5v7m3-5v3m3-2v1" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
