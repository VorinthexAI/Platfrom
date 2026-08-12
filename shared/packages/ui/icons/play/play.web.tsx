import type { SVGProps } from "react";
export type PlayIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type PlayIconSize = "sm" | "md" | "lg";
export type PlayIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: PlayIconVariant; size?: PlayIconSize };
const sizes: Record<PlayIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<PlayIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function PlayIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: PlayIconProps) {
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}><path d="M8 5.5v13l10-6.5L8 5.5Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="round" /></svg>;
}
