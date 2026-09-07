import Svg, { Circle, Path } from "react-native-svg";

export type ReferralIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ReferralIconSize = "sm" | "md" | "lg";
export type ReferralIconProps = { variant?: ReferralIconVariant; size?: ReferralIconSize; strokeWidth?: number };

const sizes: Record<ReferralIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ReferralIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function ReferralIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: ReferralIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return <Svg fill="none" height={pixelSize} viewBox="0 0 24 24" width={pixelSize}>
    <Circle cx={7} cy={8} r={3} stroke={color} strokeWidth={strokeWidth} />
    <Circle cx={17} cy={8} r={3} stroke={color} strokeWidth={strokeWidth} />
    <Path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h1.5M21.5 20v-1.5A4.5 4.5 0 0 0 17 14h-1.5M9 18h6m-2.5-2.5L15 18l-2.5 2.5" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
  </Svg>;
}
