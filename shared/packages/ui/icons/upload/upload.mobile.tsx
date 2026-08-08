import Svg, { Path } from "react-native-svg";
export type UploadIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type UploadIconSize = "sm" | "md" | "lg";
export type UploadIconProps = {
  variant?: UploadIconVariant;
  size?: UploadIconSize;
  strokeWidth?: number;
};
const sizes: Record<UploadIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<UploadIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function UploadIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: UploadIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="m7 9 5-5 5 5M12 4v12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 15v4h14v-4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
