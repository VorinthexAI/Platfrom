import Svg, { Path } from "react-native-svg";
export type CopyIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CopyIconSize = "sm" | "md" | "lg";
export type CopyIconProps = {
  variant?: CopyIconVariant;
  size?: CopyIconSize;
  strokeWidth?: number;
};
const sizes: Record<CopyIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CopyIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function CopyIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: CopyIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M9 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
