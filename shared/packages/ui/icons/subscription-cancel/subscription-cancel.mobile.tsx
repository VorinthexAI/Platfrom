import Svg, { Path } from "react-native-svg";

export type SubscriptionCancelIconProps = { size?: "sm" | "md" | "lg"; variant?: "default" | "muted" | "accent" | "danger" | "inverse"; strokeWidth?: number };
const sizes = { sm: 16, md: 20, lg: 24 };
const colors = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function SubscriptionCancelIcon({ size = "md", variant = "default", strokeWidth = 1.4 }: SubscriptionCancelIconProps) {
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none">
    <Path d="M19.5 8A8 8 0 0 0 5 6L3 9m0-5v5h5M3.5 14A8 8 0 0 0 12 20m3-5 6 6m0-6-6 6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
