import Svg, { Path } from "react-native-svg";
export type SearchIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type SearchIconSize = "sm" | "md" | "lg";
export type SearchIconProps = {
  variant?: SearchIconVariant;
  size?: SearchIconSize;
  strokeWidth?: number;
};
const sizes: Record<SearchIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SearchIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function SearchIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: SearchIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 5v14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
