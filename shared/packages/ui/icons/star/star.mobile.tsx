import Svg, { Circle, Path } from "react-native-svg";
export type StarIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type StarIconSize = "sm" | "md" | "lg";
export type StarIconProps = {
  variant?: StarIconVariant;
  size?: StarIconSize;
  strokeWidth?: number;
};
const sizes: Record<StarIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<StarIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function StarIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: StarIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.52l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86L12 3Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Circle cx="12" cy="11.6" r="1.55" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
