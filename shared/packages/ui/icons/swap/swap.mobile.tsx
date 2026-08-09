import Svg, { Path } from "react-native-svg";

export type SwapIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SwapIconSize = "sm" | "md" | "lg";
export type SwapIconProps = {
  variant?: SwapIconVariant;
  size?: SwapIconSize;
  strokeWidth?: number;
};

const sizes: Record<SwapIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SwapIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function SwapIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: SwapIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg fill="none" height={pixelSize} viewBox="0 0 24 24" width={pixelSize}>
      <Path d="M5 7h14m-4-4 4 4-4 4" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
      <Path d="M19 17H5m4-4-4 4 4 4" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
    </Svg>
  );
}
