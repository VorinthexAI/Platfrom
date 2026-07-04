import Svg, { Path } from "react-native-svg";
export type HelpIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type HelpIconSize = "sm" | "md" | "lg";
export type HelpIconProps = {
  variant?: HelpIconVariant;
  size?: HelpIconSize;
  strokeWidth?: number;
};
const sizes: Record<HelpIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<HelpIconVariant, string> = {
  default: "#1C1A17",
  muted: "#6B6358",
  accent: "#8B6F47",
  danger: "#7F2E2E",
  inverse: "#FAF7F2",
};
export function HelpIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: HelpIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 5v14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
