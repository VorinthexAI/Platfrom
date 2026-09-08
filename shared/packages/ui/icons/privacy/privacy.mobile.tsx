import Svg, { Circle, Path } from "react-native-svg";

export type PrivacyIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type PrivacyIconSize = "sm" | "md" | "lg";
export type PrivacyIconProps = { variant?: PrivacyIconVariant; size?: PrivacyIconSize; strokeWidth?: number };

const sizes: Record<PrivacyIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<PrivacyIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function PrivacyIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: PrivacyIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="10.5" r="2" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M12 12.5V16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
