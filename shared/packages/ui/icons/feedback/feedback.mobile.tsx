import Svg, { Path } from "react-native-svg";

export type FeedbackIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type FeedbackIconSize = "sm" | "md" | "lg";
export type FeedbackIconProps = { variant?: FeedbackIconVariant; size?: FeedbackIconSize; strokeWidth?: number };

const sizes: Record<FeedbackIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FeedbackIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function FeedbackIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: FeedbackIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 5.5h16v11H9l-5 4v-15Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 10h8M8 13h5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
