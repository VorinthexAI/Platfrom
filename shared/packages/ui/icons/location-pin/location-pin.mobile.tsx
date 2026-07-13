import Svg, { Circle, Path } from "react-native-svg";
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
      <Path
        d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={3} stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
