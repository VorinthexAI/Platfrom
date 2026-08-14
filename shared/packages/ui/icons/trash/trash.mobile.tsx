import Svg, { Path } from "react-native-svg";
export type TrashIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type TrashIconSize = "sm" | "md" | "lg";
export type TrashIconProps = {
  variant?: TrashIconVariant;
  size?: TrashIconSize;
  strokeWidth?: number;
};
const sizes: Record<TrashIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TrashIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function TrashIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: TrashIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
