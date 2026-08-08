import Svg, { Path } from "react-native-svg";
export type FolderIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type FolderIconSize = "sm" | "md" | "lg";
export type FolderIconProps = {
  variant?: FolderIconVariant;
  size?: FolderIconSize;
  strokeWidth?: number;
};
const sizes: Record<FolderIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FolderIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function FolderIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: FolderIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2H18.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
