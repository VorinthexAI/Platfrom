import Svg, { Path } from "react-native-svg";
export type IncognitoIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type IncognitoIconSize = "sm" | "md" | "lg";
export type IncognitoIconProps = {
  variant?: IncognitoIconVariant;
  size?: IncognitoIconSize;
  strokeWidth?: number;
};
const sizes: Record<IncognitoIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<IncognitoIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function IncognitoIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: IncognitoIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 10.5h16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M7.5 10.5c0-3.2 2-5.5 4.5-5.5s4.5 2.3 4.5 5.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M7 15.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M21.5 15.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M7 15.25h10" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
