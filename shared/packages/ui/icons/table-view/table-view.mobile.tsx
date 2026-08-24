import Svg, { Path, Rect } from "react-native-svg";

export type TableViewIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type TableViewIconSize = "sm" | "md" | "lg";
export type TableViewIconProps = {
  variant?: TableViewIconVariant;
  size?: TableViewIconSize;
  strokeWidth?: number;
};

const sizes: Record<TableViewIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TableViewIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function TableViewIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: TableViewIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={4} width={17} height={16} rx={2} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M3.5 9h17M3.5 14.5h17M10 9v11" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
