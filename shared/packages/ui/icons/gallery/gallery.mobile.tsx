import Svg, { Path, Rect, Circle } from "react-native-svg";
export type GalleryIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type GalleryIconSize = "sm" | "md" | "lg";
export type GalleryIconProps = {
  variant?: GalleryIconVariant;
  size?: GalleryIconSize;
  strokeWidth?: number;
};
const sizes: Record<GalleryIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<GalleryIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function GalleryIcon({ variant = "default", size = "md", strokeWidth = 1.5 }: GalleryIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={4} width={18} height={16} rx={2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={9} cy={10} r={1.6} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m3 17 5.2-5.2a1.5 1.5 0 0 1 2.1 0L16 17.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m14 15 2.3-2.3a1.5 1.5 0 0 1 2.1 0L21 15.3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
