import Svg, { Path } from "react-native-svg";
export type DownloadIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type DownloadIconSize = "sm" | "md" | "lg";
export type DownloadIconProps = {
  variant?: DownloadIconVariant;
  size?: DownloadIconSize;
  strokeWidth?: number;
};
const sizes: Record<DownloadIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<DownloadIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function DownloadIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: DownloadIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 16v4h14v-4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
