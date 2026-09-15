import Svg, { Path } from "react-native-svg";

export type SparksIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SparksIconSize = "sm" | "md" | "lg";
export type SparksIconProps = { variant?: SparksIconVariant; size?: SparksIconSize; strokeWidth?: number };

const sizes: Record<SparksIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SparksIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function SparksIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: SparksIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return <Svg fill="none" height={pixelSize} viewBox="0 0 24 24" width={pixelSize}>
    <Path d="M10.5 3.25c.5 4.19 2.31 6.5 6 7.5-3.69 1-5.5 3.31-6 7.5-.5-4.19-2.31-6.5-6-7.5 3.69-1 5.5-3.31 6-7.5Z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} />
    <Path d="M18.25 3.25c.18 1.5.83 2.32 2.15 2.68-1.32.36-1.97 1.18-2.15 2.67-.18-1.49-.83-2.31-2.15-2.67 1.32-.36 1.97-1.18 2.15-2.68ZM18.75 16.2c.17 1.39.77 2.16 2 2.5-1.23.33-1.83 1.1-2 2.5-.17-1.4-.77-2.17-2-2.5 1.23-.34 1.83-1.11 2-2.5Z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} />
  </Svg>;
}
