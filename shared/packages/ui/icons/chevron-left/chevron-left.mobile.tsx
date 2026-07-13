import Svg, { Path } from "react-native-svg";
export type ChevronLeftIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ChevronLeftIconSize = "sm" | "md" | "lg";
export type ChevronLeftIconProps = {
  variant?: ChevronLeftIconVariant;
  size?: ChevronLeftIconSize;
  strokeWidth?: number;
};
const sizes: Record<ChevronLeftIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ChevronLeftIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function ChevronLeftIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: ChevronLeftIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="m15 18-6-6 6-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
