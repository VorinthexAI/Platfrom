import Svg, { Path } from "react-native-svg";
export type CloudUploadIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CloudUploadIconSize = "sm" | "md" | "lg";
export type CloudUploadIconProps = { variant?: CloudUploadIconVariant; size?: CloudUploadIconSize; strokeWidth?: number };
const sizes: Record<CloudUploadIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CloudUploadIconVariant, string> = { default: "#F5F7F8", muted: "#7B858C", accent: "#DDE2E5", danger: "#B04A4A", inverse: "#030507" };
export function CloudUploadIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: CloudUploadIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M7.2 17.5h-.4A4.3 4.3 0 0 1 7 9a5.2 5.2 0 0 1 10-.6 3.6 3.6 0 0 1 .8 7.1h-.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 19.5v-7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M9.2 14.2 12 11.4l2.8 2.8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
