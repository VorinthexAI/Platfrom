import Svg, { Circle, Path } from "react-native-svg";
export type HelpIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type HelpIconSize = "sm" | "md" | "lg";
export type HelpIconProps = {
  variant?: HelpIconVariant;
  size?: HelpIconSize;
  strokeWidth?: number;
};
const sizes: Record<HelpIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<HelpIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function HelpIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: HelpIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M9.75 9a2.4 2.4 0 1 1 3.4 2.18c-.72.36-1.15.88-1.15 1.82" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 16.5h.01" stroke={color} strokeWidth={strokeWidth + 0.6} strokeLinecap="round" />
    </Svg>
  );
}
