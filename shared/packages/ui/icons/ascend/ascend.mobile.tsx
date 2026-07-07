import Svg, { Path } from "react-native-svg";
export type AscendIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type AscendIconSize = "sm" | "md" | "lg";
export type AscendIconProps = {
  variant?: AscendIconVariant;
  size?: AscendIconSize;
  strokeWidth?: number;
};
const sizes: Record<AscendIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<AscendIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function AscendIcon({ variant = "default", size = "md", strokeWidth = 1.5 }: AscendIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 19h16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m5 15 4.5-4.5 3 3L19 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M15 7h4v4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
