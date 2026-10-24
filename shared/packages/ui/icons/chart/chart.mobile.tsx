import Svg, { Path } from "react-native-svg";
export type ChartIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ChartIconSize = "sm" | "md" | "lg";
export type ChartIconProps = { variant?: ChartIconVariant; size?: ChartIconSize; strokeWidth?: number };
const sizes: Record<ChartIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ChartIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function ChartIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: ChartIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 19.5h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M7 16.5v-4M12 16.5V8M17 16.5v-7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
