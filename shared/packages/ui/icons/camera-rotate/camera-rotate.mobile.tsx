import Svg, { Path } from "react-native-svg";

export type CameraRotateIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CameraRotateIconSize = "sm" | "md" | "lg";
export type CameraRotateIconProps = {
  variant?: CameraRotateIconVariant;
  size?: CameraRotateIconSize;
  strokeWidth?: number;
};

const sizes: Record<CameraRotateIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CameraRotateIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function CameraRotateIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: CameraRotateIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8a8.5 8.5 0 0 1 14.4-2.1L20 7.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 4v3.5h-3.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 16a8.5 8.5 0 0 1-14.4 2.1L4 16.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 20v-3.5h3.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m9.5 9 1-1.5h3L14.5 9H16a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 16 15H8a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 8 9h1.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M13.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
