import Svg, { Path, Rect } from "react-native-svg";

export type CheckboxIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CheckboxIconSize = "sm" | "md" | "lg";
export type CheckboxIconProps = {
  checked?: boolean;
  variant?: CheckboxIconVariant;
  size?: CheckboxIconSize;
  strokeWidth?: number;
};

const sizes: Record<CheckboxIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CheckboxIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function CheckboxIcon({ checked = false, variant = "default", size = "md", strokeWidth = 1.4 }: CheckboxIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Rect x="4.5" y="4.5" width="15" height="15" rx="3" stroke={color} strokeWidth={strokeWidth} />
      {checked ? <Path d="m8 12.5 2.7 2.7L16.5 9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </Svg>
  );
}
