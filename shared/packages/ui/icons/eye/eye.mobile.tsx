import Svg, { Path } from "react-native-svg";
export type EyeIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type EyeIconSize = "sm" | "md" | "lg";
export type EyeIconProps = {
  variant?: EyeIconVariant;
  size?: EyeIconSize;
  strokeWidth?: number;
};
const sizes: Record<EyeIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<EyeIconVariant, string> = {
  default: "#1C1A17",
  muted: "#6B6358",
  accent: "#8B6F47",
  danger: "#7F2E2E",
  inverse: "#FAF7F2",
};
export function EyeIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: EyeIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 5v14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
