import Svg, { Circle, Path } from "react-native-svg";

export type SwitchTeamIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SwitchTeamIconSize = "sm" | "md" | "lg";
export type SwitchTeamIconProps = { variant?: SwitchTeamIconVariant; size?: SwitchTeamIconSize; strokeWidth?: number };

const sizes: Record<SwitchTeamIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SwitchTeamIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function SwitchTeamIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: SwitchTeamIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Circle cx="7" cy="7" r="3" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="17" cy="17" r="3" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M2.5 16v-1A4.5 4.5 0 0 1 7 10.5c1.15 0 2.2.43 3 1.13M21.5 8V7A4.5 4.5 0 0 0 17 2.5c-1.15 0-2.2.43-3 1.13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M11 6.5h4.5L14 5M13 17.5H8.5L10 19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
