import Svg, { Path } from "react-native-svg";

export type TermsIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type TermsIconSize = "sm" | "md" | "lg";
export type TermsIconProps = { variant?: TermsIconVariant; size?: TermsIconSize; strokeWidth?: number };

const sizes: Record<TermsIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TermsIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function TermsIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: TermsIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M6 3.5h8l4 4V20.5H6zM14 3.5v4h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m9 12 1.2 1.2 2-2.2M9 16.5h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
