import Svg, { Path } from "react-native-svg";
export type ChatBubbleIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ChatBubbleIconSize = "sm" | "md" | "lg";
export type ChatBubbleIconProps = {
  variant?: ChatBubbleIconVariant;
  size?: ChatBubbleIconSize;
  strokeWidth?: number;
};
const sizes: Record<ChatBubbleIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ChatBubbleIconVariant, string> = {
  default: "#1C1A17",
  muted: "#6B6358",
  accent: "#8B6F47",
  danger: "#7F2E2E",
  inverse: "#FAF7F2",
};
export function ChatBubbleIcon({ variant = "default", size = "md", strokeWidth = 1.4 }: ChatBubbleIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <Svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none">
      <Path d="M4 5.5h16v10H10.5L5.5 19v-3.5H4v-10Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
