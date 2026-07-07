import Svg, { Path } from "react-native-svg";
export type CloseIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CloseIconSize = "sm" | "md" | "lg";
export type CloseIconProps = {
  variant?: CloseIconVariant;
  size?: CloseIconSize;
  strokeWidth?: number;
};
const sizes: Record<CloseIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CloseIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function CloseIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: CloseIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 5l14 14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M19 5L5 19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
