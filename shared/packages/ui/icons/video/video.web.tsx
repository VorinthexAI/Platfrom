import type { SVGProps } from "react";
export type VideoIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type VideoIconSize = "sm" | "md" | "lg";
export type VideoIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: VideoIconVariant; size?: VideoIconSize };
const sizes: Record<VideoIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<VideoIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function VideoIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: VideoIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 7.5h10.5v9H4v-9Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M14.5 10.2 20 7.8v8.4l-5.5-2.4v-3.6Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
