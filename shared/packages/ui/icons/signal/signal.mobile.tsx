import Svg, { Path, Rect } from "react-native-svg";
export type SignalIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SignalIconSize = "sm" | "md" | "lg";
export type SignalIconProps = {
  variant?: SignalIconVariant;
  size?: SignalIconSize;
  strokeWidth?: number;
};
const sizes: Record<SignalIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SignalIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function SignalIcon({ variant = "default", size = "md", strokeWidth = 1.5 }: SignalIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={5} width={18} height={14} rx={2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m4 7 8 6 8-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
