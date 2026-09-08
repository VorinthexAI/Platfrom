import Svg, { Circle, Path } from "react-native-svg";

export type FaqIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type FaqIconSize = "sm" | "md" | "lg";
export type FaqIconProps = { variant?: FaqIconVariant; size?: FaqIconSize; strokeWidth?: number };

const sizes: Record<FaqIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FaqIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function FaqIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: FaqIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 4h14v16H5z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M8.5 4v16M11.5 8.5a2 2 0 1 1 2.7 1.88c-.58.25-.95.66-.95 1.37" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="13.25" cy="15" r="0.7" fill={color} />
    </Svg>
  );
}
