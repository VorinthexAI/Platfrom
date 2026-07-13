import Svg, { Circle } from "react-native-svg";
export type MoreHorizontalIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type MoreHorizontalIconSize = "sm" | "md" | "lg";
export type MoreHorizontalIconProps = {
  variant?: MoreHorizontalIconVariant;
  size?: MoreHorizontalIconSize;
  strokeWidth?: number;
};
const sizes: Record<MoreHorizontalIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MoreHorizontalIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function MoreHorizontalIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: MoreHorizontalIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={1.4} fill={color} />
      <Circle cx={12} cy={12} r={1.4} fill={color} />
      <Circle cx={19} cy={12} r={1.4} fill={color} />
    </Svg>
  );
}
