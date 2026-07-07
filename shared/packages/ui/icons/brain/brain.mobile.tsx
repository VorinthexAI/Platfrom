import Svg, { Path } from "react-native-svg";
export type BrainIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type BrainIconSize = "sm" | "md" | "lg";
export type BrainIconProps = {
  variant?: BrainIconVariant;
  size?: BrainIconSize;
  strokeWidth?: number;
};
const sizes: Record<BrainIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<BrainIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function BrainIcon({ variant = "default", size = "md", strokeWidth = 1.5 }: BrainIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4a3.5 3.5 0 0 0-3.5 3.5c-2 .3-3.5 1.8-3.5 3.9 0 1.3.6 2.4 1.5 3.1-.3.5-.5 1.1-.5 1.8A3.7 3.7 0 0 0 9.7 20c.9 0 1.7-.3 2.3-.9.6.6 1.4.9 2.3.9a3.7 3.7 0 0 0 3.7-3.7c0-.7-.2-1.3-.5-1.8.9-.7 1.5-1.8 1.5-3.1 0-2.1-1.5-3.6-3.5-3.9A3.5 3.5 0 0 0 12 4Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 4v16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
