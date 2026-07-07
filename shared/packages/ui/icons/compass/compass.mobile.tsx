import Svg, { Path, Circle } from "react-native-svg";
export type CompassIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CompassIconSize = "sm" | "md" | "lg";
export type CompassIconProps = {
  variant?: CompassIconVariant;
  size?: CompassIconSize;
  strokeWidth?: number;
};
const sizes: Record<CompassIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CompassIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function CompassIcon({ variant = "default", size = "md", strokeWidth = 1.5 }: CompassIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m15.5 8.5-2 5-5 2 2-5z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
