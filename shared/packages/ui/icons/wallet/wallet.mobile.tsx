import Svg, { Path, Rect } from "react-native-svg";

export type WalletIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type WalletIconSize = "sm" | "md" | "lg";
export type WalletIconProps = { variant?: WalletIconVariant; size?: WalletIconSize; strokeWidth?: number };

const sizes: Record<WalletIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<WalletIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function WalletIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: WalletIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return <Svg fill="none" height={pixelSize} viewBox="0 0 24 24" width={pixelSize}>
    <Path d="M4.5 8.5V7.25A1.75 1.75 0 0 1 6.25 5.5h11.5A1.75 1.75 0 0 1 19.5 7.25V8.5" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
    <Rect height={11} rx={1.75} stroke={color} strokeWidth={strokeWidth} width={16} x={4} y={8.5} />
    <Path d="M16 14h3.5A1.5 1.5 0 0 0 21 12.5v-1A1.5 1.5 0 0 0 19.5 10H16a1.5 1.5 0 0 0 0 4Z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} />
  </Svg>;
}
