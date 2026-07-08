import Svg, { Path } from "react-native-svg";
export type LogOutIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type LogOutIconSize = "sm" | "md" | "lg";
export type LogOutIconProps = {
  variant?: LogOutIconVariant;
  size?: LogOutIconSize;
  strokeWidth?: number;
};
const sizes: Record<LogOutIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<LogOutIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function LogOutIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: LogOutIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 8l4 4-4 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M18 12H9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
