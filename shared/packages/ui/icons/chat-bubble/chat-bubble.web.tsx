import type { SVGProps } from "react";
export type ChatBubbleIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ChatBubbleIconSize = "sm" | "md" | "lg";
export type ChatBubbleIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ChatBubbleIconVariant;
  size?: ChatBubbleIconSize;
};
const sizes: Record<ChatBubbleIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ChatBubbleIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ChatBubbleIcon({ variant = "default", size = "md", strokeWidth = 1.4, ...props }: ChatBubbleIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 5.5h16v10H10.5L5.5 19v-3.5H4v-10Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
