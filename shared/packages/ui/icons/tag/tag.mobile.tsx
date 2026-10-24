import Svg, { Path } from "react-native-svg";
export type TagIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type TagIconSize = "sm" | "md" | "lg";
export type TagIconProps = { variant?: TagIconVariant; size?: TagIconSize; strokeWidth?: number };
const sizes: Record<TagIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TagIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function TagIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: TagIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11l9 9-6.5 6.5-9-9V5.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M8.2 8.2h.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}
