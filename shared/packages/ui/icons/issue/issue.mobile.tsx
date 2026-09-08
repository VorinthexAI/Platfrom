import Svg, { Path } from "react-native-svg";

export type IssueIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type IssueIconSize = "sm" | "md" | "lg";
export type IssueIconProps = { variant?: IssueIconVariant; size?: IssueIconSize; strokeWidth?: number };

const sizes: Record<IssueIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<IssueIconVariant, string> = {
  default: "#F5F7F8",
  muted: "#7B858C",
  accent: "#DDE2E5",
  danger: "#B04A4A",
  inverse: "#030507",
};

export function IssueIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: IssueIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M8.3 3.5h7.4l4.8 4.8v7.4l-4.8 4.8H8.3l-4.8-4.8V8.3l4.8-4.8Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M12 7.5v5.7M12 16.5h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
