import Svg, { Path, Rect } from "react-native-svg";
export type ArchiveIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ArchiveIconSize = "sm" | "md" | "lg";
export type ArchiveIconProps = {
  variant?: ArchiveIconVariant;
  size?: ArchiveIconSize;
  strokeWidth?: number;
};
const sizes: Record<ArchiveIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ArchiveIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function ArchiveIcon({ variant = "default", size = "md", strokeWidth = 1.5 }: ArchiveIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={4} width={18} height={5} rx={1} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 13h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
