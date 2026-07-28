import type { SVGProps } from "react";

export type MicrophoneIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type MicrophoneIconSize = "sm" | "md" | "lg";
export type MicrophoneIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: MicrophoneIconVariant; size?: MicrophoneIconSize };
const sizes: Record<MicrophoneIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MicrophoneIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };

export function MicrophoneIcon({ variant = "inherit", size = "md", strokeWidth = 1.6, ...props }: MicrophoneIconProps) {
  const color = colors[variant];
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <rect x="8" y="3" width="8" height="12" rx="4" stroke={color} strokeWidth={strokeWidth} />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>;
}
