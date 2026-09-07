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
      <Path d="M6 3h13a2 2 0 0 1 2 2v11" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={3} y={6} width={16} height={15} rx={2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={8} cy={11} r={1.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="m4 18 4-4a1.4 1.4 0 0 1 2 0l2 2 1.5-1.5a1.4 1.4 0 0 1 2 0L19 18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
