import Svg, { Path } from "react-native-svg";
export type BellIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type BellIconSize = "sm" | "md" | "lg";
export type BellIconProps = {
  variant?: BellIconVariant;
  size?: BellIconSize;
  strokeWidth?: number;
};
const sizes: Record<BellIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<BellIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function BellIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: BellIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M18 9a6 6 0 0 0-12 0c0 6-3 7-3 7h18s-3-1-3-7Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14.2 20a2.4 2.4 0 0 1-4.4 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
