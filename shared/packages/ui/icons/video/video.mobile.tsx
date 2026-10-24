import Svg, { Path } from "react-native-svg";
export type VideoIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type VideoIconSize = "sm" | "md" | "lg";
export type VideoIconProps = { variant?: VideoIconVariant; size?: VideoIconSize; strokeWidth?: number };
const sizes: Record<VideoIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<VideoIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function VideoIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: VideoIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7.5h10.5v9H4v-9Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M14.5 10.2 20 7.8v8.4l-5.5-2.4v-3.6Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  );
}
