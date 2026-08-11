import Svg, { Circle, Path } from "react-native-svg";
export type CameraIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CameraIconSize = "sm" | "md" | "lg";
export type CameraIconProps = {
  variant?: CameraIconVariant;
  size?: CameraIconSize;
  strokeWidth?: number;
};
const sizes: Record<CameraIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CameraIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function CameraIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: CameraIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M14.5 5 16 7h2.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-7A2.5 2.5 0 0 1 5.5 7H8l1.5-2h5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Circle cx="12" cy="13" r="3.25" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
