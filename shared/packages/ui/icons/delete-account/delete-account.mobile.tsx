import Svg, { Circle, Path } from "react-native-svg";

export type DeleteAccountIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type DeleteAccountIconSize = "sm" | "md" | "lg";
export type DeleteAccountIconProps = { variant?: DeleteAccountIconVariant; size?: DeleteAccountIconSize; strokeWidth?: number };

const sizes: Record<DeleteAccountIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<DeleteAccountIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function DeleteAccountIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: DeleteAccountIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Circle cx="9" cy="7.5" r="3.5" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M3.5 20v-2a5.5 5.5 0 0 1 9.6-3.65" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx="17.5" cy="17.5" r="3.5" stroke={color} strokeWidth={strokeWidth} />
      <Path d="m16 16 3 3M19 16l-3 3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
