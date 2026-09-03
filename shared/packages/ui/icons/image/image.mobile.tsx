import Svg, { Circle, Path, Rect } from "react-native-svg";
export type ImageIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ImageIconSize = "sm" | "md" | "lg";
export type ImageIconProps = {
  variant?: ImageIconVariant;
  size?: ImageIconSize;
  strokeWidth?: number;
};
const sizes: Record<ImageIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ImageIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function ImageIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: ImageIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="4" width="18" height="16" rx="2" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="8.5" cy="9" r="1.5" stroke={color} strokeWidth={strokeWidth} />
      <Path d="m4 17 4.5-4.5 3.5 3.5 2-2 6 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
