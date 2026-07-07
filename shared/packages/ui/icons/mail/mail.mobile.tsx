import Svg, { Path } from "react-native-svg";
export type MailIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type MailIconSize = "sm" | "md" | "lg";
export type MailIconProps = {
  variant?: MailIconVariant;
  size?: MailIconSize;
  strokeWidth?: number;
};
const sizes: Record<MailIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MailIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};
export function MailIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: MailIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 5v14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
