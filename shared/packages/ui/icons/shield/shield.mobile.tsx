import Svg, { Path } from "react-native-svg";

export type ShieldIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ShieldIconSize = "sm" | "md" | "lg";
export type ShieldIconProps = { variant?: ShieldIconVariant; size?: ShieldIconSize; strokeWidth?: number };

const sizes: Record<ShieldIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ShieldIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };

export function ShieldIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: ShieldIconProps) {
  const color = colors[variant];
  return (
    <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 19 6v5.2c0 4.6-2.8 7.7-7 9.8-4.2-2.1-7-5.2-7-9.8V6l7-3Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M12 7v9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
