import Svg, { Path } from "react-native-svg";
export type EditIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type EditIconSize = "sm" | "md" | "lg";
export type EditIconProps = {
  variant?: EditIconVariant;
  size?: EditIconSize;
  strokeWidth?: number;
};
const sizes: Record<EditIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<EditIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function EditIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: EditIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="m4 20 4.2-1 10.9-10.9a2.2 2.2 0 0 0-3.2-3.2L5 15.8 4 20Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m14.5 6.3 3.2 3.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
