import Svg, { Path } from "react-native-svg";
export type EyeOffIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type EyeOffIconSize = "sm" | "md" | "lg";
export type EyeOffIconProps = {
  variant?: EyeOffIconVariant;
  size?: EyeOffIconSize;
  strokeWidth?: number;
};
const sizes: Record<EyeOffIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<EyeOffIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function EyeOffIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: EyeOffIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 5v14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
