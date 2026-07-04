import Svg, { Circle, Path } from "react-native-svg";
export type GlobeIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type GlobeIconSize = "sm" | "md" | "lg";
export type GlobeIconProps = {
  variant?: GlobeIconVariant;
  size?: GlobeIconSize;
  strokeWidth?: number;
};
const sizes: Record<GlobeIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<GlobeIconVariant, string> = {
  default: "#1C1A17",
  muted: "#6B6358",
  accent: "#8B6F47",
  danger: "#7F2E2E",
  inverse: "#FAF7F2",
};
export function GlobeIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: GlobeIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M3.5 12h17" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 3.5c2.8 2.3 4.3 5.4 4.3 8.5s-1.5 6.2-4.3 8.5c-2.8-2.3-4.3-5.4-4.3-8.5S9.2 5.8 12 3.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  );
}
