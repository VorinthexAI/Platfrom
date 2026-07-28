import type { SVGProps } from "react";

export type SendIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type SendIconSize = "sm" | "md" | "lg";
export type SendIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: SendIconVariant; size?: SendIconSize };
const sizes: Record<SendIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SendIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };

export function SendIcon({ variant = "inherit", size = "md", strokeWidth = 1.6, ...props }: SendIconProps) {
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M21 3 10.5 13.5" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
