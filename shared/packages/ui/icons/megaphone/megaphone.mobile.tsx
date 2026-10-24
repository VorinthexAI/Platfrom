import Svg, { Path } from "react-native-svg";
export type MegaphoneIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type MegaphoneIconSize = "sm" | "md" | "lg";
export type MegaphoneIconProps = { variant?: MegaphoneIconVariant; size?: MegaphoneIconSize; strokeWidth?: number };
const sizes: Record<MegaphoneIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MegaphoneIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function MegaphoneIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: MegaphoneIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4.5 9.5v5l3.2.6 1.3 4.2h2.2l-1.1-4.4 8.4 2.2V6.9L9.9 9.1 4.5 9.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M18.6 10.2h1.4M18.6 13.8h1.4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
