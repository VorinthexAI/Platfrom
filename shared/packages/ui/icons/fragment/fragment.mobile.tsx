import Svg, { Path } from "react-native-svg";
export type FragmentIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type FragmentIconSize = "sm" | "md" | "lg";
export type FragmentIconProps = {
  variant?: FragmentIconVariant;
  size?: FragmentIconSize;
  strokeWidth?: number;
};
const sizes: Record<FragmentIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FragmentIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function FragmentIcon({ variant = "default", size = "md", strokeWidth = 1.5 }: FragmentIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M12.5 3 18.5 9 14 21 9.5 20 5 8.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12.5 3 12 20.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 8.5 12.2 10 18.5 9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
