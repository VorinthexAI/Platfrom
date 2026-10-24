import Svg, { Path } from "react-native-svg";
export type LinkIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type LinkIconSize = "sm" | "md" | "lg";
export type LinkIconProps = {
  variant?: LinkIconVariant;
  size?: LinkIconSize;
  strokeWidth?: number;
};
const sizes: Record<LinkIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<LinkIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function LinkIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: LinkIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M9.5 14.5 8 16a3.2 3.2 0 0 1-4.5-4.5l2.2-2.2a3.2 3.2 0 0 1 4.5 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14.5 9.5 16 8a3.2 3.2 0 0 1 4.5 4.5l-2.2 2.2a3.2 3.2 0 0 1-4.5 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9.2 14.8 14.8 9.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
