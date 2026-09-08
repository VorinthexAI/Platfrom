import Svg, { Path } from "react-native-svg";

export type SignOutIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SignOutIconSize = "sm" | "md" | "lg";
export type SignOutIconProps = { variant?: SignOutIconVariant; size?: SignOutIconSize; strokeWidth?: number };

const sizes: Record<SignOutIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SignOutIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function SignOutIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: SignOutIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M13.5 4H6v16h7.5M10 12h11M17.5 8.5 21 12l-3.5 3.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6 4 3 6v12l3 2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
