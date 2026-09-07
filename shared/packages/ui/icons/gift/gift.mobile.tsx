import Svg, { Path } from "react-native-svg";

export type GiftIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type GiftIconSize = "sm" | "md" | "lg" | "xl";
export type GiftIconProps = { variant?: GiftIconVariant; size?: GiftIconSize; strokeWidth?: number };

const sizes: Record<GiftIconSize, number> = { sm: 16, md: 20, lg: 24, xl: 56 };
const colors: Record<GiftIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function GiftIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: GiftIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return <Svg fill="none" height={pixelSize} viewBox="0 0 24 24" width={pixelSize}>
    <Path d="M4 10h16v10H4V10Zm-1-4h18v4H3V6Zm9 0v14M12 6H8.5A2.5 2.5 0 1 1 11 3.5L12 6Zm0 0h3.5A2.5 2.5 0 1 0 13 3.5L12 6Z" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
  </Svg>;
}
