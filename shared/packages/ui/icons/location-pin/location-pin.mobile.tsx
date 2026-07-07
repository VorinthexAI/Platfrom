import Svg, { Path } from "react-native-svg";
export type LocationPinIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type LocationPinIconSize = "sm" | "md" | "lg";
export type LocationPinIconProps = {
  variant?: LocationPinIconVariant;
  size?: LocationPinIconSize;
  strokeWidth?: number;
};
const sizes: Record<LocationPinIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<LocationPinIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function LocationPinIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: LocationPinIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 5v14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
