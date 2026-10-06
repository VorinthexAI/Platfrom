import Svg, { Path } from "react-native-svg";

export type RestorePurchasesIconProps = { size?: "sm" | "md" | "lg"; variant?: "default" | "muted" | "accent" | "danger" | "inverse"; strokeWidth?: number };
const sizes = { sm: 16, md: 20, lg: 24 };
const colors = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function RestorePurchasesIcon({ size = "md", variant = "default", strokeWidth = 1.4 }: RestorePurchasesIconProps) {
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none">
    <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
