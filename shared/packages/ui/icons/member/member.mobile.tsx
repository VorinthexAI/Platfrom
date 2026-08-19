import Svg, { Path } from "react-native-svg";
export type MemberIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type MemberIconSize = "sm" | "md" | "lg";
export type MemberIconProps = {
  variant?: MemberIconVariant;
  size?: MemberIconSize;
  strokeWidth?: number;
};
const sizes: Record<MemberIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MemberIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function MemberIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: MemberIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 21a8 8 0 0 1 16 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
