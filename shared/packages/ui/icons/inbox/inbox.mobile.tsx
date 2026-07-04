import Svg, { Path } from "react-native-svg";

export type InboxIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type InboxIconSize = "sm" | "md" | "lg";
export type InboxIconProps = {
  variant?: InboxIconVariant;
  size?: InboxIconSize;
  strokeWidth?: number;
};

const sizes: Record<InboxIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<InboxIconVariant, string> = {
  default: "#1C1A17",
  muted: "#6B6358",
  accent: "#8B6F47",
  danger: "#7F2E2E",
  inverse: "#FAF7F2",
};

export function InboxIcon({
  variant = "default",
  size = "md",
  strokeWidth = 1.4,
}: InboxIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];

  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 13.5 6.6 6.6A2.2 2.2 0 0 1 8.7 5h6.6a2.2 2.2 0 0 1 2.1 1.6l2.1 6.9v3.1a2.4 2.4 0 0 1-2.4 2.4H6.9a2.4 2.4 0 0 1-2.4-2.4v-3.1Z"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <Path
        d="M4.8 13.5h4.1c.6 0 .9.3 1.1.8l.2.5c.2.5.6.8 1.2.8h1.2c.6 0 1-.3 1.2-.8l.2-.5c.2-.5.5-.8 1.1-.8h4.1"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </Svg>
  );
}
