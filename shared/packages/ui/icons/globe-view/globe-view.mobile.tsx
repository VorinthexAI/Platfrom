import Svg, { Circle, Path } from "react-native-svg";

export type GlobeViewIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type GlobeViewIconSize = "sm" | "md" | "lg";
export type GlobeViewIconProps = {
  variant?: GlobeViewIconVariant;
  size?: GlobeViewIconSize;
  strokeWidth?: number;
};

const sizes: Record<GlobeViewIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<GlobeViewIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function GlobeViewIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: GlobeViewIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M4.2 9h15.6M4.2 15h15.6M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5S14.2 18.2 12 20.5C9.8 18.2 8.6 15.3 8.6 12S9.8 5.8 12 3.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
