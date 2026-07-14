import Svg, { Path } from "react-native-svg";

export type VolumeIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type VolumeIconSize = "sm" | "md" | "lg";
export type VolumeIconProps = {
  variant?: VolumeIconVariant;
  size?: VolumeIconSize;
  strokeWidth?: number;
};

const sizes: Record<VolumeIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<VolumeIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function VolumeIcon({
  variant = "default",
  size = "md",
  strokeWidth = 1.6,
}: VolumeIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];

  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" fill={color} opacity={0.9} />
      <Path
        d="M15.8 8.8a4.6 4.6 0 0 1 0 6.4M18.4 6.4a8.2 8.2 0 0 1 0 11.2"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
