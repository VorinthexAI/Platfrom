import type { SVGProps } from "react";

export type AudioFileIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type AudioFileIconSize = "sm" | "md" | "lg";
export type AudioFileIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: AudioFileIconVariant; size?: AudioFileIconSize };

const sizes: Record<AudioFileIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<AudioFileIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };

export function AudioFileIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: AudioFileIconProps) {
  const color = colors[variant];
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-5-5Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4M8 13v3m3-5v7m3-5v3m3-2v1" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
